import { expect, test } from "@playwright/test";
import {
  calculateInvoiceTotals,
  calculateInvoiceTotalsFromQuotedCharges,
  calculateLegacyInvoiceTotals,
  deriveInvoicePaymentSummary,
  validateInvoiceCustomerAcknowledgement,
  validateChargeLine,
} from "../../src/lib/billing/calculations";
import { createVehicleReleaseFact } from "../../src/lib/orders/business-order-types";
import type {
  ChargeLine,
  Invoice,
  InvoiceCustomerAcknowledgement,
} from "../../src/lib/billing/types";

const inspectionLine: ChargeLine = {
  id: "L1",
  category: "labor",
  code: "inspection",
  descriptionZh: "检查",
  descriptionEn: "Inspection",
  quantity: 1,
  unitPriceJmd: 10_000,
};

const parkingLine: ChargeLine = {
  id: "O1",
  category: "other_service",
  code: "parking_overtime",
  descriptionZh: "停车超时",
  descriptionEn: "Parking overtime",
  quantity: 1,
  unitPriceJmd: 2_500,
};

test("uses three charge categories and keeps invoice totals exact", () => {
  const result = calculateInvoiceTotals({
    lines: [
      { ...inspectionLine, code: "repair", descriptionZh: "维修", descriptionEn: "Repair" },
      {
        id: "P1",
        category: "parts",
        code: "part",
        descriptionZh: "配件",
        descriptionEn: "Part",
        quantity: 2,
        unitPriceJmd: 5_000,
      },
      { ...parkingLine, code: "towing", descriptionZh: "拖车", descriptionEn: "Towing", unitPriceJmd: 7_500 },
    ],
    adjustments: [{ id: "A1", kind: "discount", amountJmd: -2_500 }],
  });

  expect(result).toEqual({
    laborJmd: 10_000,
    partsJmd: 10_000,
    otherServiceJmd: 7_500,
    adjustmentsJmd: -2_500,
    totalJmd: 25_000,
  });
});

test("adapts shared discounted, fixed-total, and parking facts into new Invoice totals once", () => {
  expect(calculateInvoiceTotalsFromQuotedCharges({
    lines: [
      {
        id: "labor-shared", category: "labor", pricingMode: "unit", descZh: "维修", descEn: "Repair",
        remarkZh: "", remarkEn: "", unit: "工时", unitEn: "labor hour", quantity: 2,
        unitPriceJmd: 10_000, unitDiscountJmd: 1_000, pendingQuote: false,
      },
      {
        id: "other-shared", category: "other_service", pricingMode: "fixed_total", code: "towing",
        descZh: "拖车", descEn: "Towing", remarkZh: "", remarkEn: "", amountJmd: 7_500,
      },
      {
        id: "parking-shared", category: "other_service", pricingMode: "parking_projection", code: "parking_overtime",
        descZh: "停车超时", descEn: "Parking overtime", remarkZh: "", remarkEn: "", amountJmd: 2_500,
        parkingCaseId: "parking-case-1", sourceRevision: 2, asOf: "2026-08-21T10:00:00-05:00",
      },
    ],
    adjustments: [{ id: "rounding-1", kind: "rounding", amountJmd: -1 }],
  })).toEqual({
    laborJmd: 18_000,
    partsJmd: 0,
    otherServiceJmd: 10_000,
    adjustmentsJmd: -1,
    totalJmd: 27_999,
  });
});

test("keeps legacy Invoice calculation explicit and rejects legacy discount adjustments for shared lines", () => {
  const legacyInput = {
    lines: [inspectionLine],
    adjustments: [{ id: "A1", kind: "discount" as const, amountJmd: -1_000 }],
  };
  expect(calculateLegacyInvoiceTotals(legacyInput)).toEqual(calculateInvoiceTotals(legacyInput));
  expect(() => calculateInvoiceTotalsFromQuotedCharges({
    lines: [{
      id: "labor-shared", category: "labor", pricingMode: "unit", descZh: "维修", descEn: "Repair",
      remarkZh: "", remarkEn: "", unit: "工时", unitEn: "labor hour", quantity: 1,
      unitPriceJmd: 10_000, unitDiscountJmd: 1_000, pendingQuote: false,
    }],
    adjustments: [{ id: "A1", kind: "discount", amountJmd: -1_000 } as never],
  })).toThrow(/legacy|discount|历史/i);
});

test("derives payment status from independent immutable payment facts", () => {
  expect(deriveInvoicePaymentSummary({
    invoiceId: "invoice-1",
    totalJmd: 25_000,
    payments: [{
      id: "payment-1",
      invoiceId: "invoice-1",
      amountJmd: 5_000,
      receivedAt: "2026-08-10T10:00:00.000Z",
    }],
  })).toEqual({
    paidJmd: 5_000, balanceJmd: 20_000, paymentStatus: "partially_paid",
    payments: [{
      id: "payment-1", invoiceId: "invoice-1", amountJmd: 5_000,
      receivedAt: "2026-08-10T10:00:00.000Z",
    }],
  });
});

test("keeps versioned charge snapshots and customer acknowledgement independent from payments and release", () => {
  const invoice = {
    id: "invoice-1",
    invoiceNo: "KGN-WH-INV-2026080919422",
    businessOrderId: "bo-1",
    settlementArrangement: "credit",
    versions: [{
      id: "invoice-version-1",
      version: 1,
      lines: [inspectionLine],
      adjustments: [],
      totals: {
        laborJmd: 10_000,
        partsJmd: 0,
        otherServiceJmd: 0,
        adjustmentsJmd: 0,
        totalJmd: 10_000,
      },
      issuedAt: "2026-08-10T10:00:00.000Z",
    }],
  } satisfies Invoice;
  const acknowledgement = {
    id: "ack-1",
    invoiceId: invoice.id,
    invoiceVersionId: "invoice-version-1",
    customerId: "customer-1",
    payerId: "customer-1",
    customerSignerId: "customer-1",
    signatureEvidence: {
      signatureId: "signature-1",
      signatureHash: "sha256:signature",
      blobRef: "signatures/signature-1.svg",
    },
    balanceJmd: 10_000,
    documentEdition: "bilingual",
    fileHash: "sha256:invoice-version-1",
    signedAt: "2026-08-10T10:05:00.000Z",
  } satisfies InvoiceCustomerAcknowledgement;

  expect(invoice.versions[0].lines).toEqual([inspectionLine]);
  expect(acknowledgement.invoiceVersionId).toBe("invoice-version-1");
  expect(() => validateInvoiceCustomerAcknowledgement(acknowledgement)).not.toThrow();
});

test("validates acknowledgement evidence and discriminated vehicle release audit facts", () => {
  const acknowledgement = {
    id: "ack-1",
    invoiceId: "invoice-1",
    invoiceVersionId: "version-1",
    customerId: "customer-1",
    payerId: "customer-1",
    customerSignerId: "customer-1",
    signatureEvidence: { signatureId: "signature-1", signatureHash: "sha256:signature", blobRef: "signatures/1" },
    balanceJmd: 10_000,
    documentEdition: "bilingual",
    fileHash: "sha256:file",
    signedAt: "2026-08-10T10:05:00.000Z",
  };
  expect(() => validateInvoiceCustomerAcknowledgement({ ...acknowledgement, signatureEvidence: { ...acknowledgement.signatureEvidence, blobRef: "" } } as never))
    .toThrow(/签名/);
  expect(() => createVehicleReleaseFact({
    id: "release-1", businessOrderId: "bo-1", vehicleId: "vehicle-1", status: "released",
    authorizationId: "authorization-1", authorizedBy: "admin-1", authorizedAt: "2026-08-10T10:00:00.000Z",
  } as never)).toThrow(/放车/);
  expect(createVehicleReleaseFact({
    id: "release-1", businessOrderId: "bo-1", vehicleId: "vehicle-1", status: "released",
    authorizationId: "authorization-1", authorizedBy: "admin-1", authorizedAt: "2026-08-10T10:00:00.000Z",
    releasedBy: "frontdesk-1", releasedAt: "2026-08-10T10:30:00.000Z", specialAgreementAuthorizationId: "special-1",
  })).toMatchObject({ status: "released", releasedBy: "frontdesk-1", specialAgreementAuthorizationId: "special-1" });
});

test("rejects negative, duplicate, wrong-invoice, overpaid, and unsafe payment facts", () => {
  const payment = { id: "payment-1", invoiceId: "invoice-1", amountJmd: 5_000, receivedAt: "2026-08-10T10:00:00.000Z" };
  const summary = (payments: unknown, totalJmd = 10_000) => () => deriveInvoicePaymentSummary({
    invoiceId: "invoice-1", totalJmd, payments: payments as never,
  });
  expect(summary([{ ...payment, amountJmd: -1 }])).toThrow(/付款金额/);
  expect(summary([payment, payment])).toThrow(/重复/);
  expect(summary([{ ...payment, invoiceId: "invoice-2" }])).toThrow(/同一 Invoice/);
  expect(summary([{ ...payment, amountJmd: 10_001 }])).toThrow(/超过/);
  expect(summary([{ ...payment, amountJmd: Number.MAX_SAFE_INTEGER + 1 }], Number.MAX_SAFE_INTEGER + 1)).toThrow(/非负整数|安全整数/);
});

test("rejects charge codes assigned to the wrong category", () => {
  expect(() => validateChargeLine({ ...inspectionLine, category: "other_service" })).toThrow(/inspection.*labor/i);
  expect(() => validateChargeLine({ ...parkingLine, category: "labor" })).toThrow(/parking_overtime.*other_service/i);
});

test("rejects duplicate charge or adjustment IDs and invalid monetary values", () => {
  expect(() => calculateInvoiceTotals({
    lines: [inspectionLine, { ...inspectionLine }],
    adjustments: [],
  })).toThrow(/重复.*ID/i);
  expect(() => validateChargeLine({ ...inspectionLine, quantity: Number.NaN })).toThrow(/数量/i);
  expect(() => validateChargeLine({ ...inspectionLine, unitPriceJmd: Number.POSITIVE_INFINITY })).toThrow(/金额/i);
  expect(() => calculateInvoiceTotals({
    lines: [inspectionLine],
    adjustments: [{ id: "A1", kind: "discount", amountJmd: -1.5 }],
  })).toThrow(/整数/);
});

test("rejects invalid adjustment kinds and positive discount-like adjustments", () => {
  const input = (kind: unknown, amountJmd: number) => () => calculateInvoiceTotals({
    lines: [inspectionLine],
    adjustments: [{ id: "A1", kind: kind as never, amountJmd }],
  });

  expect(input("made_up", 0)).toThrow(/类型|kind/i);
  expect(input("discount", 1)).toThrow(/discount.*非正|discount.*<= 0/i);
  expect(input("waiver", 1)).toThrow(/waiver.*非正|waiver.*<= 0/i);
  expect(input("write_off", 1)).toThrow(/write_off.*非正|write_off.*<= 0/i);
  expect(input("rounding", 1)).not.toThrow();
  expect(input("discount", 0)).not.toThrow();
});
