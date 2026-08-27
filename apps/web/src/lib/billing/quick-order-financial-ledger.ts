import type { QuickOrderFinancialSource } from "./quick-order-financial";

export type QuickOrderFinancialLedgerItem =
  | Readonly<{
      kind: "payment";
      id: string;
      sequence: number;
      orderId: string;
      businessOrderNo: string;
      customerId: string;
      vehicleId: string;
      source: QuickOrderFinancialSource;
      amountJmd: number;
      occurredAt: string;
      method: string | null;
      note: string | null;
    }>
  | Readonly<{
      kind: "refund";
      id: string;
      sequence: number;
      orderId: string;
      businessOrderNo: string;
      customerId: string;
      vehicleId: string;
      source: QuickOrderFinancialSource;
      category: "labor" | "parts" | "other_service" | null;
      lineDescription: string | null;
      receivableReductionJmd: number;
      cashRefundJmd: number;
      occurredAt: string;
      method: string | null;
      reason: string | null;
    }>;

export interface QuickOrderFinancialLedgerResponse {
  readonly contract: "quick_order_financial_ledger_v1";
  readonly revision: number;
  readonly items: ReadonlyArray<QuickOrderFinancialLedgerItem>;
  readonly totals: Readonly<{
    grossPaidJmd: number;
    cashRefundedJmd: number;
    receivableReductionJmd: number;
    netPaidJmd: number;
    activeReceivableJmd: number;
    activeBalanceJmd: number;
  }>;
}

const TOP_FIELDS = ["contract", "revision", "items", "totals"] as const;
const PAYMENT_FIELDS = [
  "kind", "id", "sequence", "orderId", "businessOrderNo", "customerId", "vehicleId", "source",
  "amountJmd", "occurredAt", "method", "note",
] as const;
const REFUND_FIELDS = [
  "kind", "id", "sequence", "orderId", "businessOrderNo", "customerId", "vehicleId", "source",
  "category", "lineDescription", "receivableReductionJmd", "cashRefundJmd", "occurredAt", "method", "reason",
] as const;
const TOTAL_FIELDS = [
  "grossPaidJmd", "cashRefundedJmd", "receivableReductionJmd", "netPaidJmd", "activeReceivableJmd", "activeBalanceJmd",
] as const;

function assertClosed(value: unknown, fields: ReadonlyArray<string>, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const expected = new Set(fields);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) throw new TypeError(`${label} has an unexpected field count`);
  for (const key of keys) {
    if (typeof key !== "string" || !expected.has(key)) throw new TypeError(`${label} has an unexpected field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.value === undefined) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`);
    }
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be non-empty`);
}

function assertNullableString(value: unknown, label: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") throw new TypeError(`${label} must be string or null`);
}

function assertMoney(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be non-negative safe integer`);
}

function assertSignedMoney(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
}

function assertSource(value: unknown): asserts value is QuickOrderFinancialSource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("ledger source is invalid");
  const kind = (value as { kind?: unknown }).kind;
  const fields = kind === "canonical_invoice"
    ? ["kind", "invoiceId", "invoiceNo", "effectiveVersionId", "versionNo", "snapshotCommitment"]
    : ["kind"];
  assertClosed(value, fields, "ledger source");
  if (kind !== "legacy_quick" && kind !== "shared_uninvoiced" && kind !== "canonical_invoice") {
    throw new TypeError("ledger source kind is invalid");
  }
  if (kind === "canonical_invoice") {
    assertString(value.invoiceId, "ledger source.invoiceId");
    assertString(value.invoiceNo, "ledger source.invoiceNo");
    assertString(value.effectiveVersionId, "ledger source.effectiveVersionId");
    if (!Number.isSafeInteger(value.versionNo) || (value.versionNo as number) <= 0) throw new TypeError("ledger source.versionNo is invalid");
    if (typeof value.snapshotCommitment !== "string" || !/^sha256-utf16le:[a-f0-9]{64}$/u.test(value.snapshotCommitment)) {
      throw new TypeError("ledger source.snapshotCommitment is invalid");
    }
  }
}

export function assertQuickOrderFinancialLedgerResponse(value: unknown): asserts value is QuickOrderFinancialLedgerResponse {
  assertClosed(value, TOP_FIELDS, "financial ledger");
  if (value.contract !== "quick_order_financial_ledger_v1") throw new TypeError("financial ledger contract is invalid");
  assertMoney(value.revision, "financial ledger revision");
  if (!Array.isArray(value.items) || Reflect.ownKeys(value.items).length !== value.items.length + 1) {
    throw new TypeError("financial ledger items must be dense");
  }
  const ids = new Set<string>();
  let grossPaidJmd = 0;
  let cashRefundedJmd = 0;
  let receivableReductionJmd = 0;
  value.items.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("financial ledger item is invalid");
    const kind = (raw as { kind?: unknown }).kind;
    assertClosed(raw, kind === "payment" ? PAYMENT_FIELDS : REFUND_FIELDS, `financial ledger item[${index}]`);
    if (kind !== "payment" && kind !== "refund") throw new TypeError("financial ledger item kind is invalid");
    assertString(raw.id, "financial ledger item.id");
    if (ids.has(raw.id)) throw new TypeError("financial ledger item id is duplicated");
    ids.add(raw.id);
    if (raw.sequence !== index + 1) throw new TypeError("financial ledger item sequence is invalid");
    for (const field of ["orderId", "businessOrderNo", "customerId", "vehicleId"] as const) assertString(raw[field], `financial ledger item.${field}`);
    assertSource(raw.source);
    assertString(raw.occurredAt, "financial ledger item.occurredAt");
    if (!Number.isFinite(Date.parse(raw.occurredAt))) throw new TypeError("financial ledger item.occurredAt is invalid");
    assertNullableString(raw.method, "financial ledger item.method");
    if (kind === "payment") {
      assertMoney(raw.amountJmd, "financial ledger payment amount");
      if (raw.amountJmd === 0) throw new TypeError("financial ledger payment amount must be positive");
      assertNullableString(raw.note, "financial ledger payment note");
      grossPaidJmd += raw.amountJmd;
    } else {
      if (raw.category !== null && raw.category !== "labor" && raw.category !== "parts" && raw.category !== "other_service") {
        throw new TypeError("financial ledger refund category is invalid");
      }
      assertNullableString(raw.lineDescription, "financial ledger refund lineDescription");
      assertMoney(raw.receivableReductionJmd, "financial ledger refund reduction");
      assertMoney(raw.cashRefundJmd, "financial ledger refund cash");
      if (raw.receivableReductionJmd === 0 && raw.cashRefundJmd === 0) {
        throw new TypeError("financial ledger refund must change receivable or cash");
      }
      assertNullableString(raw.reason, "financial ledger refund reason");
      receivableReductionJmd += raw.receivableReductionJmd;
      cashRefundedJmd += raw.cashRefundJmd;
    }
  });
  assertClosed(value.totals, TOTAL_FIELDS, "financial ledger totals");
  for (const field of TOTAL_FIELDS) {
    if (field === "netPaidJmd") assertSignedMoney(value.totals[field], `financial ledger totals.${field}`);
    else assertMoney(value.totals[field], `financial ledger totals.${field}`);
  }
  if (value.totals.grossPaidJmd !== grossPaidJmd
    || value.totals.cashRefundedJmd !== cashRefundedJmd
    || value.totals.receivableReductionJmd !== receivableReductionJmd
    || value.totals.netPaidJmd !== grossPaidJmd - cashRefundedJmd) {
    throw new TypeError("financial ledger recorded totals are inconsistent");
  }
}
