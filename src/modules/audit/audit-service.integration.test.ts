import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import {
  AuditReadDeniedError,
  AuditService,
  writeAuditEvent,
} from "@formal/modules/audit/audit-service";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0001_account_permissions.sql"),
];

let database: PGlite;
let sqlDatabase: AuthSqlDatabase;

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

async function seedAccount(
  displayName: string,
  username: string,
  role: "super_admin" | "front_desk" | "owner" | "mechanic",
) {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role,
       must_change_password)
     values ($1, $2, 'test-hash', $3, false)
     returning id`,
    [displayName, username, role],
  );
  return Number(result.rows[0].id);
}

describe("AuditService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    sqlDatabase = createTestDatabase(database);
  });

  afterEach(async () => {
    await database.close();
  });

  it("stores sanitized immutable facts and returns them to authorized readers", async () => {
    const adminId = await seedAccount("超级管理员", "admin", "super_admin");
    const ownerId = await seedAccount("老板", "owner", "owner");
    const service = new AuditService(sqlDatabase);

    await writeAuditEvent(sqlDatabase, {
      occurredAt: new Date("2026-08-24T10:00:00Z"),
      actorAccountId: adminId,
      eventType: "account.password_reset",
      objectType: "staff_account",
      objectId: "2",
      reason: "failed to use postgres://admin:secret@database/formal",
      before: { passwordHash: "old-secret", sessionEpoch: 1 },
      after: { password: "new-secret", sessionEpoch: 2 },
      requestId: "req-audit-1",
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    });

    await writeAuditEvent(sqlDatabase, {
      occurredAt: new Date("2026-08-25T10:00:00Z"),
      actorAccountId: ownerId,
      eventType: "customer.dispute_opened",
      objectType: "vehicle",
      objectId: "VEH-202608-0001",
      reason: "客户对维修结果提出争议",
      after: { disputeStatus: "open" },
      requestId: "req-audit-2",
    });

    const stored = await database.query<{
      reason: string;
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
    }>(
      `select reason, before_state, after_state
       from audit_events
       where request_id = 'req-audit-1'`,
    );
    expect(stored.rows[0]).toEqual({
      reason: "[REDACTED]",
      before_state: { passwordHash: "[REDACTED]", sessionEpoch: 1 },
      after_state: { password: "[REDACTED]", sessionEpoch: 2 },
    });

    const page = await service.queryEvents({
      viewerAccountId: adminId,
      page: 1,
      pageSize: 25,
    });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.eventType)).toEqual([
      "customer.dispute_opened",
      "account.password_reset",
    ]);
    expect(page.items[1]).toMatchObject({
      actorDisplayName: "超级管理员",
      reason: "[REDACTED]",
      before: { passwordHash: "[REDACTED]", sessionEpoch: 1 },
    });

    const ownerPage = await service.queryEvents({
      viewerAccountId: ownerId,
      actorAccountId: ownerId,
      eventType: "customer.dispute_opened",
      objectId: "VEH-202608-0001",
      from: new Date("2026-08-25T00:00:00Z"),
      toExclusive: new Date("2026-08-26T00:00:00Z"),
    });
    expect(ownerPage.items).toHaveLength(1);
    expect(ownerPage.items[0].actorDisplayName).toBe("老板");

    await expect(
      service.listActors({ viewerAccountId: ownerId }),
    ).resolves.toEqual([
      { id: ownerId, displayName: "老板", username: "owner" },
      { id: adminId, displayName: "超级管理员", username: "admin" },
    ]);
  });

  it("rejects front-desk and mechanic readers even when called outside the page", async () => {
    const frontDeskId = await seedAccount("前台", "front", "front_desk");
    const mechanicId = await seedAccount("维修工", "mechanic", "mechanic");
    const service = new AuditService(sqlDatabase);

    await expect(
      service.queryEvents({ viewerAccountId: frontDeskId }),
    ).rejects.toBeInstanceOf(AuditReadDeniedError);
    await expect(
      service.queryEvents({ viewerAccountId: mechanicId }),
    ).rejects.toBeInstanceOf(AuditReadDeniedError);
  });

  it("paginates without returning an unbounded audit history", async () => {
    const adminId = await seedAccount("超级管理员", "admin", "super_admin");
    const service = new AuditService(sqlDatabase);

    for (let index = 0; index < 3; index += 1) {
      await writeAuditEvent(sqlDatabase, {
        occurredAt: new Date(`2026-08-24T0${index}:00:00Z`),
        actorAccountId: adminId,
        eventType: "test.event",
        objectType: "test_object",
        objectId: String(index),
        requestId: `req-page-${index}`,
      });
    }

    const page = await service.queryEvents({
      viewerAccountId: adminId,
      page: 2,
      pageSize: 2,
    });
    expect(page.total).toBe(3);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(2);
    expect(page.pageCount).toBe(2);
    expect(page.items.map((item) => item.objectId)).toEqual(["0"]);
  });
});
