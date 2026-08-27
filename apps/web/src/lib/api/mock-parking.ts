import { calculateParkingAccrual, deriveParkingFinalAccrual, validateParkingWaiver } from "../parking/calculations";
import type { ParkingWaiverPreview } from "../parking/types";
import {
  buildInvoiceChargeSnapshot,
  invoiceSnapshotLineToQuotedCharge,
  validateInvoiceLineageTransition,
  type InvoiceParkingSnapshotLine,
} from "../billing/invoice-snapshots";
import {
  isSharedChargeInvoice,
  type ModernInvoicePaymentFact,
  type SharedChargeInvoiceVersion,
} from "../billing/types";
import { calculateParkingCorrectionAmounts, transferParkingClaims } from "../parking/invoice-claims";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoicePayment,
  type BillingMutationActor,
} from "./mock-billing";
import { isSharedChargeQuickOrder } from "../orders/quick-order-types";
import {
  billingSnapshotCommitment,
  canonicalBillingActorIdentity,
  deriveLinkedInvoiceFinancialSummary,
  getMockLinkedOperationsStore,
  isModernParkingSourceFact,
  isTask8ReservedChildMutationId,
  LinkedApiDomainError,
  task8ChildMutationId,
  validateAdministratorSignature,
  type AdministratorSignatureEvidence,
  type LinkedBillingAuditEvent,
  type LinkedModernParkingCorrectionPreviewToken,
  type LinkedModernParkingSourceFact,
  type LinkedModernParkingWaiverDecision,
  type LinkedOperationsState,
  type LinkedParkingCaseFact,
  type LinkedParkingWaiverAudit,
  type MockLinkedOperationsStore,
} from "./mock-orders";

export interface ParkingCaseDto {
  caseId: string;
  businessOrderId?: string;
  originBusinessOrderId?: string;
  eligibleBusinessOrderIds?: ReadonlyArray<string>;
  invoiceId?: string;
  invoiceVersionId?: string;
  vehicleId: string;
  notificationDate: string;
  pickupDate?: string;
  dailyRateJmd: number;
  originalChargeableDays: number;
  originalAmountJmd: number;
  finalChargeableDays: number;
  finalAmountJmd: number;
  revision: number;
  waiverHistory: ParkingWaiverPreview[];
  waiverAudits: LinkedParkingWaiverAudit[];
}

export interface ParkingListResponse {
  items: ParkingCaseDto[];
}

export interface CanonicalModernParkingCommittedDto {
  readonly sourceRevision: number;
  readonly sourceAsOf: string;
  readonly chargeableDays: number;
  readonly grossAmountJmd: number;
  readonly cumulativeWaivedDays: number;
  readonly cumulativeWaivedAmountJmd: number;
  readonly finalAmountJmd: number;
}

export interface CanonicalModernParkingLiveDto {
  readonly asOf: string;
  readonly calendarDate: string;
  readonly chargeableDays: number;
  readonly grossAmountJmd: number;
  readonly finalAmountJmd: number;
  readonly projectionCommitment: string;
}

export interface CanonicalModernParkingUnclaimedBillingDto {
  readonly status: "unclaimed";
  readonly eligibleBusinessOrderIds: ReadonlyArray<string>;
}

export interface CanonicalModernParkingClaimedBillingDto {
  readonly status: "claimed";
  readonly invoiceId: string;
  readonly invoiceNo: string;
  readonly effectiveVersionId: string;
  readonly snapshotCommitment: string;
  readonly line: {
    readonly chargeLineId: string;
    readonly sourceRevision: number;
    readonly sourceAsOf: string;
    readonly amountJmd: number;
  };
  readonly ledger: {
    readonly receivableJmd: number;
    readonly grossPaidJmd: number;
    readonly cashRefundedJmd: number;
    readonly netPaidJmd: number;
    readonly balanceJmd: number;
    readonly status: "due" | "settled" | "overpaid";
  };
  readonly correctionRequired: boolean;
}

export interface CanonicalModernParkingListItem {
  readonly sourceKind: "modern";
  readonly caseId: string;
  readonly vehicleId: string;
  readonly customerId: string;
  readonly originBusinessOrderId: string;
  readonly eligibleBusinessOrderIds: ReadonlyArray<string>;
  readonly notificationDate: string;
  readonly pickupDate: string | null;
  readonly dailyRateJmd: number;
  readonly committed: CanonicalModernParkingCommittedDto;
  readonly live: CanonicalModernParkingLiveDto;
  readonly billing: CanonicalModernParkingUnclaimedBillingDto | CanonicalModernParkingClaimedBillingDto;
}

export interface CanonicalParkingListResponse {
  readonly contract: "parking_list_v1";
  readonly revision: number;
  readonly asOf: string;
  readonly items: ReadonlyArray<CanonicalModernParkingListItem>;
}

export interface CanonicalParkingPaymentSourceProjectionInput {
  readonly caseId: string;
  readonly projectionCommitment: string;
}

interface CollectCanonicalParkingPaymentCommonInput {
  readonly contract: "parking_payment_collect_v1";
  readonly caseId: string;
  readonly expectedRevision: number;
  readonly expectedSourceRevision: number;
  readonly mutationId: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly note?: string;
}

export type CollectCanonicalParkingPaymentInput = CollectCanonicalParkingPaymentCommonInput & (
  | {
    readonly status: "claimed";
    readonly invoiceId: string;
    readonly effectiveVersionId: string;
    readonly balanceJmd: number;
  }
  | {
    readonly status: "unclaimed";
    readonly carrierBusinessOrderId: string;
    readonly sourceProjections: ReadonlyArray<CanonicalParkingPaymentSourceProjectionInput>;
    readonly invoiceSignature?: {
      readonly rawStrokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number; time: number }>>;
    };
  }
);

export interface CanonicalParkingPaymentClaimDto {
  readonly caseId: string;
  readonly invoiceId: string;
  readonly effectiveVersionId: string;
  readonly chargeLineId: string;
}

export interface CanonicalParkingPaymentActivatedInvoiceDto {
  readonly invoiceId: string;
  readonly invoiceNo: string;
  readonly effectiveVersionId: string;
  readonly version: number;
  readonly snapshotCommitment: string;
}

export interface CanonicalParkingPaymentSourceTransitionDto {
  readonly caseId: string;
  readonly sourceRevisionBefore: number;
  readonly sourceRevisionAfter: number;
  readonly amountJmd: number;
}

export interface CanonicalParkingPaymentFactDto {
  readonly id: string;
  readonly invoiceId: string;
  readonly effectiveVersionId: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly note?: string;
  readonly receivedAt: string;
  readonly receivedBy: string;
}

export interface CanonicalParkingPaymentFinancialDto {
  readonly receivableJmd: number;
  readonly grossPaidJmd: number;
  readonly cashRefundedJmd: number;
  readonly netPaidJmd: number;
  readonly balanceJmd: number;
  readonly status: "due" | "settled" | "overpaid";
}

export interface CollectCanonicalParkingPaymentResult {
  readonly revision: number;
  readonly caseId: string;
  readonly claim: CanonicalParkingPaymentClaimDto;
  readonly activatedInvoice: CanonicalParkingPaymentActivatedInvoiceDto | null;
  readonly sourceTransitions: ReadonlyArray<CanonicalParkingPaymentSourceTransitionDto>;
  readonly payment: CanonicalParkingPaymentFactDto;
  readonly financial: CanonicalParkingPaymentFinancialDto;
}

interface CanonicalParkingPaymentReceiptResult {
  readonly receiptContract: "parking_payment_collect_receipt_v1";
  readonly activationChildMutationId: string | null;
  readonly paymentChildMutationId: string;
  readonly publicResult: CollectCanonicalParkingPaymentResult;
}

export interface RecordModernParkingSourcePickupInput {
  readonly caseId: string;
  readonly expectedRevision: number;
  readonly expectedSourceRevision: number;
  readonly mutationId: string;
}

export interface RecordModernParkingSourcePickupResult {
  readonly revision: number;
  readonly caseId: string;
  readonly sourceRevision: number;
  readonly sourceBefore: LinkedModernParkingSourceFact;
  readonly parkingSource: LinkedModernParkingSourceFact;
  readonly invoiceId: string | null;
  readonly previousInvoiceVersionId: string | null;
  readonly invoiceVersionId: string | null;
  readonly snapshotCommitment: string | null;
  readonly parkingDeltaJmd: number;
  readonly parkingCashRefundJmd: 0;
  readonly actorId: string;
  readonly actorName: string;
}

export interface PreviewParkingWaiverInput {
  caseId: string;
  waiveDays: number;
  reason: string;
}

export interface PreviewModernParkingCorrectionInput extends PreviewParkingWaiverInput {
  expectedRevision: number;
  expectedSourceRevision: number;
  mutationId: string;
}

export interface ParkingWaiverPreviewDto extends ParkingWaiverPreview {
  sourceRevision: number;
  previewToken: string;
  expiresAt: string;
}

export interface ModernParkingCorrectionPreviewDto extends ParkingWaiverPreviewDto {
  latestRevision: number;
  nextSourceRevision: number;
  sourceAsOf: string;
  parkingAdministratorSignatureRequired: boolean;
  invoiceSignatureRequired: boolean;
  claimedInvoiceId: string | null;
  claimedInvoiceVersionId: string | null;
  nextInvoiceVersionId: string | null;
  nextSnapshotCommitment: string | null;
  parkingDeltaJmd: number;
  parkingCashRefundJmd: number;
  sourceBefore: LinkedModernParkingSourceFact;
  parkingSource: LinkedModernParkingSourceFact;
}

export interface ApplyParkingWaiverInput extends PreviewParkingWaiverInput {
  expectedRevision: number;
  previewToken: string;
  administratorId?: string;
  administratorSignature?: AdministratorSignatureEvidence;
}

export interface ApplyModernParkingCorrectionInput {
  caseId: string;
  expectedRevision: number;
  expectedSourceRevision: number;
  mutationId: string;
  previewToken: string;
  refundMethod?: string;
  administratorId?: string;
  administratorSignature?: AdministratorSignatureEvidence;
  invoiceSignature?: { readonly rawStrokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number; time: number }>> };
}

export interface ApplyModernParkingCorrectionResult {
  revision: number;
  caseId: string;
  sourceRevision: number;
  invoiceId: string | null;
  invoiceVersionId: string | null;
  parkingDeltaJmd: number;
  parkingCashRefundJmd: number;
  parkingSource: LinkedModernParkingSourceFact;
}

const MODERN_PREVIEW_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "waiveDays", "reason",
]);
const MODERN_PICKUP_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId",
]);
const MODERN_APPLY_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "previewToken",
  "refundMethod", "administratorId", "administratorSignature", "invoiceSignature",
]);
const MODERN_APPLY_REQUIRED_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "previewToken",
]);
const CANONICAL_PARKING_PAYMENT_FIELDS = new Set([
  "contract", "status", "caseId", "expectedRevision", "expectedSourceRevision", "mutationId",
  "amountJmd", "method", "note", "invoiceId", "effectiveVersionId", "balanceJmd",
  "carrierBusinessOrderId", "sourceProjections", "invoiceSignature",
]);
const CANONICAL_PARKING_PAYMENT_COMMON_REQUIRED_FIELDS = new Set([
  "contract", "status", "caseId", "expectedRevision", "expectedSourceRevision", "mutationId",
  "amountJmd", "method",
]);
const CANONICAL_PARKING_PAYMENT_PROJECTION_FIELDS = new Set(["caseId", "projectionCommitment"]);
const CANONICAL_PARKING_PAYMENT_SIGNATURE_FIELDS = new Set(["rawStrokes"]);
const CANONICAL_PARKING_PAYMENT_SIGNATURE_POINT_FIELDS = new Set(["x", "y", "time"]);
const PARKING_ACTOR_FIELDS = new Set(["id", "name", "role"]);

function assertClosedObject(
  value: unknown,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
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
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new LinkedApiDomainError(`${label} contains an unexpected field: ${String(key)}`, 400);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      throw new LinkedApiDomainError(`${label}字段 ${String(key)} 不能是访问器、隐藏字段或 undefined`, 400);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new LinkedApiDomainError(`${label}缺少字段 ${key}`, 400);
    }
  }
}

function positiveRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new LinkedApiDomainError(`${label}必须为正安全整数`, 400);
  }
  return Number(value);
}

function normalizeParkingActor(
  actor: BillingMutationActor,
  operation: "parking.source.pickup" | "parking.correction.preview" | "parking.source.correct" | "parking.source.pay",
): BillingMutationActor {
  assertClosedObject(actor, PARKING_ACTOR_FIELDS, PARKING_ACTOR_FIELDS, "停车更正账号");
  const id = requiredText(actor.id, "停车更正账号 ID");
  const name = requiredText(actor.name, "停车更正账号姓名");
  const canonical = canonicalBillingActorIdentity(operation, id);
  if (!canonical || actor.role !== canonical.role || name !== canonical.name) {
    throw new LinkedApiDomainError("停车更正账号无权限", 403);
  }
  return canonical;
}

function assertClosedArray(value: unknown, label: string): asserts value is ReadonlyArray<unknown> {
  if (!Array.isArray(value)) throw new LinkedApiDomainError(`${label}必须为数组`, 400);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) throw new LinkedApiDomainError(`${label}字段不闭合`, 400);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.value === undefined) {
      throw new LinkedApiDomainError(`${label}不能包含空洞、访问器、隐藏值或 undefined`, 400);
    }
  }
}

function cloneCanonicalParkingRawStrokes(
  value: unknown,
): ReadonlyArray<ReadonlyArray<{ x: number; y: number; time: number }>> {
  assertClosedArray(value, "canonical parking Invoice raw strokes");
  if (value.length === 0) throw new LinkedApiDomainError("Invoice 签字笔迹不能为空", 400);
  return value.map((stroke, strokeIndex) => {
    assertClosedArray(stroke, `canonical parking Invoice raw stroke ${strokeIndex}`);
    return stroke.map((point, pointIndex) => {
      assertClosedObject(
        point,
        CANONICAL_PARKING_PAYMENT_SIGNATURE_POINT_FIELDS,
        CANONICAL_PARKING_PAYMENT_SIGNATURE_POINT_FIELDS,
        `canonical parking Invoice stroke point ${strokeIndex}:${pointIndex}`,
      );
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.time)) {
        throw new LinkedApiDomainError("Invoice 笔迹坐标和时间必须为有限数", 400);
      }
      return { x: Number(point.x), y: Number(point.y), time: Number(point.time) };
    });
  });
}

function normalizeCanonicalParkingPaymentInput(
  raw: CollectCanonicalParkingPaymentInput,
): CollectCanonicalParkingPaymentInput {
  assertClosedObject(
    raw,
    CANONICAL_PARKING_PAYMENT_FIELDS,
    CANONICAL_PARKING_PAYMENT_COMMON_REQUIRED_FIELDS,
    "canonical parking payment request",
  );
  if (raw.contract !== "parking_payment_collect_v1") {
    throw new LinkedApiDomainError("canonical parking payment contract 无效", 400);
  }
  const mutationId = requiredText(raw.mutationId, "mutationId");
  if (isTask8ReservedChildMutationId(mutationId)) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  if (!Number.isSafeInteger(raw.amountJmd) || raw.amountJmd <= 0) {
    throw new LinkedApiDomainError("停车收款金额必须为正安全整数", 400);
  }
  const common = {
    contract: "parking_payment_collect_v1" as const,
    caseId: requiredText(raw.caseId, "停车案件 ID"),
    expectedRevision: positiveRevision(raw.expectedRevision, "expectedRevision"),
    expectedSourceRevision: positiveRevision(raw.expectedSourceRevision, "expectedSourceRevision"),
    mutationId,
    amountJmd: raw.amountJmd,
    method: requiredText(raw.method, "收款方式"),
    ...(raw.note === undefined ? {} : { note: requiredText(raw.note, "收款备注") }),
  };
  if (raw.status === "claimed") {
    const required = ["invoiceId", "effectiveVersionId", "balanceJmd"] as const;
    if (required.some((field) => !Object.prototype.hasOwnProperty.call(raw, field))) {
      throw new LinkedApiDomainError("claimed parking payment 缺少 Invoice fence", 400);
    }
    if (["carrierBusinessOrderId", "sourceProjections", "invoiceSignature"].some((field) => (
      Object.prototype.hasOwnProperty.call(raw, field)
    ))) {
      throw new LinkedApiDomainError("claimed parking payment 不得混入 unclaimed 字段", 400);
    }
    if (!Number.isSafeInteger(raw.balanceJmd) || raw.balanceJmd < 0) {
      throw new LinkedApiDomainError("claimed parking payment balance 无效", 400);
    }
    return {
      ...common,
      status: "claimed",
      invoiceId: requiredText(raw.invoiceId, "Invoice ID"),
      effectiveVersionId: requiredText(raw.effectiveVersionId, "effective Invoice version ID"),
      balanceJmd: raw.balanceJmd,
    };
  }
  if (raw.status !== "unclaimed") {
    throw new LinkedApiDomainError("canonical parking payment status 无效", 400);
  }
  if (["invoiceId", "effectiveVersionId", "balanceJmd"].some((field) => (
    Object.prototype.hasOwnProperty.call(raw, field)
  ))) {
    throw new LinkedApiDomainError("unclaimed parking payment 不得混入 claimed 字段", 400);
  }
  if (!Object.prototype.hasOwnProperty.call(raw, "carrierBusinessOrderId")
    || !Object.prototype.hasOwnProperty.call(raw, "sourceProjections")) {
    throw new LinkedApiDomainError("unclaimed parking payment 缺少 carrier/source projections", 400);
  }
  assertClosedArray(raw.sourceProjections, "parking source projections");
  const sourceProjections = raw.sourceProjections.map((projection, index) => {
    assertClosedObject(
      projection,
      CANONICAL_PARKING_PAYMENT_PROJECTION_FIELDS,
      CANONICAL_PARKING_PAYMENT_PROJECTION_FIELDS,
      `parking source projection ${index}`,
    );
    return {
      caseId: requiredText(projection.caseId as string, "parking source projection case ID"),
      projectionCommitment: requiredText(
        projection.projectionCommitment as string,
        "parking source projection commitment",
      ),
    };
  });
  const sortedSourceProjections = [...sourceProjections].sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (new Set(sourceProjections.map((projection) => projection.caseId)).size !== sourceProjections.length
    || JSON.stringify(sourceProjections) !== JSON.stringify(sortedSourceProjections)) {
    throw new LinkedApiDomainError("parking source projections 必须按 caseId 排序且不得重复", 400);
  }
  let invoiceSignature: Extract<CollectCanonicalParkingPaymentInput, { status: "unclaimed" }>["invoiceSignature"];
  if (raw.invoiceSignature !== undefined) {
    assertClosedObject(
      raw.invoiceSignature,
      CANONICAL_PARKING_PAYMENT_SIGNATURE_FIELDS,
      CANONICAL_PARKING_PAYMENT_SIGNATURE_FIELDS,
      "canonical parking Invoice signature",
    );
    invoiceSignature = { rawStrokes: cloneCanonicalParkingRawStrokes(raw.invoiceSignature.rawStrokes) };
  }
  return {
    ...common,
    status: "unclaimed",
    carrierBusinessOrderId: requiredText(raw.carrierBusinessOrderId, "carrier Business Order ID"),
    sourceProjections,
    ...(invoiceSignature ? { invoiceSignature } : {}),
  };
}

function assertParkingActorStillAuthorized(state: LinkedOperationsState, actor: BillingMutationActor): void {
  if (!state.trustedIdentities.some((identity) => identity.id === actor.id && identity.role === actor.role)) {
    throw new LinkedApiDomainError("停车更正账号权限已变化，请重新登录", 403);
  }
}

function parkingJamaicaInstant(nowMs: number): string {
  const localClock = new Date(nowMs - 5 * 60 * 60 * 1_000).toISOString();
  return `${localClock.slice(0, -1)}-05:00`;
}

function isStore(value: unknown): value is MockLinkedOperationsStore {
  return value !== null && typeof value === "object"
    && typeof (value as MockLinkedOperationsStore).mutate === "function"
    && typeof (value as MockLinkedOperationsStore).mutateIdempotently === "function";
}

function nextParkingId(prefix: string, occupied: ReadonlySet<string>): string {
  for (let sequence = 1; sequence <= 999_999; sequence += 1) {
    const id = `${prefix}-${sequence}`;
    if (!occupied.has(id)) return id;
  }
  throw new LinkedApiDomainError(`${prefix} ID 序列已耗尽`, 409);
}

function advanceModernSourceClock(
  source: LinkedModernParkingSourceFact,
  sourceAsOf: string,
): LinkedModernParkingSourceFact {
  const accrualEndDate = source.pickupDate ?? sourceAsOf.slice(0, 10);
  return {
    ...source,
    asOf: sourceAsOf,
    accrual: calculateParkingAccrual({
      notificationDate: source.notificationDate,
      pickupDate: accrualEndDate,
      dailyRateJmd: source.dailyRateJmd,
    }),
  };
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LinkedApiDomainError(`${label}不能为空`, 400);
  return value.trim();
}

function publicParkingMutationId(value: string): string {
  const mutationId = requiredText(value, "mutationId");
  if (isTask8ReservedChildMutationId(mutationId)) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  return mutationId;
}

function validateDays(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new LinkedApiDomainError("减免天数必须为正整数", 400);
}

function normalizeModernPreviewInput(raw: PreviewModernParkingCorrectionInput): PreviewModernParkingCorrectionInput {
  assertClosedObject(raw, MODERN_PREVIEW_FIELDS, MODERN_PREVIEW_FIELDS, "parking correction preview request");
  validateDays(raw.waiveDays);
  return {
    caseId: requiredText(raw.caseId, "停车案件 ID"),
    expectedRevision: positiveRevision(raw.expectedRevision, "expectedRevision"),
    expectedSourceRevision: positiveRevision(raw.expectedSourceRevision, "expectedSourceRevision"),
    mutationId: publicParkingMutationId(raw.mutationId),
    waiveDays: raw.waiveDays,
    reason: requiredText(raw.reason, "减免原因"),
  };
}

function normalizeModernPickupInput(raw: RecordModernParkingSourcePickupInput): RecordModernParkingSourcePickupInput {
  assertClosedObject(raw, MODERN_PICKUP_FIELDS, MODERN_PICKUP_FIELDS, "parking source pickup request");
  return {
    caseId: requiredText(raw.caseId, "停车案件 ID"),
    expectedRevision: positiveRevision(raw.expectedRevision, "expectedRevision"),
    expectedSourceRevision: positiveRevision(raw.expectedSourceRevision, "expectedSourceRevision"),
    mutationId: publicParkingMutationId(raw.mutationId),
  };
}

function normalizeModernApplyInput(raw: ApplyModernParkingCorrectionInput): ApplyModernParkingCorrectionInput {
  assertClosedObject(raw, MODERN_APPLY_FIELDS, MODERN_APPLY_REQUIRED_FIELDS, "parking correction apply request");
  return {
    caseId: requiredText(raw.caseId, "停车案件 ID"),
    expectedRevision: positiveRevision(raw.expectedRevision, "expectedRevision"),
    expectedSourceRevision: positiveRevision(raw.expectedSourceRevision, "expectedSourceRevision"),
    mutationId: publicParkingMutationId(raw.mutationId),
    previewToken: requiredText(raw.previewToken, "previewToken"),
    ...(raw.refundMethod !== undefined ? { refundMethod: requiredText(raw.refundMethod, "退款方式") } : {}),
    ...(raw.administratorId !== undefined ? { administratorId: requiredText(raw.administratorId, "管理员 ID") } : {}),
    ...(raw.administratorSignature !== undefined ? { administratorSignature: raw.administratorSignature } : {}),
    ...(raw.invoiceSignature !== undefined ? { invoiceSignature: raw.invoiceSignature } : {}),
  };
}

function latestWaiver(parking: LinkedParkingCaseFact): ParkingWaiverPreview | undefined {
  return parking.waiverHistory[parking.waiverHistory.length - 1];
}

function calculatePreview(parking: LinkedParkingCaseFact, waiveDays: number): ParkingWaiverPreview {
  const previous = latestWaiver(parking);
  const existingWaivedDays = previous?.cumulativeWaivedDays ?? 0;
  if (
    existingWaivedDays <= parking.accrual.chargeableDays
    && waiveDays > parking.accrual.chargeableDays - existingWaivedDays
  ) {
    throw new LinkedApiDomainError("累计减免天数不得超过原始计费天数", 400);
  }
  return validateParkingWaiver({
    caseId: parking.id,
    originalChargeableDays: parking.accrual.chargeableDays,
    dailyRateJmd: parking.dailyRateJmd,
    existingWaivedDays,
    existingWaivedAmountJmd: previous?.cumulativeWaivedAmountJmd ?? 0,
    proposedWaivedDays: waiveDays,
    proposedWaivedAmountJmd: waiveDays * parking.dailyRateJmd,
  });
}

function createOpaqueToken(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("安全随机预览令牌生成器不可用");
  }
  return `pwp_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

function caseDto(state: LinkedOperationsState, parking: LinkedParkingCaseFact): ParkingCaseDto {
  const last = latestWaiver(parking);
  const currentFinal = isModernParkingSourceFact(parking)
    ? deriveParkingFinalAccrual({
      currentAccrual: parking.accrual,
      dailyRateJmd: parking.dailyRateJmd,
      latestWaiverDecision: last,
    })
    : undefined;
  return {
    caseId: parking.id,
    ...(isModernParkingSourceFact(parking) ? {
      originBusinessOrderId: parking.originBusinessOrderId,
      eligibleBusinessOrderIds: [...parking.eligibleBusinessOrderIds],
    } : {
      businessOrderId: parking.businessOrderId,
      invoiceId: parking.invoiceId,
      invoiceVersionId: parking.invoiceVersionId,
    }),
    vehicleId: parking.vehicleId,
    notificationDate: parking.notificationDate,
    ...(parking.pickupDate ? { pickupDate: parking.pickupDate } : {}),
    dailyRateJmd: parking.dailyRateJmd,
    originalChargeableDays: parking.accrual.chargeableDays,
    originalAmountJmd: parking.accrual.originalAmountJmd,
    finalChargeableDays: currentFinal?.finalChargeableDays ?? last?.finalChargeableDays ?? parking.accrual.chargeableDays,
    finalAmountJmd: currentFinal?.finalAmountJmd ?? last?.finalAmountJmd ?? parking.accrual.originalAmountJmd,
    revision: parking.revision,
    waiverHistory: [...parking.waiverHistory],
    waiverAudits: state.parkingWaiverAudits.filter((audit) => audit.caseId === parking.id),
  };
}

export function getMockParkingList(): ParkingListResponse {
  return getMockLinkedOperationsStore().read((state) => ({
    items: state.parkingCases.map((parking) => caseDto(state, parking)),
  }), "parking.list.read");
}

function parkingProjectionCommitment(value: Readonly<Record<string, unknown>>): string {
  const canonical = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function canonicalModernParkingListItem(
  state: LinkedOperationsState,
  source: LinkedModernParkingSourceFact,
  asOf: string,
): CanonicalModernParkingListItem {
  const originOrder = state.quickOrders.find((order) => order.id === source.originBusinessOrderId);
  if (!originOrder) throw new LinkedApiDomainError("canonical parking source origin Business Order 不存在", 500);
  const latestDecision = source.waiverHistory[source.waiverHistory.length - 1];
  const committedFinal = deriveParkingFinalAccrual({
    currentAccrual: source.accrual,
    dailyRateJmd: source.dailyRateJmd,
    latestWaiverDecision: latestDecision,
  });
  const calendarDate = asOf.slice(0, 10);
  const liveAccrual = calculateParkingAccrual({
    notificationDate: source.notificationDate,
    pickupDate: source.pickupDate ?? calendarDate,
    dailyRateJmd: source.dailyRateJmd,
  });
  const liveFinal = deriveParkingFinalAccrual({
    currentAccrual: liveAccrual,
    dailyRateJmd: source.dailyRateJmd,
    latestWaiverDecision: latestDecision,
  });
  const cumulativeWaivedDays = latestDecision?.cumulativeWaivedDays ?? 0;
  const cumulativeWaivedAmountJmd = latestDecision?.cumulativeWaivedAmountJmd ?? 0;
  const liveWithoutCommitment = {
    asOf,
    calendarDate,
    chargeableDays: liveAccrual.chargeableDays,
    grossAmountJmd: liveAccrual.originalAmountJmd,
    finalAmountJmd: liveFinal.finalAmountJmd,
  };
  const live: CanonicalModernParkingLiveDto = {
    ...liveWithoutCommitment,
    projectionCommitment: parkingProjectionCommitment({
      contract: "parking_live_projection_v1",
      caseId: source.id,
      sourceRevision: source.revision,
      cumulativeWaivedDays,
      cumulativeWaivedAmountJmd,
      calendarDate,
      chargeableDays: liveAccrual.chargeableDays,
      grossAmountJmd: liveAccrual.originalAmountJmd,
      finalAmountJmd: liveFinal.finalAmountJmd,
    }),
  };
  const claim = state.activeParkingClaim[source.id];
  let billing: CanonicalModernParkingListItem["billing"];
  if (!claim) {
    billing = {
      status: "unclaimed",
      eligibleBusinessOrderIds: [...source.eligibleBusinessOrderIds],
    };
  } else {
    const invoice = state.invoices.find((candidate) => candidate.id === claim.logicalInvoiceId);
    if (!invoice || !isSharedChargeInvoice(invoice)) {
      throw new LinkedApiDomainError("canonical parking claim Invoice 不存在", 500);
    }
    const effectiveVersion = invoice.versions.find((version) => (
      version.id === invoice.financiallyEffectiveVersionId
    ));
    if (!effectiveVersion || effectiveVersion.id !== claim.financiallyEffectiveVersionId) {
      throw new LinkedApiDomainError("canonical parking claim effective version 不一致", 500);
    }
    const line = effectiveVersion.snapshot.lines.find((candidate) => (
      candidate.pricingMode === "parking_projection"
        && candidate.parkingCaseId === source.id
        && candidate.chargeLineId === claim.chargeLineId
    ));
    if (!line || line.pricingMode !== "parking_projection") {
      throw new LinkedApiDomainError("canonical parking claim Invoice line 不存在", 500);
    }
    const financial = deriveLinkedInvoiceFinancialSummary(state, invoice);
    const grossPaidJmd = state.payments
      .filter((payment) => payment.invoiceId === invoice.id)
      .reduce((sum, payment) => sum + payment.amountJmd, 0);
    const cashRefundedJmd = grossPaidJmd - financial.paidJmd;
    const receivableJmd = financial.paidJmd + financial.balanceJmd;
    if (
      !Number.isSafeInteger(grossPaidJmd)
      || !Number.isSafeInteger(cashRefundedJmd)
      || cashRefundedJmd < 0
      || !Number.isSafeInteger(receivableJmd)
      || receivableJmd < 0
    ) {
      throw new LinkedApiDomainError("canonical parking Invoice ledger 金额无效", 500);
    }
    billing = {
      status: "claimed",
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      effectiveVersionId: effectiveVersion.id,
      snapshotCommitment: effectiveVersion.snapshotCommitment,
      line: {
        chargeLineId: line.chargeLineId,
        sourceRevision: line.sourceRevision,
        sourceAsOf: line.asOf,
        amountJmd: line.amountJmd,
      },
      ledger: {
        receivableJmd,
        grossPaidJmd,
        cashRefundedJmd,
        netPaidJmd: financial.paidJmd,
        balanceJmd: financial.balanceJmd,
        status: financial.settlementStatus,
      },
      correctionRequired: line.sourceRevision !== source.revision
        || line.asOf !== source.asOf
        || line.amountJmd !== committedFinal.finalAmountJmd
        || line.amountJmd !== live.finalAmountJmd,
    };
  }
  return {
    sourceKind: "modern",
    caseId: source.id,
    vehicleId: source.vehicleId,
    customerId: originOrder.customerId,
    originBusinessOrderId: source.originBusinessOrderId,
    eligibleBusinessOrderIds: [...source.eligibleBusinessOrderIds],
    notificationDate: source.notificationDate,
    pickupDate: source.pickupDate ?? null,
    dailyRateJmd: source.dailyRateJmd,
    committed: {
      sourceRevision: source.revision,
      sourceAsOf: source.asOf,
      chargeableDays: source.accrual.chargeableDays,
      grossAmountJmd: source.accrual.originalAmountJmd,
      cumulativeWaivedDays,
      cumulativeWaivedAmountJmd,
      finalAmountJmd: committedFinal.finalAmountJmd,
    },
    live,
    billing,
  };
}

export function deriveMockCanonicalParkingList(
  state: LinkedOperationsState,
  nowMs: number,
): CanonicalParkingListResponse {
  const asOf = parkingJamaicaInstant(nowMs);
  return {
    contract: "parking_list_v1",
    revision: state.revision,
    asOf,
    items: state.parkingCases
      .filter((source): source is LinkedModernParkingSourceFact => isModernParkingSourceFact(source))
      .map((source) => canonicalModernParkingListItem(state, source, asOf))
      .sort((left, right) => left.caseId.localeCompare(right.caseId)),
  };
}

export function getMockCanonicalParkingList(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): CanonicalParkingListResponse {
  return store.read(
    (state) => deriveMockCanonicalParkingList(state, store.nowMs()),
    "parking.canonicalList.read",
  );
}

function canonicalParkingPaymentFactDto(payment: ModernInvoicePaymentFact): CanonicalParkingPaymentFactDto {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    effectiveVersionId: payment.invoiceVersionId,
    amountJmd: payment.amountJmd,
    method: payment.method,
    ...(payment.note !== undefined ? { note: payment.note } : {}),
    receivedAt: payment.receivedAt,
    receivedBy: payment.receivedBy,
  };
}

function canonicalParkingPaymentFinancialDto(
  billing: CanonicalModernParkingClaimedBillingDto,
): CanonicalParkingPaymentFinancialDto {
  return {
    receivableJmd: billing.ledger.receivableJmd,
    grossPaidJmd: billing.ledger.grossPaidJmd,
    cashRefundedJmd: billing.ledger.cashRefundedJmd,
    netPaidJmd: billing.ledger.netPaidJmd,
    balanceJmd: billing.ledger.balanceJmd,
    status: billing.ledger.status,
  };
}

function canonicalParkingPaymentClaimDto(
  caseId: string,
  claim: LinkedOperationsState["activeParkingClaim"][string],
): CanonicalParkingPaymentClaimDto {
  return {
    caseId,
    invoiceId: claim.logicalInvoiceId,
    effectiveVersionId: claim.financiallyEffectiveVersionId,
    chargeLineId: claim.chargeLineId,
  };
}

function assertClaimedInvoiceParkingIsCurrent(
  state: LinkedOperationsState,
  logicalInvoiceId: string,
  recordedAt: string,
): void {
  for (const [caseId, claim] of Object.entries(state.activeParkingClaim)) {
    if (claim.logicalInvoiceId !== logicalInvoiceId) continue;
    const source = state.parkingCases.find((candidate) => candidate.id === caseId);
    if (!source || !isModernParkingSourceFact(source)) {
      throw new LinkedApiDomainError("Invoice parking claim source 不存在", 409);
    }
    const item = canonicalModernParkingListItem(state, source, recordedAt);
    if (item.billing.status !== "claimed"
      || item.billing.invoiceId !== logicalInvoiceId
      || item.billing.effectiveVersionId !== claim.financiallyEffectiveVersionId
      || item.billing.correctionRequired) {
      throw new LinkedApiDomainError("Invoice 存在待更正 parking projection，请先完成停车更正", 409);
    }
  }
}

function assertExistingInvoiceAllowsParkingOnlyVersion(
  state: LinkedOperationsState,
  carrierBusinessOrderId: string,
  invoiceSignature: Extract<CollectCanonicalParkingPaymentInput, { status: "unclaimed" }>["invoiceSignature"],
  recordedAt: string,
): ReadonlyArray<SharedChargeInvoiceVersion["snapshot"]["adjustments"][number]> | undefined {
  const order = state.quickOrders.find((candidate) => candidate.id === carrierBusinessOrderId);
  if (!order || !isSharedChargeQuickOrder(order)) {
    throw new LinkedApiDomainError("carrier Business Order 不存在或未启用 shared 收费契约", 409);
  }
  const ownerInvoices = state.invoices.filter((candidate) => candidate.businessOrderId === order.id);
  if (ownerInvoices.some((candidate) => !isSharedChargeInvoice(candidate)) || ownerInvoices.length > 1) {
    throw new LinkedApiDomainError("carrier Business Order 的 Invoice owner 冲突", 409);
  }
  const existing = ownerInvoices[0];
  if (!existing) return undefined;
  if (!isSharedChargeInvoice(existing) || existing.financiallyEffectiveVersionId === null) {
    throw new LinkedApiDomainError("carrier Business Order 的 effective Invoice 不存在", 409);
  }
  if (invoiceSignature !== undefined) {
    throw new LinkedApiDomainError("parking-only Invoice 版本不得提交不必要的高折扣笔迹", 400);
  }
  const effective = existing.versions.find((version) => version.id === existing.financiallyEffectiveVersionId);
  if (!effective) throw new LinkedApiDomainError("carrier Business Order 的 effective Invoice version 不存在", 409);
  const priorNonParkingLines = effective.snapshot.lines
    .filter((line) => line.pricingMode !== "parking_projection")
    .map(invoiceSnapshotLineToQuotedCharge);
  if (JSON.stringify(priorNonParkingLines) !== JSON.stringify(order.chargeLines)) {
    throw new LinkedApiDomainError("Business Order 非停车收费已变化，请先单独启用新 Invoice 版本", 409);
  }
  assertClaimedInvoiceParkingIsCurrent(state, existing.id, recordedAt);
  return effective.snapshot.adjustments;
}

/**
 * Collects one parking payment in one locked canonical commit. Standard Invoice
 * activation/payment child receipts retain their independent ledger revisions;
 * the outer receipt binds the public intent to those deterministic children.
 */
export async function collectMockCanonicalParkingPayment(
  rawInput: CollectCanonicalParkingPaymentInput,
  actor: BillingMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  requestGuard?: () => void,
): Promise<CollectCanonicalParkingPaymentResult> {
  const input = normalizeCanonicalParkingPaymentInput(rawInput);
  const normalizedActor = normalizeParkingActor(actor, "parking.source.pay");
  const nowMs = store.nowMs();
  const recordedAt = parkingJamaicaInstant(nowMs);
  const paymentChildMutationId = task8ChildMutationId(input.mutationId, "invoice-payment");
  const activationChildMutationId = input.status === "unclaimed"
    ? task8ChildMutationId(input.mutationId, "invoice-activation")
    : null;
  const committed = await store.mutateIdempotently<CanonicalParkingPaymentReceiptResult>({
    mutationId: input.mutationId,
    operation: "parking.source.pay",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, async (state) => {
    assertParkingActorStillAuthorized(state, normalizedActor);
    if (state.revision !== input.expectedRevision) {
      throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
    }
    const childIds = activationChildMutationId === null
      ? [paymentChildMutationId]
      : [activationChildMutationId, paymentChildMutationId];
    if (childIds.some((childId) => state.mutationReceipts.some((receipt) => receipt.mutationId === childId))) {
      throw new LinkedApiDomainError("parking payment child mutationId 已存在", 409);
    }
    const source = state.parkingCases.find((candidate) => candidate.id === input.caseId);
    if (!source || !isModernParkingSourceFact(source)) {
      throw new LinkedApiDomainError("canonical parking source 不存在", 404);
    }
    if (source.revision !== input.expectedSourceRevision) {
      throw new LinkedApiDomainError("parking source revision 已变化，请刷新", 409);
    }
    const draftStore = store.createDraftChildStore(state, nowMs);
    let activatedInvoice: CanonicalParkingPaymentActivatedInvoiceDto | null = null;
    let sourceTransitions: ReadonlyArray<CanonicalParkingPaymentSourceTransitionDto> = [];
    let invoiceId: string;

    if (input.status === "claimed") {
      const item = canonicalModernParkingListItem(state, source, recordedAt);
      if (item.billing.status !== "claimed") {
        throw new LinkedApiDomainError("parking claim 已变化，请刷新", 409);
      }
      if (item.billing.correctionRequired) {
        throw new LinkedApiDomainError("parking projection 已过期，请先完成停车更正", 409);
      }
      if (item.billing.invoiceId !== input.invoiceId
        || item.billing.effectiveVersionId !== input.effectiveVersionId) {
        throw new LinkedApiDomainError("parking claim 的 Invoice 坐标已变化，请刷新", 409);
      }
      if (item.billing.ledger.balanceJmd !== input.balanceJmd) {
        throw new LinkedApiDomainError("parking Invoice 余额已变化，请刷新", 409);
      }
      assertClaimedInvoiceParkingIsCurrent(state, input.invoiceId, recordedAt);
      invoiceId = input.invoiceId;
    } else {
      const candidateSources = state.parkingCases
        .filter((candidate): candidate is LinkedModernParkingSourceFact => (
          isModernParkingSourceFact(candidate)
            && state.activeParkingClaim[candidate.id] === undefined
            && candidate.eligibleBusinessOrderIds.includes(input.carrierBusinessOrderId)
        ))
        .sort((left, right) => left.id.localeCompare(right.id));
      const expectedSourceProjections = candidateSources.map((candidate) => ({
        caseId: candidate.id,
        projectionCommitment: canonicalModernParkingListItem(state, candidate, recordedAt).live.projectionCommitment,
      }));
      if (JSON.stringify(input.sourceProjections) !== JSON.stringify(expectedSourceProjections)
        || !expectedSourceProjections.some((projection) => projection.caseId === input.caseId)) {
        throw new LinkedApiDomainError("parking live projection 集合已变化，请刷新", 409);
      }
      const preservedAdjustments = assertExistingInvoiceAllowsParkingOnlyVersion(
        state,
        input.carrierBusinessOrderId,
        input.invoiceSignature,
        recordedAt,
      );
      const activation = await activateMockQuickInvoiceSnapshot({
        orderId: input.carrierBusinessOrderId,
        expectedRevision: state.revision,
        mutationId: activationChildMutationId!,
        ...(preservedAdjustments !== undefined ? { adjustments: preservedAdjustments } : {}),
        ...(input.invoiceSignature !== undefined ? { signature: input.invoiceSignature } : {}),
      }, normalizedActor, draftStore);
      invoiceId = activation.invoiceId;
      const invoice = state.invoices.find((candidate) => candidate.id === activation.invoiceId);
      if (!invoice || !isSharedChargeInvoice(invoice)) {
        throw new LinkedApiDomainError("parking activation 未生成 canonical Invoice", 500);
      }
      const version = invoice.versions.find((candidate) => candidate.id === activation.invoiceVersionId);
      if (!version) throw new LinkedApiDomainError("parking activation Invoice version 丢失", 500);
      activatedInvoice = {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        effectiveVersionId: version.id,
        version: version.version,
        snapshotCommitment: version.snapshotCommitment,
      };
      sourceTransitions = activation.parkingSourceTransitions.map((transition) => {
        const line = version.snapshot.lines.find((candidate) => (
          candidate.pricingMode === "parking_projection" && candidate.parkingCaseId === transition.caseId
        ));
        if (!line || line.pricingMode !== "parking_projection") {
          throw new LinkedApiDomainError("parking activation source transition 缺少 Invoice line", 500);
        }
        return {
          caseId: transition.caseId,
          sourceRevisionBefore: transition.sourceBefore.revision,
          sourceRevisionAfter: transition.parkingSource.revision,
          amountJmd: line.amountJmd,
        };
      });
    }

    const payment = await recordMockInvoicePayment({
      invoiceId,
      expectedRevision: state.revision,
      mutationId: paymentChildMutationId,
      amountJmd: input.amountJmd,
      method: input.method,
      ...(input.note !== undefined ? { note: input.note } : {}),
    }, normalizedActor, draftStore);
    const currentSource = state.parkingCases.find((candidate) => candidate.id === input.caseId);
    if (!currentSource || !isModernParkingSourceFact(currentSource)) {
      throw new LinkedApiDomainError("parking payment 后 source 丢失", 500);
    }
    const itemAfter = canonicalModernParkingListItem(state, currentSource, recordedAt);
    if (itemAfter.billing.status !== "claimed") {
      throw new LinkedApiDomainError("parking payment 后 claim 丢失", 500);
    }
    const claim = state.activeParkingClaim[input.caseId];
    if (!claim || claim.logicalInvoiceId !== payment.invoiceId
      || claim.financiallyEffectiveVersionId !== payment.invoiceVersionId) {
      throw new LinkedApiDomainError("parking payment 后 claim/Invoice 不一致", 500);
    }
    const publicResult: CollectCanonicalParkingPaymentResult = {
      revision: state.revision,
      caseId: input.caseId,
      claim: canonicalParkingPaymentClaimDto(input.caseId, claim),
      activatedInvoice,
      sourceTransitions,
      payment: canonicalParkingPaymentFactDto(payment),
      financial: canonicalParkingPaymentFinancialDto(itemAfter.billing),
    };
    return {
      receiptContract: "parking_payment_collect_receipt_v1",
      activationChildMutationId,
      paymentChildMutationId,
      publicResult,
    };
  }, {
    action: "parking.source.pay.write",
    preReceiptGuard: (state) => {
      requestGuard?.();
      assertParkingActorStillAuthorized(state, normalizedActor);
    },
  });
  store.read(() => null, "parking.source.pay.response");
  return committed.result.publicResult;
}

/** Records the physical vehicle pickup that closes one canonical parking episode. */
export async function recordMockParkingSourcePickup(
  rawInput: RecordModernParkingSourcePickupInput,
  actor: BillingMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  requestGuard?: () => void,
): Promise<RecordModernParkingSourcePickupResult> {
  const input = normalizeModernPickupInput(rawInput);
  const normalizedActor = normalizeParkingActor(actor, "parking.source.pickup");
  const recordedAt = parkingJamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<RecordModernParkingSourcePickupResult>({
    mutationId: input.mutationId,
    operation: "parking.source.pickup",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    assertParkingActorStillAuthorized(state, normalizedActor);
    if (state.revision !== input.expectedRevision) {
      throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
    }
    const source = state.parkingCases.find((candidate) => candidate.id === input.caseId);
    if (!source || !isModernParkingSourceFact(source)) {
      throw new LinkedApiDomainError("canonical parking source 不存在", 404);
    }
    if (source.revision !== input.expectedSourceRevision) {
      throw new LinkedApiDomainError("parking source revision 已变化，请刷新", 409);
    }
    if (source.pickupDate !== undefined) {
      throw new LinkedApiDomainError("该停车案件已记录实际取车", 409);
    }
    const pickupDate = recordedAt.slice(0, 10);
    const sourceBefore = structuredClone(source);
    const parkingSource: LinkedModernParkingSourceFact = {
      ...source,
      pickupDate,
      accrual: calculateParkingAccrual({
        notificationDate: source.notificationDate,
        pickupDate,
        dailyRateJmd: source.dailyRateJmd,
      }),
      revision: source.revision + 1,
      asOf: recordedAt,
    };
    const oldSourceAmountJmd = deriveParkingFinalAccrual({
      currentAccrual: source.accrual,
      dailyRateJmd: source.dailyRateJmd,
      latestWaiverDecision: source.waiverHistory[source.waiverHistory.length - 1],
    }).finalAmountJmd;
    const newSourceAmountJmd = deriveParkingFinalAccrual({
      currentAccrual: parkingSource.accrual,
      dailyRateJmd: parkingSource.dailyRateJmd,
      latestWaiverDecision: parkingSource.waiverHistory[parkingSource.waiverHistory.length - 1],
    }).finalAmountJmd;
    if (!Number.isSafeInteger(oldSourceAmountJmd) || !Number.isSafeInteger(newSourceAmountJmd)
      || newSourceAmountJmd < oldSourceAmountJmd) {
      throw new LinkedApiDomainError("实际取车后的 parking accrual 不能低于已记录金额", 409);
    }
    const claim = state.activeParkingClaim[source.id] ?? null;
    let invoiceId: string | null = null;
    let previousInvoiceVersionId: string | null = null;
    let invoiceVersionId: string | null = null;
    let snapshotCommitment: string | null = null;
    let parkingDeltaJmd = newSourceAmountJmd - oldSourceAmountJmd;
    if (claim !== null) {
      const invoice = state.invoices.find((candidate) => candidate.id === claim.logicalInvoiceId);
      if (!invoice || !isSharedChargeInvoice(invoice)
        || invoice.financiallyEffectiveVersionId !== claim.financiallyEffectiveVersionId) {
        throw new LinkedApiDomainError("parking claim 的 financially-effective Invoice 已变化", 409);
      }
      const previousVersion = invoice.versions.find((candidate) => candidate.id === claim.financiallyEffectiveVersionId);
      if (!previousVersion) throw new LinkedApiDomainError("parking claim 的 Invoice version 不存在", 409);
      const oldParkingLine = previousVersion.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
        line.pricingMode === "parking_projection"
          && line.parkingCaseId === source.id
          && line.chargeLineId === claim.chargeLineId
      ));
      if (!oldParkingLine) throw new LinkedApiDomainError("parking claim 的 Invoice line 不存在", 409);
      const nextQuotedLines = previousVersion.snapshot.lines.map(invoiceSnapshotLineToQuotedCharge).map((line) => (
        line.pricingMode === "parking_projection" && line.parkingCaseId === source.id
          ? {
            ...line,
            sourceRevision: parkingSource.revision,
            asOf: parkingSource.asOf,
            amountJmd: newSourceAmountJmd,
          }
          : line
      ));
      const nextSnapshot = buildInvoiceChargeSnapshot({
        sourceBusinessOrderId: previousVersion.snapshot.sourceBusinessOrderId,
        sourceBusinessOrderRevision: previousVersion.snapshot.sourceBusinessOrderRevision,
        lines: nextQuotedLines,
        adjustments: previousVersion.snapshot.adjustments,
      });
      const priorRefunds = state.refunds.flatMap((refund) => (
        refund.refundContract === "ordinary_line_v1" && refund.logicalInvoiceId === invoice.id
          ? [{
            chargeLineId: refund.chargeLineId,
            ...(refund.refundQuantity !== undefined ? { quantity: refund.refundQuantity } : {}),
            amountJmd: refund.receivableReductionJmd,
          }]
          : []
      ));
      const legacyOccupancies = state.legacyRefundOccupancies.flatMap((occupancy) => (
        occupancy.invoiceId === invoice.id && occupancy.status === "line" && occupancy.chargeLineId
          ? [{
            chargeLineId: occupancy.chargeLineId,
            ...(occupancy.legacyRefundQuantity !== undefined ? { quantity: occupancy.legacyRefundQuantity } : {}),
            amountJmd: occupancy.amountJmd,
          }]
          : []
      ));
      validateInvoiceLineageTransition({
        previousSnapshots: invoice.versions.map((version) => version.snapshot),
        nextSnapshot,
        refundOccupancies: [...priorRefunds, ...legacyOccupancies],
      });
      const versionNumber = invoice.versions.length + 1;
      const nextVersionId = `${invoice.id}-version-${versionNumber}`;
      if (state.invoices.some((candidate) => candidate.versions.some((version) => version.id === nextVersionId))) {
        throw new LinkedApiDomainError("Invoice version ID 冲突", 409);
      }
      const nextCommitment = billingSnapshotCommitment(nextSnapshot);
      const nextVersion: SharedChargeInvoiceVersion = {
        id: nextVersionId,
        version: versionNumber,
        chargeContract: "shared_v1",
        snapshot: nextSnapshot,
        snapshotCommitment: nextCommitment,
        issuedAt: recordedAt,
      };
      let nextClaims: LinkedOperationsState["activeParkingClaim"];
      try {
        nextClaims = transferParkingClaims({
          claims: state.activeParkingClaim,
          logicalInvoiceId: invoice.id,
          previousEffectiveVersionId: previousVersion.id,
          nextEffectiveVersionId: nextVersion.id,
          nextParkingLines: nextSnapshot.lines.filter(
            (line): line is InvoiceParkingSnapshotLine => line.pricingMode === "parking_projection",
          ),
        });
      } catch (error) {
        throw new LinkedApiDomainError(
          error instanceof Error ? error.message : "parking claim transfer failed",
          409,
        );
      }
      parkingDeltaJmd = newSourceAmountJmd - oldParkingLine.amountJmd;
      if (!Number.isSafeInteger(parkingDeltaJmd) || parkingDeltaJmd < 0) {
        throw new LinkedApiDomainError("实际取车不能降低 financially-effective parking 金额", 409);
      }
      state.invoices[state.invoices.indexOf(invoice)] = {
        ...invoice,
        versions: [...invoice.versions, nextVersion],
        financiallyEffectiveVersionId: nextVersion.id,
      };
      state.activeParkingClaim = nextClaims;
      invoiceId = invoice.id;
      previousInvoiceVersionId = previousVersion.id;
      invoiceVersionId = nextVersion.id;
      snapshotCommitment = nextCommitment;
      const audit: LinkedBillingAuditEvent = {
        id: nextParkingId("billing-audit", new Set(state.billingAuditEvents.map((event) => event.id))),
        operation: "parking_invoice_reprojection",
        reprojectionKind: "physical_pickup",
        mutationId: input.mutationId,
        invoiceId: invoice.id,
        previousInvoiceVersionId: previousVersion.id,
        invoiceVersionId: nextVersion.id,
        snapshotCommitment: nextCommitment,
        parkingCaseId: source.id,
        chargeLineId: oldParkingLine.chargeLineId,
        sourceRevisionBefore: source.revision,
        sourceRevisionAfter: parkingSource.revision,
        oldParkingAmountJmd: oldParkingLine.amountJmd,
        newParkingAmountJmd: newSourceAmountJmd,
        parkingDeltaJmd,
        parkingCashRefundJmd: 0,
        committedRevision: state.revision + 1,
        actorId: normalizedActor.id,
        actorName: normalizedActor.name,
        recordedAt,
      };
      state.billingAuditEvents.push(audit);
    }
    state.parkingCases[state.parkingCases.indexOf(source)] = parkingSource;
    const pickupOrderIds = new Set(source.eligibleBusinessOrderIds);
    state.quickOrders.forEach((candidate, index) => {
      if (!pickupOrderIds.has(candidate.id)
        || candidate.status !== "submitted"
        || candidate.voidedAt !== null
        || candidate.pickedUpAt !== null) return;
      state.quickOrders[index] = {
        ...candidate,
        pickedUpAt: recordedAt,
        pickedUpBy: normalizedActor.name,
      };
    });
    state.revision += 1;
    return {
      revision: state.revision,
      caseId: source.id,
      sourceRevision: parkingSource.revision,
      sourceBefore,
      parkingSource,
      invoiceId,
      previousInvoiceVersionId,
      invoiceVersionId,
      snapshotCommitment,
      parkingDeltaJmd,
      parkingCashRefundJmd: 0,
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
    };
  }, {
    action: "parking.source.pickup.write",
    preReceiptGuard: (state) => {
      requestGuard?.();
      assertParkingActorStillAuthorized(state, normalizedActor);
    },
  });
  store.read(() => null, "parking.source.pickup.response");
  return committed.result;
}

export function previewMockParkingWaiver(
  rawInput: PreviewModernParkingCorrectionInput,
  actor: BillingMutationActor,
  store?: MockLinkedOperationsStore,
  requestGuard?: () => void,
): Promise<ModernParkingCorrectionPreviewDto>;
export function previewMockParkingWaiver(
  rawInput: PreviewParkingWaiverInput,
  store?: MockLinkedOperationsStore,
): Promise<ParkingWaiverPreviewDto>;
export async function previewMockParkingWaiver(
  rawInput: PreviewParkingWaiverInput | PreviewModernParkingCorrectionInput,
  actorOrStore: BillingMutationActor | MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  explicitStore?: MockLinkedOperationsStore,
  requestGuard?: () => void,
): Promise<ParkingWaiverPreviewDto | ModernParkingCorrectionPreviewDto> {
  if (Object.prototype.hasOwnProperty.call(rawInput, "mutationId")) {
    const input = normalizeModernPreviewInput(rawInput as PreviewModernParkingCorrectionInput);
    if (isStore(actorOrStore)) throw new LinkedApiDomainError("canonical parking preview 缺少操作账号", 403);
    const actor = normalizeParkingActor(actorOrStore, "parking.correction.preview");
    const store = explicitStore ?? getMockLinkedOperationsStore();
    const recordedAt = parkingJamaicaInstant(store.nowMs());
    return store.mutateIdempotently<ModernParkingCorrectionPreviewDto>({
      mutationId: input.mutationId,
      operation: "parking.correction.preview",
      actorId: actor.id,
      payload: input,
      recordedAt,
    }, (state) => {
      assertParkingActorStillAuthorized(state, actor);
      if (state.revision !== input.expectedRevision) {
        throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
      }
      const source = state.parkingCases.find((candidate) => candidate.id === input.caseId);
      if (!source) throw new LinkedApiDomainError("停车案件不存在", 404);
      if (!isModernParkingSourceFact(source)) {
        throw new LinkedApiDomainError("legacy parking 只能只读预览并走 authorized reconciliation", 409);
      }
      if (source.revision !== input.expectedSourceRevision) {
        throw new LinkedApiDomainError("parking source revision 已变化，请刷新", 409);
      }
      const claim = state.activeParkingClaim[source.id] ?? null;
      const sourceStored = structuredClone(source);
      const sourceBefore: LinkedModernParkingSourceFact = claim === null
        ? {
          ...advanceModernSourceClock(source, recordedAt),
          revision: source.revision + 1,
        }
        : structuredClone(source);
      const preview = calculatePreview(sourceBefore, input.waiveDays);
      const decision: LinkedModernParkingWaiverDecision = {
        waiverContract: "parking_waiver_decision_v1",
        sourceRevision: sourceBefore.revision,
        sourceAsOf: sourceBefore.asOf,
        ...preview,
      };
      const nextParkingSource: LinkedModernParkingSourceFact = {
        ...sourceBefore,
        revision: sourceBefore.revision + 1,
        asOf: recordedAt,
        waiverHistory: [...sourceBefore.waiverHistory, decision],
        waiverReasons: [...sourceBefore.waiverReasons, input.reason],
      };
      const oldFinal = deriveParkingFinalAccrual({
        currentAccrual: sourceBefore.accrual,
        dailyRateJmd: source.dailyRateJmd,
        latestWaiverDecision: source.waiverHistory[source.waiverHistory.length - 1],
      });
      const nextFinal = deriveParkingFinalAccrual({
        currentAccrual: nextParkingSource.accrual,
        dailyRateJmd: nextParkingSource.dailyRateJmd,
        latestWaiverDecision: decision,
      });
      let ledgerHighWaterRevision = 0;
      let nextInvoiceVersion: SharedChargeInvoiceVersion | null = null;
      let nextSnapshotCommitment: string | null = null;
      let netPaidBeforeJmd = 0;
      let receivableAfterCorrectionJmd = nextFinal.finalAmountJmd;
      if (claim !== null) {
        const invoice = state.invoices.find((candidate) => candidate.id === claim.logicalInvoiceId);
        if (!invoice || !isSharedChargeInvoice(invoice)
          || invoice.financiallyEffectiveVersionId !== claim.financiallyEffectiveVersionId) {
          throw new LinkedApiDomainError("parking claim 的 financially-effective Invoice 已变化", 409);
        }
        const previousVersion = invoice.versions.find((candidate) => candidate.id === claim.financiallyEffectiveVersionId);
        if (!previousVersion) throw new LinkedApiDomainError("parking claim 的 Invoice version 不存在", 409);
        const oldParkingLine = previousVersion.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
          line.pricingMode === "parking_projection"
            && line.parkingCaseId === source.id
            && line.chargeLineId === claim.chargeLineId
        ));
        if (!oldParkingLine) throw new LinkedApiDomainError("parking claim 的 Invoice line 不存在", 409);
        const nextSnapshot = buildInvoiceChargeSnapshot({
          sourceBusinessOrderId: previousVersion.snapshot.sourceBusinessOrderId,
          sourceBusinessOrderRevision: previousVersion.snapshot.sourceBusinessOrderRevision,
          lines: previousVersion.snapshot.lines.map(invoiceSnapshotLineToQuotedCharge).map((line) => (
            line.pricingMode === "parking_projection" && line.parkingCaseId === source.id
              ? {
                ...line,
                sourceRevision: nextParkingSource.revision,
                asOf: recordedAt,
                amountJmd: nextFinal.finalAmountJmd,
              }
              : line
          )),
          adjustments: previousVersion.snapshot.adjustments,
        });
        const previousRefundReductionJmd = deriveLinkedInvoiceFinancialSummary(state, invoice).receivableReductionJmd;
        receivableAfterCorrectionJmd = nextSnapshot.totals.grandTotalJmd - previousRefundReductionJmd;
        const financialBefore = deriveLinkedInvoiceFinancialSummary(state, invoice);
        netPaidBeforeJmd = financialBefore.netPaidJmd;
        ledgerHighWaterRevision = state.revision;
        const versionNumber = invoice.versions.length + 1;
        const nextVersionId = `${invoice.id}-version-${versionNumber}`;
        nextSnapshotCommitment = billingSnapshotCommitment(nextSnapshot);
        nextInvoiceVersion = {
          id: nextVersionId,
          version: versionNumber,
          chargeContract: "shared_v1",
          snapshot: nextSnapshot,
          snapshotCommitment: nextSnapshotCommitment,
          issuedAt: recordedAt,
        };
      }
      const amounts = calculateParkingCorrectionAmounts({
        oldParkingAmountJmd: oldFinal.finalAmountJmd,
        newParkingAmountJmd: nextFinal.finalAmountJmd,
        receivableAfterCorrectionJmd,
        netPaidBeforeJmd,
      });
      let previewToken = createOpaqueToken();
      while (state.parkingWaiverPreviews.some((token) => token.id === previewToken)) {
        previewToken = createOpaqueToken();
      }
      const expiresAt = parkingJamaicaInstant(Date.parse(recordedAt) + 5 * 60 * 1_000);
      const token: LinkedModernParkingCorrectionPreviewToken = {
        id: previewToken,
        previewContract: "parking_correction_preview_v1",
        previewMutationId: input.mutationId,
        caseId: source.id,
        sourceRevision: sourceBefore.revision,
        sourceStored,
        sourceBefore,
        nextParkingSource,
        waiveDays: input.waiveDays,
        reason: input.reason,
        decision,
        claim,
        ledgerHighWaterRevision,
        nextInvoiceVersion,
        nextSnapshotCommitment,
        oldParkingAmountJmd: oldFinal.finalAmountJmd,
        newParkingAmountJmd: nextFinal.finalAmountJmd,
        parkingDeltaJmd: amounts.parkingDeltaJmd,
        parkingCashRefundJmd: amounts.parkingCashRefundJmd,
        parkingAdministratorSignatureRequired: preview.requiresAdministratorSignature,
        invoiceSignatureRequired: false,
        issuedAt: recordedAt,
        expiresAt,
      };
      state.parkingWaiverPreviews.push(token);
      if (claim === null) {
        state.parkingCases[state.parkingCases.indexOf(source)] = structuredClone(sourceBefore);
      }
      state.revision += 1;
      return {
        ...preview,
        latestRevision: state.revision,
        sourceRevision: sourceBefore.revision,
        nextSourceRevision: nextParkingSource.revision,
        sourceAsOf: sourceBefore.asOf,
        previewToken,
        expiresAt,
        parkingAdministratorSignatureRequired: token.parkingAdministratorSignatureRequired,
        invoiceSignatureRequired: false,
        claimedInvoiceId: claim?.logicalInvoiceId ?? null,
        claimedInvoiceVersionId: claim?.financiallyEffectiveVersionId ?? null,
        nextInvoiceVersionId: nextInvoiceVersion?.id ?? null,
        nextSnapshotCommitment,
        parkingDeltaJmd: token.parkingDeltaJmd,
        parkingCashRefundJmd: token.parkingCashRefundJmd,
        sourceBefore: sourceStored,
        parkingSource: sourceBefore,
      };
    }, {
      action: "parking.correction.preview.write",
      preReceiptGuard: (state) => {
        requestGuard?.();
        assertParkingActorStillAuthorized(state, actor);
      },
    }).then((committed) => committed.result);
  }

  const input = rawInput as PreviewParkingWaiverInput;
  const store = isStore(actorOrStore) ? actorOrStore : explicitStore ?? getMockLinkedOperationsStore();
  validateDays(input.waiveDays);
  const reason = requiredText(input.reason, "减免原因");
  return store.read((state) => {
    const parking = state.parkingCases.find((item) => item.id === input.caseId);
    if (!parking) throw new LinkedApiDomainError("停车案件不存在", 404);
    if (isModernParkingSourceFact(parking)) {
      throw new LinkedApiDomainError("canonical parking source 必须走 Invoice correction 预览", 409);
    }
    const preview = calculatePreview(parking, input.waiveDays);
    const issuedAtMs = store.nowMs();
    const expiresAtMs = issuedAtMs + 5 * 60 * 1000;
    let previewToken = createOpaqueToken();
    while (state.parkingWaiverPreviews.some((token) => token.id === previewToken)) {
      previewToken = createOpaqueToken();
    }
    return {
      ...preview,
      sourceRevision: parking.revision,
      previewToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }, "parking.preview.read");
}

export function applyMockParkingWaiver(
  rawInput: ApplyModernParkingCorrectionInput,
  actor: BillingMutationActor,
  store?: MockLinkedOperationsStore,
  requestGuard?: () => void,
): Promise<ApplyModernParkingCorrectionResult>;
export function applyMockParkingWaiver(
  rawInput: ApplyParkingWaiverInput,
  actorId: string,
  store?: MockLinkedOperationsStore,
): Promise<ParkingWaiverPreview>;
export async function applyMockParkingWaiver(
  rawInput: ApplyParkingWaiverInput | ApplyModernParkingCorrectionInput,
  actorOrId: string | BillingMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  requestGuard?: () => void,
): Promise<ParkingWaiverPreview | ApplyModernParkingCorrectionResult> {
  if (Object.prototype.hasOwnProperty.call(rawInput, "mutationId")) {
    const input = normalizeModernApplyInput(rawInput as ApplyModernParkingCorrectionInput);
    if (typeof actorOrId === "string") throw new LinkedApiDomainError("canonical parking apply 缺少完整操作账号", 403);
    const actor = normalizeParkingActor(actorOrId, "parking.source.correct");
    const recordedAt = parkingJamaicaInstant(store.nowMs());
    const committed = await store.mutateIdempotently<ApplyModernParkingCorrectionResult>({
      mutationId: input.mutationId,
      operation: "parking.source.correct",
      actorId: actor.id,
      payload: input,
      recordedAt,
    }, (state) => {
      assertParkingActorStillAuthorized(state, actor);
      if (state.revision !== input.expectedRevision) {
        throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
      }
      const token = state.parkingWaiverPreviews.find((candidate) => candidate.id === input.previewToken);
      if (!token || !Object.prototype.hasOwnProperty.call(token, "previewContract")
        || token.previewContract !== "parking_correction_preview_v1") {
        throw new LinkedApiDomainError("canonical parking preview token 不存在", 409);
      }
      if (token.previewMutationId === input.mutationId) {
        throw new LinkedApiDomainError("preview 与 apply 必须使用不同 mutationId", 409);
      }
      if (token.caseId !== input.caseId || token.sourceRevision !== input.expectedSourceRevision) {
        throw new LinkedApiDomainError("parking preview token 来源已变化", 409);
      }
      if (token.consumedAt !== undefined) throw new LinkedApiDomainError("parking preview token 已消费", 409);
      if (Date.parse(token.expiresAt) < store.nowMs()) throw new LinkedApiDomainError("parking preview token 已过期", 409);
      const source = state.parkingCases.find((candidate) => candidate.id === input.caseId);
      if (!source || !isModernParkingSourceFact(source)) throw new LinkedApiDomainError("canonical parking source 不存在", 409);
      if (source.revision !== input.expectedSourceRevision
        || JSON.stringify(source) !== JSON.stringify(token.sourceBefore)) {
        throw new LinkedApiDomainError("parking source 已变化，请重新预览", 409);
      }
      if (token.parkingCashRefundJmd > 0 && input.refundMethod === undefined) {
        throw new LinkedApiDomainError("停车更正产生现金退款时必须选择退款方式", 400);
      }
      if (token.parkingCashRefundJmd === 0 && input.refundMethod !== undefined) {
        throw new LinkedApiDomainError("本次停车更正没有现金退款，不得提交退款方式", 400);
      }
      if (token.parkingAdministratorSignatureRequired) {
        const administratorId = requiredText(input.administratorId ?? "", "管理员 ID");
        validateAdministratorSignature(state, administratorId, input.administratorSignature, {
          action: "parking_waiver",
          subjectId: source.id,
          sourceRevision: source.revision,
          amountJmd: token.decision.cumulativeWaivedAmountJmd,
          reason: token.reason,
        });
      } else if (input.administratorId !== undefined || input.administratorSignature !== undefined) {
        throw new LinkedApiDomainError("本次停车减免未超过管理员签字门槛，不得提交签名", 400);
      }
      if (input.invoiceSignature !== undefined) {
        throw new LinkedApiDomainError("本次停车更正不需要 Invoice 签字", 400);
      }
      const sourceIndex = state.parkingCases.indexOf(source);
      state.parkingCases[sourceIndex] = structuredClone(token.nextParkingSource);
      let invoiceId: string | null = null;
      let invoiceVersionId: string | null = null;
      if (token.claim !== null) {
        const invoice = state.invoices.find((candidate) => candidate.id === token.claim!.logicalInvoiceId);
        if (!invoice || !isSharedChargeInvoice(invoice)
          || invoice.financiallyEffectiveVersionId !== token.claim.financiallyEffectiveVersionId
          || token.nextInvoiceVersion === null
          || token.nextSnapshotCommitment === null) {
          throw new LinkedApiDomainError("parking claim 的 Invoice 更正坐标已变化", 409);
        }
        if (token.ledgerHighWaterRevision !== input.expectedRevision - 1) {
          throw new LinkedApiDomainError("parking claim 收付款记录已变化，请重新预览", 409);
        }
        let nextClaims: LinkedOperationsState["activeParkingClaim"];
        try {
          nextClaims = transferParkingClaims({
            claims: state.activeParkingClaim,
            logicalInvoiceId: invoice.id,
            previousEffectiveVersionId: token.claim.financiallyEffectiveVersionId,
            nextEffectiveVersionId: token.nextInvoiceVersion.id,
            nextParkingLines: token.nextInvoiceVersion.snapshot.lines.filter(
              (line): line is InvoiceParkingSnapshotLine => line.pricingMode === "parking_projection",
            ),
          });
        } catch (error) {
          throw new LinkedApiDomainError(
            error instanceof Error ? error.message : "parking claim transfer failed",
            409,
          );
        }
        state.invoices[state.invoices.indexOf(invoice)] = {
          ...invoice,
          versions: [...invoice.versions, token.nextInvoiceVersion],
          financiallyEffectiveVersionId: token.nextInvoiceVersion.id,
        };
        state.activeParkingClaim = nextClaims;
        invoiceId = invoice.id;
        invoiceVersionId = token.nextInvoiceVersion.id;
        state.billingAuditEvents.push({
          id: nextParkingId("billing-audit", new Set(state.billingAuditEvents.map((event) => event.id))),
          operation: "parking_invoice_reprojection",
          reprojectionKind: "waiver_correction",
          mutationId: input.mutationId,
          invoiceId: invoice.id,
          previousInvoiceVersionId: token.claim.financiallyEffectiveVersionId,
          invoiceVersionId: token.nextInvoiceVersion.id,
          snapshotCommitment: token.nextSnapshotCommitment,
          parkingCaseId: source.id,
          chargeLineId: token.claim.chargeLineId,
          sourceRevisionBefore: source.revision,
          sourceRevisionAfter: token.nextParkingSource.revision,
          oldParkingAmountJmd: token.oldParkingAmountJmd,
          newParkingAmountJmd: token.newParkingAmountJmd,
          parkingDeltaJmd: token.parkingDeltaJmd,
          parkingCashRefundJmd: token.parkingCashRefundJmd,
          committedRevision: state.revision + 1,
          actorId: actor.id,
          actorName: actor.name,
          recordedAt,
        });
      }
      (token as LinkedModernParkingCorrectionPreviewToken).consumedAt = recordedAt;
      state.parkingWaiverAudits.push({
        id: nextParkingId("parking-waiver-audit", new Set(state.parkingWaiverAudits.map((audit) => audit.id))),
        auditContract: "parking_waiver_audit_v1",
        mutationId: input.mutationId,
        caseId: source.id,
        sourceRevision: source.revision,
        sourceAsOf: token.sourceBefore.asOf,
        reason: token.reason,
        actorId: actor.id,
        ...(input.administratorId !== undefined ? { administratorId: input.administratorId } : {}),
        ...(input.administratorSignature !== undefined ? { administratorSignature: input.administratorSignature } : {}),
        appliedAt: recordedAt,
        preview: token.decision,
      });
      state.revision += 1;
      return {
        revision: state.revision,
        caseId: source.id,
        sourceRevision: token.nextParkingSource.revision,
        invoiceId,
        invoiceVersionId,
        parkingDeltaJmd: token.parkingDeltaJmd,
        parkingCashRefundJmd: token.parkingCashRefundJmd,
        parkingSource: token.nextParkingSource,
      };
    }, {
      action: "parking.source.correct.write",
      preReceiptGuard: (state) => {
        requestGuard?.();
        assertParkingActorStillAuthorized(state, actor);
      },
    });
    store.read(() => null, "parking.source.correct.response");
    return committed.result;
  }

  const input = rawInput as ApplyParkingWaiverInput;
  validateDays(input.waiveDays);
  requiredText(input.reason, "减免原因");
  return store.mutate((state) => {
    const parking = state.parkingCases.find((item) => item.id === input.caseId);
    if (!parking) throw new LinkedApiDomainError("停车案件不存在", 404);
    if (isModernParkingSourceFact(parking)) {
      throw new LinkedApiDomainError("canonical parking source 必须走 Invoice correction", 409);
    }
    throw new LinkedApiDomainError(
      "legacy parking 记录已冻结；任何减免或金额调整必须走 authorized reconciliation",
      409,
    );
  }, { action: "parking.waiver.write" });
}
