import type {
  AuthAccountRecord,
  AuthRepository,
  AuthSessionRecord,
  LoginAuditRecord,
  NewLoginSession,
} from "@/modules/auth/auth-service";

export interface AuthSqlExecutor {
  query<Row extends Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>;
}

export interface AuthSqlDatabase extends AuthSqlExecutor {
  transaction<Result>(
    callback: (transaction: AuthSqlExecutor) => Promise<Result>,
  ): Promise<Result>;
}

type AccountRow = {
  id: number;
  display_name: string;
  normalized_username: string;
  password_hash: string;
  role: AuthAccountRecord["role"];
  is_active: boolean;
  must_change_password: boolean;
  session_epoch: number;
};

type SessionRow = {
  id: number;
  account_id: number;
  token_hash: string;
  session_epoch: number;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  account_display_name: string;
  account_normalized_username: string;
  account_password_hash: string;
  account_role: AuthAccountRecord["role"];
  account_is_active: boolean;
  account_must_change_password: boolean;
  account_session_epoch: number;
};

export class DatabaseAuthRepository implements AuthRepository {
  constructor(private readonly database: AuthSqlDatabase) {}

  async findAccountByNormalizedUsername(
    normalizedUsername: string,
  ): Promise<AuthAccountRecord | null> {
    const rows = await this.database.query<AccountRow>(
      `select id, display_name, normalized_username, password_hash, role,
              is_active, must_change_password, session_epoch
       from staff_accounts
       where normalized_username = $1
       limit 1`,
      [normalizedUsername],
    );

    return rows[0] ? mapAccount(rows[0]) : null;
  }

  async countRecentLoginFailures(
    normalizedUsername: string,
    ipAddress: string | null,
    since: Date,
  ): Promise<number> {
    const rows = await this.database.query<{ failure_count: number }>(
      `select count(*)::integer as failure_count
       from audit_events as failure
       where failure.event_type = 'auth.login_failed'
         and failure.object_type = 'login_identity'
         and failure.object_id = $1
         and failure.ip_address is not distinct from $2::inet
         and failure.occurred_at >= $3
         and failure.occurred_at > coalesce(
           (
             select max(success.occurred_at)
             from audit_events as success
             where success.event_type = 'auth.login_succeeded'
               and success.object_type = 'login_identity'
               and success.object_id = $1
               and success.ip_address is not distinct from $2::inet
               and success.occurred_at >= $3
           ),
           $3
         )`,
      [normalizedUsername, ipAddress, since],
    );

    return rows[0]?.failure_count ?? 0;
  }

  async recordLoginAudit(audit: LoginAuditRecord): Promise<void> {
    await insertLoginAudit(this.database, audit);
  }

  async createLoginSession(input: NewLoginSession): Promise<AuthSessionRecord> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `insert into auth_sessions
          (account_id, token_hash, session_epoch, created_at, last_seen_at,
           expires_at, ip_address, user_agent)
         values ($1, $2, $3, $4, $4, $5, $6::inet, $7)`,
        [
          input.accountId,
          input.tokenHash,
          input.sessionEpoch,
          input.createdAt,
          input.expiresAt,
          input.ipAddress,
          input.userAgent,
        ],
      );
      await insertLoginAudit(transaction, input.audit);

      const session = await selectSession(transaction, input.tokenHash);
      if (!session) {
        throw new Error("会话创建后无法读取");
      }
      return session;
    });
  }

  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    return selectSession(this.database, tokenHash);
  }

  async refreshSessionActivity(tokenHash: string, lastSeenAt: Date): Promise<void> {
    await this.database.query(
      `update auth_sessions
       set last_seen_at = $2
       where token_hash = $1
         and revoked_at is null
         and expires_at > $2
         and last_seen_at < $2`,
      [tokenHash, lastSeenAt],
    );
  }

  async revokeSession(
    tokenHash: string,
    revokedAt: Date,
    audit: LoginAuditRecord,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction.query<{ id: number }>(
        `update auth_sessions
         set revoked_at = $2
         where token_hash = $1
           and revoked_at is null
         returning id`,
        [tokenHash, revokedAt],
      );
      if (updated.length === 0) return;
      await insertLoginAudit(transaction, audit);
    });
  }
}

async function insertLoginAudit(
  executor: AuthSqlExecutor,
  audit: LoginAuditRecord,
): Promise<void> {
  await executor.query(
    `insert into audit_events
      (occurred_at, actor_account_id, event_type, object_type, object_id,
       request_id, ip_address, user_agent)
     values ($1, $2, $3, 'login_identity', $4, $5, $6::inet, $7)`,
    [
      audit.occurredAt,
      audit.accountId,
      audit.eventType,
      audit.normalizedUsername,
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
    ],
  );
}

async function selectSession(
  executor: AuthSqlExecutor,
  tokenHash: string,
): Promise<AuthSessionRecord | null> {
  const rows = await executor.query<SessionRow>(
    `select session.id, session.account_id, session.token_hash,
            session.session_epoch, session.created_at, session.last_seen_at,
            session.expires_at, session.revoked_at,
            account.display_name as account_display_name,
            account.normalized_username as account_normalized_username,
            account.password_hash as account_password_hash,
            account.role as account_role,
            account.is_active as account_is_active,
            account.must_change_password as account_must_change_password,
            account.session_epoch as account_session_epoch
     from auth_sessions as session
     join staff_accounts as account on account.id = session.account_id
     where session.token_hash = $1
     limit 1`,
    [tokenHash],
  );

  return rows[0] ? mapSession(rows[0]) : null;
}

function mapAccount(row: AccountRow): AuthAccountRecord {
  return {
    id: Number(row.id),
    displayName: row.display_name,
    normalizedUsername: row.normalized_username,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    sessionEpoch: row.session_epoch,
  };
}

function mapSession(row: SessionRow): AuthSessionRecord {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    tokenHash: row.token_hash,
    sessionEpoch: row.session_epoch,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    account: {
      id: Number(row.account_id),
      displayName: row.account_display_name,
      normalizedUsername: row.account_normalized_username,
      passwordHash: row.account_password_hash,
      role: row.account_role,
      isActive: row.account_is_active,
      mustChangePassword: row.account_must_change_password,
      sessionEpoch: row.account_session_epoch,
    },
  };
}
