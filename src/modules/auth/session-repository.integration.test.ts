import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAuthRepository,
  type AuthSqlDatabase,
  type AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0001_account_permissions.sql"),
  resolve(process.cwd(), "drizzle/0037_staff_account_ui_language.sql"),
];
let database: PGlite;
let repository: DatabaseAuthRepository;
let accountId: number;

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

describe("DatabaseAuthRepository", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    const inserted = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role,
         is_active, must_change_password, session_epoch)
       values ('超级管理员', 'admin', 'argon2id-hash', 'super_admin', true, true, 1)
       returning id`,
    );
    accountId = inserted.rows[0].id;
    repository = new DatabaseAuthRepository(createTestDatabase(database));
  });

  afterEach(async () => {
    await database.close();
  });

  it("reads an account and creates the session and success audit atomically", async () => {
    const account = await repository.findAccountByNormalizedUsername("admin");
    const createdAt = new Date("2026-08-25T00:00:00.000Z");

    const session = await repository.createLoginSession({
      accountId,
      tokenHash: "token-hash-1",
      sessionEpoch: 1,
      createdAt,
      expiresAt: new Date("2026-08-25T12:00:00.000Z"),
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
      audit: {
        eventType: "auth.login_succeeded",
        normalizedUsername: "admin",
        accountId,
        occurredAt: createdAt,
        requestId: "req-login-success",
        ipAddress: "127.0.0.1",
        userAgent: "Vitest",
      },
    });

    expect(account).toMatchObject({
      id: accountId,
      normalizedUsername: "admin",
      role: "super_admin",
      isActive: true,
    });
    expect(session).toMatchObject({
      accountId,
      tokenHash: "token-hash-1",
      account: { normalizedUsername: "admin" },
    });
    await expect(
      repository.findSessionByTokenHash("token-hash-1"),
    ).resolves.toMatchObject({ accountId, revokedAt: null });
    const audits = await database.query<{ event_type: string }>(
      "select event_type from audit_events order by id",
    );
    expect(audits.rows).toEqual([{ event_type: "auth.login_succeeded" }]);

    const lastSeenAt = new Date("2026-08-25T01:00:00.000Z");
    await repository.refreshSessionActivity("token-hash-1", lastSeenAt);
    await expect(
      repository.findSessionByTokenHash("token-hash-1"),
    ).resolves.toMatchObject({ lastSeenAt });
  });

  it("counts only failures after the latest successful login in the active window", async () => {
    const common = {
      normalizedUsername: "admin",
      accountId,
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    } as const;
    await repository.recordLoginAudit({
      ...common,
      eventType: "auth.login_failed",
      occurredAt: new Date("2026-08-25T00:01:00Z"),
      requestId: "req-fail-1",
    });
    await repository.recordLoginAudit({
      ...common,
      eventType: "auth.login_succeeded",
      occurredAt: new Date("2026-08-25T00:02:00Z"),
      requestId: "req-success",
    });
    await repository.recordLoginAudit({
      ...common,
      eventType: "auth.login_failed",
      occurredAt: new Date("2026-08-25T00:03:00Z"),
      requestId: "req-fail-2",
    });

    await expect(
      repository.countRecentLoginFailures(
        "admin",
        "127.0.0.1",
        new Date("2026-08-25T00:00:00Z"),
      ),
    ).resolves.toBe(1);
  });

  it("revokes a session and records logout in one transaction", async () => {
    const createdAt = new Date("2026-08-25T00:00:00Z");
    await repository.createLoginSession({
      accountId,
      tokenHash: "token-hash-logout",
      sessionEpoch: 1,
      createdAt,
      expiresAt: new Date("2026-08-25T12:00:00Z"),
      ipAddress: null,
      userAgent: null,
      audit: {
        eventType: "auth.login_succeeded",
        normalizedUsername: "admin",
        accountId,
        occurredAt: createdAt,
        requestId: "req-login",
        ipAddress: null,
        userAgent: null,
      },
    });
    const revokedAt = new Date("2026-08-25T01:00:00Z");

    await repository.revokeSession("token-hash-logout", revokedAt, {
      eventType: "auth.logout",
      normalizedUsername: "admin",
      accountId,
      occurredAt: revokedAt,
      requestId: "req-logout",
      ipAddress: null,
      userAgent: null,
    });

    await expect(
      repository.findSessionByTokenHash("token-hash-logout"),
    ).resolves.toMatchObject({ revokedAt });
    const audits = await database.query<{ event_type: string }>(
      "select event_type from audit_events order by id",
    );
    expect(audits.rows).toEqual([
      { event_type: "auth.login_succeeded" },
      { event_type: "auth.logout" },
    ]);
  });

  it("loads delegated permissions from the database on every session read", async () => {
    const inserted = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role,
         is_active, must_change_password, session_epoch)
       values ('前台', 'frontdesk', 'argon2id-hash', 'front_desk', true, true, 1)
       returning id`,
    );
    const frontDeskId = inserted.rows[0].id;
    await database.query(
      `insert into staff_account_permission_grants
        (account_id, permission, granted_by)
       values ($1, 'sensitive_operations.execute', $2)`,
      [frontDeskId, accountId],
    );
    const createdAt = new Date("2026-08-25T00:00:00Z");
    await repository.createLoginSession({
      accountId: frontDeskId,
      tokenHash: "frontdesk-delegated-session",
      sessionEpoch: 1,
      createdAt,
      expiresAt: new Date("2026-08-25T12:00:00Z"),
      ipAddress: null,
      userAgent: null,
      audit: {
        eventType: "auth.login_succeeded",
        normalizedUsername: "frontdesk",
        accountId: frontDeskId,
        occurredAt: createdAt,
        requestId: "req-frontdesk-login",
        ipAddress: null,
        userAgent: null,
      },
    });

    await expect(
      repository.findSessionByTokenHash("frontdesk-delegated-session"),
    ).resolves.toMatchObject({
      account: {
        delegatedPermissions: ["sensitive_operations.execute"],
      },
    });

    await database.query(
      "delete from staff_account_permission_grants where account_id = $1",
      [frontDeskId],
    );
    await expect(
      repository.findSessionByTokenHash("frontdesk-delegated-session"),
    ).resolves.toMatchObject({
      account: { delegatedPermissions: [] },
    });
  });
});
