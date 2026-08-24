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
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let accountId: number;
let businessOrderId: number;
let paymentMethodId: number;
let paymentId: number;
let receiptId: number;
let refundId: number;
let fileId: number;

describe("payment fact schema", () => {
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
    paymentMethodId = Number((await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, label_en, created_by)
       values ('payment_method', 'cash', '现金', 'Cash', $1)
       returning id`,
      [accountId],
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
    paymentId = Number((await database.query<{ id: number }>(
      `insert into business_order_payments
        (payment_no, business_order_id, payment_method_item_id,
         payment_method_code_snapshot, payment_method_label_zh_snapshot,
         payment_method_label_en_snapshot, amount_minor, note,
         paid_at, recorded_by)
       values ('PAY-20260824-0001', $1, $2, 'cash', '现金', 'Cash',
               300000, '第一次收款', '2026-08-24T14:00:00Z', $3)
       returning id`,
      [businessOrderId, paymentMethodId, accountId],
    )).rows[0].id);
    receiptId = Number((await database.query<{ id: number }>(
      `insert into payment_receipts
        (receipt_no, payment_id, business_order_id, render_snapshot,
         issued_at, issued_by)
       values ('RCT-20260824-0001', $1, $2, '{"version":1}'::jsonb,
               '2026-08-24T14:00:00Z', $3)
       returning id`,
      [paymentId, businessOrderId, accountId],
    )).rows[0].id);
    refundId = Number((await database.query<{ id: number }>(
      `insert into business_order_refunds
        (refund_no, business_order_id, payment_method_item_id,
         payment_method_code_snapshot, payment_method_label_zh_snapshot,
         payment_method_label_en_snapshot, amount_minor, reason,
         original_document_status, original_document_note,
         refunded_at, recorded_by)
       values ('RFD-20260824-0001', $1, $2, 'cash', '现金', 'Cash',
               500000, '客户退款', 'returned', null,
               '2026-08-24T15:00:00Z', $3)
       returning id`,
      [businessOrderId, paymentMethodId, accountId],
    )).rows[0].id);
    fileId = Number((await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex,
         uploaded_by, uploaded_at)
       values ('refund-files/2026/08/proof.jpg', 'proof.jpg', 'image/jpeg', 10,
               repeat('a', 64), $1, '2026-08-24T15:00:00Z')
       returning id`,
      [accountId],
    )).rows[0].id);
    await database.query(
      `insert into refund_evidence_files
        (refund_id, file_id, kind, linked_at, linked_by)
       values ($1, $2, 'refund_proof', '2026-08-24T15:00:00Z', $3)`,
      [refundId, fileId, accountId],
    );
  });

  afterEach(async () => database.close());

  it("keeps payment, receipt, refund and evidence facts append-only", async () => {
    await expect(database.query(
      "update business_order_payments set amount_minor = 1 where id = $1",
      [paymentId],
    )).rejects.toThrow(/append-only/i);
    await expect(database.query(
      "delete from payment_receipts where id = $1",
      [receiptId],
    )).rejects.toThrow(/append-only/i);
    await expect(database.query(
      "update business_order_refunds set reason = 'changed' where id = $1",
      [refundId],
    )).rejects.toThrow(/append-only/i);
    await expect(database.query(
      "delete from refund_evidence_files where refund_id = $1 and file_id = $2",
      [refundId, fileId],
    )).rejects.toThrow(/append-only/i);
  });

  it("requires positive amounts, one receipt per payment and matching order links", async () => {
    await expect(database.query(
      `insert into business_order_payments
        (payment_no, business_order_id, payment_method_item_id,
         payment_method_code_snapshot, payment_method_label_zh_snapshot,
         amount_minor, paid_at, recorded_by)
       values ('PAY-20260824-0002', $1, $2, 'cash', '现金', 0,
               '2026-08-24T16:00:00Z', $3)`,
      [businessOrderId, paymentMethodId, accountId],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into payment_receipts
        (receipt_no, payment_id, business_order_id, render_snapshot,
         issued_at, issued_by)
       values ('RCT-20260824-0002', $1, $2, '{}'::jsonb,
               '2026-08-24T16:00:00Z', $3)`,
      [paymentId, businessOrderId, accountId],
    )).rejects.toThrow();
  });

  it("requires an explanation when the original customer document is unavailable", async () => {
    await expect(database.query(
      `insert into business_order_refunds
        (refund_no, business_order_id, payment_method_item_id,
         payment_method_code_snapshot, payment_method_label_zh_snapshot,
         amount_minor, reason, original_document_status,
         refunded_at, recorded_by)
       values ('RFD-20260824-0002', $1, $2, 'cash', '现金', 10000,
               '测试退款', 'unavailable', '2026-08-24T16:00:00Z', $3)`,
      [businessOrderId, paymentMethodId, accountId],
    )).rejects.toThrow();
  });
});
