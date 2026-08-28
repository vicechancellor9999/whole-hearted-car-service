import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { RecordDeletionService } from "@formal/modules/record-deletion/record-deletion-service";

const migrationDirectory = resolve(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDirectory)
  .filter((path) => /^\d{4}_.+\.sql$/.test(path))
  .sort()
  .map((path) => resolve(migrationDirectory, path));

let database: PGlite;
let service: RecordDeletionService;
let frontDeskId: number;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      return (await source.query<Row>(text, [...parameters])).rows;
    },
  };
}

function testDatabase(source: PGlite): AuthSqlDatabase {
  return {
    ...executor(source),
    transaction(callback) {
      return source.transaction((transaction) => callback(executor(transaction)));
    },
  };
}

async function seedFixture(sequence: number) {
  const suffix = String(sequence).padStart(4, "0");
  const account = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ('前台删除', 'front-delete', 'test-hash', 'front_desk', false)
     returning id`,
  );
  frontDeskId = Number(account.rows[0]?.id);
  const customer = await database.query<{ id: number }>(
    `insert into personal_customers
      (customer_no, full_name, normalized_phone, trn, created_by)
     values ($1, '待删除客户', '+18765550101', '123456789', $2)
     returning id`,
    [`CUST-202608-${suffix}`, frontDeskId],
  );
  const customerId = Number(customer.rows[0]?.id);
  const vehicle = await database.query<{ id: number }>(
    `insert into vehicles
      (vehicle_no, plate_display, normalized_plate, vin, make, model,
       current_person_customer_id, created_by)
     values ($1, 'DEL 101', 'DEL101', $2, 'Test', 'Delete', $3, $4)
     returning id`,
    [`VEH-202608-${suffix}`, `VINDELETE${suffix}`, customerId, frontDeskId],
  );
  const vehicleId = Number(vehicle.rows[0]?.id);
  await database.query(
    `insert into vehicle_owner_history
      (vehicle_id, person_customer_id, changed_by)
     values ($1, $2, $3)`,
    [vehicleId, customerId, frontDeskId],
  );
  return {
    customerId,
    customerNo: `CUST-202608-${suffix}`,
    vehicleId,
    vehicleNo: `VEH-202608-${suffix}`,
  };
}

describe("RecordDeletionService execute", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
  });

  beforeEach(async () => {
    await database.exec(
      "truncate table customer_phone_registry, customer_trn_registry, staff_accounts restart identity cascade",
    );
    service = new RecordDeletionService(testDatabase(database));
  });

  afterAll(async () => database.close());

  it("deletes a selected customer and vehicle in reverse dependency order and replays safely", async () => {
    const fixture = await seedFixture(1);
    const selectedRecords = [
      { kind: "personal_customer" as const, recordNo: fixture.customerNo },
      { kind: "vehicle" as const, recordNo: fixture.vehicleNo },
    ];
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root: selectedRecords[0],
      selectedRecords,
    });
    const input = {
      actorAccountId: frontDeskId,
      root: selectedRecords[0],
      selectedRecords,
      reasonCode: "test_data" as const,
      reasonNote: null,
      confirmationRecordNo: fixture.customerNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-execute-1",
      now: new Date("2026-08-27T15:00:00Z"),
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    };

    const first = await service.execute(input);
    const replay = await service.execute(input);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      requestId: input.requestId,
      deletedRecords: expect.arrayContaining(selectedRecords),
      releasedIdentityKinds: ["phone", "trn", "plate", "vin"],
    });

    const counts = await database.query<{
      customers: number;
      vehicles: number;
      histories: number;
    }>(
      `select
        (select count(*)::int from personal_customers) as customers,
        (select count(*)::int from vehicles) as vehicles,
        (select count(*)::int from vehicle_owner_history) as histories`,
    );
    expect(counts.rows[0]).toMatchObject({ customers: 0, vehicles: 0, histories: 0 });

    await expect(database.query(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, trn, created_by)
       values ('CUST-202608-9001', '复用身份', '+18765550101', '123456789', $1)`,
      [frontDeskId],
    )).resolves.toMatchObject({ affectedRows: 1 });

    const audit = await database.query<{ serialized: string }>(
      `select concat_ws(' ', reason, before_state::text, after_state::text) as serialized
       from audit_events where request_id = $1 and event_type = 'record.deleted'`,
      [input.requestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.serialized.toLowerCase()).not.toMatch(
      /full_name|phone|trn|plate|vin|address|待删除客户|del101|123456789/,
    );
  });

  it("rejects a stale preview without deleting anything", async () => {
    const fixture = await seedFixture(2);
    const root = { kind: "vehicle" as const, recordNo: fixture.vehicleNo };
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
    });
    await database.query(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, vehicle_plate_snapshot,
         vehicle_description_snapshot, created_by)
       values ('KGN-WH-2026082700002', $1, $2, '付款人', 'DEL 101',
               'Test Delete', $3)`,
      [fixture.vehicleId, fixture.customerId, frontDeskId],
    );

    await expect(service.execute({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
      reasonCode: "input_error",
      reasonNote: null,
      confirmationRecordNo: fixture.vehicleNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-stale-2",
    })).rejects.toMatchObject({ code: "DELETION_PREVIEW_STALE", status: 409 });

    const remaining = await database.query<{ count: number }>(
      `select count(*)::int as count from vehicles where id = $1`,
      [fixture.vehicleId],
    );
    expect(Number(remaining.rows[0]?.count)).toBe(1);
  });

  it("rejects reuse of a request number with a different payload", async () => {
    const fixture = await seedFixture(3);
    const root = { kind: "vehicle" as const, recordNo: fixture.vehicleNo };
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
    });
    const input = {
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
      reasonCode: "duplicate" as const,
      reasonNote: null,
      confirmationRecordNo: fixture.vehicleNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-conflict-3",
    };
    await service.execute(input);
    await expect(service.execute({ ...input, reasonCode: "test_data" }))
      .rejects.toMatchObject({ code: "DELETION_REQUEST_CONFLICT", status: 409 });
  });
});
