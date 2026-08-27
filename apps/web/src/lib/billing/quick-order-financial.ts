import type { QuickBoStatus } from "../orders/quick-order-types";
import type { OrderSettlementStatus } from "../orders/types";
import type { PaymentStatus } from "./types";

export type QuickOrderFinancialSource =
  | Readonly<{ kind: "legacy_quick" }>
  | Readonly<{ kind: "shared_uninvoiced" }>
  | Readonly<{
      kind: "canonical_invoice";
      invoiceId: string;
      invoiceNo: string;
      effectiveVersionId: string;
      versionNo: number;
      snapshotCommitment: string;
    }>;

export interface QuickOrderFinancialLedger {
  readonly invoiceTotalJmd: number | null;
  readonly receivableJmd: number;
  readonly grossPaidJmd: number;
  readonly cashRefundedJmd: number;
  readonly receivableReductionJmd: number;
  readonly netPaidJmd: number;
  readonly balanceJmd: number;
  readonly paymentStatus: PaymentStatus;
  readonly settlementStatus: OrderSettlementStatus;
  readonly hasPaymentHistory: boolean;
}

export interface QuickOrderFinancialGates {
  readonly canCollectPayment: boolean;
  readonly canRefund: boolean;
  readonly canVoid: boolean;
  readonly canRecordPaidFull: boolean;
  readonly canCancelPaidFull: boolean;
  readonly completed: boolean;
}

export interface QuickOrderFinancialReadModel {
  readonly contract: "quick_order_financial_read_model_v1";
  readonly revision: number;
  readonly order: Readonly<{
    id: string;
    businessOrderNo: string;
    customerId: string;
    vehicleId: string;
    status: QuickBoStatus;
    voidedAt: string | null;
    pickedUpAt: string | null;
    paidInFullAt: string | null;
  }>;
  readonly source: QuickOrderFinancialSource;
  readonly ledger: QuickOrderFinancialLedger;
  readonly gates: QuickOrderFinancialGates;
}

export interface QuickOrderFinancialListResponse {
  readonly revision: number;
  readonly items: ReadonlyArray<QuickOrderFinancialReadModel>;
}

const TOP_FIELDS = ["contract", "revision", "order", "source", "ledger", "gates"] as const;
const LIST_FIELDS = ["revision", "items"] as const;
const ORDER_FIELDS = [
  "id", "businessOrderNo", "customerId", "vehicleId", "status",
  "voidedAt", "pickedUpAt", "paidInFullAt",
] as const;
const LEGACY_SOURCE_FIELDS = ["kind"] as const;
const CANONICAL_SOURCE_FIELDS = [
  "kind", "invoiceId", "invoiceNo", "effectiveVersionId", "versionNo", "snapshotCommitment",
] as const;
const LEDGER_FIELDS = [
  "invoiceTotalJmd", "receivableJmd", "grossPaidJmd", "cashRefundedJmd",
  "receivableReductionJmd", "netPaidJmd", "balanceJmd", "paymentStatus",
  "settlementStatus", "hasPaymentHistory",
] as const;
const GATE_FIELDS = [
  "canCollectPayment", "canRefund", "canVoid", "canRecordPaidFull",
  "canCancelPaidFull", "completed",
] as const;
const QUICK_STATUSES = new Set<QuickBoStatus>([
  "pending_assign", "assigned", "in_repair", "stalled", "returned", "submitted",
]);
const PAYMENT_STATUSES = new Set<PaymentStatus>(["unpaid", "partially_paid", "paid"]);
const SETTLEMENT_STATUSES = new Set<OrderSettlementStatus>(["due", "settled", "overpaid"]);

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
      throw new TypeError(`${label}.${key} must be an own enumerable data field, not an accessor`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${label}.${key} must not be undefined`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new TypeError(`${label}.${field} is missing`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be non-empty`);
}

function assertNullableString(value: unknown, label: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") throw new TypeError(`${label} must be a string or null`);
}

function assertNullableTimestamp(value: unknown, label: string): asserts value is string | null {
  assertNullableString(value, label);
  if (value !== null && (value.trim().length === 0 || !Number.isFinite(Date.parse(value)))) {
    throw new TypeError(`${label} must be a valid timestamp or null`);
  }
}

function assertSafeNonNegative(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
}

export function assertQuickOrderFinancialReadModel(
  value: unknown,
): asserts value is QuickOrderFinancialReadModel {
  assertClosedDataObject(value, TOP_FIELDS, "QuickOrder financial read model");
  if (value.contract !== "quick_order_financial_read_model_v1") throw new TypeError("QuickOrder financial contract is invalid");
  assertSafeNonNegative(value.revision, "QuickOrder financial revision");

  assertClosedDataObject(value.order, ORDER_FIELDS, "QuickOrder financial order");
  assertNonEmptyString(value.order.id, "QuickOrder financial order.id");
  assertNonEmptyString(value.order.businessOrderNo, "QuickOrder financial order.businessOrderNo");
  assertNonEmptyString(value.order.customerId, "QuickOrder financial order.customerId");
  assertNonEmptyString(value.order.vehicleId, "QuickOrder financial order.vehicleId");
  if (!QUICK_STATUSES.has(value.order.status as QuickBoStatus)) throw new TypeError("QuickOrder financial order.status is invalid");
  assertNullableTimestamp(value.order.voidedAt, "QuickOrder financial order.voidedAt");
  assertNullableTimestamp(value.order.pickedUpAt, "QuickOrder financial order.pickedUpAt");
  assertNullableTimestamp(value.order.paidInFullAt, "QuickOrder financial order.paidInFullAt");

  if (value.source === null || typeof value.source !== "object" || Array.isArray(value.source)) {
    throw new TypeError("QuickOrder financial source must be an object");
  }
  const sourceKindDescriptor = Object.getOwnPropertyDescriptor(value.source, "kind");
  if (
    !sourceKindDescriptor
    || sourceKindDescriptor.enumerable !== true
    || !("value" in sourceKindDescriptor)
    || sourceKindDescriptor.value === undefined
  ) {
    throw new TypeError("QuickOrder financial source.kind must be an own enumerable data field, not an accessor");
  }
  const sourceKind = sourceKindDescriptor.value;
  assertClosedDataObject(
    value.source,
    sourceKind === "canonical_invoice" ? CANONICAL_SOURCE_FIELDS : LEGACY_SOURCE_FIELDS,
    "QuickOrder financial source",
  );
  if (sourceKind !== "legacy_quick" && sourceKind !== "shared_uninvoiced" && sourceKind !== "canonical_invoice") {
    throw new TypeError("QuickOrder financial source.kind is invalid");
  }
  if (sourceKind === "canonical_invoice") {
    assertNonEmptyString(value.source.invoiceId, "QuickOrder financial source.invoiceId");
    assertNonEmptyString(value.source.invoiceNo, "QuickOrder financial source.invoiceNo");
    assertNonEmptyString(value.source.effectiveVersionId, "QuickOrder financial source.effectiveVersionId");
    if (!Number.isSafeInteger(value.source.versionNo) || (value.source.versionNo as number) <= 0) {
      throw new TypeError("QuickOrder financial source.versionNo must be positive");
    }
    assertNonEmptyString(value.source.snapshotCommitment, "QuickOrder financial source.snapshotCommitment");
    if (!/^sha256-utf16le:[a-f0-9]{64}$/u.test(value.source.snapshotCommitment)) {
      throw new TypeError("QuickOrder financial source.snapshotCommitment is invalid");
    }
  }

  assertClosedDataObject(value.ledger, LEDGER_FIELDS, "QuickOrder financial ledger");
  if (value.ledger.invoiceTotalJmd !== null) {
    assertSafeNonNegative(value.ledger.invoiceTotalJmd, "QuickOrder financial ledger.invoiceTotalJmd");
  }
  assertSafeNonNegative(value.ledger.receivableJmd, "QuickOrder financial ledger.receivableJmd");
  assertSafeNonNegative(value.ledger.grossPaidJmd, "QuickOrder financial ledger.grossPaidJmd");
  assertSafeNonNegative(value.ledger.cashRefundedJmd, "QuickOrder financial ledger.cashRefundedJmd");
  assertSafeNonNegative(value.ledger.receivableReductionJmd, "QuickOrder financial ledger.receivableReductionJmd");
  assertSafeInteger(value.ledger.netPaidJmd, "QuickOrder financial ledger.netPaidJmd");
  assertSafeInteger(value.ledger.balanceJmd, "QuickOrder financial ledger.balanceJmd");
  if (!PAYMENT_STATUSES.has(value.ledger.paymentStatus as PaymentStatus)) throw new TypeError("QuickOrder financial paymentStatus is invalid");
  if (!SETTLEMENT_STATUSES.has(value.ledger.settlementStatus as OrderSettlementStatus)) {
    throw new TypeError("QuickOrder financial settlementStatus is invalid");
  }
  assertBoolean(value.ledger.hasPaymentHistory, "QuickOrder financial ledger.hasPaymentHistory");
  if (value.ledger.netPaidJmd !== value.ledger.grossPaidJmd - value.ledger.cashRefundedJmd) {
    throw new TypeError("QuickOrder financial net paid conservation is invalid");
  }
  if (value.ledger.balanceJmd !== value.ledger.receivableJmd - value.ledger.netPaidJmd) {
    throw new TypeError("QuickOrder financial balance conservation is invalid");
  }
  if (sourceKind === "shared_uninvoiced" && value.ledger.invoiceTotalJmd !== null) {
    throw new TypeError("Shared uninvoiced source must not expose an Invoice total");
  }
  if (sourceKind !== "shared_uninvoiced" && value.ledger.invoiceTotalJmd === null) {
    throw new TypeError("Invoiced or legacy source must expose its total");
  }
  if (value.ledger.invoiceTotalJmd !== null) {
    if (value.ledger.receivableReductionJmd > value.ledger.invoiceTotalJmd) {
      throw new TypeError("QuickOrder financial receivable reduction exceeds Invoice total");
    }
    if (value.ledger.receivableJmd !== value.ledger.invoiceTotalJmd - value.ledger.receivableReductionJmd) {
      throw new TypeError("QuickOrder financial receivable conservation is invalid");
    }
  }
  if (sourceKind === "legacy_quick" && value.ledger.receivableReductionJmd !== 0) {
    throw new TypeError("Legacy Quick source cannot expose canonical receivable reduction");
  }
  if (sourceKind === "shared_uninvoiced" && value.ledger.receivableReductionJmd !== 0) {
    throw new TypeError("Shared uninvoiced Business Order money history cannot reduce charge receivable");
  }
  const expectedPaymentStatus: PaymentStatus = value.ledger.netPaidJmd <= 0
    ? "unpaid"
    : value.ledger.netPaidJmd < value.ledger.receivableJmd
      ? "partially_paid"
      : "paid";
  if (value.ledger.paymentStatus !== expectedPaymentStatus) {
    throw new TypeError("QuickOrder financial paymentStatus is invalid");
  }
  const expectedSettlementStatus: OrderSettlementStatus = value.ledger.balanceJmd > 0
    ? "due"
    : value.ledger.balanceJmd < 0
      ? "overpaid"
      : "settled";
  if (value.ledger.settlementStatus !== expectedSettlementStatus) {
    throw new TypeError("QuickOrder financial settlementStatus is invalid");
  }
  if (value.ledger.grossPaidJmd > 0 && value.ledger.hasPaymentHistory !== true) {
    throw new TypeError("QuickOrder financial payment-history coordinate is invalid");
  }

  assertClosedDataObject(value.gates, GATE_FIELDS, "QuickOrder financial gates");
  const gates = value.gates;
  for (const field of GATE_FIELDS) assertBoolean(gates[field], `QuickOrder financial gates.${field}`);
  const active = value.order.voidedAt === null;
  const submitted = value.order.status === "submitted";
  const hasPaidFullMarker = value.order.paidInFullAt !== null;
  const expectedCollect = active && value.ledger.balanceJmd > 0;
  if (value.gates.canCollectPayment !== expectedCollect) {
    throw new TypeError("QuickOrder financial collect gate is invalid");
  }
  if (value.gates.canRefund && !active) {
    throw new TypeError("QuickOrder financial refund gate is invalid");
  }
  if (value.gates.canVoid && (!active || value.ledger.hasPaymentHistory)) {
    throw new TypeError("QuickOrder financial void gate is invalid");
  }
  const expectedRecordPaidFull = active && submitted && !hasPaidFullMarker && (
    sourceKind === "legacy_quick"
      ? true
      : sourceKind === "canonical_invoice"
        && value.ledger.paymentStatus === "paid"
        && value.ledger.settlementStatus === "settled"
  );
  if (value.gates.canRecordPaidFull !== expectedRecordPaidFull) {
    throw new TypeError("QuickOrder financial record-paid-full gate is invalid");
  }
  const expectedCancelPaidFull = active && submitted && hasPaidFullMarker;
  if (value.gates.canCancelPaidFull !== expectedCancelPaidFull) {
    throw new TypeError("QuickOrder financial cancel-paid-full gate is invalid");
  }
  if (value.gates.canRecordPaidFull && value.gates.canCancelPaidFull) {
    throw new TypeError("QuickOrder financial paid-full gates are contradictory");
  }
  const expectedCompleted = active && submitted && value.order.pickedUpAt !== null && hasPaidFullMarker && (
    sourceKind === "legacy_quick"
      ? true
      : sourceKind === "canonical_invoice"
        && value.ledger.paymentStatus === "paid"
        && value.ledger.settlementStatus === "settled"
  );
  if (value.gates.completed !== expectedCompleted) {
    throw new TypeError("QuickOrder financial completed gate is invalid");
  }
  if (!active && GATE_FIELDS.some((field) => gates[field] !== false)) {
    throw new TypeError("Voided QuickOrder financial gates must all be false");
  }
}

export function assertQuickOrderFinancialListResponse(
  value: unknown,
): asserts value is QuickOrderFinancialListResponse {
  assertClosedDataObject(value, LIST_FIELDS, "QuickOrder financial list response");
  assertSafeNonNegative(value.revision, "QuickOrder financial list revision");
  const items = value.items;
  if (!Array.isArray(items) || Object.getPrototypeOf(items) !== Array.prototype) {
    throw new TypeError("QuickOrder financial list items must be an array");
  }
  const ownKeys = Reflect.ownKeys(items);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(items, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
    throw new TypeError("QuickOrder financial list items length is invalid");
  }
  const length = lengthDescriptor.value as number;
  if (ownKeys.length !== length + 1 || ownKeys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
  })) {
    throw new TypeError("QuickOrder financial list items must be dense and have no extra fields");
  }
  const orderIds = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !("value" in descriptor)
      || descriptor.value === undefined
    ) {
      throw new TypeError(`QuickOrder financial list item ${index} must be an own enumerable data field`);
    }
    assertQuickOrderFinancialReadModel(descriptor.value);
    if (descriptor.value.revision !== value.revision) {
      throw new TypeError("QuickOrder financial list revisions are inconsistent");
    }
    if (orderIds.has(descriptor.value.order.id)) {
      throw new TypeError("QuickOrder financial list contains a duplicate order");
    }
    orderIds.add(descriptor.value.order.id);
  }
}
