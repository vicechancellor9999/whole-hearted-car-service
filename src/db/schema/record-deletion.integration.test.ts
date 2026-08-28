import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0027_record_deletion_runtime.sql"),
];

let database: PGlite;
let adminId: number;

describe("record deletion persistence", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    const account = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role, must_change_password)
       values ('删除测试管理员', 'delete-admin', 'test-hash', 'super_admin', false)
       returning id`,
    );
    adminId = Number(account.rows[0]?.id);
  });

  afterEach(async () => {
    await database.close();
  });

  it("keeps one immutable result for each idempotency request number", async () => {
    const values = [adminId, "a".repeat(64)];
    await database.query(
      `insert into record_deletion_receipts
        (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
         reason_code, result)
       values ('delete-request-1', $1, $2, 'vehicle', 'VEH-202608-0004',
               'test_data', '{}'::jsonb)`,
      values,
    );

    await expect(database.query(
      `insert into record_deletion_receipts
        (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
         reason_code, result)
       values ('delete-request-1', $1, $2, 'vehicle', 'VEH-202608-0004',
               'test_data', '{}'::jsonb)`,
      values,
    )).rejects.toMatchObject({ code: "23505" });
  });

  it("allows only one incomplete file task for a storage key", async () => {
    await database.query(
      `insert into record_deletion_file_tasks (storage_key)
       values ('customer-license-files/2026/08/test.jpg')`,
    );
    await expect(database.query(
      `insert into record_deletion_file_tasks (storage_key)
       values ('customer-license-files/2026/08/test.jpg')`,
    )).rejects.toMatchObject({ code: "23505" });

    await database.query(
      `update record_deletion_file_tasks
       set state = 'completed', completed_at = now()
       where storage_key = 'customer-license-files/2026/08/test.jpg'`,
    );
    await expect(database.query(
      `insert into record_deletion_file_tasks (storage_key)
       values ('customer-license-files/2026/08/test.jpg')`,
    )).resolves.toMatchObject({ affectedRows: 1 });
  });

  it("rejects unsupported record kinds and incomplete completed tasks", async () => {
    await expect(database.query(
      `insert into record_deletion_receipts
        (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
         reason_code, result)
       values ('delete-request-invalid', $1, $2, 'invoice', 'INV-1',
               'test_data', '{}'::jsonb)`,
      [adminId, "b".repeat(64)],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(database.query(
      `insert into record_deletion_file_tasks
        (storage_key, state, completed_at)
       values ('files/incomplete.jpg', 'completed', null)`,
    )).rejects.toMatchObject({ code: "23514" });
  });
});
