import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migrationsBeforeRepairRounds = [
  "0000_foundation.sql",
  "0001_account_permissions.sql",
  "0002_master_data.sql",
  "0003_master_data_facts_append_only.sql",
  "0004_customer_vehicle.sql",
  "0005_customer_vehicle_facts_append_only.sql",
  "0006_customer_identity_rule.sql",
  "0007_customer_trn_registry.sql",
  "0008_customer_trn_registry_sync.sql",
  "0009_business_order_core.sql",
  "0010_business_order_facts_append_only.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

it("backfills round one when the repair-round migration finds an existing Business Order", async () => {
  const database = new PGlite();
  await database.waitReady;
  try {
    for (const path of migrationsBeforeRepairRounds) {
      await database.exec(await readFile(path, "utf8"));
    }
    const account = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role,
         must_change_password)
       values ('超级管理员', 'admin', 'test-hash', 'super_admin', false)
       returning id`,
    );
    const adminId = Number(account.rows[0].id);
    const person = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', $1)
       returning id`,
      [adminId],
    );
    const vehicle = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [person.rows[0].id, adminId],
    );
    const createdAt = new Date("2026-08-24T12:30:00Z");
    const order = await database.query<{ id: number }>(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, payer_phone_snapshot,
         vehicle_plate_snapshot, vehicle_description_snapshot,
         created_at, updated_at, created_by)
       values ('BO-20260824-0001', $1, $2, '张伟', '+18765550101',
               '7012 AB', 'Honda CR-V', $3, $3, $4)
       returning id`,
      [vehicle.rows[0].id, person.rows[0].id, createdAt, adminId],
    );

    await database.exec(await readFile(
      resolve(process.cwd(), "drizzle", "0011_repair_rounds.sql"),
      "utf8",
    ));

    const rounds = await database.query<{
      business_order_id: number;
      round_no: number;
      status: string;
      created_at: Date;
      created_by: number;
    }>(
      `select business_order_id, round_no, status, created_at, created_by
       from repair_rounds where business_order_id = $1`,
      [order.rows[0].id],
    );
    expect(rounds.rows).toEqual([{
      business_order_id: Number(order.rows[0].id),
      round_no: 1,
      status: "waiting_assignment",
      created_at: createdAt,
      created_by: adminId,
    }]);
  } finally {
    await database.close();
  }
}, 15_000);
