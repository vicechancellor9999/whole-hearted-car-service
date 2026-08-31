import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  "0030_business_order_customer_copy.sql",
  "0031_business_order_messages.sql",
  "0035_business_order_document_revisions.sql",
  "0036_business_order_document_english_files.sql",
  "0040_business_order_problem_descriptions.sql",
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
let storageRoot: string;

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
    problemDescriptionZh: "发动机故障灯偶发点亮",
    problemDescriptionEn: "The engine warning light comes on intermittently.",
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
    storageRoot = await mkdtemp("/Volumes/公司文件/.wh-business-document-test-");
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      const migration = await readFile(path, "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await database.exec(statement);
      }
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
       values ('CUST-202608-0001', '张伟 / Zhang Wei', '+18765550101', '123456789', $1)
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
    documents = new BusinessOrderDocumentService(db, { storageRoot });
    businessOrders = new BusinessOrderService(db);
    payments = new PaymentService(db);
  });

  afterEach(async () => {
    await database.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("creates revision one with a stored real PDF and appends an edited revision", async () => {
    await createChargedOrder();
    const generated = await documents.generateOfficeArchive({
      businessOrderId: 1,
      context: context(frontDeskId, "generate-revisioned-office", "2026-08-24T14:00:00Z"),
    });
    const detail = await documents.getDocumentDetail({ documentId: generated.id, viewerAccountId: ownerId });
    expect(detail.latestRevisionNo).toBe(1);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0].englishFileId).toEqual(expect.any(Number));
    const firstFile = await documents.getRevisionFile({
      documentId: generated.id,
      revisionId: detail.revisions[0].id,
      viewerAccountId: ownerId,
    });
    expect(firstFile.mediaType).toBe("application/pdf");
    expect(new TextDecoder().decode(firstFile.bytes.slice(0, 5))).toBe("%PDF-");
    const englishFile = await documents.getRevisionFile({
      documentId: generated.id,
      revisionId: detail.revisions[0].id,
      viewerAccountId: ownerId,
      language: "en",
    });
    expect(englishFile.originalName).toMatch(/-EN\.pdf$/);
    expect(Buffer.from(englishFile.bytes).equals(Buffer.from(firstFile.bytes))).toBe(false);

    const second = await documents.createRevision({
      documentId: generated.id,
      expectedLatestRevisionNo: 1,
      fieldOverrides: { "header.title": "办公室客户签字存档联" },
      context: context(frontDeskId, "revise-office", "2026-08-24T14:05:00Z"),
    });
    expect(second.revisionNo).toBe(2);
    await expect(documents.createRevision({
      documentId: generated.id,
      expectedLatestRevisionNo: 1,
      fieldOverrides: {},
      context: context(frontDeskId, "stale-office", "2026-08-24T14:06:00Z"),
    })).rejects.toMatchObject({ status: 409, code: "business_order_document_revision_conflict" });
  });

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
      version: 2,
      kind: "office_archive",
      presentation: "office_english_primary_v1",
      charges: { versionNo: 2 },
      totals: { totalPaidMinor: 300_000 },
      problemDescription: {
        original: {
          contentZh: "发动机故障灯偶发点亮",
          contentEn: "The engine warning light comes on intermittently.",
        },
        repairRound: { roundNo: 1, versionNo: 1 },
      },
    });
    await businessOrders.appendProblemDescriptionVersion({
      businessOrderId: order.id,
      scope: "business_order",
      expectedVersion: 1,
      contentZh: "后来修改的问题描述",
      contentEn: "A later changed problem description.",
      reason: "文件生成后修改",
      context: context(frontDeskId, "change-problem", "2026-08-24T15:10:00Z"),
    });
    const frozenAgain = await documents.getDocument({ documentId: generated.id, viewerAccountId: ownerId });
    expect(JSON.stringify(frozenAgain.snapshot)).not.toContain("后来修改的问题描述");
    expect(JSON.stringify(reprinted.snapshot)).not.toContain("后来的施工项目");
  });

  it("builds a customer copy with customer-visible charges and without internal notes", async () => {
    const { order } = await createChargedOrder();
    await payments.recordPayment({
      businessOrderId: order.id,
      amount: "3000",
      paymentMethodItemId: cashMethodId,
      note: "客户预付款",
      context: context(frontDeskId, "pay-customer-copy", "2026-08-24T14:00:00Z"),
    });

    const generated = await documents.generateCustomerCopy({
      businessOrderId: order.id,
      context: context(frontDeskId, "customer-copy-1", "2026-08-24T14:05:00Z"),
    });

    expect(generated.documentNo).toBe("CUS-20260824-0001");
    expect(generated.snapshot).toMatchObject({
      version: 2,
      kind: "customer_copy",
      businessOrder: {
        orderNo: order.orderNo,
        payerName: "张伟 / Zhang Wei",
        plate: "7012 AB",
      },
      charges: {
        versionNo: 2,
        items: [{ nameZh: "发动机诊断" }, { nameZh: "机油滤芯" }],
      },
      totals: { totalPaidMinor: 300_000 },
      problemDescription: {
        original: { contentZh: "发动机故障灯偶发点亮" },
        repairRound: { contentZh: "发动机故障灯偶发点亮" },
      },
    });
    const detail = await documents.getDocumentDetail({ documentId: generated.id, viewerAccountId: ownerId });
    expect(detail.revisions[0].englishFileId).toEqual(expect.any(Number));
    const serialized = JSON.stringify(generated.snapshot);
    expect(serialized).not.toContain("内部审批备注");
    expect(serialized).not.toContain("Internal approval note");
    expect(serialized).not.toContain("performance");
  });

  it("builds a Chinese mechanic copy without customer, money, payment or performance data", async () => {
    const { order } = await createChargedOrder();
    const generated = await documents.generateMechanicWorkCopy({
      businessOrderId: order.id,
      context: context(frontDeskId, "mechanic-1", "2026-08-24T14:10:00Z"),
    });
    expect(generated.documentNo).toBe("MEC-20260824-0001");
    expect(generated.snapshot).toMatchObject({
      version: 2,
      kind: "mechanic_work",
      vehicle: { plate: "7012 AB", vin: "1HGBH41JXMN109186" },
      repairRound: { roundNo: 1 },
      workItems: [{ nameZh: "发动机诊断" }, { nameZh: "机油滤芯" }],
      problemDescription: {
        primary: { scope: "repair_round", versionNo: 1 },
        originalContext: null,
      },
    });
    const detail = await documents.getDocumentDetail({ documentId: generated.id, viewerAccountId: ownerId });
    expect(detail.revisions[0].englishFileId).toBeNull();
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
