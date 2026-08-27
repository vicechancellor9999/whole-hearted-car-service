import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { hashPassword, verifyPassword } from "@formal/modules/auth/password";
import {
  AccountService,
  DelegatedPermissionTargetError,
  DuplicateUsernameError,
  LastActiveSuperAdminError,
  SuperAdminAlreadyExistsError,
} from "@formal/modules/accounts/account-service";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0001_account_permissions.sql"),
];

let database: PGlite;
let service: AccountService;
let adminId: number;

function createExecutor(executor: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      const result = await executor.query<Row>(text, [...parameters]);
      return result.rows;
    },
  };
}

function createTestDatabase(pglite: PGlite): AuthSqlDatabase {
  return {
    ...createExecutor(pglite),
    transaction(callback) {
      return pglite.transaction((transaction) =>
        callback(createExecutor(transaction)),
      );
    },
  };
}

async function applyMigrations() {
  for (const path of migrationPaths) {
    await database.exec(await readFile(path, "utf8"));
  }
}

async function seedAccount(input: {
  displayName: string;
  username: string;
  password: string;
  role: "super_admin" | "front_desk" | "owner" | "mechanic";
}) {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role,
       must_change_password)
     values ($1, $2, $3, $4, false)
     returning id`,
    [
      input.displayName,
      input.username,
      await hashPassword(input.password),
      input.role,
    ],
  );
  return result.rows[0].id;
}

function context(requestId: string, actorAccountId = adminId) {
  return {
    actorAccountId,
    requestId,
    now: new Date("2026-08-25T01:00:00Z"),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

describe("AccountService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyMigrations();
    adminId = await seedAccount({
      displayName: "超级管理员",
      username: "admin",
      password: "Formal admin 2026!",
      role: "super_admin",
    });
    service = new AccountService(createTestDatabase(database));
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates a normalized account with a secure password and sanitized audit", async () => {
    const account = await service.createAccount({
      displayName: " 前台一号 ",
      username: "  ＦRONT.One ",
      password: "Front desk 2026!",
      role: "front_desk",
      context: context("req-account-create"),
    });

    expect(account).toMatchObject({
      displayName: "前台一号",
      normalizedUsername: "front.one",
      role: "front_desk",
      isActive: true,
      mustChangePassword: true,
      sessionEpoch: 1,
      delegatedPermissions: [],
    });
    const stored = await database.query<{
      password_hash: string;
      created_by: number;
    }>(
      `select password_hash, created_by
       from staff_accounts
       where id = $1`,
      [account.id],
    );
    expect(stored.rows[0].created_by).toBe(adminId);
    await expect(
      verifyPassword(stored.rows[0].password_hash, "Front desk 2026!"),
    ).resolves.toBe(true);

    const audits = await database.query<{
      event_type: string;
      actor_account_id: number;
      object_id: string;
      after_state: Record<string, unknown>;
    }>(
      `select event_type, actor_account_id, object_id, after_state
       from audit_events
       order by id`,
    );
    expect(audits.rows).toEqual([
      {
        event_type: "account.created",
        actor_account_id: adminId,
        object_id: String(account.id),
        after_state: {
          displayName: "前台一号",
          normalizedUsername: "front.one",
          role: "front_desk",
          isActive: true,
          mustChangePassword: true,
          sessionEpoch: 1,
          version: 1,
        },
      },
    ]);
    expect(JSON.stringify(audits.rows)).not.toContain("Front desk 2026!");
    expect(JSON.stringify(audits.rows)).not.toContain("passwordHash");
    expect(JSON.stringify(audits.rows)).not.toContain("password_hash");
  });

  it("reports a duplicate normalized login name without leaking a database error", async () => {
    await expect(
      service.createAccount({
        displayName: "第二位管理员",
        username: " ＡＤＭＩＮ ",
        password: "Another admin 2026!",
        role: "super_admin",
        context: context("req-duplicate-username"),
      }),
    ).rejects.toBeInstanceOf(DuplicateUsernameError);

    const audits = await database.query<{ event_type: string }>(
      "select event_type from audit_events order by id",
    );
    expect(audits.rows).toEqual([]);
  });

  it("changes the display name while preserving an exact before-and-after audit", async () => {
    const created = await service.createAccount({
      displayName: "前台旧名",
      username: "front.rename",
      password: "Front rename 2026!",
      role: "front_desk",
      context: context("req-create-for-rename"),
    });

    const updated = await service.updateDisplayName({
      accountId: created.id,
      displayName: " 前台新名 ",
      context: context("req-account-rename"),
    });

    expect(updated).toMatchObject({
      id: created.id,
      displayName: "前台新名",
      normalizedUsername: "front.rename",
      version: 2,
    });
    const audit = await database.query<{
      event_type: string;
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
    }>(
      `select event_type, before_state, after_state
       from audit_events
       where request_id = 'req-account-rename'`,
    );
    expect(audit.rows).toEqual([
      {
        event_type: "account.display_name_changed",
        before_state: {
          displayName: "前台旧名",
          normalizedUsername: "front.rename",
          role: "front_desk",
          isActive: true,
          mustChangePassword: true,
          sessionEpoch: 1,
          version: 1,
        },
        after_state: {
          displayName: "前台新名",
          normalizedUsername: "front.rename",
          role: "front_desk",
          isActive: true,
          mustChangePassword: true,
          sessionEpoch: 1,
          version: 2,
        },
      },
    ]);
  });

  it("refuses to deactivate the last active super administrator", async () => {
    await expect(
      service.setAccountActive({
        accountId: adminId,
        isActive: false,
        context: context("req-deactivate-last-admin"),
      }),
    ).rejects.toBeInstanceOf(LastActiveSuperAdminError);

    const stored = await database.query<{
      is_active: boolean;
      session_epoch: number;
      version: number;
    }>(
      `select is_active, session_epoch, version
       from staff_accounts
       where id = $1`,
      [adminId],
    );
    expect(stored.rows).toEqual([
      { is_active: true, session_epoch: 1, version: 1 },
    ]);
    const audit = await database.query<{ event_type: string }>(
      "select event_type from audit_events where request_id = $1",
      ["req-deactivate-last-admin"],
    );
    expect(audit.rows).toEqual([]);
  });

  it("refuses to demote the last active super administrator", async () => {
    await expect(
      service.changeAccountRole({
        accountId: adminId,
        role: "owner",
        context: context("req-demote-last-admin"),
      }),
    ).rejects.toBeInstanceOf(LastActiveSuperAdminError);

    const stored = await database.query<{
      role: string;
      session_epoch: number;
      version: number;
    }>(
      `select role, session_epoch, version
       from staff_accounts
       where id = $1`,
      [adminId],
    );
    expect(stored.rows).toEqual([
      { role: "super_admin", session_epoch: 1, version: 1 },
    ]);
  });

  it("allows a second super administrator to change a role and invalidates existing sessions", async () => {
    const secondAdmin = await service.createAccount({
      displayName: "第二位超级管理员",
      username: "admin.two",
      password: "Second admin 2026!",
      role: "super_admin",
      context: context("req-create-second-admin"),
    });
    await database.query(
      `insert into auth_sessions
        (account_id, token_hash, session_epoch, created_at, last_seen_at,
         expires_at)
       values ($1, 'admin-session-before-role-change', 1, $2, $2, $3)`,
      [
        adminId,
        new Date("2026-08-25T00:00:00Z"),
        new Date("2026-08-25T12:00:00Z"),
      ],
    );

    const updated = await service.changeAccountRole({
      accountId: adminId,
      role: "owner",
      context: context("req-change-admin-role", secondAdmin.id),
    });

    expect(updated).toMatchObject({
      role: "owner",
      sessionEpoch: 2,
      version: 2,
    });
    const session = await database.query<{ revoked_at: Date | null }>(
      `select revoked_at
       from auth_sessions
       where token_hash = 'admin-session-before-role-change'`,
    );
    expect(session.rows).toEqual([
      { revoked_at: new Date("2026-08-25T01:00:00Z") },
    ]);
    const audit = await database.query<{
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
    }>(
      `select before_state, after_state
       from audit_events
       where request_id = 'req-change-admin-role'`,
    );
    expect(audit.rows).toEqual([
      {
        before_state: {
          delegatedPermissions: [],
          displayName: "超级管理员",
          normalizedUsername: "admin",
          role: "super_admin",
          isActive: true,
          mustChangePassword: false,
          sessionEpoch: 1,
          version: 1,
        },
        after_state: {
          delegatedPermissions: [],
          displayName: "超级管理员",
          normalizedUsername: "admin",
          role: "owner",
          isActive: true,
          mustChangePassword: false,
          sessionEpoch: 2,
          version: 2,
        },
      },
    ]);
  });

  it("resets a password, requires a first-login change, and revokes every existing session", async () => {
    const target = await service.createAccount({
      displayName: "前台重置测试",
      username: "front.reset",
      password: "Old front password 2026!",
      role: "front_desk",
      context: context("req-create-reset-target"),
    });
    await database.query(
      `insert into auth_sessions
        (account_id, token_hash, session_epoch, created_at, last_seen_at,
         expires_at)
       values ($1, 'front-session-before-reset', 1, $2, $2, $3)`,
      [
        target.id,
        new Date("2026-08-25T00:00:00Z"),
        new Date("2026-08-25T12:00:00Z"),
      ],
    );

    const updated = await service.resetPassword({
      accountId: target.id,
      newPassword: "New front password 2026!",
      context: context("req-reset-password"),
    });

    expect(updated).toMatchObject({
      mustChangePassword: true,
      sessionEpoch: 2,
      version: 2,
    });
    const stored = await database.query<{
      password_hash: string;
      revoked_at: Date | null;
    }>(
      `select account.password_hash, session.revoked_at
       from staff_accounts as account
       join auth_sessions as session on session.account_id = account.id
       where account.id = $1`,
      [target.id],
    );
    await expect(
      verifyPassword(
        stored.rows[0].password_hash,
        "New front password 2026!",
      ),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(
        stored.rows[0].password_hash,
        "Old front password 2026!",
      ),
    ).resolves.toBe(false);
    expect(stored.rows[0].revoked_at).toEqual(
      new Date("2026-08-25T01:00:00Z"),
    );

    const audit = await database.query<{
      event_type: string;
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
    }>(
      `select event_type, before_state, after_state
       from audit_events
       where request_id = 'req-reset-password'`,
    );
    expect(audit.rows[0]).toMatchObject({
      event_type: "account.password_reset",
      before_state: { sessionEpoch: 1, version: 1 },
      after_state: {
        mustChangePassword: true,
        sessionEpoch: 2,
        version: 2,
      },
    });
    expect(JSON.stringify(audit.rows)).not.toContain("New front password 2026!");
    expect(JSON.stringify(audit.rows)).not.toContain("passwordHash");
    expect(JSON.stringify(audit.rows)).not.toContain("password_hash");
  });

  it("forces all sessions out without changing the password", async () => {
    const target = await service.createAccount({
      displayName: "老板只读",
      username: "owner.logout",
      password: "Owner logout 2026!",
      role: "owner",
      context: context("req-create-logout-target"),
    });
    const original = await database.query<{ password_hash: string }>(
      "select password_hash from staff_accounts where id = $1",
      [target.id],
    );
    await database.query(
      `insert into auth_sessions
        (account_id, token_hash, session_epoch, created_at, last_seen_at,
         expires_at)
       values
        ($1, 'owner-session-one', 1, $2, $2, $3),
        ($1, 'owner-session-two', 1, $2, $2, $3)`,
      [
        target.id,
        new Date("2026-08-25T00:00:00Z"),
        new Date("2026-08-25T12:00:00Z"),
      ],
    );

    const updated = await service.forceLogout({
      accountId: target.id,
      context: context("req-force-logout"),
    });

    expect(updated).toMatchObject({ sessionEpoch: 2, version: 2 });
    const stored = await database.query<{
      password_hash: string;
      revoked_sessions: number;
    }>(
      `select account.password_hash,
              count(*) filter (where session.revoked_at = $2)::integer
                as revoked_sessions
       from staff_accounts as account
       join auth_sessions as session on session.account_id = account.id
       where account.id = $1
       group by account.password_hash`,
      [target.id, new Date("2026-08-25T01:00:00Z")],
    );
    expect(stored.rows).toEqual([
      {
        password_hash: original.rows[0].password_hash,
        revoked_sessions: 2,
      },
    ]);
    const audit = await database.query<{ event_type: string }>(
      "select event_type from audit_events where request_id = $1",
      ["req-force-logout"],
    );
    expect(audit.rows).toEqual([{ event_type: "account.sessions_revoked" }]);
  });

  it("persists and revokes the front-desk sensitive-operation permission with audits", async () => {
    const target = await service.createAccount({
      displayName: "前台授权测试",
      username: "front.permission",
      password: "Front permission 2026!",
      role: "front_desk",
      context: context("req-create-permission-target"),
    });

    const granted = await service.setSensitiveOperationsPermission({
      accountId: target.id,
      enabled: true,
      context: context("req-grant-sensitive"),
    });

    expect(granted.delegatedPermissions).toEqual([
      "sensitive_operations.execute",
    ]);
    const storedGrant = await database.query<{
      account_id: number;
      permission: string;
      granted_by: number;
      granted_at: Date;
    }>(
      `select account_id, permission, granted_by, granted_at
       from staff_account_permission_grants
       where account_id = $1`,
      [target.id],
    );
    expect(storedGrant.rows).toEqual([
      {
        account_id: target.id,
        permission: "sensitive_operations.execute",
        granted_by: adminId,
        granted_at: new Date("2026-08-25T01:00:00Z"),
      },
    ]);

    const revoked = await service.setSensitiveOperationsPermission({
      accountId: target.id,
      enabled: false,
      context: context("req-revoke-sensitive"),
    });

    expect(revoked.delegatedPermissions).toEqual([]);
    const remaining = await database.query<{ account_id: number }>(
      "select account_id from staff_account_permission_grants where account_id = $1",
      [target.id],
    );
    expect(remaining.rows).toEqual([]);
    const audits = await database.query<{ event_type: string }>(
      `select event_type
       from audit_events
       where request_id in ('req-grant-sensitive', 'req-revoke-sensitive')
       order by id`,
    );
    expect(audits.rows).toEqual([
      { event_type: "account.permission_granted" },
      { event_type: "account.permission_revoked" },
    ]);
  });

  it("never delegates the front-desk sensitive permission to another role", async () => {
    const owner = await service.createAccount({
      displayName: "老板只读",
      username: "owner.no-delegation",
      password: "Owner no delegation 2026!",
      role: "owner",
      context: context("req-create-owner-no-delegation"),
    });

    await expect(
      service.setSensitiveOperationsPermission({
        accountId: owner.id,
        enabled: true,
        context: context("req-invalid-owner-delegation"),
      }),
    ).rejects.toBeInstanceOf(DelegatedPermissionTargetError);

    const grants = await database.query<{ account_id: number }>(
      "select account_id from staff_account_permission_grants",
    );
    expect(grants.rows).toEqual([]);
  });

  it("bootstraps exactly one first super administrator without a default password", async () => {
    await database.query("delete from staff_accounts where id = $1", [adminId]);

    const bootstrapped = await service.bootstrapFirstSuperAdmin({
      displayName: "首位超级管理员",
      username: " First.Admin ",
      password: "First formal admin 2026!",
      context: {
        requestId: "req-bootstrap-first-admin",
        now: new Date("2026-08-25T01:00:00Z"),
        ipAddress: "127.0.0.1",
        userAgent: "bootstrap-cli",
      },
    });

    expect(bootstrapped).toMatchObject({
      normalizedUsername: "first.admin",
      role: "super_admin",
      isActive: true,
      mustChangePassword: true,
    });
    const stored = await database.query<{
      password_hash: string;
      created_by: number | null;
    }>(
      "select password_hash, created_by from staff_accounts where id = $1",
      [bootstrapped.id],
    );
    await expect(
      verifyPassword(stored.rows[0].password_hash, "First formal admin 2026!"),
    ).resolves.toBe(true);
    expect(stored.rows[0].created_by).toBeNull();
    const audit = await database.query<{
      event_type: string;
      actor_account_id: number | null;
    }>(
      "select event_type, actor_account_id from audit_events order by id",
    );
    expect(audit.rows).toEqual([
      { event_type: "account.bootstrap_created", actor_account_id: null },
    ]);

    await expect(
      service.bootstrapFirstSuperAdmin({
        displayName: "不应创建",
        username: "second.bootstrap",
        password: "Second bootstrap 2026!",
        context: {
          requestId: "req-bootstrap-second-admin",
          now: new Date("2026-08-25T01:01:00Z"),
        },
      }),
    ).rejects.toBeInstanceOf(SuperAdminAlreadyExistsError);
  });

  it("lists all accounts with their current durable delegated permissions", async () => {
    const frontDesk = await service.createAccount({
      displayName: "前台列表测试",
      username: "front.list",
      password: "Front list 2026!",
      role: "front_desk",
      context: context("req-create-list-target"),
    });
    await service.setSensitiveOperationsPermission({
      accountId: frontDesk.id,
      enabled: true,
      context: context("req-grant-list-target"),
    });

    const accounts = await service.listAccounts({ actorAccountId: adminId });

    expect(accounts).toEqual([
      {
        id: adminId,
        displayName: "超级管理员",
        normalizedUsername: "admin",
        role: "super_admin",
        isActive: true,
        mustChangePassword: false,
        sessionEpoch: 1,
        version: 1,
        delegatedPermissions: [],
      },
      {
        id: frontDesk.id,
        displayName: "前台列表测试",
        normalizedUsername: "front.list",
        role: "front_desk",
        isActive: true,
        mustChangePassword: true,
        sessionEpoch: 1,
        version: 2,
        delegatedPermissions: ["sensitive_operations.execute"],
      },
    ]);
  });

  it("removes a front-desk grant on role change and records that loss in the same audit", async () => {
    const frontDesk = await service.createAccount({
      displayName: "前台转角色",
      username: "front.role-change",
      password: "Front role change 2026!",
      role: "front_desk",
      context: context("req-create-role-change-target"),
    });
    await service.setSensitiveOperationsPermission({
      accountId: frontDesk.id,
      enabled: true,
      context: context("req-grant-before-role-change"),
    });

    const updated = await service.changeAccountRole({
      accountId: frontDesk.id,
      role: "owner",
      context: context("req-frontdesk-to-owner"),
    });

    expect(updated).toMatchObject({
      role: "owner",
      delegatedPermissions: [],
    });
    const grants = await database.query<{ account_id: number }>(
      "select account_id from staff_account_permission_grants where account_id = $1",
      [frontDesk.id],
    );
    expect(grants.rows).toEqual([]);
    const audit = await database.query<{
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
    }>(
      `select before_state, after_state
       from audit_events
       where request_id = 'req-frontdesk-to-owner'`,
    );
    expect(audit.rows).toEqual([
      {
        before_state: {
          displayName: "前台转角色",
          normalizedUsername: "front.role-change",
          role: "front_desk",
          isActive: true,
          mustChangePassword: true,
          sessionEpoch: 1,
          version: 2,
          delegatedPermissions: ["sensitive_operations.execute"],
        },
        after_state: {
          displayName: "前台转角色",
          normalizedUsername: "front.role-change",
          role: "owner",
          isActive: true,
          mustChangePassword: true,
          sessionEpoch: 2,
          version: 3,
          delegatedPermissions: [],
        },
      },
    ]);
  });
});
