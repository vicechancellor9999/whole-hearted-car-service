import {
  isOrderLifecycleFilter,
  isOrderProcessingStatus,
  isOrderTeamId,
  queryOrders,
} from "../orders/query";
import { ORDER_DEMO_SEED } from "../orders/seed";
import { seedQuickOrders } from "../orders/quick-order-seed";
import {
  isSharedChargeQuickOrder,
  QUICK_ORDER_SHARED_CHARGE_CONTRACT,
  type QuickBoStatus,
  type QuickBoStatusEvent,
  type QuickOrder,
  type QuickPaymentReceiptChargeLine,
  type QuickPaymentReceiptHistoryEntry,
  type QuickRefund,
  type QuickRefundEvidence,
} from "../orders/quick-order-types";
import { canonicalCustomerById, canonicalVehicleById } from "../customers/canonical-identities";
import {
  buildOrdersOperationsOverview,
  type OperationsDocumentRecord,
  type OrdersOperationsOverview,
} from "../orders/operations-overview";
import type {
  OrderAssignment,
  OrderAssignmentKind,
  OrderAssignmentStatus,
  VehiclePool,
} from "../orders/inspection-types";
import type {
  OrderReassignmentAudit,
  OrderRecord,
  OrderSettlementStatus,
  OrderLifecycleFilter,
  OrderListQuery,
  OrderListResponse,
  OrderProcessingStatus,
  ReassignOrderInput,
  OrderTeamId,
} from "../orders/types";
import { deriveProcessingStatus } from "../orders/calculations";
import {
  computeDefaultPerformanceValue,
  isPerformanceSummaryMonth,
  summarizeBusinessOrderPerformance,
  summarizeQuickOrderPerformance,
} from "../orders/performance-value";
import type {
  BusinessOrder,
  BusinessOrderPerformanceAudit,
  BusinessOrderStartMileage,
  FormalSubmitOrderInput,
  FormalSubmitOrderResult,
  OrdersPerformanceSummaryResponse,
  UpdateOrderPerformanceValueInput,
  UpdateOrderPerformanceValueResult,
  VehicleBusinessOrderRow,
  VehicleReleaseFact,
} from "../orders/business-order-types";
import type { InspectionReportStatus } from "../orders/inspection-report";
import {
  DEFAULT_QUOTATION_NOTE_EN,
  DEFAULT_QUOTATION_NOTE_ZH,
  type CurrentQuotation,
  type GeneratedCustomerFileBundleMetadata,
  type LegacyQuotationArchive,
  type Quotation,
} from "../orders/quotation";
import type {
  ChargeLine,
  Invoice,
  InvoiceCustomerAcknowledgement,
  InvoicePaymentFact,
  InvoicePaymentSummary,
  LegacyInvoice,
  ModernInvoicePaymentFact,
  QuotedChargeLine,
  SharedChargeInvoice,
  SharedChargeInvoiceVersion,
} from "../billing/types";
import {
  financiallyEffectiveInvoiceVersion,
  invoiceVersionTotalJmd,
  isModernInvoicePaymentFact,
  isSharedChargeInvoice,
} from "../billing/types";
import { calculateInvoiceTotals } from "../billing/calculations";
import {
  buildInvoiceChargeSnapshot,
  invoiceSnapshotRequiresFreshApproval,
  invoiceSnapshotLineToQuotedCharge,
  validateInvoiceChargeSnapshot,
  validateInvoiceLineageTransition,
  type InvoiceChargeSnapshot,
  type InvoiceParkingSnapshotLine,
} from "../billing/invoice-snapshots";
import { previewOrdinaryLineRefund } from "../billing/refunds";
import {
  assertQuickOrderLifecycleMutationInput,
  assertQuickOrderLifecycleMutationResult,
  type QuickOrderLifecycleKind,
  type QuickOrderLifecycleMutationInput,
  type QuickOrderLifecycleMutationResult,
} from "../billing/quick-order-lifecycle";
import {
  assertQuickOrderFinancialReadModel,
  type QuickOrderFinancialReadModel,
} from "../billing/quick-order-financial";
import {
  allocateOrderDiscount,
  calculateQuotedChargeTotals,
  validateQuotedChargeLine,
} from "../billing/quoted-charges";
import {
  discountApprovalRequirement,
  discountSignatureStrokeDigest,
  validateDiscountApprovalEvidence,
  type DiscountApprovalEvidence,
} from "../billing/discount-approval";
import type { ParkingCaseRecord, ParkingWaiverPreview } from "../parking/types";
import {
  calculateParkingAccrual,
  deriveParkingFinalAccrual,
  parseParkingCalendarDate,
  validateParkingWaiver,
} from "../parking/calculations";
import { calculateParkingCorrectionAmounts } from "../parking/invoice-claims";
import { parkingLocalCalendarDate } from "./mock-parking-followup";
import { canonicalMockIdentitySnapshot } from "./mock-data";

const ORDERS_OPERATIONS_BUSINESS_DATE = "2026-08-09";
export const ORDERS_REASSIGNMENTS_STORAGE_KEY = "wh_orders_reassignments_v1";
export const LINKED_OPERATIONS_STORAGE_KEY = "wh_linked_operations_state_v1";
export const LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY = "wh_quick_parking_v1";
export const LINKED_OPERATIONS_LEGACY_SOURCE_ARCHIVE_KEY = "wh-linked-operations-legacy-source-v1";
const CLEAN_DEMO_STATE_CONTRACT = "clean-demo-state-v10";
const LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY = "wh_ir_followup_v1";
const LINKED_OPERATIONS_SCHEMA_VERSION = 8;

const DEFAULT_LINKED_TRUSTED_IDENTITIES: ReadonlyArray<LinkedTrustedIdentity> = [
  { id: "emp-001", role: "superadmin" },
];

export interface LinkedCustomerFact {
  id: string;
  nameZh: string;
  nameEn?: string;
  phone: string;
  /** Closed canonical snapshot. Unknown legacy values are represented as null. */
  email: string | null;
}

export interface LinkedVehicleFact {
  id: string;
  plate: string;
  modelZh?: string;
  modelEn?: string;
  customerId: string;
}

export interface LinkedInspectionItemFact {
  id: string;
  inspectionReportId: string;
  findingZh: string;
  findingEn?: string;
  recommendationZh: string;
  recommendationEn?: string;
  /** 情况描述备注（各种情况的补充说明，2026-08-20 老板）。 */
  remarkZh?: string;
  remarkEn?: string;
  /** 下一步待定说明：本步做完后才知道下一步（拆解后才能报配件等，8/20 老板）。 */
  nextStepZh?: string;
  nextStepEn?: string;
}

export interface LinkedInspectionReportFact {
  id: string;
  inspectionReportNo: string;
  sourceBusinessOrderId?: string;
  customerId: string;
  vehicleId: string;
  status: InspectionReportStatus;
  submissionId: string;
  submissionSourceVersion: number;
  inspectorId: string;
  inspectorName: string;
  inspectorTeamId: OrderTeamId;
  submittedAt: string;
  rawText: string;
  aiDraft: string;
  /** Stable report-level attachment IDs; bytes/references live outside this record. */
  photoIds: string[];
  /** Only legacy migration anomalies make this true. */
  categoryReviewRequired: boolean;
  itemIds: string[];
  quotationId: string;
}

export interface LinkedQuotationItemFact {
  id: string;
  quotationVersionId: string;
  sourceInspectionItemId: string;
  /** 报价项目对齐业务单收费项（2026-08-20 老板：名称/备注/单位/数量/单价写清楚，中英双语）。
   * 一份检查报告只报本阶段的项目；后续阶段（拆解后才能确定）会另出新检查报告与新报价，不在同一份报告里改。 */
  descZh: string;
  descEn: string;
  remarkZh?: string;
  remarkEn?: string;
  unit: string;
  unitEn?: string;
  quantity: number;
  unitPriceJmd: number;
  /** 配件待报价：数量已知价格待定（与业务单同口径）。 */
  pendingQuote: boolean;
  /** 与业务单收费项严格一致：只有工时/配件两类（8/20 老板纠正）。 */
  category: "labor" | "parts";
}

export interface LinkedCommunicationFact {
  id: string;
  reportId: string;
  /** 发送内容（2026-08-20 老板）：文字报告与报价 / 现场照片 / 仅记录客户回应（未发送）。 */
  contentKind: "report" | "photos" | "reply";
  channel: "sms" | "email" | "paper" | "in_person";
  target: string;
  delivery: "sent" | "failed" | "delivered";
  response: "no_response" | "deferred" | "declined" | "return_planned";
  followupDate?: string;
  note: string;
  actorId: string;
  recordedAt: string;
}

export interface SignatureEvidence {
  signatureId: string;
  signatureHash: string;
  blobRef: string;
}

export interface AdministratorSignatureEvidence extends SignatureEvidence {
  administratorId: string;
  action: "parking_waiver" | "special_release";
  subjectId: string;
  sourceRevision: number;
  amountJmd: number;
  reason: string;
  signedAt: string;
  payloadHash: string;
}

export interface AdministratorSignatureBinding {
  action: AdministratorSignatureEvidence["action"];
  subjectId: string;
  sourceRevision: number;
  amountJmd: number;
  reason: string;
}

export interface LinkedTrustedIdentity {
  id: string;
  role: "superadmin" | "finance" | "frontdesk_admin" | "parts" | "mechanic";
}

export interface CanonicalBillingActorIdentity {
  readonly id: string;
  readonly name: string;
  readonly role: "superadmin" | "frontdesk_admin";
}

export type Task8MutationOperation =
  | "billing.invoice.activate"
  | "billing.invoice.payment"
  | "billing.invoice.lineRefund"
  | "parking.source.create"
  | "parking.source.pickup"
  | "parking.correction.preview"
  | "parking.source.correct"
  | "parking.source.pay";

function task8MutationRoleAllowed(
  operation: Task8MutationOperation,
  role: CanonicalBillingActorIdentity["role"],
): boolean {
  switch (operation) {
    case "billing.invoice.activate":
    case "billing.invoice.payment":
    case "billing.invoice.lineRefund":
    case "parking.source.create":
    case "parking.source.pickup":
    case "parking.correction.preview":
    case "parking.source.correct":
    case "parking.source.pay":
      return role === "superadmin" || role === "frontdesk_admin";
  }
}

/** Resolves catalog identity plus the exact public-operation capability, never mutable receipt copies. */
export function canonicalBillingActorIdentity(
  operation: Task8MutationOperation,
  actorId: string,
): CanonicalBillingActorIdentity | null {
  const identity = canonicalMockIdentitySnapshot(actorId);
  if (!identity
    || (identity.role !== "superadmin" && identity.role !== "frontdesk_admin")
    || !task8MutationRoleAllowed(operation, identity.role)) {
    return null;
  }
  return { id: identity.id, name: identity.name, role: identity.role };
}

export interface LinkedLegacyParkingWaiverPreviewToken {
  id: string;
  caseId: string;
  sourceRevision: number;
  waiveDays: number;
  reason: string;
  existingWaivedDays: number;
  existingWaivedAmountJmd: number;
  expiresAt: string;
  issuedAt: string;
  consumedAt?: string;
  readonly previewContract?: never;
}

export interface LinkedModernParkingCorrectionPreviewToken {
  readonly id: string;
  readonly previewContract: "parking_correction_preview_v1";
  readonly previewMutationId: string;
  readonly caseId: string;
  readonly sourceRevision: number;
  readonly sourceStored: LinkedModernParkingSourceFact;
  readonly sourceBefore: LinkedModernParkingSourceFact;
  readonly nextParkingSource: LinkedModernParkingSourceFact;
  readonly waiveDays: number;
  readonly reason: string;
  readonly decision: LinkedModernParkingWaiverDecision;
  readonly claim: LinkedActiveParkingClaim | null;
  readonly ledgerHighWaterRevision: number;
  readonly nextInvoiceVersion: import("../billing/types").SharedChargeInvoiceVersion | null;
  readonly nextSnapshotCommitment: string | null;
  readonly oldParkingAmountJmd: number;
  readonly newParkingAmountJmd: number;
  readonly parkingDeltaJmd: number;
  readonly parkingCashRefundJmd: number;
  readonly parkingAdministratorSignatureRequired: boolean;
  readonly invoiceSignatureRequired: boolean;
  readonly issuedAt: string;
  readonly expiresAt: string;
  consumedAt?: string;
}

export type LinkedParkingWaiverPreviewToken =
  | LinkedLegacyParkingWaiverPreviewToken
  | LinkedModernParkingCorrectionPreviewToken;

export interface LinkedSpecialReleaseAuthorization {
  id: string;
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  balanceJmd: number;
  reason: string;
  expectedPaymentDate: string;
  frontdeskActorId: string;
  administratorId: string;
  administratorSignature: AdministratorSignatureEvidence | SignatureEvidence;
  evidenceVersion?: 1 | 2;
  customerConfirmation: string;
  authorizedAt: string;
}

interface LinkedParkingCaseBase<TWaiver extends ParkingWaiverPreview = ParkingWaiverPreview>
  extends Omit<ParkingCaseRecord, "waiverHistory"> {
  readonly vehicleId: string;
  readonly dailyRateJmd: number;
  readonly revision: number;
  readonly waiverHistory: ReadonlyArray<TWaiver>;
  readonly waiverReasons: ReadonlyArray<string>;
}

export interface LinkedModernParkingWaiverDecision extends ParkingWaiverPreview {
  readonly waiverContract: "parking_waiver_decision_v1";
  /** Exact source revision used to calculate this immutable decision. */
  readonly sourceRevision: number;
  /** Exact source clock instant used to calculate this immutable decision. */
  readonly sourceAsOf: string;
}

/** Protected pre-Task8 parking fact. Its formal Invoice coordinates are immutable legacy provenance. */
export interface LinkedLegacyParkingCaseFact extends LinkedParkingCaseBase {
  readonly businessOrderId: string;
  readonly invoiceId: string;
  readonly invoiceVersionId: string;
  readonly parkingContract?: never;
  readonly asOf?: never;
}

/** Canonical unbilled Quick BO source. Billing coordinates live only in activeParkingClaim. */
export interface LinkedModernParkingSourceFact extends LinkedParkingCaseBase<LinkedModernParkingWaiverDecision> {
  readonly parkingContract: "parking_source_v1";
  /** BO that recorded the first pickup notification; provenance only, never the financial owner. */
  readonly originBusinessOrderId: string;
  /** Server-frozen same-vehicle delivery cohort eligible to carry this episode on an Invoice. */
  readonly eligibleBusinessOrderIds: ReadonlyArray<string>;
  readonly asOf: string;
  readonly businessOrderId?: never;
  readonly invoiceId?: never;
  readonly invoiceVersionId?: never;
}

export type LinkedParkingCaseFact = LinkedLegacyParkingCaseFact | LinkedModernParkingSourceFact;

export function isModernParkingSourceFact(
  parking: LinkedParkingCaseFact,
): parking is LinkedModernParkingSourceFact {
  return Object.prototype.hasOwnProperty.call(parking, "parkingContract")
    && parking.parkingContract === "parking_source_v1";
}

export interface LinkedLegacyParkingWaiverAudit {
  id: string;
  caseId: string;
  reason: string;
  actorId: string;
  administratorId?: string;
  administratorSignature?: AdministratorSignatureEvidence | SignatureEvidence;
  evidenceVersion?: 1 | 2;
  appliedAt: string;
  preview: ParkingWaiverPreview;
  readonly auditContract?: never;
  readonly mutationId?: never;
  readonly sourceRevision?: never;
  readonly sourceAsOf?: never;
}

export interface LinkedModernParkingWaiverAudit {
  readonly id: string;
  readonly auditContract: "parking_waiver_audit_v1";
  readonly mutationId: string;
  readonly caseId: string;
  readonly sourceRevision: number;
  readonly sourceAsOf: string;
  readonly reason: string;
  readonly actorId: string;
  readonly administratorId?: string;
  readonly administratorSignature?: AdministratorSignatureEvidence;
  readonly appliedAt: string;
  readonly preview: LinkedModernParkingWaiverDecision;
}

export type LinkedParkingWaiverAudit = LinkedLegacyParkingWaiverAudit | LinkedModernParkingWaiverAudit;

export interface LinkedLegacyInvoiceRefundFact {
  id: string;
  invoiceId: string;
  amountJmd: number;
  refundedAt: string;
  readonly refundContract?: never;
}

export interface LinkedOrdinaryInvoiceRefundFact {
  readonly id: string;
  readonly refundContract: "ordinary_line_v1";
  readonly logicalInvoiceId: string;
  readonly invoiceVersionId: string;
  readonly chargeLineId: string;
  readonly category: "labor" | "parts" | "other_service";
  readonly pricingMode: "unit" | "fixed_total";
  readonly refundQuantity?: number;
  readonly wholeLine?: true;
  readonly lineSnapshot: import("../billing/invoice-snapshots").InvoiceSnapshotLine;
  readonly receivableReductionJmd: number;
  readonly cashRefundJmd: number;
  readonly method: string;
  readonly reason: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly refundedAt: string;
  readonly mutationId: string;
}

export type LinkedInvoiceRefundFact = LinkedLegacyInvoiceRefundFact | LinkedOrdinaryInvoiceRefundFact;

interface LinkedBillingAuditBase {
  readonly id: string;
  readonly mutationId: string;
  readonly invoiceId: string;
  readonly invoiceVersionId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly recordedAt: string;
}

export interface LinkedInvoiceActivationAudit extends LinkedBillingAuditBase {
  readonly operation: "invoice_activation";
  readonly invoiceNo: string;
  readonly snapshotCommitment: string;
}

export interface LinkedInvoiceLineRefundAudit extends LinkedBillingAuditBase {
  readonly operation: "invoice_line_refund";
  readonly refundId: string;
  readonly chargeLineId: string;
  readonly receivableReductionJmd: number;
  readonly cashRefundJmd: number;
}

export interface LinkedInvoicePaymentAudit extends LinkedBillingAuditBase {
  readonly operation: "invoice_payment";
  readonly paymentId: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly note: string | null;
  readonly committedRevision: number;
}

export interface LinkedParkingInvoiceReprojectionAudit extends LinkedBillingAuditBase {
  readonly operation: "parking_invoice_reprojection";
  readonly reprojectionKind: "physical_pickup" | "waiver_correction";
  readonly previousInvoiceVersionId: string;
  readonly snapshotCommitment: string;
  readonly parkingCaseId: string;
  readonly chargeLineId: string;
  readonly sourceRevisionBefore: number;
  readonly sourceRevisionAfter: number;
  readonly oldParkingAmountJmd: number;
  readonly newParkingAmountJmd: number;
  readonly parkingDeltaJmd: number;
  readonly parkingCashRefundJmd: number;
  readonly committedRevision: number;
}

export type LinkedBillingAuditEvent =
  | LinkedInvoiceActivationAudit
  | LinkedInvoiceLineRefundAudit
  | LinkedInvoicePaymentAudit
  | LinkedParkingInvoiceReprojectionAudit;

export interface LinkedBillingDocumentSequence {
  readonly id: string;
  readonly kind: "invoice";
  readonly branchCode: "KGN";
  readonly brandCode: "WH";
  readonly businessDate: string;
  lastAllocated: number;
}

export type LegacyChargeStatus =
  | "legacy_unclassified"
  | "legacy_parking_unlinked"
  | "legacy_parking_mismatch"
  | "legacy_parking_duplicate";

export interface LinkedLegacyChargeRecord {
  readonly id: string;
  readonly status: LegacyChargeStatus;
  readonly reportId?: string;
  readonly quotationId?: string;
  readonly invoiceId?: string;
  readonly invoiceVersionId?: string;
  readonly amountJmd: number;
  readonly original: Record<string, unknown>;
}

interface LinkedReportAttachmentBase {
  readonly id: string;
  readonly reportId: string;
  readonly vehicleId: string;
  readonly lifecycle: "active" | "deleted";
  readonly activeSequence: number | null;
  readonly deletedAt?: string;
  readonly deletedByActorId?: string;
  readonly deletedByActorName?: string;
}

export interface LinkedLegacyReportAttachmentMetadata extends LinkedReportAttachmentBase {
  readonly storageKind: "legacy_reference";
  readonly legacyManifestEntryId: string;
  readonly originalReportId: string;
  readonly originalVehicleId: string;
  readonly originalSequence: number;
  readonly repairStatus: "pending" | "repair_needed";
  readonly repairReason?: string;
}

export interface LinkedIndexedDbReportAttachmentMetadata extends LinkedReportAttachmentBase {
  readonly storageKind: "indexeddb_blob";
  /** Legacy sources may not carry an authentic original file name. */
  readonly originalName: string | null;
  readonly detectedMediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteLength: number;
  readonly sha256: `sha256-bytes-v1:${string}`;
  readonly createdAt: string;
  readonly uploaderActorId: string;
  readonly uploaderActorName: string;
  readonly legacyOrigin?: {
    readonly manifestEntryId: string;
    readonly reportId: string;
    readonly vehicleId: string;
    readonly sequence: number;
  };
}

export type LinkedReportAttachmentMetadata =
  | LinkedLegacyReportAttachmentMetadata
  | LinkedIndexedDbReportAttachmentMetadata;

export interface LinkedReportAttachmentAuditEvent {
  readonly id: string;
  readonly attachmentId: string;
  readonly reportId: string;
  readonly vehicleId: string;
  readonly action: "uploaded" | "deleted" | "legacy_materialized";
  readonly actorId: string;
  readonly actorName: string;
  readonly mutationId: string;
  readonly recordedAt: string;
}

export interface LinkedLegacyIrHistory {
  readonly sourceSchemaVersion: number;
  readonly inspectionReports: ReadonlyArray<Record<string, unknown>>;
  readonly inspectionItems: ReadonlyArray<Record<string, unknown>>;
  readonly quotations: ReadonlyArray<LegacyQuotationArchive>;
  readonly quotationItems: ReadonlyArray<Record<string, unknown>>;
}

export interface LinkedGenerationEvent {
  readonly id: string;
  readonly reportId: string;
  readonly quotationId: string;
  readonly generation: number;
  readonly contentRevision: number;
  readonly actorId: string;
  readonly generatedAt: string;
  readonly rendererVersion: string;
  readonly attachmentIds: ReadonlyArray<string>;
}

export interface LinkedImportedCommunicationEvent {
  readonly id: string;
  readonly reportId: string;
  readonly recordedAt: string;
  readonly payload: Record<string, unknown>;
  readonly sourceKey: typeof LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY;
  readonly legacyOriginalId?: string;
  readonly legacyActorName?: string;
  readonly possibleDuplicateOf?: string;
  readonly legacyOrphanReport?: boolean;
  readonly actorId?: never;
  readonly actorName?: never;
  readonly eventKind?: never;
  readonly channel?: never;
  readonly language?: never;
  readonly target?: never;
  readonly message?: never;
  readonly subject?: never;
  readonly providerMode?: never;
  readonly providerResult?: never;
  readonly providerReference?: never;
  readonly mutationId?: never;
  readonly fileName?: never;
  readonly demoReportUrl?: never;
}

export interface LinkedFormalReportNotificationEvent {
  readonly id: string;
  readonly reportId: string;
  readonly eventKind: "formal_report_notification";
  readonly channel: "sms" | "whatsapp" | "email";
  readonly language: "zh" | "en" | "bilingual";
  readonly target: string;
  readonly message: string;
  readonly subject?: string;
  readonly providerMode: "mock_sms" | "mock_email" | "manual_whatsapp";
  readonly providerResult: "accepted" | "confirmed_sent";
  readonly providerReference: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly recordedAt: string;
  readonly mutationId: string;
  /** Customer-visible attachment name only. Never a generated-file id/hash. */
  readonly fileName?: string;
  /** Explicitly-labelled non-localhost demo URL for SMS/WhatsApp. */
  readonly demoReportUrl?: string;
  readonly payload?: never;
  readonly sourceKey?: never;
  readonly legacyOriginalId?: never;
  readonly legacyActorName?: never;
  readonly possibleDuplicateOf?: never;
  readonly legacyOrphanReport?: never;
}

export type LinkedCurrentCommunicationEvent =
  | LinkedImportedCommunicationEvent
  | LinkedFormalReportNotificationEvent;

export interface LinkedImportedCustomerResponseEvent extends LinkedImportedCommunicationEvent {
  readonly result: "interested" | "not_interested" | "legacy_unclassified";
}

export interface LinkedClassifiedCustomerResponseEvent {
  readonly id: string;
  readonly reportId: string;
  readonly eventKind: "customer_response";
  readonly result: "interested" | "not_interested";
  readonly note: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly recordedAt: string;
  readonly mutationId: string;
  readonly supersedesEventId?: string;
  readonly payload?: never;
  readonly sourceKey?: never;
  readonly legacyOriginalId?: never;
  readonly legacyActorName?: never;
  readonly possibleDuplicateOf?: never;
  readonly legacyOrphanReport?: never;
}

export type LinkedCustomerResponseEvent =
  | LinkedImportedCustomerResponseEvent
  | LinkedClassifiedCustomerResponseEvent;

export interface LinkedLegacyFollowupUnresolvedFact {
  readonly id: string;
  readonly sourcePath: string;
  readonly reason: string;
  readonly raw: unknown;
}

export interface LinkedLegacyFollowupMigrationReceipt {
  readonly sourceKey: typeof LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY;
  readonly sourceHash: string;
  readonly present: boolean;
  readonly sourceRevision: number | null;
  readonly communicationEventCount: number;
  readonly responseEventCount: number;
  readonly orphanEventCount: number;
  readonly unresolvedFactCount: number;
  readonly eventIds: ReadonlyArray<string>;
  readonly unresolvedFacts: ReadonlyArray<LinkedLegacyFollowupUnresolvedFact>;
}

export interface LinkedMutationReceipt {
  readonly id: string;
  readonly mutationId: string;
  readonly operation: string;
  readonly actorId: string;
  readonly payloadHash: string;
  /** Optional only for early schema-v8 receipts written before exact replay equality. */
  readonly payloadCanonical?: string;
  readonly result: unknown;
  readonly committedRevision: number;
  readonly committedAt: string;
}

export interface LinkedLegacyRefundOccupancy {
  readonly id: string;
  readonly legacyRefundId: string;
  readonly invoiceId: string;
  readonly chargeLineId?: string;
  readonly amountJmd: number;
  readonly status: "line" | "unassigned";
  readonly quantityUnknown: boolean;
  readonly legacyRefundQuantity?: number;
}

export interface LinkedLegacyParkingOrigin {
  readonly id: string;
  readonly parking: LinkedLegacyParkingCaseFact;
  readonly waiverAudits: ReadonlyArray<LinkedParkingWaiverAudit>;
  readonly ownerInvoice: LegacyInvoice;
}

export interface LinkedActiveParkingClaim {
  readonly logicalInvoiceId: string;
  readonly financiallyEffectiveVersionId: string;
  readonly chargeLineId: string;
}

export interface LinkedParkingSourceCreationOrigin {
  readonly originContract: "parking_source_creation_v1";
  readonly id: string;
  readonly mutationId: string;
  readonly committedRevision: number;
  readonly committedAt: string;
  readonly originBusinessOrderId: string;
  readonly eligibleBusinessOrderIds: ReadonlyArray<string>;
  readonly vehicleId: string;
  readonly customerId: string;
  readonly initialSource: LinkedModernParkingSourceFact;
  readonly commitment: string;
}

export interface LinkedLegacyQuickParkingTakeoverReceipt {
  readonly takeoverContract: "legacy_quick_parking_takeover_v1";
  readonly id: string;
  readonly sourceKey: typeof LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY;
  readonly sourcePresent: boolean;
  readonly sourceHash: string;
  readonly sourceByteLength: number;
  readonly preTakeoverPrimaryPresent: boolean;
  readonly preTakeoverPrimaryHash: string;
  readonly preTakeoverPrimaryByteLength: number;
  readonly archiveAnchor: string;
  readonly recordedAt: string;
  readonly committedRevision: number;
  readonly importedOriginIds: ReadonlyArray<string>;
  readonly isolatedFactIds: ReadonlyArray<string>;
  readonly projectionCommitment: string;
  readonly commitment: string;
}

export interface LinkedLegacyQuickParkingTakeoverOrigin {
  readonly originContract: "parking_source_legacy_takeover_v1";
  readonly id: string;
  readonly takeoverId: string;
  readonly archiveAnchor: string;
  readonly sourcePath: string;
  readonly caseIndex: number;
  readonly originBusinessOrderId: string;
  readonly eligibleBusinessOrderIds: ReadonlyArray<string>;
  readonly vehicleId: string;
  readonly customerId: string;
  readonly initialSource: LinkedModernParkingSourceFact;
  readonly commitment: string;
}

export type LinkedLegacyQuickParkingIsolationReason =
  | "source_unreadable"
  | "case_schema_invalid"
  | "identity_unlinked"
  | "notification_mismatch"
  | "episode_duplicate"
  | "active_parking_conflict"
  | "unconsumed_preview"
  | "waiver_unproven"
  | "pickup_unproven"
  | "credit_signature_unproven"
  | "payment_history_present"
  | "payment_mirror_mismatch"
  | "invoice_amount_mismatch"
  | "quick_owned_legacy_invoice"
  | "invoice_contract_conflict";

export interface LinkedLegacyQuickParkingCanonicalRefs {
  readonly quickOrderIds: ReadonlyArray<string>;
  readonly parkingCaseIds: ReadonlyArray<string>;
  readonly invoiceIds: ReadonlyArray<string>;
  readonly invoiceVersionIds: ReadonlyArray<string>;
  readonly paymentIds: ReadonlyArray<string>;
  readonly refundIds: ReadonlyArray<string>;
}

export interface LinkedLegacyQuickParkingConservation {
  readonly cachedGrossJmd: number | null;
  readonly cumulativeWaivedJmd: number | null;
  readonly cachedFinalJmd: number | null;
  readonly quickPaidJmd: number | null;
  readonly linkedInvoiceTotalJmd: number | null;
  readonly linkedPaidJmd: number | null;
  readonly linkedRefundedJmd: number | null;
  readonly quickBalanceJmd: number | null;
  readonly linkedBalanceJmd: number | null;
}

export interface LinkedLegacyQuickParkingIsolate {
  readonly isolationContract: "legacy_quick_parking_isolation_v1";
  readonly id: string;
  readonly takeoverId: string;
  readonly sourcePath: string;
  readonly caseIndex: number | null;
  readonly legacyCaseId: string | null;
  readonly raw: unknown;
  readonly rawCommitment: string;
  readonly reasonCodes: ReadonlyArray<LinkedLegacyQuickParkingIsolationReason>;
  readonly canonicalRefs: LinkedLegacyQuickParkingCanonicalRefs;
  readonly conservation: LinkedLegacyQuickParkingConservation;
  readonly resolution: "unresolved";
  readonly commitment: string;
}

export interface LinkedOperationsState {
  schemaVersion: number;
  /** Task 8 canonical Invoice/refund/audit contract marker within schema v8. */
  billingSnapshotVersion: 1;
  /** Task 7 closed nullable linked-customer contact snapshot marker. */
  customerContactSnapshotVersion: 1;
  /** Task 6 closed attachment/audit contract marker within schema v8. */
  reportPhotoStorageVersion: 2;
  /** Canonical cross-binding to the immutable Task 2 photo-source manifest. */
  legacyPhotoManifestHash: string;
  revision: number;
  /** Optional only for d2a4906-era schema-v8 compatibility; every new write protects it first. */
  protectionAnchor?: string;
  /** 快速工单（2026-08-16 老板定的自然语言建单链路，schema v5 新增）。 */
  quickOrders: import("../orders/quick-order-types").QuickOrder[];
  trustedIdentities: LinkedTrustedIdentity[];
  customers: LinkedCustomerFact[];
  vehicles: LinkedVehicleFact[];
  orderRecords: OrderRecord[];
  businessOrders: BusinessOrder[];
  inspectionReports: LinkedInspectionReportFact[];
  inspectionItems: LinkedInspectionItemFact[];
  /** Exact pre-v8 archives remain readable but never participate in writes. */
  quotations: LegacyQuotationArchive[];
  quotationItems: LinkedQuotationItemFact[];
  currentQuotations: CurrentQuotation[];
  quotedChargeLines: QuotedChargeLine[];
  reportAttachments: LinkedReportAttachmentMetadata[];
  reportAttachmentAuditEvents: LinkedReportAttachmentAuditEvent[];
  legacyIrHistory: LinkedLegacyIrHistory;
  legacyChargeRecords: LinkedLegacyChargeRecord[];
  generationEvents: LinkedGenerationEvent[];
  communicationEvents: LinkedCurrentCommunicationEvent[];
  responseEvents: LinkedCustomerResponseEvent[];
  /** Optional only while repairing d9a3252-era schema-v8 records. */
  legacyFollowupMigration?: LinkedLegacyFollowupMigrationReceipt;
  discountSignatureEvents: DiscountApprovalEvidence[];
  mutationReceipts: LinkedMutationReceipt[];
  billingAuditEvents: LinkedBillingAuditEvent[];
  billingDocumentSequences: LinkedBillingDocumentSequence[];
  legacyRefundOccupancies: LinkedLegacyRefundOccupancy[];
  /** Task 8 cross-binding to independently protected pre-Task8 parking provenance. */
  legacyParkingOrigins: LinkedLegacyParkingOrigin[];
  legacyParkingOriginsCommitment: string;
  /** Independent append-only server origin for every runtime-created modern parking episode. */
  parkingSourceOrigins: LinkedParkingSourceCreationOrigin[];
  /** Present only after the storage pair has completed the one-time Task 8 takeover. */
  quickParkingTakeoverVersion?: 1;
  legacyQuickParkingTakeovers?: LinkedLegacyQuickParkingTakeoverReceipt[];
  legacyQuickParkingTakeoverOrigins?: LinkedLegacyQuickParkingTakeoverOrigin[];
  legacyQuickParkingIsolates?: LinkedLegacyQuickParkingIsolate[];
  activeParkingClaim: Record<string, LinkedActiveParkingClaim>;
  invoices: Invoice[];
  invoiceFileHashes: Record<string, string>;
  payments: InvoicePaymentFact[];
  refunds: LinkedInvoiceRefundFact[];
  parkingCases: LinkedParkingCaseFact[];
  parkingWaiverPreviews: LinkedParkingWaiverPreviewToken[];
  parkingWaiverAudits: LinkedParkingWaiverAudit[];
  communications: LinkedCommunicationFact[];
  invoiceAcknowledgements: InvoiceCustomerAcknowledgement[];
  specialReleaseAuthorizations: LinkedSpecialReleaseAuthorization[];
  reassignments: OrderReassignmentAudit[];
  performanceAudits: BusinessOrderPerformanceAudit[];
  operationsDocuments: OperationsDocumentRecord[];
  operationsAssignments: OrderAssignment[];
}

export function deriveCurrentQuotationReceivableJmd(
  state: LinkedOperationsState,
  quotationId: string,
): number {
  const quotation = state.currentQuotations.find((candidate) => candidate.id === quotationId);
  if (!quotation) throw new Error(`current quotation missing: ${quotationId}`);
  const lines = quotation.lineIds.map((lineId) => {
    const line = state.quotedChargeLines.find((candidate) => candidate.id === lineId);
    if (!line) throw new Error(`current quotation line missing: ${lineId}`);
    return line;
  });
  let receivableJmd = calculateQuotedChargeTotals(lines).grandTotalJmd;
  for (const adjustmentId of quotation.legacyReceivableAdjustmentIds) {
    const adjustment = state.legacyChargeRecords.find((candidate) => candidate.id === adjustmentId);
    if (!adjustment) throw new Error(`legacy quotation adjustment missing: ${adjustmentId}`);
    receivableJmd -= adjustment.amountJmd;
    if (!Number.isSafeInteger(receivableJmd) || receivableJmd < 0) {
      throw new Error("current quotation legacy adjustment exceeds receivable");
    }
  }
  return receivableJmd;
}

/** schema v2 及以前的 Business Order 没有单级绩效字段。 */
type LegacyBusinessOrderV2 = Omit<
  BusinessOrder,
  "performanceValueJmd" | "performanceCountedAt" | "formalSubmittedAt" | "formalSubmittedBy" | "startMileage"
> & Partial<Pick<
  BusinessOrder,
  "performanceValueJmd" | "performanceCountedAt" | "formalSubmittedAt" | "formalSubmittedBy"
>>;

/** schema v3 已有单级绩效字段，但尚未记录维修工接单里程。 */
type LegacyBusinessOrderV3 = Omit<BusinessOrder, "startMileage">;

interface LegacyLinkedParkingCaseFactV1 extends Omit<LinkedLegacyParkingCaseFact, "invoiceVersionId"> {}

interface LegacyLinkedSpecialReleaseAuthorizationV1 extends Omit<
  LinkedSpecialReleaseAuthorization,
  "administratorSignature" | "evidenceVersion"
> {
  administratorSignature: SignatureEvidence;
}

interface LegacyLinkedParkingWaiverAuditV1 extends Omit<
  LinkedLegacyParkingWaiverAudit,
  "administratorSignature" | "evidenceVersion"
> {
  administratorSignature?: SignatureEvidence;
}

type LegacyInspectionReportBeforeV7 = Omit<
  LinkedInspectionReportFact,
  "submissionSourceVersion" | "photoIds" | "categoryReviewRequired"
> & {
  sourceVersion: number;
};
type LegacyInspectionReportV7 = LegacyInspectionReportBeforeV7 & { photos: string[] };
type LegacyInspectionItemBeforeV7 = LinkedInspectionItemFact & { photos?: string[] };
type LegacyQuotationBeforeV7 = Omit<Quotation, "noteZh" | "noteEn">;
type LegacyLinkedCustomerFact = Omit<LinkedCustomerFact, "email"> & { email?: string | null };
type V8OnlyStateKey =
  | "billingSnapshotVersion"
  | "customerContactSnapshotVersion"
  | "reportPhotoStorageVersion"
  | "legacyPhotoManifestHash"
  | "currentQuotations"
  | "quotedChargeLines"
  | "reportAttachments"
  | "reportAttachmentAuditEvents"
  | "legacyIrHistory"
  | "legacyChargeRecords"
  | "generationEvents"
  | "communicationEvents"
  | "responseEvents"
  | "legacyFollowupMigration"
  | "discountSignatureEvents"
  | "mutationReceipts"
  | "billingAuditEvents"
  | "billingDocumentSequences"
  | "legacyRefundOccupancies"
  | "legacyParkingOrigins"
  | "legacyParkingOriginsCommitment"
  | "parkingSourceOrigins"
  | "quickParkingTakeoverVersion"
  | "legacyQuickParkingTakeovers"
  | "legacyQuickParkingTakeoverOrigins"
  | "legacyQuickParkingIsolates"
  | "activeParkingClaim"
  | "protectionAnchor";

interface LegacyLinkedOperationsStateV1 {
  schemaVersion?: 1;
  revision: number;
  customers: LegacyLinkedCustomerFact[];
  vehicles: LinkedVehicleFact[];
  orderRecords: OrderRecord[];
  businessOrders: LegacyBusinessOrderV2[];
  inspectionReports: LegacyInspectionReportBeforeV7[];
  inspectionItems: LegacyInspectionItemBeforeV7[];
  quotations: LegacyQuotationBeforeV7[];
  quotationItems: LinkedQuotationItemFact[];
  invoices: Invoice[];
  invoiceFileHashes: Record<string, string>;
  payments: InvoicePaymentFact[];
  parkingCases: LegacyLinkedParkingCaseFactV1[];
  parkingWaiverAudits: LegacyLinkedParkingWaiverAuditV1[];
  communications: LinkedCommunicationFact[];
  invoiceAcknowledgements: InvoiceCustomerAcknowledgement[];
  specialReleaseAuthorizations: LegacyLinkedSpecialReleaseAuthorizationV1[];
  reassignments: OrderReassignmentAudit[];
  operationsDocuments: OperationsDocumentRecord[];
  operationsAssignments: OrderAssignment[];
}

/** schema v2 = 当前结构减去 performanceAudits 与 BO 绩效字段。 */
type LegacyLinkedOperationsStateV2 = Omit<
  LinkedOperationsState,
  "schemaVersion" | "customers" | "businessOrders" | "performanceAudits" | "quickOrders" | "inspectionReports" | "inspectionItems" | "quotations" | V8OnlyStateKey
> & {
  schemaVersion?: 2;
  customers: LegacyLinkedCustomerFact[];
  businessOrders: LegacyBusinessOrderV2[];
  inspectionReports: LegacyInspectionReportBeforeV7[];
  inspectionItems: LegacyInspectionItemBeforeV7[];
  quotations: LegacyQuotationBeforeV7[];
};

/** schema v4 = 当前结构减去快速工单。 */
type LegacyLinkedOperationsStateV4 = Omit<
  LinkedOperationsState,
  "schemaVersion" | "customers" | "quickOrders" | "inspectionReports" | "inspectionItems" | "quotations" | V8OnlyStateKey
> & {
  schemaVersion: 4;
  customers: LegacyLinkedCustomerFact[];
  inspectionReports: LegacyInspectionReportBeforeV7[];
  inspectionItems: LegacyInspectionItemBeforeV7[];
  quotations: LegacyQuotationBeforeV7[];
};

/** schema v5 = 当前结构减去检查项备注/下一步/照片与报价项目对齐收费项的字段（2026-08-20 前）。 */
export type LegacyLinkedOperationsStateV5 = Omit<
  LinkedOperationsState,
  "schemaVersion" | "customers" | "inspectionReports" | "inspectionItems" | "quotations" | "quotationItems" | V8OnlyStateKey
> & {
  schemaVersion: 5;
  customers: LegacyLinkedCustomerFact[];
  inspectionReports: LegacyInspectionReportBeforeV7[];
  quotations: LegacyQuotationBeforeV7[];
  inspectionItems: Array<{
    id: string;
    inspectionReportId: string;
    findingZh: string;
    findingEn?: string;
    recommendationZh: string;
    recommendationEn?: string;
  }>;
  quotationItems: Array<{
    id: string;
    quotationVersionId: string;
    sourceInspectionItemId: string;
    descriptionZh: string;
    category: "labor" | "parts" | "other_service";
    amountJmd: number;
    decisionStatus: "pending" | "accepted" | "rejected" | "deferred";
  }>;
};

/** schema v3 = 当前结构减去 BO 起始里程事实。 */
type LegacyLinkedOperationsStateV3 = Omit<
  LinkedOperationsState,
  "schemaVersion" | "customers" | "businessOrders" | "quickOrders" | "inspectionReports" | "inspectionItems" | "quotations" | V8OnlyStateKey
> & {
  schemaVersion: 3;
  customers: LegacyLinkedCustomerFact[];
  businessOrders: LegacyBusinessOrderV3[];
  inspectionReports: LegacyInspectionReportBeforeV7[];
  inspectionItems: LegacyInspectionItemBeforeV7[];
  quotations: LegacyQuotationBeforeV7[];
};

/** schema v6 = 照片仍挂检查项，Quotation 尚无总备注。 */
type LegacyLinkedOperationsStateV6 = Omit<
  LinkedOperationsState,
  "schemaVersion" | "customers" | "inspectionReports" | "inspectionItems" | "quotations" | V8OnlyStateKey
> & {
  schemaVersion: 6;
  customers: LegacyLinkedCustomerFact[];
  inspectionReports: LegacyInspectionReportBeforeV7[];
  inspectionItems: LegacyInspectionItemBeforeV7[];
  quotations: LegacyQuotationBeforeV7[];
};

/** Dirty shared-worktree transition: report-level strings plus possible item photos. */
type LegacyLinkedOperationsStateV7 = Omit<
  LinkedOperationsState,
  "schemaVersion" | "customers" | "inspectionReports" | "inspectionItems" | "quotations" | V8OnlyStateKey
> & {
  schemaVersion: 7;
  customers: LegacyLinkedCustomerFact[];
  inspectionReports: LegacyInspectionReportV7[];
  inspectionItems: LegacyInspectionItemBeforeV7[];
  quotations: Quotation[];
};

export interface LinkedOperationsFaults {
  delayMs?: { read?: number; byAction?: Record<string, number> };
  failNext?: { read?: string; write?: string; byAction?: Record<string, string> };
  nowMs?: number;
}

export class LinkedApiDomainError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "LinkedApiDomainError";
  }
}

function boundAdministratorSignaturePayload(
  administratorId: string,
  binding: AdministratorSignatureBinding,
  signedAt: string,
): string {
  return [
    "bound",
    binding.action,
    administratorId,
    binding.subjectId,
    binding.sourceRevision,
    binding.amountJmd,
    encodeURIComponent(binding.reason),
    signedAt,
  ].join(":");
}

const ADMINISTRATOR_SIGNATURE_EVIDENCE_FIELDS = new Set([
  "signatureId", "signatureHash", "blobRef", "administratorId", "action", "subjectId",
  "sourceRevision", "amountJmd", "reason", "signedAt", "payloadHash",
]);

function validateAdministratorSignatureProvenance(
  administratorId: string,
  evidence: AdministratorSignatureEvidence | undefined,
  binding: AdministratorSignatureBinding,
): asserts evidence is AdministratorSignatureEvidence {
  const catalogIdentity = canonicalMockIdentitySnapshot(administratorId);
  if (!catalogIdentity || catalogIdentity.role !== "superadmin") {
    throw new LinkedApiDomainError("管理员签名不属于 canonical 超级管理员", 403);
  }
  if (!hasExactEnumerableDataFields(
    evidence,
    ADMINISTRATOR_SIGNATURE_EVIDENCE_FIELDS,
    ADMINISTRATOR_SIGNATURE_EVIDENCE_FIELDS,
  )) {
    throw new LinkedApiDomainError("管理员现场签名证据字段不闭合", 400);
  }
  if (evidence.administratorId !== administratorId) throw new LinkedApiDomainError("管理员签名身份不一致", 400);
  if (evidence.action !== binding.action) throw new LinkedApiDomainError("管理员签名动作不一致", 400);
  if (
    evidence.subjectId !== binding.subjectId
    || evidence.sourceRevision !== binding.sourceRevision
    || evidence.amountJmd !== binding.amountJmd
    || evidence.reason !== binding.reason
  ) {
    throw new LinkedApiDomainError("管理员签名绑定内容不一致", 400);
  }
  if (
    typeof evidence.signatureId !== "string" || !evidence.signatureId.trim()
    || typeof evidence.signatureHash !== "string" || !evidence.signatureHash.trim()
    || typeof evidence.blobRef !== "string" || !evidence.blobRef.trim()
  ) {
    throw new LinkedApiDomainError("管理员现场签名证据不完整", 400);
  }
  if (!Number.isFinite(Date.parse(evidence.signedAt))) throw new LinkedApiDomainError("管理员签名时间无效", 400);
  const expectedPayload = boundAdministratorSignaturePayload(administratorId, binding, evidence.signedAt);
  if (evidence.payloadHash !== expectedPayload) throw new LinkedApiDomainError("管理员签名 payload 不一致", 400);
}

export function validateAdministratorSignature(
  state: LinkedOperationsState,
  administratorId: string,
  evidence: AdministratorSignatureEvidence | undefined,
  binding: AdministratorSignatureBinding,
): asserts evidence is AdministratorSignatureEvidence {
  const identity = state.trustedIdentities.find((candidate) => candidate.id === administratorId);
  if (!identity || identity.role !== "superadmin") throw new LinkedApiDomainError("管理员当前无权签名", 403);
  validateAdministratorSignatureProvenance(administratorId, evidence, binding);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function deriveLegacyParkingOrigins(
  parkingCases: ReadonlyArray<LinkedParkingCaseFact>,
  waiverAudits: ReadonlyArray<LinkedParkingWaiverAudit>,
  invoices: ReadonlyArray<Invoice>,
): LinkedLegacyParkingOrigin[] {
  return parkingCases
    .filter((parking): parking is LinkedLegacyParkingCaseFact => !Object.prototype.hasOwnProperty.call(parking, "parkingContract"))
    .map((parking) => {
      const ownerInvoice = invoices.find((invoice) => invoice.id === parking.invoiceId);
      if (!ownerInvoice || isSharedChargeInvoice(ownerInvoice)) {
        throw new Error(`legacy parking owner Invoice missing: ${parking.id}`);
      }
      return {
        id: parking.id,
        parking: clone(parking),
        waiverAudits: clone(waiverAudits.filter((audit) => audit.caseId === parking.id)),
        ownerInvoice: clone(ownerInvoice),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function legacyParkingOriginsCommitment(origins: ReadonlyArray<LinkedLegacyParkingOrigin>): string {
  return exactSourceHash(stableJson(origins));
}

function legacyParkingImmutableCoordinates(parking: LinkedLegacyParkingCaseFact): Record<string, unknown> {
  return {
    id: parking.id,
    businessOrderId: parking.businessOrderId,
    invoiceId: parking.invoiceId,
    vehicleId: parking.vehicleId,
    notificationDate: parking.notificationDate,
    ...(parking.pickupDate !== undefined ? { pickupDate: parking.pickupDate } : {}),
    accrual: parking.accrual,
    dailyRateJmd: parking.dailyRateJmd,
  };
}

export interface LinkedInvoiceFinancialSummary extends InvoicePaymentSummary {
  readonly invoiceTotalJmd: number;
  readonly receivableJmd: number;
  readonly grossPaidJmd: number;
  readonly cashRefundedJmd: number;
  readonly receivableReductionJmd: number;
  readonly netPaidJmd: number;
  readonly hasPaymentHistory: boolean;
  settlementStatus: OrderSettlementStatus;
}

function refundLogicalInvoiceId(refund: LinkedInvoiceRefundFact): string {
  return refund.refundContract === "ordinary_line_v1" ? refund.logicalInvoiceId : refund.invoiceId;
}

function refundCashAmountJmd(refund: LinkedInvoiceRefundFact): number {
  return refund.refundContract === "ordinary_line_v1" ? refund.cashRefundJmd : refund.amountJmd;
}

function refundReceivableReductionJmd(refund: LinkedInvoiceRefundFact): number {
  return refund.refundContract === "ordinary_line_v1" ? refund.receivableReductionJmd : 0;
}

function sumMoney(values: ReadonlyArray<number>, label: string): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负安全整数`);
    total += value;
    if (!Number.isSafeInteger(total)) throw new Error(`${label}超过安全整数范围`);
  }
  return total;
}

export function deriveLinkedInvoiceFinancialSummary(
  state: LinkedOperationsState,
  invoice: Invoice,
): LinkedInvoiceFinancialSummary {
  const version = financiallyEffectiveInvoiceVersion(invoice);
  const invoiceTotalJmd = invoiceVersionTotalJmd(version);
  const grossPaidJmd = sumMoney(
    state.payments.filter((item) => item.invoiceId === invoice.id).map((item) => item.amountJmd),
    "收款金额",
  );
  const ownerRefunds = state.refunds.filter((item) => refundLogicalInvoiceId(item) === invoice.id);
  const parkingCorrectionRefunds = state.billingAuditEvents.filter((event): event is LinkedParkingInvoiceReprojectionAudit => (
    event.operation === "parking_invoice_reprojection"
      && event.reprojectionKind === "waiver_correction"
      && event.invoiceId === invoice.id
      && event.parkingCashRefundJmd > 0
  ));
  const refundedJmd = sumMoney(
    [...ownerRefunds.map(refundCashAmountJmd), ...parkingCorrectionRefunds.map((event) => event.parkingCashRefundJmd)],
    "退款金额",
  );
  const receivableReductionJmd = sumMoney(
    ownerRefunds.map(refundReceivableReductionJmd),
    "应收冲减金额",
  );
  const paidJmd = grossPaidJmd - refundedJmd;
  if (!Number.isSafeInteger(paidJmd)) throw new Error("净收款超过安全整数范围");
  const receivableJmd = invoiceTotalJmd - receivableReductionJmd;
  if (!Number.isSafeInteger(receivableJmd) || receivableJmd < 0) throw new Error("Invoice 应收冲减超过财务生效总额");
  const balanceJmd = receivableJmd - paidJmd;
  const paymentStatus = paidJmd <= 0
    ? "unpaid"
    : paidJmd < receivableJmd
      ? "partially_paid"
      : "paid";
  const settlementStatus: OrderSettlementStatus = balanceJmd > 0
    ? "due"
    : balanceJmd < 0
      ? "overpaid"
      : "settled";
  return {
    invoiceTotalJmd,
    receivableJmd,
    grossPaidJmd,
    cashRefundedJmd: refundedJmd,
    receivableReductionJmd,
    netPaidJmd: paidJmd,
    paidJmd,
    balanceJmd,
    paymentStatus,
    settlementStatus,
    hasPaymentHistory: state.payments.some((item) => item.invoiceId === invoice.id),
    payments: state.payments.filter((item) => item.invoiceId === invoice.id),
  };
}

function vehiclePoolForTeam(teamId: OrderTeamId): VehiclePool {
  return teamId === "t3" ? "engineering" : teamId === "t4" ? "bodywork" : "ordinary";
}

function inspectionOperationsStage(report: LinkedInspectionReportFact): OperationsDocumentRecord["stage"] {
  if (report.status === "mechanic_submitted") return "inspection_awaiting_dispatch";
  if (report.status === "ai_structured") return "inspection_in_progress";
  if (report.status === "awaiting_frontdesk" || report.status === "returned_for_revision") {
    return "inspection_awaiting_frontdesk";
  }
  return report.status === "published" ? "quote_awaiting_customer" : "quote_accepted_awaiting_order";
}

function businessOrderOperationsStage(
  state: LinkedOperationsState,
  order: BusinessOrder,
): OperationsDocumentRecord["stage"] {
  const record = state.orderRecords.find((candidate) => candidate.id === order.id);
  if (!record) throw new Error(`Business Order ${order.id} 缺少列表来源`);
  const status = deriveProcessingStatus(record);
  if (status === "submitted_awaiting_collection") return "submitted_awaiting_collection";
  if (status === "returned_awaiting_frontdesk") {
    const invoice = state.invoices.find((candidate) => candidate.businessOrderId === order.id);
    if (!invoice) throw new Error(`Business Order ${order.id} 缺少 Invoice`);
    const latestRelease = order.vehicleReleaseFacts[order.vehicleReleaseFacts.length - 1];
    const paidOrAuthorized = deriveLinkedInvoiceFinancialSummary(state, invoice).balanceJmd <= 0
      || latestRelease?.status === "authorized";
    return paidOrAuthorized ? "awaiting_formal_handover" : "returned_awaiting_frontdesk";
  }
  if (status === "in_progress") return "repair_in_progress";
  return status === "awaiting_acceptance" ? "repair_awaiting_acceptance" : "repair_awaiting_dispatch";
}

function assignmentStatusForStage(
  stage: OperationsDocumentRecord["stage"],
): OrderAssignmentStatus {
  if (
    stage === "inspection_awaiting_dispatch"
    || stage === "inspection_awaiting_acceptance"
    || stage === "repair_awaiting_dispatch"
    || stage === "repair_awaiting_acceptance"
  ) {
    return "awaiting_acceptance";
  }
  if (stage === "inspection_in_progress" || stage === "repair_in_progress") return "in_progress";
  if (stage === "blocked") return "blocked";
  if (stage === "inspection_awaiting_frontdesk" || stage === "returned_awaiting_frontdesk") return "returned";
  return "completed";
}

function deriveOperationsDocuments(state: LinkedOperationsState): OperationsDocumentRecord[] {
  return [
    ...state.inspectionReports.map((report) => ({
      id: report.id,
      vehicleId: report.vehicleId,
      stage: inspectionOperationsStage(report),
    })),
    ...state.businessOrders.map((order) => ({
      id: order.id,
      vehicleId: order.vehicleId,
      stage: businessOrderOperationsStage(state, order),
    })),
  ];
}

function deriveOperationsAssignments(state: LinkedOperationsState): OrderAssignment[] {
  const inspectionAssignments: OrderAssignment[] = state.inspectionReports.map((report) => ({
    id: `assignment-${report.id}`,
    vehicleId: report.vehicleId,
    documentId: report.id,
    kind: "inspection",
    vehiclePool: vehiclePoolForTeam(report.inspectorTeamId),
    firstAssignedTeamId: report.inspectorTeamId,
    firstAssignedAt: report.submittedAt,
    teamId: report.inspectorTeamId,
    status: assignmentStatusForStage(inspectionOperationsStage(report)),
    assignedAt: report.submittedAt,
    submittedAt: report.submittedAt,
    sourceInspection: {
      submissionId: report.submissionId,
      inspectionReportNo: report.inspectionReportNo,
      inspectorId: report.inspectorId,
      inspectorName: report.inspectorName,
      inspectorTeamId: report.inspectorTeamId,
      submittedAt: report.submittedAt,
    },
    reassignmentHistory: [],
  }));
  const repairAssignments: OrderAssignment[] = state.businessOrders.map((order) => {
    const record = state.orderRecords.find((candidate) => candidate.id === order.id);
    if (!record) throw new Error(`Business Order ${order.id} 缺少 assignment 来源`);
    const audits = state.reassignments.filter((audit) => audit.orderId === order.id);
    const firstAudit = audits[0];
    const lastAudit = audits[audits.length - 1];
    const stage = businessOrderOperationsStage(state, order);
    return {
      id: `assignment-${order.id}`,
      vehicleId: order.vehicleId,
      documentId: order.id,
      kind: "repair",
      vehiclePool: vehiclePoolForTeam(order.executionTeamId),
      firstAssignedTeamId: firstAudit?.fromTeamId ?? order.executionTeamId,
      firstAssignedAt: record.createdAt,
      teamId: order.executionTeamId,
      status: assignmentStatusForStage(stage),
      assignedAt: lastAudit?.changedAt ?? record.createdAt,
      reassignmentHistory: audits.map((audit) => ({
        fromTeamId: audit.fromTeamId,
        toTeamId: audit.toTeamId,
        reason: audit.reason,
        actor: { ...audit.actor },
        changedAt: audit.changedAt,
      })),
    };
  });
  return [...inspectionAssignments, ...repairAssignments];
}

/**
 * 为缺少单级绩效字段的 Business Order 补默认值：绩效值按已确认工时项目计算；
 * 已交单（record.submittedAt 存在）的历史单恢复为"已交单已计入"。
 */
function withPerformanceDefaults(
  order: LegacyBusinessOrderV2,
  record: OrderRecord | undefined,
): LegacyBusinessOrderV3 {
  const performanceValueJmd = order.performanceValueJmd ?? computeDefaultPerformanceValue(order);
  const formalSubmittedAt = order.formalSubmittedAt ?? record?.submittedAt ?? null;
  return {
    ...order,
    performanceValueJmd,
    formalSubmittedAt,
    formalSubmittedBy: order.formalSubmittedBy
      ?? (formalSubmittedAt !== null ? record?.updatedBy ?? null : null),
    performanceCountedAt: order.performanceCountedAt ?? formalSubmittedAt,
  };
}

function isStartedBusinessOrder(order: Pick<BusinessOrder, "executionStatus">): boolean {
  return order.executionStatus === "in_progress" || order.executionStatus === "completed";
}

function deterministicStartMileage(
  order: Pick<BusinessOrder, "id" | "executionStatus">,
  record: OrderRecord,
  index: number,
): BusinessOrderStartMileage | null {
  if (!isStartedBusinessOrder(order)) return null;
  const recorder = record.mechanics[0];
  if (!recorder || !record.acceptedAt) throw new Error(`started seed ${order.id} lacks acceptance recorder`);
  const sequence = Number(order.id.replace("order-demo-", ""));
  const value = Number.isSafeInteger(sequence) && sequence >= 11 && sequence <= 24
    ? 81_600 + (sequence - 11) * 200
    : 80_000 + index * 100;
  return {
    status: "recorded",
    value,
    unit: "km",
    recordedAt: record.acceptedAt,
    recordedById: recorder.id,
    recordedByName: recorder.name,
  };
}

function withStartMileageFact(
  order: LegacyBusinessOrderV3,
  record: OrderRecord,
  index: number,
): BusinessOrder {
  return { ...order, startMileage: deterministicStartMileage(order, record, index) };
}

function dedupeConsistentById<T extends { id: string }>(
  snapshots: readonly T[],
  identity: (value: T) => readonly unknown[],
): T[] {
  const byId = new Map<string, T>();
  for (const snapshot of snapshots) {
    const existing = byId.get(snapshot.id);
    if (existing === undefined) {
      byId.set(snapshot.id, snapshot);
      continue;
    }
    if (JSON.stringify(identity(existing)) !== JSON.stringify(identity(snapshot))) {
      throw new Error(`canonical identity snapshot conflict: ${snapshot.id}`);
    }
  }
  return [...byId.values()];
}

type CanonicalVehicleSnapshot = Pick<LinkedVehicleFact, "id" | "plate" | "modelZh" | "modelEn"> & Partial<Pick<LinkedVehicleFact, "customerId">>;

export function dedupeCanonicalVehicleSnapshots(
  snapshots: readonly CanonicalVehicleSnapshot[],
): LinkedVehicleFact[] {
  return dedupeConsistentById(
    snapshots,
    (vehicle) => [vehicle.id, vehicle.plate, vehicle.modelZh ?? null, vehicle.modelEn ?? null],
  ).map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate,
    ...(vehicle.modelZh ? { modelZh: vehicle.modelZh } : {}),
    ...(vehicle.modelEn ? { modelEn: vehicle.modelEn } : {}),
    customerId: canonicalVehicleById(vehicle.id).currentCustomerId,
  }));
}

interface InitialLinkedOperationsBundle {
  readonly state: LinkedOperationsState;
}

function initialLinkedOperationsBundle(): InitialLinkedOperationsBundle {
  const trustedIdentities = clone(DEFAULT_LINKED_TRUSTED_IDENTITIES) as LinkedTrustedIdentity[];
  const orderRecords = clone(ORDER_DEMO_SEED) as LinkedOperationsState["orderRecords"];
  const customers: LinkedCustomerFact[] = dedupeConsistentById(
    orderRecords.map((order) => ({ ...order.customer })),
    (customer) => [customer.id, customer.nameZh, customer.nameEn ?? null, customer.phone],
  ).map((customer) => ({
    ...customer,
    email: canonicalCustomerById(customer.id).email,
  }));
  const vehicles = dedupeCanonicalVehicleSnapshots(
    orderRecords.map((order) => ({ ...order.vehicle, customerId: order.customer.id })),
  );
  const inspectionReports: LinkedInspectionReportFact[] = [];
  const inspectionItems: LinkedInspectionItemFact[] = [];
  const quotations: LegacyQuotationArchive[] = [];
  const quotationItems: LinkedQuotationItemFact[] = [];
  const currentQuotations: CurrentQuotation[] = [];
  const quotedChargeLines: QuotedChargeLine[] = [];
  const reportAttachments: LinkedReportAttachmentMetadata[] = [];
  const businessOrders: BusinessOrder[] = [];
  const invoices: Invoice[] = [];
  const invoiceFileHashes: Record<string, string> = {};
  const payments: InvoicePaymentFact[] = [];
  const refunds: LinkedInvoiceRefundFact[] = [];

  // ---------------------------------------------------------------------------
  // 检查结果演示数据（2026-08-20 老板重做：一单一个阶段，结构对齐业务单）
  // demo-01 发动机敲缸（已发布）：本步=拆解发动机 20 万，下一步待定 → 另出报告与报价
  // demo-02 线路问题（已审核）：本步=线路检查，配件待报价 → 列表出现「待发送」提醒
  // demo-03 待前台审核（可编辑，报价空白建立演示）
  // ---------------------------------------------------------------------------
  const irSpecs: ReadonlyArray<{
    suffix: string; reportNo: string;
    status: InspectionReportStatus; inspectorName: string; teamId: OrderTeamId;
    rawText: string; aiDraft: string;
    items: ReadonlyArray<{ findingZh: string; findingEn: string; recommendationZh: string; recommendationEn: string; remarkZh?: string; remarkEn?: string; nextStepZh?: string; nextStepEn?: string }>;
    quotes: ReadonlyArray<{ descZh: string; descEn: string; remarkZh?: string; remarkEn?: string; unit: string; unitEn: string; quantity: number; unitPriceJmd: number; pendingQuote: boolean; category: "labor" | "parts" }>;
  }> = [
    {
      suffix: "01", reportNo: "KGN-WH-IR-2026080919422",
      status: "published", inspectorName: "超级管理员", teamId: "t1",
      rawText: "宝马 X5 检查原始记录：发动机运转时有明显敲击声，判断是发动机内部问题，需要先拆解发动机才能确定后续配件和维修方案。拆解发动机工时 200000",
      aiDraft: "结构化检查草稿：发动机敲缸，判断为发动机内部问题（需要处理）。本步处理：先拆解发动机。拆解完成后将另行出具检查报告与报价。",
      items: [{ findingZh: "发动机敲缸，判断为发动机内部问题（需要处理）", findingEn: "Engine knocking; suspected internal engine issue (requires attention)", recommendationZh: "先拆解发动机（本步处理）", recommendationEn: "Engine teardown (this stage)", remarkZh: "发动机运转时有明显敲击声；拆解后才能看到内部损伤情况，确定后续配件与维修方案。", remarkEn: "Audible knocking while running; internal damage and further repair plan can only be confirmed after teardown.", nextStepZh: "拆解完成后将另行出具检查报告与报价；后续维修方案与费用待定。", nextStepEn: "A new inspection report and quotation will be issued after teardown." }],
      quotes: [
        { descZh: "拆解发动机", descEn: "Engine teardown", unit: "工时", unitEn: "labor hours", quantity: 1, unitPriceJmd: 200_000, pendingQuote: false, category: "labor" },
        { descZh: "发动机拆解需更换件", descEn: "Parts to be replaced after teardown", remarkZh: "拆解后按实际损伤确定", remarkEn: "To be confirmed after teardown", unit: "个", unitEn: "pcs", quantity: 1, unitPriceJmd: 0, pendingQuote: true, category: "parts" },
      ],
    },
    {
      suffix: "02", reportNo: "KGN-WH-IR-2026080919423",
      status: "approved", inspectorName: "超级管理员", teamId: "t2",
      rawText: "海狮检查原始记录：车辆线路故障，多个用电器间歇性失灵，故障点不明，需要先做全车线路检查才能报配件。线路检查工时 30000",
      aiDraft: "结构化检查草稿：车辆线路故障，多个用电器间歇性失灵（需要处理）。本步处理：先做全车线路检查。检查后才能报配件，后续另出报告与报价。",
      items: [{ findingZh: "车辆线路故障，多个用电器间歇性失灵（需要处理）", findingEn: "Intermittent electrical failures across multiple accessories (requires attention)", recommendationZh: "先做全车线路检查（本步处理）", recommendationEn: "Full vehicle wiring inspection (this stage)", remarkZh: "故障点不明，需逐段排查线路后才能确定要更换的配件。", remarkEn: "Fault point unknown; parts can only be confirmed after tracing the wiring.", nextStepZh: "线路检查后才能报配件；后续另出报告与报价。", nextStepEn: "Parts will be quoted after the wiring inspection in a new report." }],
      quotes: [
        { descZh: "全车线路检查", descEn: "Full wiring inspection", unit: "工时", unitEn: "labor hours", quantity: 1, unitPriceJmd: 30_000, pendingQuote: false, category: "labor" },
        { descZh: "线路相关配件", descEn: "Wiring parts", remarkZh: "检查后按实际故障确定", remarkEn: "To be confirmed after inspection", unit: "个", unitEn: "pcs", quantity: 1, unitPriceJmd: 0, pendingQuote: true, category: "parts" },
      ],
    },
    {
      suffix: "03", reportNo: "KGN-WH-IR-2026080919424",
      status: "awaiting_frontdesk", inspectorName: "超级管理员", teamId: "t3",
      rawText: "检查原始记录：前悬挂过减速带有异响，疑似前减震器问题，需要进一步确认。",
      aiDraft: "结构化检查草稿：前悬挂过减速带有异响，疑似前减震器问题（需要处理）。本步处理：更换前减震器。",
      items: [{ findingZh: "前悬挂过减速带有异响，疑似前减震器问题（需要处理）", findingEn: "Clunking from front suspension over bumps; suspected front shock absorber issue (requires attention)", recommendationZh: "更换前减震器（本步处理）", recommendationEn: "Replace front shock absorbers (this stage)", remarkZh: "试车确认异响来自前悬挂；具体以拆检为准。", remarkEn: "Noise confirmed from front suspension during road test; subject to teardown.", nextStepZh: "拆检后才能确定全部项目。", nextStepEn: "Full scope to be confirmed after teardown." }],
      quotes: [],
    },
  ];

  for (const spec of irSpecs) {
    // 客户/车辆沿用演示工单（orderRecords）的 canonical 身份，保证跨模块引用一致
    const anchorOrder = orderRecords[Number(spec.suffix) - 1] ?? orderRecords[0];
    const reportId = `inspection-report-demo-${spec.suffix}`;
    const quotationId = `quotation-demo-${spec.suffix}`;
    const versionId = `${quotationId}-v1`;
    inspectionItems.push(...spec.items.map((item, itemIndex) => ({
      id: `${reportId}-item-${itemIndex + 1}`,
      inspectionReportId: reportId,
      findingZh: item.findingZh,
      findingEn: item.findingEn,
      recommendationZh: item.recommendationZh,
      recommendationEn: item.recommendationEn,
      remarkZh: item.remarkZh,
      remarkEn: item.remarkEn,
      nextStepZh: item.nextStepZh,
      nextStepEn: item.nextStepEn,
    })));
    const itemIds = spec.items.map((_item, itemIndex) => `${reportId}-item-${itemIndex + 1}`);
    const quoteItemIds = spec.quotes.map((_quote, quoteIndex) => `${versionId}-item-${quoteIndex + 1}`);
    quotationItems.push(...spec.quotes.map((quote, quoteIndex) => ({
      id: quoteItemIds[quoteIndex],
      quotationVersionId: versionId,
      sourceInspectionItemId: itemIds[quoteIndex % itemIds.length],
      descZh: quote.descZh,
      descEn: quote.descEn,
      remarkZh: quote.remarkZh,
      remarkEn: quote.remarkEn,
      unit: quote.unit,
      unitEn: quote.unitEn,
      quantity: quote.quantity,
      unitPriceJmd: quote.unitPriceJmd,
      pendingQuote: quote.pendingQuote,
      category: quote.category,
    })));
    quotedChargeLines.push(...spec.quotes.map((quote, quoteIndex) => ({
      id: quoteItemIds[quoteIndex],
      pricingMode: "unit" as const,
      category: quote.category,
      sourceId: itemIds[quoteIndex % itemIds.length],
      descZh: quote.descZh,
      descEn: quote.descEn,
      remarkZh: quote.remarkZh ?? "",
      remarkEn: quote.remarkEn ?? "",
      unit: quote.unit,
      unitEn: quote.unitEn,
      quantity: quote.quantity,
      unitPriceJmd: quote.unitPriceJmd,
      unitDiscountJmd: 0,
      pendingQuote: quote.pendingQuote,
    })));
    quotations.push({
      id: quotationId,
      quotationNo: spec.reportNo.replace("-IR-", "-QT-"),
      inspectionReportId: reportId,
      noteZh: DEFAULT_QUOTATION_NOTE_ZH,
      noteEn: DEFAULT_QUOTATION_NOTE_EN,
      // 没有报价项目时留空版本（demo-03 演示“空白建立报价”分支，2026-08-20 老板）
      versions: quoteItemIds.length > 0 ? [{ id: versionId, version: 1, quotationItemIds: quoteItemIds, createdAt: "2026-08-18T10:00:00-05:00" }] : [],
    });
    currentQuotations.push({
      id: quotationId,
      quotationNo: spec.reportNo.replace("-IR-", "-QT-"),
      inspectionReportId: reportId,
      lineIds: quoteItemIds,
      legacyReceivableAdjustmentIds: [],
      noteZh: DEFAULT_QUOTATION_NOTE_ZH,
      noteEn: DEFAULT_QUOTATION_NOTE_EN,
      contentRevision: 1,
      generationCounter: 0,
      lastGeneratedAt: null,
      generatedFromRevision: null,
      activeGeneratedBundle: null,
    });
    inspectionReports.push({
      id: reportId,
      inspectionReportNo: spec.reportNo,
      customerId: anchorOrder.customer.id,
      vehicleId: anchorOrder.vehicle.id,
      status: spec.status,
      submissionId: `inspection-submission-demo-${spec.suffix}`,
      submissionSourceVersion: 1,
      inspectorId: "emp-001",
      inspectorName: spec.inspectorName,
      inspectorTeamId: spec.teamId,
      submittedAt: "2026-08-18T09:30:00-05:00",
      rawText: spec.rawText,
      aiDraft: spec.aiDraft,
      photoIds: [],
      categoryReviewRequired: false,
      itemIds,
      quotationId,
    });
  }
  orderRecords.forEach((order, index) => {
    const suffix = order.id.replace("order-demo-", "");
    // 溯源只用有报价项目的演示检查单（demo-01/02；demo-03 报价空白建立演示，无报价项目可引用）
    const sourceIndex = index % 2;
    const report = inspectionReports[sourceIndex];
    const quotation = quotations[sourceIndex];
    const quotationVersion = quotation.versions[0];
    const sourceInspectionItemId = report.itemIds[index % 2 === 1 && report.itemIds.length > 1 ? 1 : 0] ?? report.itemIds[0];
    const quotationItemId = quotationVersion.quotationItemIds[index % 2 === 1 && quotationVersion.quotationItemIds.length > 1 ? 1 : 0] ?? quotationVersion.quotationItemIds[0];
    const chargeLines: ChargeLine[] = [
      ...order.laborItems.map((item) => ({
        id: `invoice-line-${item.id}`,
        category: "labor" as const,
        code: "repair" as const,
        descriptionZh: item.name,
        descriptionEn: item.name,
        quantity: 1,
        unitPriceJmd: item.amountJmd,
        sourceId: sourceInspectionItemId,
      })),
      ...order.partItems.map((item) => ({
        id: `invoice-line-${item.id}`,
        category: "parts" as const,
        code: "part" as const,
        descriptionZh: item.name,
        descriptionEn: item.name,
        quantity: 1,
        unitPriceJmd: item.amountJmd,
        sourceId: sourceInspectionItemId,
      })),
    ];
    const parkingCaseId = order.id === "order-demo-03"
      ? "PARK-001"
      : order.id === "order-demo-08"
        ? "PARK-002"
        : undefined;
    if (parkingCaseId) {
      const days = parkingCaseId === "PARK-001" ? 5 : 25;
      chargeLines.push({
        id: `invoice-line-${parkingCaseId}`,
        category: "other_service",
        code: "parking_overtime",
        descriptionZh: "停车超时费",
        descriptionEn: "Parking overtime",
        quantity: days,
        unitPriceJmd: 2_500,
        sourceId: parkingCaseId,
      });
    }
    const businessOrder: LegacyBusinessOrderV2 = {
      id: order.id,
      businessOrderNo: order.orderNo,
      customerId: order.customer.id,
      vehicleId: order.vehicle.id,
      executionStatus: order.submittedAt ? "completed" : order.acceptedAt ? "in_progress" : "planned",
      executionTeamId: order.teamId ?? report.inspectorTeamId,
      items: [{
        id: `business-order-item-${suffix}`,
        sourceProject: {
          inspectionReportId: report.id,
          inspectionItemId: sourceInspectionItemId,
          quotationId: quotation.id,
          quotationVersionId: quotationVersion.id,
          quotationItemId,
          businessOrderId: order.id,
          businessOrderItemId: `business-order-item-${suffix}`,
          inspectorTeamId: report.inspectorTeamId,
          executionTeamId: order.teamId ?? report.inspectorTeamId,
          executionStatus: order.submittedAt ? "completed" : order.acceptedAt ? "in_progress" : "planned",
        },
        chargeLines,
      }],
      invoiceIds: [`invoice-demo-${suffix}`],
      vehicleReleaseFacts: [{
        id: `release-${suffix}`,
        businessOrderId: order.id,
        vehicleId: order.vehicle.id,
        status: "not_authorized",
      }],
    };
    businessOrders.push(withStartMileageFact(withPerformanceDefaults(businessOrder, order), order, index));
    const totals = calculateInvoiceTotals({ lines: chargeLines, adjustments: [] });
    const invoiceId = `invoice-demo-${suffix}`;
    const invoiceVersionId = `${invoiceId}-v1`;
    invoices.push({
      id: invoiceId,
      invoiceNo: order.orderNo.replace("KGN-WH-", "KGN-WH-INV-"),
      businessOrderId: order.id,
      versions: [{ id: invoiceVersionId, version: 1, lines: chargeLines, adjustments: [], totals, issuedAt: order.updatedAt }],
      settlementArrangement: index === 0 ? "credit" : index === 1 ? "special_agreement" : "normal",
    });
    invoiceFileHashes[invoiceVersionId] = `sha256-invoice-${suffix}-v1`;
    payments.push(...order.payments.map((payment) => ({
      id: payment.id,
      invoiceId,
      amountJmd: payment.amountJmd,
      receivedAt: order.updatedAt,
    })));
    refunds.push(...order.refunds.map((refund) => ({
      id: refund.id,
      invoiceId,
      amountJmd: refund.amountJmd,
      refundedAt: order.updatedAt,
    })));
  });

  const parkingCases: LinkedParkingCaseFact[] = [
    {
      id: "PARK-001",
      businessOrderId: "order-demo-03",
      invoiceId: "invoice-demo-03",
      invoiceVersionId: "invoice-demo-03-v1",
      vehicleId: orderRecords.find((item) => item.id === "order-demo-03")!.vehicle.id,
      notificationDate: "2026-08-01",
      pickupDate: "2026-08-08",
      accrual: { chargeableDays: 5, originalAmountJmd: 12_500 },
      dailyRateJmd: 2_500,
      revision: 1,
      waiverHistory: [],
      waiverReasons: [],
    },
    {
      id: "PARK-002",
      businessOrderId: "order-demo-08",
      invoiceId: "invoice-demo-08",
      invoiceVersionId: "invoice-demo-08-v1",
      vehicleId: orderRecords.find((item) => item.id === "order-demo-08")!.vehicle.id,
      // 动态通知日：今天-33 天 → (33-3)%3=0，永远"今日该发账单"（防日期滚动）
      notificationDate: parkingLocalCalendarDate(-33),
      accrual: { chargeableDays: 25, originalAmountJmd: 62_500 },
      dailyRateJmd: 2_500,
      revision: 1,
      waiverHistory: [],
      waiverReasons: [],
    },
  ];

  // These demo invoices predate the v8 parking-projection coordinates. Keep
  // their charges visible and inert until Task 8 explicitly claims/reissues
  // them; never leave an effective parking charge in an untracked state.
  const seedParkingUnresolved: LinkedLegacyChargeRecord[] = [];
  for (const parking of parkingCases) {
    const invoice = invoices.find((candidate) => candidate.id === parking.invoiceId);
    const version = invoice?.versions.find((candidate) => candidate.id === parking.invoiceVersionId);
    const line = version?.chargeContract === "shared_v1"
      ? undefined
      : version?.lines.find((candidate) => candidate.code === "parking_overtime") as unknown as
      | Record<string, unknown>
      | undefined;
    if (!invoice || !version || !line) throw new Error(`seed parking lineage missing: ${parking.id}`);
    seedParkingUnresolved.push({
      id: `legacy-seed-${version.id}-${String(line.id)}`,
      status: "legacy_parking_unlinked",
      invoiceId: invoice.id,
      invoiceVersionId: version.id,
      amountJmd: legacyParkingAmount(line),
      original: clone(line),
    });
    const businessOrder = businessOrders.find((candidate) => candidate.id === invoice.businessOrderId);
    inspectionReports.filter((report) => report.vehicleId === businessOrder?.vehicleId).forEach((report) => {
      report.categoryReviewRequired = true;
    });
  }

  const cleanSeedHash = exactSourceHash(stableJson({
    contract: CLEAN_DEMO_STATE_CONTRACT,
    inspectionReportIds: inspectionReports.map((report) => report.id),
    quickOrderIds: seedQuickOrders().map((order) => order.id),
  }));
  const protectionAnchor = `${CLEAN_DEMO_STATE_CONTRACT}:${cleanSeedHash}`;
  const legacyParkingOrigins = deriveLegacyParkingOrigins(parkingCases, [], invoices);
  const state: LinkedOperationsState = {
    schemaVersion: LINKED_OPERATIONS_SCHEMA_VERSION,
    billingSnapshotVersion: 1,
    customerContactSnapshotVersion: 1,
    reportPhotoStorageVersion: 2,
    legacyPhotoManifestHash: exactSourceHash(stableJson({ entries: [] })),
    revision: 1,
    protectionAnchor,
    quickOrders: seedQuickOrders(),
    trustedIdentities,
    customers,
    vehicles,
    orderRecords,
    businessOrders,
    inspectionReports,
    inspectionItems,
    quotations,
    quotationItems,
    currentQuotations,
    quotedChargeLines,
    reportAttachments,
    reportAttachmentAuditEvents: [],
    legacyIrHistory: {
      sourceSchemaVersion: LINKED_OPERATIONS_SCHEMA_VERSION,
      inspectionReports: [],
      inspectionItems: [],
      quotations: [],
      quotationItems: [],
    },
    legacyChargeRecords: seedParkingUnresolved,
    generationEvents: [],
    communicationEvents: [],
    responseEvents: [],
    discountSignatureEvents: [],
    mutationReceipts: [],
    billingAuditEvents: [],
    billingDocumentSequences: deriveBillingDocumentSequences(invoices),
    legacyRefundOccupancies: [],
    legacyParkingOrigins,
    legacyParkingOriginsCommitment: legacyParkingOriginsCommitment(legacyParkingOrigins),
    parkingSourceOrigins: [],
    activeParkingClaim: {},
    invoices,
    invoiceFileHashes,
    payments,
    refunds,
    parkingCases,
    parkingWaiverPreviews: [],
    parkingWaiverAudits: [],
    communications: [],
    invoiceAcknowledgements: [],
    specialReleaseAuthorizations: [],
    reassignments: [],
    performanceAudits: [],
    operationsDocuments: [],
    operationsAssignments: [],
  };
  state.operationsDocuments = deriveOperationsDocuments(state);
  state.operationsAssignments = deriveOperationsAssignments(state);
  validateLinkedOperationsState(state);
  return { state };
}

function rawLinkedScenario(): LinkedOperationsFaults {
  if (typeof window === "undefined") return {};
  const value = (window as Window & {
    __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: LinkedOperationsFaults;
  }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__;
  return value && typeof value === "object" ? value : {};
}

function linkedNowMs(): number {
  return rawLinkedScenario().nowMs ?? Date.now();
}

function uniqueIds(items: ReadonlyArray<{ id: string }>): boolean {
  return items.every((item) => typeof item.id === "string" && item.id.length > 0)
    && new Set(items.map((item) => item.id)).size === items.length;
}

function sameTotals(
  left: ReturnType<typeof calculateInvoiceTotals>,
  right: ReturnType<typeof calculateInvoiceTotals>,
): boolean {
  return left.laborJmd === right.laborJmd
    && left.partsJmd === right.partsJmd
    && left.otherServiceJmd === right.otherServiceJmd
    && left.adjustmentsJmd === right.adjustmentsJmd
    && left.totalJmd === right.totalJmd;
}

export class LinkedStateInvariantError extends Error {
  constructor(public readonly code: string, public readonly path: string) {
    super(`canonical state invariant ${code} at ${path}`);
    this.name = "LinkedStateInvariantError";
  }
}

function stateInvariant(condition: unknown, code: string, path: string): asserts condition {
  if (!condition) throw new LinkedStateInvariantError(code, path);
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isJamaicaInstant(value: unknown): value is string {
  return isValidIsoTimestamp(value) && value.endsWith("-05:00");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactEnumerableDataFields(
  value: unknown,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      return false;
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  return true;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

const BILLING_ACTIVATION_AUDIT_FIELDS = new Set([
  "id", "operation", "mutationId", "invoiceId", "invoiceNo", "invoiceVersionId", "snapshotCommitment",
  "actorId", "actorName", "recordedAt",
]);
const BILLING_REFUND_AUDIT_FIELDS = new Set([
  "id", "operation", "mutationId", "invoiceId", "invoiceVersionId", "actorId", "actorName", "recordedAt",
  "refundId", "chargeLineId", "receivableReductionJmd", "cashRefundJmd",
]);
const BILLING_PAYMENT_AUDIT_FIELDS = new Set([
  "id", "operation", "mutationId", "invoiceId", "invoiceVersionId", "actorId", "actorName", "recordedAt",
  "paymentId", "amountJmd", "method", "note", "committedRevision",
]);
const BILLING_PARKING_REPROJECTION_AUDIT_FIELDS = new Set([
  "id", "operation", "reprojectionKind", "mutationId", "invoiceId", "previousInvoiceVersionId",
  "invoiceVersionId", "snapshotCommitment", "parkingCaseId", "chargeLineId", "sourceRevisionBefore",
  "sourceRevisionAfter", "oldParkingAmountJmd", "newParkingAmountJmd", "parkingDeltaJmd",
  "parkingCashRefundJmd", "committedRevision", "actorId", "actorName", "recordedAt",
]);
const BILLING_ACTIVATION_PAYLOAD_FIELDS = new Set([
  "orderId", "expectedRevision", "mutationId", "adjustments", "signature",
]);
const BILLING_REFUND_PAYLOAD_FIELDS = new Set([
  "logicalInvoiceId", "invoiceVersionId", "chargeLineId", "refundQuantity", "wholeLine",
  "method", "reason", "expectedRevision", "mutationId",
]);
const BILLING_PAYMENT_PAYLOAD_FIELDS = new Set([
  "invoiceId", "expectedRevision", "mutationId", "amountJmd", "method", "note",
]);
const PARKING_PAYMENT_COMMON_PAYLOAD_FIELDS = [
  "contract", "status", "caseId", "expectedRevision", "expectedSourceRevision", "mutationId",
  "amountJmd", "method",
] as const;
const PARKING_PAYMENT_CLAIMED_PAYLOAD_FIELDS = new Set([
  ...PARKING_PAYMENT_COMMON_PAYLOAD_FIELDS, "note", "invoiceId", "effectiveVersionId", "balanceJmd",
]);
const PARKING_PAYMENT_UNCLAIMED_PAYLOAD_FIELDS = new Set([
  ...PARKING_PAYMENT_COMMON_PAYLOAD_FIELDS, "note", "carrierBusinessOrderId", "sourceProjections",
  "invoiceSignature",
]);
const PARKING_PAYMENT_SOURCE_PROJECTION_FIELDS = new Set(["caseId", "projectionCommitment"]);
const PARKING_PAYMENT_RECEIPT_RESULT_FIELDS = new Set([
  "receiptContract", "activationChildMutationId", "paymentChildMutationId", "publicResult",
]);
const PARKING_PAYMENT_PUBLIC_RESULT_FIELDS = new Set([
  "revision", "caseId", "claim", "activatedInvoice", "sourceTransitions", "payment", "financial",
]);
const PARKING_PAYMENT_PUBLIC_CLAIM_FIELDS = new Set([
  "caseId", "invoiceId", "effectiveVersionId", "chargeLineId",
]);
const PARKING_PAYMENT_PUBLIC_ACTIVATED_INVOICE_FIELDS = new Set([
  "invoiceId", "invoiceNo", "effectiveVersionId", "version", "snapshotCommitment",
]);
const PARKING_PAYMENT_PUBLIC_PAYMENT_FIELDS = new Set([
  "id", "invoiceId", "effectiveVersionId", "amountJmd", "method", "note", "receivedAt", "receivedBy",
]);
const PARKING_PAYMENT_PUBLIC_FINANCIAL_FIELDS = new Set([
  "receivableJmd", "grossPaidJmd", "cashRefundedJmd", "netPaidJmd", "balanceJmd", "status",
]);
const PARKING_SOURCE_CREATE_PAYLOAD_FIELDS = new Set([
  "orderId", "expectedRevision", "mutationId", "channels",
]);
const PARKING_SOURCE_CREATE_RESULT_FIELDS = new Set([
  "revision", "orderId", "pickupNotice", "parkingSource",
]);
const PARKING_SOURCE_PICKUP_PAYLOAD_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId",
]);
const PARKING_SOURCE_PICKUP_RESULT_FIELDS = new Set([
  "revision", "caseId", "sourceRevision", "sourceBefore", "parkingSource", "invoiceId",
  "previousInvoiceVersionId", "invoiceVersionId", "snapshotCommitment", "parkingDeltaJmd",
  "parkingCashRefundJmd", "actorId", "actorName",
]);
const PARKING_SOURCE_PREVIEW_PAYLOAD_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "waiveDays", "reason",
]);
const PARKING_SOURCE_CORRECTION_PAYLOAD_FIELDS = new Set([
  "caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "previewToken",
  "refundMethod", "administratorId", "administratorSignature", "invoiceSignature",
]);
const PARKING_SOURCE_CORRECTION_RESULT_FIELDS = new Set([
  "revision", "caseId", "sourceRevision", "invoiceId", "invoiceVersionId",
  "parkingDeltaJmd", "parkingCashRefundJmd", "parkingSource",
]);
const PARKING_SOURCE_TRANSITION_FIELDS = new Set(["caseId", "sourceBefore", "parkingSource"]);
const PARKING_SOURCE_ORIGIN_FIELDS = new Set([
  "originContract", "id", "mutationId", "committedRevision", "committedAt",
  "originBusinessOrderId", "eligibleBusinessOrderIds", "vehicleId", "customerId",
  "initialSource", "commitment",
]);
const PARKING_PICKUP_NOTICE_FIELDS = new Set(["notifiedAt", "notifiedBy", "channels"]);
const PARKING_PICKUP_INPUT_CHANNEL_FIELDS = new Set(["kind", "language", "text"]);
const PARKING_PICKUP_RESULT_CHANNEL_FIELDS = new Set(["id", "kind", "language", "text", "sentBy", "sentAt"]);
const PARKING_COMMON_FIELDS = [
  "id", "vehicleId", "notificationDate", "pickupDate", "accrual",
  "dailyRateJmd", "revision", "waiverHistory", "waiverReasons",
] as const;
const LEGACY_PARKING_FIELDS = new Set([
  ...PARKING_COMMON_FIELDS, "businessOrderId", "invoiceId", "invoiceVersionId",
]);
const MODERN_PARKING_SOURCE_FIELDS = new Set([
  ...PARKING_COMMON_FIELDS, "parkingContract", "originBusinessOrderId", "eligibleBusinessOrderIds", "asOf",
]);
const MODERN_PARKING_SOURCE_REQUIRED_FIELDS = new Set(
  [...MODERN_PARKING_SOURCE_FIELDS].filter((field) => field !== "pickupDate"),
);
const PARKING_ACCRUAL_FIELDS = new Set(["chargeableDays", "originalAmountJmd"]);
const PARKING_WAIVER_FIELDS = new Set([
  "caseId", "originalChargeableDays", "originalAmountJmd", "existingWaivedDays",
  "existingWaivedAmountJmd", "proposedWaivedDays", "proposedWaivedAmountJmd",
  "cumulativeWaivedDays", "cumulativeWaivedAmountJmd", "requiresAdministratorSignature",
  "finalChargeableDays", "finalAmountJmd",
]);
const PARKING_SOURCE_PREVIEW_RESULT_FIELDS = new Set([
  ...PARKING_WAIVER_FIELDS,
  "sourceRevision", "previewToken", "expiresAt", "latestRevision", "nextSourceRevision", "sourceAsOf",
  "parkingAdministratorSignatureRequired", "invoiceSignatureRequired", "claimedInvoiceId",
  "claimedInvoiceVersionId", "nextInvoiceVersionId", "nextSnapshotCommitment", "parkingDeltaJmd",
  "parkingCashRefundJmd", "sourceBefore", "parkingSource",
]);
const MODERN_PARKING_WAIVER_DECISION_FIELDS = new Set([
  ...PARKING_WAIVER_FIELDS, "waiverContract", "sourceRevision", "sourceAsOf",
]);
const MODERN_PARKING_PREVIEW_TOKEN_FIELDS = new Set([
  "id", "previewContract", "previewMutationId", "caseId", "sourceRevision", "sourceStored", "sourceBefore",
  "nextParkingSource", "waiveDays", "reason", "decision", "claim", "ledgerHighWaterRevision",
  "nextInvoiceVersion", "nextSnapshotCommitment", "oldParkingAmountJmd", "newParkingAmountJmd",
  "parkingDeltaJmd", "parkingCashRefundJmd", "parkingAdministratorSignatureRequired",
  "invoiceSignatureRequired", "issuedAt", "expiresAt", "consumedAt",
]);
const MODERN_PARKING_PREVIEW_TOKEN_REQUIRED_FIELDS = new Set(
  [...MODERN_PARKING_PREVIEW_TOKEN_FIELDS].filter((field) => field !== "consumedAt"),
);
const ACTIVE_PARKING_CLAIM_FIELDS = new Set([
  "logicalInvoiceId", "financiallyEffectiveVersionId", "chargeLineId",
]);
const MODERN_PARKING_WAIVER_AUDIT_FIELDS = new Set([
  "id", "auditContract", "mutationId", "caseId", "sourceRevision", "sourceAsOf", "reason", "actorId",
  "administratorId", "administratorSignature", "appliedAt", "preview",
]);
const MODERN_PARKING_WAIVER_AUDIT_REQUIRED_FIELDS = new Set(
  [...MODERN_PARKING_WAIVER_AUDIT_FIELDS].filter((field) => (
    field !== "administratorId" && field !== "administratorSignature"
  )),
);
const LEGACY_PARKING_ORIGIN_FIELDS = new Set(["id", "parking", "waiverAudits", "ownerInvoice"]);
const MODERN_PAYMENT_FIELDS = new Set([
  "id", "paymentContract", "invoiceId", "invoiceVersionId", "amountJmd", "receivedAt", "method", "receivedBy",
  "receivedById", "note", "mutationId", "committedRevision",
]);
const LEGACY_PAYMENT_FIELDS = new Set([
  "id", "invoiceId", "amountJmd", "receivedAt", "method", "receivedBy", "note",
]);

function billingStateSum(values: ReadonlyArray<number>, code: string, path: string): number {
  let total = 0;
  for (const value of values) {
    stateInvariant(Number.isSafeInteger(value) && value >= 0, code, path);
    total += value;
    stateInvariant(Number.isSafeInteger(total), code, path);
  }
  return total;
}

const BILLING_INVOICE_NUMBER_PATTERN = /^KGN-WH-INV-(\d{8})(\d{5})$/u;

function billingDocumentSequenceId(businessDate: string): string {
  return `invoice:KGN:WH:${businessDate}`;
}

function deriveBillingDocumentSequences(
  invoices: ReadonlyArray<Invoice>,
): LinkedBillingDocumentSequence[] {
  const maximumByDate = new Map<string, number>();
  for (const invoice of invoices) {
    const match = BILLING_INVOICE_NUMBER_PATTERN.exec(invoice.invoiceNo);
    if (!match) continue;
    const businessDate = match[1];
    const sequence = Number(match[2]);
    if (sequence < 10_000 || sequence > 99_999) continue;
    maximumByDate.set(businessDate, Math.max(maximumByDate.get(businessDate) ?? 9_999, sequence));
  }
  return [...maximumByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([
    businessDate,
    lastAllocated,
  ]) => ({
    id: billingDocumentSequenceId(businessDate),
    kind: "invoice" as const,
    branchCode: "KGN" as const,
    brandCode: "WH" as const,
    businessDate,
    lastAllocated,
  }));
}

function billingReceiptPayload(receipt: LinkedMutationReceipt, code: string, path: string): Record<string, unknown> {
  stateInvariant(typeof receipt.payloadCanonical === "string", code, `${path}.payloadCanonical`);
  let payload: unknown;
  try {
    payload = JSON.parse(receipt.payloadCanonical);
  } catch {
    stateInvariant(false, code, `${path}.payloadCanonical`);
  }
  stateInvariant(isPlainRecord(payload), code, `${path}.payloadCanonical`);
  stateInvariant(receipt.payloadHash === stableSourceHash(receipt.payloadCanonical), code, `${path}.payloadHash`);
  return payload;
}

const QUICK_ORDER_LIFECYCLE_OUTER_RECEIPT_FIELDS = new Set([
  "id", "mutationId", "operation", "actorId", "payloadHash", "payloadCanonical",
  "result", "committedRevision", "committedAt",
]);
const QUICK_ORDER_LIFECYCLE_INTERNAL_RECEIPT_V1_FIELDS = new Set([
  "receiptContract", "actor", "changes", "publicResult",
]);
const QUICK_ORDER_LIFECYCLE_INTERNAL_RECEIPT_V2_FIELDS = new Set([
  "receiptContract", "actor", "changes", "financialSnapshot", "publicResult",
]);
const QUICK_ORDER_LIFECYCLE_PUBLIC_RESULT_V1_FIELDS = new Set([
  "contract", "revision", "kind", "orderId", "affectedOrderIds", "committedAt", "financial",
]);
const QUICK_ORDER_LIFECYCLE_ACTOR_FIELDS = new Set(["id", "name", "role"]);
const QUICK_ORDER_LIFECYCLE_CHANGE_FIELDS = new Set(["orderId", "before", "after", "event"]);
const QUICK_ORDER_LIFECYCLE_COORDINATE_FIELDS = new Set([
  "status", "voidedAt", "voidedBy", "voidReason", "paidInFullAt", "paidInFullBy",
]);
const QUICK_ORDER_LIFECYCLE_EVENT_FIELDS = new Set([
  "id", "from", "to", "by", "byRole", "at", "reason",
]);
const QUICK_ORDER_LIFECYCLE_KINDS = new Set<QuickOrderLifecycleKind>([
  "void", "restore", "record_paid_full", "cancel_paid_full",
]);
const QUICK_ORDER_LIFECYCLE_STATUSES = new Set<QuickBoStatus>([
  "pending_assign", "assigned", "in_repair", "stalled", "returned", "submitted",
]);

type QuickOrderLifecycleReceiptActor = Readonly<{
  id: string;
  name: string;
  role: "superadmin" | "frontdesk_admin" | "finance" | "mechanic";
}>;

type QuickOrderLifecycleCoordinate = Readonly<{
  status: QuickBoStatus;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  paidInFullAt: string | null;
  paidInFullBy: string | null;
}>;

type QuickOrderLifecycleReceiptEvent = Readonly<{
  id: string;
  from: QuickBoStatus | null;
  to: QuickBoStatus;
  by: string;
  byRole: "frontdesk" | "mechanic" | "system";
  at: string;
  reason: string | null;
}>;

type QuickOrderLifecycleReceiptChange = Readonly<{
  orderId: string;
  before: QuickOrderLifecycleCoordinate;
  after: QuickOrderLifecycleCoordinate;
  event: QuickOrderLifecycleReceiptEvent;
}>;

function isExactDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return false;
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) return false;
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) return false;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      return false;
    }
  }
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, String(index))) return false;
  }
  return true;
}

function isQuickOrderLifecycleReceiptCandidate(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const operationDescriptor = Object.getOwnPropertyDescriptor(value, "operation");
  if (operationDescriptor && "value" in operationDescriptor
    && typeof operationDescriptor.value === "string"
    && operationDescriptor.value.startsWith("quickOrders.lifecycle.")) return true;

  const resultDescriptor = Object.getOwnPropertyDescriptor(value, "result");
  if (resultDescriptor && "value" in resultDescriptor
    && resultDescriptor.value !== null && typeof resultDescriptor.value === "object"
    && !Array.isArray(resultDescriptor.value)) {
    const contractDescriptor = Object.getOwnPropertyDescriptor(resultDescriptor.value, "receiptContract");
    if (contractDescriptor && "value" in contractDescriptor
      && typeof contractDescriptor.value === "string"
      && contractDescriptor.value.startsWith("quick_order_lifecycle_receipt_")) return true;
  }

  const payloadDescriptor = Object.getOwnPropertyDescriptor(value, "payloadCanonical");
  if (payloadDescriptor && "value" in payloadDescriptor && typeof payloadDescriptor.value === "string") {
    try {
      const payload = JSON.parse(payloadDescriptor.value) as unknown;
      const contractDescriptor = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? Object.getOwnPropertyDescriptor(payload, "contract")
        : undefined;
      return Boolean(contractDescriptor && "value" in contractDescriptor
        && contractDescriptor.value === "quick_order_lifecycle_mutation_v1");
    } catch {
      return false;
    }
  }
  return false;
}

function isCanonicalUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateQuickOrderLifecycleCoordinate(
  value: unknown,
  path: string,
): QuickOrderLifecycleCoordinate {
  stateInvariant(
    hasExactEnumerableDataFields(
      value,
      QUICK_ORDER_LIFECYCLE_COORDINATE_FIELDS,
      QUICK_ORDER_LIFECYCLE_COORDINATE_FIELDS,
    ),
    "QUICK_ORDER_LIFECYCLE_COORDINATE_CLOSED",
    path,
  );
  const coordinate = value as Record<string, unknown>;
  stateInvariant(
    QUICK_ORDER_LIFECYCLE_STATUSES.has(coordinate.status as QuickBoStatus),
    "QUICK_ORDER_LIFECYCLE_COORDINATE_STATUS",
    `${path}.status`,
  );
  for (const timestampField of ["voidedAt", "paidInFullAt"] as const) {
    stateInvariant(
      coordinate[timestampField] === null || isValidIsoTimestamp(coordinate[timestampField]),
      "QUICK_ORDER_LIFECYCLE_COORDINATE_TIME",
      `${path}.${timestampField}`,
    );
  }
  for (const actorField of ["voidedBy", "voidReason", "paidInFullBy"] as const) {
    stateInvariant(
      coordinate[actorField] === null
        || (typeof coordinate[actorField] === "string" && coordinate[actorField].trim().length > 0),
      "QUICK_ORDER_LIFECYCLE_COORDINATE_TEXT",
      `${path}.${actorField}`,
    );
  }
  stateInvariant(
    (coordinate.voidedAt === null
      && coordinate.voidedBy === null
      && coordinate.voidReason === null)
      || (typeof coordinate.voidedAt === "string"
        && typeof coordinate.voidedBy === "string"
        && typeof coordinate.voidReason === "string"),
    "QUICK_ORDER_LIFECYCLE_COORDINATE_VOID_PAIR",
    path,
  );
  stateInvariant(
    (coordinate.paidInFullAt === null && coordinate.paidInFullBy === null)
      || (typeof coordinate.paidInFullAt === "string" && typeof coordinate.paidInFullBy === "string"),
    "QUICK_ORDER_LIFECYCLE_COORDINATE_PAID_PAIR",
    path,
  );
  return coordinate as unknown as QuickOrderLifecycleCoordinate;
}

function validateQuickOrderLifecycleReceiptEvent(
  value: unknown,
  path: string,
): QuickOrderLifecycleReceiptEvent {
  stateInvariant(
    hasExactEnumerableDataFields(
      value,
      QUICK_ORDER_LIFECYCLE_EVENT_FIELDS,
      QUICK_ORDER_LIFECYCLE_EVENT_FIELDS,
    ),
    "QUICK_ORDER_LIFECYCLE_EVENT_CLOSED",
    path,
  );
  const event = value as Record<string, unknown>;
  stateInvariant(
    typeof event.id === "string" && event.id.trim().length > 0,
    "QUICK_ORDER_LIFECYCLE_EVENT_ID",
    `${path}.id`,
  );
  stateInvariant(
    event.from === null || QUICK_ORDER_LIFECYCLE_STATUSES.has(event.from as QuickBoStatus),
    "QUICK_ORDER_LIFECYCLE_EVENT_STATUS",
    `${path}.from`,
  );
  stateInvariant(
    QUICK_ORDER_LIFECYCLE_STATUSES.has(event.to as QuickBoStatus),
    "QUICK_ORDER_LIFECYCLE_EVENT_STATUS",
    `${path}.to`,
  );
  stateInvariant(
    typeof event.by === "string" && event.by.trim().length > 0,
    "QUICK_ORDER_LIFECYCLE_EVENT_ACTOR",
    `${path}.by`,
  );
  stateInvariant(
    event.byRole === "frontdesk" || event.byRole === "mechanic" || event.byRole === "system",
    "QUICK_ORDER_LIFECYCLE_EVENT_ROLE",
    `${path}.byRole`,
  );
  stateInvariant(isCanonicalUtcInstant(event.at), "QUICK_ORDER_LIFECYCLE_EVENT_TIME", `${path}.at`);
  stateInvariant(
    event.reason === null || (typeof event.reason === "string" && event.reason.trim().length > 0),
    "QUICK_ORDER_LIFECYCLE_EVENT_REASON",
    `${path}.reason`,
  );
  return event as unknown as QuickOrderLifecycleReceiptEvent;
}

function quickOrderLifecycleCoordinate(order: QuickOrder): QuickOrderLifecycleCoordinate {
  return {
    status: order.status,
    voidedAt: order.voidedAt,
    voidedBy: order.voidedBy,
    voidReason: order.voidReason,
    paidInFullAt: order.paidInFullAt,
    paidInFullBy: order.paidInFullBy,
  };
}

function sharedInvoiceVersionCommittedRevision(
  state: LinkedOperationsState,
  invoice: SharedChargeInvoice,
  version: SharedChargeInvoiceVersion,
  path: string,
): number {
  const producers = state.billingAuditEvents.filter((event): event is LinkedInvoiceActivationAudit | LinkedParkingInvoiceReprojectionAudit => (
    (event.operation === "invoice_activation" || event.operation === "parking_invoice_reprojection")
      && event.invoiceId === invoice.id
      && event.invoiceVersionId === version.id
  ));
  stateInvariant(producers.length === 1, "QUICK_ORDER_LIFECYCLE_FINANCIAL_VERSION_PRODUCER", path);
  const producer = producers[0]!;
  const operation = producer.operation === "invoice_activation"
    ? "billing.invoice.activate"
    : producer.reprojectionKind === "waiver_correction"
      ? "parking.source.correct"
      : "parking.source.pickup";
  const receipts = state.mutationReceipts.filter((candidate) => (
    candidate.operation === operation && candidate.mutationId === producer.mutationId
  ));
  stateInvariant(receipts.length === 1, "QUICK_ORDER_LIFECYCLE_FINANCIAL_VERSION_RECEIPT", path);
  const committedRevision = receipts[0]!.committedRevision;
  stateInvariant(
    Number.isSafeInteger(committedRevision)
      && committedRevision > 0
      && (producer.operation !== "parking_invoice_reprojection"
        || producer.committedRevision === committedRevision),
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_VERSION_REVISION",
    path,
  );
  return committedRevision;
}

function ordinaryRefundCommittedRevision(
  state: LinkedOperationsState,
  refund: LinkedOrdinaryInvoiceRefundFact,
  path: string,
): number {
  const receipts = state.mutationReceipts.filter((candidate) => (
    candidate.operation === "billing.invoice.lineRefund" && candidate.mutationId === refund.mutationId
  ));
  stateInvariant(receipts.length === 1, "QUICK_ORDER_LIFECYCLE_FINANCIAL_REFUND_RECEIPT", path);
  return receipts[0]!.committedRevision;
}

function canonicalFinancialLedgerAtRevision(
  state: LinkedOperationsState,
  invoice: SharedChargeInvoice,
  version: SharedChargeInvoiceVersion,
  committedRevision: number,
  path: string,
): QuickOrderFinancialReadModel["ledger"] {
  const payments = state.payments.filter((payment): payment is ModernInvoicePaymentFact => (
    isModernInvoicePaymentFact(payment)
      && payment.invoiceId === invoice.id
      && payment.committedRevision <= committedRevision
  ));
  const refunds = state.refunds.filter((refund) => {
    if (refundLogicalInvoiceId(refund) !== invoice.id) return false;
    return refund.refundContract !== "ordinary_line_v1"
      || ordinaryRefundCommittedRevision(state, refund, `${path}.refunds.${refund.id}`) <= committedRevision;
  });
  const invoiceTotalJmd = invoiceVersionTotalJmd(version);
  const grossPaidJmd = billingStateSum(
    payments.map((payment) => payment.amountJmd),
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_PAYMENT_AMOUNT",
    path,
  );
  const cashRefundedJmd = billingStateSum(
    refunds.map(refundCashAmountJmd),
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_REFUND_AMOUNT",
    path,
  );
  const receivableReductionJmd = billingStateSum(
    refunds.map(refundReceivableReductionJmd),
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_REDUCTION_AMOUNT",
    path,
  );
  const netPaidJmd = grossPaidJmd - cashRefundedJmd;
  const receivableJmd = invoiceTotalJmd - receivableReductionJmd;
  const balanceJmd = receivableJmd - netPaidJmd;
  stateInvariant(
    Number.isSafeInteger(netPaidJmd)
      && netPaidJmd >= 0
      && Number.isSafeInteger(receivableJmd)
      && receivableJmd >= 0
      && Number.isSafeInteger(balanceJmd),
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_LEDGER",
    path,
  );
  return {
    invoiceTotalJmd,
    receivableJmd,
    grossPaidJmd,
    cashRefundedJmd,
    receivableReductionJmd,
    netPaidJmd,
    balanceJmd,
    paymentStatus: netPaidJmd <= 0
      ? "unpaid"
      : netPaidJmd < receivableJmd
        ? "partially_paid"
        : "paid",
    settlementStatus: balanceJmd > 0 ? "due" : balanceJmd < 0 ? "overpaid" : "settled",
    hasPaymentHistory: payments.length > 0,
  };
}

function canonicalFinancialSourceAtRevision(
  state: LinkedOperationsState,
  target: QuickOrder,
  committedRevision: number,
  path: string,
): Readonly<{
  invoice: SharedChargeInvoice;
  version: SharedChargeInvoiceVersion;
}> | null {
  const owners = state.invoices.filter((candidate) => candidate.businessOrderId === target.id);
  stateInvariant(
    owners.length <= 1 && (owners.length === 0 || isSharedChargeInvoice(owners[0]!)),
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_OWNER",
    path,
  );
  if (owners.length === 0) return null;
  const invoice = owners[0]! as SharedChargeInvoice;
  let effective: SharedChargeInvoiceVersion | undefined;
  let previousRevision = 0;
  for (const version of invoice.versions) {
    const versionRevision = sharedInvoiceVersionCommittedRevision(
      state,
      invoice,
      version,
      `${path}.versions.${version.id}`,
    );
    stateInvariant(
      versionRevision > previousRevision,
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_VERSION_ORDER",
      `${path}.versions.${version.id}`,
    );
    previousRevision = versionRevision;
    if (versionRevision <= committedRevision) effective = version;
  }
  return effective === undefined ? null : { invoice, version: effective };
}

function validateQuickOrderLifecycleFinancialSnapshot(
  state: LinkedOperationsState,
  value: unknown,
  receipt: LinkedMutationReceipt,
  target: QuickOrder,
  targetChange: QuickOrderLifecycleReceiptChange,
  path: string,
): QuickOrderFinancialReadModel {
  try {
    assertQuickOrderFinancialReadModel(value);
  } catch {
    stateInvariant(false, "QUICK_ORDER_LIFECYCLE_FINANCIAL_SNAPSHOT", path);
  }
  const financial = value as QuickOrderFinancialReadModel;
  stateInvariant(
    financial.revision === receipt.committedRevision
      && financial.order.id === target.id
      && financial.order.businessOrderNo === target.businessOrderNo
      && financial.order.customerId === target.customerId
      && financial.order.vehicleId === target.vehicleId
      && financial.order.status === targetChange.after.status
      && financial.order.voidedAt === targetChange.after.voidedAt
      && financial.order.pickedUpAt === target.pickedUpAt
      && financial.order.paidInFullAt === targetChange.after.paidInFullAt,
    "QUICK_ORDER_LIFECYCLE_FINANCIAL_SNAPSHOT",
    `${path}.order`,
  );
  const source = financial.source;
  if (source.kind === "legacy_quick") {
    stateInvariant(
      !isSharedChargeQuickOrder(target),
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_SOURCE",
      `${path}.source`,
    );
  } else {
    stateInvariant(
      isSharedChargeQuickOrder(target),
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_SOURCE",
      `${path}.source`,
    );
    const canonical = canonicalFinancialSourceAtRevision(
      state,
      target,
      receipt.committedRevision,
      `${path}.source`,
    );
    if (source.kind === "shared_uninvoiced") {
      stateInvariant(
        canonical === null,
        "QUICK_ORDER_LIFECYCLE_FINANCIAL_SOURCE",
        `${path}.source`,
      );
      return financial;
    }
    stateInvariant(
      canonical !== null,
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_SOURCE",
      `${path}.source`,
    );
    const { invoice, version } = canonical!;
    stateInvariant(
      invoice.id === source.invoiceId
        && invoice.invoiceNo === source.invoiceNo,
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_SOURCE",
      `${path}.source`,
    );
    stateInvariant(
      version.id === source.effectiveVersionId
        && version.version === source.versionNo
        && version.snapshotCommitment === source.snapshotCommitment,
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_SOURCE",
      `${path}.source`,
    );
    const expectedLedger = canonicalFinancialLedgerAtRevision(
      state,
      invoice,
      version,
      receipt.committedRevision,
      `${path}.ledger`,
    );
    stateInvariant(
      stableJson(financial.ledger) === stableJson(expectedLedger),
      "QUICK_ORDER_LIFECYCLE_FINANCIAL_LEDGER",
      `${path}.ledger`,
    );
  }
  return financial;
}

function quickOrderLifecycleEventMatches(
  stored: QuickBoStatusEvent,
  receiptEvent: QuickOrderLifecycleReceiptEvent,
): boolean {
  return stored.id === receiptEvent.id
    && stored.from === receiptEvent.from
    && stored.to === receiptEvent.to
    && stored.by === receiptEvent.by
    && stored.byRole === receiptEvent.byRole
    && stored.at === receiptEvent.at
    && (stored.reason ?? null) === receiptEvent.reason;
}

type ValidatedQuickOrderLifecycleChange = Readonly<{
  kind: QuickOrderLifecycleKind;
  targetOrderId: string;
  receiptId: string;
  receiptIndex: number;
  committedRevision: number;
  eventIndex: number;
  order: QuickOrder;
  change: QuickOrderLifecycleReceiptChange;
  path: string;
}>;

type ValidatedQuickOrderLifecycleReceipt = Readonly<{
  kind: QuickOrderLifecycleKind;
  targetOrderId: string;
  receiptId: string;
  receiptIndex: number;
  committedRevision: number;
  committedAt: string;
  actor: QuickOrderLifecycleReceiptActor;
  claimedOrderIds: ReadonlyArray<string>;
  publicAffectedOrderIds: ReadonlyArray<string>;
  path: string;
}>;

function sameQuickOrderLifecycleFamilyCoordinate(
  family: "void" | "paid",
  left: QuickOrderLifecycleCoordinate,
  right: QuickOrderLifecycleCoordinate,
): boolean {
  return family === "void"
    ? left.voidedAt === right.voidedAt
      && left.voidedBy === right.voidedBy
      && left.voidReason === right.voidReason
    : left.paidInFullAt === right.paidInFullAt
      && left.paidInFullBy === right.paidInFullBy;
}

function validateQuickOrderLifecycleReceiptChains(
  verifiedChanges: ReadonlyArray<ValidatedQuickOrderLifecycleChange>,
): void {
  const changesByOrderId = new Map<string, ValidatedQuickOrderLifecycleChange[]>();
  verifiedChanges.forEach((verified) => {
    const changes = changesByOrderId.get(verified.order.id) ?? [];
    changes.push(verified);
    changesByOrderId.set(verified.order.id, changes);
  });

  changesByOrderId.forEach((changes) => {
    const eventOwnerReceiptIds = new Map<string, string>();
    const ordered = [...changes].sort((left, right) => left.eventIndex - right.eventIndex);
    ordered.forEach((change) => {
      stateInvariant(
        !eventOwnerReceiptIds.has(change.change.event.id),
        "QUICK_ORDER_LIFECYCLE_EVENT_RECEIPT_UNIQUE",
        `${change.path}.event.id`,
      );
      eventOwnerReceiptIds.set(change.change.event.id, change.receiptId);
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      stateInvariant(
        previous.eventIndex < current.eventIndex
          && previous.committedRevision < current.committedRevision
          && previous.receiptIndex < current.receiptIndex,
        "QUICK_ORDER_LIFECYCLE_RECEIPT_CHRONOLOGY",
        current.path,
      );
    }

    for (const family of ["void", "paid"] as const) {
      const familyChanges = ordered.filter(({ kind }) => (
        family === "void"
          ? kind === "void" || kind === "restore"
          : kind === "record_paid_full" || kind === "cancel_paid_full"
      ));
      if (familyChanges.length === 0) continue;
      for (let index = 1; index < familyChanges.length; index += 1) {
        const previous = familyChanges[index - 1]!;
        const current = familyChanges[index]!;
        stateInvariant(
          sameQuickOrderLifecycleFamilyCoordinate(
            family,
            previous.change.after,
            current.change.before,
          ),
          "QUICK_ORDER_LIFECYCLE_FAMILY_CHAIN",
          current.path,
        );
        if (current.kind === "restore" && current.order.id !== current.targetOrderId) {
          stateInvariant(
            previous.kind === "void"
              && previous.targetOrderId === current.targetOrderId,
            "QUICK_ORDER_LIFECYCLE_RESTORE_CASCADE_PROVENANCE",
            current.path,
          );
        }
      }
      const tail = familyChanges.at(-1)!;
      stateInvariant(
        sameQuickOrderLifecycleFamilyCoordinate(
          family,
          tail.change.after,
          quickOrderLifecycleCoordinate(tail.order),
        ),
        family === "void"
          ? "QUICK_ORDER_LIFECYCLE_CURRENT_VOID_TAIL"
          : "QUICK_ORDER_LIFECYCLE_CURRENT_PAID_TAIL",
        tail.path,
      );
    }
  });
}

function validateQuickOrderLifecycleAffectedOrderCompleteness(
  state: LinkedOperationsState,
  verifiedChanges: ReadonlyArray<ValidatedQuickOrderLifecycleChange>,
  verifiedReceipts: ReadonlyArray<ValidatedQuickOrderLifecycleReceipt>,
): void {
  const voidFacts = verifiedChanges.filter(({ kind }) => kind === "void" || kind === "restore");
  const eventOwnerByOrderId = new Map<string, Map<string, ValidatedQuickOrderLifecycleChange>>();
  voidFacts.forEach((fact) => {
    const owners = eventOwnerByOrderId.get(fact.order.id) ?? new Map();
    owners.set(fact.change.event.id, fact);
    eventOwnerByOrderId.set(fact.order.id, owners);
  });

  [...verifiedReceipts]
    .sort((left, right) => left.committedRevision - right.committedRevision)
    .forEach((receipt) => {
      const target = state.quickOrders.find((order) => order.id === receipt.targetOrderId);
      stateInvariant(Boolean(target), "QUICK_ORDER_LIFECYCLE_TARGET", `${receipt.path}.payloadCanonical.orderId`);
      const cascadeReason = `关联单废除（原单 ${target!.businessOrderNo}）`;
      const expectedChildReason = receipt.kind === "void"
        ? cascadeReason
        : "恢复本单（随原单恢复）";
      const expectedByRole = receipt.actor.role === "mechanic" ? "mechanic" : "frontdesk";
      const expectedOrderIds = receipt.kind === "record_paid_full" || receipt.kind === "cancel_paid_full"
        ? [receipt.targetOrderId]
        : state.quickOrders.flatMap((order) => {
            if (order.id === receipt.targetOrderId) return [order.id];
            if (order.linkedOrderId !== receipt.targetOrderId) return [];
            const priorFact = voidFacts
              .filter((fact) => (
                fact.order.id === order.id
                  && fact.committedRevision < receipt.committedRevision
              ))
              .sort((left, right) => right.committedRevision - left.committedRevision)[0];
            if (priorFact !== undefined) {
              if (receipt.kind === "void") {
                return priorFact.change.after.voidedAt === null
                  && priorFact.change.after.voidedBy === null
                  && priorFact.change.after.voidReason === null
                  ? [order.id]
                  : [];
              }
              return priorFact.kind === "void"
                && priorFact.targetOrderId === receipt.targetOrderId
                && priorFact.change.after.voidedAt !== null
                && priorFact.change.after.voidedBy !== null
                && priorFact.change.after.voidReason === cascadeReason
                ? [order.id]
                : [];
            }

            const hasLegacyOperationEvent = order.statusHistory.some((event) => {
              if (
                event.at !== receipt.committedAt
                || event.by !== receipt.actor.name
                || event.byRole !== expectedByRole
                || event.reason !== expectedChildReason
                || event.from !== event.to
              ) return false;
              const owner = eventOwnerByOrderId.get(order.id)?.get(event.id);
              return owner === undefined || owner.receiptId === receipt.receiptId;
            });
            return hasLegacyOperationEvent ? [order.id] : [];
          });
      stateInvariant(
        stableJson(receipt.claimedOrderIds) === stableJson(expectedOrderIds)
          && stableJson(receipt.publicAffectedOrderIds) === stableJson(expectedOrderIds),
        "QUICK_ORDER_LIFECYCLE_AFFECTED_ORDER",
        `${receipt.path}.result.changes`,
      );
    });
}

function validateQuickOrderLifecycleReceiptGlobalChronology(
  verifiedReceipts: ReadonlyArray<ValidatedQuickOrderLifecycleReceipt>,
): void {
  const ordered = [...verifiedReceipts].sort((left, right) => left.receiptIndex - right.receiptIndex);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    stateInvariant(
      previous.receiptIndex < current.receiptIndex
        && previous.committedRevision < current.committedRevision,
      "QUICK_ORDER_LIFECYCLE_GLOBAL_CHRONOLOGY",
      current.path,
    );
  }
}

function validateQuickOrderLifecycleChangeSemantics(
  kind: QuickOrderLifecycleKind,
  input: QuickOrderLifecycleMutationInput,
  actor: QuickOrderLifecycleReceiptActor,
  receipt: LinkedMutationReceipt,
  target: QuickOrder,
  order: QuickOrder,
  change: QuickOrderLifecycleReceiptChange,
  path: string,
): void {
  const isTarget = order.id === target.id;
  const cascadeReason = `关联单废除（原单 ${target.businessOrderNo}）`;
  const inputVoidReason = input.kind === "void" ? input.reason : null;
  const expectedEventReason = kind === "void"
    ? isTarget ? `废除本单：${inputVoidReason}` : cascadeReason
    : kind === "restore"
      ? isTarget ? "恢复本单" : "恢复本单（随原单恢复）"
      : kind === "record_paid_full"
        ? "记录付完全款"
        : "撤销付完全款记录";
  const expectedByRole = actor.role === "mechanic" ? "mechanic" : "frontdesk";

  stateInvariant(
    change.before.status === change.after.status
      && change.event.from === change.before.status
      && change.event.to === change.after.status,
    "QUICK_ORDER_LIFECYCLE_CHANGE_STATUS",
    path,
  );
  stateInvariant(
    change.event.by === actor.name
      && change.event.byRole === expectedByRole
      && change.event.at === receipt.committedAt
      && change.event.reason === expectedEventReason,
    "QUICK_ORDER_LIFECYCLE_CHANGE_EVENT_BINDING",
    `${path}.event`,
  );

  if (kind === "void") {
    stateInvariant(
      inputVoidReason !== null
        && change.before.voidedAt === null
        && change.before.voidedBy === null
        && change.before.voidReason === null
        && change.after.voidedAt === receipt.committedAt
        && change.after.voidedBy === actor.name
        && change.after.voidReason === (isTarget ? inputVoidReason : cascadeReason)
        && change.before.paidInFullAt === change.after.paidInFullAt
        && change.before.paidInFullBy === change.after.paidInFullBy,
      "QUICK_ORDER_LIFECYCLE_VOID_INVERSE",
      path,
    );
  } else if (kind === "restore") {
    stateInvariant(
      change.before.voidedAt !== null
        && change.before.voidedBy !== null
        && change.before.voidReason !== null
        && (isTarget || change.before.voidReason === cascadeReason)
        && change.after.voidedAt === null
        && change.after.voidedBy === null
        && change.after.voidReason === null
        && change.before.paidInFullAt === change.after.paidInFullAt
        && change.before.paidInFullBy === change.after.paidInFullBy,
      "QUICK_ORDER_LIFECYCLE_RESTORE_INVERSE",
      path,
    );
  } else if (kind === "record_paid_full") {
    stateInvariant(
      change.before.status === "submitted"
        && change.before.voidedAt === null
        && change.after.voidedAt === null
        && change.before.voidedBy === change.after.voidedBy
        && change.before.voidReason === change.after.voidReason
        && change.before.paidInFullAt === null
        && change.before.paidInFullBy === null
        && change.after.paidInFullAt === receipt.committedAt
        && change.after.paidInFullBy === actor.name,
      "QUICK_ORDER_LIFECYCLE_RECORD_PAID_INVERSE",
      path,
    );
  } else {
    stateInvariant(
      change.before.status === "submitted"
        && change.before.voidedAt === null
        && change.after.voidedAt === null
        && change.before.voidedBy === change.after.voidedBy
        && change.before.voidReason === change.after.voidReason
        && change.before.paidInFullAt !== null
        && change.before.paidInFullBy !== null
        && change.after.paidInFullAt === null
        && change.after.paidInFullBy === null,
      "QUICK_ORDER_LIFECYCLE_CANCEL_PAID_INVERSE",
      path,
    );
  }

  const eventIndexes = order.statusHistory.flatMap((event, index) => (
    event.id === change.event.id ? [index] : []
  ));
  stateInvariant(eventIndexes.length === 1, "QUICK_ORDER_LIFECYCLE_CURRENT_EVENT", `${path}.event.id`);
  const eventIndex = eventIndexes[0]!;
  const storedEvent = order.statusHistory[eventIndex]!;
  stateInvariant(
    change.event.id === `${order.id}-ev-${eventIndex + 1}`
      && quickOrderLifecycleEventMatches(storedEvent, change.event),
    "QUICK_ORDER_LIFECYCLE_CURRENT_EVENT",
    `${path}.event`,
  );

  if (kind === "restore") {
    const expectedPriorReason = isTarget
      ? `废除本单：${change.before.voidReason}`
      : change.before.voidReason;
    stateInvariant(
      order.statusHistory.slice(0, eventIndex).some((event) => (
        event.at === change.before.voidedAt
          && event.by === change.before.voidedBy
          && event.reason === expectedPriorReason
      )),
      "QUICK_ORDER_LIFECYCLE_RESTORE_PRIOR_EVENT",
      `${path}.before`,
    );
  }
  if (kind === "cancel_paid_full") {
    stateInvariant(
      order.statusHistory.slice(0, eventIndex).some((event) => (
        event.at === change.before.paidInFullAt
          && event.by === change.before.paidInFullBy
          && event.reason === "记录付完全款"
      )),
      "QUICK_ORDER_LIFECYCLE_CANCEL_PAID_PRIOR_EVENT",
      `${path}.before`,
    );
  }

}

function validateQuickOrderLifecycleReceipts(
  state: LinkedOperationsState,
): ValidatedQuickOrderLifecycleChange[] {
  const verifiedChanges: ValidatedQuickOrderLifecycleChange[] = [];
  const verifiedReceipts: ValidatedQuickOrderLifecycleReceipt[] = [];
  state.mutationReceipts.forEach((receipt, receiptIndex) => {
    if (!isQuickOrderLifecycleReceiptCandidate(receipt)) return;
    const path = `$.mutationReceipts[${receiptIndex}]`;
    stateInvariant(
      hasExactEnumerableDataFields(
        receipt,
        QUICK_ORDER_LIFECYCLE_OUTER_RECEIPT_FIELDS,
        QUICK_ORDER_LIFECYCLE_OUTER_RECEIPT_FIELDS,
      ),
      "QUICK_ORDER_LIFECYCLE_OUTER_RECEIPT_CLOSED",
      path,
    );
    const outer = receipt as unknown as Record<string, unknown>;
    stateInvariant(
      typeof outer.payloadCanonical === "string" && outer.payloadCanonical.length > 0,
      "QUICK_ORDER_LIFECYCLE_PAYLOAD",
      `${path}.payloadCanonical`,
    );
    let payloadValue: unknown;
    try {
      payloadValue = JSON.parse(outer.payloadCanonical);
      assertQuickOrderLifecycleMutationInput(payloadValue);
    } catch {
      stateInvariant(false, "QUICK_ORDER_LIFECYCLE_PAYLOAD", `${path}.payloadCanonical`);
    }
    const input = payloadValue as QuickOrderLifecycleMutationInput;
    stateInvariant(
      canonicalMutationPayload(input) === outer.payloadCanonical
        && outer.payloadHash === stableSourceHash(outer.payloadCanonical),
      "QUICK_ORDER_LIFECYCLE_PAYLOAD_COMMITMENT",
      `${path}.payloadHash`,
    );
    stateInvariant(
      typeof outer.id === "string"
        && outer.id === input.mutationId
        && outer.mutationId === input.mutationId,
      "QUICK_ORDER_LIFECYCLE_MUTATION_BINDING",
      `${path}.mutationId`,
    );
    stateInvariant(
      typeof outer.operation === "string"
        && outer.operation === `quickOrders.lifecycle.${input.kind}`
        && QUICK_ORDER_LIFECYCLE_KINDS.has(input.kind),
      "QUICK_ORDER_LIFECYCLE_OPERATION_BINDING",
      `${path}.operation`,
    );
    stateInvariant(
      Number.isSafeInteger(outer.committedRevision)
        && outer.committedRevision === input.expectedRevision + 1
        && (outer.committedRevision as number) <= state.revision,
      "QUICK_ORDER_LIFECYCLE_REVISION_BINDING",
      `${path}.committedRevision`,
    );
    stateInvariant(
      isCanonicalUtcInstant(outer.committedAt),
      "QUICK_ORDER_LIFECYCLE_TIME_BINDING",
      `${path}.committedAt`,
    );

    const receiptContractDescriptor = outer.result !== null && typeof outer.result === "object"
      ? Object.getOwnPropertyDescriptor(outer.result, "receiptContract")
      : undefined;
    stateInvariant(
      Boolean(receiptContractDescriptor)
        && receiptContractDescriptor!.enumerable === true
        && "value" in receiptContractDescriptor!
        && (receiptContractDescriptor!.value === "quick_order_lifecycle_receipt_v1"
          || receiptContractDescriptor!.value === "quick_order_lifecycle_receipt_v2"),
      "QUICK_ORDER_LIFECYCLE_RECEIPT_CONTRACT",
      `${path}.result.receiptContract`,
    );
    const receiptContract = receiptContractDescriptor!.value as
      | "quick_order_lifecycle_receipt_v1"
      | "quick_order_lifecycle_receipt_v2";
    const internalFields = receiptContract === "quick_order_lifecycle_receipt_v1"
      ? QUICK_ORDER_LIFECYCLE_INTERNAL_RECEIPT_V1_FIELDS
      : QUICK_ORDER_LIFECYCLE_INTERNAL_RECEIPT_V2_FIELDS;
    stateInvariant(
      hasExactEnumerableDataFields(outer.result, internalFields, internalFields),
      "QUICK_ORDER_LIFECYCLE_INTERNAL_RECEIPT_CLOSED",
      `${path}.result`,
    );
    const internal = outer.result as Record<string, unknown>;
    stateInvariant(
      hasExactEnumerableDataFields(
        internal.actor,
        QUICK_ORDER_LIFECYCLE_ACTOR_FIELDS,
        QUICK_ORDER_LIFECYCLE_ACTOR_FIELDS,
      ),
      "QUICK_ORDER_LIFECYCLE_ACTOR_CLOSED",
      `${path}.result.actor`,
    );
    const actor = internal.actor as Record<string, unknown>;
    const roleAllowed = actor.role === "superadmin"
      || actor.role === "frontdesk_admin"
      || actor.role === "finance"
      || (actor.role === "mechanic" && (input.kind === "void" || input.kind === "restore"));
    const canonicalActor = typeof actor.id === "string" ? canonicalMockIdentitySnapshot(actor.id) : null;
    stateInvariant(
      roleAllowed
        && canonicalActor !== null
        && actor.id === canonicalActor.id
        && actor.name === canonicalActor.name
        && actor.role === canonicalActor.role
        && outer.actorId === actor.id,
      "QUICK_ORDER_LIFECYCLE_ACTOR_BINDING",
      `${path}.result.actor`,
    );
    const typedActor = actor as unknown as QuickOrderLifecycleReceiptActor;

    let financialSnapshot: unknown;
    let publicResult: QuickOrderLifecycleMutationResult;
    if (receiptContract === "quick_order_lifecycle_receipt_v1") {
      stateInvariant(
        hasExactEnumerableDataFields(
          internal.publicResult,
          QUICK_ORDER_LIFECYCLE_PUBLIC_RESULT_V1_FIELDS,
          QUICK_ORDER_LIFECYCLE_PUBLIC_RESULT_V1_FIELDS,
        ),
        "QUICK_ORDER_LIFECYCLE_PUBLIC_RESULT",
        `${path}.result.publicResult`,
      );
      const legacyPublicResult = internal.publicResult as Record<string, unknown>;
      stateInvariant(
        legacyPublicResult.contract === "quick_order_lifecycle_mutation_result_v1",
        "QUICK_ORDER_LIFECYCLE_PUBLIC_RESULT",
        `${path}.result.publicResult.contract`,
      );
      publicResult = {
        contract: "quick_order_lifecycle_mutation_result_v2",
        revision: legacyPublicResult.revision as number,
        kind: legacyPublicResult.kind as QuickOrderLifecycleKind,
        orderId: legacyPublicResult.orderId as string,
        affectedOrderIds: legacyPublicResult.affectedOrderIds as ReadonlyArray<string>,
        committedAt: legacyPublicResult.committedAt as string,
      };
      financialSnapshot = legacyPublicResult.financial;
    } else {
      publicResult = internal.publicResult as QuickOrderLifecycleMutationResult;
      financialSnapshot = internal.financialSnapshot;
    }
    try {
      assertQuickOrderLifecycleMutationResult(publicResult);
    } catch {
      stateInvariant(false, "QUICK_ORDER_LIFECYCLE_PUBLIC_RESULT", `${path}.result.publicResult`);
    }
    stateInvariant(
      publicResult.kind === input.kind
        && publicResult.orderId === input.orderId
        && publicResult.revision === outer.committedRevision
        && publicResult.committedAt === outer.committedAt,
      "QUICK_ORDER_LIFECYCLE_PUBLIC_BINDING",
      `${path}.result.publicResult`,
    );

    stateInvariant(
      isExactDenseDataArray(internal.changes) && internal.changes.length > 0,
      "QUICK_ORDER_LIFECYCLE_CHANGES_CLOSED",
      `${path}.result.changes`,
    );
    const target = state.quickOrders.find((order) => order.id === input.orderId);
    stateInvariant(Boolean(target), "QUICK_ORDER_LIFECYCLE_TARGET", `${path}.payloadCanonical.orderId`);
    const changes: QuickOrderLifecycleReceiptChange[] = [];
    const changeOrderIds = new Set<string>();
    for (let changeIndex = 0; changeIndex < internal.changes.length; changeIndex += 1) {
      const changePath = `${path}.result.changes[${changeIndex}]`;
      const value = internal.changes[changeIndex];
      stateInvariant(
        hasExactEnumerableDataFields(
          value,
          QUICK_ORDER_LIFECYCLE_CHANGE_FIELDS,
          QUICK_ORDER_LIFECYCLE_CHANGE_FIELDS,
        ),
        "QUICK_ORDER_LIFECYCLE_CHANGE_CLOSED",
        changePath,
      );
      const rawChange = value as Record<string, unknown>;
      stateInvariant(
        typeof rawChange.orderId === "string"
          && rawChange.orderId.trim().length > 0
          && !changeOrderIds.has(rawChange.orderId),
        "QUICK_ORDER_LIFECYCLE_CHANGE_ORDER",
        `${changePath}.orderId`,
      );
      changeOrderIds.add(rawChange.orderId);
      const before = validateQuickOrderLifecycleCoordinate(rawChange.before, `${changePath}.before`);
      const after = validateQuickOrderLifecycleCoordinate(rawChange.after, `${changePath}.after`);
      const event = validateQuickOrderLifecycleReceiptEvent(rawChange.event, `${changePath}.event`);
      changes.push({ orderId: rawChange.orderId, before, after, event });
    }
    const changeIds = changes.map((change) => change.orderId);
    const changeOrderIdSet = new Set(changeIds);
    const sourceOrderedChangeIds = state.quickOrders.flatMap((order) => (
      changeOrderIdSet.has(order.id) ? [order.id] : []
    ));
    stateInvariant(
      changeOrderIdSet.has(input.orderId)
        && stableJson(changeIds) === stableJson(sourceOrderedChangeIds)
        && stableJson(publicResult.affectedOrderIds) === stableJson(changeIds),
      "QUICK_ORDER_LIFECYCLE_AFFECTED_ORDER",
      `${path}.result.changes`,
    );

    changes.forEach((change, changeIndex) => {
      const changePath = `${path}.result.changes[${changeIndex}]`;
      const order = state.quickOrders.find((candidate) => candidate.id === change.orderId);
      stateInvariant(Boolean(order), "QUICK_ORDER_LIFECYCLE_CHANGE_ORDER", `${changePath}.orderId`);
      stateInvariant(
        change.orderId === input.orderId || order!.linkedOrderId === input.orderId,
        "QUICK_ORDER_LIFECYCLE_CHANGE_TOPOLOGY",
        `${changePath}.orderId`,
      );
      validateQuickOrderLifecycleChangeSemantics(
        input.kind,
        input,
        typedActor,
        receipt,
        target!,
        order!,
        change,
        changePath,
      );
      verifiedChanges.push({
        kind: input.kind,
        targetOrderId: input.orderId,
        receiptId: receipt.id,
        receiptIndex,
        committedRevision: receipt.committedRevision,
        eventIndex: order!.statusHistory.findIndex((event) => event.id === change.event.id),
        order: order!,
        change,
        path: changePath,
      });
    });
    verifiedReceipts.push({
      kind: input.kind,
      targetOrderId: input.orderId,
      receiptId: receipt.id,
      receiptIndex,
      committedRevision: receipt.committedRevision,
      committedAt: receipt.committedAt,
      actor: typedActor,
      claimedOrderIds: changeIds,
      publicAffectedOrderIds: publicResult.affectedOrderIds,
      path,
    });

    const targetChange = changes.find((change) => change.orderId === input.orderId);
    stateInvariant(Boolean(targetChange), "QUICK_ORDER_LIFECYCLE_TARGET_CHANGE", `${path}.result.changes`);
    validateQuickOrderLifecycleFinancialSnapshot(
      state,
      financialSnapshot,
      receipt,
      target!,
      targetChange!,
      receiptContract === "quick_order_lifecycle_receipt_v1"
        ? `${path}.result.publicResult.financial`
        : `${path}.result.financialSnapshot`,
    );
  });

  validateQuickOrderLifecycleReceiptGlobalChronology(verifiedReceipts);
  validateQuickOrderLifecycleReceiptChains(verifiedChanges);
  validateQuickOrderLifecycleAffectedOrderCompleteness(state, verifiedChanges, verifiedReceipts);
  return verifiedChanges;
}

export type ReceiptBackedQuickOrderVoidLifecycleFact = Readonly<{
  kind: "void" | "restore";
  targetOrderId: string;
  orderId: string;
  committedRevision: number;
  eventId: string;
  eventIndex: number;
  after: Readonly<{
    voidedAt: string | null;
    voidedBy: string | null;
    voidReason: string | null;
  }>;
}>;

export function latestReceiptBackedQuickOrderVoidLifecycleFacts(
  state: LinkedOperationsState,
): ReadonlyMap<string, ReceiptBackedQuickOrderVoidLifecycleFact> {
  const latestByOrderId = new Map<string, ReceiptBackedQuickOrderVoidLifecycleFact>();
  validateQuickOrderLifecycleReceipts(state).forEach((verified) => {
    if (verified.kind !== "void" && verified.kind !== "restore") return;
    const current = latestByOrderId.get(verified.order.id);
    if (current !== undefined && current.eventIndex >= verified.eventIndex) return;
    latestByOrderId.set(verified.order.id, {
      kind: verified.kind,
      targetOrderId: verified.targetOrderId,
      orderId: verified.order.id,
      committedRevision: verified.committedRevision,
      eventId: verified.change.event.id,
      eventIndex: verified.eventIndex,
      after: {
        voidedAt: verified.change.after.voidedAt,
        voidedBy: verified.change.after.voidedBy,
        voidReason: verified.change.after.voidReason,
      },
    });
  });
  return latestByOrderId;
}

/**
 * Task 8 writes several immutable projections for one financial mutation.  This
 * validator deliberately binds them in both directions so no audit, receipt,
 * signature, snapshot version, or refund fact can survive as an orphan.
 */
function validateCanonicalBillingBindings(state: LinkedOperationsState): void {
  state.billingAuditEvents.forEach((event, index) => {
    const path = `$.billingAuditEvents[${index}]`;
    const allowed = event.operation === "invoice_activation"
      ? BILLING_ACTIVATION_AUDIT_FIELDS
      : event.operation === "invoice_line_refund"
        ? BILLING_REFUND_AUDIT_FIELDS
        : event.operation === "invoice_payment"
          ? BILLING_PAYMENT_AUDIT_FIELDS
          : event.operation === "parking_invoice_reprojection"
            ? BILLING_PARKING_REPROJECTION_AUDIT_FIELDS
        : undefined;
    stateInvariant(Boolean(allowed), "BILLING_AUDIT_OPERATION", `${path}.operation`);
    stateInvariant(
      hasOnlyKeys(event as unknown as Record<string, unknown>, allowed!)
        && Object.keys(event).length === allowed!.size,
      "BILLING_AUDIT_CLOSED",
      path,
    );
    stateInvariant(
      typeof event.mutationId === "string" && event.mutationId.length > 0
        && typeof event.invoiceId === "string" && event.invoiceId.length > 0
        && typeof event.invoiceVersionId === "string" && event.invoiceVersionId.length > 0
        && typeof event.actorId === "string" && event.actorId.length > 0
        && typeof event.actorName === "string" && event.actorName.length > 0,
      "BILLING_AUDIT_IDENTITY",
      path,
    );
    stateInvariant(isJamaicaInstant(event.recordedAt), "BILLING_AUDIT_TIME", `${path}.recordedAt`);
    const actorOperation: Task8MutationOperation = event.operation === "invoice_activation"
      ? "billing.invoice.activate"
      : event.operation === "invoice_payment"
        ? "billing.invoice.payment"
        : event.operation === "invoice_line_refund"
          ? "billing.invoice.lineRefund"
          : event.reprojectionKind === "waiver_correction"
            ? "parking.source.correct"
            : "parking.source.pickup";
    const canonicalActor = canonicalBillingActorIdentity(actorOperation, event.actorId);
    stateInvariant(
      canonicalActor !== null && event.actorName === canonicalActor.name,
      "BILLING_AUDIT_ACTOR_PROVENANCE",
      `${path}.actorId`,
    );
    if (event.operation === "invoice_activation") {
      stateInvariant(
        typeof event.invoiceNo === "string" && BILLING_INVOICE_NUMBER_PATTERN.test(event.invoiceNo)
          && typeof event.snapshotCommitment === "string"
          && /^sha256-utf16le:[a-f0-9]{64}$/u.test(event.snapshotCommitment),
        "BILLING_ACTIVATION_AUDIT_NUMBER",
        path,
      );
    } else if (event.operation === "invoice_line_refund") {
      stateInvariant(
        typeof event.refundId === "string" && event.refundId.length > 0
          && typeof event.chargeLineId === "string" && event.chargeLineId.length > 0,
        "BILLING_REFUND_AUDIT_IDENTITY",
        path,
      );
      stateInvariant(
        Number.isSafeInteger(event.receivableReductionJmd) && event.receivableReductionJmd > 0
          && Number.isSafeInteger(event.cashRefundJmd) && event.cashRefundJmd >= 0
          && event.cashRefundJmd <= event.receivableReductionJmd,
        "BILLING_REFUND_AUDIT_AMOUNT",
        path,
      );
    } else if (event.operation === "invoice_payment") {
      stateInvariant(
        typeof event.paymentId === "string" && event.paymentId.length > 0
          && Number.isSafeInteger(event.amountJmd) && event.amountJmd > 0
          && typeof event.method === "string" && event.method.length > 0
          && (event.note === null || typeof event.note === "string")
          && Number.isSafeInteger(event.committedRevision) && event.committedRevision > 0,
        "BILLING_PAYMENT_AUDIT",
        path,
      );
    } else {
      stateInvariant(
        (event.reprojectionKind === "physical_pickup" || event.reprojectionKind === "waiver_correction")
          && typeof event.previousInvoiceVersionId === "string" && event.previousInvoiceVersionId.length > 0
          && typeof event.snapshotCommitment === "string"
          && /^sha256-utf16le:[a-f0-9]{64}$/u.test(event.snapshotCommitment)
          && typeof event.parkingCaseId === "string" && event.parkingCaseId.length > 0
          && typeof event.chargeLineId === "string" && event.chargeLineId.length > 0
          && Number.isSafeInteger(event.sourceRevisionBefore) && event.sourceRevisionBefore > 0
          && Number.isSafeInteger(event.sourceRevisionAfter)
          && event.sourceRevisionAfter === event.sourceRevisionBefore + 1
          && Number.isSafeInteger(event.oldParkingAmountJmd) && event.oldParkingAmountJmd >= 0
          && Number.isSafeInteger(event.newParkingAmountJmd) && event.newParkingAmountJmd >= 0
          && Number.isSafeInteger(event.parkingDeltaJmd)
          && event.parkingDeltaJmd === event.newParkingAmountJmd - event.oldParkingAmountJmd
          && Number.isSafeInteger(event.parkingCashRefundJmd) && event.parkingCashRefundJmd >= 0
          && (event.reprojectionKind === "physical_pickup"
            ? event.newParkingAmountJmd >= event.oldParkingAmountJmd && event.parkingCashRefundJmd === 0
            : event.newParkingAmountJmd <= event.oldParkingAmountJmd)
          && Number.isSafeInteger(event.committedRevision) && event.committedRevision > 0,
        "BILLING_PARKING_REPROJECTION_AUDIT",
        path,
      );
    }
  });

  const activationMutationIds = new Set<string>();
  const activationVersionKeys = new Set<string>();
  const parkingReprojectionMutationIds = new Set<string>();
  const parkingReprojectionVersionKeys = new Set<string>();
  for (const invoice of state.invoices) {
    if (!isSharedChargeInvoice(invoice)) continue;
    for (const [versionIndex, version] of invoice.versions.entries()) {
      const versionPath = `$.invoices.${invoice.id}.versions.${version.id}`;
      const audits = state.billingAuditEvents.filter((event): event is LinkedInvoiceActivationAudit => (
        event.operation === "invoice_activation"
          && event.invoiceId === invoice.id
          && event.invoiceVersionId === version.id
      ));
      const parkingAudits = state.billingAuditEvents.filter((event): event is LinkedParkingInvoiceReprojectionAudit => (
        event.operation === "parking_invoice_reprojection"
          && event.invoiceId === invoice.id
          && event.invoiceVersionId === version.id
      ));
      stateInvariant(
        audits.length + parkingAudits.length === 1,
        "BILLING_VERSION_PRODUCER",
        versionPath,
      );
      if (parkingAudits.length === 1) {
        const audit = parkingAudits[0]!;
        const versionKey = `${invoice.id}\u0000${version.id}`;
        stateInvariant(
          versionIndex > 0
            && !parkingReprojectionVersionKeys.has(versionKey)
            && !parkingReprojectionMutationIds.has(audit.mutationId),
          "BILLING_PARKING_REPROJECTION_VERSION",
          versionPath,
        );
        parkingReprojectionVersionKeys.add(versionKey);
        parkingReprojectionMutationIds.add(audit.mutationId);
        const previousVersion = invoice.versions[versionIndex - 1]!;
        if (audit.reprojectionKind === "waiver_correction") {
          const receipts = state.mutationReceipts.filter((receipt) => (
            receipt.operation === "parking.source.correct" && receipt.mutationId === audit.mutationId
          ));
          stateInvariant(receipts.length === 1, "BILLING_PARKING_CORRECTION_RECEIPT", versionPath);
          const receipt = receipts[0]!;
          const payload = billingReceiptPayload(receipt, "BILLING_PARKING_CORRECTION_RECEIPT", versionPath);
          stateInvariant(
            hasOnlyKeys(payload, PARKING_SOURCE_CORRECTION_PAYLOAD_FIELDS)
              && ["caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "previewToken"]
                .every((field) => Object.prototype.hasOwnProperty.call(payload, field))
              && isPlainRecord(receipt.result)
              && hasOnlyKeys(receipt.result, PARKING_SOURCE_CORRECTION_RESULT_FIELDS)
              && Object.keys(receipt.result).length === PARKING_SOURCE_CORRECTION_RESULT_FIELDS.size,
            "BILLING_PARKING_CORRECTION_CLOSED",
            versionPath,
          );
          const result = receipt.result as Record<string, unknown>;
          const tokens = state.parkingWaiverPreviews.filter((candidate) => (
            Object.prototype.hasOwnProperty.call(candidate, "previewContract")
              && candidate.previewContract === "parking_correction_preview_v1"
              && candidate.id === payload.previewToken
          ));
          stateInvariant(tokens.length === 1, "BILLING_PARKING_CORRECTION_TOKEN", versionPath);
          const token = tokens[0] as LinkedModernParkingCorrectionPreviewToken;
          stateInvariant(
            token.claim !== null
              && token.nextInvoiceVersion !== null
              && token.nextSnapshotCommitment !== null
              && token.consumedAt === receipt.committedAt
              && token.claim.logicalInvoiceId === invoice.id
              && token.claim.financiallyEffectiveVersionId === previousVersion.id
              && token.nextInvoiceVersion.id === version.id
              && stableJson(token.nextInvoiceVersion) === stableJson(version)
              && token.nextSnapshotCommitment === version.snapshotCommitment,
            "BILLING_PARKING_CORRECTION_TOKEN_BINDING",
            versionPath,
          );
          const oldLine = previousVersion.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
            line.pricingMode === "parking_projection"
              && line.parkingCaseId === audit.parkingCaseId
              && line.chargeLineId === audit.chargeLineId
          ));
          const newLine = version.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
            line.pricingMode === "parking_projection"
              && line.parkingCaseId === audit.parkingCaseId
              && line.chargeLineId === audit.chargeLineId
          ));
          stateInvariant(
            oldLine !== undefined
              && newLine !== undefined
              && audit.previousInvoiceVersionId === previousVersion.id
              && version.version === previousVersion.version + 1
              && version.issuedAt === token.issuedAt
              && audit.snapshotCommitment === version.snapshotCommitment
              && audit.oldParkingAmountJmd === oldLine.amountJmd
              && audit.newParkingAmountJmd === newLine.amountJmd
              && audit.parkingDeltaJmd === newLine.amountJmd - oldLine.amountJmd
              && audit.parkingCashRefundJmd === token.parkingCashRefundJmd
              && audit.committedRevision === receipt.committedRevision
              && receipt.actorId === audit.actorId
              && receipt.committedAt === audit.recordedAt
              && payload.caseId === audit.parkingCaseId
              && payload.mutationId === audit.mutationId
              && payload.expectedSourceRevision === audit.sourceRevisionBefore
              && result.revision === receipt.committedRevision
              && result.caseId === audit.parkingCaseId
              && result.sourceRevision === audit.sourceRevisionAfter
              && result.invoiceId === invoice.id
              && result.invoiceVersionId === version.id
              && result.parkingDeltaJmd === audit.parkingDeltaJmd
              && result.parkingCashRefundJmd === audit.parkingCashRefundJmd
              && stableJson(result.parkingSource) === stableJson(token.nextParkingSource)
              && (audit.parkingCashRefundJmd > 0
                ? typeof payload.refundMethod === "string" && payload.refundMethod.length > 0
                : !Object.prototype.hasOwnProperty.call(payload, "refundMethod")),
            "BILLING_PARKING_CORRECTION_BINDING",
            versionPath,
          );
          continue;
        }
        const receipts = state.mutationReceipts.filter((receipt) => (
          receipt.operation === "parking.source.pickup" && receipt.mutationId === audit.mutationId
        ));
        stateInvariant(receipts.length === 1, "BILLING_PARKING_REPROJECTION_RECEIPT", versionPath);
        const receipt = receipts[0]!;
        const payload = billingReceiptPayload(receipt, "BILLING_PARKING_REPROJECTION_RECEIPT", versionPath);
        stateInvariant(
          hasOnlyKeys(payload, PARKING_SOURCE_PICKUP_PAYLOAD_FIELDS)
            && Object.keys(payload).length === PARKING_SOURCE_PICKUP_PAYLOAD_FIELDS.size
            && isPlainRecord(receipt.result)
            && hasOnlyKeys(receipt.result, PARKING_SOURCE_PICKUP_RESULT_FIELDS)
            && Object.keys(receipt.result).length === PARKING_SOURCE_PICKUP_RESULT_FIELDS.size,
          "BILLING_PARKING_REPROJECTION_CLOSED",
          versionPath,
        );
        const result = receipt.result as Record<string, unknown>;
        const sourceBefore = result.sourceBefore;
        const sourceAfter = result.parkingSource;
        stateInvariant(
          isPlainRecord(sourceBefore)
            && isPlainRecord(sourceAfter)
            && typeof payload.caseId === "string"
            && payload.caseId === audit.parkingCaseId
            && payload.mutationId === audit.mutationId
            && Number.isSafeInteger(payload.expectedRevision)
            && Number(payload.expectedRevision) + 1 === receipt.committedRevision
            && payload.expectedSourceRevision === audit.sourceRevisionBefore
            && sourceBefore.id === audit.parkingCaseId
            && sourceBefore.revision === audit.sourceRevisionBefore
            && sourceAfter.id === audit.parkingCaseId
            && sourceAfter.revision === audit.sourceRevisionAfter,
          "BILLING_PARKING_REPROJECTION_SOURCE",
          versionPath,
        );
        const modernSourceAfter = validateClosedModernParkingSourceSnapshot(
          sourceAfter,
          `${versionPath}.result.parkingSource`,
        );
        const oldLine = previousVersion.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
          line.pricingMode === "parking_projection"
            && line.parkingCaseId === audit.parkingCaseId
            && line.chargeLineId === audit.chargeLineId
        ));
        stateInvariant(oldLine !== undefined, "BILLING_PARKING_REPROJECTION_OLD_LINE", versionPath);
        const newFinal = deriveParkingFinalAccrual({
          currentAccrual: modernSourceAfter.accrual,
          dailyRateJmd: modernSourceAfter.dailyRateJmd,
          latestWaiverDecision: modernSourceAfter.waiverHistory[modernSourceAfter.waiverHistory.length - 1],
        }).finalAmountJmd;
        const expectedSnapshot = buildInvoiceChargeSnapshot({
          sourceBusinessOrderId: previousVersion.snapshot.sourceBusinessOrderId,
          sourceBusinessOrderRevision: previousVersion.snapshot.sourceBusinessOrderRevision,
          lines: previousVersion.snapshot.lines.map(invoiceSnapshotLineToQuotedCharge).map((line) => (
            line.pricingMode === "parking_projection" && line.parkingCaseId === audit.parkingCaseId
              ? {
                ...line,
                sourceRevision: audit.sourceRevisionAfter,
                asOf: receipt.committedAt,
                amountJmd: newFinal,
              }
              : line
          )),
          adjustments: previousVersion.snapshot.adjustments,
        });
        const expectedCommitment = billingSnapshotCommitment(expectedSnapshot);
        stateInvariant(
          audit.reprojectionKind === "physical_pickup"
            && audit.previousInvoiceVersionId === previousVersion.id
            && version.version === previousVersion.version + 1
            && version.issuedAt === receipt.committedAt
            && stableJson(version.snapshot) === stableJson(expectedSnapshot)
            && version.snapshotCommitment === expectedCommitment
            && audit.snapshotCommitment === expectedCommitment
            && audit.oldParkingAmountJmd === oldLine!.amountJmd
            && audit.newParkingAmountJmd === newFinal
            && audit.parkingDeltaJmd === newFinal - oldLine!.amountJmd
            && audit.parkingCashRefundJmd === 0
            && audit.committedRevision === receipt.committedRevision
            && receipt.actorId === audit.actorId
            && result.actorId === audit.actorId
            && result.actorName === audit.actorName
            && receipt.committedAt === audit.recordedAt,
          "BILLING_PARKING_REPROJECTION_BINDING",
          versionPath,
        );
        const expectedResult = {
          revision: receipt.committedRevision,
          caseId: audit.parkingCaseId,
          sourceRevision: audit.sourceRevisionAfter,
          sourceBefore,
          parkingSource: sourceAfter,
          invoiceId: invoice.id,
          previousInvoiceVersionId: previousVersion.id,
          invoiceVersionId: version.id,
          snapshotCommitment: expectedCommitment,
          parkingDeltaJmd: audit.parkingDeltaJmd,
          parkingCashRefundJmd: 0,
          actorId: audit.actorId,
          actorName: audit.actorName,
        };
        stateInvariant(
          stableJson(result) === stableJson(expectedResult)
            && !state.discountSignatureEvents.some((event) => event.mutationId === audit.mutationId)
            && !state.refunds.some((refund) => (
              Object.prototype.hasOwnProperty.call(refund, "mutationId")
                && (refund as Extract<LinkedInvoiceRefundFact, { refundContract: "ordinary_line_v1" }>).mutationId === audit.mutationId
            )),
          "BILLING_PARKING_REPROJECTION_RESULT",
          versionPath,
        );
        continue;
      }
      stateInvariant(audits.length === 1, "BILLING_ACTIVATION_AUDIT", versionPath);
      const audit = audits[0];
      const versionKey = `${invoice.id}\u0000${version.id}`;
      stateInvariant(!activationVersionKeys.has(versionKey), "BILLING_ACTIVATION_VERSION", versionPath);
      activationVersionKeys.add(versionKey);
      stateInvariant(!activationMutationIds.has(audit.mutationId), "BILLING_ACTIVATION_MUTATION", versionPath);
      activationMutationIds.add(audit.mutationId);

      const receipts = state.mutationReceipts.filter((receipt) => (
        receipt.mutationId === audit.mutationId && receipt.operation === "billing.invoice.activate"
      ));
      stateInvariant(receipts.length === 1, "BILLING_ACTIVATION_RECEIPT", versionPath);
      const receipt = receipts[0];
      const payload = billingReceiptPayload(receipt, "BILLING_ACTIVATION_RECEIPT", versionPath);
      stateInvariant(
        hasOnlyKeys(payload, BILLING_ACTIVATION_PAYLOAD_FIELDS)
          && ["orderId", "expectedRevision", "mutationId"].every((field) => Object.prototype.hasOwnProperty.call(payload, field)),
        "BILLING_ACTIVATION_PAYLOAD_CLOSED",
        `${versionPath}.payload`,
      );
      stateInvariant(
        payload.orderId === invoice.businessOrderId
          && payload.mutationId === audit.mutationId
          && Number.isSafeInteger(payload.expectedRevision)
          && Number(payload.expectedRevision) + 1 === receipt.committedRevision
          && version.snapshot.sourceBusinessOrderRevision === payload.expectedRevision,
        "BILLING_ACTIVATION_SOURCE_REVISION",
        `${versionPath}.payload`,
      );
      stateInvariant(
        stableJson(payload.adjustments ?? []) === stableJson(version.snapshot.adjustments),
        "BILLING_ACTIVATION_ADJUSTMENTS",
        `${versionPath}.payload.adjustments`,
      );
      const snapshotCommitment = billingSnapshotCommitment(version.snapshot);
      stateInvariant(
        receipt.actorId === audit.actorId
          && receipt.committedAt === audit.recordedAt
          && version.issuedAt === audit.recordedAt
          && audit.invoiceNo === invoice.invoiceNo,
        "BILLING_ACTIVATION_OWNER",
        versionPath,
      );
      stateInvariant(
        version.snapshotCommitment === snapshotCommitment
          && audit.snapshotCommitment === snapshotCommitment,
        "BILLING_ACTIVATION_SNAPSHOT_COMMITMENT",
        versionPath,
      );
      stateInvariant(
        isPlainRecord(receipt.result) && Array.isArray(receipt.result.parkingSourceTransitions),
        "BILLING_ACTIVATION_RECEIPT_RESULT",
        `${versionPath}.result.parkingSourceTransitions`,
      );
      const expectedResult = {
        revision: receipt.committedRevision,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceVersionId: version.id,
        snapshotCommitment,
        version: version.version,
        parkingSourceTransitions: receipt.result.parkingSourceTransitions,
      };
      stateInvariant(
        stableJson(receipt.result) === stableJson(expectedResult),
        "BILLING_ACTIVATION_RECEIPT_RESULT",
        `${versionPath}.result`,
      );

      const requirement = discountApprovalRequirement(
        version.snapshot.lines.map(invoiceSnapshotLineToQuotedCharge),
      );
      const requiresFreshApproval = invoiceSnapshotRequiresFreshApproval(
        versionIndex === 0 ? null : invoice.versions[versionIndex - 1]!.snapshot,
        version.snapshot,
      );
      const signatures = state.discountSignatureEvents.filter((event) => (
        event.document.kind === "invoice" && event.mutationId === audit.mutationId
      ));
      stateInvariant(
        signatures.length === (requiresFreshApproval ? 1 : 0),
        "BILLING_ACTIVATION_SIGNATURE",
        versionPath,
      );
      if (requiresFreshApproval) {
        const signature = signatures[0];
        stateInvariant(isPlainRecord(payload.signature), "BILLING_ACTIVATION_SIGNATURE", `${versionPath}.payload.signature`);
        stateInvariant(
          Object.keys(payload.signature).length === 1
            && hasOnlyKeys(payload.signature, new Set(["rawStrokes"]))
            && stableJson(payload.signature.rawStrokes) === stableJson(signature.rawStrokes)
            && signature.document.id === invoice.id
            && signature.operationAccount.id === audit.actorId
            && signature.operationAccount.name === audit.actorName
            && signature.signedAt === audit.recordedAt
            && stableJson(signature.categoryRatios) === stableJson({ labor: requirement.labor, parts: requirement.parts }),
          "BILLING_ACTIVATION_SIGNATURE_BINDING",
          versionPath,
        );
      } else {
        stateInvariant(
          !Object.prototype.hasOwnProperty.call(payload, "signature"),
          "BILLING_ACTIVATION_UNNECESSARY_SIGNATURE",
          `${versionPath}.payload.signature`,
        );
      }
    }
  }

  const activationAudits = state.billingAuditEvents.filter((event) => event.operation === "invoice_activation");
  stateInvariant(
    activationAudits.length === activationVersionKeys.size
      && activationAudits.every((event) => activationMutationIds.has(event.mutationId)),
    "BILLING_ACTIVATION_AUDIT_REVERSE",
    "$.billingAuditEvents",
  );
  const activationReceipts = state.mutationReceipts.filter((receipt) => receipt.operation === "billing.invoice.activate");
  stateInvariant(
    activationReceipts.length === activationMutationIds.size
      && activationReceipts.every((receipt) => activationMutationIds.has(receipt.mutationId)),
    "BILLING_ACTIVATION_RECEIPT_REVERSE",
    "$.mutationReceipts",
  );
  const parkingReprojectionAudits = state.billingAuditEvents.filter(
    (event) => event.operation === "parking_invoice_reprojection",
  );
  stateInvariant(
    parkingReprojectionAudits.length === parkingReprojectionVersionKeys.size
      && parkingReprojectionAudits.every((event) => parkingReprojectionMutationIds.has(event.mutationId)),
    "BILLING_PARKING_REPROJECTION_AUDIT_REVERSE",
    "$.billingAuditEvents",
  );
  const claimedPickupReceipts = state.mutationReceipts.filter((receipt) => (
    receipt.operation === "parking.source.pickup"
      && isPlainRecord(receipt.result)
      && receipt.result.invoiceId !== null
  ));
  const claimedCorrectionReceipts = state.mutationReceipts.filter((receipt) => (
    receipt.operation === "parking.source.correct"
      && isPlainRecord(receipt.result)
      && receipt.result.invoiceId !== null
  ));
  const pickupReprojectionMutationIds = new Set(parkingReprojectionAudits
    .filter((event) => event.reprojectionKind === "physical_pickup")
    .map((event) => event.mutationId));
  const correctionReprojectionMutationIds = new Set(parkingReprojectionAudits
    .filter((event) => event.reprojectionKind === "waiver_correction")
    .map((event) => event.mutationId));
  stateInvariant(
    claimedPickupReceipts.length === pickupReprojectionMutationIds.size
      && claimedPickupReceipts.every((receipt) => pickupReprojectionMutationIds.has(receipt.mutationId))
      && claimedCorrectionReceipts.length === correctionReprojectionMutationIds.size
      && claimedCorrectionReceipts.every((receipt) => correctionReprojectionMutationIds.has(receipt.mutationId)),
    "BILLING_PARKING_REPROJECTION_RECEIPT_REVERSE",
    "$.mutationReceipts",
  );
  state.discountSignatureEvents.forEach((event, index) => {
    if (event.document.kind !== "invoice") return;
    stateInvariant(
      activationMutationIds.has(event.mutationId),
      "BILLING_ACTIVATION_SIGNATURE_REVERSE",
      `$.discountSignatureEvents[${index}]`,
    );
  });

  type ModernRefund = Extract<LinkedInvoiceRefundFact, { refundContract: "ordinary_line_v1" }>;
  const refundMutationIds = new Set<string>();
  const receiptForRefund = new Map<string, LinkedMutationReceipt>();
  const modernRefunds = state.refunds.filter((refund): refund is ModernRefund => refund.refundContract === "ordinary_line_v1");
  modernRefunds.forEach((refund, index) => {
    const path = `$.refunds.${refund.id}`;
    const audits = state.billingAuditEvents.filter((event): event is LinkedInvoiceLineRefundAudit => (
      event.operation === "invoice_line_refund"
        && event.refundId === refund.id
        && event.invoiceId === refund.logicalInvoiceId
        && event.invoiceVersionId === refund.invoiceVersionId
    ));
    stateInvariant(audits.length === 1, "BILLING_REFUND_AUDIT", path);
    const audit = audits[0];
    stateInvariant(!refundMutationIds.has(audit.mutationId), "BILLING_REFUND_MUTATION", path);
    refundMutationIds.add(audit.mutationId);
    stateInvariant(refund.mutationId === audit.mutationId, "BILLING_REFUND_MUTATION", `${path}.mutationId`);
    const receipts = state.mutationReceipts.filter((receipt) => (
      receipt.mutationId === refund.mutationId && receipt.operation === "billing.invoice.lineRefund"
    ));
    stateInvariant(receipts.length === 1, "BILLING_REFUND_RECEIPT", path);
    const receipt = receipts[0];
    receiptForRefund.set(refund.id, receipt);
    const payload = billingReceiptPayload(receipt, "BILLING_REFUND_RECEIPT", path);
    const hasQuantity = Object.prototype.hasOwnProperty.call(payload, "refundQuantity");
    const hasWholeLine = Object.prototype.hasOwnProperty.call(payload, "wholeLine");
    stateInvariant(
      hasOnlyKeys(payload, BILLING_REFUND_PAYLOAD_FIELDS)
        && ["logicalInvoiceId", "invoiceVersionId", "chargeLineId", "method", "reason", "expectedRevision", "mutationId"]
          .every((field) => Object.prototype.hasOwnProperty.call(payload, field))
        && hasQuantity !== hasWholeLine,
      "BILLING_REFUND_PAYLOAD_CLOSED",
      `${path}.payload`,
    );
    stateInvariant(
      payload.logicalInvoiceId === refund.logicalInvoiceId
        && payload.invoiceVersionId === refund.invoiceVersionId
        && payload.chargeLineId === refund.chargeLineId
        && payload.refundQuantity === refund.refundQuantity
        && payload.wholeLine === refund.wholeLine
        && payload.method === refund.method
        && payload.reason === refund.reason
        && payload.mutationId === refund.mutationId
        && Number.isSafeInteger(payload.expectedRevision)
        && Number(payload.expectedRevision) + 1 === receipt.committedRevision,
      "BILLING_REFUND_PAYLOAD_BINDING",
      `${path}.payload`,
    );
    stateInvariant(
      receipt.actorId === refund.actorId
        && receipt.actorId === audit.actorId
        && refund.actorName === audit.actorName
        && receipt.committedAt === refund.refundedAt
        && receipt.committedAt === audit.recordedAt,
      "BILLING_REFUND_OWNER",
      path,
    );
    stateInvariant(
      audit.chargeLineId === refund.chargeLineId
        && audit.receivableReductionJmd === refund.receivableReductionJmd
        && audit.cashRefundJmd === refund.cashRefundJmd,
      "BILLING_REFUND_AUDIT_AMOUNT",
      path,
    );
    stateInvariant(
      stableJson(receipt.result) === stableJson(refund),
      "BILLING_REFUND_RECEIPT_RESULT",
      `${path}.result`,
    );
    stateInvariant(index < modernRefunds.length, "BILLING_REFUND_INDEX", path);
  });

  const refundAudits = state.billingAuditEvents.filter((event) => event.operation === "invoice_line_refund");
  stateInvariant(
    refundAudits.length === modernRefunds.length
      && refundAudits.every((event) => refundMutationIds.has(event.mutationId)),
    "BILLING_REFUND_AUDIT_REVERSE",
    "$.billingAuditEvents",
  );
  const refundReceipts = state.mutationReceipts.filter((receipt) => receipt.operation === "billing.invoice.lineRefund");
  stateInvariant(
    refundReceipts.length === modernRefunds.length
      && refundReceipts.every((receipt) => refundMutationIds.has(receipt.mutationId)),
    "BILLING_REFUND_RECEIPT_REVERSE",
    "$.mutationReceipts",
  );

  const modernPayments = state.payments.filter(isModernInvoicePaymentFact);
  const paymentMutationIds = new Set<string>();
  const receiptForPayment = new Map<string, LinkedMutationReceipt>();
  modernPayments.forEach((payment) => {
    const path = `$.payments.${payment.id}`;
    stateInvariant(
      hasOnlyKeys(payment as unknown as Record<string, unknown>, MODERN_PAYMENT_FIELDS)
        && [
          "id", "paymentContract", "invoiceId", "invoiceVersionId", "amountJmd", "receivedAt", "method",
          "receivedBy", "receivedById", "mutationId", "committedRevision",
        ].every((field) => Object.prototype.hasOwnProperty.call(payment, field)),
      "BILLING_PAYMENT_CLOSED",
      path,
    );
    stateInvariant(
      payment.paymentContract === "invoice_payment_v1"
        && typeof payment.id === "string" && payment.id.length > 0
        && typeof payment.invoiceId === "string" && payment.invoiceId.length > 0
        && typeof payment.invoiceVersionId === "string" && payment.invoiceVersionId.length > 0
        && Number.isSafeInteger(payment.amountJmd) && payment.amountJmd > 0
        && typeof payment.method === "string" && payment.method.length > 0
        && typeof payment.receivedBy === "string" && payment.receivedBy.length > 0
        && typeof payment.receivedById === "string" && payment.receivedById.length > 0
        && typeof payment.mutationId === "string" && payment.mutationId.length > 0
        && Number.isSafeInteger(payment.committedRevision) && payment.committedRevision > 0
        && isJamaicaInstant(payment.receivedAt)
        && (payment.note === undefined || (typeof payment.note === "string" && payment.note.length > 0)),
      "BILLING_PAYMENT_FACT",
      path,
    );
    const invoice = state.invoices.find((candidate) => candidate.id === payment.invoiceId);
    stateInvariant(
      invoice !== undefined && invoice.versions.some((version) => version.id === payment.invoiceVersionId),
      "BILLING_PAYMENT_SOURCE",
      path,
    );
    stateInvariant(!paymentMutationIds.has(payment.mutationId), "BILLING_PAYMENT_MUTATION", `${path}.mutationId`);
    paymentMutationIds.add(payment.mutationId);
    const audits = state.billingAuditEvents.filter((event): event is LinkedInvoicePaymentAudit => (
      event.operation === "invoice_payment"
        && event.paymentId === payment.id
        && event.invoiceId === payment.invoiceId
        && event.invoiceVersionId === payment.invoiceVersionId
    ));
    stateInvariant(audits.length === 1, "BILLING_PAYMENT_AUDIT", path);
    const audit = audits[0];
    stateInvariant(audit.mutationId === payment.mutationId, "BILLING_PAYMENT_AUDIT", `${path}.mutationId`);
    const receipts = state.mutationReceipts.filter((receipt) => (
      receipt.operation === "billing.invoice.payment" && receipt.mutationId === payment.mutationId
    ));
    stateInvariant(receipts.length === 1, "BILLING_PAYMENT_RECEIPT", path);
    const receipt = receipts[0];
    receiptForPayment.set(payment.id, receipt);
    const payload = billingReceiptPayload(receipt, "BILLING_PAYMENT_RECEIPT", path);
    stateInvariant(
      hasOnlyKeys(payload, BILLING_PAYMENT_PAYLOAD_FIELDS)
        && ["invoiceId", "expectedRevision", "mutationId", "amountJmd", "method"]
          .every((field) => Object.prototype.hasOwnProperty.call(payload, field))
        && Object.prototype.hasOwnProperty.call(payload, "note") === (payment.note !== undefined),
      "BILLING_PAYMENT_PAYLOAD_CLOSED",
      `${path}.payload`,
    );
    stateInvariant(
      payload.invoiceId === payment.invoiceId
        && payload.mutationId === payment.mutationId
        && payload.amountJmd === payment.amountJmd
        && payload.method === payment.method
        && payload.note === payment.note
        && Number.isSafeInteger(payload.expectedRevision)
        && Number(payload.expectedRevision) + 1 === payment.committedRevision
        && receipt.committedRevision === payment.committedRevision,
      "BILLING_PAYMENT_PAYLOAD_BINDING",
      `${path}.payload`,
    );
    stateInvariant(
      receipt.actorId === payment.receivedById
        && receipt.actorId === audit.actorId
        && receipt.committedAt === payment.receivedAt
        && receipt.committedAt === audit.recordedAt
        && payment.receivedBy === audit.actorName
        && audit.paymentId === payment.id
        && audit.amountJmd === payment.amountJmd
        && audit.method === payment.method
        && audit.note === (payment.note ?? null)
        && audit.committedRevision === payment.committedRevision,
      "BILLING_PAYMENT_OWNER",
      path,
    );
    stateInvariant(
      stableJson(receipt.result) === stableJson(payment),
      "BILLING_PAYMENT_RECEIPT_RESULT",
      `${path}.result`,
    );
  });
  const paymentAudits = state.billingAuditEvents.filter((event) => event.operation === "invoice_payment");
  stateInvariant(
    paymentAudits.length === modernPayments.length
      && paymentAudits.every((event) => paymentMutationIds.has(event.mutationId)),
    "BILLING_PAYMENT_AUDIT_REVERSE",
    "$.billingAuditEvents",
  );
  const paymentReceipts = state.mutationReceipts.filter((receipt) => receipt.operation === "billing.invoice.payment");
  stateInvariant(
    paymentReceipts.length === modernPayments.length
      && paymentReceipts.every((receipt) => paymentMutationIds.has(receipt.mutationId)),
    "BILLING_PAYMENT_RECEIPT_REVERSE",
    "$.mutationReceipts",
  );

  const orderedBillingReceipts = state.mutationReceipts.filter((receipt) => (
    receipt.operation === "billing.invoice.activate"
      || receipt.operation === "billing.invoice.lineRefund"
      || receipt.operation === "billing.invoice.payment"
      || (receipt.operation === "parking.source.pickup"
        && isPlainRecord(receipt.result) && receipt.result.invoiceId !== null)
      || (receipt.operation === "parking.source.correct"
        && isPlainRecord(receipt.result) && receipt.result.invoiceId !== null)
  ));
  stateInvariant(
    new Set(orderedBillingReceipts.map((receipt) => receipt.committedRevision)).size === orderedBillingReceipts.length,
    "BILLING_LEDGER_REVISION_UNIQUE",
    "$.mutationReceipts",
  );
  state.invoices.forEach((invoice) => {
    if (!isSharedChargeInvoice(invoice)) return;
    const activationRevisions = invoice.versions.map((version) => {
      const audit = state.billingAuditEvents.find((event): event is LinkedInvoiceActivationAudit | LinkedParkingInvoiceReprojectionAudit => (
        (event.operation === "invoice_activation" || event.operation === "parking_invoice_reprojection")
          && event.invoiceId === invoice.id
          && event.invoiceVersionId === version.id
      ));
      const receipt = audit && state.mutationReceipts.find((candidate) => (
        candidate.mutationId === audit.mutationId
          && (audit.operation === "invoice_activation"
            ? candidate.operation === "billing.invoice.activate"
            : audit.reprojectionKind === "waiver_correction"
              ? candidate.operation === "parking.source.correct"
              : candidate.operation === "parking.source.pickup")
      ));
      stateInvariant(receipt !== undefined, "BILLING_LEDGER_ACTIVATION", `$.invoices.${invoice.id}.versions.${version.id}`);
      return receipt.committedRevision;
    });
    stateInvariant(
      activationRevisions.every((revision, index) => index === 0 || revision > activationRevisions[index - 1]!),
      "BILLING_LEDGER_ACTIVATION_ORDER",
      `$.invoices.${invoice.id}.versions`,
    );
    modernRefunds.filter((refund) => refund.logicalInvoiceId === invoice.id).forEach((refund) => {
      const sourceIndex = invoice.versions.findIndex((version) => version.id === refund.invoiceVersionId);
      stateInvariant(sourceIndex >= 0, "BILLING_LEDGER_REFUND_SOURCE", `$.refunds.${refund.id}`);
      const refundRevision = receiptForRefund.get(refund.id)?.committedRevision;
      const sourceActivationRevision = activationRevisions[sourceIndex];
      const nextActivationRevision = activationRevisions[sourceIndex + 1];
      stateInvariant(
        refundRevision !== undefined
          && sourceActivationRevision !== undefined
          && refundRevision > sourceActivationRevision
          && (nextActivationRevision === undefined || refundRevision < nextActivationRevision),
        "BILLING_LEDGER_REFUND_WINDOW",
        `$.refunds.${refund.id}.invoiceVersionId`,
      );
    });
    const ownerPayments = modernPayments.filter((payment) => payment.invoiceId === invoice.id)
      .sort((left, right) => left.committedRevision - right.committedRevision);
    ownerPayments.forEach((payment) => {
      const sourceIndex = invoice.versions.findIndex((version) => version.id === payment.invoiceVersionId);
      stateInvariant(sourceIndex >= 0, "BILLING_LEDGER_PAYMENT_SOURCE", `$.payments.${payment.id}`);
      const sourceActivationRevision = activationRevisions[sourceIndex];
      const nextActivationRevision = activationRevisions[sourceIndex + 1];
      stateInvariant(
        sourceActivationRevision !== undefined
          && payment.committedRevision > sourceActivationRevision
          && (nextActivationRevision === undefined || payment.committedRevision < nextActivationRevision),
        "BILLING_LEDGER_PAYMENT_WINDOW",
        `$.payments.${payment.id}.invoiceVersionId`,
      );
      const sourceVersion = invoice.versions[sourceIndex];
      stateInvariant(sourceVersion !== undefined, "BILLING_LEDGER_PAYMENT_SOURCE", `$.payments.${payment.id}`);
      const refundsBefore = modernRefunds.filter((refund) => (
        refund.logicalInvoiceId === invoice.id
          && receiptForRefund.get(refund.id)!.committedRevision < payment.committedRevision
      ));
      const receivableBeforeJmd = sourceVersion.snapshot.totals.grandTotalJmd - billingStateSum(
        refundsBefore.map((refund) => refund.receivableReductionJmd),
        "BILLING_PAYMENT_RECEIVABLE",
        `$.payments.${payment.id}`,
      );
      const grossPaidBeforeJmd = billingStateSum(
        ownerPayments.filter((candidate) => candidate.committedRevision < payment.committedRevision)
          .map((candidate) => candidate.amountJmd),
        "BILLING_PAYMENT_PRIOR_AMOUNT",
        `$.payments.${payment.id}`,
      );
      const cashRefundBeforeJmd = billingStateSum(
        refundsBefore.map((refund) => refund.cashRefundJmd),
        "BILLING_PAYMENT_PRIOR_REFUND",
        `$.payments.${payment.id}`,
      );
      const netPaidBeforeJmd = grossPaidBeforeJmd - cashRefundBeforeJmd;
      const balanceBeforeJmd = receivableBeforeJmd - netPaidBeforeJmd;
      stateInvariant(
        Number.isSafeInteger(receivableBeforeJmd) && receivableBeforeJmd >= 0
          && Number.isSafeInteger(netPaidBeforeJmd) && netPaidBeforeJmd >= 0
          && Number.isSafeInteger(balanceBeforeJmd) && balanceBeforeJmd > 0
          && payment.amountJmd <= balanceBeforeJmd,
        "BILLING_PAYMENT_BALANCE_AT_COMMIT",
        `$.payments.${payment.id}.amountJmd`,
      );
    });
    stateInvariant(
      !state.payments.some((payment) => (
        payment.invoiceId === invoice.id
          && !Object.prototype.hasOwnProperty.call(payment, "paymentContract")
      )),
      "BILLING_LEGACY_PAYMENT_SHARED_FORBIDDEN",
      `$.invoices.${invoice.id}`,
    );
  });
  state.invoices.filter((invoice) => !isSharedChargeInvoice(invoice)).forEach((invoice) => {
    const currentVersion = invoice.versions[invoice.versions.length - 1];
    stateInvariant(currentVersion !== undefined, "BILLING_LEGACY_PAYMENT_VERSION", `$.invoices.${invoice.id}`);
    const openingPaymentsJmd = billingStateSum(
      state.payments.filter((payment) => (
        payment.invoiceId === invoice.id
          && !Object.prototype.hasOwnProperty.call(payment, "paymentContract")
      )).map((payment) => payment.amountJmd),
      "BILLING_LEGACY_PAYMENT_OPENING",
      `$.invoices.${invoice.id}`,
    );
    const openingRefundsJmd = billingStateSum(
      state.refunds.filter((refund): refund is LinkedLegacyInvoiceRefundFact => (
        refund.refundContract === undefined && refund.invoiceId === invoice.id
      )).map((refund) => refund.amountJmd),
      "BILLING_LEGACY_REFUND_OPENING",
      `$.invoices.${invoice.id}`,
    );
    const ownerPayments = modernPayments.filter((payment) => payment.invoiceId === invoice.id)
      .sort((left, right) => left.committedRevision - right.committedRevision);
    ownerPayments.forEach((payment) => {
      stateInvariant(
        payment.invoiceVersionId === currentVersion.id,
        "BILLING_LEGACY_PAYMENT_CURRENT_VERSION",
        `$.payments.${payment.id}.invoiceVersionId`,
      );
      const priorModernJmd = billingStateSum(
        ownerPayments.filter((candidate) => candidate.committedRevision < payment.committedRevision)
          .map((candidate) => candidate.amountJmd),
        "BILLING_LEGACY_PAYMENT_PRIOR",
        `$.payments.${payment.id}`,
      );
      const balanceBeforeJmd = invoiceVersionTotalJmd(currentVersion)
        - (openingPaymentsJmd - openingRefundsJmd + priorModernJmd);
      stateInvariant(
        Number.isSafeInteger(balanceBeforeJmd)
          && balanceBeforeJmd > 0
          && payment.amountJmd <= balanceBeforeJmd,
        "BILLING_LEGACY_PAYMENT_BALANCE_AT_COMMIT",
        `$.payments.${payment.id}.amountJmd`,
      );
    });
  });

  const orderedRefunds = [...modernRefunds].sort((left, right) => {
    const revisionDifference = receiptForRefund.get(left.id)!.committedRevision - receiptForRefund.get(right.id)!.committedRevision;
    return revisionDifference || left.id.localeCompare(right.id);
  });
  orderedRefunds.forEach((refund, refundIndex) => {
    const path = `$.refunds.${refund.id}`;
    const receipt = receiptForRefund.get(refund.id)!;
    const invoice = state.invoices.find((candidate) => candidate.id === refund.logicalInvoiceId);
    stateInvariant(invoice !== undefined && isSharedChargeInvoice(invoice), "BILLING_REFUND_SOURCE_INVOICE", path);
    const version = invoice.versions.find((candidate) => candidate.id === refund.invoiceVersionId);
    stateInvariant(version !== undefined, "BILLING_REFUND_SOURCE_VERSION", path);
    const line = version.snapshot.lines.find((candidate) => candidate.chargeLineId === refund.chargeLineId);
    stateInvariant(line !== undefined && line.pricingMode !== "parking_projection", "BILLING_REFUND_SOURCE_LINE", path);
    const priorRefunds = orderedRefunds.filter((candidate) => (
      candidate.logicalInvoiceId === refund.logicalInvoiceId
        && receiptForRefund.get(candidate.id)!.committedRevision < receipt.committedRevision
    ));
    const legacyOccupancies = state.legacyRefundOccupancies.filter((occupancy) => (
      occupancy.invoiceId === refund.logicalInvoiceId
    ));
    const priorReductionJmd = billingStateSum(
      priorRefunds.map((candidate) => candidate.receivableReductionJmd),
      "BILLING_REFUND_PRIOR_AMOUNT",
      path,
    );
    const legacyOccupancyJmd = billingStateSum(
      legacyOccupancies.map((occupancy) => occupancy.amountJmd),
      "BILLING_REFUND_LEGACY_AMOUNT",
      path,
    );
    const totalJmd = version.snapshot.totals.grandTotalJmd;
    const receivableBeforeRefundJmd = totalJmd - priorReductionJmd;
    const remainingInvoiceCreditJmd = totalJmd - priorReductionJmd - legacyOccupancyJmd;
    stateInvariant(
      Number.isSafeInteger(receivableBeforeRefundJmd) && receivableBeforeRefundJmd >= 0
        && Number.isSafeInteger(remainingInvoiceCreditJmd) && remainingInvoiceCreditJmd >= 0,
      "BILLING_REFUND_INVOICE_CEILING",
      path,
    );
    const usedLineCreditJmd = billingStateSum([
      ...priorRefunds.filter((candidate) => candidate.chargeLineId === refund.chargeLineId)
        .map((candidate) => candidate.receivableReductionJmd),
      ...legacyOccupancies.filter((occupancy) => (
        occupancy.status === "line" && occupancy.chargeLineId === refund.chargeLineId
      )).map((occupancy) => occupancy.amountJmd),
    ], "BILLING_REFUND_LINE_AMOUNT", path);
    const sourceLineAmountJmd = line.pricingMode === "unit" ? line.finalLineJmd : line.amountJmd;
    const remainingLineCreditJmd = sourceLineAmountJmd - usedLineCreditJmd;
    stateInvariant(
      Number.isSafeInteger(remainingLineCreditJmd) && remainingLineCreditJmd >= 0,
      "BILLING_REFUND_LINE_CEILING",
      path,
    );
    const paymentsBefore = state.payments.filter((payment) => {
      if (payment.invoiceId !== refund.logicalInvoiceId) return false;
      stateInvariant(isValidIsoTimestamp(payment.receivedAt), "BILLING_REFUND_PAYMENT_TIME", path);
      if (!Object.prototype.hasOwnProperty.call(payment, "paymentContract")) return true;
      stateInvariant(isModernInvoicePaymentFact(payment), "BILLING_REFUND_PAYMENT_CONTRACT", path);
      return payment.committedRevision < receipt.committedRevision;
    });
    const refundInstant = Date.parse(refund.refundedAt);
    const legacyCashBefore = state.refunds.filter((candidate): candidate is LinkedLegacyInvoiceRefundFact => {
      if (Object.prototype.hasOwnProperty.call(candidate, "refundContract")) return false;
      const legacyCandidate = candidate as LinkedLegacyInvoiceRefundFact;
      if (legacyCandidate.invoiceId !== refund.logicalInvoiceId) return false;
      stateInvariant(isValidIsoTimestamp(legacyCandidate.refundedAt), "BILLING_REFUND_LEGACY_TIME", path);
      return Date.parse(legacyCandidate.refundedAt) <= refundInstant;
    });
    const netPaidBeforeJmd = billingStateSum(
      paymentsBefore.map((payment) => payment.amountJmd),
      "BILLING_REFUND_PAYMENT_AMOUNT",
      path,
    ) - billingStateSum([
      ...legacyCashBefore.map((candidate) => candidate.amountJmd),
      ...priorRefunds.map((candidate) => candidate.cashRefundJmd),
    ], "BILLING_REFUND_PRIOR_CASH", path);
    stateInvariant(Number.isSafeInteger(netPaidBeforeJmd) && netPaidBeforeJmd >= 0, "BILLING_REFUND_NET_PAID", path);
    let preview: ReturnType<typeof previewOrdinaryLineRefund> | undefined;
    try {
      preview = previewOrdinaryLineRefund({
        line,
        ...(refund.refundQuantity !== undefined ? { refundQuantity: refund.refundQuantity } : {}),
        ...(refund.wholeLine === true ? { wholeLine: true as const } : {}),
        receivableBeforeRefundJmd,
        netPaidBeforeJmd,
        remainingInvoiceCreditJmd,
        remainingLineCreditJmd,
        priorRefunds: priorRefunds.map((candidate) => ({
          chargeLineId: candidate.chargeLineId,
          ...(candidate.refundQuantity !== undefined ? { quantity: candidate.refundQuantity } : {}),
          receivableReductionJmd: candidate.receivableReductionJmd,
        })),
        legacyOccupancies: legacyOccupancies.filter((occupancy) => occupancy.status === "line").map((occupancy) => ({
          chargeLineId: occupancy.chargeLineId,
          amountJmd: occupancy.amountJmd,
          quantityUnknown: occupancy.quantityUnknown,
          ...(occupancy.legacyRefundQuantity !== undefined ? { quantity: occupancy.legacyRefundQuantity } : {}),
        })),
        legacyUnassignedOccupancyJmd: billingStateSum(
          legacyOccupancies.filter((occupancy) => occupancy.status === "unassigned")
            .map((occupancy) => occupancy.amountJmd),
          "BILLING_REFUND_UNASSIGNED",
          path,
        ),
      });
    } catch {
      stateInvariant(false, "BILLING_REFUND_SOURCE_RECOMPUTE", path);
    }
    stateInvariant(preview !== undefined, "BILLING_REFUND_SOURCE_RECOMPUTE", path);
    stateInvariant(
      preview.receivableReductionJmd === refund.receivableReductionJmd
        && preview.cashRefundJmd === refund.cashRefundJmd,
      "BILLING_REFUND_SOURCE_AMOUNT",
      path,
    );
    stateInvariant(refundIndex < orderedRefunds.length, "BILLING_REFUND_ORDER", path);
  });

  state.invoices.forEach((invoice) => {
    if (!isSharedChargeInvoice(invoice)) return;
    const effective = invoice.versions[invoice.versions.length - 1];
    const occupancies = [
      ...modernRefunds.filter((refund) => refund.logicalInvoiceId === invoice.id).map((refund) => ({
        chargeLineId: refund.chargeLineId,
        ...(refund.refundQuantity !== undefined ? { quantity: refund.refundQuantity } : {}),
        amountJmd: refund.receivableReductionJmd,
      })),
      ...state.legacyRefundOccupancies.filter((occupancy) => (
        occupancy.invoiceId === invoice.id && occupancy.status === "line" && occupancy.chargeLineId
      )).map((occupancy) => ({
        chargeLineId: occupancy.chargeLineId!,
        ...(occupancy.legacyRefundQuantity !== undefined ? { quantity: occupancy.legacyRefundQuantity } : {}),
        amountJmd: occupancy.amountJmd,
      })),
    ];
    try {
      validateInvoiceLineageTransition({
        // Include the effective version as the established lineage.  The pure
        // transition validator requires every occupied ID to exist in history.
        previousSnapshots: invoice.versions.map((version) => version.snapshot),
        nextSnapshot: effective.snapshot,
        refundOccupancies: occupancies,
      });
    } catch {
      stateInvariant(false, "INVOICE_SHARED_REFUND_LINEAGE", `$.invoices.${invoice.id}.versions`);
    }
  });
}

function parkingPaymentFinancialAtRevision(
  state: LinkedOperationsState,
  invoice: SharedChargeInvoice,
  version: SharedChargeInvoiceVersion,
  committedRevision: number,
): Record<string, unknown> {
  const refunds = state.refunds.filter((refund): refund is LinkedOrdinaryInvoiceRefundFact => {
    if (refund.refundContract !== "ordinary_line_v1" || refund.logicalInvoiceId !== invoice.id) return false;
    const receipt = state.mutationReceipts.find((candidate) => (
      candidate.operation === "billing.invoice.lineRefund" && candidate.mutationId === refund.mutationId
    ));
    return receipt !== undefined && receipt.committedRevision <= committedRevision;
  });
  const payments = state.payments.filter((payment): payment is ModernInvoicePaymentFact => (
    isModernInvoicePaymentFact(payment)
      && payment.invoiceId === invoice.id
      && payment.committedRevision <= committedRevision
  ));
  const receivableJmd = version.snapshot.totals.grandTotalJmd - billingStateSum(
    refunds.map((refund) => refund.receivableReductionJmd),
    "PARKING_PAYMENT_RECEIVABLE",
    `$.invoices.${invoice.id}`,
  );
  const grossPaidJmd = billingStateSum(
    payments.map((payment) => payment.amountJmd),
    "PARKING_PAYMENT_GROSS_PAID",
    `$.invoices.${invoice.id}`,
  );
  const cashRefundedJmd = billingStateSum(
    refunds.map((refund) => refund.cashRefundJmd),
    "PARKING_PAYMENT_CASH_REFUNDED",
    `$.invoices.${invoice.id}`,
  );
  const netPaidJmd = grossPaidJmd - cashRefundedJmd;
  const balanceJmd = receivableJmd - netPaidJmd;
  stateInvariant(
    Number.isSafeInteger(receivableJmd) && receivableJmd >= 0
      && Number.isSafeInteger(netPaidJmd) && netPaidJmd >= 0
      && Number.isSafeInteger(balanceJmd),
    "PARKING_PAYMENT_FINANCIAL",
    `$.invoices.${invoice.id}`,
  );
  return {
    receivableJmd,
    grossPaidJmd,
    cashRefundedJmd,
    netPaidJmd,
    balanceJmd,
    status: balanceJmd > 0 ? "due" : balanceJmd < 0 ? "overpaid" : "settled",
  };
}

function parkingPaymentProjectionExpectation(
  source: LinkedModernParkingSourceFact,
  asOf: string,
): Record<string, unknown> {
  const calendarDate = asOf.slice(0, 10);
  const latestDecision = source.waiverHistory[source.waiverHistory.length - 1];
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
  const projectionSource = JSON.stringify({
    contract: "parking_live_projection_v1",
    caseId: source.id,
    sourceRevision: source.revision,
    cumulativeWaivedDays: latestDecision?.cumulativeWaivedDays ?? 0,
    cumulativeWaivedAmountJmd: latestDecision?.cumulativeWaivedAmountJmd ?? 0,
    calendarDate,
    chargeableDays: liveAccrual.chargeableDays,
    grossAmountJmd: liveAccrual.originalAmountJmd,
    finalAmountJmd: liveFinal.finalAmountJmd,
  });
  return {
    caseId: source.id,
    projectionCommitment: stableSourceHash(projectionSource),
  };
}

function validateCanonicalParkingPaymentBindings(
  state: LinkedOperationsState,
  verifiedParkingSourceSnapshots: Map<string, Map<number, LinkedModernParkingSourceFact>>,
): void {
  const outerReceipts = state.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.pay");
  const referencedChildren = new Map<string, string>();
  outerReceipts.forEach((receipt, receiptIndex) => {
    const path = `$.mutationReceipts.parking.source.pay[${receiptIndex}]`;
    const payload = billingReceiptPayload(receipt, "PARKING_PAYMENT_RECEIPT", path);
    stateInvariant(
      payload.contract === "parking_payment_collect_v1"
        && (payload.status === "claimed" || payload.status === "unclaimed")
        && payload.mutationId === receipt.mutationId
        && !isTask8ReservedChildMutationId(receipt.mutationId)
        && typeof payload.caseId === "string" && payload.caseId.length > 0
        && Number.isSafeInteger(payload.expectedRevision) && Number(payload.expectedRevision) >= 1
        && Number.isSafeInteger(payload.expectedSourceRevision) && Number(payload.expectedSourceRevision) >= 1
        && Number.isSafeInteger(payload.amountJmd) && Number(payload.amountJmd) > 0
        && typeof payload.method === "string" && payload.method.length > 0
        && (payload.note === undefined || (typeof payload.note === "string" && payload.note.length > 0)),
      "PARKING_PAYMENT_PAYLOAD",
      path,
    );
    const payloadFields = payload.status === "claimed"
      ? PARKING_PAYMENT_CLAIMED_PAYLOAD_FIELDS
      : PARKING_PAYMENT_UNCLAIMED_PAYLOAD_FIELDS;
    const expectedPayloadSize = PARKING_PAYMENT_COMMON_PAYLOAD_FIELDS.length
      + (payload.note === undefined ? 0 : 1)
      + (payload.status === "claimed" ? 3 : 2)
      + (payload.status === "unclaimed" && payload.invoiceSignature !== undefined ? 1 : 0);
    stateInvariant(
      hasOnlyKeys(payload, payloadFields) && Object.keys(payload).length === expectedPayloadSize,
      "PARKING_PAYMENT_PAYLOAD_CLOSED",
      path,
    );
    stateInvariant(
      isPlainRecord(receipt.result)
        && hasOnlyKeys(receipt.result, PARKING_PAYMENT_RECEIPT_RESULT_FIELDS)
        && Object.keys(receipt.result).length === PARKING_PAYMENT_RECEIPT_RESULT_FIELDS.size
        && receipt.result.receiptContract === "parking_payment_collect_receipt_v1",
      "PARKING_PAYMENT_RESULT_CLOSED",
      `${path}.result`,
    );
    const result = receipt.result as Record<string, unknown>;
    const expectedPaymentChildId = task8ChildMutationId(receipt.mutationId, "invoice-payment");
    const expectedActivationChildId = payload.status === "unclaimed"
      ? task8ChildMutationId(receipt.mutationId, "invoice-activation")
      : null;
    stateInvariant(
      result.paymentChildMutationId === expectedPaymentChildId
        && result.activationChildMutationId === expectedActivationChildId,
      "PARKING_PAYMENT_CHILD_ID",
      `${path}.result`,
    );
    for (const childId of [expectedActivationChildId, expectedPaymentChildId]) {
      if (childId === null) continue;
      stateInvariant(!referencedChildren.has(childId), "PARKING_PAYMENT_CHILD_REUSE", `${path}.result`);
      referencedChildren.set(childId, receipt.mutationId);
    }
    const paymentReceipt = state.mutationReceipts.find((candidate) => (
      candidate.operation === "billing.invoice.payment" && candidate.mutationId === expectedPaymentChildId
    ));
    stateInvariant(paymentReceipt !== undefined, "PARKING_PAYMENT_CHILD_RECEIPT", `${path}.paymentChild`);
    const payment = state.payments.find((candidate): candidate is ModernInvoicePaymentFact => (
      isModernInvoicePaymentFact(candidate) && candidate.mutationId === expectedPaymentChildId
    ));
    stateInvariant(payment !== undefined, "PARKING_PAYMENT_CHILD_FACT", `${path}.paymentChild`);
    const paymentPayload = paymentReceipt === undefined
      ? undefined
      : billingReceiptPayload(paymentReceipt, "PARKING_PAYMENT_CHILD_RECEIPT", `${path}.paymentChild`);
    stateInvariant(
      paymentReceipt !== undefined
        && payment !== undefined
        && paymentReceipt.actorId === receipt.actorId
        && paymentReceipt.committedAt === receipt.committedAt
        && paymentReceipt.committedRevision === receipt.committedRevision
        && isPlainRecord(paymentPayload)
        && paymentPayload.mutationId === expectedPaymentChildId
        && paymentPayload.amountJmd === payload.amountJmd
        && paymentPayload.method === payload.method
        && paymentPayload.note === payload.note,
      "PARKING_PAYMENT_CHILD_BINDING",
      `${path}.paymentChild`,
    );
    stateInvariant(
      isPlainRecord(result.publicResult)
        && hasOnlyKeys(result.publicResult, PARKING_PAYMENT_PUBLIC_RESULT_FIELDS)
        && Object.keys(result.publicResult).length === PARKING_PAYMENT_PUBLIC_RESULT_FIELDS.size,
      "PARKING_PAYMENT_PUBLIC_RESULT_CLOSED",
      `${path}.result.publicResult`,
    );
    const publicResult = result.publicResult as Record<string, unknown>;
    stateInvariant(
      publicResult.revision === receipt.committedRevision
        && publicResult.caseId === payload.caseId
        && isPlainRecord(publicResult.claim)
        && hasOnlyKeys(publicResult.claim, PARKING_PAYMENT_PUBLIC_CLAIM_FIELDS)
        && Object.keys(publicResult.claim).length === PARKING_PAYMENT_PUBLIC_CLAIM_FIELDS.size
        && isPlainRecord(publicResult.payment)
        && hasOnlyKeys(publicResult.payment, PARKING_PAYMENT_PUBLIC_PAYMENT_FIELDS)
        && Object.keys(publicResult.payment).length === (payment?.note === undefined ? 7 : 8)
        && isPlainRecord(publicResult.financial)
        && hasOnlyKeys(publicResult.financial, PARKING_PAYMENT_PUBLIC_FINANCIAL_FIELDS)
        && Object.keys(publicResult.financial).length === PARKING_PAYMENT_PUBLIC_FINANCIAL_FIELDS.size
        && Array.isArray(publicResult.sourceTransitions),
      "PARKING_PAYMENT_PUBLIC_RESULT_SHAPE",
      `${path}.result.publicResult`,
    );
    const invoice = payment === undefined
      ? undefined
      : state.invoices.find((candidate) => candidate.id === payment.invoiceId);
    const version = invoice && isSharedChargeInvoice(invoice)
      ? invoice.versions.find((candidate) => candidate.id === payment.invoiceVersionId)
      : undefined;
    const parkingLine = version?.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
      line.pricingMode === "parking_projection" && line.parkingCaseId === payload.caseId
    ));
    stateInvariant(
      payment !== undefined && invoice !== undefined && isSharedChargeInvoice(invoice)
        && version !== undefined && parkingLine !== undefined,
      "PARKING_PAYMENT_INVOICE_SOURCE",
      path,
    );
    const expectedClaim = {
      caseId: payload.caseId,
      invoiceId: payment!.invoiceId,
      effectiveVersionId: payment!.invoiceVersionId,
      chargeLineId: parkingLine!.chargeLineId,
    };
    const expectedPayment = {
      id: payment!.id,
      invoiceId: payment!.invoiceId,
      effectiveVersionId: payment!.invoiceVersionId,
      amountJmd: payment!.amountJmd,
      method: payment!.method,
      ...(payment!.note !== undefined ? { note: payment!.note } : {}),
      receivedAt: payment!.receivedAt,
      receivedBy: payment!.receivedBy,
    };
    const expectedFinancial = parkingPaymentFinancialAtRevision(
      state,
      invoice as SharedChargeInvoice,
      version!,
      receipt.committedRevision,
    );
    let expectedActivatedInvoice: Record<string, unknown> | null = null;
    let expectedTransitions: Record<string, unknown>[] = [];
    if (payload.status === "claimed") {
      stateInvariant(
        result.activationChildMutationId === null
          && payload.invoiceId === payment!.invoiceId
          && payload.effectiveVersionId === payment!.invoiceVersionId
          && payload.balanceJmd === Number(expectedFinancial.balanceJmd) + payment!.amountJmd
          && Number(payload.expectedRevision) + 1 === receipt.committedRevision
          && paymentPayload?.expectedRevision === payload.expectedRevision
          && publicResult.activatedInvoice === null
          && Array.isArray(publicResult.sourceTransitions) && publicResult.sourceTransitions.length === 0
          && payload.expectedSourceRevision === parkingLine!.sourceRevision,
        "PARKING_PAYMENT_CLAIMED_BINDING",
        path,
      );
    } else {
      const activationReceipt = state.mutationReceipts.find((candidate) => (
        candidate.operation === "billing.invoice.activate" && candidate.mutationId === expectedActivationChildId
      ));
      stateInvariant(activationReceipt !== undefined, "PARKING_PAYMENT_ACTIVATION_CHILD", `${path}.activationChild`);
      const activationPayload = activationReceipt === undefined
        ? undefined
        : billingReceiptPayload(activationReceipt, "PARKING_PAYMENT_ACTIVATION_CHILD", `${path}.activationChild`);
      stateInvariant(
        activationReceipt !== undefined
          && activationReceipt.actorId === receipt.actorId
          && activationReceipt.committedAt === receipt.committedAt
          && activationReceipt.committedRevision + 1 === receipt.committedRevision
          && isPlainRecord(activationPayload)
          && activationPayload.orderId === payload.carrierBusinessOrderId
          && activationPayload.mutationId === expectedActivationChildId
          && activationPayload.expectedRevision === payload.expectedRevision
          && paymentPayload?.invoiceId === payment!.invoiceId
          && paymentPayload?.expectedRevision === activationReceipt.committedRevision
          && Number(payload.expectedRevision) + 2 === receipt.committedRevision,
        "PARKING_PAYMENT_ACTIVATION_BINDING",
        `${path}.activationChild`,
      );
      stateInvariant(
        isPlainRecord(activationReceipt?.result)
          && activationReceipt.result.invoiceId === payment!.invoiceId
          && activationReceipt.result.invoiceVersionId === payment!.invoiceVersionId
          && Array.isArray(activationReceipt.result.parkingSourceTransitions),
        "PARKING_PAYMENT_ACTIVATION_RESULT",
        `${path}.activationChild.result`,
      );
      expectedActivatedInvoice = {
        invoiceId: invoice!.id,
        invoiceNo: invoice!.invoiceNo,
        effectiveVersionId: version!.id,
        version: version!.version,
        snapshotCommitment: version!.snapshotCommitment,
      };
      const rawTransitions = activationReceipt!.result.parkingSourceTransitions as Array<Record<string, unknown>>;
      expectedTransitions = rawTransitions.map((transition) => {
        const transitionLine = version!.snapshot.lines.find((line): line is InvoiceParkingSnapshotLine => (
          line.pricingMode === "parking_projection" && line.parkingCaseId === transition.caseId
        ));
        stateInvariant(
          isPlainRecord(transition.sourceBefore)
            && isPlainRecord(transition.parkingSource)
            && transitionLine !== undefined,
          "PARKING_PAYMENT_TRANSITION_SOURCE",
          `${path}.sourceTransitions`,
        );
        return {
          caseId: transition.caseId,
          sourceRevisionBefore: transition.sourceBefore.revision,
          sourceRevisionAfter: transition.parkingSource.revision,
          amountJmd: transitionLine!.amountJmd,
        };
      });
      stateInvariant(
        isPlainRecord(publicResult.activatedInvoice)
          && hasOnlyKeys(publicResult.activatedInvoice, PARKING_PAYMENT_PUBLIC_ACTIVATED_INVOICE_FIELDS)
          && Object.keys(publicResult.activatedInvoice).length === PARKING_PAYMENT_PUBLIC_ACTIVATED_INVOICE_FIELDS.size
          && Array.isArray(payload.sourceProjections)
          && payload.sourceProjections.every((projection) => (
            isPlainRecord(projection)
              && hasOnlyKeys(projection, PARKING_PAYMENT_SOURCE_PROJECTION_FIELDS)
              && Object.keys(projection).length === PARKING_PAYMENT_SOURCE_PROJECTION_FIELDS.size
              && typeof projection.caseId === "string" && projection.caseId.length > 0
              && typeof projection.projectionCommitment === "string" && projection.projectionCommitment.length > 0
          ))
          && (payload.sourceProjections as Array<Record<string, unknown>>)
            .some((projection) => projection.caseId === payload.caseId),
        "PARKING_PAYMENT_UNCLAIMED_SHAPE",
        path,
      );
      const previousVersion = invoice!.versions.find((candidate) => candidate.version === version!.version - 1);
      const previousCaseIds = new Set((previousVersion?.snapshot.lines ?? []).flatMap((line) => (
        line.pricingMode === "parking_projection" ? [line.parkingCaseId] : []
      )));
      const newlyClaimedLines = version!.snapshot.lines.filter((line): line is InvoiceParkingSnapshotLine => (
        line.pricingMode === "parking_projection" && !previousCaseIds.has(line.parkingCaseId)
      ));
      const sourceBeforeForLine = (line: InvoiceParkingSnapshotLine): LinkedModernParkingSourceFact | undefined => {
        const transition = rawTransitions.find((candidate) => candidate.caseId === line.parkingCaseId);
        if (transition && isPlainRecord(transition.sourceBefore)) {
          return transition.sourceBefore as unknown as LinkedModernParkingSourceFact;
        }
        return verifiedParkingSourceSnapshots.get(line.parkingCaseId)?.get(line.sourceRevision);
      };
      const expectedProjectionSet = newlyClaimedLines.map((line) => {
        const sourceBefore = sourceBeforeForLine(line);
        stateInvariant(
          sourceBefore !== undefined,
          "PARKING_PAYMENT_UNCLAIMED_SOURCE_HISTORY",
          `${path}.payload.sourceProjections.${line.parkingCaseId}`,
        );
        return parkingPaymentProjectionExpectation(sourceBefore, receipt.committedAt);
      }).sort((left, right) => String(left.caseId).localeCompare(String(right.caseId)));
      const targetLine = newlyClaimedLines.find((line) => line.parkingCaseId === payload.caseId);
      const targetSourceBefore = targetLine === undefined ? undefined : sourceBeforeForLine(targetLine);
      stateInvariant(
        newlyClaimedLines.length > 0
          && targetSourceBefore !== undefined
          && payload.expectedSourceRevision === targetSourceBefore.revision
          && stableJson(payload.sourceProjections) === stableJson(expectedProjectionSet)
          && Object.prototype.hasOwnProperty.call(payload, "invoiceSignature")
            === Object.prototype.hasOwnProperty.call(activationPayload!, "signature")
          && stableJson(payload.invoiceSignature) === stableJson(activationPayload!.signature),
        "PARKING_PAYMENT_UNCLAIMED_INTENT_BINDING",
        path,
      );
    }
    stateInvariant(
      stableJson(publicResult.claim) === stableJson(expectedClaim)
        && stableJson(publicResult.payment) === stableJson(expectedPayment)
        && stableJson(publicResult.financial) === stableJson(expectedFinancial)
        && stableJson(publicResult.activatedInvoice) === stableJson(expectedActivatedInvoice)
        && stableJson(publicResult.sourceTransitions) === stableJson(expectedTransitions),
      "PARKING_PAYMENT_PUBLIC_RESULT_BINDING",
      `${path}.result.publicResult`,
    );
  });
  const reservedChildReceipts = state.mutationReceipts.filter((receipt) => (
    isTask8ReservedChildMutationId(receipt.mutationId)
  ));
  stateInvariant(
    reservedChildReceipts.length === referencedChildren.size
      && reservedChildReceipts.every((receipt) => referencedChildren.has(receipt.mutationId)),
    "PARKING_PAYMENT_CHILD_REVERSE",
    "$.mutationReceipts",
  );
}

function modernParkingImmutableCoordinates(source: LinkedModernParkingSourceFact): Record<string, unknown> {
  return {
    id: source.id,
    parkingContract: source.parkingContract,
    originBusinessOrderId: source.originBusinessOrderId,
    eligibleBusinessOrderIds: source.eligibleBusinessOrderIds,
    vehicleId: source.vehicleId,
    notificationDate: source.notificationDate,
    dailyRateJmd: source.dailyRateJmd,
  };
}

function validateClosedModernParkingSourceSnapshot(
  value: unknown,
  path: string,
  options: { readonly initial?: boolean } = {},
): LinkedModernParkingSourceFact {
  stateInvariant(
    hasExactEnumerableDataFields(
      value,
      MODERN_PARKING_SOURCE_FIELDS,
      MODERN_PARKING_SOURCE_REQUIRED_FIELDS,
    ),
    "PARKING_SOURCE_SNAPSHOT_CLOSED",
    path,
  );
  const source = value as unknown as LinkedModernParkingSourceFact;
  stateInvariant(
    source.parkingContract === "parking_source_v1"
      && typeof source.id === "string" && source.id.length > 0
      && typeof source.originBusinessOrderId === "string" && source.originBusinessOrderId.length > 0
      && uniqueStringValues(source.eligibleBusinessOrderIds)
      && source.eligibleBusinessOrderIds.length > 0
      && source.eligibleBusinessOrderIds.includes(source.originBusinessOrderId)
      && typeof source.vehicleId === "string" && source.vehicleId.length > 0
      && /^\d{4}-\d{2}-\d{2}$/u.test(source.notificationDate)
      && (source.pickupDate === undefined || /^\d{4}-\d{2}-\d{2}$/u.test(source.pickupDate))
      && isJamaicaInstant(source.asOf)
      && Number.isSafeInteger(source.dailyRateJmd) && source.dailyRateJmd > 0
      && Number.isSafeInteger(source.revision) && source.revision >= 1,
    "PARKING_SOURCE_SNAPSHOT_FIELDS",
    path,
  );
  stateInvariant(
    isPlainRecord(source.accrual)
      && hasOnlyKeys(source.accrual as unknown as Record<string, unknown>, PARKING_ACCRUAL_FIELDS)
      && Object.keys(source.accrual).length === PARKING_ACCRUAL_FIELDS.size
      && Number.isSafeInteger(source.accrual.chargeableDays) && source.accrual.chargeableDays >= 0
      && Number.isSafeInteger(source.accrual.originalAmountJmd) && source.accrual.originalAmountJmd >= 0
      && Number.isSafeInteger(source.accrual.chargeableDays * source.dailyRateJmd)
      && source.accrual.originalAmountJmd === source.accrual.chargeableDays * source.dailyRateJmd,
    "PARKING_SOURCE_SNAPSHOT_ACCRUAL",
    `${path}.accrual`,
  );
  stateInvariant(
    Array.isArray(source.waiverHistory)
      && Array.isArray(source.waiverReasons)
      && source.waiverHistory.length === source.waiverReasons.length
      && source.waiverReasons.every((reason) => typeof reason === "string" && reason.length > 0),
    "PARKING_SOURCE_SNAPSHOT_WAIVERS",
    path,
  );
  source.waiverHistory.forEach((decision, index) => {
    stateInvariant(
      isPlainRecord(decision)
        && hasOnlyKeys(decision as unknown as Record<string, unknown>, MODERN_PARKING_WAIVER_DECISION_FIELDS)
        && Object.keys(decision).length === MODERN_PARKING_WAIVER_DECISION_FIELDS.size
        && decision.waiverContract === "parking_waiver_decision_v1"
        && decision.caseId === source.id
        && typeof decision.sourceRevision === "number"
        && Number.isSafeInteger(decision.sourceRevision) && decision.sourceRevision >= 1
        && isJamaicaInstant(decision.sourceAsOf),
      "PARKING_SOURCE_SNAPSHOT_WAIVER_CLOSED",
      `${path}.waiverHistory[${index}]`,
    );
  });
  try {
    const asOfDate = source.asOf.slice(0, 10);
    const accrualEndDate = source.pickupDate ?? asOfDate;
    const asOfAt = parseParkingCalendarDate(asOfDate, "parking source snapshot as-of date");
    const accrualEndAt = parseParkingCalendarDate(accrualEndDate, "parking source snapshot accrual date");
    if (asOfAt < accrualEndAt) throw new RangeError("parking source snapshot as-of precedes accrual end");
    stateInvariant(
      stableJson(source.accrual) === stableJson(calculateParkingAccrual({
        notificationDate: source.notificationDate,
        pickupDate: accrualEndDate,
        dailyRateJmd: source.dailyRateJmd,
      })),
      "PARKING_SOURCE_SNAPSHOT_ACCRUAL_BINDING",
      `${path}.accrual`,
    );
  } catch {
    stateInvariant(false, "PARKING_SOURCE_SNAPSHOT_CALENDAR", path);
  }
  if (options.initial) {
    stateInvariant(
      source.revision === 1
        && source.pickupDate === undefined
        && source.waiverHistory.length === 0
        && source.waiverReasons.length === 0,
      "PARKING_SOURCE_SNAPSHOT_INITIAL",
      path,
    );
  }
  return source;
}

function parkingWaiverResultProjection(
  decision: LinkedModernParkingWaiverDecision,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of PARKING_WAIVER_FIELDS) result[field] = decision[field as keyof LinkedModernParkingWaiverDecision];
  return result;
}

function validateModernParkingPreviewToken(
  tokenValue: unknown,
  receipt: LinkedMutationReceipt,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
  path: string,
): LinkedModernParkingCorrectionPreviewToken {
  stateInvariant(
    hasExactEnumerableDataFields(
      tokenValue,
      MODERN_PARKING_PREVIEW_TOKEN_FIELDS,
      MODERN_PARKING_PREVIEW_TOKEN_REQUIRED_FIELDS,
    ),
    "PARKING_SOURCE_PREVIEW_TOKEN_CLOSED",
    path,
  );
  const token = tokenValue as unknown as LinkedModernParkingCorrectionPreviewToken;
  stateInvariant(
    token.previewContract === "parking_correction_preview_v1"
      && typeof token.id === "string" && token.id.startsWith("pwp_") && token.id.length > 4
      && typeof token.previewMutationId === "string" && token.previewMutationId === receipt.mutationId
      && typeof token.caseId === "string" && token.caseId === payload.caseId
      && Number.isSafeInteger(token.sourceRevision) && token.sourceRevision >= 1
      && Number.isSafeInteger(token.waiveDays) && token.waiveDays > 0
      && token.waiveDays === payload.waiveDays
      && typeof token.reason === "string" && token.reason.length > 0 && token.reason === payload.reason,
    "PARKING_SOURCE_PREVIEW_TOKEN_IDENTITY",
    path,
  );
  stateInvariant(
    Number.isSafeInteger(token.ledgerHighWaterRevision) && token.ledgerHighWaterRevision >= 0
      && Number.isSafeInteger(token.oldParkingAmountJmd) && token.oldParkingAmountJmd >= 0
      && Number.isSafeInteger(token.newParkingAmountJmd) && token.newParkingAmountJmd >= 0
      && Number.isSafeInteger(token.parkingDeltaJmd)
      && Number.isSafeInteger(token.parkingCashRefundJmd) && token.parkingCashRefundJmd >= 0
      && typeof token.parkingAdministratorSignatureRequired === "boolean"
      && typeof token.invoiceSignatureRequired === "boolean",
    "PARKING_SOURCE_PREVIEW_TOKEN_AMOUNTS",
    path,
  );
  stateInvariant(
    isJamaicaInstant(token.issuedAt) && token.issuedAt === receipt.committedAt
      && isJamaicaInstant(token.expiresAt)
      && Date.parse(token.expiresAt) - Date.parse(token.issuedAt) === 5 * 60 * 1_000
      && (token.consumedAt === undefined || isJamaicaInstant(token.consumedAt)),
    "PARKING_SOURCE_PREVIEW_TOKEN_TIME",
    path,
  );
  const sourceStored = validateClosedModernParkingSourceSnapshot(token.sourceStored, `${path}.sourceStored`);
  const sourceBefore = validateClosedModernParkingSourceSnapshot(token.sourceBefore, `${path}.sourceBefore`);
  const nextParkingSource = validateClosedModernParkingSourceSnapshot(
    token.nextParkingSource,
    `${path}.nextParkingSource`,
  );
  const expectedMaterialized: LinkedModernParkingSourceFact = {
    ...sourceStored,
    revision: sourceStored.revision + 1,
    asOf: receipt.committedAt,
    accrual: calculateParkingAccrual({
      notificationDate: sourceStored.notificationDate,
      pickupDate: sourceStored.pickupDate ?? receipt.committedAt.slice(0, 10),
      dailyRateJmd: sourceStored.dailyRateJmd,
    }),
  };
  stateInvariant(
    (token.claim === null
      ? stableJson(sourceBefore) === stableJson(expectedMaterialized)
      : stableJson(sourceBefore) === stableJson(sourceStored))
      && token.sourceRevision === sourceBefore.revision,
    "PARKING_SOURCE_PREVIEW_MATERIALIZATION",
    `${path}.sourceBefore`,
  );
  const previousDecision = sourceStored.waiverHistory[sourceStored.waiverHistory.length - 1];
  let expectedDecision: LinkedModernParkingWaiverDecision | undefined;
  try {
    const proposedWaivedAmountJmd = token.waiveDays * sourceBefore.dailyRateJmd;
    stateInvariant(Number.isSafeInteger(proposedWaivedAmountJmd), "PARKING_SOURCE_PREVIEW_WAIVER", path);
    expectedDecision = {
      waiverContract: "parking_waiver_decision_v1",
      sourceRevision: sourceBefore.revision,
      sourceAsOf: sourceBefore.asOf,
      ...validateParkingWaiver({
        caseId: sourceBefore.id,
        originalChargeableDays: sourceBefore.accrual.chargeableDays,
        dailyRateJmd: sourceBefore.dailyRateJmd,
        existingWaivedDays: previousDecision?.cumulativeWaivedDays ?? 0,
        existingWaivedAmountJmd: previousDecision?.cumulativeWaivedAmountJmd ?? 0,
        proposedWaivedDays: token.waiveDays,
        proposedWaivedAmountJmd,
      }),
    };
  } catch {
    stateInvariant(false, "PARKING_SOURCE_PREVIEW_WAIVER", `${path}.decision`);
  }
  stateInvariant(
    expectedDecision !== undefined && stableJson(token.decision) === stableJson(expectedDecision),
    "PARKING_SOURCE_PREVIEW_DECISION",
    `${path}.decision`,
  );
  const expectedNextSource: LinkedModernParkingSourceFact = {
    ...sourceBefore,
    revision: sourceBefore.revision + 1,
    asOf: receipt.committedAt,
    waiverHistory: [...sourceBefore.waiverHistory, expectedDecision!],
    waiverReasons: [...sourceBefore.waiverReasons, token.reason],
  };
  stateInvariant(
    stableJson(nextParkingSource) === stableJson(expectedNextSource),
    "PARKING_SOURCE_PREVIEW_NEXT_SOURCE",
    `${path}.nextParkingSource`,
  );
  const oldFinal = deriveParkingFinalAccrual({
    currentAccrual: sourceBefore.accrual,
    dailyRateJmd: sourceBefore.dailyRateJmd,
    latestWaiverDecision: previousDecision,
  });
  const newFinal = deriveParkingFinalAccrual({
    currentAccrual: nextParkingSource.accrual,
    dailyRateJmd: nextParkingSource.dailyRateJmd,
    latestWaiverDecision: expectedDecision,
  });
  if (token.claim === null) {
    const amounts = calculateParkingCorrectionAmounts({
      oldParkingAmountJmd: oldFinal.finalAmountJmd,
      newParkingAmountJmd: newFinal.finalAmountJmd,
      receivableAfterCorrectionJmd: newFinal.finalAmountJmd,
      netPaidBeforeJmd: 0,
    });
    stateInvariant(
      token.ledgerHighWaterRevision === 0
        && token.nextInvoiceVersion === null
        && token.nextSnapshotCommitment === null
        && token.oldParkingAmountJmd === oldFinal.finalAmountJmd
        && token.newParkingAmountJmd === newFinal.finalAmountJmd
        && token.parkingDeltaJmd === amounts.parkingDeltaJmd
        && token.parkingCashRefundJmd === amounts.parkingCashRefundJmd
        && token.parkingAdministratorSignatureRequired === expectedDecision!.requiresAdministratorSignature
        && token.invoiceSignatureRequired === false,
      "PARKING_SOURCE_PREVIEW_UNCLAIMED_DERIVED",
      path,
    );
  } else {
    stateInvariant(
      hasExactEnumerableDataFields(token.claim, ACTIVE_PARKING_CLAIM_FIELDS, ACTIVE_PARKING_CLAIM_FIELDS)
        && typeof token.claim.logicalInvoiceId === "string" && token.claim.logicalInvoiceId.length > 0
        && typeof token.claim.financiallyEffectiveVersionId === "string"
        && token.claim.financiallyEffectiveVersionId.length > 0
        && typeof token.claim.chargeLineId === "string" && token.claim.chargeLineId.length > 0
        && token.nextInvoiceVersion !== null
        && typeof token.nextSnapshotCommitment === "string",
      "PARKING_SOURCE_PREVIEW_CLAIMED_SHAPE",
      path,
    );
  }
  const expectedResult = {
    ...parkingWaiverResultProjection(expectedDecision!),
    latestRevision: receipt.committedRevision,
    sourceRevision: token.sourceRevision,
    nextSourceRevision: token.nextParkingSource.revision,
    sourceAsOf: token.sourceBefore.asOf,
    previewToken: token.id,
    expiresAt: token.expiresAt,
    parkingAdministratorSignatureRequired: token.parkingAdministratorSignatureRequired,
    invoiceSignatureRequired: token.invoiceSignatureRequired,
    claimedInvoiceId: token.claim?.logicalInvoiceId ?? null,
    claimedInvoiceVersionId: token.claim?.financiallyEffectiveVersionId ?? null,
    nextInvoiceVersionId: token.nextInvoiceVersion?.id ?? null,
    nextSnapshotCommitment: token.nextSnapshotCommitment,
    parkingDeltaJmd: token.parkingDeltaJmd,
    parkingCashRefundJmd: token.parkingCashRefundJmd,
    sourceBefore: token.sourceStored,
    parkingSource: token.sourceBefore,
  };
  stateInvariant(
    stableJson(result) === stableJson(expectedResult),
    "PARKING_SOURCE_PREVIEW_RESULT_BINDING",
    `${path}.result`,
  );
  return token;
}

function validateCanonicalParkingSourceBindings(
  state: LinkedOperationsState,
): Map<string, Map<number, LinkedModernParkingSourceFact>> {
  const legacyTakeoverReceipts = new Map<string, LinkedLegacyQuickParkingTakeoverReceipt>();
  const receipts = state.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.create");
  const boundSourceIds = new Set<string>();
  const boundOrderIds = new Set<string>();
  const explainedPickupNoticeOrderIds = new Set<string>();
  const verifiedSnapshots = new Map<string, Map<number, LinkedModernParkingSourceFact>>();
  const verifiedSnapshotCommittedRevisions = new Map<string, Map<number, number>>();
  const chainTails = new Map<string, LinkedModernParkingSourceFact>();
  const chainLastCommittedRevision = new Map<string, number>();
  const validatedPreviewTokenIds = new Set<string>();
  (state.legacyQuickParkingTakeoverOrigins ?? []).forEach((origin, originIndex) => {
    const path = `$.legacyQuickParkingTakeoverOrigins[${originIndex}]`;
    const receipt = legacyTakeoverReceipts.get(origin.takeoverId);
    const source = state.parkingCases.find((candidate) => candidate.id === origin.id);
    stateInvariant(
      receipt !== undefined
        && source !== undefined
        && isModernParkingSourceFact(source)
        && stableJson(modernParkingImmutableCoordinates(source))
          === stableJson(modernParkingImmutableCoordinates(origin.initialSource))
        && source.revision >= origin.initialSource.revision
        && Date.parse(source.asOf) >= Date.parse(origin.initialSource.asOf)
        && !boundSourceIds.has(origin.id),
      "LEGACY_QUICK_PARKING_SOURCE_BINDING",
      path,
    );
    stateInvariant(
      origin.eligibleBusinessOrderIds.every((orderId) => !boundOrderIds.has(orderId)),
      "LEGACY_QUICK_PARKING_ORDER_BINDING",
      `${path}.eligibleBusinessOrderIds`,
    );
    boundSourceIds.add(origin.id);
    origin.eligibleBusinessOrderIds.forEach((orderId) => {
      boundOrderIds.add(orderId);
      explainedPickupNoticeOrderIds.add(orderId);
    });
    verifiedSnapshots.set(origin.id, new Map([[origin.initialSource.revision, structuredClone(origin.initialSource)]]));
    verifiedSnapshotCommittedRevisions.set(
      origin.id,
      new Map([[origin.initialSource.revision, receipt.committedRevision]]),
    );
    chainTails.set(origin.id, structuredClone(origin.initialSource));
    chainLastCommittedRevision.set(origin.id, receipt.committedRevision);
  });
  (state.legacyQuickParkingIsolates ?? []).forEach((isolate) => {
    isolate.canonicalRefs.quickOrderIds.forEach((orderId) => explainedPickupNoticeOrderIds.add(orderId));
  });
  receipts.forEach((receipt, receiptIndex) => {
    const path = `$.mutationReceipts.parkingSourceCreate[${receiptIndex}]`;
    const payload = billingReceiptPayload(receipt, "PARKING_SOURCE_CREATE_RECEIPT", path);
    stateInvariant(
      hasOnlyKeys(payload, PARKING_SOURCE_CREATE_PAYLOAD_FIELDS)
        && Object.keys(payload).length === PARKING_SOURCE_CREATE_PAYLOAD_FIELDS.size,
      "PARKING_SOURCE_CREATE_PAYLOAD_CLOSED",
      `${path}.payload`,
    );
    stateInvariant(
      typeof payload.orderId === "string" && payload.orderId.length > 0
        && typeof payload.mutationId === "string" && payload.mutationId === receipt.mutationId
        && Number.isSafeInteger(payload.expectedRevision)
        && Number(payload.expectedRevision) + 1 === receipt.committedRevision
        && Array.isArray(payload.channels) && payload.channels.length > 0,
      "PARKING_SOURCE_CREATE_PAYLOAD",
      `${path}.payload`,
    );
    const inputKinds = new Set<string>();
    (payload.channels as unknown[]).forEach((candidate, channelIndex) => {
      const channelPath = `${path}.payload.channels[${channelIndex}]`;
      stateInvariant(
        isPlainRecord(candidate)
          && hasOnlyKeys(candidate, PARKING_PICKUP_INPUT_CHANNEL_FIELDS)
          && Object.keys(candidate).length === PARKING_PICKUP_INPUT_CHANNEL_FIELDS.size
          && (candidate.kind === "sms" || candidate.kind === "whatsapp" || candidate.kind === "email")
          && !inputKinds.has(candidate.kind)
          && (candidate.language === "zh" || candidate.language === "en")
          && typeof candidate.text === "string" && candidate.text.length > 0,
        "PARKING_SOURCE_CREATE_CHANNEL",
        channelPath,
      );
      inputKinds.add(String(candidate.kind));
    });

    stateInvariant(isPlainRecord(receipt.result), "PARKING_SOURCE_CREATE_RESULT", `${path}.result`);
    const result = receipt.result as Record<string, unknown>;
    stateInvariant(
      hasOnlyKeys(result, PARKING_SOURCE_CREATE_RESULT_FIELDS)
        && Object.keys(result).length === PARKING_SOURCE_CREATE_RESULT_FIELDS.size
        && result.revision === receipt.committedRevision
        && result.orderId === payload.orderId
        && isPlainRecord(result.pickupNotice)
        && isPlainRecord(result.parkingSource),
      "PARKING_SOURCE_CREATE_RESULT_CLOSED",
      `${path}.result`,
    );
    const notice = result.pickupNotice as Record<string, unknown>;
    const canonicalActor = canonicalBillingActorIdentity("parking.source.create", receipt.actorId);
    const origin = validateClosedModernParkingSourceSnapshot(
      result.parkingSource,
      `${path}.result.parkingSource`,
      { initial: true },
    );
    stateInvariant(
      hasOnlyKeys(notice, PARKING_PICKUP_NOTICE_FIELDS)
        && Object.keys(notice).length === PARKING_PICKUP_NOTICE_FIELDS.size
        && notice.notifiedAt === receipt.committedAt
        && canonicalActor !== null
        && notice.notifiedBy === canonicalActor.name
        && Array.isArray(notice.channels)
        && notice.channels.length === (payload.channels as unknown[]).length,
      "PARKING_SOURCE_CREATE_NOTICE",
      `${path}.result.pickupNotice`,
    );
    (notice.channels as unknown[]).forEach((candidate, channelIndex) => {
      const inputChannel = (payload.channels as Array<Record<string, unknown>>)[channelIndex];
      const channelPath = `${path}.result.pickupNotice.channels[${channelIndex}]`;
      stateInvariant(
        isPlainRecord(candidate)
          && hasOnlyKeys(candidate, PARKING_PICKUP_RESULT_CHANNEL_FIELDS)
          && Object.keys(candidate).length === PARKING_PICKUP_RESULT_CHANNEL_FIELDS.size
          && candidate.id === `${String(payload.orderId)}-pickup-${channelIndex + 1}`
          && candidate.kind === inputChannel?.kind
          && candidate.language === inputChannel?.language
          && candidate.text === inputChannel?.text
          && candidate.sentBy === notice.notifiedBy
          && candidate.sentAt === receipt.committedAt,
        "PARKING_SOURCE_CREATE_NOTICE_CHANNEL",
        channelPath,
      );
    });
    const order = state.quickOrders.find((candidate) => candidate.id === payload.orderId);
    const source = state.parkingCases.find((candidate) => candidate.id === origin.id);
    stateInvariant(
      order !== undefined && isSharedChargeQuickOrder(order)
        && stableJson(order.pickupNotice) === stableJson(notice),
      "PARKING_SOURCE_CREATE_ORDER_BINDING",
      path,
    );
    const matchingOrigins = state.parkingSourceOrigins.filter((candidate) => candidate.id === origin.id);
    const independentOrigin = matchingOrigins[0];
    stateInvariant(
      isModernParkingSourceFact(origin)
        && origin.id === `parking-source-${origin.vehicleId}-r${receipt.committedRevision}`
        && origin.originBusinessOrderId === payload.orderId
        && Array.isArray(origin.eligibleBusinessOrderIds)
        && origin.eligibleBusinessOrderIds.includes(String(payload.orderId))
        && origin.vehicleId === order?.vehicleId
        && origin.notificationDate === receipt.committedAt.slice(0, 10)
        && origin.pickupDate === undefined
        && origin.dailyRateJmd === 2_500
        && origin.revision === 1
        && origin.asOf === receipt.committedAt
        && stableJson(origin.accrual) === stableJson({ chargeableDays: 0, originalAmountJmd: 0 })
        && origin.waiverHistory.length === 0
        && origin.waiverReasons.length === 0,
      "PARKING_SOURCE_CREATE_ORIGIN",
      `${path}.result.parkingSource`,
    );
    const independentInitialSource = independentOrigin === undefined
      ? undefined
      : validateClosedModernParkingSourceSnapshot(
        independentOrigin.initialSource,
        `${path}.origin.initialSource`,
        { initial: true },
      );
    stateInvariant(
      matchingOrigins.length === 1
        && independentOrigin !== undefined
        && hasOnlyKeys(independentOrigin as unknown as Record<string, unknown>, PARKING_SOURCE_ORIGIN_FIELDS)
        && Object.keys(independentOrigin).length === PARKING_SOURCE_ORIGIN_FIELDS.size
        && independentOrigin.originContract === "parking_source_creation_v1"
        && independentOrigin.id === origin.id
        && independentOrigin.mutationId === receipt.mutationId
        && independentOrigin.committedRevision === receipt.committedRevision
        && independentOrigin.committedAt === receipt.committedAt
        && independentOrigin.originBusinessOrderId === payload.orderId
        && independentOrigin.vehicleId === origin.vehicleId
        && independentOrigin.customerId === order?.customerId
        && stableJson(independentOrigin.eligibleBusinessOrderIds) === stableJson(origin.eligibleBusinessOrderIds)
        && stableJson(independentInitialSource) === stableJson(origin),
      "PARKING_SOURCE_CREATE_INDEPENDENT_ORIGIN",
      `${path}.origin`,
    );
    if (independentOrigin) {
      const { commitment: _commitment, ...originWithoutCommitment } = independentOrigin;
      stateInvariant(
        independentOrigin.commitment === parkingSourceOriginCommitment(originWithoutCommitment),
        "PARKING_SOURCE_CREATE_ORIGIN_COMMITMENT",
        `${path}.origin.commitment`,
      );
    }
    stateInvariant(
      source !== undefined
        && isModernParkingSourceFact(source)
        && source.revision >= origin.revision
        && Date.parse(source.asOf) >= Date.parse(origin.asOf)
        && stableJson(modernParkingImmutableCoordinates(source))
          === stableJson(modernParkingImmutableCoordinates(origin)),
      "PARKING_SOURCE_CREATE_SOURCE_BINDING",
      `${path}.result.parkingSource`,
    );
    stateInvariant(!boundSourceIds.has(origin.id), "PARKING_SOURCE_CREATE_SOURCE_UNIQUE", path);
    stateInvariant(!boundOrderIds.has(String(payload.orderId)), "PARKING_SOURCE_CREATE_ORDER_UNIQUE", path);
    boundSourceIds.add(origin.id);
    boundOrderIds.add(String(payload.orderId));
    explainedPickupNoticeOrderIds.add(String(payload.orderId));
    verifiedSnapshots.set(origin.id, new Map([[origin.revision, structuredClone(origin)]]));
    verifiedSnapshotCommittedRevisions.set(origin.id, new Map([[origin.revision, receipt.committedRevision]]));
    chainTails.set(origin.id, structuredClone(origin));
    chainLastCommittedRevision.set(origin.id, receipt.committedRevision);
  });
  stateInvariant(
    !state.mutationReceipts.some((receipt) => receipt.operation === "parking.source.migrate"),
    "PARKING_SOURCE_RUNTIME_MIGRATION_FORBIDDEN",
    "$.mutationReceipts",
  );
  stateInvariant(
    !state.mutationReceipts.some((receipt) => receipt.operation === "parking.source.update"),
    "PARKING_SOURCE_GENERIC_UPDATE_FORBIDDEN",
    "$.mutationReceipts",
  );
  const operationsWithParkingSourceResult = new Set([
    "parking.source.create",
    "parking.source.pickup",
    "parking.correction.preview",
    "parking.source.correct",
  ]);
  state.mutationReceipts.forEach((receipt, index) => {
    if (!isPlainRecord(receipt.result) || !Object.prototype.hasOwnProperty.call(receipt.result, "parkingSource")) return;
    stateInvariant(
      operationsWithParkingSourceResult.has(receipt.operation),
      "PARKING_SOURCE_RESULT_OPERATION",
      `$.mutationReceipts[${index}].result.parkingSource`,
    );
  });
  state.mutationReceipts.forEach((receipt, index) => {
    if (!isPlainRecord(receipt.result) || !Object.prototype.hasOwnProperty.call(receipt.result, "parkingSourceTransitions")) return;
    stateInvariant(
      receipt.operation === "billing.invoice.activate",
      "PARKING_SOURCE_TRANSITIONS_OPERATION",
      `$.mutationReceipts[${index}].result.parkingSourceTransitions`,
    );
  });

  const transitionEntries = state.mutationReceipts.flatMap((receipt) => {
    if (
      receipt.operation === "parking.source.pickup"
      || receipt.operation === "parking.correction.preview"
      || receipt.operation === "parking.source.correct"
    ) return [{ receipt, activationTransition: undefined }];
    if (receipt.operation !== "billing.invoice.activate" || !isPlainRecord(receipt.result)) return [];
    stateInvariant(
      Array.isArray(receipt.result.parkingSourceTransitions),
      "PARKING_SOURCE_ACTIVATION_TRANSITIONS",
      `$.mutationReceipts.${receipt.mutationId}.result.parkingSourceTransitions`,
    );
    return receipt.result.parkingSourceTransitions.map((activationTransition) => ({ receipt, activationTransition }));
  }).sort((left, right) => left.receipt.committedRevision - right.receipt.committedRevision);
  transitionEntries.forEach(({ receipt, activationTransition }, transitionIndex) => {
    const path = `$.mutationReceipts.parkingSourceTransition[${transitionIndex}]`;
    const payload = billingReceiptPayload(receipt, "PARKING_SOURCE_TRANSITION_RECEIPT", path);
    stateInvariant(isPlainRecord(receipt.result), "PARKING_SOURCE_TRANSITION_RESULT", `${path}.result`);
    const result = receipt.result as Record<string, unknown>;
    const actorOperation: Task8MutationOperation = receipt.operation === "billing.invoice.activate"
      ? "billing.invoice.activate"
      : receipt.operation === "parking.source.pickup"
        ? "parking.source.pickup"
        : receipt.operation === "parking.correction.preview"
          ? "parking.correction.preview"
          : "parking.source.correct";
    stateInvariant(
      canonicalBillingActorIdentity(actorOperation, receipt.actorId) !== null,
      "PARKING_SOURCE_TRANSITION_ACTOR_PROVENANCE",
      `${path}.actorId`,
    );
    let beforeValue: unknown;
    let afterValue: unknown;
    let expectedSourceRevision: unknown;
    let resultCaseId: unknown;
    let resultSourceRevision: unknown;
    let resultParkingSource: unknown;
    let resultRevision: unknown;
    let claimedPreviewNoTransition = false;
    if (receipt.operation === "billing.invoice.activate") {
      stateInvariant(
        hasOnlyKeys(payload, BILLING_ACTIVATION_PAYLOAD_FIELDS)
          && ["orderId", "expectedRevision", "mutationId"].every((field) => Object.prototype.hasOwnProperty.call(payload, field))
          && isPlainRecord(activationTransition)
          && hasOnlyKeys(activationTransition, PARKING_SOURCE_TRANSITION_FIELDS)
          && Object.keys(activationTransition).length === PARKING_SOURCE_TRANSITION_FIELDS.size,
        "PARKING_SOURCE_ACTIVATION_TRANSITION_CLOSED",
        path,
      );
      beforeValue = activationTransition.sourceBefore;
      afterValue = activationTransition.parkingSource;
      expectedSourceRevision = isPlainRecord(beforeValue) ? beforeValue.revision : undefined;
      resultCaseId = activationTransition.caseId;
      resultSourceRevision = isPlainRecord(afterValue) ? afterValue.revision : undefined;
      resultParkingSource = afterValue;
      resultRevision = result.revision;
    } else if (receipt.operation === "parking.source.pickup") {
      stateInvariant(
        hasOnlyKeys(payload, PARKING_SOURCE_PICKUP_PAYLOAD_FIELDS)
          && Object.keys(payload).length === PARKING_SOURCE_PICKUP_PAYLOAD_FIELDS.size,
        "PARKING_SOURCE_PICKUP_PAYLOAD_CLOSED",
        `${path}.payload`,
      );
      stateInvariant(
        hasOnlyKeys(result, PARKING_SOURCE_PICKUP_RESULT_FIELDS)
          && Object.keys(result).length === PARKING_SOURCE_PICKUP_RESULT_FIELDS.size,
        "PARKING_SOURCE_PICKUP_RESULT_CLOSED",
        `${path}.result`,
      );
      beforeValue = result.sourceBefore;
      afterValue = result.parkingSource;
      expectedSourceRevision = payload.expectedSourceRevision;
      resultCaseId = result.caseId;
      resultSourceRevision = result.sourceRevision;
      resultParkingSource = result.parkingSource;
      resultRevision = result.revision;
    } else if (receipt.operation === "parking.correction.preview") {
      stateInvariant(
        hasExactEnumerableDataFields(
          payload,
          PARKING_SOURCE_PREVIEW_PAYLOAD_FIELDS,
          PARKING_SOURCE_PREVIEW_PAYLOAD_FIELDS,
        ),
        "PARKING_SOURCE_PREVIEW_PAYLOAD_CLOSED",
        `${path}.payload`,
      );
      stateInvariant(
        hasExactEnumerableDataFields(
          result,
          PARKING_SOURCE_PREVIEW_RESULT_FIELDS,
          PARKING_SOURCE_PREVIEW_RESULT_FIELDS,
        ),
        "PARKING_SOURCE_PREVIEW_RESULT_CLOSED",
        `${path}.result`,
      );
      const tokens = state.parkingWaiverPreviews.filter((candidate) => (
        Object.prototype.hasOwnProperty.call(candidate, "previewContract")
          && candidate.previewContract === "parking_correction_preview_v1"
          && candidate.id === result.previewToken
      ));
      stateInvariant(tokens.length === 1, "PARKING_SOURCE_PREVIEW_TOKEN", `${path}.result.previewToken`);
      const token = validateModernParkingPreviewToken(tokens[0], receipt, payload, result, path);
      claimedPreviewNoTransition = token.claim !== null;
      stateInvariant(!validatedPreviewTokenIds.has(token.id), "PARKING_SOURCE_PREVIEW_TOKEN_UNIQUE", path);
      validatedPreviewTokenIds.add(token.id);
      beforeValue = token.sourceStored;
      afterValue = token.sourceBefore;
      expectedSourceRevision = payload.expectedSourceRevision;
      resultCaseId = result.caseId;
      resultSourceRevision = result.sourceRevision;
      resultParkingSource = result.parkingSource;
      resultRevision = result.latestRevision;
    } else {
      stateInvariant(
        hasOnlyKeys(payload, PARKING_SOURCE_CORRECTION_PAYLOAD_FIELDS)
          && ["caseId", "expectedRevision", "expectedSourceRevision", "mutationId", "previewToken"]
            .every((field) => Object.prototype.hasOwnProperty.call(payload, field)),
        "PARKING_SOURCE_CORRECTION_PAYLOAD_CLOSED",
        `${path}.payload`,
      );
      stateInvariant(
        hasOnlyKeys(result, PARKING_SOURCE_CORRECTION_RESULT_FIELDS)
          && Object.keys(result).length === PARKING_SOURCE_CORRECTION_RESULT_FIELDS.size,
        "PARKING_SOURCE_CORRECTION_RESULT_CLOSED",
        `${path}.result`,
      );
      const tokens = state.parkingWaiverPreviews.filter((candidate) => (
        Object.prototype.hasOwnProperty.call(candidate, "previewContract")
          && candidate.previewContract === "parking_correction_preview_v1"
          && candidate.id === payload.previewToken
      ));
      stateInvariant(tokens.length === 1, "PARKING_SOURCE_CORRECTION_TOKEN", `${path}.payload.previewToken`);
      const token = tokens[0] as LinkedModernParkingCorrectionPreviewToken;
      stateInvariant(
        token.caseId === payload.caseId
          && token.sourceRevision === payload.expectedSourceRevision
          && token.previewMutationId !== receipt.mutationId
          && token.consumedAt === receipt.committedAt,
        "PARKING_SOURCE_CORRECTION_TOKEN_BINDING",
        `${path}.payload.previewToken`,
      );
      beforeValue = token.sourceBefore;
      afterValue = token.nextParkingSource;
      expectedSourceRevision = token.sourceRevision;
      resultCaseId = result.caseId;
      resultSourceRevision = result.sourceRevision;
      resultParkingSource = result.parkingSource;
      resultRevision = result.revision;
    }
    const before = validateClosedModernParkingSourceSnapshot(beforeValue, `${path}.beforeSource`);
    const after = validateClosedModernParkingSourceSnapshot(afterValue, `${path}.afterSource`);
    const tail = chainTails.get(before.id);
    const lastCommittedRevision = chainLastCommittedRevision.get(before.id);
    stateInvariant(tail !== undefined, "PARKING_SOURCE_TRANSITION_ORIGIN", `${path}.beforeSource.id`);
    stateInvariant(
      stableJson(tail) === stableJson(before)
        && lastCommittedRevision !== undefined
        && receipt.committedRevision > lastCommittedRevision
        && (receipt.operation === "billing.invoice.activate" || payload.caseId === before.id)
        && payload.mutationId === receipt.mutationId
        && Number.isSafeInteger(payload.expectedRevision)
        && Number(payload.expectedRevision) + 1 === receipt.committedRevision
        && expectedSourceRevision === before.revision
        && resultRevision === receipt.committedRevision
        && resultCaseId === before.id
        && resultSourceRevision === after.revision
        && stableJson(resultParkingSource) === stableJson(after)
        && after.id === before.id
        && after.revision === before.revision + (claimedPreviewNoTransition ? 0 : 1)
        && Date.parse(after.asOf) >= Date.parse(before.asOf)
        && stableJson(modernParkingImmutableCoordinates(after))
          === stableJson(modernParkingImmutableCoordinates(before)),
      "PARKING_SOURCE_TRANSITION_BINDING",
      path,
    );
    if (receipt.operation === "parking.source.pickup") {
      const beforeFinal = deriveParkingFinalAccrual({
        currentAccrual: before.accrual,
        dailyRateJmd: before.dailyRateJmd,
        latestWaiverDecision: before.waiverHistory[before.waiverHistory.length - 1],
      }).finalAmountJmd;
      const afterFinal = deriveParkingFinalAccrual({
        currentAccrual: after.accrual,
        dailyRateJmd: after.dailyRateJmd,
        latestWaiverDecision: after.waiverHistory[after.waiverHistory.length - 1],
      }).finalAmountJmd;
      const unclaimedResult = result.invoiceId === null;
      const canonicalActor = typeof result.actorId === "string"
        ? canonicalBillingActorIdentity("parking.source.pickup", result.actorId)
        : null;
      stateInvariant(
        before.pickupDate === undefined
          && after.pickupDate === receipt.committedAt.slice(0, 10)
          && after.asOf === receipt.committedAt
          && stableJson(after.waiverHistory) === stableJson(before.waiverHistory)
          && stableJson(after.waiverReasons) === stableJson(before.waiverReasons)
          && afterFinal >= beforeFinal
          && result.parkingDeltaJmd === afterFinal - beforeFinal
          && result.parkingCashRefundJmd === 0
          && result.actorId === receipt.actorId
          && canonicalActor !== null
          && result.actorName === canonicalActor.name
          && (unclaimedResult
            ? result.previousInvoiceVersionId === null
              && result.invoiceVersionId === null
              && result.snapshotCommitment === null
            : typeof result.invoiceId === "string" && result.invoiceId.length > 0
              && typeof result.previousInvoiceVersionId === "string" && result.previousInvoiceVersionId.length > 0
              && typeof result.invoiceVersionId === "string" && result.invoiceVersionId.length > 0
              && typeof result.snapshotCommitment === "string"
              && /^sha256-utf16le:[a-f0-9]{64}$/u.test(result.snapshotCommitment)),
        "PARKING_SOURCE_PICKUP_TRANSITION",
        path,
      );
    } else if (receipt.operation === "parking.correction.preview" || receipt.operation === "billing.invoice.activate") {
      stateInvariant(
        after.pickupDate === before.pickupDate
          && (claimedPreviewNoTransition ? after.asOf === before.asOf : after.asOf === receipt.committedAt)
          && stableJson(after.waiverHistory) === stableJson(before.waiverHistory)
          && stableJson(after.waiverReasons) === stableJson(before.waiverReasons),
        "PARKING_SOURCE_PREVIEW_TRANSITION",
        path,
      );
    } else {
      stateInvariant(
        after.pickupDate === before.pickupDate
          && after.waiverHistory.length === before.waiverHistory.length + 1
          && after.waiverReasons.length === before.waiverReasons.length + 1
          && stableJson(after.waiverHistory.slice(0, -1)) === stableJson(before.waiverHistory)
          && stableJson(after.waiverReasons.slice(0, -1)) === stableJson(before.waiverReasons),
        "PARKING_SOURCE_CORRECTION_TRANSITION",
        path,
      );
    }
    if (!claimedPreviewNoTransition) {
      chainTails.set(after.id, structuredClone(after));
      chainLastCommittedRevision.set(after.id, receipt.committedRevision);
      verifiedSnapshots.get(after.id)?.set(after.revision, structuredClone(after));
      verifiedSnapshotCommittedRevisions.get(after.id)?.set(after.revision, receipt.committedRevision);
    }
  });
  const firstParkingClaimByCase = new Map<string, { readonly invoiceId: string; readonly committedRevision: number }>();
  state.invoices.filter(isSharedChargeInvoice).forEach((invoice) => {
    invoice.versions.forEach((version) => {
      const activationAudit = state.billingAuditEvents.find((event) => (
        event.operation === "invoice_activation"
          && event.invoiceId === invoice.id
          && event.invoiceVersionId === version.id
      ));
      const activationReceipt = activationAudit && state.mutationReceipts.find((receipt) => (
        receipt.operation === "billing.invoice.activate" && receipt.mutationId === activationAudit.mutationId
      ));
      if (!activationReceipt) return;
      version.snapshot.lines.forEach((line) => {
        if (line.pricingMode !== "parking_projection") return;
        const existing = firstParkingClaimByCase.get(line.parkingCaseId);
        if (!existing || activationReceipt.committedRevision < existing.committedRevision) {
          firstParkingClaimByCase.set(line.parkingCaseId, {
            invoiceId: invoice.id,
            committedRevision: activationReceipt.committedRevision,
          });
        }
      });
    });
  });
  state.mutationReceipts.filter((receipt) => receipt.operation === "billing.invoice.activate")
    .forEach((receipt, receiptIndex) => {
      const path = `$.mutationReceipts.parkingActivationExact[${receiptIndex}]`;
      const payload = billingReceiptPayload(receipt, "PARKING_SOURCE_ACTIVATION_EXACT", path);
      stateInvariant(isPlainRecord(receipt.result), "PARKING_SOURCE_ACTIVATION_EXACT", `${path}.result`);
      const result = receipt.result as Record<string, unknown>;
      const invoice = state.invoices.find((candidate) => candidate.id === result.invoiceId);
      stateInvariant(
        invoice !== undefined
          && isSharedChargeInvoice(invoice)
          && invoice.businessOrderId === payload.orderId
          && typeof result.invoiceVersionId === "string",
        "PARKING_SOURCE_ACTIVATION_INVOICE",
        path,
      );
      const version = invoice?.versions.find((candidate) => candidate.id === result.invoiceVersionId);
      stateInvariant(version !== undefined, "PARKING_SOURCE_ACTIVATION_VERSION", path);
      const parkingLines = version!.snapshot.lines.filter(
        (line): line is InvoiceParkingSnapshotLine => line.pricingMode === "parking_projection",
      );
      const lineByCase = new Map(parkingLines.map((line) => [line.parkingCaseId, line]));
      const priorVersionCaseIds = new Set(invoice!.versions
        .filter((candidate) => candidate.version < version!.version)
        .flatMap((candidate) => candidate.snapshot.lines.flatMap((line) => (
          line.pricingMode === "parking_projection" ? [line.parkingCaseId] : []
        ))));
      const expectedCaseIds = new Set<string>();
      verifiedSnapshots.forEach((snapshots, caseId) => {
        const committed = verifiedSnapshotCommittedRevisions.get(caseId);
        const originCommittedRevision = committed?.get(1);
        if (originCommittedRevision === undefined || originCommittedRevision >= receipt.committedRevision) return;
        const source = snapshots.get(1);
        if (!source) return;
        const wasPreviouslyClaimedByThisInvoice = priorVersionCaseIds.has(caseId);
        if (!source.eligibleBusinessOrderIds.includes(String(payload.orderId)) && !wasPreviouslyClaimedByThisInvoice) return;
        const firstClaim = firstParkingClaimByCase.get(caseId);
        const occupiedByAnotherInvoiceBeforeActivation = firstClaim !== undefined
          && firstClaim.invoiceId !== invoice!.id
          && firstClaim.committedRevision < receipt.committedRevision;
        if (!occupiedByAnotherInvoiceBeforeActivation) expectedCaseIds.add(caseId);
      });
      stateInvariant(
        expectedCaseIds.size === lineByCase.size
          && [...expectedCaseIds].every((caseId) => lineByCase.has(caseId)),
        "PARKING_SOURCE_ACTIVATION_ENUMERATION",
        `${path}.version.snapshot.lines`,
      );
      stateInvariant(
        Array.isArray(result.parkingSourceTransitions),
        "PARKING_SOURCE_ACTIVATION_TRANSITIONS",
        `${path}.result.parkingSourceTransitions`,
      );
      const transitions = result.parkingSourceTransitions as unknown[];
      const transitionByCase = new Map<string, Record<string, unknown>>();
      transitions.forEach((candidate, transitionIndex) => {
        stateInvariant(
          hasExactEnumerableDataFields(candidate, PARKING_SOURCE_TRANSITION_FIELDS, PARKING_SOURCE_TRANSITION_FIELDS)
            && typeof candidate.caseId === "string"
            && lineByCase.has(candidate.caseId)
            && !transitionByCase.has(candidate.caseId),
          "PARKING_SOURCE_ACTIVATION_TRANSITION_SET",
          `${path}.result.parkingSourceTransitions[${transitionIndex}]`,
        );
        transitionByCase.set(String(candidate.caseId), candidate);
      });
      parkingLines.forEach((line, lineIndex) => {
        const linePath = `${path}.version.snapshot.parking[${lineIndex}]`;
        const snapshots = verifiedSnapshots.get(line.parkingCaseId);
        const committed = verifiedSnapshotCommittedRevisions.get(line.parkingCaseId);
        stateInvariant(snapshots !== undefined && committed !== undefined, "PARKING_SOURCE_ACTIVATION_SOURCE", linePath);
        const priorRevisionEntry = [...committed!.entries()]
          .filter(([, committedRevision]) => committedRevision < receipt.committedRevision)
          .sort((left, right) => left[1] - right[1])
          .at(-1);
        stateInvariant(priorRevisionEntry !== undefined, "PARKING_SOURCE_ACTIVATION_PRIOR_SOURCE", linePath);
        const priorSource = snapshots!.get(priorRevisionEntry![0]);
        stateInvariant(
          priorSource !== undefined
            && (priorSource.eligibleBusinessOrderIds.includes(String(payload.orderId))
              || priorVersionCaseIds.has(line.parkingCaseId)),
          "PARKING_SOURCE_ACTIVATION_ELIGIBILITY",
          linePath,
        );
        const expectedAccrual = calculateParkingAccrual({
          notificationDate: priorSource!.notificationDate,
          pickupDate: priorSource!.pickupDate ?? receipt.committedAt.slice(0, 10),
          dailyRateJmd: priorSource!.dailyRateJmd,
        });
        const needsMaterialization = stableJson(expectedAccrual) !== stableJson(priorSource!.accrual);
        const transition = transitionByCase.get(line.parkingCaseId);
        stateInvariant(
          needsMaterialization === (transition !== undefined),
          "PARKING_SOURCE_ACTIVATION_MATERIALIZATION_SET",
          linePath,
        );
        const expectedSource = needsMaterialization
          ? {
            ...priorSource!,
            revision: priorSource!.revision + 1,
            asOf: receipt.committedAt,
            accrual: expectedAccrual,
          }
          : priorSource!;
        if (transition) {
          stateInvariant(
            stableJson(transition.sourceBefore) === stableJson(priorSource)
              && stableJson(transition.parkingSource) === stableJson(expectedSource),
            "PARKING_SOURCE_ACTIVATION_TRANSITION_EXACT",
            linePath,
          );
        }
        const expectedFinal = deriveParkingFinalAccrual({
          currentAccrual: expectedSource.accrual,
          dailyRateJmd: expectedSource.dailyRateJmd,
          latestWaiverDecision: expectedSource.waiverHistory[expectedSource.waiverHistory.length - 1],
        });
        stateInvariant(
          line.sourceRevision === expectedSource.revision
            && line.asOf === expectedSource.asOf
            && line.amountJmd === expectedFinal.finalAmountJmd,
          "PARKING_SOURCE_ACTIVATION_PROJECTION_BINDING",
          linePath,
        );
      });
      stateInvariant(
        transitionByCase.size === [...transitionByCase.keys()].filter((caseId) => lineByCase.has(caseId)).length,
        "PARKING_SOURCE_ACTIVATION_TRANSITION_REVERSE",
        `${path}.result.parkingSourceTransitions`,
      );
    });
  const modernPreviewTokens = state.parkingWaiverPreviews.filter((candidate): candidate is LinkedModernParkingCorrectionPreviewToken => (
    Object.prototype.hasOwnProperty.call(candidate, "previewContract")
      && candidate.previewContract === "parking_correction_preview_v1"
  ));
  stateInvariant(
    modernPreviewTokens.length === validatedPreviewTokenIds.size
      && modernPreviewTokens.every((token) => validatedPreviewTokenIds.has(token.id)),
    "PARKING_SOURCE_PREVIEW_TOKEN_REVERSE",
    "$.parkingWaiverPreviews",
  );
  const correctionReceipts = state.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.correct");
  const boundCorrectionAuditIds = new Set<string>();
  modernPreviewTokens.forEach((token, tokenIndex) => {
    const matchingReceipts = correctionReceipts.filter((receipt) => {
      const payload = billingReceiptPayload(
        receipt,
        "PARKING_SOURCE_CORRECTION_RECEIPT",
        `$.parkingWaiverPreviews[${tokenIndex}]`,
      );
      return payload.previewToken === token.id;
    });
    stateInvariant(
      token.consumedAt === undefined
        ? matchingReceipts.length === 0
        : matchingReceipts.length === 1
          && token.consumedAt === matchingReceipts[0]?.committedAt
          && Date.parse(token.consumedAt) >= Date.parse(token.issuedAt)
          && Date.parse(token.consumedAt) <= Date.parse(token.expiresAt),
      "PARKING_SOURCE_PREVIEW_CONSUMPTION_REVERSE",
      `$.parkingWaiverPreviews[${tokenIndex}].consumedAt`,
    );
    if (matchingReceipts.length !== 1) return;
    const receipt = matchingReceipts[0]!;
    const payload = billingReceiptPayload(
      receipt,
      "PARKING_SOURCE_CORRECTION_RECEIPT",
      `$.parkingWaiverPreviews[${tokenIndex}]`,
    );
    const audits = state.parkingWaiverAudits.filter((candidate): candidate is LinkedModernParkingWaiverAudit => (
      Object.prototype.hasOwnProperty.call(candidate, "auditContract")
        && candidate.auditContract === "parking_waiver_audit_v1"
        && candidate.mutationId === receipt.mutationId
    ));
    stateInvariant(audits.length === 1, "PARKING_SOURCE_CORRECTION_AUDIT", `$.parkingWaiverPreviews[${tokenIndex}]`);
    const audit = audits[0]!;
    stateInvariant(
      hasExactEnumerableDataFields(
        audit,
        MODERN_PARKING_WAIVER_AUDIT_FIELDS,
        MODERN_PARKING_WAIVER_AUDIT_REQUIRED_FIELDS,
      ),
      "PARKING_SOURCE_CORRECTION_AUDIT_CLOSED",
      `$.parkingWaiverAudits.${audit.id}`,
    );
    stateInvariant(
      typeof audit.id === "string" && audit.id.length > 0
        && audit.mutationId === receipt.mutationId
        && audit.caseId === token.caseId
        && audit.sourceRevision === token.sourceBefore.revision
        && audit.sourceAsOf === token.sourceBefore.asOf
        && audit.reason === token.reason
        && audit.actorId === receipt.actorId
        && audit.appliedAt === receipt.committedAt
        && stableJson(audit.preview) === stableJson(token.decision)
        && Object.prototype.hasOwnProperty.call(payload, "administratorId")
          === token.parkingAdministratorSignatureRequired
        && Object.prototype.hasOwnProperty.call(payload, "administratorSignature")
          === token.parkingAdministratorSignatureRequired
        && Object.prototype.hasOwnProperty.call(audit, "administratorId")
          === token.parkingAdministratorSignatureRequired
        && Object.prototype.hasOwnProperty.call(audit, "administratorSignature")
          === token.parkingAdministratorSignatureRequired
        && audit.administratorId === payload.administratorId
        && stableJson(audit.administratorSignature) === stableJson(payload.administratorSignature),
      "PARKING_SOURCE_CORRECTION_AUDIT_BINDING",
      `$.parkingWaiverAudits.${audit.id}`,
    );
    if (token.parkingAdministratorSignatureRequired) {
      try {
        validateAdministratorSignatureProvenance(String(audit.administratorId), audit.administratorSignature, {
          action: "parking_waiver",
          subjectId: token.caseId,
          sourceRevision: token.sourceBefore.revision,
          amountJmd: token.decision.cumulativeWaivedAmountJmd,
          reason: token.reason,
        });
      } catch {
        stateInvariant(false, "PARKING_SOURCE_CORRECTION_ADMIN_SIGNATURE", `$.parkingWaiverAudits.${audit.id}`);
      }
    }
    boundCorrectionAuditIds.add(audit.id);
  });
  const modernCorrectionAudits = state.parkingWaiverAudits.filter((candidate): candidate is LinkedModernParkingWaiverAudit => (
    Object.prototype.hasOwnProperty.call(candidate, "auditContract")
      && candidate.auditContract === "parking_waiver_audit_v1"
  ));
  stateInvariant(
    modernCorrectionAudits.length === boundCorrectionAuditIds.size
      && modernCorrectionAudits.every((audit) => boundCorrectionAuditIds.has(audit.id)),
    "PARKING_SOURCE_CORRECTION_AUDIT_REVERSE",
    "$.parkingWaiverAudits",
  );
  state.parkingSourceOrigins.forEach((origin, index) => {
    stateInvariant(
      boundSourceIds.has(origin.id),
      "PARKING_SOURCE_ORIGIN_REVERSE",
      `$.parkingSourceOrigins[${index}]`,
    );
  });
  state.parkingCases.forEach((source, index) => {
    if (!isModernParkingSourceFact(source)) return;
    stateInvariant(boundSourceIds.has(source.id), "PARKING_SOURCE_PROVENANCE_REVERSE", `$.parkingCases[${index}]`);
    stateInvariant(
      stableJson(chainTails.get(source.id)) === stableJson(source),
      "PARKING_SOURCE_TRANSITION_TAIL",
      `$.parkingCases[${index}]`,
    );
  });
  state.quickOrders.forEach((order, index) => {
    if (!isSharedChargeQuickOrder(order) || !order.pickupNotice) return;
    stateInvariant(
      explainedPickupNoticeOrderIds.has(order.id),
      "PARKING_SOURCE_CREATE_NOTICE_REVERSE",
      `$.quickOrders[${index}].pickupNotice`,
    );
  });
  const openVehicleIds = new Set<string>();
  state.parkingCases.forEach((source, index) => {
    if (source.pickupDate !== undefined) return;
    stateInvariant(!openVehicleIds.has(source.vehicleId), "PARKING_SOURCE_OPEN_VEHICLE_UNIQUE", `$.parkingCases[${index}]`);
    openVehicleIds.add(source.vehicleId);
  });
  return verifiedSnapshots;
}

function isImportedCommunicationEvent(
  event: LinkedCurrentCommunicationEvent | LinkedCustomerResponseEvent,
): event is LinkedImportedCommunicationEvent | LinkedImportedCustomerResponseEvent {
  return "sourceKey" in event && event.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY;
}

function uniqueStringValues(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length;
}

function normalizedLegacyCustomerEmail(customer: LegacyLinkedCustomerFact): string | null {
  return typeof customer.email === "string" && customer.email.trim().length > 0
    ? customer.email.trim()
    : null;
}

function catalogCustomerEmailOrNull(customerId: unknown): string | null {
  if (typeof customerId !== "string") return null;
  try {
    return canonicalCustomerById(customerId).email;
  } catch {
    return null;
  }
}

function validateQuickPaymentReceipts(order: QuickOrder, path: string, occupiedReceiptNos: Set<string>): void {
  stateInvariant(Array.isArray(order.payments), "QUICK_PAYMENT_ARRAY", `${path}.payments`);
  const paymentIds = new Set<string>();
  order.payments.forEach((payment, paymentIndex) => {
    const paymentPath = `${path}.payments[${paymentIndex}]`;
    stateInvariant(!paymentIds.has(payment.id), "QUICK_PAYMENT_ID_UNIQUE", `${paymentPath}.id`);
    paymentIds.add(payment.id);
    stateInvariant(typeof payment.id === "string" && payment.id.length > 0, "QUICK_PAYMENT_ID", `${paymentPath}.id`);
    stateInvariant(Number.isSafeInteger(payment.amountJmd) && payment.amountJmd > 0, "QUICK_PAYMENT_AMOUNT", `${paymentPath}.amountJmd`);
    stateInvariant(typeof payment.method === "string" && payment.method.length > 0, "QUICK_PAYMENT_METHOD", `${paymentPath}.method`);
    stateInvariant(typeof payment.receivedBy === "string" && payment.receivedBy.length > 0, "QUICK_PAYMENT_ACTOR", `${paymentPath}.receivedBy`);
    stateInvariant(isValidIsoTimestamp(payment.receivedAt), "QUICK_PAYMENT_TIME", `${paymentPath}.receivedAt`);
    stateInvariant(payment.note === undefined || (typeof payment.note === "string" && payment.note.length > 0), "QUICK_PAYMENT_NOTE", `${paymentPath}.note`);

    const receipt = payment.receipt;
    const receiptPath = `${paymentPath}.receipt`;
    stateInvariant(receipt?.contract === "quick_payment_receipt_v1", "QUICK_PAYMENT_RECEIPT_CONTRACT", receiptPath);
    stateInvariant(/^KGN-WH-RCPT-[0-9]{8}-[0-9]{5}$/u.test(receipt.receiptNo), "QUICK_PAYMENT_RECEIPT_NUMBER", `${receiptPath}.receiptNo`);
    stateInvariant(!occupiedReceiptNos.has(receipt.receiptNo), "QUICK_PAYMENT_RECEIPT_NUMBER_UNIQUE", `${receiptPath}.receiptNo`);
    occupiedReceiptNos.add(receipt.receiptNo);
    stateInvariant(receipt.paymentId === payment.id, "QUICK_PAYMENT_RECEIPT_PAYMENT", `${receiptPath}.paymentId`);
    stateInvariant(receipt.businessOrderId === order.id && receipt.businessOrderNo === order.businessOrderNo, "QUICK_PAYMENT_RECEIPT_ORDER", receiptPath);
    stateInvariant(receipt.amountJmd === payment.amountJmd, "QUICK_PAYMENT_RECEIPT_AMOUNT", `${receiptPath}.amountJmd`);
    stateInvariant(receipt.method === payment.method, "QUICK_PAYMENT_RECEIPT_METHOD", `${receiptPath}.method`);
    stateInvariant(receipt.issuedAt === payment.receivedAt && receipt.issuedBy === payment.receivedBy, "QUICK_PAYMENT_RECEIPT_ISSUER", receiptPath);
    stateInvariant(receipt.note === (payment.note ?? null), "QUICK_PAYMENT_RECEIPT_NOTE", `${receiptPath}.note`);
    stateInvariant(receipt.customer.id === order.customerId && typeof receipt.customer.nameZh === "string" && typeof receipt.customer.nameEn === "string" && typeof receipt.customer.phone === "string", "QUICK_PAYMENT_RECEIPT_CUSTOMER", `${receiptPath}.customer`);
    stateInvariant(receipt.vehicle.id === order.vehicleId && typeof receipt.vehicle.plate === "string" && receipt.vehicle.plate.length > 0 && typeof receipt.vehicle.modelZh === "string" && typeof receipt.vehicle.modelEn === "string", "QUICK_PAYMENT_RECEIPT_VEHICLE", `${receiptPath}.vehicle`);
    stateInvariant(Array.isArray(receipt.chargeLines) && receipt.chargeLines.length > 0, "QUICK_PAYMENT_RECEIPT_LINES", `${receiptPath}.chargeLines`);
    let receiptGrossJmd = 0;
    let receiptDiscountJmd = 0;
    receipt.chargeLines.forEach((line: QuickPaymentReceiptChargeLine, lineIndex: number) => {
      const linePath = `${receiptPath}.chargeLines[${lineIndex}]`;
      stateInvariant(typeof line.id === "string" && line.id.length > 0, "QUICK_PAYMENT_RECEIPT_LINE_ID", `${linePath}.id`);
      stateInvariant(["labor", "parts", "other_service"].includes(line.category), "QUICK_PAYMENT_RECEIPT_LINE_CATEGORY", `${linePath}.category`);
      stateInvariant(typeof line.descZh === "string" && line.descZh.length > 0 && typeof line.descEn === "string", "QUICK_PAYMENT_RECEIPT_LINE_DESC", linePath);
      stateInvariant(Number.isSafeInteger(line.discountJmd) && line.discountJmd >= 0, "QUICK_PAYMENT_RECEIPT_LINE_DISCOUNT", `${linePath}.discountJmd`);
      stateInvariant(Number.isSafeInteger(line.lineTotalJmd) && line.lineTotalJmd >= 0, "QUICK_PAYMENT_RECEIPT_LINE_TOTAL", `${linePath}.lineTotalJmd`);
      receiptGrossJmd += line.lineTotalJmd + line.discountJmd;
      receiptDiscountJmd += line.discountJmd;
    });
    stateInvariant(Number.isSafeInteger(receiptGrossJmd) && receipt.grossJmd === receiptGrossJmd, "QUICK_PAYMENT_RECEIPT_GROSS", `${receiptPath}.grossJmd`);
    stateInvariant(Number.isSafeInteger(receiptDiscountJmd) && receipt.discountJmd === receiptDiscountJmd, "QUICK_PAYMENT_RECEIPT_DISCOUNT", `${receiptPath}.discountJmd`);
    stateInvariant(receipt.receivableJmd === receipt.grossJmd - receipt.discountJmd, "QUICK_PAYMENT_RECEIPT_RECEIVABLE", `${receiptPath}.receivableJmd`);
    stateInvariant(receipt.gctIncludedJmd === Math.round(receipt.receivableJmd * 15 / 115), "QUICK_PAYMENT_RECEIPT_GCT", `${receiptPath}.gctIncludedJmd`);
    stateInvariant(Array.isArray(receipt.paymentHistory) && receipt.paymentHistory.length === paymentIndex + 1, "QUICK_PAYMENT_RECEIPT_HISTORY", `${receiptPath}.paymentHistory`);
    let paidToDateJmd = 0;
    receipt.paymentHistory.forEach((entry: QuickPaymentReceiptHistoryEntry, historyIndex: number) => {
      const source = order.payments[historyIndex];
      const historyPath = `${receiptPath}.paymentHistory[${historyIndex}]`;
      stateInvariant(Boolean(source), "QUICK_PAYMENT_RECEIPT_HISTORY_SOURCE", historyPath);
      stateInvariant(entry.paymentId === source.id && entry.amountJmd === source.amountJmd && entry.method === source.method, "QUICK_PAYMENT_RECEIPT_HISTORY_FACT", historyPath);
      stateInvariant(entry.receivedAt === source.receivedAt && entry.receivedBy === source.receivedBy && entry.note === (source.note ?? null), "QUICK_PAYMENT_RECEIPT_HISTORY_ACTOR", historyPath);
      stateInvariant(entry.receiptNo === source.receipt.receiptNo, "QUICK_PAYMENT_RECEIPT_HISTORY_NUMBER", `${historyPath}.receiptNo`);
      paidToDateJmd += entry.amountJmd;
    });
    stateInvariant(Number.isSafeInteger(paidToDateJmd) && receipt.paidToDateJmd === paidToDateJmd, "QUICK_PAYMENT_RECEIPT_PAID", `${receiptPath}.paidToDateJmd`);
    stateInvariant(Number.isSafeInteger(receipt.refundedToDateJmd) && receipt.refundedToDateJmd >= 0, "QUICK_PAYMENT_RECEIPT_REFUNDED", `${receiptPath}.refundedToDateJmd`);
    stateInvariant(receipt.balanceAfterJmd === receipt.receivableJmd - receipt.paidToDateJmd + receipt.refundedToDateJmd, "QUICK_PAYMENT_RECEIPT_BALANCE", `${receiptPath}.balanceAfterJmd`);
  });
}

function validateQuickRefundEvidenceFact(value: QuickRefundEvidence, path: string): void {
  stateInvariant(hasOnlyKeys(value as unknown as Record<string, unknown>, new Set(["fileName", "mimeType", "dataUrl"])), "QUICK_REFUND_EVIDENCE_CLOSED", path);
  stateInvariant(typeof value.fileName === "string" && value.fileName.length > 0, "QUICK_REFUND_EVIDENCE_NAME", `${path}.fileName`);
  stateInvariant(["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(value.mimeType), "QUICK_REFUND_EVIDENCE_TYPE", `${path}.mimeType`);
  stateInvariant(typeof value.dataUrl === "string" && value.dataUrl.startsWith(`data:${value.mimeType};base64,`) && value.dataUrl.length <= 35_000_000, "QUICK_REFUND_EVIDENCE_DATA", `${path}.dataUrl`);
}

function validateQuickRefunds(order: QuickOrder, path: string, occupiedReceiptNos: Set<string>): void {
  stateInvariant(Array.isArray(order.refunds), "QUICK_REFUND_ARRAY", `${path}.refunds`);
  let refundedToDateJmd = 0;
  order.refunds.forEach((refund: QuickRefund, refundIndex: number) => {
    const refundPath = `${path}.refunds[${refundIndex}]`;
    stateInvariant(refund.contract === "quick_refund_v2", "QUICK_REFUND_CONTRACT", `${refundPath}.contract`);
    stateInvariant(Number.isSafeInteger(refund.amountJmd) && refund.amountJmd > 0, "QUICK_REFUND_AMOUNT", `${refundPath}.amountJmd`);
    stateInvariant(refund.category === null, "QUICK_REFUND_NO_CHARGE_COORDINATE", `${refundPath}.category`);
    stateInvariant(/^KGN-WH-RFD-[0-9]{8}-[0-9]{5}$/u.test(refund.receiptNo), "QUICK_REFUND_NUMBER", `${refundPath}.receiptNo`);
    stateInvariant(!occupiedReceiptNos.has(refund.receiptNo), "QUICK_REFUND_NUMBER_UNIQUE", `${refundPath}.receiptNo`);
    occupiedReceiptNos.add(refund.receiptNo);
    stateInvariant(typeof refund.method === "string" && refund.method.length > 0, "QUICK_REFUND_METHOD", `${refundPath}.method`);
    stateInvariant(typeof refund.reason === "string" && refund.reason.length > 0 && refund.note === refund.reason, "QUICK_REFUND_REASON", `${refundPath}.reason`);
    stateInvariant(isValidIsoTimestamp(refund.refundedAt) && typeof refund.refundedBy === "string" && refund.refundedBy.length > 0, "QUICK_REFUND_ACTOR_TIME", refundPath);
    stateInvariant(["returned", "unavailable", "not_issued"].includes(refund.originalDocumentStatus), "QUICK_REFUND_ORIGINAL_DOCUMENT", `${refundPath}.originalDocumentStatus`);
    stateInvariant(refund.originalDocumentNote === null || (typeof refund.originalDocumentNote === "string" && refund.originalDocumentNote.length > 0), "QUICK_REFUND_ORIGINAL_DOCUMENT_NOTE", `${refundPath}.originalDocumentNote`);
    stateInvariant(refund.originalDocumentStatus !== "unavailable" || refund.originalDocumentNote !== null, "QUICK_REFUND_ORIGINAL_DOCUMENT_NOTE_REQUIRED", `${refundPath}.originalDocumentNote`);
    stateInvariant((refund.proof === null) === (refund.proofAttachedBy === null && refund.proofAttachedAt === null), "QUICK_REFUND_EVIDENCE_STATUS", `${refundPath}.proof`);
    if (refund.proof !== null) {
      validateQuickRefundEvidenceFact(refund.proof, `${refundPath}.proof`);
      stateInvariant(typeof refund.proofAttachedBy === "string" && refund.proofAttachedBy.length > 0 && isValidIsoTimestamp(refund.proofAttachedAt), "QUICK_REFUND_EVIDENCE_ACTOR_TIME", `${refundPath}.proofAttachedAt`);
    }
    if (refund.signature !== null) {
      stateInvariant(typeof refund.signature.signerName === "string" && refund.signature.signerName.length > 0, "QUICK_REFUND_SIGNATURE_NAME", `${refundPath}.signature.signerName`);
      stateInvariant(refund.signature.photoDataUrl.startsWith("data:image/") && refund.signature.photoDataUrl.length <= 2_500_000, "QUICK_REFUND_SIGNATURE_DATA", `${refundPath}.signature.photoDataUrl`);
      stateInvariant(
        isValidIsoTimestamp(refund.signature.signedAt)
          && refund.signature.signedAt >= refund.refundedAt
          && typeof refund.signature.signedBy === "string"
          && refund.signature.signedBy.length > 0,
        "QUICK_REFUND_SIGNATURE_ACTOR_TIME",
        `${refundPath}.signature`,
      );
    }

    refundedToDateJmd += refund.amountJmd;
    const document = refund.document;
    const documentPath = `${refundPath}.document`;
    stateInvariant(document?.contract === "quick_refund_document_v1", "REFUND_DOCUMENT_CONTRACT", documentPath);
    stateInvariant(document.refundId === refund.id && document.receiptNo === refund.receiptNo, "REFUND_DOCUMENT_ID", documentPath);
    stateInvariant(document.businessOrderId === order.id && document.businessOrderNo === order.businessOrderNo, "REFUND_DOCUMENT_ORDER", documentPath);
    stateInvariant(document.customer.id === order.customerId && document.vehicle.id === order.vehicleId, "REFUND_DOCUMENT_PARTIES", documentPath);
    stateInvariant(document.amountJmd === refund.amountJmd && document.method === refund.method && document.reason === refund.reason, "REFUND_DOCUMENT_FACT", documentPath);
    stateInvariant(document.originalDocumentStatus === refund.originalDocumentStatus && document.originalDocumentNote === refund.originalDocumentNote, "REFUND_DOCUMENT_ORIGINAL", documentPath);
    stateInvariant(stableJson(document.proof) === stableJson(refund.proof)
      && document.proofAttachedBy === refund.proofAttachedBy
      && document.proofAttachedAt === refund.proofAttachedAt
      && stableJson(document.signature) === stableJson(refund.signature), "REFUND_DOCUMENT_EVIDENCE", documentPath);
    stateInvariant(document.refundedAt === refund.refundedAt && document.refundedBy === refund.refundedBy, "REFUND_DOCUMENT_ACTOR_TIME", documentPath);
    stateInvariant(Number.isSafeInteger(document.paidToDateJmd) && document.paidToDateJmd >= 0, "REFUND_DOCUMENT_PAID", `${documentPath}.paidToDateJmd`);
    stateInvariant(document.refundedToDateJmd === refundedToDateJmd, "REFUND_DOCUMENT_REFUNDED", `${documentPath}.refundedToDateJmd`);
    stateInvariant(document.balanceAfterJmd === document.receivableJmd - document.paidToDateJmd + document.refundedToDateJmd, "REFUND_DOCUMENT_BALANCE", `${documentPath}.balanceAfterJmd`);
  });
}

export function validateLinkedOperationsState(value: unknown): asserts value is LinkedOperationsState {
  stateInvariant(value !== null && typeof value === "object", "STATE_OBJECT", "$");
  const state = value as LinkedOperationsState;
  stateInvariant(state.schemaVersion === LINKED_OPERATIONS_SCHEMA_VERSION, "SCHEMA_VERSION", "$.schemaVersion");
  stateInvariant(state.billingSnapshotVersion === 1, "BILLING_SNAPSHOT_VERSION", "$.billingSnapshotVersion");
  stateInvariant(state.customerContactSnapshotVersion === 1, "CUSTOMER_CONTACT_SNAPSHOT_VERSION", "$.customerContactSnapshotVersion");
  stateInvariant(state.reportPhotoStorageVersion === 2, "PHOTO_STORAGE_VERSION", "$.reportPhotoStorageVersion");
  stateInvariant(
    /^sha256-utf16le:[a-f0-9]{64}$/.test(state.legacyPhotoManifestHash),
    "PHOTO_MANIFEST_BINDING",
    "$.legacyPhotoManifestHash",
  );
  stateInvariant(Number.isSafeInteger(state.revision) && state.revision >= 1, "REVISION", "$.revision");

  const collections: Array<[unknown, string, number | undefined]> = [
    [state.trustedIdentities, "trustedIdentities", undefined],
    [state.customers, "customers", undefined], [state.vehicles, "vehicles", undefined],
    [state.orderRecords, "orderRecords", undefined], [state.businessOrders, "businessOrders", undefined],
    [state.inspectionReports, "inspectionReports", undefined], [state.inspectionItems, "inspectionItems", undefined],
    [state.quotations, "quotations", undefined], [state.quotationItems, "quotationItems", undefined],
    [state.currentQuotations, "currentQuotations", undefined],
    [state.quotedChargeLines, "quotedChargeLines", undefined],
    [state.reportAttachments, "reportAttachments", undefined],
    [state.reportAttachmentAuditEvents, "reportAttachmentAuditEvents", undefined],
    [state.legacyChargeRecords, "legacyChargeRecords", undefined],
    [state.generationEvents, "generationEvents", undefined],
    [state.communicationEvents, "communicationEvents", undefined],
    [state.responseEvents, "responseEvents", undefined],
    [state.mutationReceipts, "mutationReceipts", undefined],
    [state.billingAuditEvents, "billingAuditEvents", undefined],
    [state.billingDocumentSequences, "billingDocumentSequences", undefined],
    [state.legacyRefundOccupancies, "legacyRefundOccupancies", undefined],
    [state.legacyParkingOrigins, "legacyParkingOrigins", undefined],
    [state.parkingSourceOrigins, "parkingSourceOrigins", undefined],
    [state.invoices, "invoices", undefined], [state.payments, "payments", undefined],
    [state.refunds, "refunds", undefined], [state.parkingCases, "parkingCases", undefined],
    [state.parkingWaiverPreviews, "parkingWaiverPreviews", undefined],
    [state.parkingWaiverAudits, "parkingWaiverAudits", undefined],
    [state.communications, "communications", undefined],
    [state.invoiceAcknowledgements, "invoiceAcknowledgements", undefined],
    [state.specialReleaseAuthorizations, "specialReleaseAuthorizations", undefined],
    [state.reassignments, "reassignments", undefined],
    [state.performanceAudits, "performanceAudits", undefined],
    [state.operationsDocuments, "operationsDocuments", undefined],
    [state.operationsAssignments, "operationsAssignments", undefined],
    [state.quickOrders, "quickOrders", undefined],
  ];
  for (const [collection, name, exactLength] of collections) {
    stateInvariant(Array.isArray(collection), "COLLECTION_REQUIRED", `$.${name}`);
    if (exactLength !== undefined) stateInvariant(collection.length === exactLength, "COLLECTION_SIZE", `$.${name}`);
    stateInvariant(uniqueIds(collection as Array<{ id: string }>), "DUPLICATE_OR_INVALID_ID", `$.${name}`);
  }
  // Validate lifecycle receipts before any generic subsystem scans their
  // operation/result properties. This preserves the no-accessor contract: an
  // invalid receipt is rejected from descriptors without invoking a getter.
  validateQuickOrderLifecycleReceipts(state);
  stateInvariant(
    state.invoiceFileHashes !== null && typeof state.invoiceFileHashes === "object" && !Array.isArray(state.invoiceFileHashes),
    "FILE_HASHES_REQUIRED",
    "$.invoiceFileHashes",
  );
  stateInvariant(Array.isArray(state.discountSignatureEvents), "COLLECTION_REQUIRED", "$.discountSignatureEvents");
  stateInvariant(
    state.legacyIrHistory !== null && typeof state.legacyIrHistory === "object" && !Array.isArray(state.legacyIrHistory),
    "LEGACY_IR_HISTORY_REQUIRED",
    "$.legacyIrHistory",
  );
  stateInvariant(
    state.activeParkingClaim !== null && typeof state.activeParkingClaim === "object" && !Array.isArray(state.activeParkingClaim),
    "ACTIVE_PARKING_CLAIM_REQUIRED",
    "$.activeParkingClaim",
  );
  stateInvariant(
    typeof state.legacyParkingOriginsCommitment === "string"
      && /^sha256-utf16le:[a-f0-9]{64}$/u.test(state.legacyParkingOriginsCommitment)
      && state.legacyParkingOriginsCommitment === legacyParkingOriginsCommitment(state.legacyParkingOrigins),
    "LEGACY_PARKING_ORIGIN_COMMITMENT",
    "$.legacyParkingOriginsCommitment",
  );
  stateInvariant(
    state.protectionAnchor === undefined
      || (typeof state.protectionAnchor === "string" && state.protectionAnchor.length > 0),
    "PROTECTION_ANCHOR",
    "$.protectionAnchor",
  );
  stateInvariant(
    (state.legacyQuickParkingTakeovers ?? []).length === 0
      && (state.legacyQuickParkingTakeoverOrigins ?? []).length === 0
      && (state.legacyQuickParkingIsolates ?? []).length === 0,
    "LEGACY_QUICK_PARKING_RETIRED",
    "$.legacyQuickParkingTakeover",
  );

  const customerIds = new Set(state.customers.map((item) => item.id));
  const vehicleIds = new Set(state.vehicles.map((item) => item.id));
  const reportIds = new Set(state.inspectionReports.map((item) => item.id));
  const inspectionItemById = new Map(state.inspectionItems.map((item) => [item.id, item]));
  const quotationItemById = new Map(state.quotationItems.map((item) => [item.id, item]));
  const currentQuotationById = new Map(state.currentQuotations.map((item) => [item.id, item]));
  const reportById = new Map(state.inspectionReports.map((item) => [item.id, item]));
  const quotedChargeLineById = new Map(state.quotedChargeLines.map((item) => [item.id, item]));
  const legacyChargeRecordById = new Map(state.legacyChargeRecords.map((item) => [item.id, item]));
  const attachmentById = new Map(state.reportAttachments.map((item) => [item.id, item]));
  const attachmentAuditById = new Map(state.reportAttachmentAuditEvents.map((item) => [item.id, item]));
  const activeQuotedLineIds = new Set<string>();
  const activeLegacyAdjustmentIds = new Set<string>();
  const activeGeneratedBundleIds = new Set<string>();
  const activeGeneratedAttachmentIds = new Set<string>();
  const activeQuickOrderLineIds = new Set<string>();
  const activeQuickBusinessOrderNos = new Set<string>();
  const businessOrderIds = new Set([...state.businessOrders.map((item) => item.id), ...state.quickOrders.map((item) => item.id)]);
  stateInvariant(
    businessOrderIds.size === state.businessOrders.length + state.quickOrders.length,
    "BUSINESS_ORDER_OWNER_NAMESPACE",
    "$.businessOrders|$.quickOrders",
  );
  const businessOrderById = new Map(state.businessOrders.map((item) => [item.id, item]));
  const quickOrderById = new Map(state.quickOrders.map((item) => [item.id, item]));
  const orderRecordById = new Map(state.orderRecords.map((item) => [item.id, item]));
  const invoiceById = new Map(state.invoices.map((item) => [item.id, item]));

  state.customers.forEach((customer, index) => {
    const path = `$.customers[${index}]`;
    stateInvariant(hasOnlyKeys(customer as unknown as Record<string, unknown>, new Set(["id", "nameZh", "nameEn", "phone", "email"])), "CUSTOMER_FACT_CLOSED", path);
    stateInvariant(typeof customer.id === "string" && customer.id.length > 0, "CUSTOMER_FACT_ID", `${path}.id`);
    stateInvariant(typeof customer.nameZh === "string" && customer.nameZh.length > 0, "CUSTOMER_FACT_NAME", `${path}.nameZh`);
    stateInvariant(typeof customer.phone === "string", "CUSTOMER_FACT_PHONE", `${path}.phone`);
    stateInvariant(customer.email === null || (typeof customer.email === "string" && customer.email.trim().length > 0), "CUSTOMER_FACT_EMAIL", `${path}.email`);
  });

  const quickPaymentReceiptNos = new Set<string>();
  const quickRefundReceiptNos = new Set<string>();
  state.quickOrders.forEach((order, orderIndex) => {
    const path = `$.quickOrders[${orderIndex}]`;
    validateQuickPaymentReceipts(order, path, quickPaymentReceiptNos);
    validateQuickRefunds(order, path, quickRefundReceiptNos);
    stateInvariant(!activeQuickBusinessOrderNos.has(order.businessOrderNo), "QUICK_BO_NUMBER", `${path}.businessOrderNo`);
    activeQuickBusinessOrderNos.add(order.businessOrderNo);
    stateInvariant(Array.isArray(order.items), "QUICK_BO_ITEMS", `${path}.items`);
    stateInvariant(Array.isArray(order.statusHistory) && order.statusHistory.length > 0, "QUICK_BO_STATUS_HISTORY", `${path}.statusHistory`);
    const submissionEvents = order.statusHistory.filter((event) => event.from === "returned" && event.to === "submitted");
    submissionEvents.forEach((event, eventIndex) => {
      const eventPath = `${path}.statusHistory[submission:${eventIndex}]`;
      stateInvariant(typeof event.teamId === "string" && event.teamId.length > 0, "QUICK_BO_SUBMISSION_TEAM", `${eventPath}.teamId`);
      stateInvariant(Number.isSafeInteger(event.performanceValueJmd), "QUICK_BO_SUBMISSION_PERFORMANCE", `${eventPath}.performanceValueJmd`);
      stateInvariant(Number.isSafeInteger(event.roundNumber) && (event.roundNumber ?? 0) >= 1, "QUICK_BO_SUBMISSION_ROUND", `${eventPath}.roundNumber`);
    });
    if (order.status === "submitted") {
      stateInvariant(typeof order.teamId === "string" && order.teamId.length > 0, "QUICK_BO_SUBMITTED_TEAM", `${path}.teamId`);
      stateInvariant(typeof order.assignedAt === "string" && order.assignedAt.length > 0, "QUICK_BO_SUBMITTED_ASSIGNED_AT", `${path}.assignedAt`);
      stateInvariant(typeof order.acceptedAt === "string" && order.acceptedAt.length > 0, "QUICK_BO_SUBMITTED_ACCEPTED_AT", `${path}.acceptedAt`);
      stateInvariant(typeof order.returnedAt === "string" && order.returnedAt.length > 0, "QUICK_BO_SUBMITTED_RETURNED_AT", `${path}.returnedAt`);
      stateInvariant(typeof order.submittedAt === "string" && order.submittedAt.length > 0, "QUICK_BO_SUBMITTED_AT", `${path}.submittedAt`);
      stateInvariant(typeof order.submittedBy === "string" && order.submittedBy.length > 0, "QUICK_BO_SUBMITTED_BY", `${path}.submittedBy`);
      const currentSubmission = [...submissionEvents].reverse().find((event) => event.cancelledAt === undefined);
      stateInvariant(currentSubmission !== undefined, "QUICK_BO_SUBMITTED_EVENT", `${path}.statusHistory`);
      stateInvariant(currentSubmission?.at === order.submittedAt, "QUICK_BO_SUBMITTED_EVENT_TIME", `${path}.submittedAt`);
      stateInvariant(currentSubmission?.teamId === order.teamId, "QUICK_BO_SUBMITTED_EVENT_TEAM", `${path}.teamId`);
      stateInvariant(currentSubmission?.performanceValueJmd === order.performanceValueJmd, "QUICK_BO_SUBMITTED_EVENT_PERFORMANCE", `${path}.performanceValueJmd`);
    }
    if (order.chargeContract === QUICK_ORDER_SHARED_CHARGE_CONTRACT) {
      stateInvariant(customerIds.has(order.customerId), "QUICK_BO_CUSTOMER_REF", `${path}.customerId`);
      stateInvariant(vehicleIds.has(order.vehicleId), "QUICK_BO_VEHICLE_REF", `${path}.vehicleId`);
      stateInvariant(state.vehicles.some((vehicle) => vehicle.id === order.vehicleId && vehicle.customerId === order.customerId), "QUICK_BO_VEHICLE_CUSTOMER", path);
      stateInvariant(
        !["sourceProject", "inspectionReportId", "quotationId", "sourceSnapshot", "sourceHash"].some((key) => key in order),
        "QUICK_BO_SHARED_RELATIONSHIP",
        path,
      );
      stateInvariant(order.items.length === 0, "QUICK_BO_SHARED_AMBIGUOUS_ITEMS", `${path}.items`);
      stateInvariant(Array.isArray(order.chargeLines) && order.chargeLines.length > 0, "QUICK_BO_SHARED_LINES", `${path}.chargeLines`);
      stateInvariant(order.laborDiscountJmd === 0 && order.partsDiscountJmd === 0, "QUICK_BO_SHARED_LEGACY_DISCOUNT", path);
      stateInvariant(uniqueIds(order.chargeLines), "QUICK_BO_SHARED_LINE_ID", `${path}.chargeLines`);
      order.chargeLines.forEach((line, lineIndex) => {
        const linePath = `${path}.chargeLines[${lineIndex}]`;
        stateInvariant(!activeQuickOrderLineIds.has(line.id), "QUICK_BO_GLOBAL_LINE_ID", `${linePath}.id`);
        activeQuickOrderLineIds.add(line.id);
        stateInvariant(line.pricingMode !== "parking_projection", "QUICK_BO_SHARED_PARKING", linePath);
        stateInvariant(line.sourceId === undefined, "QUICK_BO_SHARED_SOURCE", `${linePath}.sourceId`);
        try {
          validateQuotedChargeLine(line);
        } catch {
          stateInvariant(false, "QUICK_BO_SHARED_LINE_SCHEMA", linePath);
        }
      });
    } else {
      stateInvariant(order.chargeContract === undefined, "QUICK_BO_CHARGE_CONTRACT", `${path}.chargeContract`);
      stateInvariant(order.chargeLines === undefined, "QUICK_BO_LEGACY_SHARED_LINES", `${path}.chargeLines`);
      stateInvariant(uniqueIds(order.items), "QUICK_BO_LEGACY_LINE_ID", `${path}.items`);
      order.items.forEach((item, itemIndex) => {
        const itemPath = `${path}.items[${itemIndex}]`;
        stateInvariant(!activeQuickOrderLineIds.has(item.id), "QUICK_BO_GLOBAL_LINE_ID", `${itemPath}.id`);
        activeQuickOrderLineIds.add(item.id);
        stateInvariant(item.category === "labor" || item.category === "parts", "QUICK_BO_LEGACY_CATEGORY", `${itemPath}.category`);
        stateInvariant(typeof item.descZh === "string" && item.descZh.trim().length > 0, "QUICK_BO_LEGACY_DESC", `${itemPath}.descZh`);
        stateInvariant(typeof item.descEn === "string", "QUICK_BO_LEGACY_DESC", `${itemPath}.descEn`);
        stateInvariant(item.unit === undefined || (typeof item.unit === "string" && item.unit.trim().length > 0), "QUICK_BO_LEGACY_UNIT", `${itemPath}.unit`);
        stateInvariant(Number.isSafeInteger(item.unitPriceJmd) && item.unitPriceJmd >= 0, "QUICK_BO_LEGACY_PRICE", `${itemPath}.unitPriceJmd`);
        stateInvariant(Number.isSafeInteger(item.quantity) && item.quantity > 0, "QUICK_BO_LEGACY_QUANTITY", `${itemPath}.quantity`);
        stateInvariant(typeof item.pendingQuote === "boolean", "QUICK_BO_LEGACY_PENDING", `${itemPath}.pendingQuote`);
        stateInvariant(!("pricingMode" in item) && !("amountJmd" in item) && !("sourceId" in item), "QUICK_BO_LEGACY_DISCRIMINANT", itemPath);
      });
    }
  });

  state.vehicles.forEach((vehicle, index) => {
    stateInvariant(customerIds.has(vehicle.customerId), "VEHICLE_CUSTOMER_REF", `$.vehicles[${index}].customerId`);
  });
  state.orderRecords.forEach((record, index) => {
    const path = `$.orderRecords[${index}]`;
    const businessOrder = businessOrderById.get(record.id);
    stateInvariant(customerIds.has(record.customer.id), "ORDER_RECORD_CUSTOMER_REF", `${path}.customer.id`);
    stateInvariant(vehicleIds.has(record.vehicle.id), "ORDER_RECORD_VEHICLE_REF", `${path}.vehicle.id`);
    stateInvariant(Boolean(businessOrder), "ORDER_RECORD_BO_REF", `${path}.id`);
    stateInvariant(businessOrder?.customerId === record.customer.id, "ORDER_RECORD_BO_CUSTOMER_MATCH", `${path}.customer.id`);
  });
  state.inspectionReports.forEach((report, reportIndex) => {
    stateInvariant(customerIds.has(report.customerId), "IR_CUSTOMER_REF", `$.inspectionReports[${reportIndex}].customerId`);
    stateInvariant(vehicleIds.has(report.vehicleId), "IR_VEHICLE_REF", `$.inspectionReports[${reportIndex}].vehicleId`);
    const quotation = currentQuotationById.get(report.quotationId);
    stateInvariant(quotation?.inspectionReportId === report.id, "IR_QUOTATION_REF", `$.inspectionReports[${reportIndex}].quotationId`);
    stateInvariant(
      Number.isSafeInteger(report.submissionSourceVersion) && report.submissionSourceVersion >= 1,
      "IR_SUBMISSION_SOURCE_VERSION",
      `$.inspectionReports[${reportIndex}].submissionSourceVersion`,
    );
    stateInvariant(typeof report.categoryReviewRequired === "boolean", "IR_CATEGORY_REVIEW", `$.inspectionReports[${reportIndex}].categoryReviewRequired`);
    stateInvariant(!("photos" in report), "IR_PHOTO_BYTES_FORBIDDEN", `$.inspectionReports[${reportIndex}].photos`);
    stateInvariant(Array.isArray(report.photoIds), "IR_PHOTOS_REQUIRED", `$.inspectionReports[${reportIndex}].photoIds`);
    stateInvariant(new Set(report.photoIds).size === report.photoIds.length, "IR_PHOTO_DUPLICATE", `$.inspectionReports[${reportIndex}].photoIds`);
    report.photoIds.forEach((photoId, photoIndex) => {
      const attachment = attachmentById.get(photoId);
      stateInvariant(
        attachment?.reportId === report.id
          && attachment.vehicleId === report.vehicleId
          && attachment.lifecycle === "active"
          && attachment.activeSequence === photoIndex,
        "IR_PHOTO_REF",
        `$.inspectionReports[${reportIndex}].photoIds[${photoIndex}]`,
      );
    });
    report.itemIds.forEach((itemId, itemIndex) => {
      stateInvariant(
        inspectionItemById.get(itemId)?.inspectionReportId === report.id,
        "IR_ITEM_REF",
        `$.inspectionReports[${reportIndex}].itemIds[${itemIndex}]`,
      );
    });
  });
  state.inspectionItems.forEach((item, itemIndex) => {
    stateInvariant(!("photos" in item), "IR_ITEM_PHOTOS_MOVED", `$.inspectionItems[${itemIndex}].photos`);
  });
  state.reportAttachments.forEach((attachment, index) => {
    const path = `$.reportAttachments[${index}]`;
    const report = state.inspectionReports.find((item) => item.id === attachment.reportId);
    stateInvariant(reportIds.has(attachment.reportId), "ATTACHMENT_REPORT_REF", `${path}.reportId`);
    stateInvariant(vehicleIds.has(attachment.vehicleId), "ATTACHMENT_VEHICLE_REF", `${path}.vehicleId`);
    stateInvariant(report?.vehicleId === attachment.vehicleId, "ATTACHMENT_REPORT_VEHICLE", path);
    if (attachment.lifecycle === "active") {
      stateInvariant(
        Number.isSafeInteger(attachment.activeSequence)
          && (attachment.activeSequence ?? -1) >= 0
          && report?.photoIds[attachment.activeSequence!] === attachment.id,
        "ATTACHMENT_REPORT_ORDER",
        path,
      );
      stateInvariant(
        attachment.deletedAt === undefined
          && attachment.deletedByActorId === undefined
          && attachment.deletedByActorName === undefined,
        "ATTACHMENT_ACTIVE_DELETE_FIELDS",
        path,
      );
    } else {
      stateInvariant(attachment.lifecycle === "deleted" && attachment.activeSequence === null, "ATTACHMENT_LIFECYCLE", path);
      stateInvariant(!report?.photoIds.includes(attachment.id), "ATTACHMENT_DELETED_ACTIVE", path);
      stateInvariant(isJamaicaInstant(attachment.deletedAt), "ATTACHMENT_DELETED_AT", `${path}.deletedAt`);
      stateInvariant(typeof attachment.deletedByActorId === "string" && attachment.deletedByActorId.length > 0, "ATTACHMENT_DELETED_ACTOR", path);
      stateInvariant(typeof attachment.deletedByActorName === "string" && attachment.deletedByActorName.length > 0, "ATTACHMENT_DELETED_ACTOR", path);
    }
    if (attachment.storageKind === "legacy_reference") {
      throw new LinkedStateInvariantError("ATTACHMENT_LEGACY_RETIRED", path);
    } else {
      stateInvariant(attachment.storageKind === "indexeddb_blob", "ATTACHMENT_STORAGE_KIND", `${path}.storageKind`);
      stateInvariant(hasOnlyKeys(attachment as unknown as Record<string, unknown>, new Set([
        "id", "reportId", "vehicleId", "lifecycle", "activeSequence",
        "deletedAt", "deletedByActorId", "deletedByActorName", "storageKind",
        "originalName", "detectedMediaType", "widthPx", "heightPx", "byteLength", "sha256",
        "createdAt", "uploaderActorId", "uploaderActorName", "legacyOrigin",
      ])), "ATTACHMENT_BLOB_CLOSED", path);
      stateInvariant(
        attachment.legacyOrigin
          ? attachment.originalName === null || (typeof attachment.originalName === "string" && attachment.originalName.length > 0)
          : typeof attachment.originalName === "string" && attachment.originalName.length > 0,
        "ATTACHMENT_FILE_NAME",
        path,
      );
      stateInvariant(["image/jpeg", "image/png", "image/webp"].includes(attachment.detectedMediaType), "ATTACHMENT_MEDIA_TYPE", path);
      stateInvariant(Number.isSafeInteger(attachment.widthPx) && attachment.widthPx > 0, "ATTACHMENT_WIDTH", path);
      stateInvariant(Number.isSafeInteger(attachment.heightPx) && attachment.heightPx > 0, "ATTACHMENT_HEIGHT", path);
      stateInvariant(Number.isSafeInteger(attachment.byteLength) && attachment.byteLength > 0, "ATTACHMENT_BYTES", path);
      stateInvariant(/^sha256-bytes-v1:[a-f0-9]{64}$/.test(attachment.sha256), "ATTACHMENT_SHA256", path);
      stateInvariant(isJamaicaInstant(attachment.createdAt), "ATTACHMENT_CREATED_AT", path);
      stateInvariant(typeof attachment.uploaderActorId === "string" && attachment.uploaderActorId.length > 0, "ATTACHMENT_UPLOADER", path);
      stateInvariant(typeof attachment.uploaderActorName === "string" && attachment.uploaderActorName.length > 0, "ATTACHMENT_UPLOADER", path);
      if (attachment.legacyOrigin !== undefined) {
        stateInvariant(false, "ATTACHMENT_LEGACY_ORIGIN_RETIRED", `${path}.legacyOrigin`);
      }
    }
  });
  state.reportAttachmentAuditEvents.forEach((event, index) => {
    const path = `$.reportAttachmentAuditEvents[${index}]`;
    const attachment = attachmentById.get(event.attachmentId);
    stateInvariant(hasOnlyKeys(event as unknown as Record<string, unknown>, new Set([
      "id", "attachmentId", "reportId", "vehicleId", "action", "actorId", "actorName", "mutationId", "recordedAt",
    ])), "ATTACHMENT_AUDIT_CLOSED", path);
    stateInvariant(Boolean(attachment), "ATTACHMENT_AUDIT_REF", `${path}.attachmentId`);
    stateInvariant(attachment?.reportId === event.reportId && attachment.vehicleId === event.vehicleId, "ATTACHMENT_AUDIT_OWNER", path);
    stateInvariant(["uploaded", "deleted"].includes(event.action), "ATTACHMENT_AUDIT_ACTION", path);
    stateInvariant(typeof event.actorId === "string" && event.actorId.length > 0, "ATTACHMENT_AUDIT_ACTOR", path);
    stateInvariant(typeof event.actorName === "string" && event.actorName.length > 0, "ATTACHMENT_AUDIT_ACTOR", path);
    stateInvariant(typeof event.mutationId === "string" && event.mutationId.length > 0, "ATTACHMENT_AUDIT_MUTATION", path);
    stateInvariant(isJamaicaInstant(event.recordedAt), "ATTACHMENT_AUDIT_TIME", path);
    if (event.action === "uploaded") {
      stateInvariant(
        attachment?.storageKind === "indexeddb_blob"
          && attachment.createdAt === event.recordedAt
          && attachment.uploaderActorId === event.actorId
          && attachment.uploaderActorName === event.actorName,
        "ATTACHMENT_AUDIT_UPLOAD",
        path,
      );
    } else if (event.action === "deleted") {
      stateInvariant(
        attachment?.lifecycle === "deleted"
          && attachment.deletedAt === event.recordedAt
          && attachment.deletedByActorId === event.actorId
          && attachment.deletedByActorName === event.actorName,
        "ATTACHMENT_AUDIT_DELETE",
        path,
      );
    } else {
      const matchingReceipts = state.mutationReceipts.filter((receipt) => {
        if (receipt.operation !== "inspection.photos.update"
          || receipt.mutationId !== event.mutationId
          || receipt.actorId !== event.actorId
          || receipt.committedAt !== event.recordedAt
          || !isPlainRecord(receipt.result)
          || !Array.isArray(receipt.result.auditEventIds)) return false;
        return receipt.result.auditEventIds.includes(event.id);
      });
      stateInvariant(matchingReceipts.length === 1, "ATTACHMENT_AUDIT_MUTATION_RECEIPT", path);
    }
  });
  state.reportAttachments.forEach((attachment, index) => {
    const path = `$.reportAttachments[${index}]`;
    const audits = state.reportAttachmentAuditEvents.filter((event) => event.attachmentId === attachment.id);
    if (attachment.storageKind === "indexeddb_blob") {
      const creationAction = "uploaded";
      stateInvariant(
        audits.filter((event) => event.action === creationAction).length === 1,
        "ATTACHMENT_CREATION_AUDIT_REQUIRED",
        path,
      );
      stateInvariant(
        audits.filter((event) => event.action !== creationAction && event.action !== "deleted").length === 0,
        "ATTACHMENT_CREATION_AUDIT_KIND",
        path,
      );
    } else {
      stateInvariant(
        audits.every((event) => event.action === "deleted"),
        "ATTACHMENT_LEGACY_AUDIT_KIND",
        path,
      );
    }
    stateInvariant(
      audits.filter((event) => event.action === "deleted").length === (attachment.lifecycle === "deleted" ? 1 : 0),
      "ATTACHMENT_DELETE_AUDIT_REQUIRED",
      path,
    );
  });
  state.quotations.forEach((quotation, quotationIndex) => {
    stateInvariant(reportIds.has(quotation.inspectionReportId), "QT_IR_REF", `$.quotations[${quotationIndex}].inspectionReportId`);
    stateInvariant(uniqueIds(quotation.versions), "QT_VERSION_ID", `$.quotations[${quotationIndex}].versions`);
    quotation.versions.forEach((version, versionIndex) => {
      version.quotationItemIds.forEach((itemId, itemIndex) => {
        const item = quotationItemById.get(itemId);
        const source = item ? inspectionItemById.get(item.sourceInspectionItemId) : undefined;
        stateInvariant(item?.quotationVersionId === version.id, "QT_ITEM_VERSION_REF", `$.quotations[${quotationIndex}].versions[${versionIndex}].quotationItemIds[${itemIndex}]`);
        // Legacy versions are exact read-only history. Their old category and
        // source graph may be incomplete; current writes never target them.
        void source;
      });
    });
  });
  state.currentQuotations.forEach((quotation, quotationIndex) => {
    const path = `$.currentQuotations[${quotationIndex}]`;
    stateInvariant(reportIds.has(quotation.inspectionReportId), "CURRENT_QT_IR_REF", `${path}.inspectionReportId`);
    stateInvariant(typeof quotation.noteZh === "string" && typeof quotation.noteEn === "string", "CURRENT_QT_NOTES", path);
    stateInvariant(Number.isSafeInteger(quotation.contentRevision) && quotation.contentRevision >= 1, "CURRENT_QT_CONTENT_REVISION", `${path}.contentRevision`);
    stateInvariant(Number.isSafeInteger(quotation.generationCounter) && quotation.generationCounter >= 0, "CURRENT_QT_GENERATION", `${path}.generationCounter`);
    stateInvariant(quotation.lastGeneratedAt === null || isValidIsoTimestamp(quotation.lastGeneratedAt), "CURRENT_QT_GENERATED_AT", `${path}.lastGeneratedAt`);
    stateInvariant(quotation.generatedFromRevision === null || (Number.isSafeInteger(quotation.generatedFromRevision) && quotation.generatedFromRevision >= 1), "CURRENT_QT_GENERATED_REVISION", `${path}.generatedFromRevision`);
    if (quotation.activeGeneratedBundle !== null) {
      const bundle = quotation.activeGeneratedBundle;
      const bundlePath = `${path}.activeGeneratedBundle`;
      stateInvariant(bundle.reportId === quotation.inspectionReportId, "CURRENT_QT_BUNDLE_REPORT", `${bundlePath}.reportId`);
      stateInvariant(bundle.quotationId === quotation.id, "CURRENT_QT_BUNDLE_QUOTATION", `${bundlePath}.quotationId`);
      stateInvariant(bundle.generation === quotation.generationCounter && bundle.generation >= 1, "CURRENT_QT_BUNDLE_GENERATION", `${bundlePath}.generation`);
      stateInvariant(bundle.generatedAt === quotation.lastGeneratedAt && isValidIsoTimestamp(bundle.generatedAt), "CURRENT_QT_BUNDLE_TIME", `${bundlePath}.generatedAt`);
      stateInvariant(bundle.contentRevision === quotation.generatedFromRevision && bundle.contentRevision >= 1, "CURRENT_QT_BUNDLE_CONTENT", `${bundlePath}.contentRevision`);
      stateInvariant(typeof bundle.id === "string" && bundle.id.length > 0, "CURRENT_QT_BUNDLE_ID", `${bundlePath}.id`);
      stateInvariant(!activeGeneratedBundleIds.has(bundle.id), "CURRENT_QT_BUNDLE_ID_GLOBAL", `${bundlePath}.id`);
      activeGeneratedBundleIds.add(bundle.id);
      stateInvariant(typeof bundle.rendererVersion === "string" && bundle.rendererVersion.length > 0, "CURRENT_QT_BUNDLE_RENDERER", `${bundlePath}.rendererVersion`);
      stateInvariant(Array.isArray(bundle.attachments) && bundle.attachments.length === 3, "CURRENT_QT_BUNDLE_ATTACHMENTS", `${bundlePath}.attachments`);
      const languages = new Set(bundle.attachments.map((attachment) => attachment.language));
      stateInvariant(languages.size === 3 && ["zh", "en", "bilingual"].every((language) => languages.has(language as never)), "CURRENT_QT_BUNDLE_LANGUAGES", `${bundlePath}.attachments`);
      stateInvariant(new Set(bundle.attachments.map((attachment) => attachment.id)).size === 3, "CURRENT_QT_BUNDLE_ATTACHMENT_IDS", `${bundlePath}.attachments`);
      bundle.attachments.forEach((attachment, attachmentIndex) => {
        const attachmentPath = `${bundlePath}.attachments[${attachmentIndex}]`;
        stateInvariant(typeof attachment.id === "string" && attachment.id.length > 0, "CURRENT_QT_BUNDLE_ATTACHMENT_ID", `${attachmentPath}.id`);
        stateInvariant(!activeGeneratedAttachmentIds.has(attachment.id), "CURRENT_QT_BUNDLE_ATTACHMENT_ID_GLOBAL", `${attachmentPath}.id`);
        activeGeneratedAttachmentIds.add(attachment.id);
        stateInvariant(typeof attachment.fileName === "string" && attachment.fileName.length > 0, "CURRENT_QT_BUNDLE_ATTACHMENT_NAME", `${attachmentPath}.fileName`);
        stateInvariant(Number.isSafeInteger(attachment.byteLength) && attachment.byteLength > 0, "CURRENT_QT_BUNDLE_ATTACHMENT_LENGTH", `${attachmentPath}.byteLength`);
        stateInvariant(attachment.mediaType === "application/pdf", "CURRENT_QT_BUNDLE_ATTACHMENT_TYPE", `${attachmentPath}.mediaType`);
      });
    }
    stateInvariant(new Set(quotation.lineIds).size === quotation.lineIds.length, "CURRENT_QT_LINE_DUPLICATE", `${path}.lineIds`);
    stateInvariant(Array.isArray(quotation.legacyReceivableAdjustmentIds), "CURRENT_QT_LEGACY_ADJUSTMENTS", `${path}.legacyReceivableAdjustmentIds`);
    stateInvariant(
      new Set(quotation.legacyReceivableAdjustmentIds).size === quotation.legacyReceivableAdjustmentIds.length,
      "CURRENT_QT_LEGACY_ADJUSTMENT_DUPLICATE",
      `${path}.legacyReceivableAdjustmentIds`,
    );
    quotation.legacyReceivableAdjustmentIds.forEach((adjustmentId, adjustmentIndex) => {
      const adjustment = legacyChargeRecordById.get(adjustmentId);
      const adjustmentPath = `${path}.legacyReceivableAdjustmentIds[${adjustmentIndex}]`;
      stateInvariant(
        adjustment?.status === "legacy_unclassified"
          && adjustment.quotationId === quotation.id
          && adjustment.reportId === quotation.inspectionReportId
          && adjustment.original.kind === "legacy_category_discount",
        "CURRENT_QT_LEGACY_ADJUSTMENT_REF",
        adjustmentPath,
      );
      stateInvariant(!activeLegacyAdjustmentIds.has(adjustmentId), "CURRENT_QT_LEGACY_ADJUSTMENT_MULTI_OWNER", adjustmentPath);
      activeLegacyAdjustmentIds.add(adjustmentId);
    });
    quotation.lineIds.forEach((lineId, lineIndex) => {
      const line = quotedChargeLineById.get(lineId);
      stateInvariant(Boolean(line), "CURRENT_QT_LINE_REF", `${path}.lineIds[${lineIndex}]`);
      stateInvariant(line?.pricingMode !== "parking_projection", "CURRENT_QT_PARKING_FORBIDDEN", `${path}.lineIds[${lineIndex}]`);
      stateInvariant(!activeQuotedLineIds.has(lineId), "CURRENT_QT_LINE_MULTI_OWNER", `${path}.lineIds[${lineIndex}]`);
      activeQuotedLineIds.add(lineId);
    });
    stateInvariant(
      state.inspectionReports.find((report) => report.id === quotation.inspectionReportId)?.quotationId === quotation.id,
      "CURRENT_QT_REPORT_OWNER",
      `${path}.inspectionReportId`,
    );
  });
  state.quotedChargeLines.forEach((line, lineIndex) => {
    try {
      validateQuotedChargeLine(line);
    } catch {
      stateInvariant(false, "CURRENT_QT_LINE_SCHEMA", `$.quotedChargeLines[${lineIndex}]`);
    }
    stateInvariant(line.pricingMode !== "parking_projection", "CURRENT_QT_PARKING_FORBIDDEN", `$.quotedChargeLines[${lineIndex}]`);
    stateInvariant(activeQuotedLineIds.has(line.id), "CURRENT_QT_LINE_ORPHAN", `$.quotedChargeLines[${lineIndex}].id`);
  });
  state.legacyChargeRecords.forEach((record, index) => {
    const path = `$.legacyChargeRecords[${index}]`;
    stateInvariant(
      record.status === "legacy_unclassified"
        || record.status === "legacy_parking_unlinked"
        || record.status === "legacy_parking_mismatch"
        || record.status === "legacy_parking_duplicate",
      "LEGACY_CHARGE_STATUS",
      `${path}.status`,
    );
    stateInvariant(Number.isSafeInteger(record.amountJmd) && record.amountJmd >= 0, "LEGACY_CHARGE_AMOUNT", `${path}.amountJmd`);
    stateInvariant(isPlainRecord(record.original), "LEGACY_CHARGE_ORIGINAL", `${path}.original`);
    stateInvariant(
      !activeQuotedLineIds.has(record.id),
      "LEGACY_CHARGE_ACTIVE_ID_OVERLAP",
      `${path}.id`,
    );
    const quotation = typeof record.quotationId === "string"
      ? currentQuotationById.get(record.quotationId)
      : undefined;
    const report = typeof record.reportId === "string" ? reportById.get(record.reportId) : undefined;
    const quoteOwner = Boolean(
      quotation
      && report
      && quotation.inspectionReportId === report.id
      && report.quotationId === quotation.id
      && record.invoiceId === undefined
      && record.invoiceVersionId === undefined,
    );
    const invoice = typeof record.invoiceId === "string" ? invoiceById.get(record.invoiceId) : undefined;
    const invoiceVersion = invoice?.versions.find((version) => version.id === record.invoiceVersionId);
    const invoiceOwner = Boolean(
      invoice
      && invoiceVersion
      && record.reportId === undefined
      && record.quotationId === undefined,
    );
    const ownerValid = record.status === "legacy_unclassified"
      ? quoteOwner
      : record.status === "legacy_parking_unlinked"
        ? quoteOwner !== invoiceOwner
        : invoiceOwner;
    stateInvariant(ownerValid, "LEGACY_CHARGE_OWNER", path);
    let sourceRowBound = false;
    if (quoteOwner) {
      const quotationArchive = state.quotations.find((candidate) => candidate.id === record.quotationId);
      if (record.original.kind === "legacy_category_discount") {
        const category = record.original.category;
        const field = category === "labor"
          ? "laborDiscountJmd"
          : category === "parts"
            ? "partsDiscountJmd"
            : undefined;
        const archivedRecord = quotationArchive as unknown as Record<string, unknown> | undefined;
        sourceRowBound = Boolean(
          field
          && Number.isSafeInteger(record.original.value)
          && archivedRecord?.[field] === record.original.value,
        );
      } else {
        const originalId = typeof record.original.id === "string"
          ? record.original.id
          : typeof record.original.quotationItemId === "string"
            ? record.original.quotationItemId
            : undefined;
        const originalVersionId = typeof record.original.quotationVersionId === "string"
          ? record.original.quotationVersionId
          : undefined;
        const archiveVersion = quotationArchive?.versions.find((version) => (
          version.id === originalVersionId && originalId !== undefined && version.quotationItemIds.includes(originalId)
        ));
        const archivedItem = originalId ? quotationItemById.get(originalId) : undefined;
        sourceRowBound = Boolean(
          archiveVersion
          && archivedItem
          && stableJson(archivedItem) === stableJson(record.original),
        );
      }
    } else if (invoiceOwner) {
      const versionRecord = invoiceVersion as unknown as Record<string, unknown>;
      const sourceRows = [versionRecord.lines, versionRecord.chargeLines, versionRecord.items]
        .find((candidate): candidate is Array<Record<string, unknown>> => Array.isArray(candidate)) ?? [];
      const originalId = typeof record.original.id === "string"
        ? record.original.id
        : typeof record.original.chargeLineId === "string"
          ? record.original.chargeLineId
          : undefined;
      const archivedLine = originalId ? sourceRows.find((line) => (
        line.id === originalId || line.chargeLineId === originalId
      )) : undefined;
      sourceRowBound = Boolean(archivedLine && stableJson(archivedLine) === stableJson(record.original));
    }
    stateInvariant(sourceRowBound, "LEGACY_CHARGE_SOURCE_ROW", `${path}.original`);
    let expectedAmountJmd: number | undefined;
    try {
      expectedAmountJmd = record.original.kind === "legacy_category_discount"
        ? Number.isSafeInteger(record.original.value) && Number(record.original.value) >= 0
          ? Number(record.original.value)
          : 0
        : invoiceOwner
          ? legacyParkingAmount(record.original)
          : legacyMoney(record.original).amountJmd;
    } catch {
      expectedAmountJmd = undefined;
    }
    stateInvariant(expectedAmountJmd === record.amountJmd, "LEGACY_CHARGE_AMOUNT_SOURCE", `${path}.amountJmd`);
    if (quoteOwner) {
      stateInvariant(report?.categoryReviewRequired === true, "LEGACY_CHARGE_REVIEW", `${path}.reportId`);
    } else if (invoiceOwner) {
      const businessOrder = businessOrderById.get(invoice!.businessOrderId);
      state.inspectionReports.filter((candidate) => candidate.vehicleId === businessOrder?.vehicleId).forEach((candidate) => {
        stateInvariant(candidate.categoryReviewRequired, "LEGACY_CHARGE_REVIEW", `${path}.invoiceId`);
      });
    }
    if (record.original.kind === "legacy_category_discount") {
      stateInvariant(
        activeLegacyAdjustmentIds.has(record.id),
        "LEGACY_CATEGORY_DISCOUNT_UNREFERENCED",
        `$.legacyChargeRecords[${index}].id`,
      );
    }
  });
  state.currentQuotations.forEach((quotation, index) => {
    try {
      deriveCurrentQuotationReceivableJmd(state, quotation.id);
    } catch {
      stateInvariant(false, "CURRENT_QT_RECEIVABLE", `$.currentQuotations[${index}]`);
    }
  });
  state.businessOrders.forEach((order, orderIndex) => {
    const record = orderRecordById.get(order.id);
    stateInvariant(customerIds.has(order.customerId), "BO_CUSTOMER_REF", `$.businessOrders[${orderIndex}].customerId`);
    stateInvariant(vehicleIds.has(order.vehicleId), "BO_VEHICLE_REF", `$.businessOrders[${orderIndex}].vehicleId`);
    stateInvariant(Boolean(record), "BO_RECORD_REF", `$.businessOrders[${orderIndex}].id`);
    stateInvariant(record?.customer.id === order.customerId, "BO_RECORD_CUSTOMER_MATCH", `$.businessOrders[${orderIndex}].customerId`);
    stateInvariant(record?.vehicle.id === order.vehicleId, "BO_RECORD_VEHICLE_MATCH", `$.businessOrders[${orderIndex}].vehicleId`);
    stateInvariant(
      Number.isSafeInteger(order.performanceValueJmd) && order.performanceValueJmd >= 0,
      "BO_PERFORMANCE_VALUE",
      `$.businessOrders[${orderIndex}].performanceValueJmd`,
    );
    stateInvariant(
      order.formalSubmittedAt === null || Number.isFinite(Date.parse(order.formalSubmittedAt)),
      "BO_FORMAL_SUBMITTED_AT",
      `$.businessOrders[${orderIndex}].formalSubmittedAt`,
    );
    stateInvariant(
      order.performanceCountedAt === null || Number.isFinite(Date.parse(order.performanceCountedAt)),
      "BO_PERFORMANCE_COUNTED_AT",
      `$.businessOrders[${orderIndex}].performanceCountedAt`,
    );
    stateInvariant(
      order.performanceCountedAt === null || order.formalSubmittedAt !== null,
      "BO_COUNTED_REQUIRES_FORMAL_SUBMIT",
      `$.businessOrders[${orderIndex}].performanceCountedAt`,
    );
    const startMileage = order.startMileage as unknown;
    if (startMileage !== null) {
      const mileagePath = `$.businessOrders[${orderIndex}].startMileage`;
      stateInvariant(
        typeof startMileage === "object" && startMileage !== null && !Array.isArray(startMileage),
        "BO_START_MILEAGE_KIND",
        mileagePath,
      );
      const mileage = startMileage as BusinessOrderStartMileage;
      stateInvariant(isStartedBusinessOrder(order), "BO_START_MILEAGE_STATUS", mileagePath);
      if (mileage.status === "legacy_missing") {
        stateInvariant(
          mileage.reason === "created_before_start_mileage_rule",
          "BO_START_MILEAGE_LEGACY_REASON",
          `${mileagePath}.reason`,
        );
      } else {
        stateInvariant(mileage.status === "recorded", "BO_START_MILEAGE_KIND", `${mileagePath}.status`);
        stateInvariant(
          Number.isSafeInteger(mileage.value) && mileage.value >= 0,
          "BO_START_MILEAGE_VALUE",
          `${mileagePath}.value`,
        );
        stateInvariant(
          mileage.unit === "km" || mileage.unit === "mile",
          "BO_START_MILEAGE_UNIT",
          `${mileagePath}.unit`,
        );
        stateInvariant(
          isValidIsoTimestamp(mileage.recordedAt) && mileage.recordedAt === record?.acceptedAt,
          "BO_START_MILEAGE_RECORDED_AT",
          `${mileagePath}.recordedAt`,
        );
        stateInvariant(
          typeof mileage.recordedById === "string" && mileage.recordedById.trim().length > 0,
          "BO_START_MILEAGE_RECORDER",
          `${mileagePath}.recordedById`,
        );
        stateInvariant(
          typeof mileage.recordedByName === "string" && mileage.recordedByName.trim().length > 0,
          "BO_START_MILEAGE_RECORDER",
          `${mileagePath}.recordedByName`,
        );
      }
    }
    order.invoiceIds.forEach((invoiceId, invoiceIndex) => {
      stateInvariant(invoiceById.get(invoiceId)?.businessOrderId === order.id, "BO_INVOICE_REF", `$.businessOrders[${orderIndex}].invoiceIds[${invoiceIndex}]`);
    });
    order.items.forEach((item, itemIndex) => {
      const path = `$.businessOrders[${orderIndex}].items[${itemIndex}].sourceProject`;
      const link = item.sourceProject;
      stateInvariant(link.businessOrderId === order.id && link.businessOrderItemId === item.id, "BO_SOURCE_SELF_REF", path);
      stateInvariant(
        [
          link.inspectionReportId,
          link.inspectionItemId,
          link.quotationId,
          link.quotationVersionId,
          link.quotationItemId,
          link.inspectorTeamId,
          link.executionTeamId,
          link.executionStatus,
        ].every((field) => typeof field === "string" && field.length > 0),
        "BO_SOURCE_LEGACY_SHAPE",
        path,
      );
    });
  });
  const billingSequenceByDate = new Map<string, LinkedBillingDocumentSequence>();
  state.billingDocumentSequences.forEach((sequence, index) => {
    const path = `$.billingDocumentSequences[${index}]`;
    stateInvariant(
      hasOnlyKeys(sequence as unknown as Record<string, unknown>, new Set([
        "id", "kind", "branchCode", "brandCode", "businessDate", "lastAllocated",
      ])) && Object.keys(sequence).length === 6,
      "BILLING_DOCUMENT_SEQUENCE_CLOSED",
      path,
    );
    stateInvariant(
      sequence.kind === "invoice"
        && sequence.branchCode === "KGN"
        && sequence.brandCode === "WH"
        && /^\d{8}$/u.test(sequence.businessDate)
        && sequence.id === billingDocumentSequenceId(sequence.businessDate)
        && Number.isSafeInteger(sequence.lastAllocated)
        && sequence.lastAllocated >= 10_000
        && sequence.lastAllocated <= 99_999,
      "BILLING_DOCUMENT_SEQUENCE_VALUE",
      path,
    );
    billingSequenceByDate.set(sequence.businessDate, sequence);
  });
  state.invoices.forEach((invoice, index) => {
    const match = BILLING_INVOICE_NUMBER_PATTERN.exec(invoice.invoiceNo);
    if (!match) return;
    const sequence = billingSequenceByDate.get(match[1]);
    stateInvariant(
      sequence !== undefined && sequence.lastAllocated >= Number(match[2]),
      "BILLING_DOCUMENT_SEQUENCE_HIGH_WATER",
      `$.invoices[${index}].invoiceNo`,
    );
  });
  stateInvariant(
    state.invoices.every((invoice) => typeof invoice.invoiceNo === "string" && invoice.invoiceNo.length > 0)
      && new Set(state.invoices.map((invoice) => invoice.invoiceNo)).size === state.invoices.length,
    "INVOICE_NUMBER_UNIQUE",
    "$.invoices",
  );
  const sharedInvoiceOwnerIds = new Set<string>();
  const globalInvoiceVersionIds = new Set<string>();
  state.invoices.forEach((invoice, invoiceIndex) => {
    const path = `$.invoices[${invoiceIndex}]`;
    stateInvariant(businessOrderIds.has(invoice.businessOrderId), "INVOICE_BO_REF", `${path}.businessOrderId`);
    stateInvariant(invoice.versions.length > 0 && uniqueIds(invoice.versions), "INVOICE_VERSION_ID", `${path}.versions`);
    invoice.versions.forEach((version, versionIndex) => {
      stateInvariant(
        typeof version.id === "string"
          && version.id.length > 0
          && !globalInvoiceVersionIds.has(version.id),
        "INVOICE_VERSION_ID_GLOBAL_UNIQUE",
        `${path}.versions[${versionIndex}].id`,
      );
      globalInvoiceVersionIds.add(version.id);
    });
    if (isSharedChargeInvoice(invoice)) {
      stateInvariant(
        !sharedInvoiceOwnerIds.has(invoice.businessOrderId),
        "INVOICE_SHARED_OWNER_UNIQUE",
        `${path}.businessOrderId`,
      );
      sharedInvoiceOwnerIds.add(invoice.businessOrderId);
      const firstIssuedDate = invoice.versions[0]?.issuedAt.slice(0, 10).replaceAll("-", "");
      stateInvariant(
        typeof firstIssuedDate === "string"
          && new RegExp(`^KGN-WH-INV-${firstIssuedDate}\\d{5}$`, "u").test(invoice.invoiceNo),
        "INVOICE_SHARED_NUMBER",
        `${path}.invoiceNo`,
      );
      stateInvariant(
        hasOnlyKeys(invoice as unknown as Record<string, unknown>, new Set([
          "id", "invoiceNo", "businessOrderId", "settlementArrangement", "invoiceContract",
          "financiallyEffectiveVersionId", "versions",
        ])),
        "INVOICE_SHARED_CLOSED",
        path,
      );
      const owner = quickOrderById.get(invoice.businessOrderId);
      stateInvariant(
        owner?.chargeContract === QUICK_ORDER_SHARED_CHARGE_CONTRACT
          && !businessOrderById.has(invoice.businessOrderId),
        "INVOICE_SHARED_BO_REF",
        `${path}.businessOrderId`,
      );
      stateInvariant(
        typeof invoice.financiallyEffectiveVersionId === "string"
          && invoice.versions[invoice.versions.length - 1]?.id === invoice.financiallyEffectiveVersionId,
        "INVOICE_EFFECTIVE_VERSION",
        `${path}.financiallyEffectiveVersionId`,
      );
      invoice.versions.forEach((version, versionIndex) => {
        const versionPath = `${path}.versions[${versionIndex}]`;
        stateInvariant(
          hasOnlyKeys(version as unknown as Record<string, unknown>, new Set([
            "id", "version", "chargeContract", "snapshot", "snapshotCommitment", "issuedAt",
          ])),
          "INVOICE_SHARED_VERSION_CLOSED",
          versionPath,
        );
        stateInvariant(version.chargeContract === "shared_v1", "INVOICE_SHARED_VERSION_CONTRACT", `${versionPath}.chargeContract`);
        stateInvariant(version.version === versionIndex + 1, "INVOICE_SHARED_VERSION_SEQUENCE", `${versionPath}.version`);
        stateInvariant(isValidIsoTimestamp(version.issuedAt) && /-05:00$/.test(version.issuedAt), "INVOICE_SHARED_VERSION_TIME", `${versionPath}.issuedAt`);
        try {
          validateInvoiceChargeSnapshot(version.snapshot);
        } catch {
          stateInvariant(false, "INVOICE_SHARED_SNAPSHOT", `${versionPath}.snapshot`);
        }
        stateInvariant(
          version.snapshot.sourceBusinessOrderId === invoice.businessOrderId
            && version.snapshot.sourceBusinessOrderRevision >= 1
            && version.snapshot.sourceBusinessOrderRevision <= state.revision,
          "INVOICE_SHARED_SOURCE",
          `${versionPath}.snapshot`,
        );
        stateInvariant(
          /^sha256-utf16le:[a-f0-9]{64}$/u.test(version.snapshotCommitment),
          "INVOICE_SHARED_SNAPSHOT_COMMITMENT",
          `${versionPath}.snapshotCommitment`,
        );
      });
      try {
        validateInvoiceLineageTransition({
          previousSnapshots: invoice.versions.slice(0, -1).map((version) => version.snapshot),
          nextSnapshot: invoice.versions[invoice.versions.length - 1].snapshot,
          refundOccupancies: [],
        });
      } catch {
        stateInvariant(false, "INVOICE_SHARED_LINEAGE", `${path}.versions`);
      }
    } else {
      const owner = businessOrderById.get(invoice.businessOrderId);
      stateInvariant(
        owner !== undefined
          && !quickOrderById.has(invoice.businessOrderId)
          && owner.invoiceIds.filter((invoiceId) => invoiceId === invoice.id).length === 1,
        "INVOICE_LEGACY_FORMAL_OWNER_REVERSE",
        `${path}.businessOrderId`,
      );
      invoice.versions.forEach((version, versionIndex) => {
        const calculated = calculateInvoiceTotals({ lines: version.lines, adjustments: version.adjustments });
        stateInvariant(sameTotals(calculated, version.totals), "INVOICE_TOTALS", `${path}.versions[${versionIndex}].totals`);
        stateInvariant(Boolean(state.invoiceFileHashes[version.id]), "INVOICE_FILE_HASH", `$.invoiceFileHashes.${version.id}`);
      });
    }
  });
  state.payments.forEach((payment, index) => {
    const path = `$.payments[${index}]`;
    const hasContract = Object.prototype.hasOwnProperty.call(payment, "paymentContract");
    if (hasContract) {
      stateInvariant(isModernInvoicePaymentFact(payment), "PAYMENT_CONTRACT", `${path}.paymentContract`);
    } else {
      stateInvariant(
        hasOnlyKeys(payment as unknown as Record<string, unknown>, LEGACY_PAYMENT_FIELDS),
        "PAYMENT_LEGACY_CLOSED",
        path,
      );
    }
    stateInvariant(typeof payment.id === "string" && payment.id.length > 0, "PAYMENT_ID", `${path}.id`);
    stateInvariant(invoiceById.has(payment.invoiceId), "PAYMENT_INVOICE_REF", `${path}.invoiceId`);
    stateInvariant(Number.isSafeInteger(payment.amountJmd) && payment.amountJmd >= 0, "PAYMENT_AMOUNT", `${path}.amountJmd`);
    stateInvariant(isValidIsoTimestamp(payment.receivedAt), "PAYMENT_TIME", `${path}.receivedAt`);
    stateInvariant(payment.method === undefined || (typeof payment.method === "string" && payment.method.length > 0), "PAYMENT_METHOD", `${path}.method`);
    stateInvariant(payment.receivedBy === undefined || (typeof payment.receivedBy === "string" && payment.receivedBy.length > 0), "PAYMENT_ACTOR", `${path}.receivedBy`);
    stateInvariant(payment.note === undefined || (typeof payment.note === "string" && payment.note.length > 0), "PAYMENT_NOTE", `${path}.note`);
  });
  state.refunds.forEach((refund, index) => {
    const path = `$.refunds[${index}]`;
    if (refund.refundContract === "ordinary_line_v1") {
      stateInvariant(
        hasOnlyKeys(refund as unknown as Record<string, unknown>, new Set([
          "id", "refundContract", "logicalInvoiceId", "invoiceVersionId", "chargeLineId", "category",
          "pricingMode", "refundQuantity", "wholeLine", "lineSnapshot", "receivableReductionJmd",
          "cashRefundJmd", "method", "reason", "actorId", "actorName", "refundedAt", "mutationId",
        ])),
        "REFUND_LINE_CLOSED",
        path,
      );
      const invoice = invoiceById.get(refund.logicalInvoiceId);
      const version = invoice && isSharedChargeInvoice(invoice)
        ? invoice.versions.find((candidate) => candidate.id === refund.invoiceVersionId)
        : undefined;
      const line = version?.snapshot.lines.find((candidate) => candidate.chargeLineId === refund.chargeLineId);
      stateInvariant(Boolean(invoice && isSharedChargeInvoice(invoice)), "REFUND_LINE_INVOICE", `${path}.logicalInvoiceId`);
      stateInvariant(Boolean(version), "REFUND_LINE_VERSION", `${path}.invoiceVersionId`);
      stateInvariant(Boolean(line), "REFUND_LINE_CHARGE", `${path}.chargeLineId`);
      stateInvariant(
        line !== undefined
          && stableJson(refund.lineSnapshot) === stableJson(line)
          && refund.category === line.category
          && refund.pricingMode === line.pricingMode,
        "REFUND_LINE_SNAPSHOT",
        `${path}.lineSnapshot`,
      );
      if (refund.pricingMode === "unit") {
        stateInvariant(
          Number.isSafeInteger(refund.refundQuantity) && Number(refund.refundQuantity) > 0 && refund.wholeLine === undefined,
          "REFUND_LINE_QUANTITY",
          `${path}.refundQuantity`,
        );
      } else {
        stateInvariant(refund.wholeLine === true && refund.refundQuantity === undefined, "REFUND_LINE_WHOLE", `${path}.wholeLine`);
      }
      stateInvariant(
        Number.isSafeInteger(refund.receivableReductionJmd) && refund.receivableReductionJmd > 0,
        "REFUND_LINE_RECEIVABLE",
        `${path}.receivableReductionJmd`,
      );
      stateInvariant(
        Number.isSafeInteger(refund.cashRefundJmd)
          && refund.cashRefundJmd >= 0
          && refund.cashRefundJmd <= refund.receivableReductionJmd,
        "REFUND_LINE_CASH",
        `${path}.cashRefundJmd`,
      );
      stateInvariant(typeof refund.method === "string" && refund.method.length > 0, "REFUND_LINE_METHOD", `${path}.method`);
      stateInvariant(typeof refund.reason === "string" && refund.reason.length > 0, "REFUND_LINE_REASON", `${path}.reason`);
      stateInvariant(typeof refund.actorId === "string" && refund.actorId.length > 0, "REFUND_LINE_ACTOR", `${path}.actorId`);
      stateInvariant(typeof refund.actorName === "string" && refund.actorName.length > 0, "REFUND_LINE_ACTOR", `${path}.actorName`);
      stateInvariant(isValidIsoTimestamp(refund.refundedAt) && /-05:00$/.test(refund.refundedAt), "REFUND_LINE_TIME", `${path}.refundedAt`);
      stateInvariant(typeof refund.mutationId === "string" && refund.mutationId.length > 0, "REFUND_LINE_MUTATION", `${path}.mutationId`);
    } else {
      stateInvariant(invoiceById.has(refund.invoiceId), "REFUND_INVOICE_REF", `${path}.invoiceId`);
      stateInvariant(Number.isSafeInteger(refund.amountJmd) && refund.amountJmd >= 0, "REFUND_AMOUNT", `${path}.amountJmd`);
    }
  });
  const verifiedParkingSourceSnapshots = validateCanonicalParkingSourceBindings(state);
  state.parkingCases.forEach((parking, parkingIndex) => {
    const path = `$.parkingCases[${parkingIndex}]`;
    const hasContract = Object.prototype.hasOwnProperty.call(parking, "parkingContract");
    stateInvariant(
      hasOnlyKeys(
        parking as unknown as Record<string, unknown>,
        hasContract ? MODERN_PARKING_SOURCE_FIELDS : LEGACY_PARKING_FIELDS,
      ),
      "PARKING_SOURCE_CLOSED",
      path,
    );
    stateInvariant(vehicleIds.has(parking.vehicleId), "PARKING_VEHICLE_REF", `${path}.vehicleId`);
    stateInvariant(
      /^\d{4}-\d{2}-\d{2}$/.test(parking.notificationDate)
        && (parking.pickupDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(parking.pickupDate)),
      "PARKING_SOURCE_DATE",
      path,
    );
    stateInvariant(
      isPlainRecord(parking.accrual)
        && hasOnlyKeys(parking.accrual as unknown as Record<string, unknown>, PARKING_ACCRUAL_FIELDS)
        && Object.keys(parking.accrual).length === PARKING_ACCRUAL_FIELDS.size
        && Number.isSafeInteger(parking.dailyRateJmd) && parking.dailyRateJmd >= 0
        && Number.isSafeInteger(parking.revision) && parking.revision >= 1
        && Number.isSafeInteger(parking.accrual.chargeableDays) && parking.accrual.chargeableDays >= 0
        && Number.isSafeInteger(parking.accrual.originalAmountJmd) && parking.accrual.originalAmountJmd >= 0
        && Number.isSafeInteger(parking.accrual.chargeableDays * parking.dailyRateJmd)
        && parking.accrual.originalAmountJmd === parking.accrual.chargeableDays * parking.dailyRateJmd,
      "PARKING_SOURCE_AMOUNT",
      path,
    );
    stateInvariant(
      Array.isArray(parking.waiverHistory)
        && Array.isArray(parking.waiverReasons)
        && parking.waiverReasons.every((reason) => typeof reason === "string" && reason.length > 0),
      "PARKING_SOURCE_WAIVERS",
      path,
    );
    if (hasContract) {
      const source = parking as LinkedModernParkingSourceFact;
      const origin = quickOrderById.get(source.originBusinessOrderId);
      stateInvariant(source.parkingContract === "parking_source_v1", "PARKING_SOURCE_CONTRACT", `${path}.parkingContract`);
      stateInvariant(
        typeof source.originBusinessOrderId === "string" && source.originBusinessOrderId.length > 0
          && Array.isArray(source.eligibleBusinessOrderIds)
          && source.eligibleBusinessOrderIds.length > 0
          && uniqueStringValues(source.eligibleBusinessOrderIds)
          && [...source.eligibleBusinessOrderIds].sort((left, right) => left.localeCompare(right)).every((id, index) => (
            id === source.eligibleBusinessOrderIds[index]
          ))
          && source.eligibleBusinessOrderIds.includes(source.originBusinessOrderId)
          && origin?.chargeContract === QUICK_ORDER_SHARED_CHARGE_CONTRACT
          && !businessOrderById.has(source.originBusinessOrderId)
          && origin.vehicleId === source.vehicleId
          && source.eligibleBusinessOrderIds.every((orderId) => {
            const eligible = quickOrderById.get(orderId);
            return eligible?.chargeContract === QUICK_ORDER_SHARED_CHARGE_CONTRACT
              && eligible.vehicleId === source.vehicleId
              && eligible.customerId === origin.customerId;
          }),
        "PARKING_SOURCE_ELIGIBLE_COHORT",
        `${path}.eligibleBusinessOrderIds`,
      );
      stateInvariant(isJamaicaInstant(source.asOf), "PARKING_SOURCE_AS_OF", `${path}.asOf`);
      let expectedAccrual: ReturnType<typeof calculateParkingAccrual> | undefined;
      try {
        const asOfDate = source.asOf.slice(0, 10);
        const accrualEndDate = source.pickupDate ?? asOfDate;
        const asOfAt = parseParkingCalendarDate(asOfDate, "parking source as-of date");
        const accrualEndAt = parseParkingCalendarDate(accrualEndDate, "parking source accrual end date");
        if (asOfAt < accrualEndAt) throw new RangeError("parking source as-of precedes accrual end");
        expectedAccrual = calculateParkingAccrual({
          notificationDate: source.notificationDate,
          pickupDate: accrualEndDate,
          dailyRateJmd: source.dailyRateJmd,
        });
      } catch {
        stateInvariant(false, "PARKING_SOURCE_CALENDAR", path);
      }
      stateInvariant(
        source.dailyRateJmd > 0 && stableJson(source.accrual) === stableJson(expectedAccrual),
        "PARKING_SOURCE_ACCRUAL",
        `${path}.accrual`,
      );
      stateInvariant(
        source.revision >= source.waiverHistory.length + 1
          && source.waiverReasons.length === source.waiverHistory.length,
        "PARKING_SOURCE_WAIVER_REVISION",
        path,
      );
      let existingWaivedDays = 0;
      let existingWaivedAmountJmd = 0;
      let previousDecisionSourceRevision = 0;
      source.waiverHistory.forEach((candidate, waiverIndex) => {
        const waiverPath = `${path}.waiverHistory[${waiverIndex}]`;
        stateInvariant(
          isPlainRecord(candidate)
            && hasOnlyKeys(candidate as unknown as Record<string, unknown>, MODERN_PARKING_WAIVER_DECISION_FIELDS)
            && Object.keys(candidate).length === MODERN_PARKING_WAIVER_DECISION_FIELDS.size
            && candidate.waiverContract === "parking_waiver_decision_v1"
            && Number.isSafeInteger(candidate.sourceRevision) && candidate.sourceRevision >= 1
            && candidate.sourceRevision > previousDecisionSourceRevision
            && candidate.sourceRevision < source.revision
            && isJamaicaInstant(candidate.sourceAsOf),
          "PARKING_SOURCE_WAIVER_CLOSED",
          waiverPath,
        );
        const basis = verifiedParkingSourceSnapshots.get(source.id)?.get(candidate.sourceRevision);
        stateInvariant(
          basis !== undefined && basis.asOf === candidate.sourceAsOf,
          "PARKING_SOURCE_WAIVER_BASIS",
          waiverPath,
        );
        let expected: ParkingWaiverPreview | undefined;
        try {
          expected = validateParkingWaiver({
            caseId: source.id,
            originalChargeableDays: basis.accrual.chargeableDays,
            dailyRateJmd: source.dailyRateJmd,
            existingWaivedDays,
            existingWaivedAmountJmd,
            proposedWaivedDays: candidate.proposedWaivedDays,
            proposedWaivedAmountJmd: candidate.proposedWaivedAmountJmd,
          });
        } catch {
          stateInvariant(false, "PARKING_SOURCE_WAIVER_AMOUNT", waiverPath);
        }
        stateInvariant(
          stableJson({
            ...expected,
            waiverContract: "parking_waiver_decision_v1",
            sourceRevision: basis.revision,
            sourceAsOf: basis.asOf,
          }) === stableJson(candidate),
          "PARKING_SOURCE_WAIVER_BINDING",
          waiverPath,
        );
        existingWaivedDays = candidate.cumulativeWaivedDays;
        existingWaivedAmountJmd = candidate.cumulativeWaivedAmountJmd;
        previousDecisionSourceRevision = candidate.sourceRevision;
      });
      try {
        deriveParkingFinalAccrual({
          currentAccrual: source.accrual,
          dailyRateJmd: source.dailyRateJmd,
          latestWaiverDecision: source.waiverHistory[source.waiverHistory.length - 1],
        });
      } catch {
        stateInvariant(false, "PARKING_SOURCE_CURRENT_FINAL", path);
      }
    } else {
      const legacy = parking as LinkedLegacyParkingCaseFact;
      stateInvariant(typeof legacy.businessOrderId === "string" && legacy.businessOrderId.length > 0, "PARKING_BO_REF", `${path}.businessOrderId`);
      const invoice = invoiceById.get(legacy.invoiceId);
      const businessOrder = businessOrderById.get(legacy.businessOrderId);
      const orderRecord = orderRecordById.get(legacy.businessOrderId);
      stateInvariant(
        businessOrder !== undefined && !quickOrderById.has(legacy.businessOrderId),
        "PARKING_LEGACY_FORMAL_OWNER",
        `${path}.businessOrderId`,
      );
      stateInvariant(
        invoice !== undefined
          && !isSharedChargeInvoice(invoice)
          && invoice.businessOrderId === legacy.businessOrderId
          && businessOrder?.invoiceIds.includes(invoice.id),
        "PARKING_LEGACY_INVOICE_REF",
        `${path}.invoiceId`,
      );
      stateInvariant(
        businessOrder?.vehicleId === legacy.vehicleId && orderRecord?.vehicle.id === legacy.vehicleId,
        "PARKING_VEHICLE_ORDER_MATCH",
        `${path}.vehicleId`,
      );
      const version = invoice?.versions.find((candidate) => candidate.id === legacy.invoiceVersionId);
      stateInvariant(Boolean(version), "PARKING_LEGACY_INVOICE_VERSION_REF", `${path}.invoiceVersionId`);
    }
  });
  state.legacyParkingOrigins.forEach((origin, originIndex) => {
    const path = `$.legacyParkingOrigins[${originIndex}]`;
    stateInvariant(
      hasOnlyKeys(origin as unknown as Record<string, unknown>, LEGACY_PARKING_ORIGIN_FIELDS)
        && Object.keys(origin).length === LEGACY_PARKING_ORIGIN_FIELDS.size
        && origin.id === origin.parking.id
        && !Object.prototype.hasOwnProperty.call(origin.parking, "parkingContract")
        && hasOnlyKeys(origin.parking as unknown as Record<string, unknown>, LEGACY_PARKING_FIELDS),
      "LEGACY_PARKING_ORIGIN_CLOSED",
      path,
    );
    const current = state.parkingCases.find((parking) => parking.id === origin.id);
    const currentOwnerInvoice = state.invoices.find((invoice) => invoice.id === origin.parking.invoiceId);
    stateInvariant(
      current !== undefined
        && !isModernParkingSourceFact(current)
        && stableJson(legacyParkingImmutableCoordinates(current))
          === stableJson(legacyParkingImmutableCoordinates(origin.parking)),
      "LEGACY_PARKING_ORIGIN_COORDINATES",
      path,
    );
    stateInvariant(
      origin.ownerInvoice.id === origin.parking.invoiceId
        && !isSharedChargeInvoice(origin.ownerInvoice)
        && currentOwnerInvoice !== undefined
        && !isSharedChargeInvoice(currentOwnerInvoice)
        && stableJson(currentOwnerInvoice) === stableJson(origin.ownerInvoice),
      "LEGACY_PARKING_OWNER_INVOICE_FROZEN",
      `${path}.ownerInvoice`,
    );
    if (!current || isModernParkingSourceFact(current)) return;
    stateInvariant(stableJson(current) === stableJson(origin.parking), "LEGACY_PARKING_FROZEN", path);
    const currentAudits = state.parkingWaiverAudits.filter((audit) => audit.caseId === origin.id);
    stateInvariant(
      stableJson(currentAudits) === stableJson(origin.waiverAudits),
      "LEGACY_PARKING_AUDITS_FROZEN",
      path,
    );
  });
  state.parkingCases.filter((parking): parking is LinkedLegacyParkingCaseFact => (
    !Object.prototype.hasOwnProperty.call(parking, "parkingContract")
  )).forEach((parking, index) => {
    stateInvariant(
      state.legacyParkingOrigins.filter((origin) => origin.id === parking.id).length === 1,
      "LEGACY_PARKING_ORIGIN_REVERSE",
      `$.parkingCases[${index}]`,
    );
  });
  state.parkingWaiverPreviews.forEach((preview, index) => {
    stateInvariant(state.parkingCases.some((parking) => parking.id === preview.caseId), "PARKING_PREVIEW_CASE_REF", `$.parkingWaiverPreviews[${index}].caseId`);
    stateInvariant(Number.isSafeInteger(preview.sourceRevision) && preview.sourceRevision >= 1, "PARKING_PREVIEW_REVISION", `$.parkingWaiverPreviews[${index}].sourceRevision`);
    stateInvariant(Number.isSafeInteger(preview.waiveDays) && preview.waiveDays > 0, "PARKING_PREVIEW_DAYS", `$.parkingWaiverPreviews[${index}].waiveDays`);
    stateInvariant(typeof preview.reason === "string" && preview.reason.length > 0, "PARKING_PREVIEW_REASON", `$.parkingWaiverPreviews[${index}].reason`);
    stateInvariant(Number.isFinite(Date.parse(preview.issuedAt)) && Number.isFinite(Date.parse(preview.expiresAt)), "PARKING_PREVIEW_TIME", `$.parkingWaiverPreviews[${index}]`);
  });
  state.communications.forEach((event, index) => {
    stateInvariant(reportIds.has(event.reportId), "COMMUNICATION_IR_REF", `$.communications[${index}].reportId`);
  });
  stateInvariant(Array.isArray(state.legacyIrHistory.inspectionReports), "LEGACY_IR_REPORTS", "$.legacyIrHistory.inspectionReports");
  stateInvariant(Array.isArray(state.legacyIrHistory.inspectionItems), "LEGACY_IR_ITEMS", "$.legacyIrHistory.inspectionItems");
  stateInvariant(Array.isArray(state.legacyIrHistory.quotations), "LEGACY_IR_QUOTATIONS", "$.legacyIrHistory.quotations");
  stateInvariant(Array.isArray(state.legacyIrHistory.quotationItems), "LEGACY_IR_QUOTATION_ITEMS", "$.legacyIrHistory.quotationItems");
  stateInvariant(
    Number.isSafeInteger(state.legacyIrHistory.sourceSchemaVersion) && state.legacyIrHistory.sourceSchemaVersion >= 1,
    "LEGACY_IR_SOURCE_SCHEMA",
    "$.legacyIrHistory.sourceSchemaVersion",
  );
  [...state.legacyIrHistory.inspectionReports, ...state.legacyIrHistory.inspectionItems].forEach((record, index) => {
    stateInvariant(isPlainRecord(record) && !("photos" in record), "LEGACY_IR_PHOTO_BYTES_FORBIDDEN", `$.legacyIrHistory.photoRecord[${index}]`);
  });
  state.generationEvents.forEach((event, index) => {
    stateInvariant(reportIds.has(event.reportId), "GENERATION_REPORT_REF", `$.generationEvents[${index}].reportId`);
    stateInvariant(currentQuotationById.has(event.quotationId), "GENERATION_QUOTATION_REF", `$.generationEvents[${index}].quotationId`);
    stateInvariant(Number.isSafeInteger(event.generation) && event.generation >= 1, "GENERATION_NUMBER", `$.generationEvents[${index}].generation`);
    stateInvariant(Number.isSafeInteger(event.contentRevision) && event.contentRevision >= 1, "GENERATION_CONTENT_REVISION", `$.generationEvents[${index}].contentRevision`);
    stateInvariant(typeof event.actorId === "string" && event.actorId.trim().length > 0, "GENERATION_ACTOR", `$.generationEvents[${index}].actorId`);
    stateInvariant(isValidIsoTimestamp(event.generatedAt), "GENERATION_TIME", `$.generationEvents[${index}].generatedAt`);
    stateInvariant(typeof event.rendererVersion === "string" && event.rendererVersion.length > 0, "GENERATION_RENDERER", `$.generationEvents[${index}].rendererVersion`);
    stateInvariant(Array.isArray(event.attachmentIds), "GENERATION_ATTACHMENTS", `$.generationEvents[${index}].attachmentIds`);
    const legacyUnavailable = event.rendererVersion === "legacy-unavailable";
    stateInvariant(
      legacyUnavailable
        ? event.attachmentIds.length === 0
        : event.attachmentIds.length === 3
          && new Set(event.attachmentIds).size === 3
          && event.attachmentIds.every((id) => typeof id === "string" && id.length > 0),
      "GENERATION_ATTACHMENTS",
      `$.generationEvents[${index}].attachmentIds`,
    );
    if (!legacyUnavailable) {
      const quotation = currentQuotationById.get(event.quotationId);
      stateInvariant(quotation?.inspectionReportId === event.reportId, "GENERATION_REPORT_QUOTATION", `$.generationEvents[${index}]`);
      stateInvariant(event.generation <= quotation.generationCounter, "GENERATION_COUNTER", `$.generationEvents[${index}].generation`);
    }
  });
  state.currentQuotations.forEach((quotation, quotationIndex) => {
    const currentEvents = state.generationEvents.filter((event) => (
      event.quotationId === quotation.id && event.rendererVersion !== "legacy-unavailable"
    ));
    stateInvariant(
      new Set(currentEvents.map((event) => event.generation)).size === currentEvents.length,
      "GENERATION_NUMBER_DUPLICATE",
      `$.currentQuotations[${quotationIndex}]`,
    );
    if (quotation.activeGeneratedBundle === null) {
      stateInvariant(currentEvents.length === 0, "GENERATION_ACTIVE_BUNDLE_REQUIRED", `$.currentQuotations[${quotationIndex}]`);
      return;
    }
    stateInvariant(currentEvents.length > 0, "GENERATION_LATEST_REQUIRED", `$.currentQuotations[${quotationIndex}]`);
    const latest = currentEvents.reduce((candidate, event) => (
      event.generation > candidate.generation ? event : candidate
    ));
    const bundle = quotation.activeGeneratedBundle;
    stateInvariant(
      latest.reportId === bundle.reportId
        && latest.quotationId === bundle.quotationId
        && latest.generation === bundle.generation
        && latest.contentRevision === bundle.contentRevision
        && latest.generatedAt === bundle.generatedAt
        && latest.rendererVersion === bundle.rendererVersion
        && stableJson(latest.attachmentIds) === stableJson(bundle.attachments.map((attachment) => attachment.id)),
      "GENERATION_LATEST_BUNDLE_MISMATCH",
      `$.currentQuotations[${quotationIndex}].activeGeneratedBundle`,
    );
  });
  for (const [events, label] of [[state.communicationEvents, "communicationEvents"], [state.responseEvents, "responseEvents"]] as const) {
    events.forEach((event, index) => {
      const path = `$.${label}[${index}]`;
      const importedFollowup = isImportedCommunicationEvent(event);
      stateInvariant(
        reportIds.has(event.reportId)
          ? !("legacyOrphanReport" in event) || event.legacyOrphanReport !== true
          : importedFollowup && event.legacyOrphanReport === true,
        "CURRENT_COMMUNICATION_REPORT_REF",
        `${path}.reportId`,
      );
      if (importedFollowup) {
        stateInvariant(isValidIsoTimestamp(event.recordedAt), "CURRENT_COMMUNICATION_TIME", `${path}.recordedAt`);
        stateInvariant(isPlainRecord(event.payload), "CURRENT_COMMUNICATION_PAYLOAD", `${path}.payload`);
        stateInvariant(event.payload.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY, "LEGACY_FOLLOWUP_EVENT_SOURCE", `${path}.payload.sourceKey`);
        stateInvariant(
          event.legacyOriginalId === undefined || (typeof event.legacyOriginalId === "string" && event.legacyOriginalId.length > 0),
          "LEGACY_FOLLOWUP_ORIGINAL_ID",
          `${path}.legacyOriginalId`,
        );
        const originalActorName = event.payload.originalActorName;
        stateInvariant(
          originalActorName === null
            ? event.actorId === undefined && event.legacyActorName === undefined
            : typeof originalActorName === "string"
              && originalActorName.length > 0
              && event.actorId === undefined
              && event.legacyActorName === originalActorName,
          "LEGACY_FOLLOWUP_ACTOR",
          path,
        );
      } else {
        const current = event as unknown as Record<string, unknown>;
        const isResponse = label === "responseEvents";
        const allowedKeys = isResponse
          ? new Set(["id", "reportId", "eventKind", "result", "note", "actorId", "actorName", "recordedAt", "mutationId", "supersedesEventId"])
          : new Set(["id", "reportId", "eventKind", "channel", "language", "target", "message", "subject", "providerMode", "providerResult", "providerReference", "actorId", "actorName", "recordedAt", "mutationId", "fileName", "demoReportUrl"]);
        stateInvariant(hasOnlyKeys(current, allowedKeys), "CURRENT_COMMUNICATION_CLOSED", path);
        stateInvariant(isJamaicaInstant(event.recordedAt), "CURRENT_COMMUNICATION_TIME", `${path}.recordedAt`);
        stateInvariant(typeof current.id === "string" && current.id.length > 0, "CURRENT_COMMUNICATION_ID", `${path}.id`);
        stateInvariant(typeof current.actorId === "string" && current.actorId.trim().length > 0, "CURRENT_COMMUNICATION_ACTOR", `${path}.actorId`);
        stateInvariant(typeof current.actorName === "string" && current.actorName.trim().length > 0, "CURRENT_COMMUNICATION_ACTOR", `${path}.actorName`);
        stateInvariant(typeof current.mutationId === "string" && current.mutationId.trim().length > 0, "CURRENT_COMMUNICATION_MUTATION", `${path}.mutationId`);
        if (isResponse) {
          stateInvariant(current.eventKind === "customer_response", "CUSTOMER_RESPONSE_KIND", `${path}.eventKind`);
          stateInvariant(current.result === "interested" || current.result === "not_interested", "CUSTOMER_RESPONSE_RESULT", `${path}.result`);
          stateInvariant(typeof current.note === "string", "CUSTOMER_RESPONSE_NOTE", `${path}.note`);
          stateInvariant(current.supersedesEventId === undefined || (typeof current.supersedesEventId === "string" && current.supersedesEventId.length > 0), "CUSTOMER_RESPONSE_SUPERSEDES", `${path}.supersedesEventId`);
        } else {
          stateInvariant(current.eventKind === "formal_report_notification", "CURRENT_COMMUNICATION_KIND", `${path}.eventKind`);
          stateInvariant(current.channel === "sms" || current.channel === "whatsapp" || current.channel === "email", "CURRENT_COMMUNICATION_CHANNEL", `${path}.channel`);
          stateInvariant(current.language === "zh" || current.language === "en" || current.language === "bilingual", "CURRENT_COMMUNICATION_LANGUAGE", `${path}.language`);
          stateInvariant(typeof current.target === "string" && current.target.trim().length > 0, "CURRENT_COMMUNICATION_TARGET", `${path}.target`);
          stateInvariant(typeof current.message === "string" && current.message.trim().length > 0, "CURRENT_COMMUNICATION_MESSAGE", `${path}.message`);
          stateInvariant(typeof current.providerReference === "string" && current.providerReference.trim().length > 0, "CURRENT_COMMUNICATION_PROVIDER_REFERENCE", `${path}.providerReference`);
          if (current.channel === "email") {
            stateInvariant(current.providerMode === "mock_email" && current.providerResult === "accepted", "CURRENT_COMMUNICATION_PROVIDER", path);
            stateInvariant(typeof current.subject === "string" && current.subject.trim().length > 0, "CURRENT_COMMUNICATION_SUBJECT", `${path}.subject`);
            stateInvariant(typeof current.fileName === "string" && current.fileName.trim().length > 0, "CURRENT_COMMUNICATION_FILE_NAME", `${path}.fileName`);
            stateInvariant(current.demoReportUrl === undefined, "CURRENT_COMMUNICATION_URL", `${path}.demoReportUrl`);
          } else {
            stateInvariant(current.subject === undefined && current.fileName === undefined, "CURRENT_COMMUNICATION_EMAIL_FIELDS", path);
            stateInvariant(typeof current.demoReportUrl === "string" && /^https:\/\//.test(current.demoReportUrl) && !/(?:localhost|127\.0\.0\.1)/i.test(current.demoReportUrl), "CURRENT_COMMUNICATION_URL", `${path}.demoReportUrl`);
            stateInvariant(
              current.channel === "sms"
                ? current.providerMode === "mock_sms" && current.providerResult === "accepted"
                : current.providerMode === "manual_whatsapp" && current.providerResult === "confirmed_sent",
              "CURRENT_COMMUNICATION_PROVIDER",
              path,
            );
          }
        }
      }
    });
  }
  state.responseEvents.forEach((event, index) => {
    stateInvariant(
      event.result === "interested" || event.result === "not_interested" || event.result === "legacy_unclassified",
      "CUSTOMER_RESPONSE_RESULT",
      `$.responseEvents[${index}].result`,
    );
  });
  const allCurrentEventIds = new Set([
    ...state.communicationEvents.map((event) => event.id),
    ...state.responseEvents.map((event) => event.id),
  ]);
  [...state.communicationEvents, ...state.responseEvents].forEach((event, index) => {
    if ("possibleDuplicateOf" in event && event.possibleDuplicateOf !== undefined) {
      stateInvariant(
        typeof event.possibleDuplicateOf === "string"
          && event.possibleDuplicateOf !== event.id
          && allCurrentEventIds.has(event.possibleDuplicateOf),
        "CURRENT_COMMUNICATION_DUPLICATE_REF",
        `$.currentEvents[${index}].possibleDuplicateOf`,
      );
    }
  });
  if (state.legacyFollowupMigration !== undefined) {
    const receipt = state.legacyFollowupMigration;
    stateInvariant(receipt.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY, "LEGACY_FOLLOWUP_RECEIPT_SOURCE", "$.legacyFollowupMigration.sourceKey");
    stateInvariant(typeof receipt.sourceHash === "string" && receipt.sourceHash.length > 0, "LEGACY_FOLLOWUP_RECEIPT_HASH", "$.legacyFollowupMigration.sourceHash");
    stateInvariant(typeof receipt.present === "boolean", "LEGACY_FOLLOWUP_RECEIPT_PRESENT", "$.legacyFollowupMigration.present");
    stateInvariant(
      receipt.present
        ? receipt.sourceRevision === null
          || (Number.isSafeInteger(receipt.sourceRevision) && receipt.sourceRevision >= 1)
        : receipt.sourceRevision === null,
      "LEGACY_FOLLOWUP_RECEIPT_REVISION",
      "$.legacyFollowupMigration.sourceRevision",
    );
    const importedCommunications = state.communicationEvents.filter((event) => event.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY);
    const importedResponses = state.responseEvents.filter((event) => event.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY);
    const importedEvents = [...importedCommunications, ...importedResponses];
    stateInvariant(receipt.communicationEventCount === importedCommunications.length, "LEGACY_FOLLOWUP_RECEIPT_COUNT", "$.legacyFollowupMigration.communicationEventCount");
    stateInvariant(receipt.responseEventCount === importedResponses.length, "LEGACY_FOLLOWUP_RECEIPT_COUNT", "$.legacyFollowupMigration.responseEventCount");
    stateInvariant(
      receipt.orphanEventCount === importedEvents.filter((event) => event.legacyOrphanReport === true).length,
      "LEGACY_FOLLOWUP_RECEIPT_COUNT",
      "$.legacyFollowupMigration.orphanEventCount",
    );
    stateInvariant(Array.isArray(receipt.eventIds), "LEGACY_FOLLOWUP_RECEIPT_EVENTS", "$.legacyFollowupMigration.eventIds");
    stateInvariant(
      stableJson(receipt.eventIds) === stableJson(importedEvents.map((event) => event.id)),
      "LEGACY_FOLLOWUP_RECEIPT_EVENTS",
      "$.legacyFollowupMigration.eventIds",
    );
    stateInvariant(Array.isArray(receipt.unresolvedFacts), "LEGACY_FOLLOWUP_RECEIPT_UNRESOLVED", "$.legacyFollowupMigration.unresolvedFacts");
    stateInvariant(receipt.unresolvedFactCount === receipt.unresolvedFacts.length, "LEGACY_FOLLOWUP_RECEIPT_COUNT", "$.legacyFollowupMigration.unresolvedFactCount");
    stateInvariant(uniqueIds(receipt.unresolvedFacts), "LEGACY_FOLLOWUP_RECEIPT_UNRESOLVED", "$.legacyFollowupMigration.unresolvedFacts");
    receipt.unresolvedFacts.forEach((fact, index) => {
      stateInvariant(typeof fact.sourcePath === "string" && fact.sourcePath.startsWith("$"), "LEGACY_FOLLOWUP_UNRESOLVED_PATH", `$.legacyFollowupMigration.unresolvedFacts[${index}].sourcePath`);
      stateInvariant(typeof fact.reason === "string" && fact.reason.length > 0, "LEGACY_FOLLOWUP_UNRESOLVED_REASON", `$.legacyFollowupMigration.unresolvedFacts[${index}].reason`);
      try {
        stableJson(fact.raw);
      } catch {
        stateInvariant(false, "LEGACY_FOLLOWUP_UNRESOLVED_RAW", `$.legacyFollowupMigration.unresolvedFacts[${index}].raw`);
      }
    });
    if (!receipt.present) {
      stateInvariant(importedEvents.length === 0 && receipt.unresolvedFacts.length === 0, "LEGACY_FOLLOWUP_ABSENT_FACTS", "$.legacyFollowupMigration");
    } else if (receipt.sourceRevision === null) {
      stateInvariant(importedEvents.length === 0 && receipt.unresolvedFacts.length > 0, "LEGACY_FOLLOWUP_UNREADABLE_FACT", "$.legacyFollowupMigration");
    }
  } else {
    stateInvariant(
      !state.communicationEvents.some((event) => event.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY)
        && !state.responseEvents.some((event) => event.sourceKey === LINKED_OPERATIONS_LEGACY_FOLLOWUP_KEY),
      "LEGACY_FOLLOWUP_RECEIPT_MISSING",
      "$.legacyFollowupMigration",
    );
  }
  const signatureMutationIds = new Set<string>();
  const signatureStrokeDigests = new Set<string>();
  state.discountSignatureEvents.forEach((event, index) => {
    try {
      // The shared Task 1 closed schema is the only signature validator.
      validateDiscountApprovalEvidence(event);
    } catch {
      stateInvariant(false, "DISCOUNT_SIGNATURE_SCHEMA", `$.discountSignatureEvents[${index}]`);
    }
    stateInvariant(!signatureMutationIds.has(event.mutationId), "DISCOUNT_SIGNATURE_MUTATION_ID", `$.discountSignatureEvents[${index}].mutationId`);
    signatureMutationIds.add(event.mutationId);
    const strokeDigest = discountSignatureStrokeDigest(event.rawStrokes);
    stateInvariant(!signatureStrokeDigests.has(strokeDigest), "DISCOUNT_SIGNATURE_STROKE_REUSE", `$.discountSignatureEvents[${index}].rawStrokes`);
    signatureStrokeDigests.add(strokeDigest);
  });
  state.mutationReceipts.forEach((receipt, index) => {
    const path = `$.mutationReceipts[${index}]`;
    stateInvariant(receipt.id === receipt.mutationId && receipt.mutationId.length > 0, "MUTATION_RECEIPT_ID", `${path}.mutationId`);
    stateInvariant(typeof receipt.operation === "string" && receipt.operation.length > 0, "MUTATION_RECEIPT_OPERATION", `${path}.operation`);
    stateInvariant(typeof receipt.actorId === "string" && receipt.actorId.length > 0, "MUTATION_RECEIPT_ACTOR", `${path}.actorId`);
    stateInvariant(typeof receipt.payloadHash === "string" && receipt.payloadHash.length > 0, "MUTATION_RECEIPT_HASH", `${path}.payloadHash`);
    if (receipt.payloadCanonical !== undefined) {
      stateInvariant(
        typeof receipt.payloadCanonical === "string" && receipt.payloadCanonical.length > 0,
        "MUTATION_RECEIPT_CANONICAL",
        `${path}.payloadCanonical`,
      );
      try {
        stateInvariant(
          canonicalMutationPayload(JSON.parse(receipt.payloadCanonical)) === receipt.payloadCanonical,
          "MUTATION_RECEIPT_CANONICAL",
          `${path}.payloadCanonical`,
        );
      } catch {
        stateInvariant(false, "MUTATION_RECEIPT_CANONICAL", `${path}.payloadCanonical`);
      }
    }
    stateInvariant(Number.isSafeInteger(receipt.committedRevision) && receipt.committedRevision >= 1, "MUTATION_RECEIPT_REVISION", `${path}.committedRevision`);
    stateInvariant(receipt.committedRevision <= state.revision, "MUTATION_RECEIPT_FUTURE_REVISION", `${path}.committedRevision`);
    stateInvariant(isValidIsoTimestamp(receipt.committedAt), "MUTATION_RECEIPT_TIME", `${path}.committedAt`);
    try {
      stableJson(receipt.result);
    } catch {
      stateInvariant(false, "MUTATION_RECEIPT_RESULT", `${path}.result`);
    }
    if (receipt.operation === "inspection.notification.send" || receipt.operation === "inspection.response.record") {
      let payloadValue: unknown;
      try {
        payloadValue = JSON.parse(receipt.payloadCanonical ?? "null");
      } catch {
        stateInvariant(false, "IR_COMMUNICATION_RECEIPT_PAYLOAD", `${path}.payloadCanonical`);
      }
      stateInvariant(isPlainRecord(payloadValue), "IR_COMMUNICATION_RECEIPT_PAYLOAD", `${path}.payloadCanonical`);
      const payload = payloadValue;
      const commonKeys = ["reportId", "expectedRevision", "mutationId"];
      const payloadKeys = receipt.operation === "inspection.notification.send"
        ? new Set([...commonKeys, "channel", "language", "message", ...(payload.channel === "email" ? ["subject"] : payload.channel === "whatsapp" ? ["confirmedSent"] : [])])
        : new Set([...commonKeys, "result", "note"]);
      stateInvariant(
        Object.keys(payload).length === payloadKeys.size && hasOnlyKeys(payload, payloadKeys),
        "IR_COMMUNICATION_RECEIPT_PAYLOAD_CLOSED",
        `${path}.payloadCanonical`,
      );
      stateInvariant(payload.mutationId === receipt.mutationId, "IR_COMMUNICATION_RECEIPT_MUTATION", `${path}.payloadCanonical.mutationId`);
      stateInvariant(
        Number.isSafeInteger(payload.expectedRevision)
          && (payload.expectedRevision as number) + 1 === receipt.committedRevision,
        "IR_COMMUNICATION_RECEIPT_REVISION",
        `${path}.payloadCanonical.expectedRevision`,
      );
      stateInvariant(receipt.payloadHash === stableSourceHash(receipt.payloadCanonical!), "IR_COMMUNICATION_RECEIPT_HASH", `${path}.payloadHash`);
      stateInvariant(
        isPlainRecord(receipt.result)
          && Object.keys(receipt.result).length === 2
          && hasOnlyKeys(receipt.result, new Set(["revision", "event"]))
          && receipt.result.revision === receipt.committedRevision
          && isPlainRecord(receipt.result.event),
        "IR_COMMUNICATION_RECEIPT_RESULT",
        `${path}.result`,
      );
      const resultEvent = receipt.result.event as Record<string, unknown>;
      const event = receipt.operation === "inspection.notification.send"
        ? state.communicationEvents.find((candidate) => candidate.eventKind === "formal_report_notification" && candidate.mutationId === receipt.mutationId)
        : state.responseEvents.find((candidate) => candidate.eventKind === "customer_response" && candidate.mutationId === receipt.mutationId);
      stateInvariant(Boolean(event), "IR_COMMUNICATION_RECEIPT_EVENT", `${path}.result.event`);
      stateInvariant(stableJson(resultEvent) === stableJson(event), "IR_COMMUNICATION_RECEIPT_EVENT", `${path}.result.event`);
      stateInvariant(
        event!.reportId === payload.reportId
          && event!.actorId === receipt.actorId
          && event!.recordedAt === receipt.committedAt
          && event!.mutationId === receipt.mutationId,
        "IR_COMMUNICATION_RECEIPT_EVENT_OWNER",
        `${path}.result.event`,
      );
      if (receipt.operation === "inspection.notification.send") {
        const notification = event as LinkedFormalReportNotificationEvent;
        stateInvariant(
          notification.channel === payload.channel
            && notification.language === payload.language
            && notification.message === payload.message
            && (payload.channel !== "whatsapp" || payload.confirmedSent === true)
            && (payload.channel === "email" ? notification.subject === payload.subject : notification.subject === undefined),
          "IR_NOTIFICATION_RECEIPT_FACTS",
          `${path}.result.event`,
        );
      } else {
        const response = event as LinkedClassifiedCustomerResponseEvent;
        stateInvariant(response.result === payload.result && response.note === payload.note, "IR_RESPONSE_RECEIPT_FACTS", `${path}.result.event`);
      }
    }
    if (receipt.operation === "inspection.photos.update") {
      let photoPayloadValue: unknown;
      try {
        photoPayloadValue = JSON.parse(receipt.payloadCanonical ?? "null");
      } catch {
        stateInvariant(false, "PHOTO_MUTATION_PAYLOAD_CANONICAL", `${path}.payloadCanonical`);
      }
      stateInvariant(
        isPlainRecord(photoPayloadValue)
          && Object.keys(photoPayloadValue).length === 5
          && hasOnlyKeys(photoPayloadValue, new Set([
            "reportId", "expectedRevision", "mutationId", "deleteIds", "files",
          ])),
        "PHOTO_MUTATION_PAYLOAD_CLOSED",
        `${path}.payloadCanonical`,
      );
      const photoPayload = photoPayloadValue;
      stateInvariant(
        typeof photoPayload.reportId === "string" && photoPayload.reportId.length > 0,
        "PHOTO_MUTATION_PAYLOAD_REPORT",
        `${path}.payloadCanonical.reportId`,
      );
      stateInvariant(
        Number.isSafeInteger(photoPayload.expectedRevision)
          && (photoPayload.expectedRevision as number) >= 1
          && (photoPayload.expectedRevision as number) + 1 === receipt.committedRevision,
        "PHOTO_MUTATION_PAYLOAD_REVISION",
        `${path}.payloadCanonical.expectedRevision`,
      );
      stateInvariant(
        photoPayload.mutationId === receipt.mutationId,
        "PHOTO_MUTATION_PAYLOAD_MUTATION",
        `${path}.payloadCanonical.mutationId`,
      );
      stateInvariant(
        Array.isArray(photoPayload.deleteIds)
          && photoPayload.deleteIds.every((id) => typeof id === "string" && id.length > 0 && id === id.trim())
          && new Set(photoPayload.deleteIds).size === photoPayload.deleteIds.length,
        "PHOTO_MUTATION_PAYLOAD_DELETES",
        `${path}.payloadCanonical.deleteIds`,
      );
      const photoFileKeys = new Set([
        "originalName", "detectedMediaType", "widthPx", "heightPx", "byteLength", "sha256",
      ]);
      stateInvariant(
        Array.isArray(photoPayload.files)
          && photoPayload.files.every((file) => (
            isPlainRecord(file)
            && Object.keys(file).length === photoFileKeys.size
            && hasOnlyKeys(file, photoFileKeys)
            && typeof file.originalName === "string"
            && file.originalName.trim().length > 0
            && ["image/jpeg", "image/png", "image/webp"].includes(String(file.detectedMediaType))
            && Number.isSafeInteger(file.widthPx) && (file.widthPx as number) > 0
            && Number.isSafeInteger(file.heightPx) && (file.heightPx as number) > 0
            && Number.isSafeInteger(file.byteLength) && (file.byteLength as number) > 0
            && typeof file.sha256 === "string"
            && /^sha256-bytes-v1:[a-f0-9]{64}$/.test(file.sha256)
          )),
        "PHOTO_MUTATION_PAYLOAD_FILES",
        `${path}.payloadCanonical.files`,
      );
      stateInvariant(
        receipt.payloadHash === stableSourceHash(receipt.payloadCanonical!),
        "PHOTO_MUTATION_PAYLOAD_HASH",
        `${path}.payloadHash`,
      );
      stateInvariant(isPlainRecord(receipt.result) && hasOnlyKeys(receipt.result, new Set([
        "revision", "photos", "auditEventIds",
      ])), "PHOTO_MUTATION_RESULT_CLOSED", `${path}.result`);
      stateInvariant(receipt.result.revision === receipt.committedRevision, "PHOTO_MUTATION_RESULT_REVISION", `${path}.result.revision`);
      stateInvariant(Array.isArray(receipt.result.photos), "PHOTO_MUTATION_RESULT_PHOTOS", `${path}.result.photos`);
      const photoSnapshotKeys = new Set([
        "id", "reportId", "vehicleId", "lifecycle", "storageKind", "originalName", "detectedMediaType",
        "widthPx", "heightPx", "byteLength", "sha256", "createdAt", "uploaderActorId", "uploaderActorName",
        "repairNeeded",
      ]);
      const payloadReportId = photoPayload.reportId;
      const snapshotIds = new Set<string>();
      stateInvariant((receipt.result.photos as unknown[]).every((photo, photoIndex) => {
        const photoPath = `${path}.result.photos[${photoIndex}]`;
        if (!isPlainRecord(photo) || !hasOnlyKeys(photo, photoSnapshotKeys)) return false;
        if (
          typeof photo.id !== "string" || !photo.id
          || typeof photo.reportId !== "string" || photo.reportId !== payloadReportId
          || typeof photo.vehicleId !== "string" || !photo.vehicleId
          || photo.lifecycle !== "active"
          || snapshotIds.has(photo.id)
        ) return false;
        snapshotIds.add(photo.id);
        const attachment = attachmentById.get(photo.id);
        if (!attachment || attachment.reportId !== photo.reportId || attachment.vehicleId !== photo.vehicleId) return false;
        if (photo.storageKind === "indexeddb_blob") {
          return attachment.storageKind === "indexeddb_blob"
            && photo.originalName === attachment.originalName
            && photo.detectedMediaType === attachment.detectedMediaType
            && photo.widthPx === attachment.widthPx
            && photo.heightPx === attachment.heightPx
            && photo.byteLength === attachment.byteLength
            && photo.sha256 === attachment.sha256
            && photo.createdAt === attachment.createdAt
            && photo.uploaderActorId === attachment.uploaderActorId
            && photo.uploaderActorName === attachment.uploaderActorName
            && photo.repairNeeded === false;
        }
        if (photo.storageKind !== "legacy_reference") return false;
        const isLegacyProvenance = attachment.storageKind === "legacy_reference"
          || (attachment.storageKind === "indexeddb_blob" && attachment.legacyOrigin !== undefined);
        return isLegacyProvenance
          && photo.originalName === null
          && photo.detectedMediaType === null
          && photo.widthPx === null
          && photo.heightPx === null
          && photo.byteLength === null
          && photo.sha256 === null
          && photo.createdAt === null
          && photo.uploaderActorId === null
          && photo.uploaderActorName === null
          && typeof photo.repairNeeded === "boolean";
      }), "PHOTO_MUTATION_RESULT_PHOTO", `${path}.result.photos`);
      stateInvariant(
        Array.isArray(receipt.result.auditEventIds)
          && receipt.result.auditEventIds.every((id) => typeof id === "string" && id.length > 0)
          && new Set(receipt.result.auditEventIds).size === receipt.result.auditEventIds.length,
        "PHOTO_MUTATION_RESULT_AUDITS",
        `${path}.result.auditEventIds`,
      );
      const resultAuditIds = receipt.result.auditEventIds as string[];
      const mutationAudits = state.reportAttachmentAuditEvents.filter((event) => event.mutationId === receipt.mutationId);
      const orderedMutationAudits = resultAuditIds.map((id) => attachmentAuditById.get(id));
      stateInvariant(
        stableJson(resultAuditIds) === stableJson(mutationAudits.map((event) => event.id))
          && orderedMutationAudits.every((event) => event !== undefined),
        "PHOTO_MUTATION_PAYLOAD_AUDIT_ORDER",
        `${path}.result.auditEventIds`,
      );
      const deletedAudits = orderedMutationAudits.filter((event) => event?.action === "deleted");
      stateInvariant(
        stableJson(deletedAudits.map((event) => event!.attachmentId)) === stableJson(photoPayload.deleteIds),
        "PHOTO_MUTATION_PAYLOAD_DELETES",
        `${path}.payloadCanonical.deleteIds`,
      );
      const uploadedAudits = orderedMutationAudits.filter((event) => event?.action === "uploaded");
      stateInvariant(
        uploadedAudits.length === photoPayload.files.length
          && (photoPayload.files as Array<Record<string, unknown>>).every((file, fileIndex) => {
            const event = uploadedAudits[fileIndex];
            const attachment = event ? attachmentById.get(event.attachmentId) : undefined;
            return attachment?.storageKind === "indexeddb_blob"
              && attachment.reportId === photoPayload.reportId
              && attachment.legacyOrigin === undefined
              && attachment.originalName === file.originalName
              && attachment.detectedMediaType === file.detectedMediaType
              && attachment.widthPx === file.widthPx
              && attachment.heightPx === file.heightPx
              && attachment.byteLength === file.byteLength
              && attachment.sha256 === file.sha256;
          }),
        "PHOTO_MUTATION_PAYLOAD_FILES",
        `${path}.payloadCanonical.files`,
      );
      stateInvariant(
        mutationAudits.every((event) => (
          event.action === "uploaded"
            ? snapshotIds.has(event.attachmentId)
            : event.action === "deleted"
              ? !snapshotIds.has(event.attachmentId)
              : false
        )),
        "PHOTO_MUTATION_RESULT_EFFECT",
        `${path}.result.photos`,
      );
      stateInvariant(
        mutationAudits.length === resultAuditIds.length
          && mutationAudits.every((event) => resultAuditIds.includes(event.id))
          && resultAuditIds.every((id) => {
            const event = attachmentAuditById.get(id);
            return event?.mutationId === receipt.mutationId
              && event.actorId === receipt.actorId
              && event.recordedAt === receipt.committedAt;
          }),
        "PHOTO_MUTATION_RESULT_AUDIT_OWNER",
        `${path}.result.auditEventIds`,
      );
    }
  });
  validateCanonicalBillingBindings(state);
  validateCanonicalParkingPaymentBindings(state, verifiedParkingSourceSnapshots);
  const currentNotifications = state.communicationEvents.filter(
    (event): event is LinkedFormalReportNotificationEvent => event.eventKind === "formal_report_notification",
  );
  const currentResponses = state.responseEvents.filter(
    (event): event is LinkedClassifiedCustomerResponseEvent => event.eventKind === "customer_response",
  );
  [...currentNotifications, ...currentResponses].forEach((event, index) => {
    const operation = event.eventKind === "formal_report_notification"
      ? "inspection.notification.send"
      : "inspection.response.record";
    const receipts = state.mutationReceipts.filter((receipt) => receipt.mutationId === event.mutationId && receipt.operation === operation);
    stateInvariant(receipts.length === 1, "IR_COMMUNICATION_EVENT_RECEIPT", `$.currentCommunicationEvents[${index}]`);
    const receiptEvent = isPlainRecord(receipts[0]?.result)
      && isPlainRecord(receipts[0].result.event)
      ? receipts[0].result.event
      : null;
    stateInvariant(
      receiptEvent !== null && stableJson(receiptEvent) === stableJson(event),
      "IR_COMMUNICATION_EVENT_RECEIPT",
      `$.currentCommunicationEvents[${index}]`,
    );
  });
  const responseByReport = new Map<string, Array<{ id: string; recordedAt: string }>>();
  state.responseEvents.forEach((event) => {
    if (isImportedCommunicationEvent(event) && event.result !== "legacy_unclassified" && event.legacyOrphanReport !== true) {
      const previous = responseByReport.get(event.reportId) ?? [];
      previous.push({ id: event.id, recordedAt: event.recordedAt });
      responseByReport.set(event.reportId, previous);
    }
  });
  state.communications.forEach((event) => {
    if (event.response !== "declined" && event.response !== "return_planned") return;
    const previous = responseByReport.get(event.reportId) ?? [];
    previous.push({ id: event.id, recordedAt: event.recordedAt });
    responseByReport.set(event.reportId, previous);
  });
  const lastCurrentResponseByReport = new Map<string, LinkedClassifiedCustomerResponseEvent>();
  currentResponses.forEach((event) => {
    const legacyPrevious = responseByReport.get(event.reportId) ?? [];
    const latestLegacy = legacyPrevious.reduce<{ id: string; recordedAt: string } | undefined>((candidate, value) => (
      candidate === undefined || Date.parse(value.recordedAt) >= Date.parse(candidate.recordedAt) ? value : candidate
    ), undefined);
    const latest = lastCurrentResponseByReport.get(event.reportId) ?? latestLegacy;
    stateInvariant(
      latest === undefined ? event.supersedesEventId === undefined : event.supersedesEventId === latest.id,
      "IR_RESPONSE_SUPERSEDES_CHAIN",
      `$.responseEvents.${event.id}.supersedesEventId`,
    );
    lastCurrentResponseByReport.set(event.reportId, event);
  });
  state.inspectionReports.forEach((report, reportIndex) => {
    const path = `$.inspectionReports[${reportIndex}].photoIds`;
    const legacyOrigins = state.reportAttachments
      .filter((attachment) => attachment.reportId === report.id)
      .flatMap((attachment) => {
        if (attachment.storageKind === "legacy_reference") {
          return [{ id: attachment.id, sequence: attachment.originalSequence }];
        }
        return attachment.legacyOrigin
          ? [{ id: attachment.id, sequence: attachment.legacyOrigin.sequence }]
          : [];
      })
      .sort((left, right) => left.sequence - right.sequence);
    stateInvariant(
      new Set(legacyOrigins.map((origin) => origin.sequence)).size === legacyOrigins.length,
      "PHOTO_MUTATION_BASELINE_ORDER",
      path,
    );
    let expectedActiveIds = legacyOrigins.map((origin) => origin.id);
    const reportReceipts = state.mutationReceipts
      .flatMap((receipt) => {
        if (receipt.operation !== "inspection.photos.update" || !receipt.payloadCanonical) return [];
        try {
          const payload = JSON.parse(receipt.payloadCanonical) as unknown;
          return isPlainRecord(payload) && payload.reportId === report.id ? [receipt] : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => left.committedRevision - right.committedRevision);
    for (const receipt of reportReceipts) {
      if (!isPlainRecord(receipt.result) || !Array.isArray(receipt.result.auditEventIds) || !Array.isArray(receipt.result.photos)) {
        stateInvariant(false, "PHOTO_MUTATION_RESULT_SNAPSHOT", `${path}:${receipt.id}`);
      }
      const orderedEvents = (receipt.result.auditEventIds as string[]).map((id) => attachmentAuditById.get(id));
      for (const event of orderedEvents.filter((candidate) => candidate?.action === "deleted")) {
        stateInvariant(expectedActiveIds.includes(event!.attachmentId), "PHOTO_MUTATION_RESULT_SNAPSHOT", `${path}:${receipt.id}`);
        expectedActiveIds = expectedActiveIds.filter((id) => id !== event!.attachmentId);
      }
      for (const event of orderedEvents.filter((candidate) => candidate?.action === "uploaded")) {
        stateInvariant(!expectedActiveIds.includes(event!.attachmentId), "PHOTO_MUTATION_RESULT_SNAPSHOT", `${path}:${receipt.id}`);
        expectedActiveIds.push(event!.attachmentId);
      }
      const snapshotIds = (receipt.result.photos as Array<Record<string, unknown>>).map((photo) => photo.id);
      stateInvariant(
        stableJson(snapshotIds) === stableJson(expectedActiveIds),
        "PHOTO_MUTATION_RESULT_SNAPSHOT",
        `${path}:${receipt.id}`,
      );
    }
    stateInvariant(
      stableJson(expectedActiveIds) === stableJson(report.photoIds),
      "PHOTO_MUTATION_CURRENT_SNAPSHOT",
      path,
    );
  });
  state.legacyRefundOccupancies.forEach((occupancy, index) => {
    const path = `$.legacyRefundOccupancies[${index}]`;
    const invoice = invoiceById.get(occupancy.invoiceId);
    const refundCandidate = state.refunds.find((candidate) => candidate.id === occupancy.legacyRefundId);
    const refund = refundCandidate?.refundContract === undefined
      ? refundCandidate as LinkedLegacyInvoiceRefundFact & { invoiceVersionId?: string; itemId?: string; quantity?: unknown }
      : undefined;
    stateInvariant(Boolean(refund), "REFUND_OCCUPANCY_REFUND", `${path}.legacyRefundId`);
    stateInvariant(refund?.invoiceId === occupancy.invoiceId, "REFUND_OCCUPANCY_OWNER", `${path}.invoiceId`);
    stateInvariant(Boolean(invoice), "REFUND_OCCUPANCY_INVOICE", `${path}.invoiceId`);
    stateInvariant(Number.isSafeInteger(occupancy.amountJmd) && occupancy.amountJmd >= 0, "REFUND_OCCUPANCY_AMOUNT", `${path}.amountJmd`);
    stateInvariant(occupancy.status === "line" || occupancy.status === "unassigned", "REFUND_OCCUPANCY_STATUS", `${path}.status`);
    stateInvariant(typeof occupancy.quantityUnknown === "boolean", "REFUND_OCCUPANCY_QUANTITY", `${path}.quantityUnknown`);
    if (occupancy.status === "line") {
      const ownerVersions = refund?.invoiceVersionId
        ? invoice?.versions.filter((version) => version.id === refund.invoiceVersionId)
        : invoice?.versions;
      const matchingSourceLines = typeof occupancy.chargeLineId === "string"
        ? ownerVersions?.flatMap((version) => (
          version.chargeContract === "shared_v1"
            ? []
            : version.lines.filter((line) => line.id === occupancy.chargeLineId)
        )) ?? []
        : [];
      stateInvariant(
        typeof occupancy.chargeLineId === "string"
          && matchingSourceLines.length === 1,
        "REFUND_OCCUPANCY_LINE",
        `${path}.chargeLineId`,
      );
      const sourceLine = matchingSourceLines[0] as unknown as Record<string, unknown> | undefined;
      const sourceQuantity = sourceLine?.quantity;
      const sourceNetUnitPriceJmd = sourceLine ? explicitLegacyFinalUnitPrice(sourceLine) : undefined;
      const explicitSourceRefundQuantity = Number.isSafeInteger(refund?.quantity) && Number(refund?.quantity) > 0
        ? Number(refund?.quantity)
        : undefined;
      const sourceRequiresExactQuantity = Boolean(
        refund?.itemId === occupancy.chargeLineId
        && explicitSourceRefundQuantity !== undefined
        && Number.isSafeInteger(sourceQuantity)
        && explicitSourceRefundQuantity <= Number(sourceQuantity)
        && sourceNetUnitPriceJmd !== undefined
        && explicitSourceRefundQuantity * sourceNetUnitPriceJmd === refund?.amountJmd,
      );
      if (sourceRequiresExactQuantity) {
        stateInvariant(
          occupancy.legacyRefundQuantity === explicitSourceRefundQuantity && !occupancy.quantityUnknown,
          "REFUND_OCCUPANCY_QUANTITY_REQUIRED",
          `${path}.legacyRefundQuantity`,
        );
      }
      if (occupancy.legacyRefundQuantity === undefined) {
        stateInvariant(occupancy.quantityUnknown, "REFUND_OCCUPANCY_QUANTITY_UNKNOWN", `${path}.quantityUnknown`);
      } else {
        stateInvariant(
          Number.isSafeInteger(occupancy.legacyRefundQuantity)
            && occupancy.legacyRefundQuantity > 0
            && !occupancy.quantityUnknown,
          "REFUND_OCCUPANCY_QUANTITY_VALUE",
          `${path}.legacyRefundQuantity`,
        );
        stateInvariant(
          Number.isSafeInteger(sourceQuantity)
            && Number(sourceQuantity) > 0
            && occupancy.legacyRefundQuantity <= Number(sourceQuantity),
          "REFUND_OCCUPANCY_QUANTITY_SOURCE",
          `${path}.legacyRefundQuantity`,
        );
        const expectedAmountJmd = sourceNetUnitPriceJmd === undefined
          ? undefined
          : occupancy.legacyRefundQuantity * sourceNetUnitPriceJmd;
        stateInvariant(
          Number.isSafeInteger(expectedAmountJmd) && expectedAmountJmd === occupancy.amountJmd,
          "REFUND_OCCUPANCY_QUANTITY_AMOUNT",
          `${path}.amountJmd`,
        );
      }
    } else {
      stateInvariant(
        occupancy.chargeLineId === undefined
          && occupancy.legacyRefundQuantity === undefined
          && occupancy.quantityUnknown,
        "REFUND_OCCUPANCY_UNASSIGNED",
        path,
      );
    }
  });
  const occupiedRefundKeys = new Set<string>();
  const occupiedRefundAmounts = new Map<string, number>();
  state.legacyRefundOccupancies.forEach((occupancy, index) => {
    const occupancyKey = `${occupancy.legacyRefundId}\u0000${occupancy.status}\u0000${occupancy.chargeLineId ?? ""}`;
    stateInvariant(!occupiedRefundKeys.has(occupancyKey), "REFUND_OCCUPANCY_DUPLICATE", `$.legacyRefundOccupancies[${index}]`);
    occupiedRefundKeys.add(occupancyKey);
    const total = (occupiedRefundAmounts.get(occupancy.legacyRefundId) ?? 0) + occupancy.amountJmd;
    stateInvariant(Number.isSafeInteger(total), "REFUND_OCCUPANCY_CONSERVATION", `$.legacyRefundOccupancies[${index}].amountJmd`);
    occupiedRefundAmounts.set(occupancy.legacyRefundId, total);
  });
  occupiedRefundAmounts.forEach((amountJmd, refundId) => {
    const refund = state.refunds.find((candidate) => candidate.id === refundId);
    stateInvariant(
      Boolean(refund && refund.refundContract === undefined && refund.amountJmd === amountJmd),
      "REFUND_OCCUPANCY_CONSERVATION",
      `$.legacyRefundOccupancies.${refundId}`,
    );
  });
  Object.entries(state.activeParkingClaim).forEach(([caseId, claim]) => {
    const parking = state.parkingCases.find((item) => item.id === caseId);
    const invoice = invoiceById.get(claim.logicalInvoiceId);
    const version = invoice?.versions.find((item) => item.id === claim.financiallyEffectiveVersionId);
    stateInvariant(
      hasOnlyKeys(claim as unknown as Record<string, unknown>, new Set([
        "logicalInvoiceId", "financiallyEffectiveVersionId", "chargeLineId",
      ]))
        && Object.keys(claim).length === 3,
      "PARKING_CLAIM_CLOSED",
      `$.activeParkingClaim.${caseId}`,
    );
    const line = version?.chargeContract === "shared_v1"
      ? version.snapshot.lines.find((candidate) => candidate.chargeLineId === claim.chargeLineId) as unknown as Record<string, unknown> | undefined
      : version?.lines.find((candidate) => candidate.id === claim.chargeLineId) as unknown as Record<string, unknown> | undefined;
    const lastWaiver = parking?.waiverHistory[parking.waiverHistory.length - 1];
    const expectedAmountJmd = parking && isModernParkingSourceFact(parking)
      ? deriveParkingFinalAccrual({
        currentAccrual: parking.accrual,
        dailyRateJmd: parking.dailyRateJmd,
        latestWaiverDecision: lastWaiver,
      }).finalAmountJmd
      : lastWaiver?.finalAmountJmd ?? parking?.accrual.originalAmountJmd;
    stateInvariant(Boolean(parking), "PARKING_CLAIM_CASE", `$.activeParkingClaim.${caseId}`);
    stateInvariant(Boolean(version), "PARKING_CLAIM_VERSION", `$.activeParkingClaim.${caseId}.financiallyEffectiveVersionId`);
    if (parking && isModernParkingSourceFact(parking)) {
      stateInvariant(
        invoice !== undefined
          && isSharedChargeInvoice(invoice)
          && parking.eligibleBusinessOrderIds.includes(invoice.businessOrderId)
          && invoice.financiallyEffectiveVersionId === claim.financiallyEffectiveVersionId
          && version?.chargeContract === "shared_v1",
        "PARKING_CLAIM_OWNERSHIP",
        `$.activeParkingClaim.${caseId}`,
      );
      stateInvariant(
        line?.pricingMode === "parking_projection"
          && line.category === "other_service"
          && line.code === "parking_overtime"
          && line.parkingCaseId === caseId
          && line.sourceRevision === parking.revision
          && line.asOf === parking.asOf
          && Number.isSafeInteger(line.amountJmd)
          && line.amountJmd === expectedAmountJmd,
        "PARKING_CLAIM_LINE_SCHEMA",
        `$.activeParkingClaim.${caseId}.chargeLineId`,
      );
    } else {
      const legacy = parking as LinkedLegacyParkingCaseFact | undefined;
      stateInvariant(
        legacy?.invoiceId === claim.logicalInvoiceId
          && legacy.invoiceVersionId === claim.financiallyEffectiveVersionId
          && invoice?.businessOrderId === legacy.businessOrderId
          && invoice?.versions[invoice.versions.length - 1]?.id === claim.financiallyEffectiveVersionId,
        "PARKING_CLAIM_OWNERSHIP",
        `$.activeParkingClaim.${caseId}`,
      );
      stateInvariant(
        line?.category === "other_service"
          && line.code === "parking_overtime"
          && line.parkingCaseId === caseId
          && line.sourceRevision === legacy?.revision
          && typeof line.asOf === "string"
          && Number.isFinite(Date.parse(line.asOf))
          && typeof version?.issuedAt === "string"
          && Date.parse(line.asOf) === Date.parse(version.issuedAt)
          && Number.isSafeInteger(line.amountJmd)
          && line.amountJmd === expectedAmountJmd
          && (line.sourceId === undefined || line.sourceId === caseId),
        "PARKING_CLAIM_LINE_SCHEMA",
        `$.activeParkingClaim.${caseId}.chargeLineId`,
      );
    }
  });
  state.invoices.filter(isSharedChargeInvoice).forEach((invoice) => {
    const version = invoice.versions.find((candidate) => candidate.id === invoice.financiallyEffectiveVersionId);
    stateInvariant(Boolean(version), "PARKING_EFFECTIVE_VERSION", `$.invoices.${invoice.id}.financiallyEffectiveVersionId`);
    version!.snapshot.lines.filter((line) => line.pricingMode === "parking_projection").forEach((line) => {
      const claim = state.activeParkingClaim[line.parkingCaseId];
      const source = state.parkingCases.find((candidate) => candidate.id === line.parkingCaseId);
      stateInvariant(
        source !== undefined
          && isModernParkingSourceFact(source)
          && claim?.logicalInvoiceId === invoice.id
          && claim.financiallyEffectiveVersionId === version!.id
          && claim.chargeLineId === line.chargeLineId,
        "PARKING_EFFECTIVE_LINE_CLAIM",
        `$.invoices.${invoice.id}.versions.${version!.id}.snapshot.lines.${line.chargeLineId}`,
      );
    });
  });
  state.invoiceAcknowledgements.forEach((acknowledgement, index) => {
    const invoice = invoiceById.get(acknowledgement.invoiceId);
    stateInvariant(Boolean(invoice?.versions.some((version) => version.id === acknowledgement.invoiceVersionId)), "ACK_INVOICE_VERSION_REF", `$.invoiceAcknowledgements[${index}]`);
  });
  state.specialReleaseAuthorizations.forEach((authorization, index) => {
    stateInvariant(businessOrderIds.has(authorization.orderId), "RELEASE_BO_REF", `$.specialReleaseAuthorizations[${index}].orderId`);
    stateInvariant(invoiceById.has(authorization.invoiceId), "RELEASE_INVOICE_REF", `$.specialReleaseAuthorizations[${index}].invoiceId`);
  });
  state.reassignments.forEach((audit, index) => {
    stateInvariant(businessOrderIds.has(audit.orderId), "REASSIGN_BO_REF", `$.reassignments[${index}].orderId`);
  });
  state.performanceAudits.forEach((audit, index) => {
    const path = `$.performanceAudits[${index}]`;
    stateInvariant(businessOrderIds.has(audit.orderId), "PERF_AUDIT_BO_REF", `${path}.orderId`);
    stateInvariant(
      audit.kind === "performance_value_adjusted" || audit.kind === "formal_submitted",
      "PERF_AUDIT_KIND",
      `${path}.kind`,
    );
    stateInvariant(
      Number.isSafeInteger(audit.previousValueJmd) && audit.previousValueJmd >= 0
        && Number.isSafeInteger(audit.newValueJmd) && audit.newValueJmd >= 0,
      "PERF_AUDIT_VALUE",
      path,
    );
    stateInvariant(Number.isFinite(Date.parse(audit.at)), "PERF_AUDIT_TIME", `${path}.at`);
  });
  const expectedDocuments = deriveOperationsDocuments(state);
  stateInvariant(state.operationsDocuments.length === expectedDocuments.length, "OPERATIONS_DOCUMENT_COUNT", "$.operationsDocuments");
  expectedDocuments.forEach((expected, index) => {
    const actual = state.operationsDocuments.find((document) => document.id === expected.id);
    stateInvariant(
      actual?.vehicleId === expected.vehicleId && actual.stage === expected.stage,
      "OPERATIONS_DOCUMENT_SOURCE",
      `$.operationsDocuments[${index}]`,
    );
  });
  const sourceDocumentIds = new Set(expectedDocuments.map((document) => document.id));
  const expectedAssignments = deriveOperationsAssignments(state);
  stateInvariant(
    state.operationsAssignments.length === expectedAssignments.length,
    "OPERATIONS_ASSIGNMENT_COUNT",
    "$.operationsAssignments",
  );
  expectedAssignments.forEach((expected, index) => {
    const assignment = state.operationsAssignments.find((candidate) => candidate.id === expected.id);
    const path = `$.operationsAssignments[${index}]`;
    stateInvariant(
      Boolean(assignment) && JSON.stringify(assignment) === JSON.stringify(expected),
      "OPERATIONS_ASSIGNMENT_SOURCE",
      path,
    );
    if (!assignment) return;
    const report = state.inspectionReports.find((candidate) => candidate.id === assignment.documentId);
    const order = state.businessOrders.find((candidate) => candidate.id === assignment.documentId);
    if (report) {
      stateInvariant(
        assignment.kind === "inspection"
        && assignment.vehicleId === report.vehicleId
        && assignment.teamId === report.inspectorTeamId
        && assignment.sourceInspection?.inspectorTeamId === report.inspectorTeamId,
        "OPERATIONS_INSPECTION_ASSIGNMENT_SOURCE",
        path,
      );
    } else {
      stateInvariant(
        Boolean(order)
        && assignment.kind === "repair"
        && assignment.vehicleId === order!.vehicleId
        && assignment.teamId === order!.executionTeamId,
        "OPERATIONS_REPAIR_ASSIGNMENT_SOURCE",
        path,
      );
    }
    if (assignment.status !== "completed") {
      stateInvariant(
        sourceDocumentIds.has(assignment.documentId),
        "OPERATIONS_ACTIVE_ASSIGNMENT_DOCUMENT_REF",
        `${path}.documentId`,
      );
    }
  });
  new Set(expectedAssignments.map((assignment) => assignment.documentId)).forEach((documentId) => {
    stateInvariant(
      state.operationsAssignments.filter((assignment) => assignment.documentId === documentId).length === 1,
      "OPERATIONS_ASSIGNMENT_UNIQUE_SOURCE",
      `$.operationsAssignments.${documentId}`,
    );
  });
}

interface Task5CompatibleLinkedState { readonly state: LinkedOperationsState; }

function normalizeTask5CompatibleLinkedState(value: unknown): Task5CompatibleLinkedState | null {
  if (!isPlainRecord(value) || value.schemaVersion !== LINKED_OPERATIONS_SCHEMA_VERSION) return null;
  const state = clone(value) as unknown as LinkedOperationsState;
  try {
    validateLinkedOperationsState(state);
    return { state };
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("mutation payload is not JSON serializable");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function canonicalMutationPayload(value: unknown): string {
  const active = new WeakSet<object>();
  const visit = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("mutation payload number must be finite");
      return JSON.stringify(current);
    }
    if (typeof current !== "object") throw new Error("mutation payload contains a non-JSON value");
    if (active.has(current)) throw new Error("mutation payload contains a cycle");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const keys = Reflect.ownKeys(current);
        if (
          keys.length !== current.length + 1
          || keys.some((key) => {
            if (key === "length") return false;
            if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return true;
            const index = Number(key);
            return !Number.isSafeInteger(index) || index < 0 || index >= current.length || String(index) !== key;
          })
        ) {
          throw new Error("mutation payload array has unsupported properties");
        }
        const items: string[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor) {
            throw new Error("mutation payload sparse arrays are forbidden");
          }
          if (!descriptor.enumerable || !("value" in descriptor)) {
            throw new Error("mutation payload array elements must be enumerable data properties");
          }
          items.push(visit(descriptor.value));
        }
        return `[${items.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("mutation payload objects must be plain records");
      }
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) {
        throw new Error("mutation payload symbol keys are forbidden");
      }
      const object = current as Record<string, unknown>;
      const stringKeys = keys as string[];
      for (const key of stringKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new Error("mutation payload properties must be enumerable data properties");
        }
      }
      return `{${stringKeys.sort().map((key) => `${JSON.stringify(key)}:${visit(object[key])}`).join(",")}}`;
    } finally {
      active.delete(current);
    }
  };
  return visit(value);
}

function stableSourceHash(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, distance: number): number {
  return (value >>> distance) | (value << (32 - distance));
}

function sha256Bytes(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15]!;
      const w2 = words[index - 2]!;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sigma1 + choice + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sigma0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function utf16LeBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  return bytes;
}

function exactSourceHash(value: string): string {
  return `sha256-utf16le:${sha256Bytes(utf16LeBytes(value))}`;
}

/** Strong, deterministic commitment for one closed immutable Invoice snapshot. */
export function billingSnapshotCommitment(snapshot: InvoiceChargeSnapshot): string {
  validateInvoiceChargeSnapshot(snapshot);
  return exactSourceHash(stableJson(snapshot));
}

export function parkingSourceOriginCommitment(
  origin: Omit<LinkedParkingSourceCreationOrigin, "commitment">,
): string {
  return exactSourceHash(stableJson(origin));
}

function legacyMoney(item: Record<string, unknown>): {
  quantity: number;
  unitPriceJmd: number;
  unitDiscountJmd: number;
  amountJmd: number;
} {
  const quantity = Number.isSafeInteger(item.quantity) && Number(item.quantity) > 0 ? Number(item.quantity) : 1;
  const unitPriceJmd = Number.isSafeInteger(item.unitPriceJmd) && Number(item.unitPriceJmd) >= 0
    ? Number(item.unitPriceJmd)
    : Number.isSafeInteger(item.amountJmd) && Number(item.amountJmd) >= 0
      ? Number(item.amountJmd)
      : 0;
  const requestedDiscount = Number.isSafeInteger(item.unitDiscountJmd) && Number(item.unitDiscountJmd) >= 0
    ? Number(item.unitDiscountJmd)
    : 0;
  const unitDiscountJmd = Math.min(requestedDiscount, unitPriceJmd);
  const amountJmd = quantity * (unitPriceJmd - unitDiscountJmd);
  if (!Number.isSafeInteger(amountJmd)) throw new Error("legacy charge amount exceeds safe integer range");
  return { quantity, unitPriceJmd, unitDiscountJmd, amountJmd };
}

function legacyParkingAmount(line: Record<string, unknown>): number {
  if (Number.isSafeInteger(line.amountJmd) && Number(line.amountJmd) >= 0) return Number(line.amountJmd);
  const quantity = Number.isSafeInteger(line.quantity) && Number(line.quantity) > 0 ? Number(line.quantity) : 0;
  const price = Number.isSafeInteger(line.unitPriceJmd) && Number(line.unitPriceJmd) >= 0 ? Number(line.unitPriceJmd) : 0;
  const amount = quantity * price;
  if (!Number.isSafeInteger(amount)) throw new Error("legacy parking amount exceeds safe integer range");
  return amount;
}

function explicitLegacyFinalUnitPrice(line: Record<string, unknown>): number | undefined {
  if (!Number.isSafeInteger(line.unitPriceJmd) || Number(line.unitPriceJmd) < 0) return undefined;
  const unitPriceJmd = Number(line.unitPriceJmd);
  const discounted = line.unitDiscountJmd === undefined
    ? undefined
    : Number.isSafeInteger(line.unitDiscountJmd)
      && Number(line.unitDiscountJmd) >= 0
      && Number(line.unitDiscountJmd) <= unitPriceJmd
        ? unitPriceJmd - Number(line.unitDiscountJmd)
        : null;
  const explicit = line.finalUnitPriceJmd === undefined
    ? undefined
    : Number.isSafeInteger(line.finalUnitPriceJmd)
      && Number(line.finalUnitPriceJmd) >= 0
      && Number(line.finalUnitPriceJmd) <= unitPriceJmd
        ? Number(line.finalUnitPriceJmd)
        : null;
  if (discounted === null || explicit === null) return undefined;
  if (discounted !== undefined && explicit !== undefined && discounted !== explicit) return undefined;
  return explicit ?? discounted ?? unitPriceJmd;
}

export interface MockLinkedOperationsStore {
  ready(): Promise<void>;
  read<T>(selector: (state: LinkedOperationsState) => T, action?: string): T;
  mutate<T>(
    mutation: (draft: LinkedOperationsState) => T | Promise<T>,
    options?: { action?: string; consumeWriteFault?: boolean },
  ): Promise<T>;
  mutateIdempotently<T>(
    input: {
      mutationId: string;
      operation: string;
      actorId: string;
      payload: unknown;
      recordedAt: string;
    },
    mutation: (draft: LinkedOperationsState) => T | Promise<T>,
    options?: {
      action?: string;
      consumeWriteFault?: boolean;
      /** Optional operation-scoped authorization recheck, run under the lock before receipt replay. */
      preReceiptGuard?: (state: LinkedOperationsState) => void | Promise<void>;
    },
  ): Promise<{ result: T; replayed: boolean; receipt: LinkedMutationReceipt }>;
  getReadDelay(action?: string): number;
  nowMs(): number;
  /** Internal-only child ledger writer used inside one already-locked outer mutation. */
  createDraftChildStore(draft: LinkedOperationsState, nowMs: number): MockLinkedOperationsStore;
}

const TASK8_CHILD_MUTATION_PREFIX = "__task8_child_v1__/";
const task8DraftChildStores = new WeakSet<object>();

export type Task8ChildMutationStage = "invoice-activation" | "invoice-payment";

export function task8ChildMutationId(
  outerMutationId: string,
  stage: Task8ChildMutationStage,
): string {
  return `${TASK8_CHILD_MUTATION_PREFIX}${stage}/${encodeURIComponent(outerMutationId)}`;
}

export function isTask8ReservedChildMutationId(mutationId: string): boolean {
  return mutationId.startsWith(TASK8_CHILD_MUTATION_PREFIX);
}

export function isTask8DraftChildStore(store: MockLinkedOperationsStore): boolean {
  return task8DraftChildStores.has(store);
}

export interface LinkedOperationsLockManager {
  request<T>(name: string, action: () => T | Promise<T>): Promise<T>;
}

export interface LinkedOperationsMutationCoordinator {
  runExclusive<T>(action: () => T | Promise<T>): Promise<T>;
}

export interface LinkedOperationsMutationCoordinatorOptions {
  lockManager?: LinkedOperationsLockManager | null;
}

const LINKED_OPERATIONS_LOCK_NAME = "wh-linked-operations-v2";

const localLockTails = new Map<string, Promise<void>>();
const isolatedRuntimeLockManager: LinkedOperationsLockManager = {
  request: async <T>(name: string, action: () => T | Promise<T>): Promise<T> => {
    const previous = localLockTails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    localLockTails.set(name, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (localLockTails.get(name) === current) localLockTails.delete(name);
    }
  },
};

function runtimeLockManager(): LinkedOperationsLockManager | null {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks;
  // Node/SSR and the unit harness have one JS realm. This path never runs in a
  // real browser, where window.navigator and global navigator are identical.
  if (typeof window === "undefined" || window.navigator !== navigator) return isolatedRuntimeLockManager;
  return null;
}

export function createLinkedOperationsMutationCoordinator(
  _browserStorage?: Storage,
  options: LinkedOperationsMutationCoordinatorOptions = {},
): LinkedOperationsMutationCoordinator {
  const lockManager = options.lockManager === undefined ? runtimeLockManager() : options.lockManager;
  return {
    runExclusive: async <T>(action: () => T | Promise<T>): Promise<T> => {
      if (!lockManager) throw new LinkedApiDomainError("写入协调服务暂不可用", 503);
      return lockManager.request(LINKED_OPERATIONS_LOCK_NAME, action);
    },
  };
}

const consumedScenarioFaults = new WeakMap<object, Set<string>>();

function consumeScenarioFailure(
  kind: "read" | "write",
  action: string,
  allowGeneric: boolean,
): string | undefined {
  const scenario = rawLinkedScenario();
  const scoped = scenario.failNext?.byAction?.[action];
  const message = scoped ?? (allowGeneric ? scenario.failNext?.[kind] : undefined);
  if (!message) return undefined;
  const key = scoped ? `${kind}:${action}` : `${kind}:*`;
  const consumed = consumedScenarioFaults.get(scenario) ?? new Set<string>();
  if (consumed.has(key)) return undefined;
  consumed.add(key);
  consumedScenarioFaults.set(scenario, consumed);
  return message;
}

export interface CreateMockLinkedOperationsStoreOptions {
  coordinator?: LinkedOperationsMutationCoordinator;
  payloadHasher?: (canonicalPayload: string) => string;
}

export function createMockLinkedOperationsStore(
  browserStorage?: Storage,
  options: CreateMockLinkedOperationsStoreOptions = {},
): MockLinkedOperationsStore {
  interface InitializationSourcePair {
    readonly primaryRaw: string | null;
  }
  let initialBundle = initialLinkedOperationsBundle();
  let state = initialBundle.state;
  let cachedSerialized: string | null | undefined;
  let protectionVerifiedPair: InitializationSourcePair | undefined;
  let failedInitializationPair: InitializationSourcePair | undefined;
  const coordinator = options.coordinator ?? createLinkedOperationsMutationCoordinator(browserStorage);
  const payloadHasher = options.payloadHasher ?? stableSourceHash;

  const readSerialized = (): string | null => {
    if (!browserStorage) return null;
    try {
      return browserStorage.getItem(LINKED_OPERATIONS_STORAGE_KEY);
    } catch (error) {
      throw new LinkedApiDomainError(
        error instanceof Error ? error.message : "canonical storage 读取失败",
        503,
      );
    }
  };

  const readSourcePair = (): InitializationSourcePair => ({ primaryRaw: readSerialized() });

  const sourcePairsEqual = (
    left: InitializationSourcePair | undefined,
    right: InitializationSourcePair | undefined,
  ): boolean => left !== undefined && right !== undefined
    && left.primaryRaw === right.primaryRaw;

  const parseSerialized = (serialized: string | null): unknown => {
    try {
      return serialized === null ? undefined : JSON.parse(serialized);
    } catch {
      return undefined;
    }
  };

  const loadReadableState = (serialized: string | null): boolean => {
    if (serialized === cachedSerialized) return true;
    if (serialized === null) {
      initialBundle = initialLinkedOperationsBundle();
      state = initialBundle.state;
      cachedSerialized = null;
      return true;
    }
    const parsed = parseSerialized(serialized);
    const compatible = normalizeTask5CompatibleLinkedState(parsed);
    if (compatible) {
      state = compatible.state;
      cachedSerialized = serialized;
      return true;
    }
    return false;
  };


  const writeCanonical = (
    candidateState: LinkedOperationsState,
    message: string,
  ): string => {
    const serialized = JSON.stringify(candidateState);
    if (!browserStorage) {
      state = candidateState;
      cachedSerialized = null;
      protectionVerifiedPair = undefined;
      failedInitializationPair = undefined;
      return serialized;
    }
    try {
      browserStorage.setItem(LINKED_OPERATIONS_STORAGE_KEY, serialized);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : message, 503);
    }
    const committedPair = readSourcePair();
    if (committedPair.primaryRaw !== serialized) {
      protectionVerifiedPair = undefined;
      failedInitializationPair = committedPair;
      throw new LinkedApiDomainError(
        "canonical storage 写后校验失败",
        503,
      );
    }
    state = candidateState;
    cachedSerialized = serialized;
    protectionVerifiedPair = committedPair;
    failedInitializationPair = undefined;
    return serialized;
  };

  const initializeCleanDemoInsideLock = async (): Promise<void> => {
    if (!browserStorage) return;
    const lockedSourcePair = readSourcePair();
    if (
      sourcePairsEqual(protectionVerifiedPair, lockedSourcePair)
      && lockedSourcePair.primaryRaw !== null
      && lockedSourcePair.primaryRaw === cachedSerialized
    ) return;

    const parsedPrimary = parseSerialized(lockedSourcePair.primaryRaw);
    const compatible = normalizeTask5CompatibleLinkedState(parsedPrimary);
    const currentCleanPrimary = compatible !== null
      && compatible.state.protectionAnchor === initialBundle.state.protectionAnchor;
    const candidateState = currentCleanPrimary
      ? compatible.state
      : initialLinkedOperationsBundle().state;

    validateLinkedOperationsState(candidateState);
    if (!sourcePairsEqual(readSourcePair(), lockedSourcePair)) {
      throw new LinkedApiDomainError("clean Mock state 初始化期间发生变化", 503);
    }

    const serialized = JSON.stringify(candidateState);
    if (serialized !== lockedSourcePair.primaryRaw) {
      try {
        browserStorage.setItem(LINKED_OPERATIONS_STORAGE_KEY, serialized);
      } catch (error) {
        throw new LinkedApiDomainError(error instanceof Error ? error.message : "clean Mock state 写入失败", 503);
      }
    }
    const committedPair = readSourcePair();
    if (committedPair.primaryRaw !== serialized) {
      throw new LinkedApiDomainError("clean Mock state 写后校验失败", 503);
    }
    state = candidateState;
    cachedSerialized = serialized;
    protectionVerifiedPair = committedPair;
  };

  const ready = async (): Promise<void> => {
    if (!browserStorage) return;
    const sourcePair = readSourcePair();
    if (sourcePairsEqual(protectionVerifiedPair, sourcePair) && sourcePair.primaryRaw !== null) {
      if (sourcePair.primaryRaw === cachedSerialized) return;
      const compatible = normalizeTask5CompatibleLinkedState(parseSerialized(sourcePair.primaryRaw));
      if (compatible && loadReadableState(sourcePair.primaryRaw)) return;
      protectionVerifiedPair = undefined;
    }
    try {
      await coordinator.runExclusive(initializeCleanDemoInsideLock);
      failedInitializationPair = undefined;
    } catch (error) {
      failedInitializationPair = failedInitializationPair ?? readSourcePair();
      protectionVerifiedPair = undefined;
      throw error;
    }
  };

  const refreshReadableState = () => {
    if (!browserStorage) return;
    const sourcePair = readSourcePair();
    if (sourcePairsEqual(failedInitializationPair, sourcePair)) {
      throw new LinkedApiDomainError("canonical storage 尚未完成安全初始化", 503);
    }
    if (!sourcePairsEqual(protectionVerifiedPair, sourcePair)) {
      throw new LinkedApiDomainError("canonical storage 已变化，请重新载入", 409);
    }
    if (sourcePair.primaryRaw === null) return;
    if (loadReadableState(sourcePair.primaryRaw)) return;
    throw new LinkedApiDomainError("canonical storage 尚未完成安全初始化", 503);
  };

  const commitDraft = async (
    draft: LinkedOperationsState,
    mutationOptions?: { action?: string; consumeWriteFault?: boolean },
  ): Promise<void> => {
    const pruneAt = linkedNowMs();
    draft.parkingWaiverPreviews = draft.parkingWaiverPreviews.filter((preview) => (
      (Object.prototype.hasOwnProperty.call(preview, "previewContract")
        && preview.previewContract === "parking_correction_preview_v1")
      || (Number.isFinite(Date.parse(preview.expiresAt)) && Date.parse(preview.expiresAt) >= pruneAt)
    ));
    draft.operationsDocuments = deriveOperationsDocuments(draft);
    draft.operationsAssignments = deriveOperationsAssignments(draft);
    try {
      validateLinkedOperationsState(draft);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new LinkedApiDomainError(`canonical operations state validation failed${detail}`, 500);
    }
    const message = consumeScenarioFailure(
      "write",
      mutationOptions?.action ?? "linked.write",
      mutationOptions?.consumeWriteFault !== false,
    );
    if (message) throw new LinkedApiDomainError(message, 503);
    if (browserStorage) {
      const currentPair = readSourcePair();
      if (!sourcePairsEqual(protectionVerifiedPair, currentPair)) {
        throw new LinkedApiDomainError("canonical storage 在 mutation 期间发生变化", 409);
      }
    }
    writeCanonical(draft, "canonical storage 写入失败");
  };

  const createDraftChildStore = (
    draft: LinkedOperationsState,
    childNowMs: number,
  ): MockLinkedOperationsStore => {
    const childStore: MockLinkedOperationsStore = {
      ready: async () => undefined,
      read: (selector) => clone(selector(draft)),
      mutate: async () => {
        throw new LinkedApiDomainError("child ledger store 禁止无 receipt 写入", 500);
      },
      mutateIdempotently: async <T,>(input: {
        mutationId: string;
        operation: string;
        actorId: string;
        payload: unknown;
        recordedAt: string;
      }, mutation: (childDraft: LinkedOperationsState) => T | Promise<T>, mutationOptions?: {
        action?: string;
        consumeWriteFault?: boolean;
        preReceiptGuard?: (state: LinkedOperationsState) => void | Promise<void>;
      }): Promise<{ result: T; replayed: boolean; receipt: LinkedMutationReceipt }> => {
        void mutationOptions?.action;
        void mutationOptions?.consumeWriteFault;
        if (!input.mutationId.trim() || !input.operation.trim() || !input.actorId.trim()) {
          throw new LinkedApiDomainError("child mutation receipt identity 无效", 400);
        }
        if (!isTask8ReservedChildMutationId(input.mutationId)) {
          throw new LinkedApiDomainError("child mutationId 必须使用保留命名空间", 400);
        }
        if (!isValidIsoTimestamp(input.recordedAt)) {
          throw new LinkedApiDomainError("child mutation receipt 时间无效", 400);
        }
        let payloadCanonical: string;
        let payloadHash: string;
        try {
          payloadCanonical = canonicalMutationPayload(input.payload);
          payloadHash = payloadHasher(payloadCanonical);
        } catch {
          throw new LinkedApiDomainError("child mutation payload 无法序列化", 400);
        }
        await mutationOptions?.preReceiptGuard?.(draft);
        if (draft.mutationReceipts.some((receipt) => receipt.mutationId === input.mutationId)) {
          throw new LinkedApiDomainError("保留 child mutationId 已存在", 409);
        }
        const result = await mutation(draft);
        const receipt: LinkedMutationReceipt = {
          id: input.mutationId,
          mutationId: input.mutationId,
          operation: input.operation,
          actorId: input.actorId,
          payloadHash,
          payloadCanonical,
          result: clone(result),
          committedRevision: draft.revision,
          committedAt: input.recordedAt,
        };
        draft.mutationReceipts.push(receipt);
        return { result: clone(result), replayed: false, receipt: clone(receipt) };
      },
      getReadDelay: () => 0,
      nowMs: () => childNowMs,
      createDraftChildStore: () => {
        throw new LinkedApiDomainError("child ledger store 不支持嵌套 child", 500);
      },
    };
    task8DraftChildStores.add(childStore);
    return childStore;
  };

  if (browserStorage) {
    const sourcePair = readSourcePair();
    if (sourcePair.primaryRaw === null) {
      state = initialBundle.state;
      cachedSerialized = null;
      protectionVerifiedPair = sourcePair;
    } else if (loadReadableState(sourcePair.primaryRaw)) {
      if (state.protectionAnchor === initialBundle.state.protectionAnchor) {
        protectionVerifiedPair = sourcePair;
      }
    }
  }
  return {
    ready,
    read: (selector, action = "linked.read") => {
      refreshReadableState();
      const message = consumeScenarioFailure("read", action, true);
      if (message) throw new LinkedApiDomainError(message, 503);
      return clone(selector(state));
    },
    mutate: async (mutation, mutationOptions) => {
      await ready();
      return coordinator.runExclusive(async () => {
        await initializeCleanDemoInsideLock();
        const draft = clone(state);
        const result = await mutation(draft);
        await commitDraft(draft, mutationOptions);
        return clone(result);
      });
    },
    mutateIdempotently: async <T,>(
      input: {
        mutationId: string;
        operation: string;
        actorId: string;
        payload: unknown;
        recordedAt: string;
      },
      mutation: (draft: LinkedOperationsState) => T | Promise<T>,
      mutationOptions?: {
        action?: string;
        consumeWriteFault?: boolean;
        preReceiptGuard?: (state: LinkedOperationsState) => void | Promise<void>;
      },
    ): Promise<{ result: T; replayed: boolean; receipt: LinkedMutationReceipt }> => {
      if (!input.mutationId.trim() || !input.operation.trim() || !input.actorId.trim()) {
        throw new LinkedApiDomainError("mutation receipt identity 无效", 400);
      }
      if (!isValidIsoTimestamp(input.recordedAt)) {
        throw new LinkedApiDomainError("mutation receipt 时间无效", 400);
      }
      let payloadHash: string;
      let payloadCanonical: string;
      try {
        payloadCanonical = canonicalMutationPayload(input.payload);
        payloadHash = payloadHasher(payloadCanonical);
      } catch {
        throw new LinkedApiDomainError("mutation payload 无法序列化", 400);
      }
      await ready();
      return coordinator.runExclusive(async () => {
        await initializeCleanDemoInsideLock();
        await mutationOptions?.preReceiptGuard?.(state);
        const existing = state.mutationReceipts.find((receipt) => receipt.mutationId === input.mutationId);
        if (existing) {
          if (
            existing.operation !== input.operation
            || existing.actorId !== input.actorId
            || existing.payloadHash !== payloadHash
            || existing.payloadCanonical === undefined
            || existing.payloadCanonical !== payloadCanonical
          ) {
            throw new LinkedApiDomainError("mutationId 已被不同请求使用", 409);
          }
          return {
            result: clone(existing.result) as T,
            replayed: true,
            receipt: clone(existing),
          };
        }
        const draft = clone(state);
        const result = await mutation(draft);
        const receipt: LinkedMutationReceipt = {
          id: input.mutationId,
          mutationId: input.mutationId,
          operation: input.operation,
          actorId: input.actorId,
          payloadHash,
          payloadCanonical,
          result: clone(result),
          committedRevision: draft.revision,
          committedAt: input.recordedAt,
        };
        draft.mutationReceipts.push(receipt);
        await commitDraft(draft, mutationOptions);
        return { result: clone(result) as T, replayed: false, receipt: clone(receipt) };
      });
    },
    getReadDelay: (action = "linked.read") => Math.max(
      0,
      rawLinkedScenario().delayMs?.byAction?.[action] ?? rawLinkedScenario().delayMs?.read ?? 0,
    ),
    nowMs: linkedNowMs,
    createDraftChildStore,
  };
}

let browserStore: MockLinkedOperationsStore | undefined;
let browserStoreStorage: Storage | undefined;
let browserStoreListensForExternalWrites = false;

export function getMockLinkedOperationsStore(): MockLinkedOperationsStore {
  const browserStorage = typeof window === "undefined" ? undefined : window.localStorage;
  if (typeof window !== "undefined" && typeof window.addEventListener === "function" && !browserStoreListensForExternalWrites) {
    window.addEventListener("storage", (event) => {
      if (
        event.key !== LINKED_OPERATIONS_STORAGE_KEY
        && event.key !== LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
      ) return;
      browserStore = undefined;
      browserStoreStorage = undefined;
    });
    browserStoreListensForExternalWrites = true;
  }
  if (browserStore && browserStoreStorage === browserStorage) return browserStore;
  browserStore = createMockLinkedOperationsStore(browserStorage);
  browserStoreStorage = browserStorage;
  return browserStore;
}

function optionalNumber(searchParams: URLSearchParams, key: string): number | undefined {
  const value = searchParams.get(key);
  return value === null ? undefined : Number(value);
}

export function mockOrderQueryFromSearchParams(searchParams: URLSearchParams): OrderListQuery {
  const scope = searchParams.get("scope");
  const lifecycle = searchParams.get("lifecycle");
  const status = searchParams.get("status");
  const teamId = searchParams.get("teamId");
  const search = searchParams.get("search");
  return {
    ...(scope !== null ? { scope: scope as OrderListQuery["scope"] } : {}),
    ...(lifecycle !== null ? { lifecycle: lifecycle as OrderLifecycleFilter } : {}),
    ...(status !== null ? { status: status as OrderProcessingStatus } : {}),
    ...(teamId !== null ? { teamId: teamId as OrderTeamId } : {}),
    ...(search !== null ? { search } : {}),
    ...(searchParams.has("page") ? { page: optionalNumber(searchParams, "page") } : {}),
    ...(searchParams.has("pageSize") ? { pageSize: optionalNumber(searchParams, "pageSize") } : {}),
  };
}

export function getMockOrders(query: OrderListQuery = {}): OrderListResponse {
  if ((query.scope ?? "business") !== "business") {
    throw new LinkedApiDomainError("工单查询仅支持 business 范围", 400);
  }
  if (query.lifecycle !== undefined && !isOrderLifecycleFilter(query.lifecycle)) {
    throw new LinkedApiDomainError("工单生命周期无效", 400);
  }
  if (query.status !== undefined && !isOrderProcessingStatus(query.status)) {
    throw new LinkedApiDomainError("工单办理状态无效", 400);
  }
  if (query.teamId !== undefined && !isOrderTeamId(query.teamId)) {
    throw new LinkedApiDomainError("工单班组无效", 400);
  }
  if (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1)) {
    throw new LinkedApiDomainError("工单页码必须是大于等于 1 的整数", 400);
  }
  if (
    query.pageSize !== undefined
    && (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 500)
  ) {
    throw new LinkedApiDomainError("工单每页数量必须是 1 至 500 的整数", 400);
  }
  return getMockLinkedOperationsStore().read((state) => {
    const latestByOrder = new Map<string, OrderReassignmentAudit>();
    for (const audit of state.reassignments) latestByOrder.set(audit.orderId, audit);
    const records = state.orderRecords.map((order) => {
      const audit = latestByOrder.get(order.id);
      return audit ? {
        ...order,
        teamId: audit.toTeamId,
        updatedAt: audit.changedAt,
        updatedBy: audit.actor.name,
      } : order;
    });
    const response = queryOrders(records, query);
    return {
      ...response,
      items: response.items.map((item) => {
        const businessOrder = state.businessOrders.find((candidate) => candidate.id === item.id);
        const invoice = businessOrder
          ? state.invoices.find((candidate) => candidate.businessOrderId === businessOrder.id)
          : undefined;
        if (!invoice) throw new Error("Business Order 缺少 canonical Invoice");
        const financial = deriveLinkedInvoiceFinancialSummary(state, invoice);
        return {
          ...item,
          receivableJmd: invoiceVersionTotalJmd(financiallyEffectiveInvoiceVersion(invoice)),
          netPaidJmd: financial.paidJmd,
          balanceJmd: financial.balanceJmd,
          settlementStatus: financial.settlementStatus,
        };
      }),
    };
  }, "orders.list.read");
}

/**
 * Linked data answers only the history query. Canonical vehicle existence is
 * deliberately checked by the customer master route before this selector runs.
 */
export function getMockVehicleBusinessOrders(vehicleId: string): VehicleBusinessOrderRow[] {
  return getMockLinkedOperationsStore().read((state) => {
    const recordByBusinessOrderId = new Map(state.orderRecords.map((record) => [record.id, record]));
    return state.businessOrders
      .filter((businessOrder) => businessOrder.vehicleId === vehicleId)
      .map((businessOrder) => {
        const record = recordByBusinessOrderId.get(businessOrder.id);
        if (!record) throw new Error(`Business Order ${businessOrder.id} 缺少列表来源`);
        return {
          id: businessOrder.id,
          businessOrderNo: businessOrder.businessOrderNo,
          vehicleId: businessOrder.vehicleId,
          executionStatus: businessOrder.executionStatus,
          createdAt: record.createdAt,
          acceptedAt: record.acceptedAt ?? null,
          startMileage: businessOrder.startMileage,
        };
      })
      .sort((left, right) => (
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || right.businessOrderNo.localeCompare(left.businessOrderNo)
        || right.id.localeCompare(left.id)
      ));
  }, "vehicles.businessOrders.read");
}

export function getMockOrdersOperationsOverview(): OrdersOperationsOverview {
  return getMockLinkedOperationsStore().read((state) => {
    return buildOrdersOperationsOverview(
      state.operationsDocuments,
      state.operationsAssignments,
      ORDERS_OPERATIONS_BUSINESS_DATE,
    );
  }, "orders.overview.read");
}

function isTeamId(value: unknown): value is OrderTeamId {
  return value === "t1" || value === "t2" || value === "t3" || value === "t4";
}

export function getMockOrderReassignmentHistory(): OrderReassignmentAudit[] {
  return getMockLinkedOperationsStore().read((state) => state.reassignments, "orders.reassignmentHistory.read");
}

export function recordMockOrderReassignment(
  input: ReassignOrderInput,
  actor: { id: string; name: string },
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<OrderReassignmentAudit> {
  return store.mutate((state) => {
    const order = state.orderRecords.find(({ id }) => id === input.orderId);
    const businessOrder = state.businessOrders.find(({ id }) => id === input.orderId);
    const assignment = state.operationsAssignments.find((candidate) => (
      candidate.kind === "repair" && candidate.documentId === input.orderId
    ));
    if (!order) throw new LinkedApiDomainError("工单不存在", 404);
    if (!businessOrder || !assignment) throw new Error("工单改组来源不完整");
    if (!isTeamId(input.toTeamId)) throw new LinkedApiDomainError("新班组无效", 400);
    if (!input.reason.trim()) throw new LinkedApiDomainError("改组原因不能为空", 400);
    const status = deriveProcessingStatus(order);
    if (status === "submitted_awaiting_collection") {
      throw new LinkedApiDomainError("前台正式交单后不允许普通改组", 409);
    }
    const fromTeamId = businessOrder.executionTeamId;
    if (!fromTeamId) throw new Error("当前工单尚未派组");
    if (input.expectedFromTeamId !== fromTeamId) {
      throw new LinkedApiDomainError("工单原班组已变化，请重新打开后再改组", 409);
    }
    if (fromTeamId === input.toTeamId) throw new LinkedApiDomainError("新班组与当前班组相同", 400);
    const changedAt = new Date(store.nowMs()).toISOString();
    const audit: OrderReassignmentAudit = {
      id: `order-reassignment-${order.id}-${state.reassignments.length + 1}`,
      orderId: order.id,
      orderNo: order.orderNo,
      fromTeamId,
      toTeamId: input.toTeamId,
      reason: input.reason.trim(),
      actor: { id: actor.id, name: actor.name },
      changedAt,
    };
    const businessOrderIndex = state.businessOrders.indexOf(businessOrder);
    state.businessOrders[businessOrderIndex] = {
      ...businessOrder,
      executionTeamId: input.toTeamId,
      items: clone(businessOrder.items),
    };
    const assignmentIndex = state.operationsAssignments.indexOf(assignment);
    state.operationsAssignments[assignmentIndex] = {
      ...assignment,
      teamId: input.toTeamId,
      vehiclePool: vehiclePoolForTeam(input.toTeamId),
      assignedAt: changedAt,
      reassignmentHistory: [...assignment.reassignmentHistory, {
        fromTeamId,
        toTeamId: input.toTeamId,
        reason: input.reason.trim(),
        actor: { id: actor.id, name: actor.name },
        changedAt,
      }],
    };
    const orderIndex = state.orderRecords.indexOf(order);
    state.orderRecords[orderIndex] = {
      ...order,
      teamId: input.toTeamId,
      updatedAt: changedAt,
      updatedBy: actor.name,
    };
    state.reassignments.push(audit);
    state.revision += 1;
    return audit;
  }, { action: "orders.reassign.write" });
}

function assertExpectedRevision(state: LinkedOperationsState, expectedRevision: unknown): void {
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1) {
    throw new LinkedApiDomainError("expectedRevision 无效", 400);
  }
  if (expectedRevision !== state.revision) {
    throw new LinkedApiDomainError("数据已变化，请刷新后重试", 409);
  }
}

// TODO(backend)：正式交单 —— 绩效计入的唯一触发点，真实服务实现后替换 Mock。
export function submitMockOrderFormal(
  input: FormalSubmitOrderInput,
  actor: { id: string; name: string },
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<FormalSubmitOrderResult> {
  return store.mutate((state) => {
    assertExpectedRevision(state, input.expectedRevision);
    const order = state.businessOrders.find(({ id }) => id === input.orderId);
    if (!order) throw new LinkedApiDomainError("工单不存在", 404);
    const record = state.orderRecords.find(({ id }) => id === input.orderId);
    if (!record) throw new Error("工单缺少列表来源");
    if (order.formalSubmittedAt !== null) {
      throw new LinkedApiDomainError("工单已正式交单，请勿重复提交", 409);
    }
    if (deriveProcessingStatus(record) !== "returned_awaiting_frontdesk") {
      throw new LinkedApiDomainError("工单当前状态不允许正式交单", 409);
    }
    if (
      !Number.isSafeInteger(input.confirmedPerformanceValueJmd)
      || input.confirmedPerformanceValueJmd < 0
    ) {
      throw new LinkedApiDomainError("确认绩效值必须为非负整数", 400);
    }
    if (input.confirmedPerformanceValueJmd !== order.performanceValueJmd) {
      throw new LinkedApiDomainError("绩效值已变化或未核对，请重新核对后再交单", 409);
    }
    const at = new Date(store.nowMs()).toISOString();
    const audit: BusinessOrderPerformanceAudit = {
      id: `order-performance-${order.id}-${state.performanceAudits.length + 1}`,
      orderId: order.id,
      kind: "formal_submitted",
      actorId: actor.id,
      actorName: actor.name,
      previousValueJmd: order.performanceValueJmd,
      newValueJmd: order.performanceValueJmd,
      at,
    };
    state.businessOrders[state.businessOrders.indexOf(order)] = {
      ...order,
      formalSubmittedAt: at,
      formalSubmittedBy: actor.id,
      performanceCountedAt: at,
    };
    state.orderRecords[state.orderRecords.indexOf(record)] = {
      ...record,
      submittedAt: record.submittedAt ?? at,
      updatedAt: at,
      updatedBy: actor.name,
    };
    state.performanceAudits.push(audit);
    state.revision += 1;
    return {
      orderId: order.id,
      performanceValueJmd: order.performanceValueJmd,
      formalSubmittedAt: at,
      formalSubmittedBy: actor.id,
      performanceCountedAt: at,
      revision: state.revision,
      audit,
    };
  }, { action: "orders.formalSubmit.write" });
}

// TODO(backend)：手工调整整单绩效值 —— 仅交单前允许，只改绩效值并留审计。
export function updateMockOrderPerformanceValue(
  input: UpdateOrderPerformanceValueInput,
  actor: { id: string; name: string },
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<UpdateOrderPerformanceValueResult> {
  return store.mutate((state) => {
    assertExpectedRevision(state, input.expectedRevision);
    const order = state.businessOrders.find(({ id }) => id === input.orderId);
    if (!order) throw new LinkedApiDomainError("工单不存在", 404);
    if (order.formalSubmittedAt !== null) {
      throw new LinkedApiDomainError("工单已正式交单，绩效值已计入，不允许再调整", 409);
    }
    if (!Number.isSafeInteger(input.performanceValueJmd) || input.performanceValueJmd < 0) {
      throw new LinkedApiDomainError("绩效值必须为非负整数", 400);
    }
    if (!input.reason.trim()) throw new LinkedApiDomainError("调整原因不能为空", 400);
    const at = new Date(store.nowMs()).toISOString();
    const audit: BusinessOrderPerformanceAudit = {
      id: `order-performance-${order.id}-${state.performanceAudits.length + 1}`,
      orderId: order.id,
      kind: "performance_value_adjusted",
      actorId: actor.id,
      actorName: actor.name,
      previousValueJmd: order.performanceValueJmd,
      newValueJmd: input.performanceValueJmd,
      reason: input.reason.trim(),
      at,
    };
    state.businessOrders[state.businessOrders.indexOf(order)] = {
      ...order,
      performanceValueJmd: input.performanceValueJmd,
    };
    state.performanceAudits.push(audit);
    state.revision += 1;
    return {
      orderId: order.id,
      performanceValueJmd: input.performanceValueJmd,
      revision: state.revision,
      audit,
    };
  }, { action: "orders.performanceValue.write" });
}

// TODO(backend)：绩效页"已正式交单绩效值"月度汇总，真实服务实现后替换 Mock。
export function getMockOrdersPerformanceSummary(month: string): OrdersPerformanceSummaryResponse {
  if (!isPerformanceSummaryMonth(month)) {
    throw new LinkedApiDomainError("汇总月份格式无效", 400);
  }
  return getMockLinkedOperationsStore().read((state) => ({
    // 新 BO 口径（2026-08-17）：绩效计入只看快速工单；血统 BO 为历史数据不再展示
    ...summarizeQuickOrderPerformance(state.quickOrders, month),
    stateRevision: state.revision,
  }), "performance.ordersSummary.read");
}
