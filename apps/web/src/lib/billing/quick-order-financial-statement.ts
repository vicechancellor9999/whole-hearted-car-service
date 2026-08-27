import type { InvoiceSnapshotLine, InvoiceSnapshotTotals } from "./invoice-snapshots";
import type { QuotedChargeTotals } from "./types";
import {
  assertQuickOrderFinancialReadModel,
  type QuickOrderFinancialLedger,
  type QuickOrderFinancialReadModel,
  type QuickOrderFinancialSource,
} from "./quick-order-financial";

export type QuickOrderStatementCanonicalLine = InvoiceSnapshotLine;

export type QuickOrderStatementSharedLine =
  | Readonly<{
      id: string;
      category: "labor" | "parts";
      pricingMode: "unit";
      descZh: string;
      descEn: string;
      remarkZh: string;
      remarkEn: string;
      unit: string;
      unitEn: string;
      quantity: number;
      unitPriceJmd: number;
      unitDiscountJmd: number;
      pendingQuote: boolean;
    }>
  | Readonly<{
      id: string;
      category: "other_service";
      pricingMode: "fixed_total";
      code: "towing" | "offsite_service" | "other";
      descZh: string;
      descEn: string;
      remarkZh: string;
      remarkEn: string;
      amountJmd: number;
    }>;

export interface QuickOrderStatementLegacyItem {
  readonly id: string;
  readonly descZh: string;
  readonly descEn: string;
  readonly remarkZh: string;
  readonly remarkEn: string;
  readonly category: "labor" | "parts";
  readonly unit: string;
  readonly unitEn: string;
  readonly unitPriceJmd: number;
  readonly quantity: number;
  readonly pendingQuote: boolean;
}

export interface QuickOrderStatementLegacyTotals {
  readonly laborGrossJmd: number;
  readonly partsGrossJmd: number;
  readonly laborDiscountJmd: number;
  readonly partsDiscountJmd: number;
  readonly totalDiscountJmd: number;
  readonly grandTotalJmd: number;
}

export type QuickOrderStatementCharges =
  | Readonly<{
      kind: "legacy_quick";
      discountModel: "legacy_category_discount";
      items: ReadonlyArray<QuickOrderStatementLegacyItem>;
      totals: QuickOrderStatementLegacyTotals;
    }>
  | Readonly<{
      kind: "shared_uninvoiced";
      status: "provisional";
      lines: ReadonlyArray<QuickOrderStatementSharedLine>;
      totals: QuotedChargeTotals;
    }>
  | Readonly<{
      kind: "canonical_invoice";
      issuedAt: string;
      lines: ReadonlyArray<QuickOrderStatementCanonicalLine>;
      totals: InvoiceSnapshotTotals;
    }>;

export interface QuickOrderStatementPaymentEntry {
  readonly kind: "payment";
  readonly provenance: "business_order" | "legacy_quick" | "canonical_invoice";
  readonly sequence: number;
  readonly paymentId: string;
  readonly invoiceVersionId: string | null;
  readonly amountJmd: number;
  readonly occurredAt: string;
  readonly method: string | null;
  readonly actorName: string | null;
  readonly note: string | null;
}

export interface QuickOrderStatementLegacyRefundEntry {
  readonly kind: "refund";
  readonly accounting: "legacy_cash_only";
  readonly sequence: number;
  readonly refundId: string;
  readonly invoiceVersionId: null;
  readonly category: "labor" | "parts" | null;
  readonly lineDescription: string | null;
  readonly receivableReductionJmd: null;
  readonly cashRefundJmd: number;
  readonly occurredAt: string;
  readonly method: string | null;
  readonly actorName: string | null;
  readonly note: string | null;
}

export interface QuickOrderStatementCanonicalRefundEntry {
  readonly kind: "refund";
  readonly accounting: "canonical_line_v1";
  readonly sequence: number;
  readonly refundId: string;
  readonly invoiceVersionId: string;
  readonly line: Exclude<QuickOrderStatementCanonicalLine, { pricingMode: "parking_projection" }>;
  readonly refundQuantity: number | null;
  readonly wholeLine: boolean;
  readonly receivableReductionJmd: number;
  readonly cashRefundJmd: number;
  readonly occurredAt: string;
  readonly method: string;
  readonly actorName: string;
  readonly reason: string;
}

export interface QuickOrderStatementParkingCorrectionRefundEntry {
  readonly kind: "refund";
  readonly accounting: "parking_correction_v1";
  readonly sequence: number;
  readonly refundId: string;
  readonly invoiceVersionId: string;
  readonly parkingCaseId: string;
  readonly chargeLineId: string;
  readonly lineDescription: string;
  readonly receivableReductionJmd: 0;
  readonly cashRefundJmd: number;
  readonly occurredAt: string;
  readonly method: string;
  readonly actorName: string;
  readonly reason: string;
}

export type QuickOrderStatementEntry =
  | QuickOrderStatementPaymentEntry
  | QuickOrderStatementLegacyRefundEntry
  | QuickOrderStatementCanonicalRefundEntry
  | QuickOrderStatementParkingCorrectionRefundEntry;

export interface QuickOrderFinancialStatement {
  readonly contract: "quick_order_financial_statement_v1";
  readonly revision: number;
  readonly order: QuickOrderFinancialReadModel["order"];
  readonly source: QuickOrderFinancialSource;
  readonly charges: QuickOrderStatementCharges;
  readonly ledger: QuickOrderFinancialLedger;
  readonly entries: ReadonlyArray<QuickOrderStatementEntry>;
}

const TOP_FIELDS = ["contract", "revision", "order", "source", "charges", "ledger", "entries"] as const;
const ORDER_FIELDS = [
  "id", "businessOrderNo", "customerId", "vehicleId", "status", "voidedAt", "pickedUpAt", "paidInFullAt",
] as const;
const LEGACY_SOURCE_FIELDS = ["kind"] as const;
const CANONICAL_SOURCE_FIELDS = [
  "kind", "invoiceId", "invoiceNo", "effectiveVersionId", "versionNo", "snapshotCommitment",
] as const;
const LEDGER_FIELDS = [
  "invoiceTotalJmd", "receivableJmd", "grossPaidJmd", "cashRefundedJmd", "receivableReductionJmd",
  "netPaidJmd", "balanceJmd", "paymentStatus", "settlementStatus", "hasPaymentHistory",
] as const;
const LEGACY_CHARGES_FIELDS = ["kind", "discountModel", "items", "totals"] as const;
const SHARED_CHARGES_FIELDS = ["kind", "status", "lines", "totals"] as const;
const CANONICAL_CHARGES_FIELDS = ["kind", "issuedAt", "lines", "totals"] as const;
const LEGACY_ITEM_FIELDS = [
  "id", "descZh", "descEn", "remarkZh", "remarkEn", "category", "unit", "unitEn",
  "unitPriceJmd", "quantity", "pendingQuote",
] as const;
const SHARED_UNIT_FIELDS = [
  "id", "category", "pricingMode", "descZh", "descEn", "remarkZh", "remarkEn", "unit", "unitEn",
  "quantity", "unitPriceJmd", "unitDiscountJmd", "pendingQuote",
] as const;
const SHARED_FIXED_FIELDS = [
  "id", "category", "pricingMode", "code", "descZh", "descEn", "remarkZh", "remarkEn", "amountJmd",
] as const;
const CANONICAL_UNIT_FIELDS = [
  "pricingMode", "chargeLineId", "category", "descZh", "descEn", "remarkZh", "remarkEn", "unit", "unitEn",
  "quantity", "unitPriceJmd", "unitDiscountJmd", "finalUnitPriceJmd", "finalLineJmd",
] as const;
const CANONICAL_FIXED_FIELDS = [
  "pricingMode", "chargeLineId", "category", "code", "descZh", "descEn", "remarkZh", "remarkEn", "amountJmd",
] as const;
const CANONICAL_PARKING_FIELDS = [
  "pricingMode", "chargeLineId", "category", "code", "descZh", "descEn", "remarkZh", "remarkEn",
  "parkingCaseId", "sourceRevision", "asOf", "amountJmd",
] as const;
const CANONICAL_TOTAL_FIELDS = [
  "laborGrossJmd", "laborDiscountJmd", "laborNetJmd", "partsGrossJmd", "partsDiscountJmd", "partsNetJmd",
  "otherFeeTotalJmd", "parkingTotalJmd", "totalDiscountJmd", "chargeSubtotalJmd", "adjustmentsJmd", "grandTotalJmd",
] as const;
const SHARED_TOTAL_FIELDS = [
  "laborGrossJmd", "laborDiscountJmd", "laborNetJmd", "partsGrossJmd", "partsDiscountJmd", "partsNetJmd",
  "otherFeeTotalJmd", "parkingTotalJmd", "totalDiscountJmd", "pendingPartsCount", "chargeSubtotalJmd", "grandTotalJmd",
] as const;
const LEGACY_TOTAL_FIELDS = [
  "laborGrossJmd", "partsGrossJmd", "laborDiscountJmd", "partsDiscountJmd", "totalDiscountJmd", "grandTotalJmd",
] as const;
const PAYMENT_FIELDS = [
  "kind", "provenance", "sequence", "paymentId", "invoiceVersionId", "amountJmd", "occurredAt", "method", "actorName", "note",
] as const;
const LEGACY_REFUND_FIELDS = [
  "kind", "accounting", "sequence", "refundId", "invoiceVersionId", "category", "lineDescription",
  "receivableReductionJmd", "cashRefundJmd", "occurredAt", "method", "actorName", "note",
] as const;
const CANONICAL_REFUND_FIELDS = [
  "kind", "accounting", "sequence", "refundId", "invoiceVersionId", "line", "refundQuantity", "wholeLine",
  "receivableReductionJmd", "cashRefundJmd", "occurredAt", "method", "actorName", "reason",
] as const;
const PARKING_CORRECTION_REFUND_FIELDS = [
  "kind", "accounting", "sequence", "refundId", "invoiceVersionId", "parkingCaseId", "chargeLineId",
  "lineDescription", "receivableReductionJmd", "cashRefundJmd", "occurredAt", "method", "actorName", "reason",
] as const;

function assertClosedDataObject(
  value: unknown,
  fields: ReadonlyArray<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const expected = new Set(fields);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== fields.length) throw new TypeError(`${label} has an unexpected field count`);
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expected.has(key)) {
      throw new TypeError(`${label} has an unexpected field: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own enumerable data field`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${label}.${key} must not be undefined`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new TypeError(`${label}.${field} is missing`);
  }
}

function dataDiscriminant(value: unknown, field: string, label: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor) || descriptor.value === undefined) {
    throw new TypeError(`${label}.${field} must be an own enumerable data field`);
  }
  return descriptor.value;
}

function denseValues(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
    throw new TypeError(`${label}.length is invalid`);
  }
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) throw new TypeError(`${label} must be dense and have no extra fields`);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor) || descriptor.value === undefined) {
      throw new TypeError(`${label}[${index}] must be an own enumerable data field`);
    }
    result.push(descriptor.value);
  }
  if (ownKeys.some((key) => {
    if (key === "length") return false;
    return typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length;
  })) {
    throw new TypeError(`${label} has an unexpected field`);
  }
  return result;
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be non-empty`);
}

function assertNullableText(value: unknown, label: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") throw new TypeError(`${label} must be text or null`);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
}

function assertNonNegative(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertPositive(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
}

function safeAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} exceeds safe integer range`);
  return value;
}

function safeMultiply(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} exceeds safe integer range`);
  return value;
}

function assertFinancialCoordinates(value: Record<string, unknown>): QuickOrderFinancialSource["kind"] {
  assertClosedDataObject(value.order, ORDER_FIELDS, "statement order");
  const sourceKind = dataDiscriminant(value.source, "kind", "statement source");
  assertClosedDataObject(
    value.source,
    sourceKind === "canonical_invoice" ? CANONICAL_SOURCE_FIELDS : LEGACY_SOURCE_FIELDS,
    "statement source",
  );
  assertClosedDataObject(value.ledger, LEDGER_FIELDS, "statement ledger");
  if (sourceKind !== "legacy_quick" && sourceKind !== "shared_uninvoiced" && sourceKind !== "canonical_invoice") {
    throw new TypeError("statement source kind is invalid");
  }
  const order = value.order as unknown as QuickOrderFinancialReadModel["order"];
  const source = value.source as unknown as QuickOrderFinancialSource;
  const ledger = value.ledger as unknown as QuickOrderFinancialLedger;
  const active = order.voidedAt === null;
  const submitted = order.status === "submitted";
  const hasPaidFullMarker = order.paidInFullAt !== null;
  const canonicalPaidAndSettled = sourceKind === "canonical_invoice"
    && ledger.paymentStatus === "paid"
    && ledger.settlementStatus === "settled";
  assertQuickOrderFinancialReadModel({
    contract: "quick_order_financial_read_model_v1",
    revision: value.revision as number,
    order,
    source,
    ledger,
    gates: active
      ? {
          canCollectPayment: ledger.balanceJmd > 0,
          canRefund: false,
          canVoid: false,
          canRecordPaidFull: submitted && !hasPaidFullMarker && (
            sourceKind === "legacy_quick" || canonicalPaidAndSettled
          ),
          canCancelPaidFull: submitted && hasPaidFullMarker,
          completed: submitted
            && order.pickedUpAt !== null
            && hasPaidFullMarker
            && (sourceKind === "legacy_quick" || canonicalPaidAndSettled),
        }
      : {
          canCollectPayment: false,
          canRefund: false,
          canVoid: false,
          canRecordPaidFull: false,
          canCancelPaidFull: false,
          completed: false,
        },
  });
  return sourceKind;
}

function validateCanonicalLine(value: unknown, label: string, allowParking: boolean): InvoiceSnapshotLine {
  const pricingMode = dataDiscriminant(value, "pricingMode", label);
  assertClosedDataObject(
    value,
    pricingMode === "unit"
      ? CANONICAL_UNIT_FIELDS
      : pricingMode === "fixed_total"
        ? CANONICAL_FIXED_FIELDS
        : CANONICAL_PARKING_FIELDS,
    label,
  );
  if (pricingMode !== "unit" && pricingMode !== "fixed_total" && pricingMode !== "parking_projection") {
    throw new TypeError(`${label}.pricingMode is invalid`);
  }
  if (pricingMode === "parking_projection" && !allowParking) {
    throw new TypeError(`${label} cannot use parking projection`);
  }
  assertNonEmpty(value.chargeLineId, `${label}.chargeLineId`);
  for (const field of ["descZh", "descEn", "remarkZh", "remarkEn"] as const) {
    assertText(value[field], `${label}.${field}`);
  }
  if (pricingMode === "unit") {
    if (value.category !== "labor" && value.category !== "parts") throw new TypeError(`${label}.category is invalid`);
    assertNonEmpty(value.unit, `${label}.unit`);
    assertText(value.unitEn, `${label}.unitEn`);
    assertPositive(value.quantity, `${label}.quantity`);
    assertNonNegative(value.unitPriceJmd, `${label}.unitPriceJmd`);
    assertNonNegative(value.unitDiscountJmd, `${label}.unitDiscountJmd`);
    assertNonNegative(value.finalUnitPriceJmd, `${label}.finalUnitPriceJmd`);
    assertNonNegative(value.finalLineJmd, `${label}.finalLineJmd`);
    if (value.unitDiscountJmd > value.unitPriceJmd) throw new TypeError(`${label} discount exceeds price`);
    if (value.finalUnitPriceJmd !== value.unitPriceJmd - value.unitDiscountJmd) {
      throw new TypeError(`${label} final unit price is inconsistent`);
    }
    if (value.finalLineJmd !== safeMultiply(value.quantity, value.finalUnitPriceJmd, `${label} final line`)) {
      throw new TypeError(`${label} final line is inconsistent`);
    }
  } else if (pricingMode === "fixed_total") {
    if (value.category !== "other_service" || !["towing", "offsite_service", "other"].includes(value.code as string)) {
      throw new TypeError(`${label} fixed-total category/code is invalid`);
    }
    assertNonNegative(value.amountJmd, `${label}.amountJmd`);
  } else {
    if (value.category !== "other_service" || value.code !== "parking_overtime") {
      throw new TypeError(`${label} parking category/code is invalid`);
    }
    assertNonEmpty(value.parkingCaseId, `${label}.parkingCaseId`);
    assertPositive(value.sourceRevision, `${label}.sourceRevision`);
    assertTimestamp(value.asOf, `${label}.asOf`);
    assertNonNegative(value.amountJmd, `${label}.amountJmd`);
  }
  return value as unknown as InvoiceSnapshotLine;
}

function validateCanonicalCharges(value: unknown): {
  grandTotalJmd: number;
  lines: ReadonlyArray<InvoiceSnapshotLine>;
} {
  assertClosedDataObject(value, CANONICAL_CHARGES_FIELDS, "canonical statement charges");
  if (value.kind !== "canonical_invoice") throw new TypeError("canonical statement charges.kind is invalid");
  assertTimestamp(value.issuedAt, "canonical statement charges.issuedAt");
  const lines = denseValues(value.lines, "canonical statement lines")
    .map((line, index) => validateCanonicalLine(line, `canonical statement lines[${index}]`, true));
  if (lines.length === 0) throw new TypeError("canonical statement must contain at least one charge line");
  const ids = new Set<string>();
  const parkingCaseIds = new Set<string>();
  let laborGrossJmd = 0;
  let laborDiscountJmd = 0;
  let laborNetJmd = 0;
  let partsGrossJmd = 0;
  let partsDiscountJmd = 0;
  let partsNetJmd = 0;
  let otherFeeTotalJmd = 0;
  let parkingTotalJmd = 0;
  for (const line of lines) {
    if (ids.has(line.chargeLineId)) throw new TypeError("canonical statement contains duplicate charge line ID");
    ids.add(line.chargeLineId);
    if (line.pricingMode === "unit") {
      if (line.category === "labor") {
        laborGrossJmd = safeAdd(laborGrossJmd, safeMultiply(line.quantity, line.unitPriceJmd, "labor gross"), "labor gross");
        laborDiscountJmd = safeAdd(laborDiscountJmd, safeMultiply(line.quantity, line.unitDiscountJmd, "labor discount"), "labor discount");
        laborNetJmd = safeAdd(laborNetJmd, line.finalLineJmd, "labor net");
      } else {
        partsGrossJmd = safeAdd(partsGrossJmd, safeMultiply(line.quantity, line.unitPriceJmd, "parts gross"), "parts gross");
        partsDiscountJmd = safeAdd(partsDiscountJmd, safeMultiply(line.quantity, line.unitDiscountJmd, "parts discount"), "parts discount");
        partsNetJmd = safeAdd(partsNetJmd, line.finalLineJmd, "parts net");
      }
    } else if (line.pricingMode === "fixed_total") {
      otherFeeTotalJmd = safeAdd(otherFeeTotalJmd, line.amountJmd, "other fee total");
    } else {
      if (parkingCaseIds.has(line.parkingCaseId)) {
        throw new TypeError("canonical statement contains duplicate parking case ID");
      }
      parkingCaseIds.add(line.parkingCaseId);
      parkingTotalJmd = safeAdd(parkingTotalJmd, line.amountJmd, "parking total");
    }
  }
  assertClosedDataObject(value.totals, CANONICAL_TOTAL_FIELDS, "canonical statement totals");
  for (const field of CANONICAL_TOTAL_FIELDS) {
    if (field === "adjustmentsJmd") assertSafeInteger(value.totals[field], `canonical totals.${field}`);
    else assertNonNegative(value.totals[field], `canonical totals.${field}`);
  }
  const totalDiscountJmd = safeAdd(laborDiscountJmd, partsDiscountJmd, "total discount");
  const chargeSubtotalJmd = [laborNetJmd, partsNetJmd, otherFeeTotalJmd, parkingTotalJmd]
    .reduce((total, item) => safeAdd(total, item, "charge subtotal"), 0);
  const expected = {
    laborGrossJmd,
    laborDiscountJmd,
    laborNetJmd,
    partsGrossJmd,
    partsDiscountJmd,
    partsNetJmd,
    otherFeeTotalJmd,
    parkingTotalJmd,
    totalDiscountJmd,
    chargeSubtotalJmd,
    adjustmentsJmd: value.totals.adjustmentsJmd,
    grandTotalJmd: safeAdd(chargeSubtotalJmd, value.totals.adjustmentsJmd as number, "grand total"),
  };
  for (const field of CANONICAL_TOTAL_FIELDS) {
    if (value.totals[field] !== expected[field]) throw new TypeError(`canonical totals.${field} is inconsistent`);
  }
  return { grandTotalJmd: expected.grandTotalJmd, lines };
}

function validateSharedLine(value: unknown, label: string): QuickOrderStatementSharedLine {
  const pricingMode = dataDiscriminant(value, "pricingMode", label);
  assertClosedDataObject(value, pricingMode === "unit" ? SHARED_UNIT_FIELDS : SHARED_FIXED_FIELDS, label);
  assertNonEmpty(value.id, `${label}.id`);
  for (const field of ["descZh", "descEn", "remarkZh", "remarkEn"] as const) assertText(value[field], `${label}.${field}`);
  if (pricingMode === "unit") {
    if (value.category !== "labor" && value.category !== "parts") throw new TypeError(`${label}.category is invalid`);
    assertNonEmpty(value.unit, `${label}.unit`);
    assertText(value.unitEn, `${label}.unitEn`);
    assertPositive(value.quantity, `${label}.quantity`);
    assertNonNegative(value.unitPriceJmd, `${label}.unitPriceJmd`);
    assertNonNegative(value.unitDiscountJmd, `${label}.unitDiscountJmd`);
    if (value.unitDiscountJmd > value.unitPriceJmd) throw new TypeError(`${label} discount exceeds price`);
    if (typeof value.pendingQuote !== "boolean") throw new TypeError(`${label}.pendingQuote is invalid`);
    if (value.pendingQuote && (value.category !== "parts" || value.unitDiscountJmd !== 0)) {
      throw new TypeError(`${label} pending quote is invalid`);
    }
  } else if (pricingMode === "fixed_total") {
    if (value.category !== "other_service" || !["towing", "offsite_service", "other"].includes(value.code as string)) {
      throw new TypeError(`${label} fixed-total category/code is invalid`);
    }
    assertNonNegative(value.amountJmd, `${label}.amountJmd`);
  } else {
    throw new TypeError(`${label}.pricingMode is invalid`);
  }
  return value as unknown as QuickOrderStatementSharedLine;
}

function sharedTotals(lines: ReadonlyArray<QuickOrderStatementSharedLine>): QuotedChargeTotals {
  let laborGrossJmd = 0;
  let laborDiscountJmd = 0;
  let laborNetJmd = 0;
  let partsGrossJmd = 0;
  let partsDiscountJmd = 0;
  let partsNetJmd = 0;
  let otherFeeTotalJmd = 0;
  let pendingPartsCount = 0;
  for (const line of lines) {
    if (line.pricingMode === "fixed_total") {
      otherFeeTotalJmd = safeAdd(otherFeeTotalJmd, line.amountJmd, "shared other fee");
      continue;
    }
    if (line.pendingQuote) {
      pendingPartsCount += 1;
      continue;
    }
    const gross = safeMultiply(line.quantity, line.unitPriceJmd, "shared gross");
    const discount = safeMultiply(line.quantity, line.unitDiscountJmd, "shared discount");
    const net = safeMultiply(line.quantity, line.unitPriceJmd - line.unitDiscountJmd, "shared net");
    if (line.category === "labor") {
      laborGrossJmd = safeAdd(laborGrossJmd, gross, "shared labor gross");
      laborDiscountJmd = safeAdd(laborDiscountJmd, discount, "shared labor discount");
      laborNetJmd = safeAdd(laborNetJmd, net, "shared labor net");
    } else {
      partsGrossJmd = safeAdd(partsGrossJmd, gross, "shared parts gross");
      partsDiscountJmd = safeAdd(partsDiscountJmd, discount, "shared parts discount");
      partsNetJmd = safeAdd(partsNetJmd, net, "shared parts net");
    }
  }
  const totalDiscountJmd = safeAdd(laborDiscountJmd, partsDiscountJmd, "shared total discount");
  const chargeSubtotalJmd = [laborNetJmd, partsNetJmd, otherFeeTotalJmd]
    .reduce((total, item) => safeAdd(total, item, "shared subtotal"), 0);
  return {
    laborGrossJmd,
    laborDiscountJmd,
    laborNetJmd,
    partsGrossJmd,
    partsDiscountJmd,
    partsNetJmd,
    otherFeeTotalJmd,
    parkingTotalJmd: 0,
    totalDiscountJmd,
    pendingPartsCount,
    chargeSubtotalJmd,
    grandTotalJmd: chargeSubtotalJmd,
  };
}

function validateSharedCharges(value: unknown): { grandTotalJmd: number } {
  assertClosedDataObject(value, SHARED_CHARGES_FIELDS, "shared-uninvoiced statement charges");
  if (value.kind !== "shared_uninvoiced" || value.status !== "provisional") {
    throw new TypeError("shared-uninvoiced charges kind/status is invalid");
  }
  const ids = new Set<string>();
  const lines = denseValues(value.lines, "shared-uninvoiced statement lines")
    .map((line, index) => validateSharedLine(line, `shared-uninvoiced lines[${index}]`));
  if (lines.length === 0) throw new TypeError("shared-uninvoiced statement must contain at least one charge line");
  for (const line of lines) {
    if (ids.has(line.id)) throw new TypeError("shared-uninvoiced statement contains duplicate line ID");
    ids.add(line.id);
  }
  assertClosedDataObject(value.totals, SHARED_TOTAL_FIELDS, "shared-uninvoiced statement totals");
  const expected = sharedTotals(lines);
  for (const field of SHARED_TOTAL_FIELDS) {
    assertNonNegative(value.totals[field], `shared totals.${field}`);
    if (value.totals[field] !== expected[field]) throw new TypeError(`shared totals.${field} is inconsistent`);
  }
  return { grandTotalJmd: expected.grandTotalJmd };
}

function validateLegacyCharges(value: unknown): { grandTotalJmd: number } {
  assertClosedDataObject(value, LEGACY_CHARGES_FIELDS, "legacy statement charges");
  if (value.kind !== "legacy_quick" || value.discountModel !== "legacy_category_discount") {
    throw new TypeError("legacy statement charges kind/discountModel is invalid");
  }
  const ids = new Set<string>();
  let laborGrossJmd = 0;
  let partsGrossJmd = 0;
  for (const [index, item] of denseValues(value.items, "legacy statement items").entries()) {
    assertClosedDataObject(item, LEGACY_ITEM_FIELDS, `legacy statement items[${index}]`);
    assertNonEmpty(item.id, `legacy items[${index}].id`);
    if (ids.has(item.id)) throw new TypeError("legacy statement contains duplicate item ID");
    ids.add(item.id);
    for (const field of ["descZh", "descEn", "remarkZh", "remarkEn"] as const) assertText(item[field], `legacy item.${field}`);
    if (item.category !== "labor" && item.category !== "parts") throw new TypeError("legacy item category is invalid");
    assertNonEmpty(item.unit, "legacy item.unit");
    assertText(item.unitEn, "legacy item.unitEn");
    assertNonNegative(item.unitPriceJmd, "legacy item.unitPriceJmd");
    assertPositive(item.quantity, "legacy item.quantity");
    if (typeof item.pendingQuote !== "boolean") throw new TypeError("legacy item.pendingQuote is invalid");
    if (item.pendingQuote && item.category !== "parts") throw new TypeError("legacy pending quote is invalid");
    if (!item.pendingQuote) {
      const amount = safeMultiply(item.unitPriceJmd, item.quantity, "legacy item total");
      if (item.category === "labor") laborGrossJmd = safeAdd(laborGrossJmd, amount, "legacy labor gross");
      else partsGrossJmd = safeAdd(partsGrossJmd, amount, "legacy parts gross");
    }
  }
  assertClosedDataObject(value.totals, LEGACY_TOTAL_FIELDS, "legacy statement totals");
  for (const field of LEGACY_TOTAL_FIELDS) assertNonNegative(value.totals[field], `legacy totals.${field}`);
  if (value.totals.laborGrossJmd !== laborGrossJmd || value.totals.partsGrossJmd !== partsGrossJmd) {
    throw new TypeError("legacy gross totals are inconsistent");
  }
  if (
    (value.totals.laborDiscountJmd as number) > laborGrossJmd
    || (value.totals.partsDiscountJmd as number) > partsGrossJmd
  ) {
    throw new TypeError("legacy discount exceeds category gross");
  }
  const totalDiscountJmd = safeAdd(value.totals.laborDiscountJmd as number, value.totals.partsDiscountJmd as number, "legacy discount");
  const grandTotalJmd = laborGrossJmd + partsGrossJmd - totalDiscountJmd;
  if (!Number.isSafeInteger(grandTotalJmd) || grandTotalJmd < 0) throw new TypeError("legacy grand total is invalid");
  if (value.totals.totalDiscountJmd !== totalDiscountJmd || value.totals.grandTotalJmd !== grandTotalJmd) {
    throw new TypeError("legacy totals are inconsistent");
  }
  return { grandTotalJmd };
}

function validateEntries(
  value: unknown,
  sourceKind: QuickOrderFinancialSource["kind"],
  currentCanonicalLines: ReadonlyArray<InvoiceSnapshotLine>,
): Readonly<{
  grossPaidJmd: number;
  cashRefundedJmd: number;
  receivableReductionJmd: number;
  hasPaymentHistory: boolean;
}> {
  const entries = denseValues(value, "statement entries");
  const paymentIds = new Set<string>();
  const refundIds = new Set<string>();
  const canonicalRefundSnapshots = new Map<string, string>();
  const canonicalRefundCoordinates = new Map<string, Readonly<{
    pricingMode: "unit" | "fixed_total";
    category: "labor" | "parts" | "other_service";
  }>>();
  const canonicalRefundOccupancy = new Map<string, Readonly<{
    refundedQuantity: number;
    reductionJmd: number;
    refundCount: number;
  }>>();
  const currentCanonicalLinesById = new Map(
    currentCanonicalLines.map((line) => [line.chargeLineId, line] as const),
  );
  let grossPaidJmd = 0;
  let cashRefundedJmd = 0;
  let receivableReductionJmd = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const kind = dataDiscriminant(entry, "kind", `statement entries[${index}]`);
    if (kind === "payment") {
      assertClosedDataObject(entry, PAYMENT_FIELDS, `statement payment entries[${index}]`);
      if (entry.provenance !== "business_order" && entry.provenance !== sourceKind) {
        throw new TypeError("statement payment provenance is invalid");
      }
      if (entry.sequence !== index + 1) throw new TypeError("statement entry sequence is invalid");
      assertNonEmpty(entry.paymentId, "statement paymentId");
      if (paymentIds.has(entry.paymentId)) throw new TypeError("statement contains duplicate payment ID");
      paymentIds.add(entry.paymentId);
      if (entry.provenance === "business_order" || sourceKind === "legacy_quick") {
        if (entry.invoiceVersionId !== null) throw new TypeError("legacy payment cannot reference Invoice version");
      } else {
        assertNonEmpty(entry.invoiceVersionId, "canonical payment invoiceVersionId");
      }
      assertPositive(entry.amountJmd, "statement payment amount");
      assertTimestamp(entry.occurredAt, "statement payment occurredAt");
      assertNullableText(entry.method, "statement payment method");
      assertNullableText(entry.actorName, "statement payment actorName");
      assertNullableText(entry.note, "statement payment note");
      grossPaidJmd = safeAdd(grossPaidJmd, entry.amountJmd, "statement gross paid");
      continue;
    }
    if (kind !== "refund") throw new TypeError("statement entry kind is invalid");
    const accounting = dataDiscriminant(entry, "accounting", `statement refund entries[${index}]`);
    if (accounting === "legacy_cash_only") {
      assertClosedDataObject(entry, LEGACY_REFUND_FIELDS, `legacy refund entries[${index}]`);
      if (entry.sequence !== index + 1) throw new TypeError("statement entry sequence is invalid");
      assertNonEmpty(entry.refundId, "legacy refundId");
      if (refundIds.has(entry.refundId)) throw new TypeError("statement contains duplicate refund ID");
      refundIds.add(entry.refundId);
      if (entry.invoiceVersionId !== null || entry.receivableReductionJmd !== null) {
        throw new TypeError("legacy refund cannot expose canonical coordinates");
      }
      if (entry.category !== null && entry.category !== "labor" && entry.category !== "parts") {
        throw new TypeError("legacy refund category is invalid");
      }
      assertNullableText(entry.lineDescription, "legacy refund lineDescription");
      assertPositive(entry.cashRefundJmd, "legacy refund cash");
      assertTimestamp(entry.occurredAt, "legacy refund occurredAt");
      assertNullableText(entry.method, "legacy refund method");
      assertNullableText(entry.actorName, "legacy refund actorName");
      assertNullableText(entry.note, "legacy refund note");
      cashRefundedJmd = safeAdd(cashRefundedJmd, entry.cashRefundJmd, "statement cash refunded");
      continue;
    }
    if (accounting === "parking_correction_v1") {
      assertClosedDataObject(entry, PARKING_CORRECTION_REFUND_FIELDS, `parking correction entries[${index}]`);
      if (sourceKind !== "canonical_invoice") throw new TypeError("parking correction is invalid for this source");
      if (entry.sequence !== index + 1) throw new TypeError("statement entry sequence is invalid");
      assertNonEmpty(entry.refundId, "parking correction refundId");
      if (refundIds.has(entry.refundId)) throw new TypeError("statement contains duplicate refund ID");
      refundIds.add(entry.refundId);
      assertNonEmpty(entry.invoiceVersionId, "parking correction invoiceVersionId");
      assertNonEmpty(entry.parkingCaseId, "parking correction caseId");
      assertNonEmpty(entry.chargeLineId, "parking correction chargeLineId");
      assertText(entry.lineDescription, "parking correction lineDescription");
      if (entry.receivableReductionJmd !== 0) throw new TypeError("parking correction reduction is represented by its Invoice version");
      assertPositive(entry.cashRefundJmd, "parking correction cash");
      assertTimestamp(entry.occurredAt, "parking correction occurredAt");
      assertText(entry.method, "parking correction method");
      assertText(entry.actorName, "parking correction actorName");
      assertText(entry.reason, "parking correction reason");
      cashRefundedJmd = safeAdd(cashRefundedJmd, entry.cashRefundJmd, "statement cash refunded");
      continue;
    }
    if (accounting !== "canonical_line_v1") throw new TypeError("statement refund accounting is invalid");
    assertClosedDataObject(entry, CANONICAL_REFUND_FIELDS, `canonical refund entries[${index}]`);
    if (sourceKind !== "canonical_invoice") throw new TypeError("canonical refund is invalid for this source");
    if (entry.sequence !== index + 1) throw new TypeError("statement entry sequence is invalid");
    assertNonEmpty(entry.refundId, "canonical refundId");
    if (refundIds.has(entry.refundId)) throw new TypeError("statement contains duplicate refund ID");
    refundIds.add(entry.refundId);
    assertNonEmpty(entry.invoiceVersionId, "canonical refund invoiceVersionId");
    const line = validateCanonicalLine(entry.line, "canonical refund line", false);
    if (line.pricingMode === "parking_projection") {
      throw new TypeError("parking projection cannot be an ordinary refund line");
    }
    assertPositive(entry.receivableReductionJmd, "canonical refund reduction");
    assertNonNegative(entry.cashRefundJmd, "canonical refund cash");
    if (entry.cashRefundJmd > entry.receivableReductionJmd) throw new TypeError("canonical refund cash exceeds reduction");
    if (typeof entry.wholeLine !== "boolean") throw new TypeError("canonical refund wholeLine is invalid");
    if (line.pricingMode === "unit") {
      assertPositive(entry.refundQuantity, "canonical unit refund quantity");
      if (entry.wholeLine !== false || entry.refundQuantity > line.quantity) {
        throw new TypeError("canonical unit refund coordinate is invalid");
      }
      const requestedReductionJmd = safeMultiply(
        entry.refundQuantity,
        line.finalUnitPriceJmd,
        "refund requested reduction",
      );
      if (entry.receivableReductionJmd > requestedReductionJmd) {
        throw new TypeError("canonical unit refund reduction is inconsistent");
      }
    } else {
      if (entry.refundQuantity !== null || entry.wholeLine !== true || entry.receivableReductionJmd !== line.amountJmd) {
        throw new TypeError("canonical fixed refund coordinate is invalid");
      }
    }
    const snapshotKey = `${entry.invoiceVersionId}\u0000${line.chargeLineId}`;
    const fingerprint = line.pricingMode === "unit"
      ? JSON.stringify([
          line.pricingMode, line.chargeLineId, line.category, line.descZh, line.descEn,
          line.remarkZh, line.remarkEn, line.unit, line.unitEn, line.quantity,
          line.unitPriceJmd, line.unitDiscountJmd, line.finalUnitPriceJmd, line.finalLineJmd,
        ])
      : JSON.stringify([
          line.pricingMode, line.chargeLineId, line.category, line.code, line.descZh,
          line.descEn, line.remarkZh, line.remarkEn, line.amountJmd,
        ]);
    const priorFingerprint = canonicalRefundSnapshots.get(snapshotKey);
    if (priorFingerprint && priorFingerprint !== fingerprint) {
      throw new TypeError("canonical refunds disagree on their immutable line snapshot");
    }
    canonicalRefundSnapshots.set(snapshotKey, fingerprint);
    const priorCoordinates = canonicalRefundCoordinates.get(line.chargeLineId);
    if (priorCoordinates
      && (priorCoordinates.pricingMode !== line.pricingMode || priorCoordinates.category !== line.category)) {
      throw new TypeError("canonical refunds disagree on stable line coordinates");
    }
    canonicalRefundCoordinates.set(line.chargeLineId, {
      pricingMode: line.pricingMode,
      category: line.category,
    });
    const currentLine = currentCanonicalLinesById.get(line.chargeLineId);
    if (currentLine
      && (currentLine.pricingMode !== line.pricingMode || currentLine.category !== line.category)) {
      throw new TypeError("canonical refund line is absent from the effective snapshot lineage");
    }
    const priorOccupancy = canonicalRefundOccupancy.get(line.chargeLineId);
    const reductionJmd = safeAdd(
      priorOccupancy?.reductionJmd ?? 0,
      entry.receivableReductionJmd,
      "canonical aggregate refund reduction",
    );
    if (line.pricingMode === "unit") {
      const refundedQuantity = safeAdd(
        priorOccupancy?.refundedQuantity ?? 0,
        entry.refundQuantity as number,
        "canonical aggregate refund quantity",
      );
      if (refundedQuantity > line.quantity || reductionJmd > line.finalLineJmd) {
        throw new TypeError("canonical aggregate refund quantity exceeds the historical snapshot line");
      }
      if (currentLine
        && (currentLine.pricingMode !== "unit"
          || refundedQuantity > currentLine.quantity
          || reductionJmd > currentLine.finalLineJmd)) {
        throw new TypeError("canonical aggregate refund quantity exceeds the snapshot line");
      }
      canonicalRefundOccupancy.set(line.chargeLineId, {
        refundedQuantity,
        reductionJmd,
        refundCount: (priorOccupancy?.refundCount ?? 0) + 1,
      });
    } else {
      const refundCount = (priorOccupancy?.refundCount ?? 0) + 1;
      if (refundCount > 1) {
        throw new TypeError("canonical fixed-total line can only be refunded once");
      }
      if (currentLine
        && (currentLine.pricingMode !== "fixed_total" || currentLine.amountJmd !== line.amountJmd)) {
        throw new TypeError("canonical fixed-total line amount changed across versions");
      }
      canonicalRefundOccupancy.set(line.chargeLineId, {
        refundedQuantity: 0,
        reductionJmd,
        refundCount,
      });
    }
    assertTimestamp(entry.occurredAt, "canonical refund occurredAt");
    assertText(entry.method, "canonical refund method");
    assertText(entry.actorName, "canonical refund actorName");
    assertText(entry.reason, "canonical refund reason");
    cashRefundedJmd = safeAdd(cashRefundedJmd, entry.cashRefundJmd, "statement cash refunded");
    receivableReductionJmd = safeAdd(receivableReductionJmd, entry.receivableReductionJmd, "statement reduction");
  }
  return {
    grossPaidJmd,
    cashRefundedJmd,
    receivableReductionJmd,
    hasPaymentHistory: paymentIds.size > 0,
  };
}

export function assertQuickOrderFinancialStatement(
  value: unknown,
): asserts value is QuickOrderFinancialStatement {
  assertClosedDataObject(value, TOP_FIELDS, "QuickOrder financial statement");
  if (value.contract !== "quick_order_financial_statement_v1") throw new TypeError("QuickOrder statement contract is invalid");
  assertNonNegative(value.revision, "QuickOrder statement revision");
  const sourceKind = assertFinancialCoordinates(value);
  const chargesKind = dataDiscriminant(value.charges, "kind", "statement charges");
  if (chargesKind !== sourceKind) throw new TypeError("statement source and charges kinds differ");
  const canonicalCharges = sourceKind === "canonical_invoice"
    ? validateCanonicalCharges(value.charges)
    : null;
  const charges = canonicalCharges
    ?? (sourceKind === "shared_uninvoiced"
      ? validateSharedCharges(value.charges)
      : validateLegacyCharges(value.charges));
  const entries = validateEntries(value.entries, sourceKind, canonicalCharges?.lines ?? []);
  const ledger = value.ledger as unknown as QuickOrderFinancialLedger;
  const expectedInvoiceTotalJmd = sourceKind === "shared_uninvoiced" ? null : charges.grandTotalJmd;
  if (ledger.invoiceTotalJmd !== expectedInvoiceTotalJmd) throw new TypeError("statement Invoice total differs from charges");
  const expectedReceivableJmd = sourceKind === "shared_uninvoiced"
    ? charges.grandTotalJmd
    : charges.grandTotalJmd - entries.receivableReductionJmd;
  if (!Number.isSafeInteger(expectedReceivableJmd) || expectedReceivableJmd < 0) {
    throw new TypeError("statement receivable reduction exceeds charges");
  }
  if (
    ledger.receivableJmd !== expectedReceivableJmd
    || ledger.grossPaidJmd !== entries.grossPaidJmd
    || ledger.cashRefundedJmd !== entries.cashRefundedJmd
    || ledger.receivableReductionJmd !== entries.receivableReductionJmd
    || ledger.hasPaymentHistory !== entries.hasPaymentHistory
  ) {
    throw new TypeError("statement ledger does not conserve its entries");
  }
}
