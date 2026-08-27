import type {
  ChargeCategory,
  ChargeCode,
  ChargeLine,
  InvoiceAdjustment,
  InvoiceCalculationInput,
  InvoiceCustomerAcknowledgement,
  InvoicePaymentFact,
  InvoicePaymentSummary,
  InvoicePaymentSummaryInput,
  InvoiceTotals,
  PaymentStatus,
  QuotedChargeInvoiceCalculationInput,
} from "./types";
import { calculateQuotedChargeTotals } from "./quoted-charges";

const CODE_CATEGORY: Readonly<Record<ChargeCode, ChargeCategory>> = {
  inspection: "labor",
  diagnosis: "labor",
  maintenance: "labor",
  repair: "labor",
  part: "parts",
  parking_overtime: "other_service",
  towing: "other_service",
  offsite_service: "other_service",
  other: "other_service",
};
const ADJUSTMENT_KINDS = new Set<InvoiceAdjustment["kind"]>([
  "discount",
  "waiver",
  "write_off",
  "rounding",
]);

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label}不能为空`);
  }
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}必须为有限正数`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label}必须为非负整数`);
  }
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}必须为有限整数`);
  }
}

function assertDescription(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label}不能为空`);
  }
}

function lineAmount(line: ChargeLine): number {
  const amount = line.quantity * line.unitPriceJmd;
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("收费行金额必须为安全整数 JMD");
  }
  return amount;
}

export function validateChargeLine(line: ChargeLine): void {
  assertId(line.id, "收费行 ID");
  assertDescription(line.descriptionZh, "收费中文说明");
  assertDescription(line.descriptionEn, "收费英文说明");
  assertPositiveFinite(line.quantity, "数量");
  assertNonNegativeInteger(line.unitPriceJmd, "金额");
  if (line.sourceId !== undefined) assertId(line.sourceId, "收费来源 ID");

  const requiredCategory = CODE_CATEGORY[line.code];
  if (requiredCategory === undefined) {
    throw new RangeError("收费代码无效");
  }
  if (line.category !== requiredCategory) {
    throw new RangeError(`收费代码 ${line.code} 必须归入 ${requiredCategory}`);
  }
  lineAmount(line);
}

function validateAdjustment(adjustment: InvoiceAdjustment): void {
  assertId(adjustment.id, "金额调整 ID");
  if (!ADJUSTMENT_KINDS.has(adjustment.kind)) {
    throw new RangeError("金额调整类型无效");
  }
  assertInteger(adjustment.amountJmd, "金额调整");
  if (
    (adjustment.kind === "discount" || adjustment.kind === "waiver" || adjustment.kind === "write_off")
    && adjustment.amountJmd > 0
  ) {
    throw new RangeError(`金额调整 ${adjustment.kind} 必须为非正数 (<= 0)`);
  }
}

function assertDistinctIds(lines: ReadonlyArray<ChargeLine>, adjustments: ReadonlyArray<InvoiceAdjustment>): void {
  const ids = new Set<string>();
  for (const item of [...lines, ...adjustments]) {
    if (ids.has(item.id)) throw new RangeError("收费行或金额调整不得重复 ID");
    ids.add(item.id);
  }
}

function addExact(total: number, amount: number): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next)) throw new RangeError("Invoice 金额超过安全整数范围");
  return next;
}

function paymentStatus(totalJmd: number, paidJmd: number): PaymentStatus {
  if (paidJmd === 0) return "unpaid";
  return paidJmd === totalJmd ? "paid" : "partially_paid";
}

/** Historical persisted Invoice adapter. New writes use calculateInvoiceTotalsFromQuotedCharges. */
export function calculateLegacyInvoiceTotals(input: InvoiceCalculationInput): InvoiceTotals {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new RangeError("Invoice 至少需要一条收费行");
  }
  if (!Array.isArray(input.adjustments)) throw new TypeError("金额调整必须为数组");
  assertDistinctIds(input.lines, input.adjustments);

  let laborJmd = 0;
  let partsJmd = 0;
  let otherServiceJmd = 0;
  for (const line of input.lines) {
    validateChargeLine(line);
    const amount = lineAmount(line);
    if (line.category === "labor") laborJmd = addExact(laborJmd, amount);
    if (line.category === "parts") partsJmd = addExact(partsJmd, amount);
    if (line.category === "other_service") otherServiceJmd = addExact(otherServiceJmd, amount);
  }

  let adjustmentsJmd = 0;
  for (const adjustment of input.adjustments) {
    validateAdjustment(adjustment);
    adjustmentsJmd = addExact(adjustmentsJmd, adjustment.amountJmd);
  }
  const totalJmd = addExact(addExact(laborJmd, partsJmd), addExact(otherServiceJmd, adjustmentsJmd));
  if (totalJmd < 0) throw new RangeError("Invoice 总额不得为负数");
  return {
    laborJmd,
    partsJmd,
    otherServiceJmd,
    adjustmentsJmd,
    totalJmd,
  };
}

/** Source-compatible legacy entry point retained until the persisted Invoice migration. */
export function calculateInvoiceTotals(input: InvoiceCalculationInput): InvoiceTotals {
  return calculateLegacyInvoiceTotals(input);
}

/**
 * Adapts shared line-level charge facts into the persisted InvoiceTotals display shape.
 * A legacy discount adjustment is rejected because discounts are already present on unit lines.
 */
export function calculateInvoiceTotalsFromQuotedCharges(input: QuotedChargeInvoiceCalculationInput): InvoiceTotals {
  if (input === null || typeof input !== "object") throw new TypeError("Invoice calculation input is required");
  if (!Array.isArray(input.adjustments)) throw new TypeError("金额调整必须为数组");
  const totals = calculateQuotedChargeTotals(input.lines, { includeParking: true });
  const ids = new Set(input.lines.map((line) => line.id));
  let adjustmentsJmd = 0;
  for (const adjustment of input.adjustments) {
    if (ids.has(adjustment.id)) throw new RangeError("收费行或金额调整不得重复 ID");
    ids.add(adjustment.id);
    const runtimeAdjustment = adjustment as InvoiceAdjustment;
    validateAdjustment(runtimeAdjustment);
    if (runtimeAdjustment.kind === "discount") {
      throw new RangeError("legacy discount adjustment cannot be combined with shared line discounts");
    }
    adjustmentsJmd = addExact(adjustmentsJmd, adjustment.amountJmd);
  }
  const otherServiceJmd = addExact(totals.otherFeeTotalJmd, totals.parkingTotalJmd);
  const totalJmd = addExact(totals.grandTotalJmd, adjustmentsJmd);
  if (totalJmd < 0) throw new RangeError("Invoice 总额不得为负数");
  return {
    laborJmd: totals.laborNetJmd,
    partsJmd: totals.partsNetJmd,
    otherServiceJmd,
    adjustmentsJmd,
    totalJmd,
  };
}

function assertTimestamp(value: string, label: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${label}必须为有效时间`);
  }
}

function validatePayment(payment: InvoicePaymentFact, invoiceId: string): void {
  assertId(payment.id, "付款 ID");
  if (payment.invoiceId !== invoiceId) throw new RangeError("付款必须属于同一 Invoice");
  assertNonNegativeInteger(payment.amountJmd, "付款金额");
  assertTimestamp(payment.receivedAt, "收款时间");
}

/** Derives payment state from ledger facts without modifying an Invoice version. */
export function deriveInvoicePaymentSummary(input: InvoicePaymentSummaryInput): InvoicePaymentSummary {
  assertId(input.invoiceId, "Invoice ID");
  assertNonNegativeInteger(input.totalJmd, "Invoice 总额");
  if (!Array.isArray(input.payments)) throw new TypeError("付款记录必须为数组");

  const paymentIds = new Set<string>();
  let paidJmd = 0;
  for (const payment of input.payments) {
    validatePayment(payment, input.invoiceId);
    if (paymentIds.has(payment.id)) throw new RangeError("付款记录不得重复 ID");
    paymentIds.add(payment.id);
    paidJmd = addExact(paidJmd, payment.amountJmd);
  }
  if (paidJmd > input.totalJmd) throw new RangeError("已付金额不得超过 Invoice 总额");
  return {
    paidJmd,
    balanceJmd: input.totalJmd - paidJmd,
    paymentStatus: paymentStatus(input.totalJmd, paidJmd),
    payments: input.payments,
  };
}

/** Runtime validation for the customer signature bound to a specific Invoice edition. */
export function validateInvoiceCustomerAcknowledgement(input: InvoiceCustomerAcknowledgement): void {
  assertId(input.id, "客户签账 ID");
  assertId(input.invoiceId, "Invoice ID");
  assertId(input.invoiceVersionId, "Invoice 版本 ID");
  assertId(input.customerId, "客户 ID");
  assertId(input.payerId, "付款主体 ID");
  assertId(input.customerSignerId, "客户签字人 ID");
  assertNonNegativeInteger(input.balanceJmd, "签账余额");
  if (input.documentEdition !== "zh" && input.documentEdition !== "en" && input.documentEdition !== "bilingual") {
    throw new RangeError("签账文件语言版本无效");
  }
  assertId(input.fileHash, "签账文件哈希");
  assertTimestamp(input.signedAt, "签账时间");
  if (input.signatureEvidence === null || typeof input.signatureEvidence !== "object") {
    throw new TypeError("签名证据不能为空");
  }
  assertId(input.signatureEvidence.signatureId, "签名 ID");
  assertId(input.signatureEvidence.signatureHash, "签名哈希");
  assertId(input.signatureEvidence.blobRef, "签名文件引用");
}
