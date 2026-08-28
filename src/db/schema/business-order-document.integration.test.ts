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
  "0012_inspection_reports.sql",
  "0013_formal_handoffs.sql",
  "0014_payments_receipts_refunds.sql",
  "0015_business_order_documents.sql",
  "0030_business_order_customer_copy.sql",
  "0035_business_order_document_revisions.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let accountId: number;
let businessOrderId: number;
let chargeVersionId: number;
let repairRoundId: number;

describe("Business Order document snapshot schema", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    accountId = Number((await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role, must_change_password)
       values ('超级管理员', 'admin', 'test-hash', 'super_admin', false)
       returning id`,
    )).rows[0].id);
    const customerId = Number((await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', $1)
       returning id`,
      [accountId],
    )).rows[0].id);
    const vehicleId = Number((await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [customerId, accountId],
    )).rows[0].id);
    businessOrderId = Number((await database.query<{ id: number }>(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, payer_phone_snapshot,
         vehicle_plate_snapshot, vehicle_description_snapshot, created_by)
       values ('BO-20260824-0001', $1, $2, '张伟', '+18765550101',
               '7012 AB', 'Honda CR-V', $3)
       returning id`,
      [vehicleId, customerId, accountId],
    )).rows[0].id);
    chargeVersionId = Number((await database.query<{ id: number }>(
      `insert into business_order_charge_versions
        (business_order_id, version_no, change_reason, gross_minor,
         line_discount_minor, category_discount_minor, total_due_minor,
         included_gct_minor, created_by)
       values ($1, 1, '初始收费', 0, 0, 0, 0, 0, $2)
       returning id`,
      [businessOrderId, accountId],
    )).rows[0].id);
    await database.query(
      "update business_orders set current_charge_version_no = 1 where id = $1",
      [businessOrderId],
    );
    repairRoundId = Number((await database.query<{ id: number }>(
      `insert into repair_rounds
        (business_order_id, round_no, source, status, created_by)
       values ($1, 1, 'initial', 'waiting_assignment', $2)
       returning id`,
      [businessOrderId, accountId],
    )).rows[0].id);
  });

  afterEach(async () => database.close());

  it("keeps generated office and mechanic documents append-only", async () => {
    const officeId = Number((await database.query<{ id: number }>(
      `insert into business_order_document_snapshots
        (document_no, business_order_id, kind, charge_version_id,
         charge_version_no, render_snapshot, generated_at, generated_by)
       values ('OFF-20260824-0001', $1, 'office_archive', $2, 1,
               '{"version":1,"kind":"office_archive"}'::jsonb,
               '2026-08-24T15:00:00Z', $3)
       returning id`,
      [businessOrderId, chargeVersionId, accountId],
    )).rows[0].id);
    const mechanicId = Number((await database.query<{ id: number }>(
      `insert into business_order_document_snapshots
        (document_no, business_order_id, kind, charge_version_id,
         charge_version_no, repair_round_id, repair_round_no,
         render_snapshot, generated_at, generated_by)
       values ('MEC-20260824-0001', $1, 'mechanic_work', $2, 1, $3, 1,
               '{"version":1,"kind":"mechanic_work"}'::jsonb,
               '2026-08-24T15:01:00Z', $4)
       returning id`,
      [businessOrderId, chargeVersionId, repairRoundId, accountId],
    )).rows[0].id);

    await expect(database.query(
      "update business_order_document_snapshots set document_no = 'OFF-20260824-9999' where id = $1",
      [officeId],
    )).rejects.toThrow(/append-only/i);
    await expect(database.query(
      "delete from business_order_document_snapshots where id = $1",
      [mechanicId],
    )).rejects.toThrow(/append-only/i);
  });

  it("keeps PDF-backed document revisions append-only and sequential per snapshot", async () => {
    const documentId = Number((await database.query<{ id: number }>(
      `insert into business_order_document_snapshots
        (document_no, business_order_id, kind, charge_version_id,
         charge_version_no, render_snapshot, generated_at, generated_by)
       values ('OFF-20260824-0001', $1, 'office_archive', $2, 1,
               '{"version":1,"kind":"office_archive"}'::jsonb,
               '2026-08-24T15:00:00Z', $3)
       returning id`,
      [businessOrderId, chargeVersionId, accountId],
    )).rows[0].id);
    const fileId = Number((await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by)
       values ('business-order-documents/OFF-R1.pdf', 'OFF-R1.pdf', 'application/pdf', 8, $1, $2)
       returning id`,
      ["a".repeat(64), accountId],
    )).rows[0].id);
    const revisionId = Number((await database.query<{ id: number }>(
      `insert into business_order_document_revisions
        (document_snapshot_id, revision_no, field_overrides, renderer_version,
         file_id, content_sha256, created_at, created_by)
       values ($1, 1, '{"header.title":"Office copy"}'::jsonb, 'bo-a4-v1',
               $2, $3, '2026-08-24T15:01:00Z', $4)
       returning id`,
      [documentId, fileId, "a".repeat(64), accountId],
    )).rows[0].id);
    await expect(database.query(
      "update business_order_document_revisions set renderer_version = 'changed' where id = $1",
      [revisionId],
    )).rejects.toThrow(/append-only/i);
    await expect(database.query(
      "delete from business_order_document_revisions where id = $1",
      [revisionId],
    )).rejects.toThrow(/append-only/i);
    await expect(database.query(
      `insert into business_order_document_revisions
        (document_snapshot_id, revision_no, field_overrides, renderer_version,
         file_id, content_sha256, created_at, created_by)
       values ($1, 1, '{}'::jsonb, 'bo-a4-v1', $2, $3, now(), $4)`,
      [documentId, fileId, "a".repeat(64), accountId],
    )).rejects.toMatchObject({ code: "23505" });
  });

  it("matches the document prefix and repair-round source to its kind", async () => {
    await expect(database.query(
      `insert into business_order_document_snapshots
        (document_no, business_order_id, kind, charge_version_id,
         charge_version_no, render_snapshot, generated_at, generated_by)
       values ('MEC-20260824-0002', $1, 'office_archive', $2, 1,
               '{"version":1,"kind":"office_archive"}'::jsonb,
               '2026-08-24T16:00:00Z', $3)`,
      [businessOrderId, chargeVersionId, accountId],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into business_order_document_snapshots
        (document_no, business_order_id, kind, charge_version_id,
         charge_version_no, render_snapshot, generated_at, generated_by)
       values ('MEC-20260824-0003', $1, 'mechanic_work', $2, 1,
               '{"version":1,"kind":"mechanic_work"}'::jsonb,
               '2026-08-24T16:01:00Z', $3)`,
      [businessOrderId, chargeVersionId, accountId],
    )).rejects.toThrow();
  });

  it("rejects charge versions and repair rounds from another Business Order", async () => {
    await expect(database.query(
      `insert into business_order_document_snapshots
        (document_no, business_order_id, kind, charge_version_id,
         charge_version_no, repair_round_id, repair_round_no,
         render_snapshot, generated_at, generated_by)
       values ('MEC-20260824-0004', $1 + 100, 'mechanic_work', $2, 1, $3, 1,
               '{"version":1,"kind":"mechanic_work"}'::jsonb,
               '2026-08-24T16:02:00Z', $4)`,
      [businessOrderId, chargeVersionId, repairRoundId, accountId],
    )).rejects.toThrow();
  });
});
