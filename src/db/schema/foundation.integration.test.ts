import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "drizzle/0000_foundation.sql");

let database: PGlite;

async function applyFoundationMigration() {
  const sql = await readFile(migrationPath, "utf8");
  await database.exec(sql);
}

async function createAccount(options?: {
  username?: string;
  role?: "super_admin" | "front_desk" | "owner" | "mechanic";
  isActive?: boolean;
}) {
  const username = options?.username ?? "superadmin";
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, is_active)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      "超级管理员",
      username,
      "argon2id-hash-placeholder",
      options?.role ?? "super_admin",
      options?.isActive ?? true,
    ],
  );

  return result.rows[0].id;
}

describe("foundation PostgreSQL migration", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyFoundationMigration();
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates the account, session and audit fact tables", async () => {
    const result = await database.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in ('staff_accounts', 'auth_sessions', 'audit_events')
       order by table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "audit_events",
      "auth_sessions",
      "staff_accounts",
    ]);
  });

  it("enforces normalized username uniqueness", async () => {
    await createAccount({ username: "frontdesk" });

    await expect(
      createAccount({ username: "frontdesk", role: "front_desk" }),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("only accepts the four confirmed account roles", async () => {
    await expect(
      database.query(
        `insert into staff_accounts
          (display_name, normalized_username, password_hash, role)
         values ('Unknown', 'unknown', 'hash', 'parts_manager')`,
      ),
    ).rejects.toThrow(/account_role|invalid input value/i);
  });

  it("prevents inactive accounts from receiving a new session", async () => {
    const accountId = await createAccount({
      username: "inactive",
      isActive: false,
    });

    await expect(
      database.query(
        `insert into auth_sessions
          (account_id, token_hash, session_epoch, expires_at)
         values ($1, 'token-hash-inactive', 1, now() + interval '12 hours')`,
        [accountId],
      ),
    ).rejects.toThrow(/inactive account/i);
  });

  it("enforces a unique session token hash", async () => {
    const accountId = await createAccount({ username: "session-owner" });

    await database.query(
      `insert into auth_sessions
        (account_id, token_hash, session_epoch, expires_at)
       values ($1, 'same-token-hash', 1, now() + interval '12 hours')`,
      [accountId],
    );

    await expect(
      database.query(
        `insert into auth_sessions
          (account_id, token_hash, session_epoch, expires_at)
         values ($1, 'same-token-hash', 1, now() + interval '12 hours')`,
        [accountId],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("stores audit JSON while preventing updates and deletes", async () => {
    const actorId = await createAccount({ username: "auditor" });
    const inserted = await database.query<{ id: number }>(
      `insert into audit_events
        (actor_account_id, event_type, object_type, object_id, reason,
         before_state, after_state, request_id)
       values ($1, 'account.role_changed', 'staff_account', $2, '授权调整',
         '{"role":"front_desk"}'::jsonb,
         '{"role":"owner"}'::jsonb,
         'req_00000000-0000-4000-8000-000000000001')
       returning id`,
      [actorId, String(actorId)],
    );
    const auditId = inserted.rows[0].id;

    const stored = await database.query<{
      before_role: string;
      after_role: string;
    }>(
      `select before_state ->> 'role' as before_role,
              after_state ->> 'role' as after_role
       from audit_events
       where id = $1`,
      [auditId],
    );

    expect(stored.rows[0]).toEqual({
      before_role: "front_desk",
      after_role: "owner",
    });
    await expect(
      database.query("update audit_events set reason = 'changed' where id = $1", [
        auditId,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      database.query("delete from audit_events where id = $1", [auditId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("indexes every account foreign key used for joins and lifecycle checks", async () => {
    const result = await database.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'staff_accounts_created_by_idx',
           'auth_sessions_account_id_idx',
           'audit_events_actor_occurred_at_idx'
         )
       order by indexname`,
    );

    expect(result.rows.map((row) => row.indexname)).toEqual([
      "audit_events_actor_occurred_at_idx",
      "auth_sessions_account_id_idx",
      "staff_accounts_created_by_idx",
    ]);
  });
});
