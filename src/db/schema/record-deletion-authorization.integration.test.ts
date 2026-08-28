import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDirectory)
  .filter((path) => /^\d{4}_.+\.sql$/.test(path))
  .sort()
  .map((path) => resolve(migrationDirectory, path));

let database: PGlite;
let adminId: number;
let firstOwnerHistoryId: number;
let secondOwnerHistoryId: number;
let orphanCustomerId: number;
let orphanVehicleId: number;

async function startDeletionRequest(requestId: string, authorizedRowId?: number) {
  await database.exec("begin");
  await database.query(
    `insert into record_deletion_receipts
      (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
       reason_code, result)
     values ($1, $2, $3, 'vehicle', 'VEH-202608-0001',
             'test_data', '{}'::jsonb)`,
    [requestId, adminId, "a".repeat(64)],
  );
  if (authorizedRowId !== undefined) {
    await database.query(
      `insert into record_deletion_authorized_rows
        (request_id, table_name, row_key)
       values ($1, 'vehicle_owner_history', $2)`,
      [requestId, String(authorizedRowId)],
    );
  }
  await database.query(
    `select set_config('app.record_deletion_request_id', $1, true)`,
    [requestId],
  );
}

describe("record deletion database authorization", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
  });

  beforeEach(async () => {
    await database.exec(
      `truncate table staff_accounts restart identity cascade`,
    );

    const account = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role, must_change_password)
       values ('删除测试管理员', 'delete-admin', 'test-hash', 'super_admin', false)
       returning id`,
    );
    adminId = Number(account.rows[0]?.id);

    const customer = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0001', '删除测试客户', '8765550101', $1)
       returning id`,
      [adminId],
    );
    const customerId = Number(customer.rows[0]?.id);

    const vehicles = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values
        ('VEH-202608-0001', 'DELETE1', 'DELETE1', 'Test', 'One', $1, $2),
        ('VEH-202608-0002', 'DELETE2', 'DELETE2', 'Test', 'Two', $1, $2)
       returning id`,
      [customerId, adminId],
    );

    const histories = await database.query<{ id: number }>(
      `insert into vehicle_owner_history
        (vehicle_id, person_customer_id, changed_by)
       values ($1, $3, $4), ($2, $3, $4)
       returning id`,
      [Number(vehicles.rows[0]?.id), Number(vehicles.rows[1]?.id), customerId, adminId],
    );
    firstOwnerHistoryId = Number(histories.rows[0]?.id);
    secondOwnerHistoryId = Number(histories.rows[1]?.id);

    const orphanCustomer = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0099', '独立客户', '8765550199', $1)
       returning id`,
      [adminId],
    );
    orphanCustomerId = Number(orphanCustomer.rows[0]?.id);
    const orphanVehicle = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0099', 'DELETE99', 'DELETE99', 'Test', 'Orphan', $1, $2)
       returning id`,
      [orphanCustomerId, adminId],
    );
    orphanVehicleId = Number(orphanVehicle.rows[0]?.id);
  });

  afterAll(async () => {
    await database.close();
  });

  it("keeps ordinary deletes blocked", async () => {
    await expect(database.query(
      `delete from vehicle_owner_history where id = $1`,
      [firstOwnerHistoryId],
    )).rejects.toThrow("vehicle ownership facts are append-only");
  });

  it("guards every primary row deleted by the formal deletion service", async () => {
    const rows = await database.query<{ table_name: string }>(
      `select event_object_table as table_name
       from information_schema.triggers
       where trigger_name = 'record_deletion_primary_delete_guard'
       order by event_object_table`,
    );
    expect(rows.rows.map((row) => row.table_name)).toEqual([
      "business_orders",
      "company_accounts",
      "company_contacts",
      "inspection_reports",
      "personal_customers",
      "repair_rounds",
      "vehicles",
    ]);
  });

  it("blocks direct deletion of dependency-free primary records", async () => {
    await expect(database.query(
      `delete from personal_customers where id = $1`,
      [orphanCustomerId],
    )).rejects.toThrow("formal record deletion authorization required");
    await expect(database.query(
      `delete from vehicles where id = $1`,
      [orphanVehicleId],
    )).rejects.toThrow("formal record deletion authorization required");
  });

  it("rejects a request context that has no exact authorized row", async () => {
    await startDeletionRequest("delete-no-scope");
    await expect(database.query(
      `delete from vehicle_owner_history where id = $1`,
      [firstOwnerHistoryId],
    )).rejects.toThrow("vehicle ownership facts are append-only");
    await database.exec("rollback");
  });

  it("allows only the exact scoped row and expires authorization at commit", async () => {
    await startDeletionRequest("delete-exact-row", firstOwnerHistoryId);
    await expect(database.query(
      `delete from vehicle_owner_history where id = $1`,
      [firstOwnerHistoryId],
    )).resolves.toMatchObject({ affectedRows: 1 });
    await database.exec("commit");

    await expect(database.query(
      `delete from vehicle_owner_history where id = $1`,
      [secondOwnerHistoryId],
    )).rejects.toThrow("vehicle ownership facts are append-only");

    const remaining = await database.query<{ id: number }>(
      `select id from vehicle_owner_history order by id`,
    );
    expect(remaining.rows.map((row) => Number(row.id))).toEqual([secondOwnerHistoryId]);
  });

  it("rolls back the deletion and authorization receipt together", async () => {
    await startDeletionRequest("delete-rollback", firstOwnerHistoryId);
    await database.query(
      `delete from vehicle_owner_history where id = $1`,
      [firstOwnerHistoryId],
    );
    await database.exec("rollback");

    const histories = await database.query<{ count: number }>(
      `select count(*)::int as count from vehicle_owner_history`,
    );
    const receipts = await database.query<{ count: number }>(
      `select count(*)::int as count from record_deletion_receipts
       where request_id = 'delete-rollback'`,
    );
    expect(Number(histories.rows[0]?.count)).toBe(2);
    expect(Number(receipts.rows[0]?.count)).toBe(0);
  });
});
