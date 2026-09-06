import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { BusinessOrderService } from "@formal/modules/business-order/business-order-service";
import {
  PaymentConflictError,
  PaymentNotFoundError,
  PaymentService,
  PaymentValidationError,
  PaymentWriteDeniedError,
} from "@formal/modules/payment/payment-service";

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
  "0018_business_order_number_format.sql",
  "0040_business_order_problem_descriptions.sql",
  "0049_business_order_categories.sql",
  "0051_business_order_pending_quotes.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let paymentService: PaymentService;
let businessOrderService: BusinessOrderService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let vehicleId: number;
let hourUnitId: number;
let cashMethodId: number;
let bankMethodId: number;
let inactiveMethodId: number;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      const result = await source.query<Row>(text, [...parameters]);
      return result.rows;
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
  const order = await businessOrderService.createBusinessOrder({
    vehicleId,
    context: context(frontDeskId, "create-order", "2026-08-24T13:00:00Z"),
  });
  const charges = await businessOrderService.replaceChargeVersion({
    businessOrderId: order.id,
    expectedBusinessOrderVersion: order.version,
    reason: "客户确认收费",
    laborDiscount: "0",
    partDiscount: "0",
    otherDiscount: "0",
    wholeOrderDiscount: "0",
    items: [{
      kind: "labor",
      nameZh: "发动机诊断",
      nameEn: "Engine diagnosis",
      descriptionZh: "检查发动机故障",
      descriptionEn: "Diagnose engine fault",
      unitItemId: hourUnitId,
      quantity: "2",
      unitPrice: "10000",
      itemDiscount: "0",
    }],
    notes: [{
      kind: "liability_notice",
      contentZh: "客户已知悉诊断范围。",
      contentEn: "Customer acknowledges the diagnostic scope.",
    }],
    context: context(frontDeskId, "set-charges", "2026-08-24T13:01:00Z"),
  });
  return { order, charges };
}

describe("PaymentService", () => {
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
        ('payment_method', 'cash', '现金', 'Cash', true, $1),
        ('payment_method', 'bank_transfer', '银行转账', 'Bank transfer', true, $1),
        ('payment_method', 'disabled', '停用方式', 'Disabled', false, $1)
       returning id`,
      [adminId],
    );
    hourUnitId = Number(dictionary.rows[0].id);
    cashMethodId = Number(dictionary.rows[1].id);
    bankMethodId = Number(dictionary.rows[2].id);
    inactiveMethodId = Number(dictionary.rows[3].id);
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
    const testDb = testDatabase(database);
    businessOrderService = new BusinessOrderService(testDb);
    paymentService = new PaymentService(testDb);
  });

  afterEach(async () => database.close());

  it("records three independent payments and creates three immutable Receipts", async () => {
    const { order } = await createChargedOrder();
    const amounts = ["3000", "2500", "1000"];
    const results = [];
    for (const [index, amount] of amounts.entries()) {
      results.push(await paymentService.recordPayment({
        businessOrderId: order.id,
        amount,
        paymentMethodItemId: cashMethodId,
        note: `第 ${index + 1} 次收款`,
        context: context(frontDeskId, `payment-${index + 1}`, `2026-08-24T14:0${index}:00Z`),
      }));
    }

    expect(new Set(results.map((result) => result.payment.paymentNo)).size).toBe(3);
    expect(new Set(results.map((result) => result.receipt.receiptNo)).size).toBe(3);
    expect(results.map((result) => result.receipt.receiptNo)).toEqual([
      "RCT-20260824-0001",
      "RCT-20260824-0002",
      "RCT-20260824-0003",
    ]);
    const ledger = await paymentService.getBusinessOrderLedger({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    });
    expect(ledger).toMatchObject({
      currentDueMinor: 2_000_000,
      totalPaidMinor: 650_000,
      totalRefundedMinor: 0,
      balanceMinor: 1_350_000,
    });
    expect(ledger.transactions.map((transaction) => transaction.type)).toEqual([
      "payment",
      "payment",
      "payment",
    ]);
    const audits = await database.query<{ event_type: string }>(
      "select event_type from audit_events where event_type = 'payment.recorded' order by id",
    );
    expect(audits.rows).toHaveLength(3);
  });

  it("reprints the original Receipt number and snapshot after charges change", async () => {
    const { order, charges } = await createChargedOrder();
    const recorded = await paymentService.recordPayment({
      businessOrderId: order.id,
      amount: "5000",
      paymentMethodItemId: cashMethodId,
      context: context(frontDeskId, "payment-freeze", "2026-08-24T14:00:00Z"),
    });
    await businessOrderService.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: charges.businessOrderVersion,
      reason: "后来增加收费",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "0",
      items: [{
        kind: "labor",
        nameZh: "发动机诊断",
        unitItemId: hourUnitId,
        quantity: "3",
        unitPrice: "10000",
        itemDiscount: "0",
      }],
      notes: [],
      context: context(adminId, "change-charge", "2026-08-24T15:00:00Z"),
    });

    const reprinted = await paymentService.getReceipt({
      receiptId: recorded.receipt.id,
      viewerAccountId: ownerId,
    });
    expect(reprinted.receiptNo).toBe(recorded.receipt.receiptNo);
    expect(reprinted.snapshot.charges.totals.totalDueMinor).toBe(2_000_000);
    expect(reprinted.snapshot.totals.balanceAfterMinor).toBe(1_500_000);
    expect((await paymentService.getBusinessOrderLedger({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).currentDueMinor).toBe(3_000_000);
  });

  it("allows overpayment but rejects owner writes and inactive payment methods", async () => {
    const { order } = await createChargedOrder();
    await expect(paymentService.recordPayment({
      businessOrderId: order.id,
      amount: "25000",
      paymentMethodItemId: cashMethodId,
      context: context(frontDeskId, "overpayment", "2026-08-24T14:00:00Z"),
    })).resolves.toMatchObject({
      receipt: { snapshot: { totals: { balanceAfterMinor: -500_000 } } },
    });
    await expect(paymentService.recordPayment({
      businessOrderId: order.id,
      amount: "1",
      paymentMethodItemId: cashMethodId,
      context: context(ownerId, "owner-payment", "2026-08-24T14:01:00Z"),
    })).rejects.toBeInstanceOf(PaymentWriteDeniedError);
    await expect(paymentService.recordPayment({
      businessOrderId: order.id,
      amount: "1",
      paymentMethodItemId: inactiveMethodId,
      context: context(frontDeskId, "inactive-method", "2026-08-24T14:02:00Z"),
    })).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("records an arbitrary non-cash refund first and appends its proof afterwards", async () => {
    const { order } = await createChargedOrder();
    const payment = await paymentService.recordPayment({
      businessOrderId: order.id,
      amount: "3000",
      paymentMethodItemId: cashMethodId,
      context: context(frontDeskId, "payment-before-refund", "2026-08-24T14:00:00Z"),
    });
    const chargeBefore = await businessOrderService.getCurrentCharges({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    });
    const refund = await paymentService.recordRefund({
      businessOrderId: order.id,
      amount: "5000",
      paymentMethodItemId: bankMethodId,
      reason: "客户要求终止本次服务关系",
      originalDocumentStatus: "returned",
      context: context(adminId, "refund-arbitrary", "2026-08-24T15:00:00Z"),
    });

    expect(refund).toMatchObject({
      refundNo: "RFD-20260824-0001",
      amountMinor: 500_000,
      paymentMethodCode: "bank_transfer",
      evidence: [],
    });
    const withProof = await paymentService.appendRefundProof({
      businessOrderId: order.id,
      refundId: refund.id,
      proof: evidence("refund-proof.pdf", "application/pdf", "proof-key"),
      context: context(adminId, "refund-proof", "2026-08-24T15:05:00Z"),
    });
    expect(withProof.evidence).toMatchObject([{ kind: "refund_proof" }]);
    await expect(paymentService.appendRefundProof({
      businessOrderId: order.id,
      refundId: refund.id,
      proof: evidence("replacement.pdf", "application/pdf", "replacement-key"),
      context: context(adminId, "refund-proof-replace", "2026-08-24T15:06:00Z"),
    })).rejects.toBeInstanceOf(PaymentConflictError);
    await expect(paymentService.appendRefundProof({
      businessOrderId: order.id + 999,
      refundId: refund.id,
      proof: evidence("wrong-order.pdf", "application/pdf", "wrong-order-key"),
      context: context(adminId, "refund-proof-wrong-order", "2026-08-24T15:07:00Z"),
    })).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(await businessOrderService.getCurrentCharges({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).toEqual(chargeBefore);
    expect(await paymentService.getReceipt({
      receiptId: payment.receipt.id,
      viewerAccountId: ownerId,
    })).toEqual(payment.receipt);
    expect(await paymentService.getBusinessOrderLedger({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).toMatchObject({
      currentDueMinor: 2_000_000,
      totalPaidMinor: 300_000,
      totalRefundedMinor: 500_000,
      balanceMinor: 2_200_000,
    });
    const audit = await database.query<{ event_type: string; reason: string | null }>(
      "select event_type, reason from audit_events where request_id in ('refund-arbitrary', 'refund-proof') order by id",
    );
    expect(audit.rows).toEqual([
      {
        event_type: "refund.created",
        reason: "客户要求终止本次服务关系",
      },
      {
        event_type: "refund.proof_attached",
        reason: null,
      },
    ]);
  });

  it("records cash refunds without a pre-uploaded signature and still requires an unavailable-original explanation", async () => {
    const { order } = await createChargedOrder();
    await expect(paymentService.recordRefund({
      businessOrderId: order.id,
      amount: "1",
      paymentMethodItemId: bankMethodId,
      reason: "测试",
      originalDocumentStatus: "returned",
      context: context(adminId, "refund-no-proof", "2026-08-24T15:00:00Z"),
    })).resolves.toMatchObject({ evidence: [] });
    await expect(paymentService.recordRefund({
      businessOrderId: order.id,
      amount: "1",
      paymentMethodItemId: cashMethodId,
      reason: "测试",
      originalDocumentStatus: "returned",
      context: context(adminId, "refund-no-signature", "2026-08-24T15:01:00Z"),
    })).resolves.toMatchObject({
      paymentMethodCode: "cash",
      evidence: [],
    });
    await expect(paymentService.recordRefund({
      businessOrderId: order.id,
      amount: "1",
      paymentMethodItemId: bankMethodId,
      reason: "测试",
      originalDocumentStatus: "unavailable",
      originalDocumentNote: "",
      context: context(adminId, "refund-no-original-note", "2026-08-24T15:02:00Z"),
    })).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("requires sensitive permission for front desk refunds and keeps owner read-only", async () => {
    const { order } = await createChargedOrder();
    const refundInput = {
      businessOrderId: order.id,
      amount: "100",
      paymentMethodItemId: cashMethodId,
      reason: "现金退款",
      originalDocumentStatus: "unavailable" as const,
      originalDocumentNote: "客户说明原单已经遗失",
    };
    await expect(paymentService.recordRefund({
      ...refundInput,
      context: context(frontDeskId, "front-no-grant", "2026-08-24T15:00:00Z"),
    })).rejects.toBeInstanceOf(PaymentWriteDeniedError);
    await expect(paymentService.recordRefund({
      ...refundInput,
      context: context(ownerId, "owner-refund", "2026-08-24T15:01:00Z"),
    })).rejects.toBeInstanceOf(PaymentWriteDeniedError);
    await database.query(
      `insert into staff_account_permission_grants
        (account_id, permission, granted_by, granted_at)
       values ($1, 'sensitive_operations.execute', $2, '2026-08-24T15:02:00Z')`,
      [frontDeskId, adminId],
    );
    const cashRefund = await paymentService.recordRefund({
      ...refundInput,
      context: context(frontDeskId, "front-with-grant", "2026-08-24T15:03:00Z"),
    });
    expect(cashRefund).toMatchObject({
      amountMinor: 10_000,
      evidence: [],
    });
    await expect(paymentService.appendRefundProof({
      businessOrderId: order.id,
      refundId: cashRefund.id,
      proof: evidence("cash-extra-proof.jpg", "image/jpeg", "cash-extra-proof-key"),
      context: context(frontDeskId, "cash-extra-proof", "2026-08-24T15:04:00Z"),
    })).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("appends the signed paper refund acknowledgement only after the refund exists", async () => {
    const { order } = await createChargedOrder();
    const refund = await paymentService.recordRefund({
      businessOrderId: order.id,
      amount: "100",
      paymentMethodItemId: cashMethodId,
      reason: "现金退款",
      originalDocumentStatus: "returned",
      context: context(adminId, "refund-before-paper-signature", "2026-08-24T16:00:00Z"),
    });

    const withSignedAcknowledgement = await paymentService.appendRefundSignedAcknowledgement({
      businessOrderId: order.id,
      refundId: refund.id,
      signedAcknowledgement: evidence("signed-refund-acknowledgement.pdf", "application/pdf", "signed-acknowledgement-key"),
      context: context(adminId, "refund-signed-paper-upload", "2026-08-24T16:05:00Z"),
    });

    expect(withSignedAcknowledgement.evidence).toMatchObject([
      { kind: "customer_signature", originalName: "signed-refund-acknowledgement.pdf" },
    ]);
    await expect(paymentService.appendRefundSignedAcknowledgement({
      businessOrderId: order.id,
      refundId: refund.id,
      signedAcknowledgement: evidence("replacement.pdf", "application/pdf", "replacement-acknowledgement-key"),
      context: context(adminId, "refund-signed-paper-replace", "2026-08-24T16:06:00Z"),
    })).rejects.toBeInstanceOf(PaymentConflictError);
  });
});

function evidence(originalName: string, mediaType: string, storageKey: string) {
  return {
    storageKey: `refund-files/2026/08/${storageKey}`,
    originalName,
    mediaType,
    sizeBytes: 100,
    sha256Hex: "a".repeat(64),
  };
}
