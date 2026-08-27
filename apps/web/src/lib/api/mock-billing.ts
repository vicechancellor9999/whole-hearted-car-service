import {
  validateInvoiceCustomerAcknowledgement,
} from "../billing/calculations";
import type {
  Invoice,
  InvoiceCustomerAcknowledgement,
  InvoicePaymentFact,
  ModernInvoicePaymentFact,
  InvoicePaymentSummary,
  InvoiceVersion,
  LegacyInvoice,
  LegacyInvoiceVersion,
  PaymentMethod,
  PaymentStatus,
  SettlementArrangement,
  SharedChargeInvoice,
  SharedChargeInvoiceVersion,
  NonDiscountInvoiceAdjustment,
  ParkingProjectionChargeLine,
} from "../billing/types";
import {
  financiallyEffectiveInvoiceVersion,
  invoiceVersionTotalJmd,
  isSharedChargeInvoice,
} from "../billing/types";
import {
  buildInvoiceChargeSnapshot,
  invoiceSnapshotRequiresFreshApproval,
  invoiceSnapshotLineToQuotedCharge,
  validateInvoiceLineageTransition,
  type InvoiceParkingSnapshotLine,
  type InvoiceSnapshotLine,
} from "../billing/invoice-snapshots";
import { previewOrdinaryLineRefund } from "../billing/refunds";
import { transferParkingClaims } from "../parking/invoice-claims";
import { calculateParkingAccrual, deriveParkingFinalAccrual } from "../parking/calculations";
import {
  discountApprovalRequirement,
  discountSignatureStrokeDigest,
  validateDiscountApprovalEvidence,
  type DiscountApprovalEvidence,
  type SignatureStrokePoint,
} from "../billing/discount-approval";
import {
  isSharedChargeQuickOrder,
  type QuickOrder,
  type QuickOrderChargeLine,
} from "../orders/quick-order-types";
import { businessDateInJamaica, formatInvoiceNo } from "../orders/document-number";
import { createVehicleReleaseFact, type BusinessOrder, type VehicleReleaseFact } from "../orders/business-order-types";
import type { OrderSettlementStatus } from "../orders/types";
import {
  billingSnapshotCommitment,
  canonicalBillingActorIdentity,
  deriveLinkedInvoiceFinancialSummary,
  getMockLinkedOperationsStore,
  isModernParkingSourceFact,
  isTask8DraftChildStore,
  isTask8ReservedChildMutationId,
  LinkedApiDomainError,
  validateAdministratorSignature,
  type AdministratorSignatureEvidence,
  type MockLinkedOperationsStore,
  type LinkedOperationsState,
  type LinkedBillingAuditEvent,
  type LinkedInvoiceRefundFact,
  type LinkedModernParkingSourceFact,
  type LinkedSpecialReleaseAuthorization,
  type SignatureEvidence,
} from "./mock-orders";

export interface BillingWorkspaceItem {
  orderId: string;
  orderNo: string;
  customerId: string;
  vehicleId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceVersionId: string;
  totalJmd: number;
  paidJmd: number;
  balanceJmd: number;
  paymentStatus: PaymentStatus;
  settlementArrangement: SettlementArrangement;
  releaseStatus: VehicleReleaseFact["status"] | null;
  settlementStatus: OrderSettlementStatus;
}

export interface BillingWorkspaceResponse {
  revision: number;
  items: BillingWorkspaceItem[];
}

export interface BillingBusinessOrderResponse {
  revision: number;
  businessOrder: BusinessOrder;
  invoice: Omit<LegacyInvoice, "versions"> & { version: LegacyInvoiceVersion & { fileHash: string } };
  payment: InvoicePaymentSummary;
  settlementStatus: OrderSettlementStatus;
  release: VehicleReleaseFact;
  parking?: { caseId: string; finalAmountJmd: number; finalChargeableDays: number };
  acknowledgements: InvoiceCustomerAcknowledgement[];
  specialReleaseAuthorizations: LinkedSpecialReleaseAuthorization[];
}

export interface SharedBillingBusinessOrderResponse extends Omit<
  BillingBusinessOrderResponse,
  "businessOrder" | "release" | "invoice"
> {
  businessOrder: QuickOrder;
  release: null;
  invoice: Omit<SharedChargeInvoice, "versions"> & {
    version: SharedChargeInvoiceVersion;
  };
}

export type BillingOwnerResponse = BillingBusinessOrderResponse | SharedBillingBusinessOrderResponse;

export interface SignCreditInvoiceInput {
  invoiceId: string;
  expectedRevision: number;
  invoiceVersionId: string;
  balanceJmd: number;
  documentEdition: "zh" | "en" | "bilingual";
  fileHash: string;
  customerId: string;
  payerId: string;
  customerSignerId: string;
  signatureEvidence: SignatureEvidence;
}

export interface AuthorizeSpecialReleaseInput {
  orderId: string;
  invoiceId: string;
  expectedRevision: number;
  expectedInvoiceVersionId: string;
  expectedBalanceJmd: number;
  reason: string;
  expectedPaymentDate: string;
  administratorId: string;
  administratorSignature: AdministratorSignatureEvidence;
  customerConfirmation: string;
}

function latestVersion(invoice: Invoice): InvoiceVersion {
  return financiallyEffectiveInvoiceVersion(invoice);
}

function paymentFromState(state: LinkedOperationsState, invoice: Invoice): InvoicePaymentSummary {
  return deriveLinkedInvoiceFinancialSummary(state, invoice);
}

function currentRelease(order: BusinessOrder): VehicleReleaseFact {
  const release = order.vehicleReleaseFacts[order.vehicleReleaseFacts.length - 1];
  if (!release) throw new Error("Business Order 缺少车辆放行事实");
  return release;
}

function detailFromState(state: LinkedOperationsState, orderId: string): BillingOwnerResponse {
  const formalBusinessOrder = state.businessOrders.find((order) => order.id === orderId);
  const quickBusinessOrder = state.quickOrders.find((order) => order.id === orderId);
  const businessOrder = formalBusinessOrder ?? quickBusinessOrder;
  if (!businessOrder) throw new LinkedApiDomainError("Business Order 不存在", 404);
  const ownerInvoices = state.invoices.filter((candidate) => candidate.businessOrderId === businessOrder.id);
  if (quickBusinessOrder && ownerInvoices.length > 1) {
    throw new LinkedApiDomainError("Quick Business Order 的 logical Invoice owner 冲突", 409);
  }
  const invoice = ownerInvoices[0];
  if (!invoice) throw new Error("Business Order 缺少 Invoice 引用");
  const parking = state.parkingCases.find((item) => (
    isModernParkingSourceFact(item)
      ? item.eligibleBusinessOrderIds.includes(businessOrder.id)
      : item.businessOrderId === businessOrder.id
  ));
  const lastWaiver = parking?.waiverHistory[parking.waiverHistory.length - 1];
  const parkingFinal = parking && isModernParkingSourceFact(parking)
    ? deriveParkingFinalAccrual({
      currentAccrual: parking.accrual,
      dailyRateJmd: parking.dailyRateJmd,
      latestWaiverDecision: lastWaiver,
    })
    : undefined;
  const common = {
    revision: state.revision,
    payment: paymentFromState(state, invoice),
    settlementStatus: deriveLinkedInvoiceFinancialSummary(state, invoice).settlementStatus,
    ...(parking ? {
      parking: {
        caseId: parking.id,
        finalAmountJmd: parkingFinal?.finalAmountJmd ?? lastWaiver?.finalAmountJmd ?? parking.accrual.originalAmountJmd,
        finalChargeableDays: parkingFinal?.finalChargeableDays ?? lastWaiver?.finalChargeableDays ?? parking.accrual.chargeableDays,
      },
    } : {}),
    acknowledgements: state.invoiceAcknowledgements.filter((item) => item.invoiceId === invoice.id),
    specialReleaseAuthorizations: state.specialReleaseAuthorizations.filter((item) => item.orderId === businessOrder.id),
  };
  if (formalBusinessOrder) {
    if (!formalBusinessOrder.invoiceIds.includes(invoice.id) || isSharedChargeInvoice(invoice)) {
      throw new Error("Business Order 与 legacy Invoice 引用不一致");
    }
    const version = invoice.versions[invoice.versions.length - 1];
    if (!version) throw new Error("Invoice 没有可用版本");
    const fileHash = state.invoiceFileHashes[version.id];
    if (!fileHash) throw new Error("Invoice 文件来源缺失");
    return {
      ...common,
      businessOrder: formalBusinessOrder,
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        businessOrderId: invoice.businessOrderId,
        settlementArrangement: invoice.settlementArrangement,
        version: { ...version, fileHash },
      },
      release: currentRelease(formalBusinessOrder),
    };
  }
  if (!quickBusinessOrder || !isSharedChargeQuickOrder(quickBusinessOrder) || !isSharedChargeInvoice(invoice)) {
    throw new Error("Quick Business Order 与 canonical Invoice 契约不一致");
  }
  const version = invoice.versions.find((candidate) => candidate.id === invoice.financiallyEffectiveVersionId);
  if (!version) throw new Error("Quick Business Order 的 canonical Invoice 没有财务生效版本");
  return {
    ...common,
    businessOrder: quickBusinessOrder,
    invoice: {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      businessOrderId: invoice.businessOrderId,
      settlementArrangement: invoice.settlementArrangement,
      invoiceContract: invoice.invoiceContract,
      financiallyEffectiveVersionId: invoice.financiallyEffectiveVersionId,
      version,
    },
    release: null,
  };
}

export function getMockBillingWorkspace(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): BillingWorkspaceResponse {
  return store.read((state) => {
    const formalItems = state.businessOrders.map((order) => {
      const invoice = state.invoices.find((candidate) => candidate.businessOrderId === order.id);
      if (!invoice) throw new Error("Business Order 缺少 Invoice 引用");
      const version = latestVersion(invoice);
      const payment = paymentFromState(state, invoice);
      const settlementStatus = deriveLinkedInvoiceFinancialSummary(state, invoice).settlementStatus;
      return {
        orderId: order.id,
        orderNo: order.businessOrderNo,
        customerId: order.customerId,
        vehicleId: order.vehicleId,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceVersionId: version.id,
        totalJmd: invoiceVersionTotalJmd(version),
        ...payment,
        settlementArrangement: invoice.settlementArrangement,
        settlementStatus,
        releaseStatus: currentRelease(order).status,
      };
    });
    const quickItems = state.quickOrders.flatMap((order) => {
      const ownerInvoices = state.invoices.filter((candidate) => candidate.businessOrderId === order.id);
      if (ownerInvoices.length > 1) {
        throw new LinkedApiDomainError("Quick Business Order 的 logical Invoice owner 冲突", 409);
      }
      const invoice = ownerInvoices[0];
      if (!invoice) return [];
      if (!isSharedChargeQuickOrder(order) || !isSharedChargeInvoice(invoice)) {
        throw new Error("Quick Business Order 与 canonical Invoice 契约不一致");
      }
      const version = latestVersion(invoice);
      const payment = paymentFromState(state, invoice);
      const settlementStatus = deriveLinkedInvoiceFinancialSummary(state, invoice).settlementStatus;
      return [{
        orderId: order.id,
        orderNo: order.businessOrderNo,
        customerId: order.customerId,
        vehicleId: order.vehicleId,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceVersionId: version.id,
        totalJmd: invoiceVersionTotalJmd(version),
        ...payment,
        settlementArrangement: invoice.settlementArrangement,
        settlementStatus,
        releaseStatus: null,
      }];
    });
    return { revision: state.revision, items: [...formalItems, ...quickItems] };
  }, "billing.workspace.read");
}

export function getMockBillingBusinessOrder(orderId: string): BillingBusinessOrderResponse;
export function getMockBillingBusinessOrder(
  orderId: string,
  store: MockLinkedOperationsStore,
): BillingOwnerResponse;
export function getMockBillingBusinessOrder(
  orderId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): BillingOwnerResponse {
  return store.read(
    (state) => detailFromState(state, orderId),
    "billing.businessOrder.read",
  );
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LinkedApiDomainError(`${label}不能为空`, 400);
  return value.trim();
}

function validateSignature(value: SignatureEvidence | undefined, label: string): asserts value is SignatureEvidence {
  if (!value || typeof value !== "object") throw new LinkedApiDomainError(`${label}签名证据不能为空`, 400);
  requiredText(value.signatureId, `${label}签名 ID`);
  requiredText(value.signatureHash, `${label}签名哈希`);
  requiredText(value.blobRef, `${label}签名文件引用`);
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function signMockCreditInvoice(
  input: SignCreditInvoiceInput,
  actorId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<InvoiceCustomerAcknowledgement> {
  return store.mutate((state) => {
    const invoice = state.invoices.find((item) => item.id === input.invoiceId);
    if (!invoice) throw new LinkedApiDomainError("Invoice 不存在", 404);
    const order = state.businessOrders.find((item) => item.id === invoice.businessOrderId);
    if (!order) throw new Error("Invoice 的 Business Order 不存在");
    if (state.revision !== input.expectedRevision) throw new LinkedApiDomainError("收费工作区版本已变化，请刷新", 409);
    if (invoice.settlementArrangement !== "credit") throw new LinkedApiDomainError("只有挂账 Invoice 可以签账", 400);
    const version = latestVersion(invoice);
    const payment = paymentFromState(state, invoice);
    if (version.id !== input.invoiceVersionId) throw new LinkedApiDomainError("Invoice 来源版本已变化，请刷新", 409);
    if (payment.balanceJmd !== input.balanceJmd) throw new LinkedApiDomainError("Invoice 余额已变化，请刷新", 409);
    if (state.invoiceFileHashes[version.id] !== input.fileHash) throw new LinkedApiDomainError("Invoice 文件版本已变化，请刷新", 409);
    if (order.customerId !== input.customerId || order.customerId !== input.payerId) {
      throw new LinkedApiDomainError("Invoice 客户或付款主体不一致", 400);
    }
    validateSignature(input.signatureEvidence, "客户");
    const acknowledgement: InvoiceCustomerAcknowledgement = {
      id: `invoice-acknowledgement-${state.invoiceAcknowledgements.length + 1}`,
      invoiceId: invoice.id,
      invoiceVersionId: version.id,
      customerId: input.customerId,
      payerId: input.payerId,
      customerSignerId: requiredText(input.customerSignerId, "客户签字人"),
      signatureEvidence: { ...input.signatureEvidence },
      balanceJmd: input.balanceJmd,
      documentEdition: input.documentEdition,
      fileHash: input.fileHash,
      signedAt: new Date(store.nowMs()).toISOString(),
    };
    validateInvoiceCustomerAcknowledgement(acknowledgement);
    state.invoiceAcknowledgements.push(acknowledgement);
    state.revision += 1;
    void actorId;
    return acknowledgement;
  }, { action: "billing.creditSignature.write" });
}

// ---------------------------------------------------------------------------
// 收款登记（2026-08-14 老板：客户难道就不能付款吗）
// ---------------------------------------------------------------------------

export interface RecordInvoicePaymentInput {
  invoiceId: string;
  expectedRevision: number;
  mutationId: string;
  /** 收款金额（JMD，不得超过当前余额）。 */
  amountJmd: number;
  method: PaymentMethod;
  note?: string;
}

const BILLING_PAYMENT_FIELDS = new Set([
  "invoiceId", "expectedRevision", "mutationId", "amountJmd", "method", "note",
]);
const BILLING_PAYMENT_REQUIRED_FIELDS = new Set([
  "invoiceId", "expectedRevision", "mutationId", "amountJmd", "method",
]);

function normalizePaymentInput(raw: RecordInvoicePaymentInput): RecordInvoicePaymentInput {
  assertBillingDataObject(raw, BILLING_PAYMENT_FIELDS, BILLING_PAYMENT_REQUIRED_FIELDS, "Invoice payment request");
  if (!Number.isSafeInteger(raw.amountJmd) || raw.amountJmd <= 0) {
    throw new LinkedApiDomainError("收款金额必须大于 0", 400);
  }
  const note = raw.note === undefined ? undefined : billingRequiredText(raw.note, "收款备注");
  return {
    invoiceId: billingRequiredText(raw.invoiceId, "Invoice ID"),
    expectedRevision: billingExpectedRevision(raw.expectedRevision),
    mutationId: billingRequiredText(raw.mutationId, "mutationId"),
    amountJmd: raw.amountJmd,
    method: billingRequiredText(raw.method, "收款方式"),
    ...(note !== undefined ? { note } : {}),
  };
}

export async function recordMockInvoicePayment(
  rawInput: RecordInvoicePaymentInput,
  actor: BillingMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  requestGuard?: () => void,
): Promise<ModernInvoicePaymentFact> {
  requestGuard?.();
  const input = normalizePaymentInput(rawInput);
  if (isTask8ReservedChildMutationId(input.mutationId) && !isTask8DraftChildStore(store)) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  const normalizedActor = normalizeBillingActor(actor, "billing.invoice.payment");
  const recordedAt = billingJamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<ModernInvoicePaymentFact>({
    mutationId: input.mutationId,
    operation: "billing.invoice.payment",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    assertBillingActorStillAuthorized(state, normalizedActor);
    const invoice = state.invoices.find((item) => item.id === input.invoiceId);
    if (!invoice) throw new LinkedApiDomainError("Invoice 不存在", 404);
    if (state.revision !== input.expectedRevision) throw new LinkedApiDomainError("收费工作区版本已变化，请刷新", 409);
    const payment = paymentFromState(state, invoice);
    if (payment.balanceJmd <= 0) throw new LinkedApiDomainError("Invoice 已付清，无需再收款", 400);
    if (input.amountJmd > payment.balanceJmd) {
      throw new LinkedApiDomainError(`收款金额不能超过余额 ${payment.balanceJmd}`, 400);
    }
    const invoiceVersion = latestVersion(invoice);
    state.revision += 1;
    const fact: ModernInvoicePaymentFact = {
      id: nextBillingId("invoice-payment", new Set(state.payments.map((candidate) => candidate.id))),
      paymentContract: "invoice_payment_v1",
      invoiceId: invoice.id,
      invoiceVersionId: invoiceVersion.id,
      amountJmd: input.amountJmd,
      receivedAt: recordedAt,
      method: input.method,
      receivedBy: normalizedActor.name,
      receivedById: normalizedActor.id,
      ...(input.note !== undefined ? { note: input.note } : {}),
      mutationId: input.mutationId,
      committedRevision: state.revision,
    };
    state.payments.push(fact);
    state.billingAuditEvents.push({
      id: nextBillingId("billing-audit", new Set(state.billingAuditEvents.map((event) => event.id))),
      operation: "invoice_payment",
      mutationId: input.mutationId,
      invoiceId: invoice.id,
      invoiceVersionId: invoiceVersion.id,
      paymentId: fact.id,
      amountJmd: fact.amountJmd,
      method: fact.method,
      note: fact.note ?? null,
      committedRevision: fact.committedRevision,
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
      recordedAt,
    });
    return fact;
  }, {
    action: "billing.invoice.payment.write",
    preReceiptGuard: (state) => {
      requestGuard?.();
      assertBillingActorStillAuthorized(state, normalizedActor);
    },
  });
  store.read(() => null, "billing.invoice.payment.response");
  requestGuard?.();
  return committed.result;
}

export function authorizeMockSpecialRelease(
  input: AuthorizeSpecialReleaseInput,
  actorId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<LinkedSpecialReleaseAuthorization> {
  return store.mutate((state) => {
    const order = state.businessOrders.find((item) => item.id === input.orderId);
    const invoice = state.invoices.find((item) => item.id === input.invoiceId);
    if (!order || !invoice) throw new LinkedApiDomainError("特殊协商的 Business Order 或 Invoice 不存在", 404);
    if (invoice.businessOrderId !== order.id || !order.invoiceIds.includes(invoice.id)) {
      throw new LinkedApiDomainError("特殊协商的 Business Order 与 Invoice 不一致", 409);
    }
    if (state.revision !== input.expectedRevision) throw new LinkedApiDomainError("收费工作区版本已变化，请刷新", 409);
    const version = latestVersion(invoice);
    const payment = paymentFromState(state, invoice);
    if (version.id !== input.expectedInvoiceVersionId) throw new LinkedApiDomainError("Invoice 来源版本已变化，请刷新", 409);
    if (payment.balanceJmd !== input.expectedBalanceJmd || payment.balanceJmd <= 0) {
      throw new LinkedApiDomainError("Invoice 余额已变化或无需特殊协商", 409);
    }
    const reason = requiredText(input.reason, "特殊协商原因");
    if (!isCalendarDate(input.expectedPaymentDate)) throw new LinkedApiDomainError("预计付款日期无效", 400);
    const administratorId = requiredText(input.administratorId, "管理员身份");
    validateAdministratorSignature(state, administratorId, input.administratorSignature, {
      action: "special_release",
      subjectId: order.id,
      sourceRevision: state.revision,
      amountJmd: payment.balanceJmd,
      reason,
    });
    requiredText(input.customerConfirmation, "客户确认");
    const authorization: LinkedSpecialReleaseAuthorization = {
      id: `special-release-${state.specialReleaseAuthorizations.length + 1}`,
      orderId: order.id,
      invoiceId: invoice.id,
      invoiceVersionId: version.id,
      balanceJmd: payment.balanceJmd,
      reason,
      expectedPaymentDate: input.expectedPaymentDate,
      frontdeskActorId: actorId,
      administratorId,
      administratorSignature: { ...input.administratorSignature },
      customerConfirmation: input.customerConfirmation.trim(),
      authorizedAt: new Date(store.nowMs()).toISOString(),
    };
    const release = createVehicleReleaseFact({
      id: `release-special-${state.specialReleaseAuthorizations.length + 1}`,
      businessOrderId: order.id,
      vehicleId: order.vehicleId,
      status: "authorized",
      authorizationId: authorization.id,
      authorizedBy: administratorId,
      authorizedAt: authorization.authorizedAt,
      specialAgreementAuthorizationId: authorization.id,
    });
    state.specialReleaseAuthorizations.push(authorization);
    state.businessOrders[state.businessOrders.indexOf(order)] = {
      ...order,
      vehicleReleaseFacts: [...order.vehicleReleaseFacts, release],
    };
    state.invoices[state.invoices.indexOf(invoice)] = {
      ...invoice,
      settlementArrangement: "special_agreement",
    };
    state.revision += 1;
    return authorization;
  }, { action: "billing.specialRelease.write" });
}

// ---------------------------------------------------------------------------
// Task 8 canonical shared-charge Invoice activation and ordinary line refunds
// ---------------------------------------------------------------------------

export interface BillingMutationActor {
  readonly id: string;
  readonly name: string;
  readonly role: "superadmin" | "finance" | "frontdesk_admin";
}

export interface ActivateQuickInvoiceSnapshotInput {
  readonly orderId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
  readonly adjustments?: ReadonlyArray<NonDiscountInvoiceAdjustment>;
  readonly signature?: {
    readonly rawStrokes: ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>;
  };
}

export interface ActivateQuickInvoiceSnapshotResult {
  readonly revision: number;
  readonly invoiceId: string;
  readonly invoiceNo: string;
  readonly invoiceVersionId: string;
  readonly snapshotCommitment: string;
  readonly version: number;
  readonly parkingSourceTransitions: ReadonlyArray<{
    readonly caseId: string;
    readonly sourceBefore: LinkedModernParkingSourceFact;
    readonly parkingSource: LinkedModernParkingSourceFact;
  }>;
}

export interface RecordInvoiceLineRefundInput {
  readonly logicalInvoiceId: string;
  readonly invoiceVersionId: string;
  readonly chargeLineId: string;
  readonly refundQuantity?: number;
  readonly wholeLine?: true;
  readonly method: string;
  readonly reason: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
}

const BILLING_ACTIVATION_FIELDS = new Set([
  "orderId", "expectedRevision", "mutationId", "adjustments", "signature",
]);
const BILLING_ACTIVATION_REQUIRED_FIELDS = new Set(["orderId", "expectedRevision", "mutationId"]);
const BILLING_REFUND_FIELDS = new Set([
  "logicalInvoiceId", "invoiceVersionId", "chargeLineId", "refundQuantity", "wholeLine",
  "method", "reason", "expectedRevision", "mutationId",
]);
const BILLING_REFUND_REQUIRED_FIELDS = new Set([
  "logicalInvoiceId", "invoiceVersionId", "chargeLineId", "method", "reason", "expectedRevision", "mutationId",
]);
const BILLING_ACTOR_FIELDS = new Set(["id", "name", "role"]);
const BILLING_SIGNATURE_FIELDS = new Set(["rawStrokes"]);
const BILLING_SIGNATURE_POINT_FIELDS = new Set(["x", "y", "time"]);
const BILLING_ADJUSTMENT_FIELDS = new Set(["id", "kind", "amountJmd"]);

function assertBillingDataObject(
  value: unknown,
  allowedFields: ReadonlySet<string>,
  requiredFields: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkedApiDomainError(`${label}格式错误`, 400);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LinkedApiDomainError(`${label}必须为普通对象`, 400);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedFields.has(key)) {
      throw new LinkedApiDomainError(`${label} contains an unexpected field: ${String(key)}`, 400);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      throw new LinkedApiDomainError(`${label}字段 ${key} 不能是访问器、隐藏字段或 undefined`, 400);
    }
  }
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new LinkedApiDomainError(`${label}缺少字段 ${field}`, 400);
    }
  }
}

function billingRequiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LinkedApiDomainError(`${label}不能为空`, 400);
  return value.trim();
}

function billingExpectedRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new LinkedApiDomainError("expectedRevision 必须为正安全整数", 400);
  }
  return Number(value);
}

function cloneBillingRawStrokes(value: unknown): ReadonlyArray<ReadonlyArray<SignatureStrokePoint>> {
  if (!Array.isArray(value) || value.length === 0) throw new LinkedApiDomainError("Invoice 签字笔迹不能为空", 400);
  const cloneArray = <T,>(array: ReadonlyArray<T>, label: string): void => {
    for (const key of Reflect.ownKeys(array)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= array.length) {
        throw new LinkedApiDomainError(`${label} contains an unexpected field: ${String(key)}`, 400);
      }
      const descriptor = Object.getOwnPropertyDescriptor(array, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
        throw new LinkedApiDomainError(`${label}包含访问器、隐藏值或 undefined`, 400);
      }
    }
    for (let index = 0; index < array.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(array, index)) {
        throw new LinkedApiDomainError(`${label}不能包含空洞`, 400);
      }
    }
  };
  cloneArray(value, "Invoice raw strokes");
  let pointCount = 0;
  return value.map((stroke, strokeIndex) => {
    if (!Array.isArray(stroke)) throw new LinkedApiDomainError("Invoice 每条笔迹必须为数组", 400);
    cloneArray(stroke, `Invoice raw stroke ${strokeIndex}`);
    return stroke.map((point, pointIndex) => {
      assertBillingDataObject(
        point,
        BILLING_SIGNATURE_POINT_FIELDS,
        BILLING_SIGNATURE_POINT_FIELDS,
        `Invoice stroke point ${strokeIndex}:${pointIndex}`,
      );
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.time)) {
        throw new LinkedApiDomainError("Invoice 笔迹坐标和时间必须为有限数", 400);
      }
      pointCount += 1;
      return { x: Number(point.x), y: Number(point.y), time: Number(point.time) };
    });
  }).map((stroke) => stroke) satisfies ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>;
}

function normalizeBillingActor(
  actor: BillingMutationActor,
  operation: "billing.invoice.activate" | "billing.invoice.payment" | "billing.invoice.lineRefund",
): BillingMutationActor {
  assertBillingDataObject(actor, BILLING_ACTOR_FIELDS, BILLING_ACTOR_FIELDS, "Invoice 操作账号");
  const id = billingRequiredText(actor.id, "Invoice 操作账号 ID");
  const name = billingRequiredText(actor.name, "Invoice 操作账号姓名");
  const canonical = canonicalBillingActorIdentity(operation, id);
  if (!canonical || actor.role !== canonical.role || name !== canonical.name) {
    throw new LinkedApiDomainError("Invoice 操作账号无权限", 403);
  }
  return canonical;
}

function normalizeBillingAdjustments(value: unknown): ReadonlyArray<NonDiscountInvoiceAdjustment> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new LinkedApiDomainError("Invoice adjustments 必须为数组", 400);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
      throw new LinkedApiDomainError(`Invoice adjustments contains an unexpected field: ${String(key)}`, 400);
    }
  }
  const ids = new Set<string>();
  return value.map((adjustment, index) => {
    assertBillingDataObject(adjustment, BILLING_ADJUSTMENT_FIELDS, BILLING_ADJUSTMENT_FIELDS, `Invoice adjustment ${index}`);
    const id = billingRequiredText(adjustment.id, "Invoice adjustment ID");
    if (ids.has(id)) throw new LinkedApiDomainError("Invoice adjustment ID 重复", 400);
    ids.add(id);
    if (adjustment.kind === "discount") {
      throw new LinkedApiDomainError("legacy discount adjustment 不得写入新 Invoice", 400);
    }
    if (adjustment.kind !== "waiver" && adjustment.kind !== "write_off" && adjustment.kind !== "rounding") {
      throw new LinkedApiDomainError("Invoice adjustment kind 无效", 400);
    }
    if (!Number.isSafeInteger(adjustment.amountJmd)) {
      throw new LinkedApiDomainError("Invoice adjustment 金额必须为安全整数", 400);
    }
    if ((adjustment.kind === "waiver" || adjustment.kind === "write_off") && Number(adjustment.amountJmd) > 0) {
      throw new LinkedApiDomainError("Invoice waiver/write_off 必须为非正数", 400);
    }
    return { id, kind: adjustment.kind, amountJmd: Number(adjustment.amountJmd) };
  });
}

function normalizeActivationInput(raw: ActivateQuickInvoiceSnapshotInput): ActivateQuickInvoiceSnapshotInput {
  assertBillingDataObject(raw, BILLING_ACTIVATION_FIELDS, BILLING_ACTIVATION_REQUIRED_FIELDS, "Invoice activation request");
  let signature: ActivateQuickInvoiceSnapshotInput["signature"];
  if (raw.signature !== undefined) {
    assertBillingDataObject(raw.signature, BILLING_SIGNATURE_FIELDS, BILLING_SIGNATURE_FIELDS, "Invoice activation signature");
    signature = { rawStrokes: cloneBillingRawStrokes(raw.signature.rawStrokes) };
  }
  const adjustments = normalizeBillingAdjustments(raw.adjustments);
  return {
    orderId: billingRequiredText(raw.orderId, "Business Order ID"),
    expectedRevision: billingExpectedRevision(raw.expectedRevision),
    mutationId: billingRequiredText(raw.mutationId, "mutationId"),
    ...(raw.adjustments !== undefined ? { adjustments } : {}),
    ...(signature ? { signature } : {}),
  };
}

function normalizeLineRefundInput(raw: RecordInvoiceLineRefundInput): RecordInvoiceLineRefundInput {
  assertBillingDataObject(raw, BILLING_REFUND_FIELDS, BILLING_REFUND_REQUIRED_FIELDS, "Invoice line refund request");
  if (raw.refundQuantity !== undefined && (!Number.isSafeInteger(raw.refundQuantity) || raw.refundQuantity <= 0)) {
    throw new LinkedApiDomainError("退款数量必须为正安全整数", 400);
  }
  if (raw.wholeLine !== undefined && raw.wholeLine !== true) {
    throw new LinkedApiDomainError("整行退款意图必须明确为 true", 400);
  }
  if ((raw.refundQuantity === undefined) === (raw.wholeLine === undefined)) {
    throw new LinkedApiDomainError("退款必须且只能提交数量或整行意图之一", 400);
  }
  return {
    logicalInvoiceId: billingRequiredText(raw.logicalInvoiceId, "logical Invoice ID"),
    invoiceVersionId: billingRequiredText(raw.invoiceVersionId, "Invoice version ID"),
    chargeLineId: billingRequiredText(raw.chargeLineId, "charge line ID"),
    ...(raw.refundQuantity !== undefined ? { refundQuantity: raw.refundQuantity } : {}),
    ...(raw.wholeLine !== undefined ? { wholeLine: true as const } : {}),
    method: billingRequiredText(raw.method, "退款方式"),
    reason: billingRequiredText(raw.reason, "退款原因"),
    expectedRevision: billingExpectedRevision(raw.expectedRevision),
    mutationId: billingRequiredText(raw.mutationId, "mutationId"),
  };
}

function billingJamaicaInstant(nowMs: number): string {
  const localClock = new Date(nowMs - 5 * 60 * 60 * 1_000).toISOString();
  return `${localClock.slice(0, -1)}-05:00`;
}

function assertBillingActorStillAuthorized(state: LinkedOperationsState, actor: BillingMutationActor): void {
  if (!state.trustedIdentities.some((identity) => identity.id === actor.id && identity.role === actor.role)) {
    throw new LinkedApiDomainError("Invoice 操作账号权限已变化，请重新登录", 403);
  }
}

function nextBillingId(prefix: string, occupied: ReadonlySet<string>): string {
  for (let sequence = 1; sequence <= 999_999; sequence += 1) {
    const id = `${prefix}-${sequence}`;
    if (!occupied.has(id)) return id;
  }
  throw new LinkedApiDomainError(`${prefix} ID 序列已耗尽`, 409);
}

function nextSharedInvoiceNumber(state: LinkedOperationsState, recordedAt: string): string {
  const businessDate = businessDateInJamaica(recordedAt);
  const id = `invoice:KGN:WH:${businessDate}`;
  const existing = state.billingDocumentSequences.find((sequence) => sequence.id === id);
  const lastAllocated = existing?.lastAllocated ?? 9_999;
  const sequence = lastAllocated + 1;
  if (!Number.isSafeInteger(sequence) || sequence > 99_999) {
    throw new LinkedApiDomainError("Invoice 编号序列已耗尽", 409);
  }
  const candidate = formatInvoiceNo({
    branchCode: "KGN",
    brandCode: "WH",
    businessDate,
    sequence,
  });
  if (state.invoices.some((invoice) => invoice.invoiceNo === candidate)) {
    throw new LinkedApiDomainError("Invoice 编号高水位与现有号码冲突", 409);
  }
  if (existing) existing.lastAllocated = sequence;
  else {
    state.billingDocumentSequences.push({
      id,
      kind: "invoice",
      branchCode: "KGN",
      brandCode: "WH",
      businessDate,
      lastAllocated: sequence,
    });
  }
  return candidate;
}

function checkedBillingSum(values: ReadonlyArray<number>, label: string): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw new LinkedApiDomainError(`${label}必须为非负安全整数`, 500);
    sum += value;
    if (!Number.isSafeInteger(sum)) throw new LinkedApiDomainError(`${label}超过安全整数范围`, 500);
  }
  return sum;
}

function lineSnapshotAmount(line: InvoiceSnapshotLine): number {
  return line.pricingMode === "unit" ? line.finalLineJmd : line.amountJmd;
}

function parkingProjectionLineId(caseId: string): string {
  return `parking-projection-${caseId}`;
}

function materializeParkingSourceForActivation(
  source: LinkedModernParkingSourceFact,
  recordedAt: string,
): LinkedModernParkingSourceFact {
  const accrualEndDate = source.pickupDate ?? recordedAt.slice(0, 10);
  const next = {
    ...source,
    asOf: recordedAt,
    accrual: calculateParkingAccrual({
      notificationDate: source.notificationDate,
      pickupDate: accrualEndDate,
      dailyRateJmd: source.dailyRateJmd,
    }),
  };
  if (JSON.stringify(next.accrual) === JSON.stringify(source.accrual)) return source;
  return { ...next, revision: source.revision + 1 };
}

/** Atomically creates/enables a canonical immutable Invoice version from one shared-charge Quick BO. */
export async function activateMockQuickInvoiceSnapshot(
  rawInput: ActivateQuickInvoiceSnapshotInput,
  actor: BillingMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<ActivateQuickInvoiceSnapshotResult> {
  const input = normalizeActivationInput(rawInput);
  if (isTask8ReservedChildMutationId(input.mutationId) && !isTask8DraftChildStore(store)) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  const normalizedActor = normalizeBillingActor(actor, "billing.invoice.activate");
  const recordedAt = billingJamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<ActivateQuickInvoiceSnapshotResult>({
    mutationId: input.mutationId,
    operation: "billing.invoice.activate",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    assertBillingActorStillAuthorized(state, normalizedActor);
    if (state.revision !== input.expectedRevision) {
      throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
    }
    const order = state.quickOrders.find((candidate) => candidate.id === input.orderId);
    if (!order) throw new LinkedApiDomainError("Business Order 不存在", 404);
    if (!isSharedChargeQuickOrder(order)) throw new LinkedApiDomainError("Business Order 尚未使用 shared 收费契约", 409);
    if (order.voidedAt) throw new LinkedApiDomainError("已废除 Business Order 不能启用 Invoice", 400);
    if (state.legacyChargeRecords.some((record) => record.invoiceId === input.orderId)) {
      throw new LinkedApiDomainError("Business Order 存在未核对 legacy charge，不能启用新 Invoice", 409);
    }

    const matchingInvoices = state.invoices.filter((candidate) => candidate.businessOrderId === order.id);
    if (matchingInvoices.some((candidate) => !isSharedChargeInvoice(candidate)) || matchingInvoices.length > 1) {
      throw new LinkedApiDomainError("Business Order 的 Invoice 来源冲突", 409);
    }
    const existing = matchingInvoices[0] && isSharedChargeInvoice(matchingInvoices[0])
      ? matchingInvoices[0]
      : undefined;
    const invoiceId = existing?.id ?? nextBillingId("invoice-shared", new Set(state.invoices.map((invoice) => invoice.id)));
    const versionNumber = (existing?.versions.length ?? 0) + 1;
    const invoiceVersionId = `${invoiceId}-version-${versionNumber}`;
    if (state.invoices.some((invoice) => invoice.versions.some((version) => version.id === invoiceVersionId))) {
      throw new LinkedApiDomainError("Invoice version ID 冲突", 409);
    }
    const storedParkingSources = state.parkingCases
      .filter(isModernParkingSourceFact)
      .filter((candidate) => {
        const claim = state.activeParkingClaim[candidate.id];
        if (claim?.logicalInvoiceId === invoiceId) return true;
        if (claim !== undefined) return false;
        return candidate.eligibleBusinessOrderIds.includes(order.id);
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const parkingSourceTransitions: Array<ActivateQuickInvoiceSnapshotResult["parkingSourceTransitions"][number]> = [];
    const canonicalParkingSources = storedParkingSources.map((source) => {
      const materialized = materializeParkingSourceForActivation(source, recordedAt);
      if (materialized === source) return source;
      parkingSourceTransitions.push({
        caseId: source.id,
        sourceBefore: structuredClone(source),
        parkingSource: structuredClone(materialized),
      });
      return materialized;
    });
    const parkingProjectionLines: ParkingProjectionChargeLine[] = canonicalParkingSources.map((source) => {
      if (source.vehicleId !== order.vehicleId) {
        throw new LinkedApiDomainError("parking source 与 Business Order 车辆不一致", 409);
      }
      const lastWaiver = source.waiverHistory[source.waiverHistory.length - 1];
      const amountJmd = deriveParkingFinalAccrual({
        currentAccrual: source.accrual,
        dailyRateJmd: source.dailyRateJmd,
        latestWaiverDecision: lastWaiver,
      }).finalAmountJmd;
      const existingClaim = state.activeParkingClaim[source.id];
      const chargeLineId = existingClaim?.logicalInvoiceId === invoiceId
        ? existingClaim.chargeLineId
        : parkingProjectionLineId(source.id);
      if (order.chargeLines.some((line) => line.id === chargeLineId)) {
        throw new LinkedApiDomainError("parking projection charge line ID 冲突", 409);
      }
      return {
        id: chargeLineId,
        category: "other_service",
        pricingMode: "parking_projection",
        code: "parking_overtime",
        descZh: "停车超时费",
        descEn: "Parking overtime",
        remarkZh: "",
        remarkEn: "",
        parkingCaseId: source.id,
        sourceRevision: source.revision,
        asOf: source.asOf,
        amountJmd,
      };
    });
    const snapshot = buildInvoiceChargeSnapshot({
      sourceBusinessOrderId: order.id,
      sourceBusinessOrderRevision: state.revision,
      lines: [...order.chargeLines, ...parkingProjectionLines],
      adjustments: input.adjustments ?? [],
    });
    const snapshotCommitment = billingSnapshotCommitment(snapshot);
    const priorRefunds = state.refunds.flatMap((refund) => (
      refund.refundContract === "ordinary_line_v1" && refund.logicalInvoiceId === invoiceId
        ? [{
          chargeLineId: refund.chargeLineId,
          ...(refund.refundQuantity !== undefined ? { quantity: refund.refundQuantity } : {}),
          amountJmd: refund.receivableReductionJmd,
        }]
        : []
    ));
    const legacyOccupancies = state.legacyRefundOccupancies.flatMap((occupancy) => (
      occupancy.invoiceId === invoiceId && occupancy.status === "line" && occupancy.chargeLineId
        ? [{
          chargeLineId: occupancy.chargeLineId,
          ...(occupancy.legacyRefundQuantity !== undefined ? { quantity: occupancy.legacyRefundQuantity } : {}),
          amountJmd: occupancy.amountJmd,
        }]
        : []
    ));
    validateInvoiceLineageTransition({
      previousSnapshots: existing?.versions.map((version) => version.snapshot) ?? [],
      nextSnapshot: snapshot,
      refundOccupancies: [...priorRefunds, ...legacyOccupancies],
    });
    const occupiedInvoiceCreditJmd = checkedBillingSum([
      ...priorRefunds.map((occupancy) => occupancy.amountJmd),
      ...state.legacyRefundOccupancies
        .filter((occupancy) => occupancy.invoiceId === invoiceId)
        .map((occupancy) => occupancy.amountJmd),
    ], "Invoice refund occupancy");
    if (occupiedInvoiceCreditJmd > snapshot.totals.grandTotalJmd) {
      throw new LinkedApiDomainError("新 Invoice 总额低于既有退款占用", 409);
    }

    let nextActiveParkingClaim: Record<string, {
      logicalInvoiceId: string;
      financiallyEffectiveVersionId: string;
      chargeLineId: string;
    }>;
    try {
      nextActiveParkingClaim = transferParkingClaims({
        claims: state.activeParkingClaim,
        logicalInvoiceId: invoiceId,
        previousEffectiveVersionId: existing?.financiallyEffectiveVersionId ?? null,
        nextEffectiveVersionId: invoiceVersionId,
        nextParkingLines: snapshot.lines.filter(
          (line): line is InvoiceParkingSnapshotLine => line.pricingMode === "parking_projection",
        ),
      });
    } catch (error) {
      throw new LinkedApiDomainError(
        error instanceof Error ? error.message : "parking claim transfer failed",
        409,
      );
    }

    const requirement = discountApprovalRequirement(snapshot.lines.map(invoiceSnapshotLineToQuotedCharge));
    const previousEffectiveSnapshot = existing?.financiallyEffectiveVersionId === null
      ? null
      : existing?.versions.find((candidate) => candidate.id === existing.financiallyEffectiveVersionId)?.snapshot ?? null;
    const requiresFreshApproval = invoiceSnapshotRequiresFreshApproval(previousEffectiveSnapshot, snapshot);
    if (!requiresFreshApproval && input.signature) {
      throw new LinkedApiDomainError("本次 Invoice 未改变工时/配件优惠门槛坐标，不得提交 unnecessary signature", 400);
    }
    let evidence: DiscountApprovalEvidence | undefined;
    if (input.signature) {
      evidence = {
        document: { kind: "invoice", id: invoiceId },
        operationAccount: { id: normalizedActor.id, name: normalizedActor.name },
        rawStrokes: input.signature.rawStrokes,
        signedAt: recordedAt,
        mutationId: input.mutationId,
        categoryRatios: { labor: requirement.labor, parts: requirement.parts },
      };
      try {
        validateDiscountApprovalEvidence(evidence);
      } catch (error) {
        throw new LinkedApiDomainError(error instanceof Error ? error.message : "Invoice 签字笔迹无效", 400);
      }
      const digest = discountSignatureStrokeDigest(evidence.rawStrokes);
      if (state.discountSignatureEvents.some((event) => discountSignatureStrokeDigest(event.rawStrokes) === digest)) {
        throw new LinkedApiDomainError("该原始笔迹已被另一笔收费写入消费，请重新签字", 409);
      }
    }
    if (requiresFreshApproval && !evidence) {
      throw new LinkedApiDomainError("Invoice 工时或配件优惠超过门槛，需要一份新的非空原始笔迹签字", 400);
    }

    const version: SharedChargeInvoiceVersion = {
      id: invoiceVersionId,
      version: versionNumber,
      chargeContract: "shared_v1",
      snapshot,
      snapshotCommitment,
      issuedAt: recordedAt,
    };
    const invoice: SharedChargeInvoice = existing
      ? { ...existing, versions: [...existing.versions, version], financiallyEffectiveVersionId: invoiceVersionId }
      : {
        id: invoiceId,
        invoiceNo: nextSharedInvoiceNumber(state, recordedAt),
        businessOrderId: order.id,
        settlementArrangement: "normal",
        invoiceContract: "shared_v1",
        financiallyEffectiveVersionId: invoiceVersionId,
        versions: [version],
      };
    if (existing) state.invoices[state.invoices.indexOf(existing)] = invoice;
    else state.invoices.push(invoice);
    parkingSourceTransitions.forEach((transition) => {
      const sourceIndex = state.parkingCases.findIndex((candidate) => candidate.id === transition.caseId);
      if (sourceIndex < 0) throw new LinkedApiDomainError("parking source materialization 丢失", 409);
      state.parkingCases[sourceIndex] = structuredClone(transition.parkingSource);
    });
    state.activeParkingClaim = nextActiveParkingClaim;
    if (evidence) state.discountSignatureEvents.push(evidence);
    state.revision += 1;
    const result: ActivateQuickInvoiceSnapshotResult = {
      revision: state.revision,
      invoiceId,
      invoiceNo: invoice.invoiceNo,
      invoiceVersionId,
      snapshotCommitment,
      version: versionNumber,
      parkingSourceTransitions,
    };
    const audit: LinkedBillingAuditEvent = {
      id: nextBillingId("billing-audit", new Set(state.billingAuditEvents.map((event) => event.id))),
      operation: "invoice_activation",
      mutationId: input.mutationId,
      invoiceId,
      invoiceNo: invoice.invoiceNo,
      invoiceVersionId,
      snapshotCommitment,
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
      recordedAt,
    };
    state.billingAuditEvents.push(audit);
    return result;
  }, {
    action: "billing.invoice.activate.write",
    preReceiptGuard: (state) => assertBillingActorStillAuthorized(state, normalizedActor),
  });
  store.read(() => null, "billing.invoice.activate.response");
  return committed.result;
}

/** Atomically records an ordinary unit/fixed Invoice-line refund on the effective version. */
export async function recordMockInvoiceLineRefund(
  rawInput: RecordInvoiceLineRefundInput,
  actor: BillingMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  requestGuard?: () => void,
): Promise<Extract<LinkedInvoiceRefundFact, { refundContract: "ordinary_line_v1" }>> {
  requestGuard?.();
  const input = normalizeLineRefundInput(rawInput);
  if (isTask8ReservedChildMutationId(input.mutationId)) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  const normalizedActor = normalizeBillingActor(actor, "billing.invoice.lineRefund");
  const recordedAt = billingJamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<Extract<LinkedInvoiceRefundFact, { refundContract: "ordinary_line_v1" }>>({
    mutationId: input.mutationId,
    operation: "billing.invoice.lineRefund",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    assertBillingActorStillAuthorized(state, normalizedActor);
    if (state.revision !== input.expectedRevision) {
      throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
    }
    const invoice = state.invoices.find((candidate) => candidate.id === input.logicalInvoiceId);
    if (!invoice || !isSharedChargeInvoice(invoice)) throw new LinkedApiDomainError("canonical Invoice 不存在", 404);
    if (invoice.financiallyEffectiveVersionId !== input.invoiceVersionId) {
      throw new LinkedApiDomainError("只能从当前财务生效 Invoice 版本发起退款", 409);
    }
    const version = invoice.versions.find((candidate) => candidate.id === input.invoiceVersionId);
    if (!version) throw new LinkedApiDomainError("Invoice version 不属于该 logical Invoice", 409);
    const line = version.snapshot.lines.find((candidate) => candidate.chargeLineId === input.chargeLineId);
    if (!line) throw new LinkedApiDomainError("收费行不属于该 Invoice version", 409);
    if (line.pricingMode === "parking_projection") {
      throw new LinkedApiDomainError("停车投影必须走停车更正，不能走普通退款", 400);
    }
    if (line.pricingMode === "unit" && input.refundQuantity === undefined) {
      throw new LinkedApiDomainError("工时/配件退款必须提交数量", 400);
    }
    if (line.pricingMode === "fixed_total" && input.wholeLine !== true) {
      throw new LinkedApiDomainError("一口价其他服务只能明确整行退款", 400);
    }

    const modernRefunds = state.refunds.filter((refund): refund is Extract<LinkedInvoiceRefundFact, { refundContract: "ordinary_line_v1" }> => (
      refund.refundContract === "ordinary_line_v1" && refund.logicalInvoiceId === invoice.id
    ));
    const priorLineRefunds = modernRefunds.map((refund) => ({
      chargeLineId: refund.chargeLineId,
      ...(refund.refundQuantity !== undefined ? { quantity: refund.refundQuantity } : {}),
      receivableReductionJmd: refund.receivableReductionJmd,
    }));
    const assignedLegacy = state.legacyRefundOccupancies.filter((occupancy) => (
      occupancy.invoiceId === invoice.id && occupancy.status === "line"
    ));
    const legacyLineFacts = assignedLegacy.map((occupancy) => ({
      chargeLineId: occupancy.chargeLineId,
      amountJmd: occupancy.amountJmd,
      quantityUnknown: occupancy.quantityUnknown,
      ...(occupancy.legacyRefundQuantity !== undefined ? { quantity: occupancy.legacyRefundQuantity } : {}),
    }));
    const unassignedLegacyJmd = checkedBillingSum(
      state.legacyRefundOccupancies
        .filter((occupancy) => occupancy.invoiceId === invoice.id && occupancy.status === "unassigned")
        .map((occupancy) => occupancy.amountJmd),
      "unassigned legacy occupancy",
    );
    const priorReceivableReductionJmd = checkedBillingSum(
      modernRefunds.map((refund) => refund.receivableReductionJmd),
      "prior receivable reduction",
    );
    const legacyOccupancyJmd = checkedBillingSum(
      state.legacyRefundOccupancies
        .filter((occupancy) => occupancy.invoiceId === invoice.id)
        .map((occupancy) => occupancy.amountJmd),
      "legacy refund occupancy",
    );
    const totalJmd = version.snapshot.totals.grandTotalJmd;
    const receivableBeforeRefundJmd = totalJmd - priorReceivableReductionJmd;
    const remainingInvoiceCreditJmd = totalJmd - priorReceivableReductionJmd - legacyOccupancyJmd;
    if (!Number.isSafeInteger(receivableBeforeRefundJmd) || receivableBeforeRefundJmd < 0
      || !Number.isSafeInteger(remainingInvoiceCreditJmd) || remainingInvoiceCreditJmd < 0) {
      throw new LinkedApiDomainError("Invoice 既有退款/occupancy 超过财务生效总额", 409);
    }
    const usedLineCreditJmd = checkedBillingSum([
      ...modernRefunds.filter((refund) => refund.chargeLineId === line.chargeLineId)
        .map((refund) => refund.receivableReductionJmd),
      ...assignedLegacy.filter((occupancy) => occupancy.chargeLineId === line.chargeLineId)
        .map((occupancy) => occupancy.amountJmd),
    ], "line refund occupancy");
    const remainingLineCreditJmd = lineSnapshotAmount(line) - usedLineCreditJmd;
    if (!Number.isSafeInteger(remainingLineCreditJmd) || remainingLineCreditJmd < 0) {
      throw new LinkedApiDomainError("收费行退款 occupancy 超过财务生效金额", 409);
    }
    const financial = deriveLinkedInvoiceFinancialSummary(state, invoice);
    const preview = previewOrdinaryLineRefund({
      line,
      ...(input.refundQuantity !== undefined ? { refundQuantity: input.refundQuantity } : {}),
      ...(input.wholeLine === true ? { wholeLine: true as const } : {}),
      receivableBeforeRefundJmd,
      netPaidBeforeJmd: financial.paidJmd,
      remainingInvoiceCreditJmd,
      remainingLineCreditJmd,
      priorRefunds: priorLineRefunds,
      legacyOccupancies: legacyLineFacts,
      legacyUnassignedOccupancyJmd: unassignedLegacyJmd,
    });
    const refund: Extract<LinkedInvoiceRefundFact, { refundContract: "ordinary_line_v1" }> = {
      id: nextBillingId("invoice-line-refund", new Set(state.refunds.map((candidate) => candidate.id))),
      refundContract: "ordinary_line_v1",
      logicalInvoiceId: invoice.id,
      invoiceVersionId: version.id,
      chargeLineId: line.chargeLineId,
      category: line.category,
      pricingMode: line.pricingMode,
      ...(preview.refundQuantity !== undefined ? { refundQuantity: preview.refundQuantity } : {}),
      ...(preview.wholeLine === true ? { wholeLine: true as const } : {}),
      lineSnapshot: structuredClone(line),
      receivableReductionJmd: preview.receivableReductionJmd,
      cashRefundJmd: preview.cashRefundJmd,
      method: input.method,
      reason: input.reason,
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
      refundedAt: recordedAt,
      mutationId: input.mutationId,
    };
    state.refunds.push(refund);
    state.revision += 1;
    state.billingAuditEvents.push({
      id: nextBillingId("billing-audit", new Set(state.billingAuditEvents.map((event) => event.id))),
      operation: "invoice_line_refund",
      mutationId: input.mutationId,
      invoiceId: invoice.id,
      invoiceVersionId: version.id,
      refundId: refund.id,
      chargeLineId: line.chargeLineId,
      receivableReductionJmd: refund.receivableReductionJmd,
      cashRefundJmd: refund.cashRefundJmd,
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
      recordedAt,
    });
    return refund;
  }, {
    action: "billing.invoice.lineRefund.write",
    preReceiptGuard: (state) => {
      requestGuard?.();
      assertBillingActorStillAuthorized(state, normalizedActor);
    },
  });
  store.read(() => null, "billing.invoice.lineRefund.response");
  requestGuard?.();
  return committed.result;
}
