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
  "0010_business_order_facts_append_only.sql",
  "0011_repair_rounds.sql",
  "0040_business_order_problem_descriptions.sql",
].map((file) => resolve(process.cwd(), "drizzle", file));

let database: PGlite;
let adminId: number;
let businessOrderId: number;
let repairRoundId: number;

describe("Business Order problem-description facts", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }

    const account = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role,
         must_change_password)
       values ('超级管理员', 'admin', 'test-hash', 'super_admin', false)
       returning id`,
    );
    adminId = Number(account.rows[0].id);

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
    const order = await database.query<{ id: number }>(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, vehicle_plate_snapshot,
         vehicle_description_snapshot, created_by)
       values ('BO-20260831-0001', $1, $2, '张伟', '7012 AB', 'Honda CR-V', $3)
       returning id`,
      [vehicle.rows[0].id, person.rows[0].id, adminId],
    );
    businessOrderId = Number(order.rows[0].id);
    const round = await database.query<{ id: number }>(
      `insert into repair_rounds
        (business_order_id, round_no, source, status, created_by)
       values ($1, 1, 'initial', 'waiting_assignment', $2)
       returning id`,
      [businessOrderId, adminId],
    );
    repairRoundId = Number(round.rows[0].id);
  });

  afterEach(async () => {
    await database.close();
  });

  it("stores an explicit empty original and independent append-only owner streams", async () => {
    await database.query(
      `insert into business_order_problem_originals
        (business_order_id, content_zh, content_en, source_type,
         confirmed_by, confirmed_at)
       values ($1, null, null, 'creation', $2, now())`,
      [businessOrderId, adminId],
    );

    const original = await database.query<{
      content_zh: string | null;
      source_type: string;
    }>(
      `select content_zh, source_type
       from business_order_problem_originals
       where business_order_id = $1`,
      [businessOrderId],
    );
    expect(original.rows).toEqual([{ content_zh: null, source_type: "creation" }]);

    const first = await database.query<{ id: number }>(
      `insert into business_order_problem_versions
        (business_order_id, version_no, content_zh, content_en,
         source_type, change_reason, created_by)
       values ($1, 1, '发动机故障灯偶发点亮', null,
               'creation', '创建业务单', $2)
       returning id`,
      [businessOrderId, adminId],
    );
    await database.query(
      `update business_orders
       set current_problem_description_version_no = 1
       where id = $1`,
      [businessOrderId],
    );
    await database.query(
      `insert into business_order_problem_versions
        (business_order_id, version_no, content_zh, content_en,
         source_type, change_reason, created_by)
       values ($1, 2, '发动机故障灯偶发点亮并伴随怠速不稳', null,
               'manual', '补充客户描述', $2)`,
      [businessOrderId, adminId],
    );
    const round = await database.query<{ id: number }>(
      `insert into repair_round_problem_versions
        (repair_round_id, version_no, content_zh, content_en,
         source_type, source_reference_id, change_reason, created_by)
       values ($1, 1, '本轮先完成诊断', null,
               'customer_concern', $2, '采用已确认客户问题', $3)
       returning id`,
      [repairRoundId, first.rows[0].id, adminId],
    );

    await database.query(
      `update business_orders
       set current_problem_description_version_no = 2
       where id = $1`,
      [businessOrderId],
    );
    await database.query(
      `update repair_rounds
       set current_problem_description_version_no = 1
       where id = $1`,
      [repairRoundId],
    );

    const pointers = await database.query<{
      order_version: number;
      round_version: number;
    }>(
      `select bo.current_problem_description_version_no as order_version,
              rr.current_problem_description_version_no as round_version
       from business_orders bo
       join repair_rounds rr on rr.business_order_id = bo.id
       where bo.id = $1`,
      [businessOrderId],
    );
    expect(pointers.rows).toEqual([{ order_version: 2, round_version: 1 }]);

    await expect(
      database.query(
        `insert into business_order_problem_versions
          (business_order_id, version_no, content_zh, source_type,
           change_reason, created_by)
         values ($1, 2, '重复版本', 'manual', '重复', $2)`,
        [businessOrderId, adminId],
      ),
    ).rejects.toThrow(/next Business Order version/i);

    await expect(
      database.query(
        `update business_order_problem_originals
         set content_zh = '不可改写'
         where business_order_id = $1`,
        [businessOrderId],
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      database.query(
        `delete from business_order_problem_versions where id = $1`,
        [first.rows[0].id],
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      database.query(
        `update repair_round_problem_versions
         set content_zh = '不可改写'
         where id = $1`,
        [round.rows[0].id],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects invalid content, source references, and owner pointers", async () => {
    await expect(
      database.query(
        `insert into business_order_problem_versions
          (business_order_id, version_no, content_zh, content_en,
           source_type, change_reason, created_by)
         values ($1, 1, '   ', null, 'manual', '空内容', $2)`,
        [businessOrderId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.query(
        `insert into repair_round_problem_versions
          (repair_round_id, version_no, content_zh, source_type,
           source_reference_id, change_reason, created_by)
         values ($1, 1, '本轮范围', 'manual', 10, '非法来源', $2)`,
        [repairRoundId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.query(
        `update business_orders
         set current_problem_description_version_no = -1
         where id = $1`,
        [businessOrderId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.query(
        `update repair_rounds
         set current_problem_description_version_no = -1
         where id = $1`,
        [repairRoundId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
