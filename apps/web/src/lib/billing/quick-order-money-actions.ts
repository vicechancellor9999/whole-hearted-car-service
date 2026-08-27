export type QuickOrderInvoicePaymentInput = Readonly<{
  contract: "quick_order_invoice_payment_v1";
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  expectedRevision: number;
  mutationId: string;
  amountJmd: number;
  method: string;
  note?: string;
}>;

export type QuickOrderInvoicePaymentResult = Readonly<{
  contract: "quick_order_invoice_payment_result_v1";
  revision: number;
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  payment: Readonly<{
    id: string;
    amountJmd: number;
    method: string;
    note: string | null;
    receivedAt: string;
  }>;
}>;

type RefundCoordinate =
  | Readonly<{ refundQuantity: number; wholeLine?: never }>
  | Readonly<{ refundQuantity?: never; wholeLine: true }>;

export type QuickOrderInvoiceLineRefundInput = Readonly<{
  contract: "quick_order_invoice_line_refund_v1";
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  chargeLineId: string;
  expectedRevision: number;
  mutationId: string;
  method: string;
  reason: string;
}> & RefundCoordinate;

export type QuickOrderInvoiceLineRefundResult = Readonly<{
  contract: "quick_order_invoice_line_refund_result_v1";
  revision: number;
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  refund: Readonly<{
    id: string;
    chargeLineId: string;
    category: "labor" | "parts" | "other_service";
    pricingMode: "unit" | "fixed_total";
    refundQuantity: number | null;
    wholeLine: boolean;
    receivableReductionJmd: number;
    cashRefundJmd: number;
    method: string;
    reason: string;
    refundedAt: string;
  }>;
}>;

function assertClosedObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be plain`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError(`${label} has an unexpected field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.value === undefined) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new TypeError(`${label}.${key} is missing`);
  }
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be non-empty`);
}

function positive(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`${label} must be a positive safe integer`);
}

function nonNegative(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
}

export function assertQuickOrderInvoicePaymentInput(value: unknown): asserts value is QuickOrderInvoicePaymentInput {
  assertClosedObject(value, [
    "contract", "orderId", "invoiceId", "invoiceVersionId", "expectedRevision", "mutationId", "amountJmd", "method",
  ], ["note"], "QuickOrder Invoice payment input");
  if (value.contract !== "quick_order_invoice_payment_v1") throw new TypeError("payment contract is invalid");
  text(value.orderId, "orderId");
  text(value.invoiceId, "invoiceId");
  text(value.invoiceVersionId, "invoiceVersionId");
  positive(value.expectedRevision, "expectedRevision");
  text(value.mutationId, "mutationId");
  positive(value.amountJmd, "amountJmd");
  text(value.method, "method");
  if (Object.prototype.hasOwnProperty.call(value, "note")) text(value.note, "note");
}

export function assertQuickOrderInvoiceLineRefundInput(value: unknown): asserts value is QuickOrderInvoiceLineRefundInput {
  assertClosedObject(value, [
    "contract", "orderId", "invoiceId", "invoiceVersionId", "chargeLineId", "expectedRevision", "mutationId", "method", "reason",
  ], ["refundQuantity", "wholeLine"], "QuickOrder Invoice refund input");
  if (value.contract !== "quick_order_invoice_line_refund_v1") throw new TypeError("refund contract is invalid");
  for (const key of ["orderId", "invoiceId", "invoiceVersionId", "chargeLineId", "mutationId", "method", "reason"] as const) {
    text(value[key], key);
  }
  positive(value.expectedRevision, "expectedRevision");
  const hasQuantity = Object.prototype.hasOwnProperty.call(value, "refundQuantity");
  const hasWholeLine = Object.prototype.hasOwnProperty.call(value, "wholeLine");
  if (hasQuantity === hasWholeLine) throw new TypeError("refund must contain exactly one coordinate");
  if (hasQuantity) positive(value.refundQuantity, "refundQuantity");
  if (hasWholeLine && value.wholeLine !== true) throw new TypeError("wholeLine must be true");
}

export function assertQuickOrderInvoicePaymentResult(value: unknown): asserts value is QuickOrderInvoicePaymentResult {
  assertClosedObject(value, ["contract", "revision", "orderId", "invoiceId", "invoiceVersionId", "payment"], [], "QuickOrder Invoice payment result");
  if (value.contract !== "quick_order_invoice_payment_result_v1") throw new TypeError("payment result contract is invalid");
  positive(value.revision, "revision");
  for (const key of ["orderId", "invoiceId", "invoiceVersionId"] as const) text(value[key], key);
  assertClosedObject(value.payment, ["id", "amountJmd", "method", "note", "receivedAt"], [], "payment result record");
  text(value.payment.id, "payment.id");
  positive(value.payment.amountJmd, "payment.amountJmd");
  text(value.payment.method, "payment.method");
  if (value.payment.note !== null) text(value.payment.note, "payment.note");
  text(value.payment.receivedAt, "payment.receivedAt");
}

export function assertQuickOrderInvoiceLineRefundResult(value: unknown): asserts value is QuickOrderInvoiceLineRefundResult {
  assertClosedObject(value, ["contract", "revision", "orderId", "invoiceId", "invoiceVersionId", "refund"], [], "QuickOrder Invoice refund result");
  if (value.contract !== "quick_order_invoice_line_refund_result_v1") throw new TypeError("refund result contract is invalid");
  positive(value.revision, "revision");
  for (const key of ["orderId", "invoiceId", "invoiceVersionId"] as const) text(value[key], key);
  assertClosedObject(value.refund, [
    "id", "chargeLineId", "category", "pricingMode", "refundQuantity", "wholeLine", "receivableReductionJmd",
    "cashRefundJmd", "method", "reason", "refundedAt",
  ], [], "refund result record");
  text(value.refund.id, "refund.id");
  text(value.refund.chargeLineId, "refund.chargeLineId");
  if (value.refund.category !== "labor" && value.refund.category !== "parts" && value.refund.category !== "other_service") {
    throw new TypeError("refund.category is invalid");
  }
  if (value.refund.pricingMode === "unit") {
    positive(value.refund.refundQuantity, "refund.refundQuantity");
    if (value.refund.wholeLine !== false) throw new TypeError("unit refund wholeLine must be false");
  } else if (value.refund.pricingMode === "fixed_total") {
    if (value.refund.refundQuantity !== null || value.refund.wholeLine !== true) throw new TypeError("fixed refund coordinate is invalid");
  } else {
    throw new TypeError("refund.pricingMode is invalid");
  }
  positive(value.refund.receivableReductionJmd, "refund.receivableReductionJmd");
  nonNegative(value.refund.cashRefundJmd, "refund.cashRefundJmd");
  text(value.refund.method, "refund.method");
  text(value.refund.reason, "refund.reason");
  text(value.refund.refundedAt, "refund.refundedAt");
}
