import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import { redactSensitive } from "@/modules/audit/redact-sensitive";

export type AuditEventRecord = {
  id: number;
  occurredAt: Date;
  actorAccountId: number | null;
  actorDisplayName: string | null;
  actorUsername: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type AuditEventPage = {
  items: AuditEventRecord[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export type AuditActorOption = {
  id: number;
  displayName: string;
  username: string;
};

export type NewAuditEvent = {
  occurredAt?: Date;
  actorAccountId: number | null;
  eventType: string;
  objectType: string;
  objectId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type AuditRow = {
  id: number;
  occurred_at: Date;
  actor_account_id: number | null;
  actor_display_name: string | null;
  actor_username: string | null;
  event_type: string;
  object_type: string;
  object_id: string;
  reason: string | null;
  before_state: Record<string, unknown> | string | null;
  after_state: Record<string, unknown> | string | null;
  request_id: string;
  ip_address: string | null;
  user_agent: string | null;
};

export class AuditReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "audit_read_denied";

  constructor() {
    super("只有超级管理员和老板只读账号可以查看审计记录");
    this.name = "AuditReadDeniedError";
  }
}

export async function writeAuditEvent(
  executor: AuthSqlExecutor,
  input: NewAuditEvent,
): Promise<void> {
  const reason = input.reason == null
    ? null
    : redactSensitive(input.reason);
  const before = input.before == null
    ? null
    : redactSensitive(input.before);
  const after = input.after == null
    ? null
    : redactSensitive(input.after);

  await executor.query(
    `insert into audit_events
      (occurred_at, actor_account_id, event_type, object_type, object_id,
       reason, before_state, after_state, request_id, ip_address, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::inet, $11)`,
    [
      input.occurredAt ?? new Date(),
      input.actorAccountId,
      input.eventType,
      input.objectType,
      input.objectId,
      reason,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      input.requestId,
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
  );
}

export class AuditService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async queryEvents(input: {
    viewerAccountId: number;
    from?: Date;
    toExclusive?: Date;
    actorAccountId?: number;
    eventType?: string;
    objectId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AuditEventPage> {
    await requireAuditReader(this.database, input.viewerAccountId);

    const page = toPositiveInteger(input.page, 1);
    const pageSize = Math.min(toPositiveInteger(input.pageSize, 25), 100);
    const parameters: unknown[] = [];
    const conditions: string[] = [];

    const addCondition = (sql: string, value: unknown) => {
      parameters.push(value);
      conditions.push(sql.replace("?", `$${parameters.length}`));
    };

    if (input.from) addCondition("event.occurred_at >= ?", input.from);
    if (input.toExclusive) {
      addCondition("event.occurred_at < ?", input.toExclusive);
    }
    if (input.actorAccountId) {
      addCondition("event.actor_account_id = ?", input.actorAccountId);
    }
    if (input.eventType?.trim()) {
      addCondition("event.event_type = ?", input.eventType.trim());
    }
    if (input.objectId?.trim()) {
      addCondition("event.object_id = ?", input.objectId.trim());
    }

    const where = conditions.length > 0
      ? `where ${conditions.join(" and ")}`
      : "";
    const counts = await this.database.query<{ total: number }>(
      `select count(*)::integer as total
       from audit_events as event
       ${where}`,
      parameters,
    );
    const total = Number(counts[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, pageCount);
    const offsetParameter = parameters.length + 1;
    const limitParameter = parameters.length + 2;
    const rows = await this.database.query<AuditRow>(
      `select event.id, event.occurred_at, event.actor_account_id,
              actor.display_name as actor_display_name,
              actor.normalized_username as actor_username,
              event.event_type, event.object_type, event.object_id,
              event.reason, event.before_state, event.after_state,
              event.request_id, event.ip_address::text as ip_address,
              event.user_agent
       from audit_events as event
       left join staff_accounts as actor on actor.id = event.actor_account_id
       ${where}
       order by event.occurred_at desc, event.id desc
       offset $${offsetParameter}
       limit $${limitParameter}`,
      [...parameters, (effectivePage - 1) * pageSize, pageSize],
    );

    return {
      items: rows.map(mapAuditRow),
      page: effectivePage,
      pageSize,
      pageCount,
      total,
    };
  }

  async listActors(input: {
    viewerAccountId: number;
  }): Promise<AuditActorOption[]> {
    await requireAuditReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      id: number;
      display_name: string;
      normalized_username: string;
    }>(
      `select distinct actor.id, actor.display_name, actor.normalized_username
       from staff_accounts as actor
       join audit_events as event on event.actor_account_id = actor.id
       order by actor.display_name, actor.id`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      displayName: row.display_name,
      username: row.normalized_username,
    }));
  }
}

async function requireAuditReader(
  executor: AuthSqlExecutor,
  accountId: number,
): Promise<void> {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed
     from staff_accounts
     where id = $1
       and is_active = true
       and role in ('super_admin', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]?.allowed) throw new AuditReadDeniedError();
}

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return fallback;
  return value as number;
}

function parseState(
  value: Record<string, unknown> | string | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return redactSensitive(parsed);
}

function mapAuditRow(row: AuditRow): AuditEventRecord {
  return {
    id: Number(row.id),
    occurredAt: new Date(row.occurred_at),
    actorAccountId: row.actor_account_id == null
      ? null
      : Number(row.actor_account_id),
    actorDisplayName: row.actor_display_name,
    actorUsername: row.actor_username,
    eventType: row.event_type,
    objectType: row.object_type,
    objectId: row.object_id,
    reason: row.reason == null ? null : redactSensitive(row.reason),
    before: parseState(row.before_state),
    after: parseState(row.after_state),
    requestId: row.request_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}
