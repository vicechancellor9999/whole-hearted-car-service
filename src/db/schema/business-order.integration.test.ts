import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationPaths = [
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
].map((file) => resolve(process.cwd(), "drizzle", file));

let database: PGlite;
let adminId: number;
let personId: number;
let companyId: number;
let otherCompanyId: number;
let companyContactId: number;
let otherCompanyContactId: number;
let vehicleId: number;
let unitId: number;

async function insertBusinessOrder(input: {
  orderNo: string;
  personId?: number | null;
  companyId?: number | null;
  companyContactId?: number | null;
}) {
  return database.query<{ id: number }>(
    `insert into business_orders
      (order_no, vehicle_id, payer_person_customer_id,
       payer_company_account_id, payer_company_contact_id,
       payer_display_name_snapshot, vehicle_plate_snapshot,
       vehicle_description_snapshot, created_by)
     values ($1, $2, $3, $4, $5, '付款责任快照', '7012 AB',
             'Honda CR-V', $6)
     returning id`,
    [
      input.orderNo,
      vehicleId,
      input.personId ?? null,
      input.companyId ?? null,
      input.companyContactId ?? null,
      adminId,
    ],
  );
}

describe("Business Order core schema", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    const admin = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role,
         must_change_password)
       values ('超级管理员', 'admin', 'test-hash', 'super_admin', false)
       returning id`,
    );
    adminId = Number(admin.rows[0].id);
    const unit = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, label_en, created_by)
       values ('charge_unit', 'hour', '工时', 'hour', $1)
       returning id`,
      [adminId],
    );
    unitId = Number(unit.rows[0].id);
    const person = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', $1)
       returning id`,
      [adminId],
    );
    personId = Number(person.rows[0].id);
    const companies = await database.query<{ id: number }>(
      `insert into company_accounts
        (company_no, legal_name, normalized_name, created_by)
       values
        ('COMP-202608-0001', 'Kingston Logistics Ltd', 'kingston logistics ltd', $1),
        ('COMP-202608-0002', 'Harbour Trading Ltd', 'harbour trading ltd', $1)
       returning id`,
      [adminId],
    );
    companyId = Number(companies.rows[0].id);
    otherCompanyId = Number(companies.rows[1].id);
    const contacts = await database.query<{ id: number }>(
      `insert into company_contacts
        (company_id, personal_customer_id, is_primary, can_sign, created_by)
       values
        ($1, $3, true, true, $4),
        ($2, $3, true, true, $4)
       returning id`,
      [companyId, otherCompanyId, personId, adminId],
    );
    companyContactId = Number(contacts.rows[0].id);
    otherCompanyContactId = Number(contacts.rows[1].id);
    const vehicle = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [personId, adminId],
    );
    vehicleId = Number(vehicle.rows[0].id);
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates Business Order and immutable charge-version tables", async () => {
    const result = await database.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'business_orders', 'business_order_charge_versions',
           'business_order_charge_items', 'business_order_notes'
         )
       order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "business_order_charge_items",
      "business_order_charge_versions",
      "business_order_notes",
      "business_orders",
    ]);
  });

  it("requires exactly one payer snapshot and a company contact only for company orders", async () => {
    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0001",
    })).rejects.toMatchObject({ code: "23514" });
    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0002",
      personId,
      companyId,
      companyContactId,
    })).rejects.toMatchObject({ code: "23514" });
    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0003",
      personId,
      companyContactId,
    })).rejects.toMatchObject({ code: "23514" });
    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0004",
      companyId,
    })).rejects.toMatchObject({ code: "23514" });
    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0005",
      companyId,
      companyContactId: otherCompanyContactId,
    })).rejects.toThrow(/company contact does not belong to payer/);

    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0006",
      personId,
    })).resolves.toBeDefined();
    await expect(insertBusinessOrder({
      orderNo: "BO-20260824-0007",
      companyId,
      companyContactId,
    })).resolves.toBeDefined();
  });

  it("validates Business Order numbers and optimistic-lock versions", async () => {
    await expect(insertBusinessOrder({
      orderNo: "demo-v2-provisional",
      personId,
    })).rejects.toMatchObject({ code: "23514" });
    const order = await insertBusinessOrder({
      orderNo: "BO-20260824-0001",
      personId,
    });
    await expect(
      database.query("update business_orders set version = 0 where id = $1", [order.rows[0].id]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps charge versions, items and notes immutable", async () => {
    const order = await insertBusinessOrder({
      orderNo: "BO-20260824-0001",
      personId,
    });
    const orderId = Number(order.rows[0].id);
    const version = await database.query<{ id: number }>(
      `insert into business_order_charge_versions
        (business_order_id, version_no, change_reason,
         labor_discount_minor, part_discount_minor,
         other_discount_minor, whole_order_discount_minor,
         gross_minor, line_discount_minor, category_discount_minor,
         total_due_minor, included_gct_minor, created_by)
       values ($1, 1, '初始收费', 0, 0, 0, 0, 20000, 2000, 0,
               18000, 2348, $2)
       returning id`,
      [orderId, adminId],
    );
    const versionId = Number(version.rows[0].id);
    const item = await database.query<{ id: number }>(
      `insert into business_order_charge_items
        (charge_version_id, kind, name_zh, name_en, unit_item_id,
         quantity, unit_price_minor, item_discount_minor,
         subtotal_minor, sort_order)
       values ($1, 'labor', '发动机诊断工时', 'Engine diagnosis labor', $2,
               2, 10000, 2000, 18000, 1)
       returning id`,
      [versionId, unitId],
    );
    const note = await database.query<{ id: number }>(
      `insert into business_order_notes
        (charge_version_id, kind, content_zh, content_en, sort_order)
       values ($1, 'liability_notice', '已提前告知客户风险',
               'Risk disclosed in advance', 1)
       returning id`,
      [versionId],
    );

    await expect(
      database.query("update business_order_charge_versions set change_reason = '改写' where id = $1", [versionId]),
    ).rejects.toThrow(/charge facts are append-only/);
    await expect(
      database.query("update business_order_charge_items set subtotal_minor = 1 where id = $1", [item.rows[0].id]),
    ).rejects.toThrow(/charge facts are append-only/);
    await expect(
      database.query("delete from business_order_notes where id = $1", [note.rows[0].id]),
    ).rejects.toThrow(/charge facts are append-only/);
  });

  it("rejects negative amounts and a line subtotal that breaks amount conservation", async () => {
    const order = await insertBusinessOrder({
      orderNo: "BO-20260824-0001",
      personId,
    });
    const orderId = Number(order.rows[0].id);
    await expect(
      database.query(
        `insert into business_order_charge_versions
          (business_order_id, version_no, change_reason,
           labor_discount_minor, part_discount_minor,
           other_discount_minor, whole_order_discount_minor,
           gross_minor, line_discount_minor, category_discount_minor,
           total_due_minor, included_gct_minor, created_by)
         values ($1, 1, '错误负数', 0, 0, 0, 0, 100, 0, 0, -1, 0, $2)`,
        [orderId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const version = await database.query<{ id: number }>(
      `insert into business_order_charge_versions
        (business_order_id, version_no, change_reason,
         labor_discount_minor, part_discount_minor,
         other_discount_minor, whole_order_discount_minor,
         gross_minor, line_discount_minor, category_discount_minor,
         total_due_minor, included_gct_minor, created_by)
       values ($1, 1, '有效版本', 0, 0, 0, 0, 20000, 2000, 0,
               18000, 2348, $2)
       returning id`,
      [orderId, adminId],
    );
    await expect(
      database.query(
        `insert into business_order_charge_items
          (charge_version_id, kind, name_zh, unit_item_id, quantity,
           unit_price_minor, item_discount_minor, subtotal_minor, sort_order)
         values ($1, 'labor', '错误小计', $2, 2, 10000, 2000, 17999, 1)`,
        [version.rows[0].id, unitId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
