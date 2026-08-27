import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0001_account_permissions.sql"),
  resolve(process.cwd(), "drizzle/0002_master_data.sql"),
  resolve(process.cwd(), "drizzle/0003_master_data_facts_append_only.sql"),
  resolve(process.cwd(), "drizzle/0004_customer_vehicle.sql"),
  resolve(process.cwd(), "drizzle/0005_customer_vehicle_facts_append_only.sql"),
  resolve(process.cwd(), "drizzle/0006_customer_identity_rule.sql"),
  resolve(process.cwd(), "drizzle/0007_customer_trn_registry.sql"),
  resolve(process.cwd(), "drizzle/0008_customer_trn_registry_sync.sql"),
  resolve(process.cwd(), "drizzle/0025_fantastic_dakota_north.sql"),
];

let database: PGlite;
let adminId: number;

async function seedPerson(
  customerNo: string,
  fullName: string,
  phone: string | null,
  trn: string | null = null,
) {
  const result = await database.query<{ id: number }>(
    `insert into personal_customers
      (customer_no, full_name, normalized_phone, trn, created_by)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [customerNo, fullName, phone, trn, adminId],
  );
  return Number(result.rows[0].id);
}

async function seedCompany(companyNo: string, legalName: string) {
  const result = await database.query<{ id: number }>(
    `insert into company_accounts
      (company_no, legal_name, normalized_name, created_by)
     values ($1, $2, lower($2), $3)
     returning id`,
    [companyNo, legalName, adminId],
  );
  return Number(result.rows[0].id);
}

describe("customer and vehicle schema", () => {
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
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates customer, company, vehicle, dispute and attachment tables", async () => {
    const result = await database.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'personal_customers', 'company_accounts', 'company_contacts',
           'vehicles', 'vehicle_owner_history', 'vehicle_disputes',
           'stored_files', 'vehicle_attachments'
         )
       order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "company_accounts",
      "company_contacts",
      "personal_customers",
      "stored_files",
      "vehicle_attachments",
      "vehicle_disputes",
      "vehicle_owner_history",
      "vehicles",
    ]);
  });

  it("adds formal customer phone ownership and driver-license record storage while allowing an incomplete identity", async () => {
    const tables = await database.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in ('customer_phone_registry', 'customer_driver_license_records')
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "customer_driver_license_records",
      "customer_phone_registry",
    ]);

    const columns = await database.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'personal_customers'
         and column_name in ('birth_date', 'gender')
       order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["birth_date", "gender"]);

    const identityConstraint = await database.query<{ constraint_name: string }>(
      `select constraint_name
       from information_schema.table_constraints
       where table_schema = 'public'
         and table_name = 'personal_customers'
         and constraint_name = 'personal_customers_identity_present'`,
    );
    expect(identityConstraint.rows).toEqual([]);

    await expect(
      database.query(
        `insert into personal_customers
          (customer_no, full_name, created_by)
         values ('CUST-202608-0099', '资料待补客户', $1)`,
        [adminId],
      ),
    ).resolves.toMatchObject({ affectedRows: 1 });
  });

  it("keeps supplied phone and TRN identities unique", async () => {
    await seedPerson("CUST-202608-0001", "张伟", "+18765550101");
    await expect(
      seedPerson("CUST-202608-0002", "重复手机号", "+18765550101"),
    ).rejects.toMatchObject({ code: "23505" });

    await seedPerson("CUST-202608-0003", "有 TRN 客户", null, "123456789");
    await expect(
      seedPerson("CUST-202608-0004", "重复 TRN", "+18765550104", "123456789"),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      seedPerson("CUST-202608-0005", "有独立 TRN 的家庭联系人", "+18765550101", "987654321"),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      database.query(
        `insert into company_accounts
          (company_no, legal_name, normalized_name, trn, created_by)
         values ('COMP-202608-0001', '重复个人 TRN 的公司', '重复个人 trn 的公司',
                 '123456789', $1)`,
        [adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("registers phone ownership across person phone, WhatsApp, and company phone writes", async () => {
    const personId = await seedPerson("CUST-202608-0010", "同号客户", "+18765550110", "123456710");
    await database.query(
      "update personal_customers set whatsapp = '+1 876 555 0110' where id = $1",
      [personId],
    );
    const owned = await database.query<{ normalized_phone: string; owner_kind: string; owner_id: number }>(
      `select normalized_phone, owner_kind, owner_id
       from customer_phone_registry
       where owner_kind = 'person' and owner_id = $1`,
      [personId],
    );
    expect(owned.rows).toEqual([{
      normalized_phone: "+18765550110",
      owner_kind: "person",
      owner_id: personId,
    }]);

    await expect(
      seedPerson("CUST-202608-0011", "跨字段冲突", null, "123456711")
        .then((id) => database.query(
          "update personal_customers set whatsapp = '+1 (876) 555-0110' where id = $1",
          [id],
        )),
    ).rejects.toMatchObject({ code: "23505" });

    const companyId = await seedCompany("COMP-202608-0010", "冲突公司");
    await expect(
      database.query("update company_accounts set phone = '+1 876 555 0110' where id = $1", [companyId]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("links several personal contacts to a company with only one active primary contact", async () => {
    const first = await seedPerson("CUST-202608-0001", "联系人一", "+18765550101");
    const second = await seedPerson("CUST-202608-0002", "联系人二", "+18765550102");
    const companyId = await seedCompany("COMP-202608-0001", "Kingston Logistics Ltd");

    await database.query(
      `insert into company_contacts
        (company_id, personal_customer_id, job_title, is_primary,
         can_sign, receives_invoice, receives_collection, created_by)
       values ($1, $2, '现场负责人', true, true, true, true, $3)`,
      [companyId, first, adminId],
    );
    await database.query(
      `insert into company_contacts
        (company_id, personal_customer_id, job_title, is_primary,
         can_sign, receives_invoice, receives_collection, created_by)
       values ($1, $2, '财务', false, false, true, true, $3)`,
      [companyId, second, adminId],
    );
    await expect(
      database.query(
        `update company_contacts
         set is_primary = true
         where company_id = $1 and personal_customer_id = $2`,
        [companyId, second],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("keeps normalized plate and VIN unique and requires exactly one current owner", async () => {
    const personId = await seedPerson("CUST-202608-0001", "张伟", "+18765550101");
    const companyId = await seedCompany("COMP-202608-0001", "Kingston Logistics Ltd");
    await database.query(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, vin, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB',
               '1HGBH41JXMN109186', 'Honda', 'CR-V', $1, $2)`,
      [personId, adminId],
    );
    await expect(
      database.query(
        `insert into vehicles
          (vehicle_no, plate_display, normalized_plate, make, model,
           current_company_account_id, created_by)
         values ('VEH-202608-0002', '7012-AB', '7012AB',
                 'Toyota', 'Hiace', $1, $2)`,
        [companyId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      database.query(
        `insert into vehicles
          (vehicle_no, plate_display, normalized_plate, vin, make, model,
           current_company_account_id, created_by)
         values ('VEH-202608-0003', '4321 AB', '4321AB',
                 '1HGBH41JXMN109186', 'Nissan', 'X-Trail', $1, $2)`,
        [companyId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      database.query(
        `insert into vehicles
          (vehicle_no, plate_display, normalized_plate, make, model,
           current_person_customer_id, current_company_account_id, created_by)
         values ('VEH-202608-0004', '8899 AB', '8899AB',
                 'Suzuki', 'Swift', $1, $2, $3)`,
        [personId, companyId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("allows one unresolved dispute at a time and requires a complete resolution", async () => {
    const personId = await seedPerson("CUST-202608-0001", "张伟", "+18765550101");
    const vehicle = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB',
               'Honda', 'CR-V', $1, $2)
       returning id`,
      [personId, adminId],
    );
    const vehicleId = Number(vehicle.rows[0].id);
    await database.query(
      `insert into vehicle_disputes
        (vehicle_id, opened_note, opened_by)
       values ($1, '客户认为异响仍存在', $2)`,
      [vehicleId, adminId],
    );
    await expect(
      database.query(
        `insert into vehicle_disputes
          (vehicle_id, opened_note, opened_by)
         values ($1, '第二个未解决争议', $2)`,
        [vehicleId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      database.query(
        `update vehicle_disputes
         set resolved_at = now()
         where vehicle_id = $1`,
        [vehicleId],
      ),
    ).rejects.toThrow(/dispute facts are append-only/);
  });

  it("stores attachment metadata without a file-content column", async () => {
    const columns = await database.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'stored_files'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "storage_key",
      "original_name",
      "media_type",
      "size_bytes",
      "sha256_hex",
      "uploaded_by",
      "uploaded_at",
    ]);
  });

  it("keeps ownership, dispute and attachment facts from being rewritten or deleted", async () => {
    const personId = await seedPerson("CUST-202608-0001", "张伟", "+18765550101");
    const vehicle = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [personId, adminId],
    );
    const vehicleId = Number(vehicle.rows[0].id);
    const owner = await database.query<{ id: number }>(
      `insert into vehicle_owner_history
        (vehicle_id, person_customer_id, changed_by)
       values ($1, $2, $3) returning id`,
      [vehicleId, personId, adminId],
    );
    await expect(
      database.query("update vehicle_owner_history set reason = '改写' where id = $1", [owner.rows[0].id]),
    ).rejects.toThrow(/ownership facts are append-only/);
    await database.query(
      "update vehicle_owner_history set ended_at = now() where id = $1",
      [owner.rows[0].id],
    );
    await expect(
      database.query("delete from vehicle_owner_history where id = $1", [owner.rows[0].id]),
    ).rejects.toThrow(/ownership facts are append-only/);

    const dispute = await database.query<{ id: number }>(
      `insert into vehicle_disputes (vehicle_id, opened_note, opened_by)
       values ($1, '客户争议', $2) returning id`,
      [vehicleId, adminId],
    );
    await expect(
      database.query("update vehicle_disputes set opened_note = '改写' where id = $1", [dispute.rows[0].id]),
    ).rejects.toThrow(/dispute facts are append-only/);
    await database.query(
      `update vehicle_disputes set resolved_at = now(), resolved_note = '已解决', resolved_by = $2 where id = $1`,
      [dispute.rows[0].id, adminId],
    );
    await expect(
      database.query("delete from vehicle_disputes where id = $1", [dispute.rows[0].id]),
    ).rejects.toThrow(/dispute facts are append-only/);

    const file = await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by)
       values ('vehicle/1/a.jpg', 'a.jpg', 'image/jpeg', 100, $1, $2)
       returning id`,
      ["a".repeat(64), adminId],
    );
    const fileId = Number(file.rows[0].id);
    await database.query(
      `insert into vehicle_attachments (vehicle_id, file_id, kind, linked_by)
       values ($1, $2, 'photo', $3)`,
      [vehicleId, fileId, adminId],
    );
    await expect(
      database.query("update stored_files set original_name = 'b.jpg' where id = $1", [fileId]),
    ).rejects.toThrow(/attachment facts are append-only/);
    await expect(
      database.query("delete from vehicle_attachments where file_id = $1", [fileId]),
    ).rejects.toThrow(/attachment facts are append-only/);
  });
});
