import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { RecordDeletionService } from "@formal/modules/record-deletion/record-deletion-service";

const migrationDirectory = resolve(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDirectory)
  .filter((path) => /^\d{4}_.+\.sql$/.test(path))
  .sort()
  .map((path) => resolve(migrationDirectory, path));

let database: PGlite;
let service: RecordDeletionService;
let frontDeskId: number;
let ownerId: number;

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

async function seedAccount(username: string, role: string): Promise<number> {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ($1, $1, 'test-hash', $2::account_role, false)
     returning id`,
    [username, role],
  );
  return Number(result.rows[0]?.id);
}

async function seedCustomerAndVehicle(sequence: number): Promise<{
  customerNo: string;
  vehicleNo: string;
  customerId: number;
  vehicleId: number;
}> {
  const suffix = String(sequence).padStart(4, "0");
  const customerNo = `CUST-202608-${suffix}`;
  const vehicleNo = `VEH-202608-${suffix}`;
  const customer = await database.query<{ id: number }>(
    `insert into personal_customers (customer_no, full_name, created_by)
     values ($1, $2, $3) returning id`,
    [customerNo, `删除预览客户${sequence}`, frontDeskId],
  );
  const customerId = Number(customer.rows[0]?.id);
  const vehicle = await database.query<{ id: number }>(
    `insert into vehicles
      (vehicle_no, plate_display, normalized_plate, make, model,
       current_person_customer_id, created_by)
     values ($1, $2, $2, 'Test', 'Preview', $3, $4)
     returning id`,
    [vehicleNo, `PREVIEW${sequence}`, customerId, frontDeskId],
  );
  const vehicleId = Number(vehicle.rows[0]?.id);
  await database.query(
    `insert into vehicle_owner_history
      (vehicle_id, person_customer_id, changed_by)
     values ($1, $2, $3)`,
    [vehicleId, customerId, frontDeskId],
  );
  return { customerNo, vehicleNo, customerId, vehicleId };
}

describe("RecordDeletionService preview", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
  });

  beforeEach(async () => {
    await database.exec("truncate table staff_accounts restart identity cascade");
    frontDeskId = await seedAccount("front-delete", "front_desk");
    ownerId = await seedAccount("owner-readonly", "owner");
    service = new RecordDeletionService(testDatabase(database));
  });

  afterAll(async () => database.close());

  it("reads only the initiating account's committed deletion receipt without changing records or audit", async () => {
    const fixture = await seedCustomerAndVehicle(9);
    const root = { kind: "vehicle", recordNo: fixture.vehicleNo };
    const result = { requestId: "delete-read-receipt-1", root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 };
    await database.query(`insert into record_deletion_receipts (request_id, actor_account_id, payload_hash, root_kind, root_record_no, reason_code, result, created_at) values ($1,$2,$3,'vehicle',$4,'test_data',$5::jsonb,now())`, [result.requestId, frontDeskId, "a".repeat(64), fixture.vehicleNo, JSON.stringify(result)]);
    const before = await database.query("select count(*)::int as count from audit_events");
    await expect(service.readResult({ requestId: result.requestId, actorAccountId: frontDeskId })).resolves.toEqual(result);
    const another = await seedAccount("another-front", "front_desk");
    await expect(service.readResult({ requestId: result.requestId, actorAccountId: another })).resolves.toBeNull();
    await expect(service.readResult({ requestId: "delete-not-committed", actorAccountId: frontDeskId })).resolves.toBeNull();
    expect((await database.query("select count(*)::int as count from audit_events")).rows).toEqual(before.rows);
    expect((await database.query("select id from vehicles where id=$1", [fixture.vehicleId])).rows).toHaveLength(1);
  });

  it("denies receipt lookup without deletion permission", async () => {
    await expect(service.readResult({ requestId: "delete-read-receipt-1", actorAccountId: ownerId })).rejects.toMatchObject({ status: 403 });
  });

  it("previews an unused vehicle as eligible for front desk", async () => {
    const fixture = await seedCustomerAndVehicle(1);

    await expect(service.preview({
      actorAccountId: frontDeskId,
      root: { kind: "vehicle", recordNo: fixture.vehicleNo },
      selectedRecords: [{ kind: "vehicle", recordNo: fixture.vehicleNo }],
    })).resolves.toMatchObject({
      eligible: true,
      rootRecord: { kind: "vehicle", recordNo: fixture.vehicleNo },
      dependentCounts: { vehicle_owner_history: 1 },
      releasedIdentityKinds: ["plate"],
      blockers: [],
    });
  });

  it("requires an explicitly selected linked vehicle when deleting a customer", async () => {
    const fixture = await seedCustomerAndVehicle(2);

    const blocked = await service.preview({
      actorAccountId: frontDeskId,
      root: { kind: "personal_customer", recordNo: fixture.customerNo },
      selectedRecords: [{ kind: "personal_customer", recordNo: fixture.customerNo }],
    });
    expect(blocked).toMatchObject({
      eligible: false,
      selectableLinkedRecords: [
        { kind: "vehicle", recordNo: fixture.vehicleNo },
      ],
      blockers: [expect.objectContaining({ code: "HAS_VEHICLE" })],
    });

    await expect(service.preview({
      actorAccountId: frontDeskId,
      root: { kind: "personal_customer", recordNo: fixture.customerNo },
      selectedRecords: [
        { kind: "personal_customer", recordNo: fixture.customerNo },
        { kind: "vehicle", recordNo: fixture.vehicleNo },
      ],
    })).resolves.toMatchObject({ eligible: true, blockers: [] });
  });

  it("shows an unused business order as a linked blocker on its vehicle", async () => {
    const fixture = await seedCustomerAndVehicle(3);
    const order = await database.query<{ id: number }>(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, vehicle_plate_snapshot,
         vehicle_description_snapshot, created_by)
       values ('KGN-WH-2026082700001', $1, $2, '测试付款人', 'PREVIEW3',
               'Test Preview', $3)
       returning id`,
      [fixture.vehicleId, fixture.customerId, frontDeskId],
    );
    await database.query(
      `insert into repair_rounds
        (business_order_id, round_no, source, status, created_by)
       values ($1, 1, 'initial', 'waiting_assignment', $2)`,
      [Number(order.rows[0]?.id), frontDeskId],
    );

    await expect(service.preview({
      actorAccountId: frontDeskId,
      root: { kind: "vehicle", recordNo: fixture.vehicleNo },
      selectedRecords: [{ kind: "vehicle", recordNo: fixture.vehicleNo }],
    })).resolves.toMatchObject({
      eligible: false,
      selectableLinkedRecords: [
        { kind: "business_order", recordNo: "KGN-WH-2026082700001" },
      ],
      blockers: [expect.objectContaining({ code: "HAS_BUSINESS_ORDER" })],
    });
  });

  it("denies unprivileged accounts and reports missing public records", async () => {
    const fixture = await seedCustomerAndVehicle(4);
    await expect(service.preview({
      actorAccountId: ownerId,
      root: { kind: "vehicle", recordNo: fixture.vehicleNo },
      selectedRecords: [{ kind: "vehicle", recordNo: fixture.vehicleNo }],
    })).rejects.toMatchObject({
      code: "RECORD_DELETE_DENIED",
      status: 403,
    });

    await expect(service.preview({
      actorAccountId: frontDeskId,
      root: { kind: "vehicle", recordNo: "VEH-202608-9999" },
      selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-9999" }],
    })).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
      status: 404,
    });
  });
});
