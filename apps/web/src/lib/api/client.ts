// ============================================================
// API Client — 统一请求层
// 后端就绪后，只需设 NEXT_PUBLIC_USE_MOCK=false + NEXT_PUBLIC_API_BASE_URL
// ============================================================

import { canonicalMockIdentitySnapshot, mockIdentities, mockSessionPreview } from "./mock-data";
import { getMockBusinessActor, isFormalIdentityConsistent } from "../auth/formal-pc-access";
import { fetchFormalDashboard } from "./formal-dashboard";
import { fetchFormalRevenue } from "./formal-revenue";
import { ensureMockCleanMoneyDemo } from "./mock-clean-demo";
import {
  getMockMemberDetail,
  getMockPerformanceStore,
  getMockTeamPerformanceDetail,
  previewMockSalaryChange,
  updateMockStandardSalary,
} from "./mock-performance";
import {
  getMockOrders,
  getMockOrderReassignmentHistory,
  getMockOrdersOperationsOverview,
  getMockOrdersPerformanceSummary,
  getMockVehicleBusinessOrders,
  isTask8ReservedChildMutationId,
  mockOrderQueryFromSearchParams,
  recordMockOrderReassignment,
  submitMockOrderFormal,
  updateMockOrderPerformanceValue,
  getMockLinkedOperationsStore,
  LinkedApiDomainError,
} from "./mock-orders";
import {
  createMockInspectionReportFromInput,
  createMockQuickOrderFromInspectionQuotation,
  generateMockInspectionReportFiles,
  getMockInspectionReportGeneratedFile,
  getMockInspectionReportDetail,
  getMockInspectionReports,
  getMockMechanicInspectionIntake,
  getMockVehicleInspectionReportPhotos,
  getMockVehicleInspectionReportArchive,
  resolveMockInspectionReportPhotoBlob,
  resolveMockMechanicInspectionPhotoBlob,
  resolveMockVehicleInspectionReportPhotoBlob,
  sendMockInspectionReportNotification,
  recordMockInspectionCustomerResponse,
  recordMockInspectionCommunication,
  updateMockQuotation,
  updateMockInspectionReportDraft,
  updateMockInspectionReportItems,
  updateMockInspectionReportPhotos,
  type CreateInspectionReportInput,
  type CreateQuickOrderFromInspectionQuotationInput,
  type GenerateInspectionReportFilesInput,
  type GenerateInspectionReportFilesResult,
  type GeneratedInspectionReportFileResult,
  type UpdateInspectionReportItemsInput,
  type UpdateInspectionReportPhotosInput,
  type UpdateInspectionReportPhotosResult,
  type InspectionReportDetailResponse,
  type InspectionReportListQuery,
  type InspectionReportListResponse,
  type MechanicInspectionIntakeResponse,
  type VehicleInspectionReportPhotoGroup,
  type VehicleInspectionReportArchiveGroup,
  type RecordCommunicationInput,
  type SendInspectionReportNotificationInput,
  type SendInspectionReportNotificationResult,
  type RecordInspectionCustomerResponseInput,
  type RecordInspectionCustomerResponseResult,
  type UpdateQuotationInput,
  type UpdateInspectionReportDraftInput,
} from "./mock-inspection-reports";
import type { IrPdfLanguage } from "../orders/ir-pdf";
import {
  IrFollowUpDomainError,
  readIrFollowUpSnapshot,
  runIrFollowUpAction,
  type IrFollowUpActionInput,
  type IrFollowUpSnapshot,
} from "./mock-ir-followup";
import {
  ParkingFollowUpDomainError,
  readParkingFollowUpSnapshot,
  recordParkingBillSent,
  recordParkingNotification,
  type ParkingFollowUpSnapshot,
} from "./mock-parking-followup";

type CustomerActionInput =
  | { type: "add_risk"; level: "attention" | "high" | "blacklist"; note: string }
  | { type: "remove_risk"; flagId: string }
  | { type: "grant_credit"; signatureNote: string; signatureDataUrl: string | null }
  | { type: "save_note"; noteId: string | null; content: string }
  | { type: "revoke_credit"; reason: string };

type ParkingFollowUpActionInput =
  | { type: "record_notification"; orderId: string; channel: "phone" | "whatsapp" | "sms" | "in_person"; note: string }
  | { type: "record_bill_sent"; orderId: string; note: string };
import {
  authorizeMockSpecialRelease,
  getMockBillingBusinessOrder,
  getMockBillingWorkspace,
  recordMockInvoiceLineRefund,
  recordMockInvoicePayment,
  signMockCreditInvoice,
  type AuthorizeSpecialReleaseInput,
  type BillingMutationActor,
  type BillingBusinessOrderResponse,
  type BillingWorkspaceResponse,
  type RecordInvoicePaymentInput,
  type RecordInvoiceLineRefundInput,
  type SignCreditInvoiceInput,
} from "./mock-billing";
import {
  createMockQuickOrder,
  applyMockQuickOrderAction,
  getMockQuickOrder,
  getMockQuickOrderLifecyclePreflight,
  getMockQuickOrderFinancialReadModel,
  getMockQuickOrderFinancialLedger,
  getMockQuickOrderFinancialStatement,
  listMockQuickOrderFinancialReadModels,
  listMockQuickOrders,
  recordMockQuickOrderLifecycleMutation,
  recordMockQuickInvoiceSignature,
  recordMockQuickPickup,
  recordMockQuickPayment,
  recordMockQuickRefund,
  attachMockQuickRefundEvidence,
  recordMockQuickRefundSignature,
  updateMockQuickOrder,
  updateMockQuickOrderNotes,
  updateMockSharedQuickOrderCharges,
  type RecordQuickInvoiceSignatureInput,
  type RecordQuickRefundInput,
  type RecordQuickRefundEvidenceInput,
  type RecordQuickRefundSignatureInput,
  type CreateQuickOrderInput,
  type QuickOrderAction,
  type QuickOrderLifecycleActor,
  type RecordQuickPickupInput,
  type RecordQuickPickupResult,
  type SharedQuickOrderMutationActor,
  type UpdateQuickOrderInput,
  type UpdateQuickOrderNotesInput,
  type UpdateSharedQuickOrderChargesInput,
} from "./mock-quick-orders";
import type { QuickOrder, QuickPayment } from "../orders/quick-order-types";
import {
  assertQuickOrderFinancialListResponse,
  assertQuickOrderFinancialReadModel,
  type QuickOrderFinancialListResponse,
  type QuickOrderFinancialReadModel,
} from "../billing/quick-order-financial";
import {
  assertQuickOrderFinancialStatement,
  type QuickOrderFinancialStatement,
} from "../billing/quick-order-financial-statement";
import {
  assertQuickOrderFinancialLedgerResponse,
  type QuickOrderFinancialLedgerResponse,
} from "../billing/quick-order-financial-ledger";
import {
  assertQuickOrderLifecyclePreflight,
  assertQuickOrderLifecycleMutationInput,
  assertQuickOrderLifecycleMutationResult,
  type QuickOrderLifecycleKind,
  type QuickOrderLifecycleMutationInput,
  type QuickOrderLifecyclePreflight,
  type QuickOrderLifecycleMutationResult,
} from "../billing/quick-order-lifecycle";
import {
  assertQuickOrderInvoiceLineRefundInput,
  assertQuickOrderInvoiceLineRefundResult,
  assertQuickOrderInvoicePaymentInput,
  assertQuickOrderInvoicePaymentResult,
  type QuickOrderInvoiceLineRefundInput,
  type QuickOrderInvoiceLineRefundResult,
  type QuickOrderInvoicePaymentInput,
  type QuickOrderInvoicePaymentResult,
} from "../billing/quick-order-money-actions";
import {
  applyMockParkingWaiver,
  collectMockCanonicalParkingPayment,
  getMockCanonicalParkingList,
  previewMockParkingWaiver,
  recordMockParkingSourcePickup,
  type ApplyModernParkingCorrectionInput,
  type ApplyModernParkingCorrectionResult,
  type CanonicalParkingListResponse,
  type CollectCanonicalParkingPaymentInput,
  type CollectCanonicalParkingPaymentResult,
  type ModernParkingCorrectionPreviewDto,
  type PreviewModernParkingCorrectionInput,
  type RecordModernParkingSourcePickupInput,
  type RecordModernParkingSourcePickupResult,
} from "./mock-parking";
import type { InvoiceCustomerAcknowledgement } from "../billing/types";
export type { CanonicalParkingListResponse } from "./mock-parking";
import type { LinkedCommunicationFact, LinkedOperationsState, LinkedSpecialReleaseAuthorization } from "./mock-orders";
import type { InvoicePaymentFact } from "../billing/types";
import { CustomerVehicleValidationError, getMockCustomerVehicleStore } from "./mock-customers";
import { normalizeDriverLicenseProfile } from "../customers/driver-license-profile";
import {
  adaptFormalCompany,
  adaptFormalCustomerVehicleWorkspace,
  adaptFormalPerson,
  adaptFormalVehicle,
  type FormalCustomerVehicleWorkspace,
} from "../customers/formal-customer-vehicle-adapter";
import {
  formalVehicleIsActive,
  parseFormalOptionalInteger,
} from "../customers/formal-vehicle-write";
import type { DashboardSummary, Identity, Session } from "../types";
import type {
  CustomerAuditEvent,
  CustomerAgreementSigningPreview,
  CustomerDraftInput,
  CustomerNamePreview,
  CustomerRecord,
  CustomerSavePreview,
  CustomerVehicleAccessContext,
  CustomerVehicleWorkspaceResponse,
  InvalidateCustomerOtpInput,
  NormalizedCustomerInput,
  PreviewCustomerUpdateInput,
  PreviewVehicleUpdateInput,
  PrepareCustomerAgreementSigningInput,
  RequestCustomerOtpInput,
  SaveVehicleInput,
  SignCustomerAgreementInput,
  SubmitCustomerKycInput,
  UpdateCustomerInput,
  UpdateVehicleInput,
  VehicleDraftInput,
  VehicleRecord,
  VehicleSavePreview,
  VerifyCustomerKycInput,
  VerifyCustomerOtpInput,
} from "../customers/types";
import type {
  ClearOnboardingKycInput,
  ClearOnboardingKycResult,
  CloseOnboardingResult,
  CreateOnboardingCustomerInput,
  OnboardingCustomerPreviewResult,
  OnboardingKycConfirmation,
  OnboardingKycSubmission,
  OnboardingOtpChallenge,
  OnboardingOtpVerification,
  OnboardingPhonePreviewResult,
  PreviewOnboardingCustomerInput,
  PreviewOnboardingPhoneInput,
  RequestOnboardingOtpInput,
  SubmitOnboardingKycInput,
  VerifyOnboardingKycInput,
  VerifyOnboardingOtpInput,
} from "../customers/onboarding-types";
import type { RevenueDetailResponse, RevenueRange } from "../revenue/types";
import type {
  OrderListQuery,
  OrderListResponse,
  OrderReassignmentAudit,
  ReassignOrderInput,
} from "../orders/types";
import type { OrdersOperationsOverview } from "../orders/operations-overview";
import type {
  FormalSubmitOrderInput,
  FormalSubmitOrderResult,
  OrdersPerformanceSummaryResponse,
  UpdateOrderPerformanceValueInput,
  UpdateOrderPerformanceValueResult,
  VehicleBusinessOrderRow,
} from "../orders/business-order-types";
import type {
  PerformanceAccessContext,
  PerformancePermissions,
  PerformanceMemberDetail,
  PerformanceRuleVersion,
  RuleDraftInput,
  RuleImpactPreview,
  RuleWorkspaceResponse,
  SalaryChangePreview,
  SaveRuleDraftInput,
  SaveStandardSalaryInput,
  TeamPerformanceDetailResponse,
  UpdateStandardSalaryInput,
  UpdateStandardSalaryResult,
} from "../performance/types";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";
const USE_FORMAL_CUSTOMER_VEHICLE = process.env.NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE === "true";
export const isMockApiEnabled = USE_MOCK;
export const isFormalCustomerVehicleApiEnabled = USE_FORMAL_CUSTOMER_VEHICLE;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const CUSTOMER_AUDIT_DATA_URL = /(?:^|[^A-Za-z0-9])data\s*:/i;

/** 模拟网络延迟 */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string, public readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

const ONBOARDING_OPAQUE_SEGMENT = /^u(?:[0-9a-f]{4})*$/;
const ONBOARDING_RAW_TOKEN_ROUTE = /^\/api\/customers\/onboarding\/u(?:[0-9a-f]{4})*(?:\/(?:otp\/(?:request|verify)|kyc\/(?:submit|verify|clear)|preview|create))?$/;
const QUICK_ORDER_FINANCIAL_LIST_PATH = "/api/quick-order-financials";
const QUICK_ORDER_FINANCIAL_LEDGER_PATH = `${QUICK_ORDER_FINANCIAL_LIST_PATH}/ledger`;
const QUICK_ORDER_FINANCIAL_DETAIL_PREFIX = `${QUICK_ORDER_FINANCIAL_LIST_PATH}/`;
const QUICK_ORDER_FINANCIAL_OPAQUE_SEGMENT = /^u(?:[0-9a-f]{4})+$/;
const QUICK_ORDER_FINANCIAL_RAW_DETAIL_ROUTE = /^\/api\/quick-order-financials\/(u(?:[0-9a-f]{4})+)$/;
const QUICK_ORDER_LIFECYCLE_RAW_ROUTE = /^\/api\/quick-order-financials\/(u(?:[0-9a-f]{4})+)\/lifecycle$/;
const QUICK_ORDER_FINANCIAL_STATEMENT_RAW_ROUTE = /^\/api\/quick-order-financials\/(u(?:[0-9a-f]{4})+)\/statement$/;
const QUICK_ORDER_FINANCIAL_PAYMENT_RAW_ROUTE = /^\/api\/quick-order-financials\/(u(?:[0-9a-f]{4})+)\/payments$/;
const QUICK_ORDER_FINANCIAL_REFUND_RAW_ROUTE = /^\/api\/quick-order-financials\/(u(?:[0-9a-f]{4})+)\/refunds$/;

function encodeOpaqueUtf16Segment(value: string): string {
  let segment = "u";
  for (let index = 0; index < value.length; index += 1) {
    segment += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return segment;
}

function decodeOpaqueUtf16Segment(segment: string): string {
  let value = "";
  for (let index = 1; index < segment.length; index += 4) {
    value += String.fromCharCode(Number.parseInt(segment.slice(index, index + 4), 16));
  }
  return value;
}

function encodeOnboardingTokenSegment(token: string): string {
  return encodeOpaqueUtf16Segment(typeof token === "string" ? token : "");
}

function decodeOnboardingTokenSegment(segment: string): string {
  if (!ONBOARDING_OPAQUE_SEGMENT.test(segment)) {
    throw new ApiError("客户建档会话凭证无效", 400, "CUSTOMER_ONBOARDING_TOKEN_INVALID");
  }
  return decodeOpaqueUtf16Segment(segment);
}

function invalidQuickOrderFinancialOrderId(): ApiError {
  return new ApiError(
    "QuickOrder financial order id is invalid",
    400,
    "QUICK_ORDER_FINANCIAL_ORDER_ID_INVALID",
  );
}

function encodeQuickOrderFinancialIdSegment(orderId: string): string {
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw invalidQuickOrderFinancialOrderId();
  }
  return encodeOpaqueUtf16Segment(orderId);
}

function decodeQuickOrderFinancialIdSegment(segment: string): string {
  if (!QUICK_ORDER_FINANCIAL_OPAQUE_SEGMENT.test(segment)) {
    throw invalidQuickOrderFinancialOrderId();
  }
  return decodeOpaqueUtf16Segment(segment);
}

function rawPathnameBeforeUrlNormalization(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end = [queryIndex, hashIndex].filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), path.length);
  return path.slice(0, end);
}

function isRawOnboardingCandidate(pathname: string): boolean {
  const candidatePathname = pathname.replaceAll("\\", "/");
  return candidatePathname === "/api/customers/onboarding"
    || candidatePathname.startsWith("/api/customers/onboarding/");
}

function isValidRawOnboardingRoute(pathname: string): boolean {
  return pathname === "/api/customers/onboarding/phone-preview"
    || ONBOARDING_RAW_TOKEN_ROUTE.test(pathname);
}

function normalizeCustomerRecordProfiles(value: unknown): unknown {
  if (!isObjectBody(value) || !isObjectBody(value.verificationArchive)
    || !Array.isArray(value.verificationArchive.kycRecords)) return value;
  return {
    ...value,
    verificationArchive: {
      ...value.verificationArchive,
      kycRecords: value.verificationArchive.kycRecords.map((record) => {
        if (!isObjectBody(record) || record.subjectType !== "organization_primary_contact") return record;
        return { ...record, subjectProfile: normalizeDriverLicenseProfile(record.subjectProfile) };
      }),
    },
  };
}

function normalizeCustomerApiResponse<T>(path: string, value: T): T {
  if (/\/api\/customers\/onboarding\/[^/]+\/kyc\/verify(?:[?#]|$)/.test(path)
    && isObjectBody(value) && Object.prototype.hasOwnProperty.call(value, "profile")) {
    return { ...value, profile: normalizeDriverLicenseProfile(value.profile) } as T;
  }
  if (isObjectBody(value) && Array.isArray(value.customers)) {
    return { ...value, customers: value.customers.map(normalizeCustomerRecordProfiles) } as T;
  }
  return normalizeCustomerRecordProfiles(value) as T;
}

function isQuickOrderFinancialApiPath(path: string): boolean {
  const rawPathname = rawPathnameBeforeUrlNormalization(path);
  return rawPathname === QUICK_ORDER_FINANCIAL_LIST_PATH
    || rawPathname === QUICK_ORDER_FINANCIAL_LEDGER_PATH
    || QUICK_ORDER_FINANCIAL_RAW_DETAIL_ROUTE.test(rawPathname)
    || QUICK_ORDER_LIFECYCLE_RAW_ROUTE.test(rawPathname)
    || QUICK_ORDER_FINANCIAL_STATEMENT_RAW_ROUTE.test(rawPathname)
    || QUICK_ORDER_FINANCIAL_PAYMENT_RAW_ROUTE.test(rawPathname)
    || QUICK_ORDER_FINANCIAL_REFUND_RAW_ROUTE.test(rawPathname);
}

function invalidQuickOrderFinancialResponse(): ApiError {
  return new ApiError(
    "QuickOrder financial response is invalid",
    502,
    "QUICK_ORDER_FINANCIAL_RESPONSE_INVALID",
  );
}

function invalidQuickOrderLifecycleResponse(): ApiError {
  return new ApiError(
    "QuickOrder lifecycle response is invalid",
    502,
    "QUICK_ORDER_LIFECYCLE_RESPONSE_INVALID",
  );
}

function invalidQuickOrderLifecyclePreflightResponse(): ApiError {
  return new ApiError(
    "QuickOrder lifecycle preflight response is invalid",
    502,
    "QUICK_ORDER_LIFECYCLE_PREFLIGHT_RESPONSE_INVALID",
  );
}

function invalidQuickOrderFinancialStatementResponse(): ApiError {
  return new ApiError(
    "QuickOrder financial statement response is invalid",
    502,
    "QUICK_ORDER_FINANCIAL_STATEMENT_RESPONSE_INVALID",
  );
}

function lifecycleRequestInput(options?: RequestInit): QuickOrderLifecycleMutationInput {
  try {
    if (typeof options?.body !== "string") throw new TypeError("lifecycle body is missing");
    const value: unknown = JSON.parse(options.body);
    assertQuickOrderLifecycleMutationInput(value);
    return value;
  } catch {
    throw invalidQuickOrderLifecycleResponse();
  }
}

function validateQuickOrderFinancialApiResponse<T>(path: string, value: T, options?: RequestInit): T {
  const rawPathname = rawPathnameBeforeUrlNormalization(path);
  const detailMatch = rawPathname.match(QUICK_ORDER_FINANCIAL_RAW_DETAIL_ROUTE);
  const lifecycleMatch = rawPathname.match(QUICK_ORDER_LIFECYCLE_RAW_ROUTE);
  const statementMatch = rawPathname.match(QUICK_ORDER_FINANCIAL_STATEMENT_RAW_ROUTE);
  const paymentMatch = rawPathname.match(QUICK_ORDER_FINANCIAL_PAYMENT_RAW_ROUTE);
  const refundMatch = rawPathname.match(QUICK_ORDER_FINANCIAL_REFUND_RAW_ROUTE);
  if (rawPathname !== QUICK_ORDER_FINANCIAL_LIST_PATH
    && rawPathname !== QUICK_ORDER_FINANCIAL_LEDGER_PATH
    && detailMatch === null
    && lifecycleMatch === null
    && statementMatch === null
    && paymentMatch === null
    && refundMatch === null) return value;
  try {
    if (paymentMatch !== null) {
      assertQuickOrderInvoicePaymentResult(value);
      const input = JSON.parse(String(options?.body)) as unknown;
      assertQuickOrderInvoicePaymentInput(input);
      if (value.orderId !== input.orderId
        || value.invoiceId !== input.invoiceId
        || value.invoiceVersionId !== input.invoiceVersionId
        || value.revision !== input.expectedRevision + 1
        || value.orderId !== decodeQuickOrderFinancialIdSegment(paymentMatch[1])) {
        throw new TypeError("QuickOrder Invoice payment response coordinates are inconsistent");
      }
    } else if (refundMatch !== null) {
      assertQuickOrderInvoiceLineRefundResult(value);
      const input = JSON.parse(String(options?.body)) as unknown;
      assertQuickOrderInvoiceLineRefundInput(input);
      if (value.orderId !== input.orderId
        || value.invoiceId !== input.invoiceId
        || value.invoiceVersionId !== input.invoiceVersionId
        || value.refund.chargeLineId !== input.chargeLineId
        || value.revision !== input.expectedRevision + 1
        || value.orderId !== decodeQuickOrderFinancialIdSegment(refundMatch[1])) {
        throw new TypeError("QuickOrder Invoice refund response coordinates are inconsistent");
      }
    } else if (statementMatch !== null) {
      assertQuickOrderFinancialStatement(value);
      if (value.order.id !== decodeQuickOrderFinancialIdSegment(statementMatch[1])) {
        throw new TypeError("QuickOrder financial statement identity is inconsistent");
      }
    } else if (lifecycleMatch !== null) {
      const pathOrderId = decodeQuickOrderFinancialIdSegment(lifecycleMatch[1]);
      if ((options?.method ?? "GET") === "POST") {
        const input = lifecycleRequestInput(options);
        assertQuickOrderLifecycleMutationResult(value);
        if (pathOrderId !== input.orderId
          || value.orderId !== input.orderId
          || value.kind !== input.kind
          || value.revision !== input.expectedRevision + 1) {
          throw new TypeError("QuickOrder lifecycle response coordinates are inconsistent");
        }
      } else {
        assertQuickOrderLifecyclePreflight(value);
        if (value.orderId !== pathOrderId) {
          throw new TypeError("QuickOrder lifecycle preflight identity is inconsistent");
        }
      }
    } else if (rawPathname === QUICK_ORDER_FINANCIAL_LEDGER_PATH) {
      assertQuickOrderFinancialLedgerResponse(value);
    } else if (detailMatch === null) {
      assertQuickOrderFinancialListResponse(value);
    } else {
      assertQuickOrderFinancialReadModel(value);
      if (value.order.id !== decodeQuickOrderFinancialIdSegment(detailMatch[1])) {
        throw new TypeError("QuickOrder financial detail identity is inconsistent");
      }
    }
    return value;
  } catch {
    if (statementMatch !== null) throw invalidQuickOrderFinancialStatementResponse();
    if (paymentMatch !== null || refundMatch !== null) throw invalidQuickOrderFinancialResponse();
    if (lifecycleMatch !== null) {
      if ((options?.method ?? "GET") === "POST") throw invalidQuickOrderLifecycleResponse();
      throw invalidQuickOrderLifecyclePreflightResponse();
    }
    throw invalidQuickOrderFinancialResponse();
  }
}

function normalizeApiResponse<T>(path: string, value: T, options?: RequestInit): T {
  if (isQuickOrderFinancialApiPath(path)) {
    return validateQuickOrderFinancialApiResponse(path, value, options);
  }
  return normalizeCustomerApiResponse(path, value);
}

/** 统一请求函数 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && path === "/api/customer-vehicles"
    && (options?.method ?? "GET") === "GET"
  ) {
    const response = await fetch("/api/formal/customer-vehicles", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: unknown } | null;
      const message = typeof payload?.error === "string"
        ? payload.error
        : `正式客户与车辆档案读取失败：${response.status}`;
      throw new ApiError(message, response.status);
    }
    const formalWorkspace = await response.json() as FormalCustomerVehicleWorkspace;
    return adaptFormalCustomerVehicleWorkspace(formalWorkspace) as T;
  }

  const formalCustomerDetailMatch = path.match(/^\/api\/customers\/([^/]+)$/);
  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && formalCustomerDetailMatch
    && (options?.method ?? "GET") === "GET"
  ) {
    const customerNo = decodeURIComponent(formalCustomerDetailMatch[1]);
    const response = await fetch(`/api/formal/customers/${encodeURIComponent(customerNo)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      kind?: "person" | "company";
      record?: Parameters<typeof adaptFormalPerson>[0] | Parameters<typeof adaptFormalCompany>[0];
    } | null;
    if (!response.ok || !payload?.kind || !payload.record) {
      throw new ApiError(
        typeof payload?.error === "string" ? payload.error : "客户档案不存在",
        response.status,
      );
    }
    return (payload.kind === "person"
      ? adaptFormalPerson(payload.record as Parameters<typeof adaptFormalPerson>[0])
      : adaptFormalCompany(payload.record as Parameters<typeof adaptFormalCompany>[0])) as T;
  }

  const formalCustomerPreviewMatch = path.match(/^\/api\/customers\/([^/]+)\/preview$/);
  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && formalCustomerPreviewMatch
    && options?.method === "POST"
  ) {
    const source = typeof options.body === "string"
      ? JSON.parse(options.body) as PreviewCustomerUpdateInput
      : null;
    if (!source) throw new ApiError("客户正式保存资料缺失", 400);
    return {
      input: {
        ...source,
        organizationName: source.organizationName?.trim() || null,
        nameSourceValue: source.nameSourceValue?.trim() || null,
        primaryPhone: source.primaryPhone?.trim() || null,
        whatsapp: source.whatsapp?.trim() || null,
        email: source.email?.trim() || null,
        address: source.address?.trim() || null,
        trn: source.trn?.trim() || null,
      },
      candidates: [],
      sourceRevision: source.expectedRevision,
      previewToken: `formal-${crypto.randomUUID()}`,
    } as T;
  }

  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && formalCustomerDetailMatch
    && options?.method === "PATCH"
  ) {
    const customer = typeof options.body === "string"
      ? JSON.parse(options.body) as UpdateCustomerInput
      : null;
    if (!customer) throw new ApiError("客户正式保存资料缺失", 400);
    const customerNo = decodeURIComponent(formalCustomerDetailMatch[1]);
    const response = await fetch(`/api/formal/customers/${encodeURIComponent(customerNo)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerType: customer.customerType,
        fullName: customer.nameSourceValue,
        organizationName: customer.organizationName,
        phone: customer.primaryPhone,
        whatsapp: customer.whatsapp,
        email: customer.email,
        address: customer.address,
        trn: customer.trn,
        isActive: customer.status !== "inactive",
        version: customer.expectedRevision,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      kind?: "person" | "company";
      record?: Parameters<typeof adaptFormalPerson>[0] | Parameters<typeof adaptFormalCompany>[0];
    } | null;
    if (!response.ok || !payload?.kind || !payload.record) {
      throw new ApiError(
        typeof payload?.error === "string" ? payload.error : "客户档案保存失败",
        response.status,
      );
    }
    return (payload.kind === "person"
      ? adaptFormalPerson(payload.record as Parameters<typeof adaptFormalPerson>[0])
      : adaptFormalCompany(payload.record as Parameters<typeof adaptFormalCompany>[0])) as T;
  }

  const formalVehicleDetailMatch = path.match(/^\/api\/vehicles\/([^/]+)$/);
  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && formalVehicleDetailMatch
    && (options?.method ?? "GET") === "GET"
  ) {
    const vehicleNo = decodeURIComponent(formalVehicleDetailMatch[1]);
    const response = await fetch(`/api/formal/vehicles/${encodeURIComponent(vehicleNo)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      record?: Parameters<typeof adaptFormalVehicle>[0];
    } | null;
    if (!response.ok || !payload?.record) {
      throw new ApiError(
        typeof payload?.error === "string" ? payload.error : "车辆档案不存在",
        response.status,
      );
    }
    return adaptFormalVehicle(payload.record) as T;
  }

  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && /\/api\/customers\/onboarding\/[^/]+\/create$/.test(path)
    && options?.method === "POST"
  ) {
    const source = typeof options.body === "string"
      ? JSON.parse(options.body) as { customer?: NormalizedCustomerInput }
      : {};
    if (!source.customer) throw new ApiError("客户正式保存资料缺失", 400);
    const customer = source.customer;
    const response = await fetch("/api/formal/customers", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerType: customer.customerType,
        fullName: customer.nameSourceValue,
        organizationName: customer.organizationName,
        phone: customer.primaryPhone,
        whatsapp: customer.whatsapp,
        email: customer.email,
        address: customer.address,
        trn: customer.trn,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      kind?: "person" | "company";
      record?: Parameters<typeof adaptFormalPerson>[0] | Parameters<typeof adaptFormalCompany>[0];
    } | null;
    if (!response.ok || !payload?.kind || !payload.record) {
      throw new ApiError(
        typeof payload?.error === "string" ? payload.error : "客户档案保存失败",
        response.status,
      );
    }
    return (payload.kind === "person"
      ? adaptFormalPerson(payload.record as Parameters<typeof adaptFormalPerson>[0])
      : adaptFormalCompany(payload.record as Parameters<typeof adaptFormalCompany>[0])) as T;
  }

  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && (path === "/api/vehicles/preview" || /^\/api\/vehicles\/[^/]+\/preview$/.test(path))
    && options?.method === "POST"
  ) {
    const source = typeof options.body === "string"
      ? JSON.parse(options.body) as VehicleDraftInput & { expectedRevision?: number }
      : {};
    const input = {
      ...source,
      plate: source.plate?.trim() || null,
      vin: source.vin?.trim().toUpperCase() || null,
      engineNumber: source.engineNumber?.trim().toUpperCase() || null,
      make: source.make?.trim() || null,
      makeZh: source.makeZh?.trim() || null,
      model: source.model?.trim() || null,
      modelZh: source.modelZh?.trim() || null,
      variant: null,
      color: source.color?.trim() || null,
      powertrain: null,
      bodyType: source.bodyType?.trim() || null,
      fuelType: source.fuelType?.trim() || null,
      usage: source.usage?.trim() || null,
      specialNotes: source.specialNotes?.trim() || null,
    } as VehicleSavePreview["input"];
    return {
      input,
      existingVehicleId: null,
      canSave: Boolean(
        input.make
        && input.model
        && (input.year == null || (Number.isInteger(input.year) && input.year >= 1886))
        && input.relationships?.some((item) => item.endedAt === null),
      ),
      sourceRevision: source.expectedRevision ?? 0,
      previewToken: `formal-${crypto.randomUUID()}`,
    } as T;
  }

  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && path === "/api/vehicles"
    && options?.method === "POST"
  ) {
    const vehicle = typeof options.body === "string"
      ? JSON.parse(options.body) as SaveVehicleInput
      : null;
    const currentOwner = vehicle?.relationships?.find((relationship) => relationship.endedAt === null);
    if (!vehicle || !currentOwner) throw new ApiError("车辆必须选择当前客户", 400);
    const response = await fetch("/api/formal/vehicles", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plate: vehicle.plate,
        vin: vehicle.vin,
        engineNumber: vehicle.engineNumber,
        make: vehicle.make,
        makeZh: vehicle.makeZh,
        model: vehicle.model,
        modelZh: vehicle.modelZh,
        modelYear: vehicle.year,
        color: vehicle.color,
        bodyType: vehicle.bodyType,
        fuelType: vehicle.fuelType,
        engineCc: parseFormalOptionalInteger(vehicle.ccRating, "排量 CC", 1, 30_000),
        seating: parseFormalOptionalInteger(vehicle.seating, "座位数", 1, 200),
        usage: vehicle.usage,
        specialNotes: vehicle.specialNotes,
        ownerCustomerNo: currentOwner.customerId,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      record?: Parameters<typeof adaptFormalVehicle>[0];
    } | null;
    if (!response.ok || !payload?.record) {
      throw new ApiError(
        typeof payload?.error === "string" ? payload.error : "车辆档案保存失败",
        response.status,
      );
    }
    return adaptFormalVehicle(payload.record) as T;
  }

  const formalVehicleUpdateMatch = path.match(/^\/api\/vehicles\/([^/]+)$/);
  if (
    USE_FORMAL_CUSTOMER_VEHICLE
    && formalVehicleUpdateMatch
    && options?.method === "PATCH"
  ) {
    const vehicle = typeof options.body === "string"
      ? JSON.parse(options.body) as UpdateVehicleInput & { id?: string }
      : null;
    if (!vehicle) throw new ApiError("车辆正式保存资料缺失", 400);
    const currentOwner = vehicle.relationships?.find((relationship) => relationship.endedAt === null);
    const vehicleNo = decodeURIComponent(formalVehicleUpdateMatch[1]);
    const response = await fetch(`/api/formal/vehicles/${encodeURIComponent(vehicleNo)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plate: vehicle.plate,
        vin: vehicle.vin,
        engineNumber: vehicle.engineNumber,
        make: vehicle.make,
        makeZh: vehicle.makeZh,
        model: vehicle.model,
        modelZh: vehicle.modelZh,
        modelYear: vehicle.year,
        color: vehicle.color,
        bodyType: vehicle.bodyType,
        fuelType: vehicle.fuelType,
        engineCc: parseFormalOptionalInteger(vehicle.ccRating, "排量 CC", 1, 30_000),
        seating: parseFormalOptionalInteger(vehicle.seating, "座位数", 1, 200),
        usage: vehicle.usage,
        specialNotes: vehicle.specialNotes,
        ownerCustomerNo: currentOwner?.customerId,
        ownerChangeReason: "修改车辆当前客户",
        isActive: formalVehicleIsActive(vehicle.formalIsActive),
        version: vehicle.expectedRevision,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      record?: Parameters<typeof adaptFormalVehicle>[0];
    } | null;
    if (!response.ok || !payload?.record) {
      throw new ApiError(
        typeof payload?.error === "string" ? payload.error : "车辆档案保存失败",
        response.status,
      );
    }
    return adaptFormalVehicle(payload.record) as T;
  }

  // Mock 模式
  if (USE_MOCK) {
    return normalizeApiResponse(path, await mockRequest<T>(path, options), options);
  }

  // 真实 API
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let message = `API ${path} failed: ${res.status}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const payload: unknown = await res.json();
      if (typeof payload === "object" && payload !== null) {
        const reason = (payload as { error?: unknown; message?: unknown }).error
          ?? (payload as { message?: unknown }).message;
        if (typeof reason === "string" && reason.trim()) message = reason;
        const candidateCode = (payload as { code?: unknown }).code;
        if (typeof candidateCode === "string" && candidateCode.trim()) code = candidateCode;
        if (Object.prototype.hasOwnProperty.call(payload, "details")) details = (payload as { details?: unknown }).details;
      }
    } catch {
      // Preserve the transport status message when the body is not JSON.
    }
    throw new ApiError(message, res.status, code, details);
  }

  let responseValue: T;
  try {
    responseValue = await res.json() as T;
  } catch (error) {
    if (QUICK_ORDER_FINANCIAL_STATEMENT_RAW_ROUTE.test(rawPathnameBeforeUrlNormalization(path))) {
      throw invalidQuickOrderFinancialStatementResponse();
    }
    if (QUICK_ORDER_LIFECYCLE_RAW_ROUTE.test(rawPathnameBeforeUrlNormalization(path))) {
      if ((options?.method ?? "GET") !== "POST") {
        throw invalidQuickOrderLifecyclePreflightResponse();
      }
      throw invalidQuickOrderLifecycleResponse();
    }
    if (isQuickOrderFinancialApiPath(path)) throw invalidQuickOrderFinancialResponse();
    throw error;
  }
  return normalizeApiResponse(path, responseValue, options);
}

async function requestBlob(path: string): Promise<Blob> {
  if (USE_MOCK) return mockRequest<Blob>(path);
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new ApiError(`API ${path} failed: ${res.status}`, res.status);
  return res.blob();
}

/** Mock 路由分发 */
async function mockRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const rawPathname = rawPathnameBeforeUrlNormalization(path);
  const rawOnboardingCandidate = isRawOnboardingCandidate(rawPathname);
  if (rawOnboardingCandidate && !isValidRawOnboardingRoute(rawPathname)) {
    throw new ApiError("客户建档会话凭证无效", 400, "CUSTOMER_ONBOARDING_TOKEN_INVALID");
  }
  const method = options?.method || "GET";
  const slashNormalizedFinancialPathname = rawPathname.replaceAll("\\", "/");
  const rawQuickOrderFinancialCandidate = (
    slashNormalizedFinancialPathname === QUICK_ORDER_FINANCIAL_LIST_PATH
    || slashNormalizedFinancialPathname.startsWith(QUICK_ORDER_FINANCIAL_DETAIL_PREFIX)
  );
  if (
    rawQuickOrderFinancialCandidate
    && !(
      (method === "GET" && (
        rawPathname === QUICK_ORDER_FINANCIAL_LIST_PATH
        || rawPathname === QUICK_ORDER_FINANCIAL_LEDGER_PATH
        || QUICK_ORDER_FINANCIAL_RAW_DETAIL_ROUTE.test(rawPathname)
        || QUICK_ORDER_LIFECYCLE_RAW_ROUTE.test(rawPathname)
        || QUICK_ORDER_FINANCIAL_STATEMENT_RAW_ROUTE.test(rawPathname)
      ))
      || (method === "POST" && (
        QUICK_ORDER_LIFECYCLE_RAW_ROUTE.test(rawPathname)
        || QUICK_ORDER_FINANCIAL_PAYMENT_RAW_ROUTE.test(rawPathname)
        || QUICK_ORDER_FINANCIAL_REFUND_RAW_ROUTE.test(rawPathname)
      ))
    )
  ) {
    throw invalidQuickOrderFinancialOrderId();
  }
  const url = new URL(path, "http://mock");
  const { pathname, searchParams } = url;
  const retiredCanonicalParkingRoute = pathname === "/api/parking/canonical"
    || /^\/api\/parking\/canonical\/[^/]+\/payments$/.test(pathname);
  const retiredLegacyParkingRoute = (
    method === "GET" && /^\/api\/parking\/[^/]+\/invoice$/.test(pathname)
  ) || (
    method === "POST" && /^\/api\/parking\/[^/]+\/pickup$/.test(pathname)
  );
  if (retiredCanonicalParkingRoute || retiredLegacyParkingRoute) {
    throw new ApiError("旧停车 API 已退休；请使用 /api/parking canonical contract", 410);
  }
  const onboardingOtpRequestMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/otp\/request$/);
  const onboardingOtpVerifyMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/otp\/verify$/);
  const onboardingKycSubmitMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/kyc\/submit$/);
  const onboardingKycVerifyMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/kyc\/verify$/);
  const onboardingKycClearMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/kyc\/clear$/);
  const onboardingPreviewMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/preview$/);
  const onboardingCreateMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)\/create$/);
  const onboardingCloseMatch = pathname.match(/^\/api\/customers\/onboarding\/(u(?:[0-9a-f]{4})*)$/);
  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  const vehicleMatch = pathname.match(/^\/api\/vehicles\/([^/]+)$/);
  const vehicleBusinessOrdersMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/business-orders$/);
  const vehicleInspectionPhotosMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/inspection-report-photos$/);
  const vehicleInspectionArchiveMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/inspection-report-archive$/);
  const vehicleInspectionPhotoBlobMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/inspection-report-photos\/([^/]+)\/([^/]+)\/blob$/);
  const inspectionPhotoBlobMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/photos\/([^/]+)\/blob$/);
  const customerPreviewUpdateMatch = pathname.match(/^\/api\/customers\/([^/]+)\/preview$/);
  const vehiclePreviewUpdateMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/preview$/);
  const customerActionMatch = pathname.match(/^\/api\/customers\/([^/]+)\/actions$/);
  const customerOtpRequestMatch = pathname.match(/^\/api\/customers\/([^/]+)\/otp\/request$/);
  const customerOtpVerifyMatch = pathname.match(/^\/api\/customers\/([^/]+)\/otp\/verify$/);
  const customerOtpInvalidateMatch = pathname.match(/^\/api\/customers\/([^/]+)\/otp\/invalidate$/);
  const customerKycSubmitMatch = pathname.match(/^\/api\/customers\/([^/]+)\/kyc\/submit$/);
  const customerKycVerifyMatch = pathname.match(/^\/api\/customers\/([^/]+)\/kyc\/verify$/);
  const customerAgreementSigningPreviewMatch = pathname.match(/^\/api\/customers\/([^/]+)\/agreements\/signing-preview$/);
  const customerAgreementSignMatch = pathname.match(/^\/api\/customers\/([^/]+)\/agreements\/sign$/);
  const customerAuditHistoryMatch = pathname.match(/^\/api\/customers\/([^/]+)\/audit-history$/);
  const inspectionDetailMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)$/);
  const inspectionPhotosMutationMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/photos$/);
  const inspectionNotificationMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/notifications$/);
  const inspectionResponseMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/responses$/);
  const inspectionGeneratedFileMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/generated-files\/(zh|en|bilingual)$/);
  const mechanicInspectionIntakeMatch = pathname === "/api/mechanic/inspection-intake";
  const mechanicInspectionPhotoMatch = pathname.match(/^\/api\/mechanic\/inspection-intake\/([^/]+)\/photos\/([^/]+)\/blob$/);
  const quickOrderFinancialDetailMatch = pathname.match(QUICK_ORDER_FINANCIAL_RAW_DETAIL_ROUTE);
  const quickOrderLifecycleMatch = pathname.match(QUICK_ORDER_LIFECYCLE_RAW_ROUTE);
  const quickOrderFinancialStatementMatch = pathname.match(QUICK_ORDER_FINANCIAL_STATEMENT_RAW_ROUTE);
  const quickOrderFinancialPaymentMatch = pathname.match(QUICK_ORDER_FINANCIAL_PAYMENT_RAW_ROUTE);
  const quickOrderFinancialRefundMatch = pathname.match(QUICK_ORDER_FINANCIAL_REFUND_RAW_ROUTE);
  if (onboardingCloseMatch && method === "DELETE") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().closeOnboarding(
      undefined,
      decodeOnboardingTokenSegment(onboardingCloseMatch[1]),
    )) as T;
  }
  const rawOnboardingAccess = rawOnboardingCandidate
    ? customerVehicleAccessFromSession()
    : undefined;
  const isCustomerVehicleRequest = pathname === "/api/customer-vehicles"
    || pathname === "/api/customers"
    || pathname === "/api/customers/preview"
    || pathname === "/api/customers/onboarding/phone-preview"
    || pathname === "/api/vehicles"
    || pathname === "/api/vehicles/preview"
    || onboardingOtpRequestMatch !== null
    || onboardingOtpVerifyMatch !== null
    || onboardingKycSubmitMatch !== null
    || onboardingKycVerifyMatch !== null
    || onboardingKycClearMatch !== null
    || onboardingPreviewMatch !== null
    || onboardingCreateMatch !== null
    || onboardingCloseMatch !== null
    || customerPreviewUpdateMatch !== null
    || vehiclePreviewUpdateMatch !== null
    || customerActionMatch !== null
    || customerOtpRequestMatch !== null
    || customerOtpVerifyMatch !== null
    || customerOtpInvalidateMatch !== null
    || customerKycSubmitMatch !== null
    || customerKycVerifyMatch !== null
    || customerAgreementSigningPreviewMatch !== null
    || customerAgreementSignMatch !== null
    || customerAuditHistoryMatch !== null
    || customerMatch !== null
    || vehicleMatch !== null
    || vehicleBusinessOrdersMatch !== null;
  // Bind authorization to the request invocation. Reading localStorage after a
  // simulated network delay would let an in-flight request adopt another user.
  const customerVehicleAccess = rawOnboardingCandidate
    ? rawOnboardingAccess
    : isCustomerVehicleRequest
    ? customerVehicleAccessFromSession()
    : undefined;
  const customerWorkspaceSession = pathname === "/api/customer-vehicles" && method === "GET"
    ? ordersSessionFromStorage()
    : undefined;
  const task6OrdersSession = (
    (pathname === "/api/inspection-reports" && method === "GET")
    || (inspectionDetailMatch !== null && method === "GET")
    || (vehicleInspectionPhotosMatch !== null && method === "GET")
    || (vehicleInspectionArchiveMatch !== null && method === "GET")
    || (inspectionPhotoBlobMatch !== null && method === "GET")
    || (vehicleInspectionPhotoBlobMatch !== null && method === "GET")
    || (inspectionGeneratedFileMatch !== null && method === "GET")
    || (inspectionPhotosMutationMatch !== null && method === "PATCH")
    || (inspectionNotificationMatch !== null && method === "POST")
    || (inspectionResponseMatch !== null && method === "POST")
  )
    ? (inspectionPhotosMutationMatch !== null && method === "PATCH")
      || (inspectionNotificationMatch !== null && method === "POST")
      || (inspectionResponseMatch !== null && method === "POST")
      ? ordersMutationSessionFromStorage()
      : ordersSessionFromStorage()
    : undefined;
  const mechanicInspectionSession = (mechanicInspectionIntakeMatch || mechanicInspectionPhotoMatch !== null) && method === "GET"
    ? mechanicInspectionSessionFromStorage()
    : undefined;
  const parkingReadSession = pathname === "/api/parking" && method === "GET"
    ? ordersSessionFromStorage()
    : undefined;
  const quickOrderFinancialReadSession = method === "GET" && (
    pathname === "/api/quick-order-financials"
    || pathname === QUICK_ORDER_FINANCIAL_LEDGER_PATH
    || quickOrderFinancialDetailMatch !== null
    || quickOrderFinancialStatementMatch !== null
  )
    ? ordersSessionFromStorage()
    : undefined;
  const quickOrderLifecyclePreflightSession = quickOrderLifecycleMatch !== null && method === "GET"
    ? quickOrderLifecyclePreflightSessionFromStorage()
    : undefined;
  let quickOrderLifecycleInput: QuickOrderLifecycleMutationInput | undefined;
  let quickOrderLifecycleSession: Session | undefined;
  if (quickOrderLifecycleMatch !== null && method === "POST") {
    const body = parseBody<unknown>(options);
    try {
      assertQuickOrderLifecycleMutationInput(body);
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "QuickOrder lifecycle 请求格式错误",
        400,
      );
    }
    if (decodeQuickOrderFinancialIdSegment(quickOrderLifecycleMatch[1]) !== body.orderId) {
      throw new ApiError("请求路径与 QuickOrder lifecycle 内容不一致", 400);
    }
    if (isTask8ReservedChildMutationId(body.mutationId)) {
      throw new ApiError("mutationId 使用了系统保留命名空间", 400);
    }
    quickOrderLifecycleInput = body;
    quickOrderLifecycleSession = quickOrderLifecycleSessionFromStorage(body.kind);
  }
  let quickOrderMoneyInput: QuickOrderInvoicePaymentInput | QuickOrderInvoiceLineRefundInput | undefined;
  let quickOrderMoneySession: Session | undefined;
  if (method === "POST" && (quickOrderFinancialPaymentMatch !== null || quickOrderFinancialRefundMatch !== null)) {
    const body = parseBody<unknown>(options);
    try {
      if (quickOrderFinancialPaymentMatch !== null) assertQuickOrderInvoicePaymentInput(body);
      else assertQuickOrderInvoiceLineRefundInput(body);
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : "QuickOrder money request format is invalid", 400);
    }
    const encodedOrderId = quickOrderFinancialPaymentMatch?.[1] ?? quickOrderFinancialRefundMatch?.[1];
    if (!encodedOrderId || decodeQuickOrderFinancialIdSegment(encodedOrderId) !== body.orderId) {
      throw new ApiError("QuickOrder money request path is inconsistent", 400);
    }
    if (isTask8ReservedChildMutationId(body.mutationId)) {
      throw new ApiError("mutationId 使用了系统保留命名空间", 400);
    }
    quickOrderMoneyInput = body;
    quickOrderMoneySession = ordersMutationSessionFromStorage();
  }
  const parkingPaymentMatch = pathname.match(/^\/api\/parking\/([^/]+)\/payments$/);
  const parkingPaymentSession = parkingPaymentMatch !== null && method === "POST"
    ? ordersMutationSessionFromStorage()
    : undefined;
  const parkingPickupMatch = pathname.match(/^\/api\/parking\/([^/]+)\/physical-pickup$/);
  const parkingPickupSession = parkingPickupMatch !== null && method === "POST"
    ? ordersMutationSessionFromStorage()
    : undefined;
  const parkingPreviewSession = pathname === "/api/parking/waivers/preview" && method === "POST"
    ? ordersMutationSessionFromStorage()
    : undefined;
  const parkingWaiverMatch = pathname.match(/^\/api\/parking\/([^/]+)\/waivers$/);
  const parkingWaiverSession = parkingWaiverMatch !== null && method === "POST"
    ? ordersMutationSessionFromStorage()
    : undefined;
  await delay(300 + Math.random() * 200);

  if (pathname === "/api/orders" && method === "GET") {
    assertOrdersAccessFromSession();
    try {
      console.log("[orders-api] start");
      const store = getMockLinkedOperationsStore();
      console.log("[orders-api] store got");
      await store.ready();
      console.log("[orders-api] ready");
      await delay(store.getReadDelay("orders.list.read"));
      const result = getMockOrders(mockOrderQueryFromSearchParams(searchParams)) as T;
      console.log("[orders-api] items:", (result as { items?: unknown[] }).items?.length);
      return result;
    } catch (error) {
      throw linkedApiError(error, "工单查询无效");
    }
  }

  if (pathname === "/api/orders/operations" && method === "GET") {
    assertOrdersAccessFromSession();
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("orders.overview.read"));
      return getMockOrdersOperationsOverview() as T;
    } catch (error) {
      throw linkedApiError(error, "运营概览读取失败");
    }
  }

  if (pathname === "/api/orders/reassignments" && method === "GET") {
    assertOrdersAccessFromSession();
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("orders.reassignmentHistory.read"));
      return getMockOrderReassignmentHistory() as T;
    } catch (error) {
      throw linkedApiError(error, "改组审计读取失败");
    }
  }

  const orderReassignMatch = pathname.match(/^\/api\/orders\/([^/]+)\/reassign$/);
  if (orderReassignMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<ReassignOrderInput>(options);
    if (body.orderId !== decodeURIComponent(orderReassignMatch[1])) {
      throw new ApiError("请求路径与改组内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await recordMockOrderReassignment(body, {
        id: session.identity.id,
        name: session.identity.name || session.identity.id,
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, "工单改组失败");
    }
  }

  const orderFormalSubmitMatch = pathname.match(/^\/api\/orders\/([^/]+)\/formal-submit$/);
  if (orderFormalSubmitMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<FormalSubmitOrderInput>(options);
    if (body.orderId !== decodeURIComponent(orderFormalSubmitMatch[1])) {
      throw new ApiError("请求路径与交单内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await submitMockOrderFormal(body, {
        id: session.identity.id,
        name: session.identity.name || session.identity.id,
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, "正式交单失败");
    }
  }

  const orderPerformanceValueMatch = pathname.match(/^\/api\/orders\/([^/]+)\/performance-value$/);
  if (orderPerformanceValueMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<UpdateOrderPerformanceValueInput>(options);
    if (body.orderId !== decodeURIComponent(orderPerformanceValueMatch[1])) {
      throw new ApiError("请求路径与绩效值调整内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockOrderPerformanceValue(body, {
        id: session.identity.id,
        name: session.identity.name || session.identity.id,
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, "绩效值调整失败");
    }
  }

  if (pathname === "/api/performance/orders-summary" && method === "GET") {
    const summaryAccess = performanceAccessFromSession();
    if (!summaryAccess.permissions.canViewPerformance) throw new ApiError("无权查看绩效", 403);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("performance.ordersSummary.read"));
      return getMockOrdersPerformanceSummary(searchParams.get("month") ?? "") as T;
    } catch (error) {
      throw linkedApiError(error, "工单绩效汇总读取失败");
    }
  }

  if (pathname === "/api/inspection-reports" && method === "GET") {
    assertSameOrdersSession(task6OrdersSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const page = searchParams.get("page") ?? "1";
      await delay(store.getReadDelay(`inspection.list.read:${page}`) || store.getReadDelay("inspection.list.read"));
      const result = getMockInspectionReports(inspectionQueryFromSearchParams(searchParams));
      assertSameOrdersSession(task6OrdersSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "Inspection Report 查询失败");
    }
  }

  if (mechanicInspectionIntakeMatch && method === "GET") {
    assertSameMechanicInspectionSession(mechanicInspectionSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("inspection.mechanicIntake.read"));
      const result = getMockMechanicInspectionIntake(mechanicInspectionSession!.identity.id, store);
      assertSameMechanicInspectionSession(mechanicInspectionSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "维修工检查入口读取失败");
    }
  }

  if (mechanicInspectionPhotoMatch && method === "GET") {
    assertSameMechanicInspectionSession(mechanicInspectionSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("inspection.mechanicPhoto.read"));
      const blob = await resolveMockMechanicInspectionPhotoBlob(
        mechanicInspectionSession!.identity.id,
        decodeURIComponent(mechanicInspectionPhotoMatch[1]),
        decodeURIComponent(mechanicInspectionPhotoMatch[2]),
        store,
      );
      assertSameMechanicInspectionSession(mechanicInspectionSession!);
      return blob as T;
    } catch (error) {
      throw linkedApiError(error, "维修工检查照片读取失败");
    }
  }

  if (pathname === "/api/inspection-reports" && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<CreateInspectionReportInput>(options);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await createMockInspectionReportFromInput(body, session.identity.id, session.identity.name, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  if (inspectionDetailMatch && method === "GET") {
    assertSameOrdersSession(task6OrdersSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const reportId = decodeURIComponent(inspectionDetailMatch[1]);
      await delay(store.getReadDelay(`inspection.detail.read:${reportId}`) || store.getReadDelay("inspection.detail.read"));
      const result = getMockInspectionReportDetail(reportId);
      assertSameOrdersSession(task6OrdersSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "Inspection Report 读取失败");
    }
  }

  if (vehicleInspectionPhotosMatch && method === "GET") {
    assertSameOrdersSession(task6OrdersSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = getMockVehicleInspectionReportPhotos(decodeURIComponent(vehicleInspectionPhotosMatch[1]), store);
      assertSameOrdersSession(task6OrdersSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "车辆检查照片档案读取失败");
    }
  }

  if (vehicleInspectionArchiveMatch && method === "GET") {
    assertSameOrdersSession(task6OrdersSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const vehicleId = decodeURIComponent(vehicleInspectionArchiveMatch[1]);
      await delay(store.getReadDelay(`vehicle.inspectionArchive.read:${vehicleId}`) || store.getReadDelay("vehicle.inspectionArchive.read"));
      const result = getMockVehicleInspectionReportArchive(vehicleId, store);
      assertSameOrdersSession(task6OrdersSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "车辆检查结果档案读取失败");
    }
  }

  if (inspectionPhotoBlobMatch && method === "GET") {
    assertSameOrdersSession(task6OrdersSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = await resolveMockInspectionReportPhotoBlob(
        decodeURIComponent(inspectionPhotoBlobMatch[1]),
        decodeURIComponent(inspectionPhotoBlobMatch[2]),
        store,
      );
      assertSameOrdersSession(task6OrdersSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "现场照片读取失败");
    }
  }

  if (vehicleInspectionPhotoBlobMatch && method === "GET") {
    assertSameOrdersSession(task6OrdersSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = await resolveMockVehicleInspectionReportPhotoBlob(
        decodeURIComponent(vehicleInspectionPhotoBlobMatch[1]),
        decodeURIComponent(vehicleInspectionPhotoBlobMatch[2]),
        decodeURIComponent(vehicleInspectionPhotoBlobMatch[3]),
        store,
      );
      assertSameOrdersSession(task6OrdersSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "车辆检查照片读取失败");
    }
  }

  const draftMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/draft$/);
  if (draftMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    try {
      const body = parseBody<UpdateInspectionReportDraftInput>(options);
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockInspectionReportDraft(decodeURIComponent(draftMatch[1]), body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const itemsMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/items$/);
  if (itemsMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    try {
      const body = parseBody<UpdateInspectionReportItemsInput>(options);
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockInspectionReportItems(decodeURIComponent(itemsMatch[1]), body, session.identity.name, store) as T;
    } catch (error) {
      throw linkedApiError(error, "Inspection Report 项目保存失败");
    }
  }

  const photosMatch = inspectionPhotosMutationMatch;
  if (photosMatch && method === "PATCH") {
    const session = task6OrdersSession!;
    assertSameOrdersSession(session);
    try {
      const body = parseInspectionPhotoFormData(options);
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = await updateMockInspectionReportPhotos(decodeURIComponent(photosMatch[1]), body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store);
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "Inspection Report 照片保存失败");
    }
  }

  const quotationMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/quotation$/);
  if (quotationMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<UpdateQuotationInput>(options);
    if (body.reportId !== decodeURIComponent(quotationMatch[1])) {
      throw new ApiError("请求路径与 Inspection Report 内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockQuotation(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const inspectionQuickOrderMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/quick-orders$/);
  if (inspectionQuickOrderMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<CreateQuickOrderFromInspectionQuotationInput>(options);
    if (body.reportId !== decodeURIComponent(inspectionQuickOrderMatch[1])) {
      throw new ApiError("请求路径与 Inspection Report 内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await createMockQuickOrderFromInspectionQuotation(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const inspectionGeneratedFilesMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/generated-files$/);
  if (inspectionGeneratedFilesMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<GenerateInspectionReportFilesInput>(options);
    if (body.reportId !== decodeURIComponent(inspectionGeneratedFilesMatch[1])) {
      throw new ApiError("请求路径与 Inspection Report 内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await generateMockInspectionReportFiles(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  if (inspectionGeneratedFileMatch && method === "GET") {
    const session = task6OrdersSession!;
    assertSameOrdersSession(session);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = await getMockInspectionReportGeneratedFile(
        decodeURIComponent(inspectionGeneratedFileMatch[1]),
        inspectionGeneratedFileMatch[2] as IrPdfLanguage,
        store,
      );
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const communicationMatch = pathname.match(/^\/api\/inspection-reports\/([^/]+)\/communications$/);
  if (communicationMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<RecordCommunicationInput>(options);
    if (body.reportId !== decodeURIComponent(communicationMatch[1])) {
      throw new ApiError("请求路径与 Inspection Report 内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await recordMockInspectionCommunication(body, session.identity.id, store) as T;
    } catch (error) {
      throw linkedApiError(error, "客户沟通记录失败");
    }
  }

  if (inspectionNotificationMatch && method === "POST") {
    const session = task6OrdersSession!;
    assertSameOrdersSession(session);
    const body = parseBody<SendInspectionReportNotificationInput>(options);
    if (body.reportId !== decodeURIComponent(inspectionNotificationMatch[1])) {
      throw new ApiError("请求路径与 Inspection Report 内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = await sendMockInspectionReportNotification(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store, undefined, undefined, () => assertSameOrdersSession(session));
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "客户通知发送失败");
    }
  }

  if (inspectionResponseMatch && method === "POST") {
    const session = task6OrdersSession!;
    assertSameOrdersSession(session);
    const body = parseBody<RecordInspectionCustomerResponseInput>(options);
    if (body.reportId !== decodeURIComponent(inspectionResponseMatch[1])) {
      throw new ApiError("请求路径与 Inspection Report 内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      const result = await recordMockInspectionCustomerResponse(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store, () => assertSameOrdersSession(session));
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "客户回应记录失败");
    }
  }

  if (pathname === "/api/ir-followup" && method === "GET") {
    assertOrdersAccessFromSession();
    return readIrFollowUpSnapshot() as T;
  }

  if (pathname === "/api/ir-followup/actions" && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<IrFollowUpActionInput>(options);
    try {
      return await runIrFollowUpAction(body, session.identity.name) as T;
    } catch (error) {
      if (error instanceof IrFollowUpDomainError) throw new ApiError(error.message, error.status);
      throw linkedApiError(error, "跟进操作失败");
    }
  }

  if (pathname === QUICK_ORDER_FINANCIAL_LEDGER_PATH && method === "GET") {
    const session = quickOrderFinancialReadSession!;
    assertSameOrdersSession(session);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      await delay(store.getReadDelay("quickOrders.financial.ledger.read"));
      const result = getMockQuickOrderFinancialLedger(
        store,
        () => assertSameOrdersSession(session),
      );
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder financial ledger read failed");
    }
  }

  if (pathname === "/api/quick-order-financials" && method === "GET") {
    const session = quickOrderFinancialReadSession!;
    assertSameOrdersSession(session);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      await delay(store.getReadDelay("quickOrders.financial.list.read"));
      const result = listMockQuickOrderFinancialReadModels(
        store,
        () => assertSameOrdersSession(session),
      );
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder financial list read failed");
    }
  }

  if (quickOrderFinancialDetailMatch && method === "GET") {
    const session = quickOrderFinancialReadSession!;
    assertSameOrdersSession(session);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      await delay(store.getReadDelay("quickOrders.financial.detail.read"));
      const result = getMockQuickOrderFinancialReadModel(
        decodeQuickOrderFinancialIdSegment(quickOrderFinancialDetailMatch[1]),
        store,
        () => assertSameOrdersSession(session),
      );
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder financial detail read failed");
    }
  }

  if (quickOrderFinancialStatementMatch && method === "GET") {
    const session = quickOrderFinancialReadSession!;
    assertSameOrdersSession(session);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      await delay(store.getReadDelay("quickOrders.financial.statement.read"));
      const result = getMockQuickOrderFinancialStatement(
        decodeQuickOrderFinancialIdSegment(quickOrderFinancialStatementMatch[1]),
        store,
        () => assertSameOrdersSession(session),
      );
      assertSameOrdersSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder financial statement read failed");
    }
  }

  if (quickOrderLifecycleMatch && method === "GET") {
    const session = quickOrderLifecyclePreflightSession!;
    assertSameQuickOrderLifecyclePreflightSession(session);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      await delay(store.getReadDelay("quickOrders.lifecycle.preflight.read"));
      const compatibleActor = getMockBusinessActor(session.identity, session.formal);
      const actor: QuickOrderLifecycleActor = {
        id: compatibleActor.id,
        name: compatibleActor.name,
        role: compatibleActor.role as QuickOrderLifecycleActor["role"],
      };
      const result = getMockQuickOrderLifecyclePreflight(
        decodeQuickOrderFinancialIdSegment(quickOrderLifecycleMatch[1]),
        actor,
        store,
        () => assertSameQuickOrderLifecyclePreflightSession(session),
      );
      assertSameQuickOrderLifecyclePreflightSession(session);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder lifecycle preflight read failed");
    }
  }

  if (quickOrderLifecycleMatch && method === "POST") {
    const input = quickOrderLifecycleInput!;
    const session = quickOrderLifecycleSession!;
    assertSameQuickOrderLifecycleSession(session, input.kind);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      const compatibleActor = getMockBusinessActor(session.identity, session.formal);
      const actor: QuickOrderLifecycleActor = {
        id: compatibleActor.id,
        name: compatibleActor.name,
        role: compatibleActor.role as QuickOrderLifecycleActor["role"],
      };
      const result = await recordMockQuickOrderLifecycleMutation(
        input,
        actor,
        store,
        () => assertSameQuickOrderLifecycleSession(session, input.kind),
      );
      assertSameQuickOrderLifecycleSession(session, input.kind);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder lifecycle mutation failed");
    }
  }

  if (quickOrderMoneyInput && quickOrderMoneySession) {
    const input = quickOrderMoneyInput;
    const session = quickOrderMoneySession;
    const guard = () => assertSameOrdersSession(session);
    guard();
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      const financial = getMockQuickOrderFinancialReadModel(input.orderId, store, guard);
      if (financial.source.kind !== "canonical_invoice"
        || financial.source.invoiceId !== input.invoiceId
        || financial.source.effectiveVersionId !== input.invoiceVersionId) {
        throw new LinkedApiDomainError("QuickOrder Invoice 来源已变化，请刷新", 409);
      }
      const actor: BillingMutationActor = {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as BillingMutationActor["role"],
      };
      if (input.contract === "quick_order_invoice_payment_v1") {
        const fact = await recordMockInvoicePayment({
          invoiceId: input.invoiceId,
          expectedRevision: input.expectedRevision,
          mutationId: input.mutationId,
          amountJmd: input.amountJmd,
          method: input.method,
          ...(input.note !== undefined ? { note: input.note } : {}),
        }, actor, store, guard);
        const result: QuickOrderInvoicePaymentResult = {
          contract: "quick_order_invoice_payment_result_v1",
          revision: fact.committedRevision,
          orderId: input.orderId,
          invoiceId: input.invoiceId,
          invoiceVersionId: input.invoiceVersionId,
          payment: {
            id: fact.id,
            amountJmd: fact.amountJmd,
            method: fact.method,
            note: fact.note ?? null,
            receivedAt: fact.receivedAt,
          },
        };
        guard();
        return result as T;
      }
      const refundInput: RecordInvoiceLineRefundInput = {
        logicalInvoiceId: input.invoiceId,
        invoiceVersionId: input.invoiceVersionId,
        chargeLineId: input.chargeLineId,
        ...(input.refundQuantity !== undefined ? { refundQuantity: input.refundQuantity } : { wholeLine: true as const }),
        method: input.method,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
      };
      const fact = await recordMockInvoiceLineRefund(refundInput, actor, store, guard);
      const committedRevision = store.read((state) => state.mutationReceipts.find((receipt) => (
        receipt.operation === "billing.invoice.lineRefund" && receipt.mutationId === input.mutationId
      ))?.committedRevision, "quickOrders.financial.refund.result.read");
      if (!committedRevision) throw new LinkedApiDomainError("退款回执缺失", 503);
      const result: QuickOrderInvoiceLineRefundResult = {
        contract: "quick_order_invoice_line_refund_result_v1",
        revision: committedRevision,
        orderId: input.orderId,
        invoiceId: input.invoiceId,
        invoiceVersionId: input.invoiceVersionId,
        refund: {
          id: fact.id,
          chargeLineId: fact.chargeLineId,
          category: fact.category,
          pricingMode: fact.pricingMode,
          refundQuantity: fact.refundQuantity ?? null,
          wholeLine: fact.wholeLine === true,
          receivableReductionJmd: fact.receivableReductionJmd,
          cashRefundJmd: fact.cashRefundJmd,
          method: fact.method,
          reason: fact.reason,
          refundedAt: fact.refundedAt,
        },
      };
      guard();
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "QuickOrder money mutation failed");
    }
  }

  if (pathname === "/api/quick-orders" && method === "GET") {
    assertOrdersAccessFromSession();
    const store = getMockLinkedOperationsStore();
    await store.ready();
    return listMockQuickOrders(store) as T;
  }

  if (pathname === "/api/quick-orders" && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<CreateQuickOrderInput>(options);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await createMockQuickOrder(body, session.identity.name, store) as T;
    } catch (error) {
      throw linkedApiError(error, `工单创建失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const quickDetailMatch = pathname.match(/^\/api\/quick-orders\/([^/]+)$/);
  if (quickDetailMatch && method === "GET") {
    assertOrdersAccessFromSession();
    const store = getMockLinkedOperationsStore();
    await store.ready();
    return getMockQuickOrder(decodeURIComponent(quickDetailMatch[1]), store) as T;
  }

  if (quickDetailMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<UpdateQuickOrderInput>(options);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockQuickOrder(decodeURIComponent(quickDetailMatch[1]), body, session.identity.name, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const quickNotesMatch = pathname.match(/^\/api\/quick-orders\/([^/]+)\/notes$/);
  if (quickNotesMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<UpdateQuickOrderNotesInput>(options);
    if (body.orderId !== decodeURIComponent(quickNotesMatch[1])) {
      throw new ApiError("请求路径与业务单备注内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockQuickOrderNotes(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const quickSharedChargesMatch = pathname.match(/^\/api\/quick-orders\/([^/]+)\/shared-charges$/);
  if (quickSharedChargesMatch && method === "PATCH") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<UpdateSharedQuickOrderChargesInput>(options);
    if (body.orderId !== decodeURIComponent(quickSharedChargesMatch[1])) {
      throw new ApiError("请求路径与业务单内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await updateMockSharedQuickOrderCharges(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as "superadmin" | "frontdesk_admin",
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const quickActionMatch = pathname.match(/^\/api\/quick-orders\/([^/]+)\/action$/);
  if (quickActionMatch && method === "POST") {
    const body = parseBody<{ action: QuickOrderAction; role?: "frontdesk" | "mechanic" }>(options);
    if (([
      "record_pickup",
      "cancel_pickup",
      "record_paid_full",
      "cancel_paid_full",
      "void",
      "restore",
    ] as ReadonlyArray<string>).includes(body.action?.kind)) {
      const lifecycleRetired = ([
        "record_paid_full", "cancel_paid_full", "void", "restore",
      ] as ReadonlyArray<string>).includes(body.action?.kind);
      throw new ApiError(
        lifecycleRetired
          ? "QuickOrder lifecycle 动作已退休；请使用 quick_order_lifecycle_mutation_v1 contract"
          : "QuickOrder 取车动作已退休；请使用 canonical parking pickup contract",
        410,
      );
    }
    const session = ordersMutationSessionFromStorage();
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await applyMockQuickOrderAction(
        decodeURIComponent(quickActionMatch[1]), body.action, session.identity.name, body.role ?? "frontdesk", store,
      ) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const quickSignatureMatch = pathname.match(/^\/api\/quick-orders\/([^/]+)\/invoice-signature$/);
  if (quickSignatureMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<RecordQuickInvoiceSignatureInput>(options);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await recordMockQuickInvoiceSignature(decodeURIComponent(quickSignatureMatch[1]), body, session.identity.name, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  const quickPayMatch = pathname.match(/^\/api\/quick-orders\/([^/]+)\/(payments|refunds|refund-evidence|refund-signatures|pickup-notify)$/);
  if (quickPayMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const orderId = decodeURIComponent(quickPayMatch[1]);
    const kind = quickPayMatch[2];
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      if (kind === "payments") {
        const body = parseBody<{ amountJmd: number; method: QuickPayment["method"]; note?: string }>(options);
        return await recordMockQuickPayment(orderId, body, session.identity.name, store) as T;
      }
      if (kind === "refunds") {
        const body = parseBody<RecordQuickRefundInput>(options);
        return await recordMockQuickRefund(orderId, body, session.identity.name, store) as T;
      }
      if (kind === "refund-evidence") {
        const body = parseBody<RecordQuickRefundEvidenceInput>(options);
        return await attachMockQuickRefundEvidence(orderId, body, session.identity.name, store) as T;
      }
      if (kind === "refund-signatures") {
        const body = parseBody<RecordQuickRefundSignatureInput>(options);
        return await recordMockQuickRefundSignature(orderId, body, session.identity.name, store) as T;
      }
      const body = parseBody<RecordQuickPickupInput>(options);
      if (body.orderId !== orderId) throw new ApiError("请求路径与取车通知业务单不一致", 400);
      return await recordMockQuickPickup(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as SharedQuickOrderMutationActor["role"],
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  if (pathname === "/api/billing" && method === "GET") {
    assertOrdersAccessFromSession();
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("billing.workspace.read"));
      return getMockBillingWorkspace() as T;
    } catch (error) {
      throw linkedApiError(error, "收费工作区读取失败");
    }
  }

  const billingOrderMatch = pathname.match(/^\/api\/billing\/orders\/([^/]+)$/);
  if (billingOrderMatch && method === "GET") {
    assertOrdersAccessFromSession();
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("billing.businessOrder.read"));
      return getMockBillingBusinessOrder(decodeURIComponent(billingOrderMatch[1])) as T;
    } catch (error) {
      throw linkedApiError(error, "Business Order 收费详情读取失败");
    }
  }

  const creditSignatureMatch = pathname.match(/^\/api\/billing\/invoices\/([^/]+)\/credit-signature$/);
  if (creditSignatureMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<SignCreditInvoiceInput>(options);
    if (body.invoiceId !== decodeURIComponent(creditSignatureMatch[1])) {
      throw new ApiError("请求路径与 Invoice 签账内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await signMockCreditInvoice(body, session.identity.id, store) as T;
    } catch (error) {
      throw linkedApiError(error, `Invoice 签账失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const paymentMatch = pathname.match(/^\/api\/billing\/invoices\/([^/]+)\/payments$/);
  if (paymentMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<RecordInvoicePaymentInput>(options);
    if (body.invoiceId !== decodeURIComponent(paymentMatch[1])) {
      throw new ApiError("请求路径与收款内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await recordMockInvoicePayment(body, {
        id: session.identity.id,
        name: session.identity.name,
        role: session.identity.role as BillingMutationActor["role"],
      }, store) as T;
    } catch (error) {
      throw linkedApiError(error, `收款登记失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const specialReleaseMatch = pathname.match(/^\/api\/billing\/orders\/([^/]+)\/special-release$/);
  if (specialReleaseMatch && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<AuthorizeSpecialReleaseInput>(options);
    if (body.orderId !== decodeURIComponent(specialReleaseMatch[1])) {
      throw new ApiError("请求路径与特殊协商内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      return await authorizeMockSpecialRelease(body, session.identity.id, store) as T;
    } catch (error) {
      throw linkedApiError(error, `特殊协商授权失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (pathname === "/api/parking" && method === "GET") {
    assertSameOrdersSession(parkingReadSession!);
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      await delay(store.getReadDelay("parking.canonicalList.read"));
      const result = getMockCanonicalParkingList(store);
      assertSameOrdersSession(parkingReadSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "停车案件读取失败");
    }
  }

  if (parkingPaymentMatch && method === "POST") {
    assertSameOrdersSession(parkingPaymentSession!);
    const body = parseBody<CollectCanonicalParkingPaymentInput>(options);
    if (body.caseId !== decodeURIComponent(parkingPaymentMatch[1])) {
      throw new ApiError("请求路径与停车收款内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      const result = await collectMockCanonicalParkingPayment(body, {
        id: parkingPaymentSession!.identity.id,
        name: parkingPaymentSession!.identity.name,
        role: parkingPaymentSession!.identity.role as BillingMutationActor["role"],
      }, store, () => assertSameOrdersSession(parkingPaymentSession!));
      assertSameOrdersSession(parkingPaymentSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  if (parkingPickupMatch && method === "POST") {
    assertSameOrdersSession(parkingPickupSession!);
    const body = parseBody<RecordModernParkingSourcePickupInput>(options);
    if (body.caseId !== decodeURIComponent(parkingPickupMatch[1])) {
      throw new ApiError("请求路径与实际取车内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      const result = await recordMockParkingSourcePickup(body, {
        id: parkingPickupSession!.identity.id,
        name: parkingPickupSession!.identity.name,
        role: parkingPickupSession!.identity.role as BillingMutationActor["role"],
      }, store, () => assertSameOrdersSession(parkingPickupSession!));
      assertSameOrdersSession(parkingPickupSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, error instanceof Error ? error.message : String(error));
    }
  }

  if (pathname === "/api/parking/waivers/preview" && method === "POST") {
    assertSameOrdersSession(parkingPreviewSession!);
    const body = parseBody<PreviewModernParkingCorrectionInput>(options);
    if (!isObjectBody(body) || typeof body.mutationId !== "string") {
      throw new ApiError("canonical parking preview 请求必须使用 modern contract", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      const result = await previewMockParkingWaiver(body, {
        id: parkingPreviewSession!.identity.id,
        name: parkingPreviewSession!.identity.name,
        role: parkingPreviewSession!.identity.role as BillingMutationActor["role"],
      }, store, () => assertSameOrdersSession(parkingPreviewSession!));
      assertSameOrdersSession(parkingPreviewSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "停车减免预览失败");
    }
  }

  // 工作台统一数据：整个 linked-operations 状态快照
  if (pathname === "/api/debug/linked-operations" && method === "GET") {
    assertOrdersAccessFromSession();
    const store = getMockLinkedOperationsStore();
    await store.ready();
    return store.read((state) => state, "debug.linkedOperations.read") as T;
  }

  if (parkingWaiverMatch && method === "POST") {
    assertSameOrdersSession(parkingWaiverSession!);
    const body = parseBody<ApplyModernParkingCorrectionInput>(options);
    if (!isObjectBody(body) || typeof body.mutationId !== "string") {
      throw new ApiError("canonical parking apply 请求必须使用 modern contract", 400);
    }
    if (body.caseId !== decodeURIComponent(parkingWaiverMatch[1])) {
      throw new ApiError("请求路径与停车减免内容不一致", 400);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await ensureMockCleanMoneyDemo(store);
      const result = await applyMockParkingWaiver(body, {
        id: parkingWaiverSession!.identity.id,
        name: parkingWaiverSession!.identity.name,
        role: parkingWaiverSession!.identity.role as BillingMutationActor["role"],
      }, store, () => assertSameOrdersSession(parkingWaiverSession!));
      assertSameOrdersSession(parkingWaiverSession!);
      return result as T;
    } catch (error) {
      throw linkedApiError(error, "停车减免保存失败");
    }
  }

  if (pathname === "/api/parking-followup" && method === "GET") {
    assertOrdersAccessFromSession();
    return readParkingFollowUpSnapshot() as T;
  }

  if (pathname === "/api/parking-followup/actions" && method === "POST") {
    const session = ordersMutationSessionFromStorage();
    const body = parseBody<ParkingFollowUpActionInput>(options);
    try {
      if (body.type === "record_notification") {
        return recordParkingNotification(body.orderId, body.channel, body.note, session.identity.name) as T;
      }
      if (body.type === "record_bill_sent") {
        return recordParkingBillSent(body.orderId, body.note, session.identity.name) as T;
      }
      throw new ParkingFollowUpDomainError("未知的停车跟进动作", 400);
    } catch (error) {
      if (error instanceof ParkingFollowUpDomainError) throw new ApiError(error.message, error.status);
      throw linkedApiError(error, "停车跟进操作失败");
    }
  }

  // 身份列表
  if (pathname === "/api/identities") {
    return mockIdentities() as T;
  }

  // 会话预览（身份切换）
  if (pathname === "/api/session/preview" && method === "POST") {
    const body = JSON.parse(options?.body as string || "{}");
    await ensureMockCleanMoneyDemo();
    return mockSessionPreview(body.employeeId) as T;
  }

  // 当前会话
  if (pathname === "/api/me") {
    const session = typeof window !== "undefined"
      ? localStorage.getItem("wh_session")
      : null;
    if (session) return JSON.parse(session) as T;
    throw new Error("No session");
  }

  if (pathname === "/api/customer-vehicles" && method === "GET") {
    assertSameOrdersSession(customerWorkspaceSession!);
    const store = getMockCustomerVehicleStore();
    await delay(store.getDelay("customerVehicleRead"));
    assertSameOrdersSession(customerWorkspaceSession!);
    const workspace = store.workspace(customerVehicleAccess);
    assertSameOrdersSession(customerWorkspaceSession!);
    return workspace as T;
  }
  if (pathname === "/api/customers/name-transliteration/preview" && method === "POST") {
    const body = parseBody<{ value?: unknown }>(options);
    if (!isObjectBody(body) || typeof body.value !== "string") {
      throw new ApiError("客户姓名必须是字符串", 400, "CUSTOMER_NAME_SCRIPT_INVALID");
    }
    const value = body.value;
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewCustomerName(
      customerVehicleAccess, value,
    )) as T;
  }
  if (pathname === "/api/customers/onboarding/phone-preview" && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewOnboardingPhone(
      customerVehicleAccess,
      parseBody<PreviewOnboardingPhoneInput>(options),
    )) as T;
  }
  if (onboardingOtpRequestMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().requestOnboardingOtp(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingOtpRequestMatch[1]),
      parseBody<RequestOnboardingOtpInput>(options),
    )) as T;
  }
  if (onboardingOtpVerifyMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().verifyOnboardingOtp(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingOtpVerifyMatch[1]),
      parseBody<VerifyOnboardingOtpInput>(options),
    )) as T;
  }
  if (onboardingKycSubmitMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().submitOnboardingKyc(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingKycSubmitMatch[1]),
      parseBody<SubmitOnboardingKycInput>(options),
    )) as T;
  }
  if (onboardingKycVerifyMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().verifyOnboardingKyc(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingKycVerifyMatch[1]),
      parseBody<VerifyOnboardingKycInput>(options),
    )) as T;
  }
  if (onboardingKycClearMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().clearOnboardingKyc(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingKycClearMatch[1]),
      parseBody<ClearOnboardingKycInput>(options),
    )) as T;
  }
  if (onboardingPreviewMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewOnboardingCustomer(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingPreviewMatch[1]),
      parseBody<PreviewOnboardingCustomerInput>(options),
    )) as T;
  }
  if (onboardingCreateMatch && method === "POST") {
    const store = getMockCustomerVehicleStore();
    await delay(store.getDelay("customerVehicleSave"));
    return customerVehicleApiCall(() => store.createOnboardingCustomer(
      customerVehicleAccess,
      decodeOnboardingTokenSegment(onboardingCreateMatch[1]),
      parseBody<CreateOnboardingCustomerInput>(options),
    )) as T;
  }
  if (customerMatch && method === "GET") {
    const store = getMockCustomerVehicleStore();
    await delay(store.getDelay("customerVehicleRead"));
    return store.customer(customerVehicleAccess, decodeURIComponent(customerMatch[1])) as T;
  }
  if (vehicleMatch && method === "GET") {
    const store = getMockCustomerVehicleStore();
    await delay(store.getDelay("customerVehicleRead"));
    return store.vehicle(customerVehicleAccess, decodeURIComponent(vehicleMatch[1])) as T;
  }
  if (vehicleBusinessOrdersMatch && method === "GET") {
    const vehicleId = decodeURIComponent(vehicleBusinessOrdersMatch[1]);
    const customerStore = getMockCustomerVehicleStore();
    await delay(customerStore.getDelay("customerVehicleRead"));
    const customerMaster = customerVehicleApiCall(() => customerStore.workspace(customerVehicleAccess));
    if (!customerMaster.vehicles.some((vehicle) => vehicle.id === vehicleId)) {
      throw new ApiError("车辆不存在", 404);
    }
    try {
      const store = getMockLinkedOperationsStore();
      await store.ready();
      await delay(store.getReadDelay("vehicles.businessOrders.read"));
      return getMockVehicleBusinessOrders(vehicleId) as T;
    } catch (error) {
      throw linkedApiError(error, "车辆关联业务单读取失败");
    }
  }
  if (pathname === "/api/customers/preview" && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewCustomer(
      customerVehicleAccess, parseBody<CustomerDraftInput>(options),
    )) as T;
  }
  if (customerPreviewUpdateMatch && method === "POST") {
    const body = parseBody<PreviewCustomerUpdateInput & { id?: unknown }>(options);
    const customerId = decodeURIComponent(customerPreviewUpdateMatch[1]);
    if (!isObjectBody(body) || body.id !== customerId) throw new ApiError("请求路径与保存内容不一致", 400);
    const { id: _id, ...input } = body;
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewCustomerUpdate(
      customerVehicleAccess, customerId, input,
    )) as T;
  }
  if (pathname === "/api/customers" && method === "POST") {
    throw new ApiError("请使用现场客户建档流程", 400, "CUSTOMER_ONBOARDING_REQUIRED");
  }
  if (customerMatch && method === "PATCH") {
    const body = parseBody<UpdateCustomerInput & { id?: unknown }>(options);
    const customerId = decodeURIComponent(customerMatch[1]);
    if (!isObjectBody(body) || body.id !== customerId) throw new ApiError("请求路径与保存内容不一致", 400);
    const { id: _id, ...input } = body;
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().updateCustomer(
      customerVehicleAccess, customerId, input,
    )) as T;
  }

  if (customerOtpRequestMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().requestCustomerOtp(
      customerVehicleAccess,
      decodeURIComponent(customerOtpRequestMatch[1]),
      parseBody<RequestCustomerOtpInput>(options),
    )) as T;
  }
  if (customerOtpVerifyMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().verifyCustomerOtp(
      customerVehicleAccess,
      decodeURIComponent(customerOtpVerifyMatch[1]),
      parseBody<VerifyCustomerOtpInput>(options),
    )) as T;
  }
  if (customerOtpInvalidateMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().invalidateCustomerOtp(
      customerVehicleAccess,
      decodeURIComponent(customerOtpInvalidateMatch[1]),
      parseBody<InvalidateCustomerOtpInput>(options),
    )) as T;
  }
  if (customerKycSubmitMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().submitCustomerKyc(
      customerVehicleAccess,
      decodeURIComponent(customerKycSubmitMatch[1]),
      parseBody<SubmitCustomerKycInput>(options),
    )) as T;
  }
  if (customerKycVerifyMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().verifyCustomerKyc(
      customerVehicleAccess,
      decodeURIComponent(customerKycVerifyMatch[1]),
      parseBody<VerifyCustomerKycInput>(options),
    )) as T;
  }
  if (customerAgreementSigningPreviewMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().prepareCustomerAgreementSigning(
      customerVehicleAccess,
      decodeURIComponent(customerAgreementSigningPreviewMatch[1]),
      parseBody<PrepareCustomerAgreementSigningInput>(options),
    )) as T;
  }
  if (customerAgreementSignMatch && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().signCustomerAgreement(
      customerVehicleAccess,
      decodeURIComponent(customerAgreementSignMatch[1]),
      parseBody<SignCustomerAgreementInput>(options),
    )) as T;
  }
  if (customerAuditHistoryMatch && method === "GET") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().customerAuditHistory(
      customerVehicleAccess,
      decodeURIComponent(customerAuditHistoryMatch[1]),
    )) as T;
  }

  // 客户验证与风险动作（后补制）
  if (customerActionMatch && method === "POST") {
    const customerId = decodeURIComponent(customerActionMatch[1]);
    const body = parseBody<CustomerActionInput>(options);
    const store = getMockCustomerVehicleStore();
    if (body.type === "add_risk") {
      return customerVehicleApiCall(() => store.addCustomerRiskFlag(customerVehicleAccess, customerId, body.level, body.note)) as T;
    }
    if (body.type === "remove_risk") {
      return customerVehicleApiCall(() => store.removeCustomerRiskFlag(customerVehicleAccess, customerId, body.flagId)) as T;
    }
    if (body.type === "grant_credit") {
      return customerVehicleApiCall(() => store.grantCustomerCredit(customerVehicleAccess, customerId, body.signatureNote, body.signatureDataUrl, ordersMutationSessionFromStorage().identity.name)) as T;
    }
    if (body.type === "revoke_credit") {
      return customerVehicleApiCall(() => store.revokeCustomerCredit(customerVehicleAccess, customerId, body.reason, ordersMutationSessionFromStorage().identity.name)) as T;
    }
    if (body.type === "save_note") {
      return customerVehicleApiCall(() => store.saveCustomerNote(customerVehicleAccess, customerId, body.noteId, body.content, ordersMutationSessionFromStorage().identity.name)) as T;
    }
    throw new ApiError("未知的客户动作", 400, "CUSTOMER_ACTION_INVALID");
  }
  if (pathname === "/api/vehicles/preview" && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewVehicle(
      customerVehicleAccess, parseBody<VehicleDraftInput>(options),
    )) as T;
  }
  if (vehiclePreviewUpdateMatch && method === "POST") {
    const body = parseBody<PreviewVehicleUpdateInput & { id?: unknown }>(options);
    const vehicleId = decodeURIComponent(vehiclePreviewUpdateMatch[1]);
    if (!isObjectBody(body) || body.id !== vehicleId) throw new ApiError("请求路径与保存内容不一致", 400);
    const { id: _id, ...input } = body;
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().previewVehicleUpdate(
      customerVehicleAccess, vehicleId, input,
    )) as T;
  }
  if (pathname === "/api/vehicles" && method === "POST") {
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().createVehicle(
      customerVehicleAccess, parseBody<SaveVehicleInput>(options),
    )) as T;
  }
  if (vehicleMatch && method === "PATCH") {
    const body = parseBody<UpdateVehicleInput & { id?: unknown }>(options);
    const vehicleId = decodeURIComponent(vehicleMatch[1]);
    if (!isObjectBody(body) || body.id !== vehicleId) throw new ApiError("请求路径与保存内容不一致", 400);
    const { id: _id, ...input } = body;
    return customerVehicleApiCall(() => getMockCustomerVehicleStore().updateVehicle(
      customerVehicleAccess, vehicleId, input,
    )) as T;
  }

  const teamMatch = pathname.match(/^\/api\/performance\/teams\/(t[1-4])$/);
  const memberMatch = pathname.match(/^\/api\/performance\/teams\/(t[1-4])\/members\/([^/]+)$/);
  const salaryMatch = pathname.match(/^\/api\/performance\/teams\/(t[1-4])\/members\/([^/]+)\/standard-salary$/);
  const activateRuleMatch = pathname.match(/^\/api\/performance\/rules\/([^/]+)\/activate$/);
  const access = performanceAccessFromSession();

  if (teamMatch && method === "GET") {
    await delay(getMockPerformanceStore().getDelay("teamRead"));
    return getMockTeamPerformanceDetail(access, teamMatch[1], searchParams.get("month") ?? undefined) as T;
  }
  if (memberMatch && method === "GET") {
    const month = searchParams.get("month");
    if (!month) throw new ApiError("缺少月份", 400);
    await delay(getMockPerformanceStore().getDelay("teamRead"));
    return getMockMemberDetail(access, memberMatch[1], decodeURIComponent(memberMatch[2]), month) as T;
  }
  if (pathname === "/api/performance/salary/preview" && method === "POST") {
    await delay(getMockPerformanceStore().getDelay("salaryPreview"));
    return previewMockSalaryChange(access, parseBody<UpdateStandardSalaryInput>(options)) as T;
  }
  if (salaryMatch && method === "PATCH") {
    await delay(getMockPerformanceStore().getDelay("salarySave"));
    const body = parseBody<SaveStandardSalaryInput>(options);
    if (body.teamId !== salaryMatch[1] || body.memberId !== decodeURIComponent(salaryMatch[2])) {
      throw new ApiError("请求路径与保存内容不一致", 400);
    }
    return updateMockStandardSalary(access, body) as T;
  }
  if (pathname === "/api/performance/rules" && method === "GET") {
    return getMockPerformanceStore().getRuleWorkspace(access) as T;
  }
  if (pathname === "/api/performance/rules/preview" && method === "POST") {
    await delay(getMockPerformanceStore().getDelay("rulePreview"));
    return await getMockPerformanceStore().previewRule(
      access,
      parseBody<RuleDraftInput>(options),
    ) as T;
  }
  if (pathname === "/api/performance/rules" && method === "POST") {
    await delay(getMockPerformanceStore().getDelay("ruleSave"));
    return getMockPerformanceStore().saveRuleDraft(
      access,
      parseBody<SaveRuleDraftInput>(options),
    ) as T;
  }
  if (activateRuleMatch && method === "POST") {
    await delay(getMockPerformanceStore().getDelay("ruleActivate"));
    return getMockPerformanceStore().activateRule(access, decodeURIComponent(activateRuleMatch[1])) as T;
  }

  throw new Error(`Mock API not found: ${method} ${path}`);
}

function parseBody<T>(options?: RequestInit): T {
  try {
    return JSON.parse(String(options?.body ?? "{}")) as T;
  } catch {
    throw new ApiError("请求内容不是有效 JSON", 400);
  }
}

function parseInspectionPhotoFormData(options?: RequestInit): UpdateInspectionReportPhotosInput {
  if (!(options?.body instanceof FormData)) throw new ApiError("现场照片请求必须使用 multipart/form-data", 400);
  const allowed = new Set(["reportId", "expectedRevision", "mutationId", "deleteId", "file"]);
  for (const [key] of options.body.entries()) {
    if (!allowed.has(key)) throw new ApiError(`现场照片请求包含不允许的字段：${key}`, 400);
  }
  const reportId = options.body.get("reportId");
  const revision = options.body.get("expectedRevision");
  const mutationId = options.body.get("mutationId");
  const deleteIds = options.body.getAll("deleteId");
  const files = options.body.getAll("file");
  if (
    options.body.getAll("reportId").length !== 1
    || options.body.getAll("expectedRevision").length !== 1
    || options.body.getAll("mutationId").length !== 1
    ||
    typeof reportId !== "string"
    || typeof revision !== "string"
    || typeof mutationId !== "string"
    || deleteIds.some((id) => typeof id !== "string")
    || files.some((file) => !(file instanceof File))
  ) throw new ApiError("现场照片 multipart 请求无效", 400);
  return {
    reportId,
    expectedRevision: Number(revision),
    mutationId,
    deleteIds: deleteIds as string[],
    files: files as File[],
  };
}

export function linkedApiError(error: unknown, fallback: string): ApiError {
  if (error instanceof ApiError) {
    const status = error.status ?? 500;
    return new ApiError(status >= 500 ? fallback : error.message, status, error.code, error.details);
  }
  if (error instanceof LinkedApiDomainError) {
    return new ApiError(error.status >= 500 ? fallback : error.message, error.status, undefined, error.details);
  }
  return new ApiError(fallback, 500);
}

function isObjectBody(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function customerVehicleApiCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CustomerVehicleValidationError) throw new ApiError(error.message, error.status, error.code);
    throw error;
  }
}

function permissionsForRole(role: string): PerformancePermissions {
  if (role === "superadmin") {
    return { canViewPerformance: true, canEditSalary: true, canManageRules: true };
  }
  if (role === "finance") {
    return { canViewPerformance: true, canEditSalary: true, canManageRules: false };
  }
  if (role === "frontdesk_admin") {
    return { canViewPerformance: true, canEditSalary: false, canManageRules: false };
  }
  return { canViewPerformance: false, canEditSalary: false, canManageRules: false };
}

function performanceAccessFromSession(): PerformanceAccessContext {
  const serialized = typeof window === "undefined" ? null : window.localStorage.getItem("wh_session");
  if (!serialized) throw new ApiError("无权查看绩效", 403);
  try {
    const session = JSON.parse(serialized) as Session;
    if (!session?.identity?.id || !session.identity.role) throw new Error("invalid session");
    return { actorId: session.identity.id, permissions: permissionsForRole(session.identity.role) };
  } catch {
    throw new ApiError("会话无效", 401);
  }
}

function customerVehicleAccessFromSession(): CustomerVehicleAccessContext {
  const serialized = typeof window === "undefined" ? null : window.localStorage.getItem("wh_session");
  if (!serialized) throw new ApiError("无权读取客户与车辆完整目录", 403);
  try {
    const session = JSON.parse(serialized) as Session;
    const actorId = session?.identity?.id;
    const role = session?.identity?.role;
    if (typeof actorId !== "string" || !actorId.trim() || CUSTOMER_AUDIT_DATA_URL.test(actorId)
      || typeof role !== "string" || !role) {
      throw new Error("invalid session");
    }
    if (role !== "superadmin" && role !== "frontdesk_admin") {
      throw new ApiError("无权读取客户与车辆完整目录", 403);
    }
    return { actorId, role };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("会话无效", 401);
  }
}

function ordersSessionFromStorage(): Session {
  const serialized = typeof window === "undefined" ? null : window.localStorage.getItem("wh_session");
  if (!serialized) throw new ApiError("当前会话无权访问该业务资源", 403);
  try {
    const session = JSON.parse(serialized) as Session;
    if (!session?.identity?.id || !session.identity.role) throw new Error("invalid session");
    if (!permissionsForRole(session.identity.role).canViewPerformance) throw new Error("forbidden");
    return session;
  } catch {
    throw new ApiError("当前会话无权访问该业务资源", 403);
  }
}

function assertOrdersAccessFromSession(): void {
  ordersSessionFromStorage();
}

function assertSameOrdersSession(invocationSession: Session): void {
  const current = ordersSessionFromStorage();
  if (
    current.identity.id !== invocationSession.identity.id
    || current.identity.role !== invocationSession.identity.role
  ) {
    throw new ApiError("当前会话已变更，请重新读取该业务资源", 403);
  }
}

function ordersMutationSessionFromStorage(): Session {
  const session = ordersSessionFromStorage();
  if (!(["superadmin", "frontdesk_admin"] as string[]).includes(session.identity.role)) {
    throw new ApiError("当前会话无权执行该业务操作", 403);
  }
  return session;
}

function quickOrderLifecycleRoleAllowed(kind: QuickOrderLifecycleKind, role: string): boolean {
  if (kind === "void" || kind === "restore") {
    return role === "superadmin" || role === "frontdesk_admin" || role === "finance" || role === "mechanic";
  }
  return role === "superadmin" || role === "frontdesk_admin" || role === "finance";
}

function quickOrderLifecyclePreflightSessionFromStorage(): Session {
  const serialized = typeof window === "undefined" ? null : window.localStorage.getItem("wh_session");
  if (!serialized) throw new ApiError("当前会话无权读取 QuickOrder lifecycle preflight", 403);
  try {
    const session = JSON.parse(serialized) as Session;
    const id = session?.identity?.id;
    const name = session?.identity?.name;
    const role = session?.identity?.role;
    if (typeof id !== "string" || !id.trim()
      || typeof name !== "string" || !name.trim()
      || typeof role !== "string"
      || !(role === "superadmin" || role === "frontdesk_admin" || role === "finance" || role === "mechanic")) {
      throw new Error("forbidden");
    }
    if (session.formal) {
      if (!isFormalIdentityConsistent(session.identity, session.formal)) {
        throw new Error("inconsistent formal identity");
      }
    } else {
      const canonical = canonicalMockIdentitySnapshot(id);
      if (!canonical || canonical.name !== name || canonical.role !== role) {
        throw new Error("forged identity");
      }
    }
    return session;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("当前会话无权读取 QuickOrder lifecycle preflight", 403);
  }
}

function quickOrderLifecycleSessionFromStorage(kind: QuickOrderLifecycleKind): Session {
  const session = quickOrderLifecyclePreflightSessionFromStorage();
  if (!quickOrderLifecycleRoleAllowed(kind, session.identity.role)) {
    throw new ApiError("当前会话无权执行 QuickOrder lifecycle 操作", 403);
  }
  return session;
}

function assertSameQuickOrderLifecyclePreflightSession(invocationSession: Session): void {
  const current = quickOrderLifecyclePreflightSessionFromStorage();
  if (current.identity.id !== invocationSession.identity.id
    || current.identity.name !== invocationSession.identity.name
    || current.identity.role !== invocationSession.identity.role) {
    throw new ApiError("当前会话已变更，请重新读取 QuickOrder lifecycle preflight", 403);
  }
}

function assertSameQuickOrderLifecycleSession(
  invocationSession: Session,
  kind: QuickOrderLifecycleKind,
): void {
  const current = quickOrderLifecycleSessionFromStorage(kind);
  if (current.identity.id !== invocationSession.identity.id
    || current.identity.name !== invocationSession.identity.name
    || current.identity.role !== invocationSession.identity.role) {
    throw new ApiError("当前会话已变更，请重新提交 QuickOrder lifecycle 操作", 403);
  }
}

function mechanicInspectionSessionFromStorage(): Session {
  const serialized = typeof window === "undefined" ? null : window.localStorage.getItem("wh_session");
  if (!serialized) throw new ApiError("当前会话无权访问维修工检查入口", 403);
  try {
    const session = JSON.parse(serialized) as Session;
    if (!session?.identity?.id || session.identity.role !== "mechanic") throw new Error("forbidden");
    return session;
  } catch {
    throw new ApiError("当前会话无权访问维修工检查入口", 403);
  }
}

function assertSameMechanicInspectionSession(invocationSession: Session): void {
  const current = mechanicInspectionSessionFromStorage();
  if (current.identity.id !== invocationSession.identity.id) {
    throw new ApiError("当前会话已变更，请重新读取维修工检查入口", 403);
  }
}

function ordersPath(query: OrderListQuery): string {
  const searchParams = new URLSearchParams();
  if (query.scope !== undefined) searchParams.set("scope", query.scope);
  if (query.lifecycle !== undefined) searchParams.set("lifecycle", query.lifecycle);
  if (query.status !== undefined) searchParams.set("status", query.status);
  if (query.teamId !== undefined) searchParams.set("teamId", query.teamId);
  if (query.search !== undefined) searchParams.set("search", query.search);
  if (query.page !== undefined) searchParams.set("page", String(query.page));
  if (query.pageSize !== undefined) searchParams.set("pageSize", String(query.pageSize));
  const queryString = searchParams.toString();
  return `/api/orders${queryString ? `?${queryString}` : ""}`;
}

function inspectionQueryFromSearchParams(searchParams: URLSearchParams): InspectionReportListQuery {
  const page = searchParams.get("page");
  const pageSize = searchParams.get("pageSize");
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const teamId = searchParams.get("teamId");
  const communication = searchParams.get("communication");
  const sourceBusinessOrderId = searchParams.get("sourceBusinessOrderId");
  return {
    ...(page !== null ? { page: Number(page) } : {}),
    ...(pageSize !== null ? { pageSize: Number(pageSize) } : {}),
    ...(search !== null ? { search } : {}),
    ...(status !== null ? { status: status as InspectionReportListQuery["status"] } : {}),
    ...(teamId !== null ? { teamId: teamId as InspectionReportListQuery["teamId"] } : {}),
    ...(communication !== null ? { communication: communication as InspectionReportListQuery["communication"] } : {}),
    ...(sourceBusinessOrderId !== null ? { sourceBusinessOrderId } : {}),
  };
}

function inspectionPath(query: InspectionReportListQuery): string {
  const searchParams = new URLSearchParams();
  if (query.page !== undefined) searchParams.set("page", String(query.page));
  if (query.pageSize !== undefined) searchParams.set("pageSize", String(query.pageSize));
  if (query.search !== undefined) searchParams.set("search", query.search);
  if (query.status !== undefined) searchParams.set("status", query.status);
  if (query.teamId !== undefined) searchParams.set("teamId", query.teamId);
  if (query.communication !== undefined) searchParams.set("communication", query.communication);
  if (query.sourceBusinessOrderId !== undefined) searchParams.set("sourceBusinessOrderId", query.sourceBusinessOrderId);
  const queryString = searchParams.toString();
  return `/api/inspection-reports${queryString ? `?${queryString}` : ""}`;
}

// ============================================================
// 对外 API 方法
// ============================================================

export const api = {
  /** 获取仪表盘数据 */
  dashboard: () => fetchFormalDashboard(),

  /** 获取员工身份列表 */
  identities: () => request<Identity[]>("/api/identities"),

  /** 切换身份（预览模式） */
  previewSession: (employeeId: string) =>
    request<Session>("/api/session/preview", {
      method: "POST",
      body: JSON.stringify({ employeeId }),
    }),

  /** 获取当前会话 */
  me: () => request<Session>("/api/me"),

  revenue: {
    detail: (range: RevenueRange) =>
      fetchFormalRevenue(range),
  },

  orders: {
    list: (query: OrderListQuery = {}) =>
      request<OrderListResponse>(ordersPath(query)),
    operationsOverview: () =>
      request<OrdersOperationsOverview>("/api/orders/operations"),
    reassignmentHistory: () =>
      request<OrderReassignmentAudit[]>("/api/orders/reassignments"),
    reassign: (input: ReassignOrderInput) =>
      request<OrderReassignmentAudit>(
        `/api/orders/${encodeURIComponent(input.orderId)}/reassign`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    /** 正式交单：核对绩效值后计入负责班组当月绩效（已交单未取车）。 */
    formalSubmit: (input: FormalSubmitOrderInput) =>
      request<FormalSubmitOrderResult>(
        `/api/orders/${encodeURIComponent(input.orderId)}/formal-submit`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    /** 手工调整整单绩效值：仅交单前允许，只改绩效值并留审计。 */
    updatePerformanceValue: (input: UpdateOrderPerformanceValueInput) =>
      request<UpdateOrderPerformanceValueResult>(
        `/api/orders/${encodeURIComponent(input.orderId)}/performance-value`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
  },

  inspectionReports: {
    list: (query: InspectionReportListQuery = {}) =>
      request<InspectionReportListResponse>(inspectionPath(query)),
    create: (input: CreateInspectionReportInput) =>
      request<InspectionReportDetailResponse>("/api/inspection-reports", {
        method: "POST", body: JSON.stringify(input),
      }),
    detail: (reportId: string) =>
      request<InspectionReportDetailResponse>(`/api/inspection-reports/${encodeURIComponent(reportId)}`),
    photoBlob: (reportId: string, attachmentId: string) =>
      requestBlob(`/api/inspection-reports/${encodeURIComponent(reportId)}/photos/${encodeURIComponent(attachmentId)}/blob`),
    recordCommunication: (input: RecordCommunicationInput) =>
      request<LinkedCommunicationFact>(
        `/api/inspection-reports/${encodeURIComponent(input.reportId)}/communications`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    sendNotification: (input: SendInspectionReportNotificationInput) =>
      request<SendInspectionReportNotificationResult>(
        `/api/inspection-reports/${encodeURIComponent(input.reportId)}/notifications`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    recordResponse: (input: RecordInspectionCustomerResponseInput) =>
      request<RecordInspectionCustomerResponseResult>(
        `/api/inspection-reports/${encodeURIComponent(input.reportId)}/responses`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    updateQuotation: (input: UpdateQuotationInput) =>
      request<{ quotationId: string; lineIds: string[]; revision: number; contentRevision: number; contentChanged: boolean; signatureEventId: string | null }>(
        `/api/inspection-reports/${encodeURIComponent(input.reportId)}/quotation`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    generateFiles: (input: GenerateInspectionReportFilesInput) =>
      request<GenerateInspectionReportFilesResult>(
        `/api/inspection-reports/${encodeURIComponent(input.reportId)}/generated-files`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    generatedFile: (reportId: string, language: IrPdfLanguage) =>
      request<GeneratedInspectionReportFileResult>(
        `/api/inspection-reports/${encodeURIComponent(reportId)}/generated-files/${language}`,
      ),
    createQuickOrder: (input: CreateQuickOrderFromInspectionQuotationInput) =>
      request<QuickOrder>(
        `/api/inspection-reports/${encodeURIComponent(input.reportId)}/quick-orders`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    updateItems: (reportId: string, input: UpdateInspectionReportItemsInput) =>
      request<InspectionReportDetailResponse>(
        `/api/inspection-reports/${encodeURIComponent(reportId)}/items`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    updatePhotos: (reportId: string, input: UpdateInspectionReportPhotosInput) => {
      const body = new FormData();
      body.append("reportId", input.reportId);
      body.append("expectedRevision", String(input.expectedRevision));
      body.append("mutationId", input.mutationId);
      input.deleteIds.forEach((id) => body.append("deleteId", id));
      input.files.forEach((file) => body.append("file", file, file.name));
      return request<UpdateInspectionReportPhotosResult>(
        `/api/inspection-reports/${encodeURIComponent(reportId)}/photos`,
        { method: "PATCH", body },
      );
    },
    updateDraft: (reportId: string, input: UpdateInspectionReportDraftInput) =>
      request<InspectionReportDetailResponse>(
        `/api/inspection-reports/${encodeURIComponent(reportId)}/draft`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    mechanicIntake: () =>
      request<MechanicInspectionIntakeResponse>("/api/mechanic/inspection-intake"),
    mechanicPhotoBlob: (reportId: string, attachmentId: string) =>
      requestBlob(`/api/mechanic/inspection-intake/${encodeURIComponent(reportId)}/photos/${encodeURIComponent(attachmentId)}/blob`),
  },

  irFollowup: {
    snapshot: () => request<IrFollowUpSnapshot>("/api/ir-followup"),
    action: (input: IrFollowUpActionInput) =>
      request<unknown>("/api/ir-followup/actions", { method: "POST", body: JSON.stringify(input) }),
  },

  parkingFollowup: {
    snapshot: () => request<ParkingFollowUpSnapshot>("/api/parking-followup"),
    action: (input: ParkingFollowUpActionInput) =>
      request<unknown>("/api/parking-followup/actions", { method: "POST", body: JSON.stringify(input) }),
  },

  debug: {
    linkedOperationsState: () => request<LinkedOperationsState>("/api/debug/linked-operations"),
  },

  quickOrderFinancials: {
    list: () => request<QuickOrderFinancialListResponse>(QUICK_ORDER_FINANCIAL_LIST_PATH),
    ledger: () => request<QuickOrderFinancialLedgerResponse>(QUICK_ORDER_FINANCIAL_LEDGER_PATH),
    detail: (orderId: string) => request<QuickOrderFinancialReadModel>(
      `${QUICK_ORDER_FINANCIAL_DETAIL_PREFIX}${encodeQuickOrderFinancialIdSegment(orderId)}`,
    ),
    statement: (orderId: string) => request<QuickOrderFinancialStatement>(
      `${QUICK_ORDER_FINANCIAL_DETAIL_PREFIX}${encodeQuickOrderFinancialIdSegment(orderId)}/statement`,
    ),
    preflight: (orderId: string) => request<QuickOrderLifecyclePreflight>(
      `${QUICK_ORDER_FINANCIAL_DETAIL_PREFIX}${encodeQuickOrderFinancialIdSegment(orderId)}/lifecycle`,
    ),
    lifecycle: async (input: QuickOrderLifecycleMutationInput) => {
      try {
        assertQuickOrderLifecycleMutationInput(input);
      } catch (error) {
        throw new ApiError(
          error instanceof Error ? error.message : "QuickOrder lifecycle 请求格式错误",
          400,
        );
      }
      if (isTask8ReservedChildMutationId(input.mutationId)) {
        throw new ApiError("mutationId 使用了系统保留命名空间", 400);
      }
      return request<QuickOrderLifecycleMutationResult>(
        `${QUICK_ORDER_FINANCIAL_DETAIL_PREFIX}${encodeQuickOrderFinancialIdSegment(input.orderId)}/lifecycle`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    recordInvoicePayment: (input: QuickOrderInvoicePaymentInput) => {
      assertQuickOrderInvoicePaymentInput(input);
      return request<QuickOrderInvoicePaymentResult>(
        `${QUICK_ORDER_FINANCIAL_DETAIL_PREFIX}${encodeQuickOrderFinancialIdSegment(input.orderId)}/payments`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    recordInvoiceLineRefund: (input: QuickOrderInvoiceLineRefundInput) => {
      assertQuickOrderInvoiceLineRefundInput(input);
      return request<QuickOrderInvoiceLineRefundResult>(
        `${QUICK_ORDER_FINANCIAL_DETAIL_PREFIX}${encodeQuickOrderFinancialIdSegment(input.orderId)}/refunds`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
  },

  quickOrders: {
    list: () => request<QuickOrder[]>("/api/quick-orders"),
    detail: (orderId: string) => request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}`),
    create: (input: CreateQuickOrderInput) =>
      request<QuickOrder>("/api/quick-orders", { method: "POST", body: JSON.stringify(input) }),
    action: (orderId: string, action: QuickOrderAction, role?: "frontdesk" | "mechanic") =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}/action`, {
        method: "POST", body: JSON.stringify({ action, role }),
      }),
    update: (orderId: string, input: UpdateQuickOrderInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}`, {
        method: "PATCH", body: JSON.stringify(input),
      }),
    updateNotes: (input: UpdateQuickOrderNotesInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(input.orderId)}/notes`, {
        method: "PATCH", body: JSON.stringify(input),
      }),
    updateSharedCharges: (input: UpdateSharedQuickOrderChargesInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(input.orderId)}/shared-charges`, {
        method: "PATCH", body: JSON.stringify(input),
      }),
    recordPayment: (orderId: string, input: { amountJmd: number; method: QuickPayment["method"]; note?: string }) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}/payments`, {
        method: "POST", body: JSON.stringify(input),
      }),
    recordRefund: (orderId: string, input: RecordQuickRefundInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}/refunds`, {
        method: "POST", body: JSON.stringify(input),
      }),
    attachRefundEvidence: (orderId: string, input: RecordQuickRefundEvidenceInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}/refund-evidence`, {
        method: "POST", body: JSON.stringify(input),
      }),
    recordRefundSignature: (orderId: string, input: RecordQuickRefundSignatureInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}/refund-signatures`, {
        method: "POST", body: JSON.stringify(input),
      }),
    notifyPickup: (orderId: string, input: RecordQuickPickupInput) =>
      request<RecordQuickPickupResult>(`/api/quick-orders/${encodeURIComponent(orderId)}/pickup-notify`, { method: "POST", body: JSON.stringify(input) }),
    recordInvoiceSignature: (orderId: string, input: RecordQuickInvoiceSignatureInput) =>
      request<QuickOrder>(`/api/quick-orders/${encodeURIComponent(orderId)}/invoice-signature`, {
        method: "POST", body: JSON.stringify(input),
      }),
  },
  billing: {
    workspace: () => request<BillingWorkspaceResponse>("/api/billing"),
    businessOrder: (orderId: string) =>
      request<BillingBusinessOrderResponse>(`/api/billing/orders/${encodeURIComponent(orderId)}`),
    signCreditInvoice: (input: SignCreditInvoiceInput) =>
      request<InvoiceCustomerAcknowledgement>(
        `/api/billing/invoices/${encodeURIComponent(input.invoiceId)}/credit-signature`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    recordInvoicePayment: (input: RecordInvoicePaymentInput) =>
      request<InvoicePaymentFact>(
        `/api/billing/invoices/${encodeURIComponent(input.invoiceId)}/payments`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    authorizeSpecialRelease: (input: AuthorizeSpecialReleaseInput) =>
      request<LinkedSpecialReleaseAuthorization>(
        `/api/billing/orders/${encodeURIComponent(input.orderId)}/special-release`,
        { method: "POST", body: JSON.stringify(input) },
      ),
  },

  parking: {
    list: () => request<CanonicalParkingListResponse>("/api/parking"),
    recordPickup: (input: RecordModernParkingSourcePickupInput) =>
      request<RecordModernParkingSourcePickupResult>(`/api/parking/${encodeURIComponent(input.caseId)}/physical-pickup`, {
        method: "POST", body: JSON.stringify(input),
      }),
    recordPayment: (input: CollectCanonicalParkingPaymentInput) =>
      request<CollectCanonicalParkingPaymentResult>(`/api/parking/${encodeURIComponent(input.caseId)}/payments`, {
        method: "POST", body: JSON.stringify(input),
      }),
    previewWaiver: (input: PreviewModernParkingCorrectionInput) =>
      request<ModernParkingCorrectionPreviewDto>("/api/parking/waivers/preview", {
        method: "POST", body: JSON.stringify(input),
      }),
    applyWaiver: (input: ApplyModernParkingCorrectionInput) =>
      request<ApplyModernParkingCorrectionResult>(`/api/parking/${encodeURIComponent(input.caseId)}/waivers`, {
        method: "POST", body: JSON.stringify(input),
      }),
  },

  customers: {
    workspace: () => request<CustomerVehicleWorkspaceResponse>("/api/customer-vehicles"),
    previewName: (value: string) =>
      request<CustomerNamePreview>("/api/customers/name-transliteration/preview", {
        method: "POST", body: JSON.stringify({ value }),
      }),
    onboarding: {
      previewPhone: (input: PreviewOnboardingPhoneInput) =>
        request<OnboardingPhonePreviewResult>("/api/customers/onboarding/phone-preview", {
          method: "POST", body: JSON.stringify(input),
        }),
      requestOtp: (token: string, input: RequestOnboardingOtpInput) =>
        request<OnboardingOtpChallenge>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/otp/request`, {
          method: "POST", body: JSON.stringify(input),
        }),
      verifyOtp: (token: string, input: VerifyOnboardingOtpInput) =>
        request<OnboardingOtpVerification>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/otp/verify`, {
          method: "POST", body: JSON.stringify(input),
        }),
      submitKyc: (token: string, input: SubmitOnboardingKycInput) =>
        request<OnboardingKycSubmission>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/kyc/submit`, {
          method: "POST", body: JSON.stringify(input),
        }),
      verifyKyc: (token: string, input: VerifyOnboardingKycInput) =>
        request<OnboardingKycConfirmation>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/kyc/verify`, {
          method: "POST", body: JSON.stringify(input),
        }),
      clearKyc: (token: string, input: ClearOnboardingKycInput) =>
        request<ClearOnboardingKycResult>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/kyc/clear`, {
          method: "POST", body: JSON.stringify(input),
        }),
      preview: (token: string, input: PreviewOnboardingCustomerInput) =>
        request<OnboardingCustomerPreviewResult>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/preview`, {
          method: "POST", body: JSON.stringify(input),
        }),
      create: (token: string, input: CreateOnboardingCustomerInput & { customer?: NormalizedCustomerInput }) =>
        request<CustomerRecord>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}/create`, {
          method: "POST", body: JSON.stringify(input),
        }),
      close: (token: string) =>
        request<CloseOnboardingResult>(`/api/customers/onboarding/${encodeOnboardingTokenSegment(token)}`, {
          method: "DELETE",
        }),
    },
    detail: (customerId: string) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}`),
    preview: (input: CustomerDraftInput) =>
      request<CustomerSavePreview>("/api/customers/preview", {
        method: "POST", body: JSON.stringify(input),
      }),
    previewUpdate: (customerId: string, input: PreviewCustomerUpdateInput) =>
      request<CustomerSavePreview>(`/api/customers/${encodeURIComponent(customerId)}/preview`, {
        method: "POST", body: JSON.stringify({ id: customerId, ...input }),
      }),
    update: (customerId: string, input: UpdateCustomerInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}`, {
        method: "PATCH", body: JSON.stringify({ id: customerId, ...input }),
      }),
    requestOtp: (customerId: string, input: RequestCustomerOtpInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/otp/request`, {
        method: "POST", body: JSON.stringify(input),
      }),
    verifyOtp: (customerId: string, input: VerifyCustomerOtpInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/otp/verify`, {
        method: "POST", body: JSON.stringify(input),
      }),
    invalidateOtp: (customerId: string, input: InvalidateCustomerOtpInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/otp/invalidate`, {
        method: "POST", body: JSON.stringify(input),
      }),
    submitKyc: (customerId: string, input: SubmitCustomerKycInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/kyc/submit`, {
        method: "POST", body: JSON.stringify(input),
      }),
    verifyKyc: (customerId: string, input: VerifyCustomerKycInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/kyc/verify`, {
        method: "POST", body: JSON.stringify(input),
      }),
    prepareAgreementSigning: (customerId: string, input: PrepareCustomerAgreementSigningInput) =>
      request<CustomerAgreementSigningPreview>(`/api/customers/${encodeURIComponent(customerId)}/agreements/signing-preview`, {
        method: "POST", body: JSON.stringify(input),
      }),
    signAgreement: (customerId: string, input: SignCustomerAgreementInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/agreements/sign`, {
        method: "POST", body: JSON.stringify(input),
      }),
    auditHistory: (customerId: string) =>
      request<readonly CustomerAuditEvent[]>(
        `/api/customers/${encodeURIComponent(customerId)}/audit-history`,
      ),
    action: (customerId: string, input: CustomerActionInput) =>
      request<CustomerRecord>(`/api/customers/${encodeURIComponent(customerId)}/actions`, {
        method: "POST", body: JSON.stringify(input),
      }),
  },

  vehicles: {
    detail: (vehicleId: string) =>
      request<VehicleRecord>(`/api/vehicles/${encodeURIComponent(vehicleId)}`),
    businessOrders: (vehicleId: string) =>
      request<readonly VehicleBusinessOrderRow[]>(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/business-orders`,
      ),
    inspectionReportPhotos: (vehicleId: string) =>
      request<VehicleInspectionReportPhotoGroup[]>(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-report-photos`,
      ),
    inspectionReportArchive: (vehicleId: string) =>
      request<VehicleInspectionReportArchiveGroup[]>(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-report-archive`,
      ),
    inspectionReportPhotoBlob: (vehicleId: string, reportId: string, attachmentId: string) =>
      requestBlob(`/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-report-photos/${encodeURIComponent(reportId)}/${encodeURIComponent(attachmentId)}/blob`),
    preview: (input: VehicleDraftInput) =>
      request<VehicleSavePreview>("/api/vehicles/preview", {
        method: "POST", body: JSON.stringify(input),
      }),
    previewUpdate: (vehicleId: string, input: PreviewVehicleUpdateInput) =>
      request<VehicleSavePreview>(`/api/vehicles/${encodeURIComponent(vehicleId)}/preview`, {
        method: "POST", body: JSON.stringify({ id: vehicleId, ...input }),
      }),
    create: (input: SaveVehicleInput) =>
      request<VehicleRecord>("/api/vehicles", {
        method: "POST", body: JSON.stringify(input),
      }),
    update: (vehicleId: string, input: UpdateVehicleInput) =>
      request<VehicleRecord>(`/api/vehicles/${encodeURIComponent(vehicleId)}`, {
        method: "PATCH", body: JSON.stringify({ id: vehicleId, ...input }),
      }),
  },

  performance: {
    /** 绩效页"已正式交单绩效值"月度汇总（已计入/待计入，只归班组）。 */
    ordersSummary: (month: string) =>
      request<OrdersPerformanceSummaryResponse>(
        `/api/performance/orders-summary?month=${encodeURIComponent(month)}`,
      ),
    team: (teamId: string, month?: string) =>
      request<TeamPerformanceDetailResponse>(
        `/api/performance/teams/${teamId}${month ? `?month=${month}` : ""}`,
      ),
    member: (teamId: string, memberId: string, month: string) =>
      request<PerformanceMemberDetail>(
        `/api/performance/teams/${teamId}/members/${memberId}?month=${month}`,
      ),
    previewSalary: (input: UpdateStandardSalaryInput) =>
      request<SalaryChangePreview>("/api/performance/salary/preview", {
        method: "POST", body: JSON.stringify(input),
      }),
    updateSalary: (input: SaveStandardSalaryInput) =>
      request<UpdateStandardSalaryResult>(
        `/api/performance/teams/${input.teamId}/members/${input.memberId}/standard-salary`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    rules: () => request<RuleWorkspaceResponse>("/api/performance/rules"),
    previewRule: (input: RuleDraftInput) =>
      request<RuleImpactPreview>("/api/performance/rules/preview", {
        method: "POST", body: JSON.stringify(input),
      }),
    saveRuleDraft: (input: SaveRuleDraftInput) =>
      request<PerformanceRuleVersion>("/api/performance/rules", {
        method: "POST", body: JSON.stringify(input),
      }),
    activateRule: (ruleId: string) =>
      request<RuleWorkspaceResponse>(`/api/performance/rules/${ruleId}/activate`, {
        method: "POST",
      }),
  },
};
