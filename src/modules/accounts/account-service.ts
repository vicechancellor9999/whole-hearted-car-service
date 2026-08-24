import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import type { AccountRole } from "@/modules/auth/auth-service";
import { hashPassword } from "@/modules/auth/password";
import {
  accountDisplayNameSchema,
  accountRoleSchema,
  createAccountFieldsSchema,
} from "@/modules/accounts/account-schemas";

export type AccountActionContext = {
  actorAccountId: number;
  requestId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type BootstrapAccountContext = {
  requestId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type DelegatedPermission = "sensitive_operations.execute";

export type ManagedAccount = {
  id: number;
  displayName: string;
  normalizedUsername: string;
  role: AccountRole;
  isActive: boolean;
  mustChangePassword: boolean;
  sessionEpoch: number;
  version: number;
  delegatedPermissions: DelegatedPermission[];
};

type AccountRow = {
  id: number;
  display_name: string;
  normalized_username: string;
  role: AccountRole;
  is_active: boolean;
  must_change_password: boolean;
  session_epoch: number;
  version: number;
};

type ListedAccountRow = AccountRow & {
  delegated_permissions: DelegatedPermission[];
};

export class AccountManagementDeniedError extends Error {
  readonly status = 403;
  readonly code = "account_management_denied";

  constructor() {
    super("只有激活的超级管理员可以管理账号");
    this.name = "AccountManagementDeniedError";
  }
}

export class DuplicateUsernameError extends Error {
  readonly status = 409;
  readonly code = "duplicate_username";

  constructor() {
    super("登录名已存在");
    this.name = "DuplicateUsernameError";
  }
}

export class AccountNotFoundError extends Error {
  readonly status = 404;
  readonly code = "account_not_found";

  constructor() {
    super("账号不存在");
    this.name = "AccountNotFoundError";
  }
}

export class LastActiveSuperAdminError extends Error {
  readonly status = 409;
  readonly code = "last_active_super_admin";

  constructor() {
    super("必须至少保留一个激活的超级管理员");
    this.name = "LastActiveSuperAdminError";
  }
}

export class DelegatedPermissionTargetError extends Error {
  readonly status = 409;
  readonly code = "delegated_permission_target_invalid";

  constructor() {
    super("敏感操作权限只能下放给前台账号");
    this.name = "DelegatedPermissionTargetError";
  }
}

export class SuperAdminAlreadyExistsError extends Error {
  readonly status = 409;
  readonly code = "super_admin_already_exists";

  constructor() {
    super("系统已经存在超级管理员");
    this.name = "SuperAdminAlreadyExistsError";
  }
}

export class AccountService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async listAccounts(input: {
    actorAccountId: number;
  }): Promise<ManagedAccount[]> {
    const rows = await this.database.query<ListedAccountRow>(
      `select account.id, account.display_name, account.normalized_username,
              account.role, account.is_active, account.must_change_password,
              account.session_epoch, account.version,
              coalesce(
                (
                  select array_agg(grant_row.permission::text order by grant_row.permission)
                  from staff_account_permission_grants as grant_row
                  where grant_row.account_id = account.id
                ),
                array[]::text[]
              ) as delegated_permissions
       from staff_accounts as account
       where exists (
         select 1
         from staff_accounts as actor
         where actor.id = $1
           and actor.role = 'super_admin'
           and actor.is_active = true
       )
       order by account.id`,
      [input.actorAccountId],
    );
    if (rows.length === 0) throw new AccountManagementDeniedError();
    return rows.map((row) => ({
      ...mapAccount(row),
      delegatedPermissions: row.delegated_permissions,
    }));
  }

  async bootstrapFirstSuperAdmin(input: {
    displayName: string;
    username: string;
    password: string;
    context: BootstrapAccountContext;
  }): Promise<ManagedAccount> {
    const fields = createAccountFieldsSchema.parse({
      ...input,
      role: "super_admin",
    });
    const passwordHash = await hashPassword(fields.password);
    const now = input.context.now ?? new Date();

    try {
      return await this.database.transaction(async (transaction) => {
        await transaction.query(
          "lock table staff_accounts in share row exclusive mode",
        );
        const existing = await transaction.query<{ id: number }>(
          `select id
           from staff_accounts
           where role = 'super_admin'
           limit 1`,
        );
        if (existing.length > 0) {
          throw new SuperAdminAlreadyExistsError();
        }

        const rows = await transaction.query<AccountRow>(
          `insert into staff_accounts
            (display_name, normalized_username, password_hash, role,
             is_active, must_change_password, session_epoch, created_at,
             updated_at, created_by, version)
           values ($1, $2, $3, 'super_admin', true, true, 1, $4, $4, null, 1)
           returning id, display_name, normalized_username, role, is_active,
                     must_change_password, session_epoch, version`,
          [fields.displayName, fields.username, passwordHash, now],
        );
        const account = mapAccount(rows[0]);
        await transaction.query(
          `insert into audit_events
            (occurred_at, actor_account_id, event_type, object_type, object_id,
             after_state, request_id, ip_address, user_agent)
           values ($1, null, 'account.bootstrap_created', 'staff_account', $2,
                   $3::jsonb, $4, $5::inet, $6)`,
          [
            now,
            String(account.id),
            JSON.stringify(toAuditState(account)),
            input.context.requestId,
            input.context.ipAddress ?? null,
            input.context.userAgent ?? null,
          ],
        );
        return account;
      });
    } catch (error) {
      if (isPostgresError(error, "23505")) {
        throw new DuplicateUsernameError();
      }
      throw error;
    }
  }

  async createAccount(input: {
    displayName: string;
    username: string;
    password: string;
    role: AccountRole;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const fields = createAccountFieldsSchema.parse(input);
    const passwordHash = await hashPassword(fields.password);
    const now = input.context.now ?? new Date();

    try {
      return await this.database.transaction(async (transaction) => {
        const actors = await transaction.query<{
          id: number;
          role: AccountRole;
          is_active: boolean;
        }>(
          `select id, role, is_active
           from staff_accounts
           where id = $1
           for update`,
          [input.context.actorAccountId],
        );
        const actor = actors[0];
        if (!actor || actor.role !== "super_admin" || !actor.is_active) {
          throw new AccountManagementDeniedError();
        }

        const rows = await transaction.query<AccountRow>(
          `insert into staff_accounts
            (display_name, normalized_username, password_hash, role,
             is_active, must_change_password, session_epoch, created_at,
             updated_at, created_by, version)
           values ($1, $2, $3, $4::account_role, true, true, 1, $5, $5, $6, 1)
           returning id, display_name, normalized_username, role, is_active,
                     must_change_password, session_epoch, version`,
          [
            fields.displayName,
            fields.username,
            passwordHash,
            fields.role,
            now,
            input.context.actorAccountId,
          ],
        );
        const account = mapAccount(rows[0]);
        const afterState = toAuditState(account);

        await transaction.query(
          `insert into audit_events
            (occurred_at, actor_account_id, event_type, object_type, object_id,
             after_state, request_id, ip_address, user_agent)
           values ($1, $2, 'account.created', 'staff_account', $3,
                   $4::jsonb, $5, $6::inet, $7)`,
          [
            now,
            input.context.actorAccountId,
            String(account.id),
            JSON.stringify(afterState),
            input.context.requestId,
            input.context.ipAddress ?? null,
            input.context.userAgent ?? null,
          ],
        );

        return account;
      });
    } catch (error) {
      if (isPostgresError(error, "23505")) {
        throw new DuplicateUsernameError();
      }
      throw error;
    }
  }

  async updateDisplayName(input: {
    accountId: number;
    displayName: string;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const displayName = accountDisplayNameSchema.parse(input.displayName);
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const locked = await lockAccounts(
        transaction,
        input.context.actorAccountId,
        input.accountId,
      );
      requireSuperAdminActor(locked, input.context.actorAccountId);
      const before = findAccount(locked, input.accountId);

      const updated = await transaction.query<AccountRow>(
        `update staff_accounts
         set display_name = $2,
             updated_at = $3,
             version = version + 1
         where id = $1
         returning id, display_name, normalized_username, role, is_active,
                   must_change_password, session_epoch, version`,
        [input.accountId, displayName, now],
      );
      const after = mapAccount(updated[0]);
      await insertAccountAudit(transaction, {
        context: input.context,
        now,
        eventType: "account.display_name_changed",
        accountId: input.accountId,
        before: toAuditState(mapAccount(before)),
        after: toAuditState(after),
      });
      return after;
    });
  }

  async setAccountActive(input: {
    accountId: number;
    isActive: boolean;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const locked = await lockAccountMutationSet(
        transaction,
        input.context.actorAccountId,
        input.accountId,
      );
      requireSuperAdminActor(locked, input.context.actorAccountId);
      const targetRow = findAccount(locked, input.accountId);
      const before = mapAccount(targetRow);
      if (before.isActive === input.isActive) return before;

      if (
        !input.isActive &&
        before.role === "super_admin" &&
        locked.filter((row) => row.role === "super_admin" && row.is_active)
          .length <= 1
      ) {
        throw new LastActiveSuperAdminError();
      }

      const updated = await transaction.query<AccountRow>(
        `update staff_accounts
         set is_active = $2,
             session_epoch = session_epoch + 1,
             updated_at = $3,
             version = version + 1
         where id = $1
         returning id, display_name, normalized_username, role, is_active,
                   must_change_password, session_epoch, version`,
        [input.accountId, input.isActive, now],
      );
      await revokeAccountSessions(transaction, input.accountId, now);
      const after = mapAccount(updated[0]);
      await insertAccountAudit(transaction, {
        context: input.context,
        now,
        eventType: input.isActive
          ? "account.activated"
          : "account.deactivated",
        accountId: input.accountId,
        before: toAuditState(before),
        after: toAuditState(after),
      });
      return after;
    });
  }

  async changeAccountRole(input: {
    accountId: number;
    role: AccountRole;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const role = accountRoleSchema.parse(input.role);
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const locked = await lockAccountMutationSet(
        transaction,
        input.context.actorAccountId,
        input.accountId,
      );
      requireSuperAdminActor(locked, input.context.actorAccountId);
      const currentPermissions = await transaction.query<{
        permission: DelegatedPermission;
      }>(
        `select permission
         from staff_account_permission_grants
         where account_id = $1
         order by permission
         for update`,
        [input.accountId],
      );
      const before = {
        ...mapAccount(findAccount(locked, input.accountId)),
        delegatedPermissions: currentPermissions.map(
          (permission) => permission.permission,
        ),
      };
      if (before.role === role) return before;

      if (
        before.role === "super_admin" &&
        before.isActive &&
        locked.filter((row) => row.role === "super_admin" && row.is_active)
          .length <= 1
      ) {
        throw new LastActiveSuperAdminError();
      }

      const updated = await transaction.query<AccountRow>(
        `update staff_accounts
         set role = $2::account_role,
             session_epoch = session_epoch + 1,
             updated_at = $3,
             version = version + 1
         where id = $1
         returning id, display_name, normalized_username, role, is_active,
                   must_change_password, session_epoch, version`,
        [input.accountId, role, now],
      );
      if (role !== "front_desk") {
        await transaction.query(
          `delete from staff_account_permission_grants
           where account_id = $1`,
          [input.accountId],
        );
      }
      await revokeAccountSessions(transaction, input.accountId, now);
      const after = mapAccount(updated[0]);
      await insertAccountAudit(transaction, {
        context: input.context,
        now,
        eventType: "account.role_changed",
        accountId: input.accountId,
        before: toPermissionAuditState(before),
        after: toPermissionAuditState(after),
      });
      return after;
    });
  }

  async resetPassword(input: {
    accountId: number;
    newPassword: string;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const passwordHash = await hashPassword(input.newPassword);
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const locked = await lockAccounts(
        transaction,
        input.context.actorAccountId,
        input.accountId,
      );
      requireSuperAdminActor(locked, input.context.actorAccountId);
      const before = mapAccount(findAccount(locked, input.accountId));

      const updated = await transaction.query<AccountRow>(
        `update staff_accounts
         set password_hash = $2,
             must_change_password = true,
             session_epoch = session_epoch + 1,
             updated_at = $3,
             version = version + 1
         where id = $1
         returning id, display_name, normalized_username, role, is_active,
                   must_change_password, session_epoch, version`,
        [input.accountId, passwordHash, now],
      );
      await revokeAccountSessions(transaction, input.accountId, now);
      const after = mapAccount(updated[0]);
      await insertAccountAudit(transaction, {
        context: input.context,
        now,
        eventType: "account.password_reset",
        accountId: input.accountId,
        before: toAuditState(before),
        after: toAuditState(after),
      });
      return after;
    });
  }

  async forceLogout(input: {
    accountId: number;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const locked = await lockAccounts(
        transaction,
        input.context.actorAccountId,
        input.accountId,
      );
      requireSuperAdminActor(locked, input.context.actorAccountId);
      const before = mapAccount(findAccount(locked, input.accountId));
      const updated = await transaction.query<AccountRow>(
        `update staff_accounts
         set session_epoch = session_epoch + 1,
             updated_at = $2,
             version = version + 1
         where id = $1
         returning id, display_name, normalized_username, role, is_active,
                   must_change_password, session_epoch, version`,
        [input.accountId, now],
      );
      await revokeAccountSessions(transaction, input.accountId, now);
      const after = mapAccount(updated[0]);
      await insertAccountAudit(transaction, {
        context: input.context,
        now,
        eventType: "account.sessions_revoked",
        accountId: input.accountId,
        before: toAuditState(before),
        after: toAuditState(after),
      });
      return after;
    });
  }

  async setSensitiveOperationsPermission(input: {
    accountId: number;
    enabled: boolean;
    context: AccountActionContext;
  }): Promise<ManagedAccount> {
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const locked = await lockAccounts(
        transaction,
        input.context.actorAccountId,
        input.accountId,
      );
      requireSuperAdminActor(locked, input.context.actorAccountId);
      const target = mapAccount(findAccount(locked, input.accountId));
      if (target.role !== "front_desk") {
        throw new DelegatedPermissionTargetError();
      }

      const existing = await transaction.query<{ permission: string }>(
        `select permission
         from staff_account_permission_grants
         where account_id = $1
           and permission = 'sensitive_operations.execute'
         for update`,
        [input.accountId],
      );
      const alreadyEnabled = existing.length > 0;
      if (alreadyEnabled === input.enabled) {
        return withSensitivePermission(target, alreadyEnabled);
      }

      if (input.enabled) {
        await transaction.query(
          `insert into staff_account_permission_grants
            (account_id, permission, granted_by, granted_at)
           values ($1, 'sensitive_operations.execute', $2, $3)`,
          [input.accountId, input.context.actorAccountId, now],
        );
      } else {
        await transaction.query(
          `delete from staff_account_permission_grants
           where account_id = $1
             and permission = 'sensitive_operations.execute'`,
          [input.accountId],
        );
      }

      const updated = await transaction.query<AccountRow>(
        `update staff_accounts
         set updated_at = $2,
             version = version + 1
         where id = $1
         returning id, display_name, normalized_username, role, is_active,
                   must_change_password, session_epoch, version`,
        [input.accountId, now],
      );
      const before = withSensitivePermission(target, alreadyEnabled);
      const after = withSensitivePermission(mapAccount(updated[0]), input.enabled);
      await insertAccountAudit(transaction, {
        context: input.context,
        now,
        eventType: input.enabled
          ? "account.permission_granted"
          : "account.permission_revoked",
        accountId: input.accountId,
        before: toPermissionAuditState(before),
        after: toPermissionAuditState(after),
      });
      return after;
    });
  }
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function lockAccounts(
  executor: AuthSqlExecutor,
  actorAccountId: number,
  targetAccountId: number,
): Promise<AccountRow[]> {
  return executor.query<AccountRow>(
    `select id, display_name, normalized_username, role, is_active,
            must_change_password, session_epoch, version
     from staff_accounts
     where id = $1 or id = $2
     order by id
     for update`,
    [actorAccountId, targetAccountId],
  );
}

async function lockAccountMutationSet(
  executor: AuthSqlExecutor,
  actorAccountId: number,
  targetAccountId: number,
): Promise<AccountRow[]> {
  return executor.query<AccountRow>(
    `select id, display_name, normalized_username, role, is_active,
            must_change_password, session_epoch, version
     from staff_accounts
     where id = $1
        or id = $2
        or (role = 'super_admin' and is_active = true)
     order by id
     for update`,
    [actorAccountId, targetAccountId],
  );
}

function requireSuperAdminActor(rows: AccountRow[], actorAccountId: number) {
  const actor = rows.find((row) => Number(row.id) === actorAccountId);
  if (!actor || actor.role !== "super_admin" || !actor.is_active) {
    throw new AccountManagementDeniedError();
  }
}

function findAccount(rows: AccountRow[], accountId: number): AccountRow {
  const account = rows.find((row) => Number(row.id) === accountId);
  if (!account) throw new AccountNotFoundError();
  return account;
}

async function insertAccountAudit(
  executor: AuthSqlExecutor,
  input: {
    context: AccountActionContext;
    now: Date;
    eventType: string;
    accountId: number;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason?: string;
  },
) {
  await executor.query(
    `insert into audit_events
      (occurred_at, actor_account_id, event_type, object_type, object_id,
       reason, before_state, after_state, request_id, ip_address, user_agent)
     values ($1, $2, $3, 'staff_account', $4, $5,
             $6::jsonb, $7::jsonb, $8, $9::inet, $10)`,
    [
      input.now,
      input.context.actorAccountId,
      input.eventType,
      String(input.accountId),
      input.reason ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.context.requestId,
      input.context.ipAddress ?? null,
      input.context.userAgent ?? null,
    ],
  );
}

async function revokeAccountSessions(
  executor: AuthSqlExecutor,
  accountId: number,
  now: Date,
) {
  await executor.query(
    `update auth_sessions
     set revoked_at = $2
     where account_id = $1
       and revoked_at is null`,
    [accountId, now],
  );
}

function mapAccount(row: AccountRow | undefined): ManagedAccount {
  if (!row) throw new Error("账号写入后无法读取");
  return {
    id: Number(row.id),
    displayName: row.display_name,
    normalizedUsername: row.normalized_username,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    sessionEpoch: row.session_epoch,
    version: row.version,
    delegatedPermissions: [],
  };
}

function toAuditState(account: ManagedAccount) {
  return {
    displayName: account.displayName,
    normalizedUsername: account.normalizedUsername,
    role: account.role,
    isActive: account.isActive,
    mustChangePassword: account.mustChangePassword,
    sessionEpoch: account.sessionEpoch,
    version: account.version,
  };
}

function withSensitivePermission(
  account: ManagedAccount,
  enabled: boolean,
): ManagedAccount {
  return {
    ...account,
    delegatedPermissions: enabled
      ? ["sensitive_operations.execute"]
      : [],
  };
}

function toPermissionAuditState(account: ManagedAccount) {
  return {
    ...toAuditState(account),
    delegatedPermissions: account.delegatedPermissions,
  };
}
