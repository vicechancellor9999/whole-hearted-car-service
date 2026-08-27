import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import {
  BusinessOrderDocumentService,
  BusinessOrderDocumentWriteDeniedError,
} from "@formal/modules/business-order/business-order-document-service";
import { BusinessOrderService } from "@formal/modules/business-order/business-order-service";
import { PaymentService } from "@formal/modules/payment/payment-service";

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
  "0016_vehicle_profile_fields.sql",
  "0017_optional_vehicle_plate.sql",
  "0018_business_order_number_format.sql",
  "0019_repair_assignment_withdrawal.sql",
  "0020_repair_assignment_withdrawal_projection.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let documents: BusinessOrderDocumentService;
let businessOrders: BusinessOrderService;
let payments: PaymentService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let vehicleId: number;
let hourUnitId: number;
let pieceUnitId: number;
let cashMethodId: number;

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

function context(actorAccountId: number, requestId: string, at: string) {
  return {
    actorAccountId,
    requestId,
    now: new Date(at),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

async function seedAccount(name: string, username: string, role: string) {
  return Number((await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ($1, $2, 'test-hash', $3::account_role, false)
     returning id`,
    [name, username, role],
  )).rows[0].id);
}

async function createChargedOrder() {
  const order = await businessOrders.createBusinessOrder({
    vehicleId,
    context: context(frontDeskId, "create-order", "2026-08-24T13:00:00Z"),
  });
  const charges = await businessOrders.replaceChargeVersion({
    businessOrderId: order.id,
    expectedBusinessOrderVersion: order.version,
    reason: "客户认可收费",
    laborDiscount: "500",
    partDiscount: "250",
    otherDiscount: "0",
    wholeOrderDiscount: "100",
    items: [{
      kind: "labor",
      nameZh: "发动机诊断",
      nameEn: "Engine diagnosis",
      descriptionZh: "诊断发动机故障",
      descriptionEn: "Diagnose engine fault",
      unitItemId: hourUnitId,
      quantity: "2",
      unitPrice: "10000",
      itemDiscount: "1000",
    }, {
      kind: "part",
      nameZh: "机油滤芯",
      nameEn: "Oil filter",
      descriptionZh: "更换机油滤芯",
      descriptionEn: "Replace oil filter",
      unitItemId: pieceUnitId,
      quantity: "1",
      unitPrice: "5000",
      itemDiscount: "0",
    }],
    notes: [{
      kind: "customer_concern",
      contentZh: "客户反映发动机异响。",
      contentEn: "Customer reports engine noise.",
    }, {
      kind: "work_instruction",
      contentZh: "先诊断后更换滤芯。",
      contentEn: "Diagnose before replacing the filter.",
    }, {
      kind: "liability_notice",
      contentZh: "客户已知悉诊断范围。",
      contentEn: "Customer acknowledges the diagnostic scope.",
    }, {
      kind: "internal",
      contentZh: "内部审批备注。",
      contentEn: "Internal approval note.",
    }],
    context: context(frontDeskId, "set-charges", "2026-08-24T13:01:00Z"),
  });
  return { order, charges };
}

describe("BusinessOrderDocumentService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    const dictionary = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, label_en, is_active, created_by)
       values
        ('charge_unit', 'hour', '工时', 'hour', true, $1),
        ('charge_unit', 'piece', '个', 'piece', true, $1),
        ('payment_method', 'cash', '现金', 'Cash', true, $1)
       returning id`,
      [adminId],
    );
    hourUnitId = Number(dictionary.rows[0].id);
    pieceUnitId = Number(dictionary.rows[1].id);
    cashMethodId = Number(dictionary.rows[2].id);
    const customerId = Number((await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, trn, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', '123456789', $1)
       returning id`,
      [adminId],
    )).rows[0].id);
    vehicleId = Number((await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, vin, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB',
               '1HGBH41JXMN109186', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [customerId, adminId],
    )).rows[0].id);
    const db = testDatabase(database);
    documents = new BusinessOrderDocumentService(db);
    businessOrders = new BusinessOrderService(db);
    payments = new PaymentService(db);
  });

  afterEach(async () => database.close());

  it("freezes the office archive before later charges and payments change", async () => {
    const { order, charges } = await createChargedOrder();
    await payments.recordPayment({
      businessOrderId: order.id,
      amount: "3000",
      paymentMethodItemId: cashMethodId,
      note: "首次收款",
      context: context(frontDeskId, "pay-1", "2026-08-24T14:00:00Z"),
    });
    const generated = await documents.generateOfficeArchive({
      businessOrderId: order.id,
      context: context(frontDeskId, "office-1", "2026-08-24T14:05:00Z"),
    });

    await businessOrders.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: charges.businessOrderVersion,
      reason: "后来增加收费",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "0",
      items: [{
        kind: "labor",
        nameZh: "后来的施工项目",
        unitItemId: hourUnitId,
        quantity: "1",
        unitPrice: "30000",
        itemDiscount: "0",
      }],
      notes: [],
      context: context(adminId, "change-charge", "2026-08-24T15:00:00Z"),
    });
    await payments.recordPayment({
      businessOrderId: order.id,
      amount: "2000",
      paymentMethodItemId: cashMethodId,
      context: context(frontDeskId, "pay-2", "2026-08-24T15:05:00Z"),
    });

    const reprinted = await documents.getDocument({
      documentId: generated.id,
      viewerAccountId: ownerId,
    });
    expect(reprinted.documentNo).toBe("OFF-20260824-0001");
    expect(reprinted.snapshot).toMatchObject({
      kind: "office_archive",
      presentation: "office_english_primary_v1",
      charges: { versionNo: 2 },
      totals: { totalPaidMinor: 300_000 },
    });
    expect(JSON.stringify(reprinted.snapshot)).not.toContain("后来的施工项目");
  });

  it("builds a Chinese mechanic copy without customer, money, payment or performance data", async () => {
    const { order } = await createChargedOrder();
    const generated = await documents.generateMechanicWorkCopy({
      businessOrderId: order.id,
      context: context(frontDeskId, "mechanic-1", "2026-08-24T14:10:00Z"),
    });
    expect(generated.documentNo).toBe("MEC-20260824-0001");
    expect(generated.snapshot).toMatchObject({
      kind: "mechanic_work",
      vehicle: { plate: "7012 AB", vin: "1HGBH41JXMN109186" },
      repairRound: { roundNo: 1 },
      workItems: [{ nameZh: "发动机诊断" }, { nameZh: "机油滤芯" }],
    });
    const serialized = JSON.stringify(generated.snapshot);
    for (const forbidden of [
      "张伟", "+18765550101", "123456789", "payer", "unitPriceMinor",
      "discount", "transactions", "balance", "performance", "内部审批备注",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("lets the owner list and reprint documents but not generate them", async () => {
    const { order } = await createChargedOrder();
    const generated = await documents.generateOfficeArchive({
      businessOrderId: order.id,
      context: context(adminId, "office-admin", "2026-08-24T14:20:00Z"),
    });
    await expect(documents.generateOfficeArchive({
      businessOrderId: order.id,
      context: context(ownerId, "office-owner", "2026-08-24T14:21:00Z"),
    })).rejects.toBeInstanceOf(BusinessOrderDocumentWriteDeniedError);
    await expect(documents.listForBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject([{ id: generated.id }]);
  });
});
