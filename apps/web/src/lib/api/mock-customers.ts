import type {
  CustomerDraftInput,
  CustomerDuplicateCandidate,
  CustomerAgreementSigningPreview,
  CustomerAuditEvent,
  CustomerMutationReceipt,
  CustomerRecord,
  CustomerSavePreview,
  CustomerNamePreview,
  CustomerType,
  CustomerVehicleAccessContext,
  CustomerVehicleAuditEvent,
  CustomerVehicleStateV3,
  CustomerVehicleSummary,
  CustomerVehicleWorkspaceResponse,
  InvalidateCustomerOtpInput,
  LegacyCustomerRecord,
  LegacyVehicleRecord,
  NormalizedCustomerInput,
  NormalizedVehicleInput,
  PreviewCustomerUpdateInput,
  PreviewVehicleUpdateInput,
  PrepareCustomerAgreementSigningInput,
  RequestCustomerOtpInput,
  SaveCustomerInput,
  SaveVehicleInput,
  SignCustomerAgreementInput,
  StoredCustomerName,
  SubmitCustomerKycInput,
  UpdateCustomerInput,
  UpdateVehicleInput,
  VehicleAuditEvent,
  VehicleCustomerRelationship,
  VehicleDraftInput,
  VehicleRecord,
  VehicleSavePreview,
  VerifyCustomerKycInput,
  VerifyCustomerOtpInput,
} from "../customers/types";
import { generateBulkCustomers, generateBulkVehicles } from "./mock-bulk-seed";
import {
  isCustomerEnvelopeV3,
  migrateCustomerVehicleEnvelope,
  validateCustomerVehicleStateV3,
} from "../customers/migrations";
import { transliterateCustomerName, type CustomerNameResult } from "../customers/name-transliteration";
import { normalizePhoneE164 } from "../customers/phone";
import { normalizeDriverLicenseProfile } from "../customers/driver-license-profile";
import { EvidenceAssetError, validateKycEvidence } from "../customers/evidence-assets";
import {
  finalizePreparedLicenseEvidence,
  PreparedEvidenceError,
  validatePreparedLicenseEvidence,
} from "../customers/license-extraction/prepared-evidence";
import type { LicenseExtractionErrorCode, LicenseExtractionResult, PreparedLicenseEvidence } from "../customers/license-extraction/types";
import {
  AgreementEvidenceRequiredError,
  validateAgreementRecord,
} from "../customers/verification-domain";
import type { AgreementRecord, EvidenceAsset, KycVerificationRecord } from "../customers/verification-types";
import { SEED_EVIDENCE_ASSETS } from "../customers/seed-evidence";
import {
  hasExactOwnStringKeys,
  isSafeOnboardingId,
  matchOnboardingPhones,
  onboardingRequestFingerprint,
  ONBOARDING_SESSION_TTL_MS,
} from "../customers/onboarding-domain";
import type {
  ClearOnboardingKycInput,
  ClearOnboardingKycResult,
  CloseOnboardingResult,
  CreateOnboardingCustomerInput,
  OnboardingCustomerPreview,
  OnboardingCustomerPreviewResult,
  OnboardingKycConfirmation,
  OnboardingKycSubmission,
  OnboardingInputPhoneField,
  OnboardingLicenseProfile,
  OnboardingReminder,
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

const STORAGE_KEY = "wh_customer_vehicle_mock_v1";
const STORAGE_SCHEMA_VERSION = 3;
const DEFAULT_TIMESTAMP = "2026-08-09T00:00:00.000Z";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUDIT_DATA_URL = /(?:^|[^A-Za-z0-9])data\s*:/i;

type MockCustomerVehicleOperation =
  | "customerVehicleRead"
  | "customerVehicleSave"
  | "customerOnboardingCreateResponse"
  | "customerOnboardingKycClearResponse"
  | "customerOnboardingKycSubmitResponse"
  | "customerOnboardingKycVerifyResponse"
  | "customerOnboardingOtpRequestResponse"
  | "customerOnboardingOtpVerifyResponse"
  | "customerKycSubmitResponse"
  | "customerKycVerifyResponse";

export interface MockCustomerVehicleFaults {
  failNext?: Partial<Record<MockCustomerVehicleOperation, string>>;
  delayMs?: Partial<Record<MockCustomerVehicleOperation, number>>;
}

export type MockCustomerVehicleE2EScenario = MockCustomerVehicleFaults & {
  licenseExtraction?: {
    kind: "result";
    result: LicenseExtractionResult;
    attempts?: readonly { readonly delayMs: number; readonly result: LicenseExtractionResult }[];
  } | {
    kind: "deferred";
    result: LicenseExtractionResult;
    releaseEvent: string;
  } | { kind: "error"; code: LicenseExtractionErrorCode };
};

interface LegacyCustomerVehicleState {
  sourceRevision: number;
  customers: LegacyCustomerRecord[];
  vehicles: LegacyVehicleRecord[];
  relationships: VehicleCustomerRelationship[];
  auditRecords: Array<Record<string, unknown>>;
}

type CustomerVehicleState = CustomerVehicleStateV3;
type CustomerVerificationOperation =
  | "otp.request"
  | "otp.verify"
  | "otp.invalidate"
  | "kyc.submit"
  | "kyc.verify"
  | "agreement.sign";

interface CustomerVerificationMutationResult {
  customer: CustomerRecord;
  eventType: Extract<CustomerAuditEvent["eventType"],
    "otp_requested" | "otp_verified" | "otp_invalidated" | "kyc_submitted" | "kyc_verified" | "agreement_signed">;
  reason: string | null;
  summary: string;
  changes: CustomerAuditEvent["changes"];
  evidenceAssetIds: readonly string[];
}

interface LoadedCustomerVehicleState {
  state: CustomerVehicleState;
  shouldPersistMigration: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CustomerPreviewRegistryEntry {
  action: "create" | "update";
  entityId: string | null;
  expectedRevision: number | null;
  input: NormalizedCustomerInput;
  candidates: CustomerDuplicateCandidate[];
  sourceRevision: number;
  actorId: string;
}

interface CustomerNamePreviewReceipt {
  actorId: string;
  normalizedSourceValue: string;
  canonicalResult: CustomerNameResult;
  issuedAt: string;
}

interface CustomerAgreementSigningReceipt {
  actorId: string;
  customerId: string;
  customerRevision: number;
  version: string;
  signedBy: string;
  signedAt: string;
}

interface VehiclePreviewRegistryEntry {
  action: "create" | "update";
  entityId: string | null;
  expectedRevision: number | null;
  input: NormalizedVehicleInput;
  existingVehicleId: string | null;
  canSave: boolean;
  sourceRevision: number;
  actorId: string;
}

interface OnboardingMemoryReceipt {
  operation: string;
  clientMutationId: string;
  requestFingerprint: string;
  response: unknown;
  superseded?: true;
}

interface CustomerOnboardingSession {
  readonly token: string;
  readonly actorId: string;
  readonly customerType: CustomerType;
  readonly phoneE164: string | null;
  readonly createdAt: string;
  phoneSourceRevision: number;
  stage: "collecting" | "customer_previewed" | "creating";
  lastTouchedAtMs: number;
  otp: null | { challengeId: string; requestedAt: string; verifiedAt: string | null };
  kyc: null | {
    draftId: string;
    frontAsset: EvidenceAsset;
    profile: OnboardingLicenseProfile;
    submittedAt: string;
    verifiedAt: string | null;
    verifiedBy: string | null;
  };
  customerPreview: null | {
    previewToken: string;
    input: NormalizedCustomerInput;
    candidates: readonly CustomerDuplicateCandidate[];
    sourceRevision: number;
    actorId: string;
    phoneE164: string | null;
    otp: null | {
      challengeId: string;
      requestedAt: string;
      verifiedAt: string | null;
    };
    kyc: null | {
      draftId: string;
      evidenceAssetId: string;
      profile: OnboardingLicenseProfile;
      submittedAt: string;
      verifiedAt: string | null;
      verifiedBy: string | null;
    };
    status: "ready";
    reminders: readonly OnboardingReminder[];
    nameTransliterationToken: string;
  };
  readonly memoryReceipts: Map<string, OnboardingMemoryReceipt>;
}

function onboardingReminders(
  session: CustomerOnboardingSession,
  input: NormalizedCustomerInput,
): OnboardingReminder[] {
  const reminders: OnboardingReminder[] = [];
  if (session.phoneE164 === null) reminders.push({ kind: "otp", status: "phone_missing" });
  else if (!session.otp) reminders.push({ kind: "otp", status: "not_requested" });
  else if (!session.otp.verifiedAt) reminders.push({ kind: "otp", status: "pending" });

  const subjectType = session.customerType === "organization"
    ? "organization_primary_contact" as const
    : "customer" as const;
  if (!session.kyc) reminders.push({ kind: "kyc", subjectType, status: "evidence_missing" });
  else if (!session.kyc.verifiedAt) reminders.push({ kind: "kyc", subjectType, status: "pending_verification" });

  if (session.kyc) {
    const profile = session.kyc.profile;
    const mismatch = session.customerType === "organization"
      ? input.nameSourceValue !== profile.name
      : input.nameSourceValue !== profile.name
        || input.birthDate !== profile.birthDate
        || input.gender !== (profile.sex === "M" ? "男" : "女")
        || input.address !== profile.address;
    if (mismatch) reminders.push({ kind: "kyc_profile_mismatch", subjectType });
  }
  return reminders;
}

export interface CreateMockCustomerVehicleStoreOptions {
  initialState?: CustomerVehicleState;
  storage?: StorageLike;
  clock?: () => string;
  customerId?: (nextState: CustomerVehicleState) => string;
  vehicleId?: (nextState: CustomerVehicleState) => string;
  relationshipId?: (nextState: CustomerVehicleState) => string;
  faults?: MockCustomerVehicleFaults;
  onboardingNowMs?: () => number;
}

export interface MockCustomerVehicleStore {
  workspace(access?: CustomerVehicleAccessContext): CustomerVehicleWorkspaceResponse;
  customer(access: CustomerVehicleAccessContext | undefined, customerId: string): CustomerRecord;
  vehicle(access: CustomerVehicleAccessContext | undefined, vehicleId: string): VehicleRecord;
  previewOnboardingPhone(
    access: CustomerVehicleAccessContext | undefined,
    input: PreviewOnboardingPhoneInput,
  ): OnboardingPhonePreviewResult;
  requestOnboardingOtp(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: RequestOnboardingOtpInput,
  ): OnboardingOtpChallenge;
  verifyOnboardingOtp(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: VerifyOnboardingOtpInput,
  ): OnboardingOtpVerification;
  submitOnboardingKyc(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: SubmitOnboardingKycInput,
  ): OnboardingKycSubmission;
  verifyOnboardingKyc(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: VerifyOnboardingKycInput,
  ): OnboardingKycConfirmation;
  clearOnboardingKyc(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: ClearOnboardingKycInput,
  ): ClearOnboardingKycResult;
  previewOnboardingCustomer(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: PreviewOnboardingCustomerInput,
  ): OnboardingCustomerPreviewResult;
  createOnboardingCustomer(
    access: CustomerVehicleAccessContext | undefined,
    token: string,
    input: CreateOnboardingCustomerInput,
  ): CustomerRecord;
  closeOnboarding(access: CustomerVehicleAccessContext | undefined, token: string): CloseOnboardingResult;
  previewCustomerName(access: CustomerVehicleAccessContext | undefined, value: string): CustomerNamePreview;
  previewCustomer(access: CustomerVehicleAccessContext | undefined, input: CustomerDraftInput): CustomerSavePreview;
  previewCustomerUpdate(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: PreviewCustomerUpdateInput,
  ): CustomerSavePreview;
  createCustomer(access: CustomerVehicleAccessContext | undefined, input: SaveCustomerInput): CustomerRecord;
  updateCustomer(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: UpdateCustomerInput,
  ): CustomerRecord;
  previewVehicle(access: CustomerVehicleAccessContext | undefined, input: VehicleDraftInput): VehicleSavePreview;
  previewVehicleUpdate(
    access: CustomerVehicleAccessContext | undefined,
    vehicleId: string,
    input: PreviewVehicleUpdateInput,
  ): VehicleSavePreview;
  requestCustomerOtp(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: RequestCustomerOtpInput,
  ): CustomerRecord;
  verifyCustomerOtp(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: VerifyCustomerOtpInput,
  ): CustomerRecord;
  invalidateCustomerOtp(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: InvalidateCustomerOtpInput,
  ): CustomerRecord;
  submitCustomerKyc(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: SubmitCustomerKycInput,
  ): CustomerRecord;
  verifyCustomerKyc(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: VerifyCustomerKycInput,
  ): CustomerRecord;
  prepareCustomerAgreementSigning(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: PrepareCustomerAgreementSigningInput,
  ): CustomerAgreementSigningPreview;
  signCustomerAgreement(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
    input: SignCustomerAgreementInput,
  ): CustomerRecord;
  customerAuditHistory(
    access: CustomerVehicleAccessContext | undefined,
    customerId: string,
  ): readonly CustomerAuditEvent[];
  /** 添加风险条目（提醒但不阻止办理）。 */
  addCustomerRiskFlag(access: CustomerVehicleAccessContext | undefined, customerId: string, level: "attention" | "high" | "blacklist", note: string): CustomerRecord;
  /** 解除风险条目（留痕，不删除）。 */
  removeCustomerRiskFlag(access: CustomerVehicleAccessContext | undefined, customerId: string, flagId: string): CustomerRecord;
  /** 登记挂账资格：签名面板有笔迹即可，立即生效，无审批。 */
  grantCustomerCredit(access: CustomerVehicleAccessContext | undefined, customerId: string, signatureNote: string, signatureDataUrl: string | null, actorName: string): CustomerRecord;
  /** 取消挂账资格（留痕）。 */
  revokeCustomerCredit(access: CustomerVehicleAccessContext | undefined, customerId: string, reason: string, actorName: string): CustomerRecord;
  /** 新增或编辑备注（noteId 为空=新增；可随时编辑）。 */
  saveCustomerNote(access: CustomerVehicleAccessContext | undefined, customerId: string, noteId: string | null, content: string, actorName: string): CustomerRecord;
  createVehicle(access: CustomerVehicleAccessContext | undefined, input: SaveVehicleInput): VehicleRecord;
  updateVehicle(
    access: CustomerVehicleAccessContext | undefined,
    vehicleId: string,
    input: UpdateVehicleInput,
  ): VehicleRecord;
  audits(access: CustomerVehicleAccessContext | undefined): CustomerVehicleAuditEvent[];
  getDelay(operation: MockCustomerVehicleOperation): number;
}

export class CustomerVehicleValidationError extends Error {
  constructor(
    message: string,
    readonly code = "CUSTOMER_VALIDATION_FAILED",
    readonly status = 400,
  ) {
    super(message);
    this.name = "CustomerVehicleValidationError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyPaymentSummary(): LegacyCustomerRecord["paymentSummary"] {
  return { totalAmount: 0, paidAmount: 0, unpaidAmount: 0, orderCount: 0 };
}

function baseCustomer(
  value: Pick<LegacyCustomerRecord, "id" | "customerType" | "name" | "organizationName" | "phone" | "whatsapp" | "email" | "status" | "createdAt" | "updatedAt">
    & Partial<Omit<LegacyCustomerRecord, "id" | "customerType" | "name" | "organizationName" | "phone" | "whatsapp" | "email" | "status" | "createdAt" | "updatedAt">>,
): LegacyCustomerRecord {
  return {
    nameZh: null,
    salutation: null,
    language: "English",
    secondaryPhone: null,
    preferredChannel: value.whatsapp ? "whatsapp" : value.phone ? "phone" : "email",
    address: null,
    gender: null,
    birthDate: null,
    trn: null,
    licensePhotoUrl: null,
    source: null,
    riskLevel: "normal",
    riskNote: null,
    riskFlags: [],
    creditEligibility: {
      eligible: false, registeredAt: null, registeredBy: null, signatureNote: null, signatureDataUrl: null, cancelledAt: null, cancelledBy: null,
    },
    verification: {
      otpVerified: false,
      otpVerifiedAt: null,
      kycStatus: "pending",
      kycVerifiedAt: null,
      agreementStatus: "pending",
      agreementVersion: null,
      agreementSignedAt: null,
    },
    tags: [],
    profileCompleteness: "incomplete",
    recentBusiness: null,
    recentBusinessDate: null,
    activeBusinessCount: 0,
    contacts: [],
    orders: [],
    paymentSummary: emptyPaymentSummary(),
    communications: [],
    tasks: [],
    attachments: [],
    notes: [],
    changeHistory: [],
    revision: 1,
    ...value,
  };
}

function baseVehicle(
  value: Pick<LegacyVehicleRecord, "id" | "plate" | "vin" | "make" | "model" | "year" | "status" | "createdAt" | "updatedAt">
    & Partial<Omit<LegacyVehicleRecord, "id" | "plate" | "vin" | "make" | "model" | "year" | "status" | "createdAt" | "updatedAt">>,
): LegacyVehicleRecord {
  return {
    makeZh: null,
    modelZh: null,
    engineNumber: null,
    variant: null,
    color: null,
    powertrain: null,
    bodyType: null,
    seating: null,
    ccRating: null,
    fuelType: null,
    photos: [],
    mileage: null,
    mileageUnit: "km",
    mileageRecordedAt: null,
    usage: null,
    specialNotes: null,
    recentService: null,
    recentServiceDate: null,
    linkedOrderCount: 0,
    totalAmount: 0,
    unpaidAmount: 0,
    serviceHistory: [],
    partsNeeds: [],
    tasks: [],
    attachments: [],
    changeHistory: [],
    revision: 1,
    ...value,
  };
}

function buildSyntheticUatState(): LegacyCustomerVehicleState {
  // 批量演示数据（2026-08-12 老板要求数百条）：确定性生成，UAT 锚点保留
  const bulkCustomerInputs = generateBulkCustomers(296);
  const bulkCustomers = bulkCustomerInputs.map((input) => baseCustomer({ ...input }));
  const bulkVehicleInputs = generateBulkVehicles(320, bulkCustomers.map((c) => c.id));
  const bulkVehicles = bulkVehicleInputs.map((v) => baseVehicle({
    id: v.id, plate: v.plate, vin: "1HGBH41JXMN2" + v.id.slice(-5), make: v.make, model: v.model, makeZh: v.makeZh, modelZh: v.modelZh, year: v.year,
    status: v.status, createdAt: "2026-01-15T09:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
  }));
  const bulkRelationships = bulkVehicleInputs.map((v, index) => ({
    id: `REL-BULK-${String(index + 1).padStart(3, "0")}`,
    vehicleId: v.id, customerId: v.customerId,
    startedAt: "2026-01-15T09:00:00.000Z", endedAt: null,
  }));
  return {
    sourceRevision: 1,
    auditRecords: [],
    customers: [
      baseCustomer({
        id: "CUST-UAT-001",
        customerType: "individual",
        name: "Alicia Bennett", nameZh: "黄艾丽",
        organizationName: null,
        salutation: "Ms",
        language: "English",
        phone: "+1 876 555 0101",
        secondaryPhone: "+1 876 555 0191",
        whatsapp: "+1 876 555 0101",
        email: "alicia.bennett@synthetic.example",
        preferredChannel: "whatsapp",
        address: "12 Constant Spring Road, Kingston 8",
        gender: "女",
        birthDate: "1988-03-22",
        trn: "110-044-556",
        licensePhotoUrl: "/seed-photos/registration-sample-1.jpg",
        source: "Customer referral",
        riskLevel: "normal",
        riskNote: null,
        riskFlags: [],
        verification: {
          otpVerified: true,
          otpVerifiedAt: "2026-01-14T09:20:00.000Z",
          kycStatus: "verified",
          kycVerifiedAt: "2026-01-14T09:35:00.000Z",
          agreementStatus: "signed",
          agreementVersion: "v1.2",
          agreementSignedAt: "2026-05-16T10:00:00.000Z",
        },
        tags: ["loyal", "morning-pickup"],
        profileCompleteness: "complete",
        recentBusiness: "Brake pad replacement & oil change",
        recentBusinessDate: "2026-08-05T10:30:00.000Z",
        activeBusinessCount: 1,
        status: "active",
        contacts: [{
          id: "CONTACT-UAT-001", label: "Spouse", name: "Sarah Bennett", phone: "+1 876 555 0143",
          email: null, relation: "Spouse",
        }],
        orders: [
          { id: "WO-2026-0892", type: "order", title: "Brake pad replacement & oil change", amount: 28500, status: "in_progress", date: "2026-08-05T10:30:00.000Z" },
          { id: "QT-2026-0901", type: "quote", title: "Timing belt replacement quote", amount: 65000, status: "pending_approval", date: "2026-08-06T09:00:00.000Z" },
        ],
        paymentSummary: { totalAmount: 532000, paidAmount: 489000, unpaidAmount: 43000, orderCount: 14 },
        communications: [{ id: "COMM-UAT-001", channel: "whatsapp", direction: "outbound", summary: "Shared repair completion estimate", operator: "Tanya B.", time: "2026-08-05T11:00:00.000Z" }],
        tasks: [{ id: "TASK-CUST-UAT-001", title: "Confirm timing belt quote", status: "pending", assignee: "Tanya B.", dueAt: "2026-08-12T15:00:00.000Z" }],
        attachments: [{ id: "ATT-CUST-UAT-001", fileName: "customer-authorization.pdf", category: "authorization", uploadedBy: "Tanya B.", uploadedAt: "2026-08-05T10:45:00.000Z" }],
        notes: [{ id: "NOTE-UAT-001", content: "Prefers morning pickup and WhatsApp confirmation.", author: "Tanya B.", time: "2026-05-10T10:00:00.000Z" }],
        changeHistory: [{ id: "CHANGE-CUST-UAT-001", field: "preferredChannel", from: "phone", to: "whatsapp", operator: "Tanya B.", time: "2026-04-15T09:00:00.000Z" }],
        createdAt: "2025-01-14T09:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
      }),
      baseCustomer({
        id: "CUST-UAT-002",
        customerType: "organization",
        name: "Dwayne Clarke",
        organizationName: "North Coast Logistics Ltd",
        phone: "+1 876 555 0102",
        whatsapp: null,
        email: "service@northcoast.synthetic.example",
        preferredChannel: "email",
        address: "44 Hagley Park Road, Kingston 10",
        source: "Fleet account",
        riskLevel: "attention",
        riskNote: "Review open fleet balance before major work.",
        riskFlags: [{
          id: "RISK-UAT-002-1", level: "attention", note: "账期偶有拖延，大单前确认余额",
          addedAt: "2026-08-01T09:00:00.000Z", addedBy: "Omar D.", removedAt: null, removedBy: null,
        }],
        creditEligibility: {
          eligible: true, registeredAt: "2025-03-20T10:30:00.000Z", registeredBy: "Omar D.",
          signatureNote: "管理员签名留痕（月结 30 天）", signatureDataUrl: null, cancelledAt: null, cancelledBy: null,
        },
        verification: {
          otpVerified: false,
          otpVerifiedAt: null,
          kycStatus: "verified",
          kycVerifiedAt: "2025-03-20T10:00:00.000Z",
          agreementStatus: "signed",
          agreementVersion: "v1.2",
          agreementSignedAt: "2025-03-20T10:30:00.000Z",
        },
        tags: ["fleet", "monthly-invoice"],
        profileCompleteness: "complete",
        recentBusiness: "Fleet transmission service",
        recentBusinessDate: "2026-08-07T08:00:00.000Z",
        activeBusinessCount: 3,
        status: "active",
        contacts: [{ id: "CONTACT-UAT-002", label: "Fleet manager", name: "Dwayne Clarke", phone: "+1 876 555 0102", email: "service@northcoast.synthetic.example", relation: "Manager" }],
        orders: [{ id: "WO-2026-0901", type: "order", title: "Fleet transmission service", amount: 85000, status: "in_progress", date: "2026-08-07T08:00:00.000Z" }],
        paymentSummary: { totalAmount: 1850000, paidAmount: 1620000, unpaidAmount: 230000, orderCount: 42 },
        communications: [{ id: "COMM-UAT-002", channel: "email", direction: "outbound", summary: "Sent July fleet report", operator: "Omar D.", time: "2026-08-01T09:00:00.000Z" }],
        tasks: [{ id: "TASK-CUST-UAT-002", title: "Review fleet balance", status: "in_progress", assignee: "Omar D.", dueAt: "2026-08-15T17:00:00.000Z" }],
        attachments: [{ id: "ATT-CUST-UAT-002", fileName: "fleet-account-terms.pdf", category: "account", uploadedBy: "Omar D.", uploadedAt: "2025-03-20T09:30:00.000Z" }],
        notes: [{ id: "NOTE-UAT-002", content: "Monthly invoice billing with 30-day terms.", author: "Omar D.", time: "2025-03-20T09:00:00.000Z" }],
        changeHistory: [{ id: "CHANGE-CUST-UAT-002", field: "riskLevel", from: "normal", to: "attention", operator: "Omar D.", time: "2026-08-01T09:00:00.000Z" }],
        createdAt: "2025-03-20T09:00:00.000Z",
        updatedAt: "2026-08-02T10:00:00.000Z",
      }),
      baseCustomer({
        id: "CUST-UAT-003",
        customerType: "individual",
        name: "Marcia Reid",
        organizationName: null,
        phone: null,
        whatsapp: "wa-0103",
        email: "marcia.reid@synthetic.example",
        preferredChannel: "whatsapp",
        riskLevel: "normal",
        riskFlags: [],
        tags: ["profile-follow-up"],
        profileCompleteness: "incomplete",
        recentBusiness: "Annual inspection",
        recentBusinessDate: "2026-07-30T09:00:00.000Z",
        status: "active",
        orders: [{ id: "WO-2026-0870", type: "order", title: "Annual inspection", amount: 22000, status: "completed", date: "2026-07-30T09:00:00.000Z" }],
        paymentSummary: { totalAmount: 98000, paidAmount: 98000, unpaidAmount: 0, orderCount: 5 },
        createdAt: "2025-05-04T09:00:00.000Z",
        updatedAt: "2026-08-03T10:00:00.000Z",
      }),
      baseCustomer({
        id: "CUST-UAT-004",
        customerType: "organization",
        name: "Rochelle Grant",
        organizationName: "Seaview Villas Group",
        phone: "+1 876 555 0104",
        whatsapp: null,
        email: "frontdesk@seaview.synthetic.example",
        preferredChannel: "email",
        address: "7 Seaview Drive, Ocho Rios",
        source: "Commercial referral",
        riskLevel: "high",
        riskNote: "Require payment confirmation before release.",
        riskFlags: [{
          id: "RISK-UAT-004-1", level: "blacklist", note: "历史付款承诺多次失约",
          addedAt: "2026-05-22T14:00:00.000Z", addedBy: "傅立建", removedAt: null, removedBy: null,
        }],
        verification: {
          otpVerified: true,
          otpVerifiedAt: "2025-07-19T09:30:00.000Z",
          kycStatus: "pending",
          kycVerifiedAt: null,
          agreementStatus: "expired",
          agreementVersion: "v1.1",
          agreementSignedAt: "2025-07-19T09:45:00.000Z",
        },
        tags: ["commercial", "payment-review"],
        profileCompleteness: "complete",
        recentBusiness: "Guest shuttle inspection",
        recentBusinessDate: "2026-07-30T10:00:00.000Z",
        activeBusinessCount: 0,
        status: "inactive",
        orders: [{ id: "WO-2026-0862", type: "order", title: "Guest shuttle inspection", amount: 18000, status: "completed", date: "2026-07-30T10:00:00.000Z" }],
        paymentSummary: { totalAmount: 218000, paidAmount: 168000, unpaidAmount: 50000, orderCount: 7 },
        createdAt: "2025-07-19T09:00:00.000Z",
        updatedAt: "2026-07-30T10:00:00.000Z",
      }),
      ...bulkCustomers,
    ],
    vehicles: [
      baseVehicle({
        id: "VEH-UAT-001", plate: "7012 AB", vin: "1HGBH41JXMN100001", engineNumber: "ENG-UAT-001",
        make: "Honda", model: "CR-V", makeZh: "本田", modelZh: "CR-V", variant: "EX", year: 2021, color: "Silver", powertrain: "Petrol",
        bodyType: "Stn/Wagon", seating: "5", ccRating: "1998", fuelType: "PETROL",
        mileage: 84200, mileageUnit: "km", mileageRecordedAt: "2026-08-05T10:30:00.000Z",
        usage: "Personal", specialNotes: "Use customer-supplied child-seat cover during service.",
        recentService: "Brake pad replacement & oil change", recentServiceDate: "2026-08-05T10:30:00.000Z",
        photos: [
          { id: "PHOTO-UAT-001-REG", kind: "registration", url: "/seed-photos/registration-sample-2.jpg", note: "注册证（Registration Certificate）", linkedOrderId: null, uploadedBy: "Tanya B.", uploadedAt: "2025-03-04T10:00:00.000Z" },
          { id: "PHOTO-UAT-001-FIT", kind: "fitness", url: "/seed-photos/fitness-sample-2.jpg", note: "检验合格证（Certificate of Fitness）", linkedOrderId: null, uploadedBy: "Tanya B.", uploadedAt: "2025-07-23T10:00:00.000Z" },
          { id: "PHOTO-UAT-001-REP", kind: "repair", url: "/seed-photos/registration-sample-1.jpg", note: "维修过程拍照（示例）", linkedOrderId: "WO-2026-0892", uploadedBy: "Omar D.", uploadedAt: "2026-08-05T10:35:00.000Z" },
        ],
        linkedOrderCount: 14, totalAmount: 385000, unpaidAmount: 0,
        status: "on_site",
        serviceHistory: [
          { id: "SERVICE-UAT-001", date: "2026-08-05T10:30:00.000Z", title: "Brake pad replacement & oil change", mileage: 84200, amount: 28500, status: "in_progress" },
          { id: "SERVICE-UAT-002", date: "2026-07-18T14:00:00.000Z", title: "AC system diagnostic & recharge", mileage: 83100, amount: 42000, status: "completed" },
        ],
        partsNeeds: [{ id: "PART-UAT-001", name: "Timing belt kit", urgency: "urgent", status: "ordered", estimatedCost: 28000 }],
        tasks: [{ id: "TASK-VEH-UAT-001", title: "Confirm timing belt quote", status: "pending", assignee: "Tanya B.", dueAt: "2026-08-12T15:00:00.000Z" }],
        attachments: [{ id: "ATT-VEH-UAT-001", fileName: "inspection-report.pdf", category: "inspection", uploadedBy: "Omar D.", uploadedAt: "2026-08-05T12:00:00.000Z" }],
        changeHistory: [{ id: "CHANGE-VEH-UAT-001", field: "mileage", from: "83100", to: "84200", operator: "Tanya B.", time: "2026-08-05T10:30:00.000Z" }],
        createdAt: "2025-01-14T09:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
      }),
      baseVehicle({
        id: "VEH-UAT-002", plate: "4789 CP", vin: "1HGBH41JXMN100002", engineNumber: "ENG-UAT-002",
        make: "Toyota", model: "HiAce", makeZh: "丰田", modelZh: "海狮", variant: "Commuter", year: 2020, color: "White", powertrain: "Diesel",
        bodyType: "Stn/Wagon", seating: "5", ccRating: "1798", fuelType: "PETROL", mileage: 152300, mileageUnit: "km", mileageRecordedAt: "2026-08-07T08:00:00.000Z",
        usage: "Fleet", recentService: "Brake overhaul", recentServiceDate: "2026-08-07T08:00:00.000Z",
        photos: [{ id: "PHOTO-UAT-002-REG", kind: "registration", url: "/seed-photos/registration-sample-1.jpg", note: "注册证", linkedOrderId: null, uploadedBy: "Omar D.", uploadedAt: "2025-01-10T09:00:00.000Z" }],
        linkedOrderCount: 18, totalAmount: 520000, unpaidAmount: 120000,
        status: "on_site",
        serviceHistory: [{ id: "SERVICE-UAT-003", date: "2026-08-07T08:00:00.000Z", title: "Brake overhaul", mileage: 152300, amount: 65000, status: "in_progress" }],
        partsNeeds: [], tasks: [], attachments: [], changeHistory: [],
        createdAt: "2025-03-20T09:00:00.000Z", updatedAt: "2026-08-02T10:00:00.000Z",
      }),
      baseVehicle({
        id: "VEH-UAT-003", plate: "9154 DZ", vin: "1HGBH41JXMN100003", engineNumber: "ENG-UAT-003",
        make: "BMW", model: "X5", variant: "xDrive40i", year: 2022, color: "Black", powertrain: "Petrol",
        bodyType: "Hatch Back", seating: "5", ccRating: "1496", fuelType: "PETROL", mileage: 186500, mileageUnit: "km", mileageRecordedAt: "2026-08-07T08:00:00.000Z",
        usage: "Shared fleet", recentService: "Transmission service", recentServiceDate: "2026-08-07T08:00:00.000Z",
        linkedOrderCount: 22, totalAmount: 680000, unpaidAmount: 85000,
        status: "on_site",
        serviceHistory: [{ id: "SERVICE-UAT-004", date: "2026-08-07T08:00:00.000Z", title: "Transmission service", mileage: 186500, amount: 85000, status: "in_progress" }],
        partsNeeds: [{ id: "PART-UAT-003", name: "Clutch assembly", urgency: "urgent", status: "pending", estimatedCost: 45000 }],
        tasks: [], attachments: [], changeHistory: [],
        createdAt: "2025-02-01T09:00:00.000Z", updatedAt: "2026-08-03T10:00:00.000Z",
      }),
      baseVehicle({
        id: "VEH-UAT-004", plate: "0317 EV", vin: "1HGBH41JXMN100004", engineNumber: "ENG-UAT-004",
        make: "Nissan", model: "Note", makeZh: "日产", modelZh: "Note", variant: "SV", year: 2019, color: "Blue", powertrain: "Petrol",
        bodyType: "Hatch Back", seating: "5", ccRating: "1290", fuelType: "PETROL", mileage: 76500, mileageUnit: "km", mileageRecordedAt: "2026-07-30T09:00:00.000Z",
        usage: "Guest shuttle", recentService: "Annual inspection", recentServiceDate: "2026-07-30T09:00:00.000Z",
        photos: [{ id: "PHOTO-UAT-004-FIT", kind: "fitness", url: "/seed-photos/fitness-sample-1.jpg", note: "检验合格证", linkedOrderId: null, uploadedBy: "Tanya B.", uploadedAt: "2024-12-23T09:00:00.000Z" }],
        linkedOrderCount: 5, totalAmount: 98000, unpaidAmount: 0,
        status: "off_site", serviceHistory: [], partsNeeds: [], tasks: [], attachments: [], changeHistory: [],
        createdAt: "2025-07-19T09:00:00.000Z", updatedAt: "2026-07-30T10:00:00.000Z",
      }),
      ...bulkVehicles,
    ],
    relationships: [
      { id: "REL-UAT-001", vehicleId: "VEH-UAT-001", customerId: "CUST-UAT-001", startedAt: "2025-01-14T09:00:00.000Z", endedAt: null },
      { id: "REL-UAT-002", vehicleId: "VEH-UAT-002", customerId: "CUST-UAT-002", startedAt: "2025-03-20T09:00:00.000Z", endedAt: null },
      { id: "REL-UAT-003", vehicleId: "VEH-UAT-003", customerId: "CUST-UAT-003", startedAt: "2025-02-01T09:00:00.000Z", endedAt: "2026-01-31T18:00:00.000Z" },
      { id: "REL-UAT-004", vehicleId: "VEH-UAT-003", customerId: "CUST-UAT-001", startedAt: "2026-02-01T09:00:00.000Z", endedAt: "2026-07-01T00:00:00.000Z" },
      { id: "REL-UAT-005", vehicleId: "VEH-UAT-003", customerId: "CUST-UAT-002", startedAt: "2026-07-01T00:00:00.000Z", endedAt: null },
      { id: "REL-UAT-006", vehicleId: "VEH-UAT-004", customerId: "CUST-UAT-004", startedAt: "2025-07-19T09:00:00.000Z", endedAt: null },
      ...bulkRelationships,
    ],
  };
}

function assertFullRead(access?: CustomerVehicleAccessContext): asserts access is CustomerVehicleAccessContext {
  if (access === undefined || access === null) throw new Error("403 无权读取客户与车辆完整目录");
  if (typeof access !== "object" || typeof access.actorId !== "string" || !access.actorId.trim()
    || AUDIT_DATA_URL.test(access.actorId)
    || typeof access.role !== "string" || !access.role) throw new Error("401 无效会话");
  if (access.role !== "superadmin" && access.role !== "frontdesk_admin") {
    throw new Error("403 无权读取客户与车辆完整目录");
  }
}

function validation(message: string): never {
  throw new CustomerVehicleValidationError(message);
}

function stateValidationFailure(message: string): never {
  throw new CustomerVehicleValidationError(message, "CUSTOMER_VEHICLE_STATE_INVALID", 500);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isObject(value)) validation(`${label}必须是对象`);
}

function codedValidation(message: string, code: string, status = 400): never {
  throw new CustomerVehicleValidationError(message, code, status);
}

function assertVerificationInput(value: unknown): asserts value is Record<string, unknown> {
  if (!isObject(value)) {
    codedValidation("验证请求必须是对象", "CUSTOMER_VERIFICATION_INPUT_INVALID");
  }
}

function assertVerificationKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    codedValidation("验证请求包含未知字段", "CUSTOMER_VERIFICATION_INPUT_INVALID");
  }
}

function validateClientMutationId(value: Record<string, unknown>): void {
  if (typeof value.clientMutationId !== "string" || !value.clientMutationId.trim()) {
    codedValidation("clientMutationId 必须是非空字符串", "CUSTOMER_MUTATION_ID_REQUIRED");
  }
  if (AUDIT_DATA_URL.test(value.clientMutationId)) {
    codedValidation("clientMutationId 包含不安全内容", "CUSTOMER_MUTATION_ID_INVALID");
  }
}

function assertExactOnboardingInput(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!hasExactOwnStringKeys(value, keys)) {
    codedValidation("客户建档请求包含未知或缺失字段", "CUSTOMER_ONBOARDING_INPUT_INVALID");
  }
}

function assertSafeOnboardingId(value: unknown, code: string, message: string): asserts value is string {
  if (!isSafeOnboardingId(value)) codedValidation(message, code);
}

function validatePreviewOnboardingPhone(value: unknown): asserts value is PreviewOnboardingPhoneInput {
  assertExactOnboardingInput(value, ["customerType", "primaryPhone", "clientMutationId"]);
  if (value.customerType !== "individual" && value.customerType !== "organization") {
    codedValidation("客户类型无效", "CUSTOMER_ONBOARDING_INPUT_INVALID");
  }
  if (value.primaryPhone !== null && typeof value.primaryPhone !== "string") {
    codedValidation("建档手机号必须是字符串或 null", "CUSTOMER_ONBOARDING_INPUT_INVALID");
  }
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
}

function validateRequestOnboardingOtp(value: unknown): asserts value is RequestOnboardingOtpInput {
  assertExactOnboardingInput(value, ["clientMutationId"]);
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
}

function validateVerifyOnboardingOtp(value: unknown): asserts value is VerifyOnboardingOtpInput {
  assertExactOnboardingInput(value, ["otpChallengeId", "code", "clientMutationId"]);
  assertSafeOnboardingId(value.otpChallengeId, "CUSTOMER_ONBOARDING_OTP_CHALLENGE_INVALID", "OTP 挑战 ID 无效");
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
  if (typeof value.code !== "string" || !/^\d{6}$/.test(value.code)) {
    codedValidation("OTP 验证码无效", "CUSTOMER_ONBOARDING_OTP_CODE_INVALID");
  }
}

function opaqueOnboardingPayloadDigest(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

function normalizeOnboardingLicenseProfile(value: OnboardingLicenseProfile): OnboardingLicenseProfile {
  try {
    return normalizeDriverLicenseProfile(value);
  } catch {
    codedValidation("驾驶证四项资料无效", "CUSTOMER_ONBOARDING_KYC_PROFILE_INVALID");
  }
}

function validateSubmitOnboardingKyc(value: unknown): asserts value is SubmitOnboardingKycInput {
  assertExactOnboardingInput(value, ["frontAsset", "profile", "clientMutationId"]);
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
  if (!isObject(value.frontAsset) || !isObject(value.profile)) {
    codedValidation("驾驶证建档资料无效", "CUSTOMER_ONBOARDING_KYC_INPUT_INVALID");
  }
  try {
    validatePreparedLicenseEvidence(value.frontAsset);
  } catch (error) {
    if (error instanceof PreparedEvidenceError) codedValidation("驾驶证证据无效", "EVIDENCE_ASSET_INVALID");
    throw error;
  }
  if (!isSafeOnboardingId(value.frontAsset.id) || !isSafeOnboardingId(value.frontAsset.fileName)) {
    codedValidation("驾驶证证据标识无效", "EVIDENCE_ASSET_INVALID");
  }
  normalizeOnboardingLicenseProfile(value.profile as unknown as OnboardingLicenseProfile);
}

function validateVerifyOnboardingKyc(value: unknown): asserts value is VerifyOnboardingKycInput {
  assertExactOnboardingInput(value, ["kycDraftId", "attested", "clientMutationId"]);
  assertSafeOnboardingId(value.kycDraftId, "CUSTOMER_ONBOARDING_KYC_DRAFT_INVALID", "KYC 草稿 ID 无效");
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
  if (value.attested !== true) {
    codedValidation("必须明确核对到场本人及驾驶证原件", "CUSTOMER_ONBOARDING_KYC_ATTESTATION_REQUIRED");
  }
}

function validateClearOnboardingKyc(value: unknown): asserts value is ClearOnboardingKycInput {
  assertExactOnboardingInput(value, ["clientMutationId"]);
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
}

const ONBOARDING_CUSTOMER_DRAFT_KEYS = [
  "customerType", "organizationName", "nameSourceValue", "nameTransliterationToken",
  "primaryContactRole", "salutation", "language", "primaryPhone", "secondaryPhone", "whatsapp",
  "email", "preferredChannel", "address", "gender", "birthDate", "trn", "status", "reason",
] as const;

function validatePreviewOnboardingCustomer(value: unknown): asserts value is PreviewOnboardingCustomerInput {
  assertExactOnboardingInput(value, ["customer", "clientMutationId"]);
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
  if (!isObject(value.customer)
    || Reflect.ownKeys(value.customer).some((key) => typeof key !== "string"
      || !ONBOARDING_CUSTOMER_DRAFT_KEYS.includes(key as typeof ONBOARDING_CUSTOMER_DRAFT_KEYS[number]))) {
    codedValidation("客户建档资料包含未知字段", "CUSTOMER_ONBOARDING_INPUT_INVALID");
  }
  validateCustomerDraft(value.customer);
}

function validateCreateOnboardingCustomer(value: unknown): asserts value is CreateOnboardingCustomerInput {
  if (!hasExactOwnStringKeys(value, ["previewToken", "clientMutationId"])
    && !hasExactOwnStringKeys(value, ["previewToken", "confirmPossibleDuplicate", "clientMutationId"])) {
    codedValidation("客户建档创建请求包含未知或缺失字段", "CUSTOMER_ONBOARDING_INPUT_INVALID");
  }
  assertSafeOnboardingId(value.previewToken, "CUSTOMER_ONBOARDING_PREVIEW_INVALID", "客户建档预览凭证无效");
  assertSafeOnboardingId(value.clientMutationId, "CUSTOMER_MUTATION_ID_INVALID", "clientMutationId 无效");
  if (Object.prototype.hasOwnProperty.call(value, "confirmPossibleDuplicate")
    && typeof value.confirmPossibleDuplicate !== "boolean") {
    codedValidation("重复客户确认必须是布尔值", "CUSTOMER_ONBOARDING_INPUT_INVALID");
  }
}

function assertOnboardingToken(value: unknown): asserts value is string {
  assertSafeOnboardingId(value, "CUSTOMER_ONBOARDING_TOKEN_INVALID", "客户建档会话凭证无效");
}

function validateRequestCustomerOtp(value: unknown): asserts value is RequestCustomerOtpInput {
  assertVerificationInput(value);
  assertVerificationKeys(value, ["phoneE164", "clientMutationId"]);
  validateClientMutationId(value);
  if (typeof value.phoneE164 !== "string" || !value.phoneE164.trim()) {
    codedValidation("OTP 手机号必填", "OTP_PHONE_REQUIRED");
  }
}

function validateVerifyCustomerOtp(value: unknown): asserts value is VerifyCustomerOtpInput {
  assertVerificationInput(value);
  assertVerificationKeys(value, ["otpRecordId", "code", "clientMutationId"]);
  validateClientMutationId(value);
  if (typeof value.otpRecordId !== "string" || !value.otpRecordId.trim()) {
    codedValidation("OTP 记录 ID 必填", "OTP_RECORD_ID_REQUIRED");
  }
  if (typeof value.code !== "string" || !value.code.trim()) {
    codedValidation("OTP 验证码必填", "OTP_CODE_REQUIRED");
  }
}

function validateInvalidateCustomerOtp(value: unknown): asserts value is InvalidateCustomerOtpInput {
  assertVerificationInput(value);
  assertVerificationKeys(value, ["otpRecordId", "reason", "clientMutationId"]);
  validateClientMutationId(value);
  if (typeof value.otpRecordId !== "string" || !value.otpRecordId.trim()) {
    codedValidation("OTP 记录 ID 必填", "OTP_RECORD_ID_REQUIRED");
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    codedValidation("OTP 作废原因必填", "OTP_INVALIDATION_REASON_REQUIRED");
  }
}

function validateSubmitCustomerKyc(value: unknown): asserts value is SubmitCustomerKycInput {
  assertVerificationInput(value);
  const scoped = value.subjectType === "organization_primary_contact";
  assertVerificationKeys(value, scoped
    ? ["subjectType", "subjectProfile", "frontAsset", "backAsset", "clientMutationId"]
    : ["frontAsset", "backAsset", "clientMutationId"]);
  validateClientMutationId(value);
  if (!isObject(value.frontAsset)) {
    codedValidation("请提交驾驶证正面证据", "KYC_EVIDENCE_REQUIRED");
  }
  if (value.backAsset !== undefined && !isObject(value.backAsset)) {
    codedValidation("KYC 证据无效", "EVIDENCE_ASSET_INVALID");
  }
  if (scoped) {
    try {
      normalizeDriverLicenseProfile(value.subjectProfile);
    } catch {
      codedValidation("主要联系人驾驶证资料无效", "KYC_SUBJECT_PROFILE_INVALID");
    }
  }
}

function validateVerifyCustomerKyc(value: unknown): asserts value is VerifyCustomerKycInput {
  assertVerificationInput(value);
  assertVerificationKeys(value, ["kycRecordId", "clientMutationId"]);
  validateClientMutationId(value);
  if (typeof value.kycRecordId !== "string" || !value.kycRecordId.trim()) {
    codedValidation("未找到可核验的驾驶证证据", "KYC_EVIDENCE_REQUIRED", 409);
  }
}

function validatePrepareCustomerAgreementSigning(
  value: unknown,
): asserts value is PrepareCustomerAgreementSigningInput {
  assertVerificationInput(value);
  assertVerificationKeys(value, ["version", "signedBy"]);
  if (typeof value.version !== "string" || !value.version.trim()
    || typeof value.signedBy !== "string" || !value.signedBy.trim()) {
    codedValidation("协议版本与签署人必填", "AGREEMENT_INPUT_INVALID");
  }
  if (AUDIT_DATA_URL.test(value.version) || AUDIT_DATA_URL.test(value.signedBy)) {
    codedValidation("协议文本包含不安全内容", "AGREEMENT_INPUT_INVALID");
  }
}

function validateSignCustomerAgreement(value: unknown): asserts value is SignCustomerAgreementInput {
  assertVerificationInput(value);
  validateClientMutationId(value);
  if (value.medium !== "electronic" && value.medium !== "paper") {
    codedValidation("协议签署介质无效", "AGREEMENT_INPUT_INVALID");
  }
  if (typeof value.version !== "string" || !value.version.trim()
    || typeof value.signedBy !== "string" || !value.signedBy.trim()) {
    codedValidation("协议版本与签署人必填", "AGREEMENT_INPUT_INVALID");
  }
  if (AUDIT_DATA_URL.test(value.version) || AUDIT_DATA_URL.test(value.signedBy)) {
    codedValidation("协议文本包含不安全内容", "AGREEMENT_INPUT_INVALID");
  }
  if (value.medium === "electronic"
    && (!isObject(value.signatureAsset) || !isObject(value.signedDocumentAsset))) {
    codedValidation("电子协议需要签名与已签 PDF", "AGREEMENT_EVIDENCE_REQUIRED");
  }
  if (value.medium === "electronic"
    && (typeof value.signingToken !== "string" || !value.signingToken.trim()
      || AUDIT_DATA_URL.test(value.signingToken))) {
    codedValidation("电子协议签署时间凭证无效", "AGREEMENT_SIGNING_TOKEN_INVALID", 409);
  }
  assertVerificationKeys(value, value.medium === "electronic" ? [
    "medium", "version", "signedBy", "signatureAsset", "signedDocumentAsset", "signingToken", "clientMutationId",
  ] : [
    "medium", "version", "signedBy", "paperScanAsset", "physicalRecordNumber",
    "physicalStorageLocation", "clientMutationId",
  ]);
  if (value.medium === "paper") {
    if (value.paperScanAsset !== undefined && !isObject(value.paperScanAsset)) {
      codedValidation("纸质协议扫描证据无效", "EVIDENCE_ASSET_INVALID");
    }
    const physicalFields = ["physicalRecordNumber", "physicalStorageLocation"] as const;
    const physicalFieldPresent = physicalFields.map((field) =>
      Object.prototype.hasOwnProperty.call(value, field));
    for (const field of ["physicalRecordNumber", "physicalStorageLocation"] as const) {
      if (Object.prototype.hasOwnProperty.call(value, field) && typeof value[field] !== "string") {
        codedValidation("纸质协议归档信息无效", "AGREEMENT_EVIDENCE_REQUIRED");
      }
      if (typeof value[field] === "string" && AUDIT_DATA_URL.test(value[field])) {
        codedValidation("纸质协议归档信息包含不安全内容", "AGREEMENT_INPUT_INVALID");
      }
    }
    if (physicalFieldPresent.some(Boolean)
      && (!physicalFieldPresent.every(Boolean)
        || physicalFields.some((field) => !(value[field] as string).trim()))) {
      codedValidation("纸质协议归档信息必须成对填写", "AGREEMENT_EVIDENCE_REQUIRED");
    }
  }
}

function assertOptionalStrings(value: Record<string, unknown>, fields: string[], label: string): void {
  for (const field of fields) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
      validation(`${label}${field}必须是字符串或 null`);
    }
  }
}

function isStrictIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertOptionalTimestamp(value: unknown, label: string): void {
  if (value !== undefined && value !== null && !isStrictIsoTimestamp(value)) validation(`${label}必须是严格 ISO 时间`);
}

function assertNonNegativeNumber(value: unknown, label: string, integer = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || integer && !Number.isInteger(value)) {
    validation(`${label}无效`);
  }
}

function assertOptionalNonNegativeNumber(value: unknown, label: string, integer = false): void {
  if (value !== undefined && value !== null) assertNonNegativeNumber(value, label, integer);
}

function validateCustomerDraft(value: unknown): asserts value is CustomerDraftInput {
  assertObject(value, "客户输入");
  if (value.customerType !== "individual" && value.customerType !== "organization") validation("客户类型无效");
  assertOptionalStrings(value, [
    "nameSourceValue", "nameTransliterationToken", "organizationName", "primaryContactRole", "salutation", "language", "primaryPhone", "secondaryPhone", "whatsapp",
    "email", "address", "gender", "birthDate", "trn", "reason",
  ], "客户字段 ");
  if (value.status !== undefined && !["active", "inactive", "blacklisted"].includes(value.status as string)) validation("客户状态无效");
  if (value.preferredChannel !== undefined && !["whatsapp", "sms", "phone", "email"].includes(value.preferredChannel as string)) validation("首选联系渠道无效");
}

function validateExpectedRevision(value: Record<string, unknown>): void {
  if (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) validation("expectedRevision 无效");
}

function validatePreviewToken(value: Record<string, unknown>): void {
  if (typeof value.previewToken !== "string" || !value.previewToken) validation("previewToken 必须是非空字符串");
}

function validateCustomerCreate(value: unknown): asserts value is SaveCustomerInput {
  validateCustomerDraft(value);
  validatePreviewToken(value as unknown as Record<string, unknown>);
  const confirm = (value as unknown as Record<string, unknown>).confirmPossibleDuplicate;
  if (confirm !== undefined && typeof confirm !== "boolean") validation("confirmPossibleDuplicate 必须是布尔值");
}

function validateCustomerUpdatePreview(value: unknown): asserts value is PreviewCustomerUpdateInput {
  validateCustomerDraft(value);
  validateExpectedRevision(value as unknown as Record<string, unknown>);
}

function validateCustomerUpdate(value: unknown): asserts value is UpdateCustomerInput {
  validateCustomerUpdatePreview(value);
  validatePreviewToken(value as unknown as Record<string, unknown>);
  const confirm = (value as unknown as Record<string, unknown>).confirmPossibleDuplicate;
  if (confirm !== undefined && typeof confirm !== "boolean") validation("confirmPossibleDuplicate 必须是布尔值");
}

function validateVehicleDraft(value: unknown): asserts value is VehicleDraftInput {
  assertObject(value, "车辆输入");
  assertOptionalStrings(value, [
    "plate", "vin", "engineNumber", "make", "model", "variant", "color", "powertrain",
    "bodyType", "seating", "ccRating", "fuelType",
    "mileageRecordedAt", "usage", "specialNotes", "reason",
  ], "车辆字段 ");
  if (value.year !== undefined && value.year !== null
    && (typeof value.year !== "number" || !Number.isInteger(value.year))) validation("车辆年份无效");
  assertOptionalNonNegativeNumber(value.mileage, "车辆里程");
  if (value.mileageUnit !== undefined && value.mileageUnit !== "km" && value.mileageUnit !== "mile") validation("里程单位无效");
  if (value.status !== undefined && !["on_site", "off_site"].includes(value.status as string)) validation("车辆状态无效");
  assertOptionalTimestamp(value.mileageRecordedAt, "里程记录时间");

  if (value.relationships !== undefined) {
    if (!Array.isArray(value.relationships)) validation("车辆关系必须是数组");
    for (const relationship of value.relationships) {
      assertObject(relationship, "车辆关系");
      if (relationship.relationshipId !== undefined && relationship.relationshipId !== null
        && typeof relationship.relationshipId !== "string") validation("关系 ID 必须是字符串或 null");
      if (typeof relationship.customerId !== "string") validation("关联客户必须是字符串");
      if (!isStrictIsoTimestamp(relationship.startedAt)) validation("关联开始时间必须是严格 ISO 时间");
      if (relationship.endedAt !== null && !isStrictIsoTimestamp(relationship.endedAt)) validation("关联结束时间必须是严格 ISO 时间或 null");
      if (typeof relationship.endedAt === "string" && relationship.endedAt < relationship.startedAt) {
        validation("关联结束时间不能早于开始时间");
      }
    }
  }
}

function validateVehicleCreate(value: unknown): asserts value is SaveVehicleInput {
  validateVehicleDraft(value);
  validatePreviewToken(value as unknown as Record<string, unknown>);
}

function validateVehicleUpdatePreview(value: unknown): asserts value is PreviewVehicleUpdateInput {
  validateVehicleDraft(value);
  validateExpectedRevision(value as unknown as Record<string, unknown>);
}

function validateVehicleUpdate(value: unknown): asserts value is UpdateVehicleInput {
  validateVehicleUpdatePreview(value);
  validatePreviewToken(value as unknown as Record<string, unknown>);
}

function summaryFor(state: CustomerVehicleState): CustomerVehicleSummary {
  return {
    totalCustomers: state.customers.length,
    activeCustomers: state.customers.filter((customer) => customer.status === "active").length,
    totalVehicles: state.vehicles.length,
    activeVehicles: state.vehicles.filter((vehicle) => vehicle.status === "on_site").length,
    activeRelationships: state.relationships.filter((relationship) => relationship.endedAt === null).length,
  };
}

function text(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized || null;
}

function auditReason(value: string | null | undefined): string | null {
  const normalized = text(value);
  if (normalized && AUDIT_DATA_URL.test(normalized)) {
    throw new CustomerVehicleValidationError(
      "保存原因包含不允许的内容",
      "CUSTOMER_AUDIT_TEXT_INVALID",
      400,
    );
  }
  return normalized;
}

function phone(value: string | null | undefined): string | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  try {
    return normalizePhoneE164(trimmed, "JM");
  } catch {
    validation("电话号码必须可规范化为 E.164");
  }
}

function comparablePhone(value: string | null | undefined): string | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  try {
    return normalizePhoneE164(trimmed, "JM");
  } catch {
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (text(left) ?? "").toLocaleLowerCase() === (text(right) ?? "").toLocaleLowerCase();
}

function preferredChannelFor(input: CustomerDraftInput, primaryPhone: string | null, whatsapp: string | null, email: string | null) {
  if (input.preferredChannel) return input.preferredChannel;
  if (whatsapp) return "whatsapp" as const;
  if (primaryPhone) return "phone" as const;
  if (email) return "email" as const;
  return "sms" as const;
}

function normalizeCustomerInput(input: CustomerDraftInput, options: { requirePrimaryPhone?: boolean } = {}): NormalizedCustomerInput {
  const nameSourceValue = text(input.nameSourceValue);
  const organizationName = text(input.organizationName);
  const primaryContactRole = text(input.primaryContactRole);
  const primaryPhone = phone(input.primaryPhone);
  const secondaryPhone = phone(input.secondaryPhone);
  const whatsapp = phone(input.whatsapp);
  const emailValue = text(input.email)?.toLocaleLowerCase() ?? null;
  if (input.customerType === "individual" && !nameSourceValue) validation("客户姓名必填");
  if (input.customerType === "organization" && !organizationName) validation("机构名必填");
  // 2026-08-17 定案：没有手机号不能“开”客户资料（建档必填）；已有档案的编辑与 KYC 后补不拦，缺失只提醒
  if (options.requirePrimaryPhone !== false && !primaryPhone) validation("客户必须填写主要手机号（OTP 可稍后补验）");
  if (input.customerType === "individual" && (organizationName !== null || primaryContactRole !== null)) {
    throw new CustomerVehicleValidationError(
      "个人客户不能包含机构分支字段",
      "CUSTOMER_TYPE_FIELDS_INVALID",
      400,
    );
  }
  return {
    customerType: input.customerType,
    nameSourceValue,
    nameTransliterationToken: text(input.nameTransliterationToken),
    primaryContactRole,
    organizationName,
    salutation: text(input.salutation),
    language: text(input.language) ?? "English",
    primaryPhone,
    secondaryPhone,
    whatsapp,
    email: emailValue,
    preferredChannel: preferredChannelFor(input, primaryPhone, whatsapp, emailValue),
    address: text(input.address),
    gender: text(input.gender),
    birthDate: text(input.birthDate),
    trn: text(input.trn),
    status: input.status ?? "active",
    reason: auditReason(input.reason),
  };
}

function customerDraftFromRecord(customer: CustomerRecord): CustomerDraftInput {
  return {
    customerType: customer.customerType,
    nameSourceValue: customer.nameSourceValue,
    primaryContactRole: customer.primaryContactRole,
    organizationName: customer.organizationName,
    salutation: customer.salutation,
    language: customer.language,
    primaryPhone: customer.phone,
    secondaryPhone: customer.secondaryPhone,
    whatsapp: customer.whatsapp,
    email: customer.email,
    preferredChannel: customer.preferredChannel,
    address: customer.address,
    gender: customer.gender,
    birthDate: customer.birthDate,
    trn: customer.trn,
    status: customer.status,
  };
}

function plate(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\s+/g, "").toLocaleUpperCase();
  return normalized || null;
}

function normalizeVehicleInput(input: VehicleDraftInput, relationshipDefaults: VehicleCustomerRelationship[] = []): NormalizedVehicleInput {
  const make = text(input.make);
  const model = text(input.model);
  const year = input.year;
  if (!make) validation("车辆品牌必填");
  if (!model) validation("车辆车型必填");
  if (!Number.isInteger(year) || year! < 1886) validation("车辆年份无效");
  const relationshipsInput = input.relationships ?? relationshipDefaults.map((relationship) => ({
    relationshipId: relationship.id,
    customerId: relationship.customerId,
    startedAt: relationship.startedAt,
    endedAt: relationship.endedAt,
  }));
  const relationships = relationshipsInput.map((relationship) => {
    const customerId = text(relationship.customerId);
    if (!customerId) validation("关联客户必填");
    return {
      relationshipId: text(relationship.relationshipId),
      customerId,
      startedAt: relationship.startedAt,
      endedAt: relationship.endedAt,
    };
  });
  const relationshipIds = relationships.flatMap((relationship) => relationship.relationshipId ? [relationship.relationshipId] : []);
  if (new Set(relationshipIds).size !== relationshipIds.length) validation("关联记录重复");
  if (relationships.filter((relationship) => relationship.endedAt === null).length > 1) {
    validation("一辆车只能绑定一个当前客户");
  }
  return {
    plate: plate(input.plate),
    vin: text(input.vin) ?? "",
    engineNumber: text(input.engineNumber),
    makeZh: text(input.makeZh),
    modelZh: text(input.modelZh),
    make,
    model,
    variant: text(input.variant),
    year: year!,
    color: text(input.color),
    powertrain: text(input.powertrain),
    bodyType: text(input.bodyType),
    mileage: input.mileage ?? null,
    mileageUnit: input.mileageUnit ?? "km",
    mileageRecordedAt: input.mileageRecordedAt ?? null,
    usage: text(input.usage),
    specialNotes: text(input.specialNotes),
    seating: text(input.seating),
    ccRating: text(input.ccRating),
    fuelType: text(input.fuelType),
    status: input.status ?? "off_site",
    reason: auditReason(input.reason),
    relationships,
  };
}

function vehicleDraftFromRecord(vehicle: VehicleRecord): VehicleDraftInput {
  return {
    plate: vehicle.plate,
    vin: vehicle.vin,
    engineNumber: vehicle.engineNumber,
    make: vehicle.make,
    model: vehicle.model,
    makeZh: vehicle.makeZh,
    modelZh: vehicle.modelZh,
    variant: vehicle.variant,
    year: vehicle.year,
    color: vehicle.color,
    powertrain: vehicle.powertrain,
    bodyType: vehicle.bodyType, seating: vehicle.seating, ccRating: vehicle.ccRating, fuelType: vehicle.fuelType,
    mileage: vehicle.mileage,
    mileageUnit: vehicle.mileageUnit,
    mileageRecordedAt: vehicle.mileageRecordedAt,
    usage: vehicle.usage,
    specialNotes: vehicle.specialNotes,
    status: vehicle.status,
  };
}

function assertRelationshipCustomersExist(state: CustomerVehicleState, input: NormalizedVehicleInput): void {
  const customerIds = new Set(state.customers.map((customer) => customer.id));
  if (input.relationships.some((relationship) => !customerIds.has(relationship.customerId))) validation("关联客户不存在");
}

function duplicateCandidates(
  state: CustomerVehicleState,
  input: NormalizedCustomerInput,
  excludedCustomerId: string | null = null,
): CustomerDuplicateCandidate[] {
  let canonicalName: CustomerNameResult | null = null;
  if (input.nameSourceValue) {
    try { canonicalName = transliterateCustomerName(input.nameSourceValue); } catch { canonicalName = null; }
  }
  return state.customers.flatMap((customer) => {
    if (customer.id === excludedCustomerId) return [];
    const reasons: CustomerDuplicateCandidate["reasons"] = [];
    if (input.email && sameText(input.email, customer.email)) reasons.push("email");
    if (canonicalName?.nameZh && customer.nameZh && sameText(canonicalName.nameZh, customer.nameZh)) reasons.push("nameZh");
    if (canonicalName?.nameEn && customer.nameEn && sameText(canonicalName.nameEn, customer.nameEn)) reasons.push("nameEn");
    if (input.organizationName && sameText(input.organizationName, customer.organizationName)) reasons.push("organizationName");
    return reasons.length > 0 ? [{ customerId: customer.id, reasons }] : [];
  });
}

function assertCustomerPhoneOwnershipAvailable(
  state: CustomerVehicleState,
  incoming: Readonly<Partial<Record<OnboardingInputPhoneField, string | null>>>,
  excludedCustomerId: string | null = null,
): void {
  const matches = matchOnboardingPhones(
    excludedCustomerId ? state.customers.filter((entry) => entry.id !== excludedCustomerId) : state.customers,
    incoming,
  );
  if (matches.length > 0) {
    codedValidation("电话号码已属于其他客户档案", "CUSTOMER_PHONE_DUPLICATE", 409);
  }
}

function customerOwnsPhone(customer: CustomerRecord, phoneE164: string): boolean {
  return matchOnboardingPhones([customer], { primaryPhone: phoneE164 }).length > 0;
}

function assertCustomerUpdatePhonesAvailable(
  state: CustomerVehicleState,
  existing: CustomerRecord,
  input: NormalizedCustomerInput,
  excludedCustomerId: string,
): void {
  const changedPhone = (next: string | null, current: string | null) => {
    const comparable = comparablePhone(next);
    if (comparable === comparablePhone(current)) return null;
    return comparable && customerOwnsPhone(existing, comparable) ? null : next;
  };
  assertCustomerPhoneOwnershipAvailable(state, {
    primaryPhone: changedPhone(input.primaryPhone, existing.phone),
    secondaryPhone: changedPhone(input.secondaryPhone, existing.secondaryPhone),
    whatsapp: changedPhone(input.whatsapp, existing.whatsapp),
  }, excludedCustomerId);
}

function customerContent(customer: CustomerRecord): Omit<NormalizedCustomerInput, "reason" | "nameTransliterationToken"> {
  return {
    customerType: customer.customerType, organizationName: customer.organizationName,
    nameSourceValue: customer.nameSourceValue,
    primaryContactRole: customer.primaryContactRole,
    salutation: customer.salutation, language: customer.language, primaryPhone: customer.phone,
    secondaryPhone: customer.secondaryPhone, whatsapp: customer.whatsapp, email: customer.email,
    preferredChannel: customer.preferredChannel, address: customer.address,
    gender: customer.gender, birthDate: customer.birthDate, trn: customer.trn, status: customer.status,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sameCustomerContent(customer: CustomerRecord, input: NormalizedCustomerInput): boolean {
  const { reason: _reason, nameTransliterationToken: _nameTransliterationToken, ...content } = input;
  return stableJson(customerContent(customer)) === stableJson(content);
}

function vehicleContent(vehicle: VehicleRecord): Omit<NormalizedVehicleInput, "reason" | "relationships"> {
  return {
    plate: vehicle.plate || null, vin: vehicle.vin, engineNumber: vehicle.engineNumber, make: vehicle.make,
    model: vehicle.model, makeZh: vehicle.makeZh, modelZh: vehicle.modelZh, variant: vehicle.variant, year: vehicle.year, color: vehicle.color,
    powertrain: vehicle.powertrain, bodyType: vehicle.bodyType, seating: vehicle.seating, ccRating: vehicle.ccRating, fuelType: vehicle.fuelType, mileage: vehicle.mileage,
    mileageUnit: vehicle.mileageUnit, mileageRecordedAt: vehicle.mileageRecordedAt, usage: vehicle.usage,
    specialNotes: vehicle.specialNotes, status: vehicle.status,
  };
}

function sameVehicleContent(vehicle: VehicleRecord, input: NormalizedVehicleInput): boolean {
  const { reason: _reason, relationships: _relationships, ...content } = input;
  return stableJson(vehicleContent(vehicle)) === stableJson(content);
}

function sameRelationships(left: VehicleCustomerRelationship[], right: VehicleCustomerRelationship[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

let syntheticStateV3Cache: CustomerVehicleState | null = null;

function attachFreshSeedVerificationEvidence(state: CustomerVehicleState): CustomerVehicleState {
  const customers = state.customers.map((customer) => {
    if (customer.id !== "CUST-UAT-001") return customer;
    if (!customer.phone) throw new Error("Alicia fresh seed requires a canonical primary phone");
    return {
      ...customer,
      verificationArchive: {
        otpRecords: [{
          id: "OTP-UAT-ALICIA-001",
          phoneE164: customer.phone,
          requestedAt: "2026-01-14T09:15:00.000Z",
          verifiedAt: "2026-01-14T09:20:00.000Z",
          verifiedBy: "uat-seed",
        }],
        kycRecords: [{
          id: "KYC-UAT-ALICIA-DL-001",
          documentType: "drivers_license" as const,
          frontAsset: SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront,
          submittedAt: "2026-01-14T09:30:00.000Z",
          verifiedAt: "2026-01-14T09:35:00.000Z",
          verifiedBy: "uat-seed",
        }],
        agreementRecords: [{
          id: "AGR-UAT-ALICIA-1.3",
          version: "1.3",
          medium: "electronic" as const,
          signedAt: "2026-05-16T10:00:00.000Z",
          signedBy: "Alicia Bennett",
          recordedBy: "uat-seed",
          signatureAsset: SEED_EVIDENCE_ASSETS.aliciaAgreementSignature,
          signedDocumentAsset: SEED_EVIDENCE_ASSETS.aliciaSignedAgreement,
        }],
        evidenceGaps: [],
      },
    };
  });
  if (!customers.some((customer) => customer.id === "CUST-UAT-001")) {
    throw new Error("Alicia fresh seed customer is missing");
  }
  return { ...state, customers };
}

function syntheticStateV3(): CustomerVehicleState {
  if (!syntheticStateV3Cache) {
    const migrated = migrateCustomerVehicleEnvelope(
      { schemaVersion: 2, state: buildSyntheticUatState() },
      DEFAULT_TIMESTAMP,
    );
    if (!migrated) throw new Error("内置客户与车辆种子无法迁移到 schema v3");
    const seeded = attachFreshSeedVerificationEvidence(migrated.state);
    if (!validateCustomerVehicleStateV3(seeded)) throw new Error("内置客户验证证据不符合 schema v3");
    syntheticStateV3Cache = clone(seeded);
  }
  return clone(syntheticStateV3Cache);
}

function parseStoredRaw(raw: string, migratedAt: string): LoadedCustomerVehicleState {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw) as unknown;
  } catch {
    stateValidationFailure("持久化客户与车辆数据不符合 schema v3");
  }
  if (isCustomerEnvelopeV3(envelope)) {
    return { state: clone(envelope.state), shouldPersistMigration: false };
  }
  const migrated = migrateCustomerVehicleEnvelope(envelope, migratedAt);
  if (!migrated) stateValidationFailure("持久化客户与车辆数据不符合 schema v3");
  return { state: clone(migrated.state), shouldPersistMigration: true };
}

function storedState(storage: StorageLike | undefined, migratedAt: string): LoadedCustomerVehicleState | null {
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? null : parseStoredRaw(raw, migratedAt);
}

function storedNameFromConfirmed(result: CustomerNameResult): StoredCustomerName {
  return {
    nameSourceScript: result.sourceScript,
    nameSourceValue: result.sourceValue,
    nameZh: result.nameZh!,
    nameEn: result.nameEn,
    transliterationMethod: result.method,
    transliterationVersion: result.version,
    transliterationStatus: "confirmed",
  };
}

function customerNameFields(customer: CustomerRecord): StoredCustomerName {
  return {
    nameSourceScript: customer.nameSourceScript,
    nameSourceValue: customer.nameSourceValue,
    nameZh: customer.nameZh,
    nameEn: customer.nameEn,
    transliterationMethod: customer.transliterationMethod,
    transliterationVersion: customer.transliterationVersion,
    transliterationStatus: customer.transliterationStatus,
  } as StoredCustomerName;
}

function customerFromInput(
  id: string,
  input: NormalizedCustomerInput,
  occurredAt: string,
  name: StoredCustomerName,
): CustomerRecord {
  return {
    ...name,
    id,
    customerType: input.customerType,
    organizationName: input.organizationName,
    primaryContactRole: input.primaryContactRole,
    salutation: input.salutation,
    gender: input.gender,
    birthDate: input.birthDate,
    trn: input.trn,
    language: input.language,
    phone: input.primaryPhone,
    secondaryPhone: input.secondaryPhone,
    whatsapp: input.whatsapp,
    email: input.email,
    preferredChannel: input.preferredChannel,
    address: input.address,
    status: input.status,
    riskFlags: [],
    verificationArchive: { otpRecords: [], kycRecords: [], agreementRecords: [], evidenceGaps: [] },
    creditEligibility: {
      eligible: false, registeredAt: null, registeredBy: null, signatureNote: null,
      signatureDataUrl: null, cancelledAt: null, cancelledBy: null,
    },
    notes: [],
    revision: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function vehicleFromInput(id: string, input: NormalizedVehicleInput, occurredAt: string): VehicleRecord {
  return {
    id, plate: input.plate ?? "", vin: input.vin, engineNumber: input.engineNumber, make: input.make,
    model: input.model, makeZh: input.makeZh, modelZh: input.modelZh, variant: input.variant, year: input.year, color: input.color,
    powertrain: input.powertrain, bodyType: input.bodyType, seating: input.seating ?? null, ccRating: input.ccRating ?? null, fuelType: input.fuelType, mileage: input.mileage,
    mileageUnit: input.mileageUnit, mileageRecordedAt: input.mileageRecordedAt, usage: input.usage,
    specialNotes: input.specialNotes, photos: [], status: input.status, partsNeeds: [], tasks: [], attachments: [],
    revision: 1, createdAt: occurredAt, updatedAt: occurredAt,
  };
}

export function createMockCustomerVehicleStore(
  {
    initialState,
    storage,
    clock = () => DEFAULT_TIMESTAMP,
    customerId,
    vehicleId,
    relationshipId,
    faults = {},
    onboardingNowMs = Date.now,
  }: CreateMockCustomerVehicleStoreOptions = {},
): MockCustomerVehicleStore {
  let state: CustomerVehicleState | undefined;
  let migrationWritePending = false;
  let tokenSequence = 0;
  const failNext = { ...faults.failNext };
  const customerPreviews = new Map<string, CustomerPreviewRegistryEntry>();
  const customerNamePreviewReceipts = new Map<string, CustomerNamePreviewReceipt>();
  const customerAgreementSigningReceipts = new Map<string, CustomerAgreementSigningReceipt>();
  const vehiclePreviews = new Map<string, VehiclePreviewRegistryEntry>();
  const onboardingSessions = new Map<string, CustomerOnboardingSession>();
  const onboardingTokenByActor = new Map<string, string>();
  const phonePreviewReceiptsByActor = new Map<string, OnboardingMemoryReceipt>();

  const currentOnboardingNowMs = (): number => {
    const value = onboardingNowMs();
    if (!Number.isFinite(value) || value < 0) {
      codedValidation("客户建档会话时钟无效", "CUSTOMER_ONBOARDING_CLOCK_INVALID", 500);
    }
    return value;
  };

  const businessTimestamp = (): string => {
    const value = clock();
    if (!isStrictIsoTimestamp(value)) {
      codedValidation("客户建档业务时间无效", "CUSTOMER_ONBOARDING_CLOCK_INVALID", 500);
    }
    return value;
  };

  const deleteOnboardingSession = (token: string): void => {
    const session = onboardingSessions.get(token);
    if (!session) return;
    onboardingSessions.delete(token);
    if (onboardingTokenByActor.get(session.actorId) === token) onboardingTokenByActor.delete(session.actorId);
    const previewReceipt = phonePreviewReceiptsByActor.get(session.actorId);
    const response = previewReceipt?.response as Partial<OnboardingPhonePreviewResult> | undefined;
    if (response && "onboardingToken" in response && response.onboardingToken === token) {
      phonePreviewReceiptsByActor.delete(session.actorId);
    }
  };

  const cleanupExpiredOnboardingSessions = (): number => {
    const nowMs = currentOnboardingNowMs();
    for (const session of onboardingSessions.values()) {
      if (nowMs - session.lastTouchedAtMs > ONBOARDING_SESSION_TTL_MS) deleteOnboardingSession(session.token);
    }
    return nowMs;
  };

  const currentActorOnboardingSession = (
    actorId: string,
    token: string,
  ): CustomerOnboardingSession => {
    const session = onboardingSessions.get(token);
    if (!session || session.actorId !== actorId) {
      codedValidation("客户建档会话不可用", "CUSTOMER_ONBOARDING_SESSION_UNAVAILABLE", 404);
    }
    return session;
  };

  const deleteActorNamePreviewReceipts = (actorId: string): void => {
    for (const [token, receipt] of customerNamePreviewReceipts) {
      if (receipt.actorId === actorId) customerNamePreviewReceipts.delete(token);
    }
  };

  const receiptKey = (operation: string, clientMutationId: string): string =>
    `${operation}:${clientMutationId.trim()}`;

  const invalidateOnboardingCustomerPreview = (session: CustomerOnboardingSession): void => {
    session.customerPreview = null;
    for (const [receiptId, receipt] of session.memoryReceipts) {
      if (receipt.operation === "customer.preview") session.memoryReceipts.delete(receiptId);
    }
  };

  const memoryRetry = <T>(
    receipt: OnboardingMemoryReceipt | undefined,
    requestFingerprint: string,
  ): T | null => {
    if (!receipt) return null;
    if (receipt.requestFingerprint !== requestFingerprint) {
      codedValidation("幂等键对应的客户建档请求已变化", "CUSTOMER_ONBOARDING_IDEMPOTENCY_CONFLICT", 409);
    }
    return clone(receipt.response) as T;
  };

  const takeFault = (operation: MockCustomerVehicleOperation): void => {
    const message = failNext[operation];
    if (message !== undefined) {
      delete failNext[operation];
      throw new Error(message);
    }
  };
  const readState = (access?: CustomerVehicleAccessContext): CustomerVehicleState => {
    assertFullRead(access);
    takeFault("customerVehicleRead");
    if (!state) {
      if (initialState) {
        if (!validateCustomerVehicleStateV3(initialState)) throw new Error("初始客户与车辆状态不是有效的 schema v3");
        state = clone(initialState);
      } else {
        const stored = storedState(storage, DEFAULT_TIMESTAMP);
        state = stored?.state ?? syntheticStateV3();
        migrationWritePending = stored?.shouldPersistMigration ?? false;
        if (storage && migrationWritePending) {
          try {
            storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION, state }));
            migrationWritePending = false;
          } catch {
            // Keep the validated v3 view in memory while preserving the raw legacy envelope.
          }
        }
      }
    }
    return state;
  };
  const persist = (nextState: CustomerVehicleState, expectedSourceRevision: number, conflictMessage: string): void => {
    if (!validateCustomerVehicleStateV3(nextState)) {
      stateValidationFailure("客户与车辆写入状态不符合 schema v3");
    }
    if (!storage) return;
    const raw = storage.getItem(STORAGE_KEY);
    const loaded = raw === null ? null : parseStoredRaw(raw, DEFAULT_TIMESTAMP);
    const saved = loaded?.state ?? null;
    if (saved && saved.sourceRevision !== expectedSourceRevision) {
      state = clone(saved);
      throw new Error(conflictMessage);
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION, state: nextState }));
    migrationWritePending = false;
  };

  const scalarChanges = (
    fields: readonly string[],
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): CustomerAuditEvent["changes"] => fields.flatMap((field) => {
    const beforeValue = before?.[field] ?? null;
    const afterValue = after[field] ?? null;
    const scalar = (value: unknown): string | number | boolean | null =>
      value === null || ["string", "number", "boolean"].includes(typeof value)
        ? value as string | number | boolean | null
        : null;
    const beforeScalar = scalar(beforeValue);
    const afterScalar = scalar(afterValue);
    return beforeScalar === afterScalar ? [] : [{ field, before: beforeScalar, after: afterScalar }];
  });

  const customerAuditValues = (customer: CustomerRecord): Record<string, unknown> => ({
    customerType: customer.customerType,
    organizationName: customer.organizationName,
    primaryContactRole: customer.primaryContactRole,
    nameSourceScript: customer.nameSourceScript,
    nameSourceValue: customer.nameSourceValue,
    nameZh: customer.nameZh,
    nameEn: customer.nameEn,
    transliterationStatus: customer.transliterationStatus,
    salutation: customer.salutation,
    gender: customer.gender,
    birthDate: customer.birthDate,
    trn: customer.trn,
    language: customer.language,
    phone: customer.phone,
    secondaryPhone: customer.secondaryPhone,
    whatsapp: customer.whatsapp,
    email: customer.email,
    preferredChannel: customer.preferredChannel,
    address: customer.address,
    status: customer.status,
    riskFlagCount: customer.riskFlags.length,
    activeRiskFlagCount: customer.riskFlags.filter((flag) => flag.removedAt === null).length,
    creditEligible: customer.creditEligibility.eligible,
    noteCount: customer.notes.length,
  });

  const duplicateCandidateAuditChanges = (
    candidates: readonly CustomerDuplicateCandidate[],
  ): CustomerAuditEvent["changes"] => {
    if (candidates.length === 0) return [];
    return [{
      field: "duplicateCandidateCustomerIds",
      before: null,
      after: [...new Set(candidates.map((candidate) => candidate.customerId))].sort().join(","),
    }, {
      field: "duplicateCandidateReasons",
      before: null,
      after: [...new Set(candidates.flatMap((candidate) => candidate.reasons))].sort().join(","),
    }];
  };

  const vehicleAuditValues = (vehicle: VehicleRecord): Record<string, unknown> => ({
    plate: vehicle.plate,
    vin: vehicle.vin,
    engineNumber: vehicle.engineNumber,
    make: vehicle.make,
    makeZh: vehicle.makeZh,
    model: vehicle.model,
    modelZh: vehicle.modelZh,
    variant: vehicle.variant,
    year: vehicle.year,
    color: vehicle.color,
    powertrain: vehicle.powertrain,
    bodyType: vehicle.bodyType,
    seating: vehicle.seating,
    ccRating: vehicle.ccRating,
    fuelType: vehicle.fuelType,
    mileage: vehicle.mileage,
    mileageUnit: vehicle.mileageUnit,
    mileageRecordedAt: vehicle.mileageRecordedAt,
    usage: vehicle.usage,
    specialNotes: vehicle.specialNotes,
    status: vehicle.status,
    photoCount: vehicle.photos.length,
    partsNeedCount: vehicle.partsNeeds.length,
    taskCount: vehicle.tasks.length,
    attachmentCount: vehicle.attachments.length,
  });

  const addCustomerAudit = (
    nextState: CustomerVehicleState, action: "created" | "updated", access: CustomerVehicleAccessContext,
    before: CustomerRecord | null, after: CustomerRecord, reason: string | null, occurredAt: string,
    duplicateCandidates: readonly CustomerDuplicateCandidate[] = [],
  ): void => {
    const beforeValues = before ? customerAuditValues(before) : null;
    const afterValues = customerAuditValues(after);
    nextState.auditEvents.push({
      id: `audit-customer-${nextState.sourceRevision}`, customerId: after.id,
      eventType: action === "created" ? "customer_created" : "customer_updated",
      actorId: access.actorId, occurredAt, reason,
      summary: action === "created" ? "创建客户" : "更新客户",
      changes: [
        ...scalarChanges(Object.keys(afterValues), beforeValues, afterValues),
        ...duplicateCandidateAuditChanges(duplicateCandidates),
      ],
      evidenceAssetIds: [],
    });
  };
  const addVehicleAudit = (
    nextState: CustomerVehicleState, action: "created" | "updated", access: CustomerVehicleAccessContext,
    before: VehicleRecord | null, after: VehicleRecord, beforeRelationships: VehicleCustomerRelationship[],
    afterRelationships: VehicleCustomerRelationship[], reason: string | null, occurredAt: string,
  ): void => {
    const beforeValues = before ? vehicleAuditValues(before) : null;
    const afterValues = vehicleAuditValues(after);
    nextState.auditEvents.push({
      id: `audit-vehicle-${nextState.sourceRevision}`, vehicleId: after.id,
      eventType: action === "created" ? "vehicle_created" : "vehicle_updated",
      actorId: access.actorId, occurredAt, reason,
      summary: action === "created" ? "创建车辆" : "更新车辆",
      changes: scalarChanges(Object.keys(afterValues), beforeValues, afterValues),
      beforeRelationships: clone(beforeRelationships), afterRelationships: clone(afterRelationships),
    });
  };
  const resolveRelationships = (
    current: CustomerVehicleState, nextState: CustomerVehicleState, vehicleIdValue: string,
    input: NormalizedVehicleInput, requireAllExisting: boolean,
  ): VehicleCustomerRelationship[] => {
    assertRelationshipCustomersExist(current, input);
    const existing = current.relationships.filter((entry) => entry.vehicleId === vehicleIdValue);
    const draftsById = new Map(input.relationships.filter((entry) => entry.relationshipId !== null)
      .map((entry) => [entry.relationshipId!, entry]));
    if (requireAllExisting) {
      for (const relationship of existing) {
        const draft = draftsById.get(relationship.id);
        if (!draft || draft.customerId !== relationship.customerId || draft.startedAt !== relationship.startedAt
          || relationship.endedAt !== null && draft.endedAt !== relationship.endedAt) {
          validation("车辆关联历史不得删除或改写");
        }
      }
    }
    const existingIds = new Set(existing.map((entry) => entry.id));
    for (const draft of input.relationships) {
      if (draft.relationshipId !== null && !existingIds.has(draft.relationshipId)) validation("关联记录不存在");
    }
    const resolvedExisting = existing.map((relationship) => {
      const draft = draftsById.get(relationship.id);
      return draft ? { ...relationship, endedAt: draft.endedAt } : clone(relationship);
    });
    const newRelationships = input.relationships.filter((entry) => entry.relationshipId === null).map((entry, index) => ({
      id: relationshipId?.(nextState) ?? `REL-UAT-${String(nextState.relationships.length + index + 1).padStart(3, "0")}`,
      vehicleId: vehicleIdValue, customerId: entry.customerId, startedAt: entry.startedAt, endedAt: entry.endedAt,
    }));
    return [...resolvedExisting, ...newRelationships];
  };
  const resolveConfirmedName = (
    access: CustomerVehicleAccessContext,
    input: NormalizedCustomerInput,
    existing?: CustomerRecord,
  ): StoredCustomerName => {
    if (existing && (input.nameSourceValue === null && existing.nameSourceValue === null
      || input.nameSourceValue !== null && sameText(input.nameSourceValue, existing.nameSourceValue))) {
      return customerNameFields(existing);
    }
    if (!input.nameSourceValue || !input.nameTransliterationToken) {
      validation(input.customerType === "organization"
        ? "主要联系人姓名必填，请先预览并确认音译"
        : "请先预览并确认客户姓名音译");
    }
    const receipt = customerNamePreviewReceipts.get(input.nameTransliterationToken);
    if (!receipt || receipt.actorId !== access.actorId
      || !sameText(receipt.normalizedSourceValue, input.nameSourceValue)) {
      validation("客户姓名确认已失效，请重新确认");
    }
    return storedNameFromConfirmed(receipt.canonicalResult);
  };

  const customerById = (current: CustomerVehicleState, customerIdValue: string): CustomerRecord => {
    const customer = current.customers.find((entry) => entry.id === customerIdValue);
    if (!customer) codedValidation("客户不存在", "CUSTOMER_NOT_FOUND", 404);
    return customer;
  };

  const idempotentCreatedCustomer = (
    current: CustomerVehicleState,
    access: CustomerVehicleAccessContext,
    clientMutationId: string,
  ): CustomerRecord | null => {
    const receipt = current.mutationReceipts.find((entry) => entry.actorId === access.actorId
      && entry.clientMutationId === clientMutationId.trim() && entry.operation === "customer.create");
    if (!receipt) return null;
    return clone(customerById(current, receipt.resultEntityId));
  };

  const persistedEvidenceAssetIds = (current: CustomerVehicleState): Set<string> => {
    const ids = new Set<string>();
    for (const customer of current.customers) {
      for (const record of customer.verificationArchive.kycRecords) {
        ids.add(record.frontAsset.id);
        if (record.backAsset) ids.add(record.backAsset.id);
      }
      for (const record of customer.verificationArchive.agreementRecords) {
        if (record.medium === "electronic") {
          ids.add(record.signatureAsset.id);
          ids.add(record.signedDocumentAsset.id);
        } else if (record.paperScanAsset) ids.add(record.paperScanAsset.id);
      }
    }
    for (const vehicle of current.vehicles) {
      for (const attachment of vehicle.attachments) ids.add(attachment.id);
    }
    return ids;
  };

  const idempotentCustomerResult = (
    current: CustomerVehicleState,
    access: CustomerVehicleAccessContext,
    customerIdValue: string,
    clientMutationId: string,
    operation: CustomerVerificationOperation,
  ): CustomerRecord | null => {
    const receipt = current.mutationReceipts.find((entry) => entry.actorId === access.actorId
      && entry.clientMutationId === clientMutationId.trim() && entry.operation === operation);
    if (!receipt) return null;
    if (receipt.resultEntityId !== customerIdValue) {
      codedValidation("幂等键已绑定其他客户路径", "CUSTOMER_IDEMPOTENCY_CONFLICT", 409);
    }
    const customer = customerById(current, receipt.resultEntityId);
    if (customer.revision !== receipt.resultRevision) {
      codedValidation("幂等结果已被后续客户变更替代", "CUSTOMER_IDEMPOTENCY_RESULT_STALE", 409);
    }
    return clone(customer);
  };

  const sameEvidenceAsset = (left: EvidenceAsset, right: EvidenceAsset): boolean => (
    left.id === right.id
    && left.fileName === right.fileName
    && left.url === right.url
    && left.mimeType === right.mimeType
    && left.sizeBytes === right.sizeBytes
    && left.createdAt === right.createdAt
    && left.createdBy === right.createdBy
  );

  const idempotentCustomerKycSubmitResult = (
    current: CustomerVehicleState,
    access: CustomerVehicleAccessContext,
    customerIdValue: string,
    input: SubmitCustomerKycInput,
  ): CustomerRecord | null => {
    const receipt = current.mutationReceipts.find((entry) => entry.actorId === access.actorId
      && entry.clientMutationId === input.clientMutationId.trim() && entry.operation === "kyc.submit");
    if (!receipt) return null;
    const conflict = (): never => codedValidation(
      "幂等键对应的 KYC 提交请求已变化",
      "CUSTOMER_IDEMPOTENCY_CONFLICT",
      409,
    );
    if (receipt.resultEntityId !== customerIdValue) conflict();
    const customer = customerById(current, receipt.resultEntityId);
    if (customer.revision !== receipt.resultRevision) {
      codedValidation("幂等结果已被后续客户变更替代", "CUSTOMER_IDEMPOTENCY_RESULT_STALE", 409);
    }
    const record = customer.verificationArchive.kycRecords.at(-1);
    if (!record || record.submittedAt !== receipt.createdAt) return conflict();

    const frontAsset = finalizeKycAsset(input.frontAsset, access.actorId, receipt.createdAt);
    const backAsset = input.backAsset
      ? finalizeKycAsset(input.backAsset, access.actorId, receipt.createdAt)
      : undefined;
    assertValidKycEvidence({ ...input, frontAsset, ...(backAsset ? { backAsset } : {}) });
    if (!sameEvidenceAsset(record.frontAsset, frontAsset)
      || Boolean(record.backAsset) !== Boolean(backAsset)
      || record.backAsset && backAsset && !sameEvidenceAsset(record.backAsset, backAsset)) {
      conflict();
    }

    const scopedInput = input.subjectType === "organization_primary_contact";
    const scopedRecord = record.subjectType === "organization_primary_contact";
    if (scopedInput !== scopedRecord) conflict();
    if (input.subjectType === "organization_primary_contact"
      && record.subjectType === "organization_primary_contact") {
      const profile = normalizeDriverLicenseProfile(input.subjectProfile);
      if (record.subjectProfile.name !== profile.name
        || record.subjectProfile.birthDate !== profile.birthDate
        || record.subjectProfile.sex !== profile.sex
        || record.subjectProfile.address !== profile.address) {
        conflict();
      }
    }
    return clone(customer);
  };

  const commitVerificationMutation = (
    current: CustomerVehicleState,
    access: CustomerVehicleAccessContext,
    customerIdValue: string,
    clientMutationId: string,
    operation: CustomerVerificationOperation,
    build: (existing: CustomerRecord, occurredAt: string) => CustomerVerificationMutationResult,
  ): CustomerRecord => {
    const existing = customerById(current, customerIdValue);
    takeFault("customerVehicleSave");
    const occurredAt = clock();
    const built = build(clone(existing), occurredAt);
    const updated: CustomerRecord = {
      ...built.customer,
      revision: existing.revision + 1,
      updatedAt: occurredAt,
    };
    const nextState = clone(current);
    const customerIndex = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
    nextState.customers[customerIndex] = updated;
    nextState.sourceRevision += 1;
    nextState.auditEvents.push({
      id: `audit-customer-${nextState.sourceRevision}`,
      customerId: customerIdValue,
      eventType: built.eventType,
      actorId: access.actorId,
      occurredAt,
      reason: built.reason,
      summary: built.summary,
      changes: clone(built.changes),
      evidenceAssetIds: clone(built.evidenceAssetIds),
    });
    const receipt: CustomerMutationReceipt = {
      actorId: access.actorId,
      clientMutationId: clientMutationId.trim(),
      operation,
      resultEntityId: customerIdValue,
      resultRevision: updated.revision,
      createdAt: occurredAt,
    };
    nextState.mutationReceipts.push(receipt);
    persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
    state = nextState;
    return clone(updated);
  };

  const verificationRecordId = (
    prefix: "OTP" | "KYC" | "AGR",
    customerIdValue: string,
    recordCount: number,
  ): string => `${prefix}-${customerIdValue}-${String(recordCount + 1).padStart(3, "0")}`;

  const assertEvidenceAssetMetadata: (value: unknown) => asserts value is EvidenceAsset = (value) => {
    if (!isObject(value)) codedValidation("证据资产必须是对象", "EVIDENCE_ASSET_INVALID");
    const exactFields = ["id", "fileName", "url", "mimeType", "sizeBytes", "createdAt", "createdBy"];
    if (Object.keys(value).length !== exactFields.length
      || exactFields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
      codedValidation("证据资产元数据无效", "EVIDENCE_ASSET_INVALID");
    }
    for (const field of ["id", "fileName", "url", "createdBy"] as const) {
      if (typeof value[field] !== "string" || !value[field].trim()) {
        codedValidation("证据资产元数据无效", "EVIDENCE_ASSET_INVALID");
      }
    }
    if (AUDIT_DATA_URL.test(value.id as string)
      || AUDIT_DATA_URL.test(value.fileName as string)
      || AUDIT_DATA_URL.test(value.createdBy as string)
      || !["image/jpeg", "image/png", "application/pdf"].includes(String(value.mimeType))
      || !Number.isInteger(value.sizeBytes) || (value.sizeBytes as number) < 0
      || !isStrictIsoTimestamp(value.createdAt)) {
      codedValidation("证据资产元数据无效", "EVIDENCE_ASSET_INVALID");
    }
  };

  const assertUnusedEvidenceAssets = (current: CustomerVehicleState, assets: readonly EvidenceAsset[]): void => {
    const existingIds = persistedEvidenceAssetIds(current);
    const incomingIds = new Set<string>();
    for (const asset of assets) {
      if (existingIds.has(asset.id) || incomingIds.has(asset.id)) {
        codedValidation("证据资产 ID 已存在", "EVIDENCE_ASSET_INVALID", 409);
      }
      incomingIds.add(asset.id);
    }
  };

  const finalizeKycAsset = (asset: EvidenceAsset | PreparedLicenseEvidence, actorId: string, occurredAt: string): EvidenceAsset => {
    return "createdAt" in asset ? asset : finalizePreparedLicenseEvidence(asset, actorId, occurredAt);
  };

  const assertValidKycEvidence = (input: SubmitCustomerKycInput): void => {
    assertEvidenceAssetMetadata(input.frontAsset);
    if (input.backAsset) assertEvidenceAssetMetadata(input.backAsset);
    try {
      validateKycEvidence(input.frontAsset, input.backAsset);
    } catch (error) {
      if (error instanceof EvidenceAssetError) {
        codedValidation("KYC 证据无效", error.code);
      }
      throw error;
    }
  };

  const assertValidAgreement = (record: AgreementRecord): void => {
    if (record.medium === "electronic") {
      assertEvidenceAssetMetadata(record.signatureAsset);
      assertEvidenceAssetMetadata(record.signedDocumentAsset);
    } else if (record.paperScanAsset) assertEvidenceAssetMetadata(record.paperScanAsset);
    try {
      validateAgreementRecord(record);
    } catch (error) {
      if (error instanceof AgreementEvidenceRequiredError) {
        codedValidation("协议签署证据不完整", error.code);
      }
      if (error instanceof EvidenceAssetError) {
        codedValidation("协议签署证据无效", error.code);
      }
      throw error;
    }
  };

  const agreementRecordFromInput = (
    input: SignCustomerAgreementInput,
    id: string,
    signedAt: string,
    actorId: string,
  ): AgreementRecord => input.medium === "electronic" ? {
    id,
    version: input.version.trim(),
    medium: "electronic",
    signedAt,
    signedBy: input.signedBy.trim(),
    recordedBy: actorId,
    signatureAsset: clone(input.signatureAsset),
    signedDocumentAsset: clone(input.signedDocumentAsset),
  } : {
    id,
    version: input.version.trim(),
    medium: "paper",
    signedAt,
    signedBy: input.signedBy.trim(),
    recordedBy: actorId,
    ...(input.paperScanAsset ? { paperScanAsset: clone(input.paperScanAsset) } : {}),
    ...(input.physicalRecordNumber !== undefined
      ? { physicalRecordNumber: input.physicalRecordNumber.trim() } : {}),
    ...(input.physicalStorageLocation !== undefined
      ? { physicalStorageLocation: input.physicalStorageLocation.trim() } : {}),
  };

  return {
    previewOnboardingPhone: (access, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      validatePreviewOnboardingPhone(rawInput);
      const suppliedPhone = rawInput.primaryPhone?.trim() || null;
      let phoneE164: string | null = null;
      if (suppliedPhone) {
        try {
          phoneE164 = normalizePhoneE164(suppliedPhone, "JM");
        } catch {
          codedValidation("建档手机号无法规范化为 E.164", "CUSTOMER_ONBOARDING_PHONE_INVALID");
        }
      }
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint({
        customerType: rawInput.customerType,
        primaryPhone: phoneE164,
      });
      const previousReceipt = phonePreviewReceiptsByActor.get(access!.actorId);
      if (previousReceipt?.clientMutationId === clientMutationId) {
        const retry = memoryRetry<OnboardingPhonePreviewResult>(previousReceipt, requestFingerprint);
        if (retry) return retry;
      }

      const current = readState(access);
      const matches = matchOnboardingPhones(current.customers, { primaryPhone: phoneE164 });
      let response: OnboardingPhonePreviewResult;
      let session: CustomerOnboardingSession | null = null;
      if (phoneE164 !== null && matches.length > 0) {
        response = {
          status: "duplicate",
          phoneE164,
          matches: clone(matches),
          sourceRevision: current.sourceRevision,
        };
      } else {
        const createdAt = businessTimestamp();
        const token = `onboarding-${crypto.randomUUID()}`;
        if (!isSafeOnboardingId(token)) {
          codedValidation("客户建档会话凭证生成失败", "CUSTOMER_ONBOARDING_TOKEN_INVALID", 500);
        }
        session = {
          token,
          actorId: access!.actorId,
          customerType: rawInput.customerType,
          phoneE164,
          createdAt,
          phoneSourceRevision: current.sourceRevision,
          stage: "collecting",
          lastTouchedAtMs: nowMs,
          otp: null,
          kyc: null,
          customerPreview: null,
          memoryReceipts: new Map(),
        };
        response = {
          status: "clear",
          phoneE164,
          matches: [],
          sourceRevision: current.sourceRevision,
          onboardingToken: token,
          expiresAt: new Date(Date.parse(createdAt) + ONBOARDING_SESSION_TTL_MS).toISOString(),
        };
      }

      const priorToken = onboardingTokenByActor.get(access!.actorId);
      if (priorToken) deleteOnboardingSession(priorToken);
      if (session) {
        onboardingSessions.set(session.token, session);
        onboardingTokenByActor.set(session.actorId, session.token);
      }
      phonePreviewReceiptsByActor.set(access!.actorId, {
        operation: "phone.preview",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      return clone(response);
    },
    requestOnboardingOtp: (access, token, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      validateRequestOnboardingOtp(rawInput);
      const session = currentActorOnboardingSession(access!.actorId, token);
      const phoneE164 = session.phoneE164;
      if (phoneE164 === null) {
        codedValidation("建档手机号为空，不能请求 OTP", "CUSTOMER_ONBOARDING_PHONE_REQUIRED");
      }
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint({});
      const key = receiptKey("otp.request", clientMutationId);
      const retry = memoryRetry<OnboardingOtpChallenge>(session.memoryReceipts.get(key), requestFingerprint);
      if (retry) {
        session.lastTouchedAtMs = nowMs;
        return retry;
      }

      const current = readState(access);
      try {
        assertCustomerPhoneOwnershipAvailable(current, { primaryPhone: phoneE164 });
      } catch (error) {
        deleteOnboardingSession(session.token);
        throw error;
      }
      if (session.otp !== null) {
        codedValidation("OTP 已请求，请使用原挑战继续", "CUSTOMER_ONBOARDING_OTP_ALREADY_REQUESTED", 409);
      }
      const requestedAt = businessTimestamp();
      const challengeId = `onboarding-otp-${crypto.randomUUID()}`;
      if (!isSafeOnboardingId(challengeId)) {
        codedValidation("OTP 挑战生成失败", "CUSTOMER_ONBOARDING_OTP_CHALLENGE_INVALID", 500);
      }
      const response: OnboardingOtpChallenge = {
        otpChallengeId: challengeId,
        phoneE164,
        requestedAt,
      };
      invalidateOnboardingCustomerPreview(session);
      session.phoneSourceRevision = current.sourceRevision;
      session.stage = "collecting";
      session.lastTouchedAtMs = nowMs;
      session.otp = { challengeId, requestedAt, verifiedAt: null };
      session.memoryReceipts.set(key, {
        operation: "otp.request",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      takeFault("customerOnboardingOtpRequestResponse");
      return clone(response);
    },
    verifyOnboardingOtp: (access, token, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      validateVerifyOnboardingOtp(rawInput);
      const session = currentActorOnboardingSession(access!.actorId, token);
      const phoneE164 = session.phoneE164;
      if (phoneE164 === null) {
        codedValidation("建档手机号为空，不能验证 OTP", "CUSTOMER_ONBOARDING_PHONE_REQUIRED");
      }
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint({
        otpChallengeId: rawInput.otpChallengeId.trim(),
        code: rawInput.code,
      });
      const key = receiptKey("otp.verify", clientMutationId);
      const retry = memoryRetry<OnboardingOtpVerification>(session.memoryReceipts.get(key), requestFingerprint);
      if (retry) {
        session.lastTouchedAtMs = nowMs;
        return retry;
      }
      if (!session.otp || session.otp.verifiedAt !== null
        || session.otp.challengeId !== rawInput.otpChallengeId.trim()) {
        codedValidation("OTP 挑战不可用", "CUSTOMER_ONBOARDING_OTP_CHALLENGE_INVALID", 409);
      }
      if (rawInput.code !== "123456") {
        codedValidation("OTP 验证码错误", "CUSTOMER_ONBOARDING_OTP_CODE_INVALID");
      }
      assertCustomerPhoneOwnershipAvailable(readState(access), { primaryPhone: phoneE164 });
      const verifiedAt = businessTimestamp();
      const response: OnboardingOtpVerification = {
        otpChallengeId: session.otp.challengeId,
        phoneE164,
        verifiedAt,
      };
      session.otp.verifiedAt = verifiedAt;
      invalidateOnboardingCustomerPreview(session);
      session.stage = "collecting";
      session.lastTouchedAtMs = nowMs;
      session.memoryReceipts.set(key, {
        operation: "otp.verify",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      takeFault("customerOnboardingOtpVerifyResponse");
      return clone(response);
    },
    submitOnboardingKyc: (access, token, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      validateSubmitOnboardingKyc(rawInput);
      const session = currentActorOnboardingSession(access!.actorId, token);
      const profile = normalizeOnboardingLicenseProfile(rawInput.profile);
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint({
        frontAsset: {
          id: rawInput.frontAsset.id,
          fileName: rawInput.frontAsset.fileName,
          mimeType: rawInput.frontAsset.mimeType,
          sizeBytes: rawInput.frontAsset.sizeBytes,
          payloadDigest: opaqueOnboardingPayloadDigest(rawInput.frontAsset.url),
        },
        profile,
      });
      const key = receiptKey("kyc.submit", clientMutationId);
      const existingReceipt = session.memoryReceipts.get(key);
      if (existingReceipt?.superseded) {
        codedValidation("KYC 草稿已由证件清除操作取代", "CUSTOMER_ONBOARDING_KYC_SUPERSEDED", 409);
      }
      const retry = memoryRetry<OnboardingKycSubmission>(existingReceipt, requestFingerprint);
      if (retry) {
        session.lastTouchedAtMs = nowMs;
        return retry;
      }
      const submittedAt = businessTimestamp();
      let frontAsset: EvidenceAsset;
      try {
        frontAsset = finalizePreparedLicenseEvidence(rawInput.frontAsset, access!.actorId, submittedAt);
        validateKycEvidence(frontAsset);
      } catch (error) {
        if (error instanceof PreparedEvidenceError || error instanceof EvidenceAssetError) {
          codedValidation("驾驶证证据无效", "EVIDENCE_ASSET_INVALID");
        }
        throw error;
      }
      const draftId = `onboarding-kyc-${crypto.randomUUID()}`;
      if (!isSafeOnboardingId(draftId)) {
        codedValidation("KYC 草稿生成失败", "CUSTOMER_ONBOARDING_KYC_DRAFT_INVALID", 500);
      }
      const response: OnboardingKycSubmission = { kycDraftId: draftId, submittedAt };
      deleteActorNamePreviewReceipts(access!.actorId);
      session.kyc = {
        draftId,
        frontAsset: clone(frontAsset),
        profile: clone(profile),
        submittedAt,
        verifiedAt: null,
        verifiedBy: null,
      };
      invalidateOnboardingCustomerPreview(session);
      session.stage = "collecting";
      session.lastTouchedAtMs = nowMs;
      for (const [receiptId, receipt] of session.memoryReceipts) {
        if (receipt.operation === "kyc.verify") {
          session.memoryReceipts.delete(receiptId);
        }
      }
      session.memoryReceipts.set(key, {
        operation: "kyc.submit",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      takeFault("customerOnboardingKycSubmitResponse");
      return clone(response);
    },
    verifyOnboardingKyc: (access, token, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      validateVerifyOnboardingKyc(rawInput);
      const session = currentActorOnboardingSession(access!.actorId, token);
      if (!session.kyc || session.kyc.draftId !== rawInput.kycDraftId.trim()) {
        codedValidation("KYC 草稿不可用", "CUSTOMER_ONBOARDING_KYC_DRAFT_INVALID", 409);
      }
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint({
        kycDraftId: rawInput.kycDraftId.trim(),
        attested: true,
      });
      const key = receiptKey("kyc.verify", clientMutationId);
      const retry = memoryRetry<OnboardingKycConfirmation>(session.memoryReceipts.get(key), requestFingerprint);
      if (retry) {
        session.lastTouchedAtMs = nowMs;
        return retry;
      }
      if (session.kyc.verifiedAt !== null
        || session.kyc.verifiedBy !== null) {
        codedValidation("KYC 草稿不再待确认", "CUSTOMER_ONBOARDING_KYC_NOT_PENDING", 409);
      }
      try {
        validateKycEvidence(session.kyc.frontAsset);
      } catch (error) {
        if (error instanceof EvidenceAssetError) {
          codedValidation("驾驶证证据无效", "EVIDENCE_ASSET_INVALID");
        }
        throw error;
      }
      const profile = normalizeOnboardingLicenseProfile(session.kyc.profile);
      if (stableJson(profile) !== stableJson(session.kyc.profile)) {
        codedValidation("KYC 四项资料已变化", "CUSTOMER_ONBOARDING_KYC_PROFILE_CHANGED", 409);
      }
      const verifiedAt = businessTimestamp();
      session.kyc.verifiedAt = verifiedAt;
      session.kyc.verifiedBy = access!.actorId;
      invalidateOnboardingCustomerPreview(session);
      session.stage = "collecting";
      session.lastTouchedAtMs = nowMs;
      const response: OnboardingKycConfirmation = {
        kycDraftId: session.kyc.draftId,
        profile: clone(session.kyc.profile),
        verifiedAt,
      };
      session.memoryReceipts.set(key, {
        operation: "kyc.verify",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      takeFault("customerOnboardingKycVerifyResponse");
      return clone(response);
    },
    clearOnboardingKyc: (access, token, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      validateClearOnboardingKyc(rawInput);
      const session = currentActorOnboardingSession(access!.actorId, token);
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint({});
      const key = receiptKey("kyc.clear", clientMutationId);
      const retry = memoryRetry<ClearOnboardingKycResult>(session.memoryReceipts.get(key), requestFingerprint);
      if (retry) {
        session.lastTouchedAtMs = nowMs;
        return retry;
      }

      session.kyc = null;
      invalidateOnboardingCustomerPreview(session);
      session.stage = "collecting";
      session.lastTouchedAtMs = nowMs;
      for (const [receiptId, receipt] of session.memoryReceipts) {
        if (receipt.operation === "kyc.submit") {
          session.memoryReceipts.set(receiptId, { ...receipt, superseded: true });
        } else if (receipt.operation === "kyc.verify") {
          session.memoryReceipts.delete(receiptId);
        }
      }
      const response: ClearOnboardingKycResult = { cleared: true };
      session.memoryReceipts.set(key, {
        operation: "kyc.clear",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      takeFault("customerOnboardingKycClearResponse");
      return clone(response);
    },
    previewOnboardingCustomer: (access, token, rawInput) => {
      assertFullRead(access);
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      validatePreviewOnboardingCustomer(rawInput);
      const session = currentActorOnboardingSession(access!.actorId, token);
      if (rawInput.customer.customerType !== session.customerType) {
        codedValidation("客户类型与建档会话不一致", "CUSTOMER_ONBOARDING_CUSTOMER_TYPE_MISMATCH", 409);
      }
      const clientMutationId = rawInput.clientMutationId.trim();
      const requestFingerprint = onboardingRequestFingerprint(rawInput.customer);
      const key = receiptKey("customer.preview", clientMutationId);
      const existingReceipt = session.memoryReceipts.get(key);
      if (existingReceipt) {
        const retry = memoryRetry<OnboardingCustomerPreviewResult>(existingReceipt, requestFingerprint);
        if (retry?.status === "ready" && (!session.customerPreview || session.customerPreview.previewToken !== retry.previewToken)) {
          codedValidation("客户建档预览已失效", "CUSTOMER_ONBOARDING_PREVIEW_INVALID", 409);
        }
        if (retry?.status === "phone_conflict" && session.customerPreview !== null) {
          codedValidation("客户建档预览已失效", "CUSTOMER_ONBOARDING_PREVIEW_INVALID", 409);
        }
        session.lastTouchedAtMs = nowMs;
        return retry!;
      }
      const current = readState(access);
      const input = normalizeCustomerInput(rawInput.customer);
      if (input.primaryPhone !== session.phoneE164) {
        codedValidation("主要手机号必须与 OTP 验证手机号一致", "CUSTOMER_ONBOARDING_PHONE_MISMATCH", 409);
      }
      const confirmedName = resolveConfirmedName(access!, input);
      input.nameSourceValue = confirmedName.nameSourceValue;
      if (!input.nameTransliterationToken) {
        codedValidation("客户姓名确认已失效", "CUSTOMER_ONBOARDING_NAME_CONFIRMATION_REQUIRED", 409);
      }
      const phoneMatches = matchOnboardingPhones(current.customers, {
        primaryPhone: input.primaryPhone,
        secondaryPhone: input.secondaryPhone,
        whatsapp: input.whatsapp,
      });
      if (phoneMatches.some((match) => match.incomingField === "primaryPhone")) {
        codedValidation("电话号码已属于其他客户档案", "CUSTOMER_PHONE_DUPLICATE", 409);
      }
      if (phoneMatches.length > 0) {
        const response: OnboardingCustomerPreviewResult = {
          status: "phone_conflict",
          matches: clone(phoneMatches),
          sourceRevision: current.sourceRevision,
        };
        invalidateOnboardingCustomerPreview(session);
        session.stage = "collecting";
        session.lastTouchedAtMs = nowMs;
        session.memoryReceipts.set(key, {
          operation: "customer.preview",
          clientMutationId,
          requestFingerprint,
          response: clone(response),
        });
        return clone(response);
      }
      const candidates = duplicateCandidates(current, input);
      const previewToken = `onboarding-customer-preview-${crypto.randomUUID()}`;
      if (!isSafeOnboardingId(previewToken)) {
        codedValidation("客户建档预览生成失败", "CUSTOMER_ONBOARDING_PREVIEW_INVALID", 500);
      }
      const response: OnboardingCustomerPreview = {
        status: "ready",
        input: clone(input),
        candidates: clone(candidates),
        sourceRevision: current.sourceRevision,
        previewToken,
        reminders: onboardingReminders(session, input),
      };
      session.customerPreview = {
        previewToken,
        input: clone(input),
        candidates: clone(candidates),
        sourceRevision: current.sourceRevision,
        actorId: access!.actorId,
        phoneE164: session.phoneE164,
        otp: session.otp ? clone(session.otp) : null,
        kyc: session.kyc ? {
          draftId: session.kyc.draftId,
          evidenceAssetId: session.kyc.frontAsset.id,
          profile: clone(session.kyc.profile),
          submittedAt: session.kyc.submittedAt,
          verifiedAt: session.kyc.verifiedAt,
          verifiedBy: session.kyc.verifiedBy,
        } : null,
        status: "ready",
        reminders: clone(response.reminders),
        nameTransliterationToken: input.nameTransliterationToken,
      };
      session.stage = "customer_previewed";
      session.lastTouchedAtMs = nowMs;
      session.memoryReceipts.set(key, {
        operation: "customer.preview",
        clientMutationId,
        requestFingerprint,
        response: clone(response),
      });
      return clone(response);
    },
    createOnboardingCustomer: (access, token, rawInput) => {
      assertFullRead(access);
      validateCreateOnboardingCustomer(rawInput);
      const current = readState(access);
      const persistedRetry = idempotentCreatedCustomer(current, access!, rawInput.clientMutationId);
      if (persistedRetry) return persistedRetry;
      const nowMs = cleanupExpiredOnboardingSessions();
      assertOnboardingToken(token);
      const session = currentActorOnboardingSession(access!.actorId, token);
      const preview = session.customerPreview;
      if (session.stage !== "customer_previewed" || !preview
        || preview.previewToken !== rawInput.previewToken.trim()
        || preview.actorId !== access!.actorId
        || preview.phoneE164 !== session.phoneE164
        || stableJson(preview.otp) !== stableJson(session.otp)
        || stableJson(preview.kyc) !== stableJson(session.kyc ? {
          draftId: session.kyc.draftId,
          evidenceAssetId: session.kyc.frontAsset.id,
          profile: session.kyc.profile,
          submittedAt: session.kyc.submittedAt,
          verifiedAt: session.kyc.verifiedAt,
          verifiedBy: session.kyc.verifiedBy,
        } : null)
        || preview.status !== "ready"
        || stableJson(preview.reminders) !== stableJson(onboardingReminders(session, preview.input))
        || preview.nameTransliterationToken !== preview.input.nameTransliterationToken) {
        codedValidation("客户建档预览不可用", "CUSTOMER_ONBOARDING_PREVIEW_INVALID", 409);
      }
      if (preview.input.primaryPhone !== session.phoneE164) {
        codedValidation("主要手机号必须与 OTP 验证手机号一致", "CUSTOMER_ONBOARDING_PHONE_MISMATCH", 409);
      }
      assertCustomerPhoneOwnershipAvailable(current, {
        primaryPhone: preview.input.primaryPhone,
        secondaryPhone: preview.input.secondaryPhone,
        whatsapp: preview.input.whatsapp,
      });
      if (session.kyc && persistedEvidenceAssetIds(current).has(session.kyc.frontAsset.id)) {
        codedValidation("证据资产 ID 已存在", "EVIDENCE_ASSET_INVALID", 409);
      }
      const confirmedName = resolveConfirmedName(access!, preview.input);
      if (confirmedName.nameSourceValue !== preview.input.nameSourceValue) {
        codedValidation("客户姓名确认已失效", "CUSTOMER_ONBOARDING_NAME_CONFIRMATION_REQUIRED", 409);
      }
      if (preview.sourceRevision !== current.sourceRevision) {
        codedValidation("源数据已变化，请重新预览", "CUSTOMER_ONBOARDING_SOURCE_REVISION_CONFLICT", 409);
      }
      const candidates = duplicateCandidates(current, preview.input);
      if (stableJson(candidates) !== stableJson(preview.candidates)) {
        codedValidation("重复客户候选已变化，请重新预览", "CUSTOMER_ONBOARDING_SOURCE_REVISION_CONFLICT", 409);
      }
      takeFault("customerVehicleSave");
      const occurredAt = businessTimestamp();
      const nextState = clone(current);
      const id = customerId?.(nextState)
        ?? `CUST-UAT-${String(nextState.customers.length + 1).padStart(3, "0")}`;
      const otpRecordId = verificationRecordId("OTP", id, 0);
      const kycRecordId = verificationRecordId("KYC", id, 0);
      const customer = customerFromInput(id, preview.input, occurredAt, confirmedName);
      const otpRecords = session.otp && session.phoneE164 ? [{
        id: otpRecordId,
        phoneE164: session.phoneE164,
        requestedAt: session.otp.requestedAt,
        ...(session.otp.verifiedAt ? {
          verifiedAt: session.otp.verifiedAt,
          verifiedBy: access!.actorId,
        } : {}),
      }] : [];
      const kycBase = session.kyc ? {
        id: kycRecordId,
        documentType: "drivers_license" as const,
        frontAsset: clone(session.kyc.frontAsset),
        submittedAt: session.kyc.submittedAt,
        ...(session.kyc.verifiedAt && session.kyc.verifiedBy ? {
          verifiedAt: session.kyc.verifiedAt,
          verifiedBy: session.kyc.verifiedBy,
        } : {}),
      } : null;
      const kycRecords: KycVerificationRecord[] = !session.kyc || !kycBase
        ? []
        : session.customerType === "organization"
          ? [{
              ...kycBase,
              subjectType: "organization_primary_contact",
              subjectProfile: clone(session.kyc.profile),
            }]
          : [kycBase];
      const evidenceGaps: CustomerRecord["verificationArchive"]["evidenceGaps"][number][] = [];
      if (!session.otp) evidenceGaps.push({
        kind: "otp",
        reason: "onboarding_incomplete",
        status: session.phoneE164 === null ? "phone_missing" : "not_requested",
        recordedAt: occurredAt,
        recordedBy: access!.actorId,
      });
      if (!session.kyc) evidenceGaps.push({
        kind: "kyc",
        reason: "onboarding_incomplete",
        subjectType: session.customerType === "organization" ? "organization_primary_contact" : "customer",
        status: "evidence_missing",
        recordedAt: occurredAt,
        recordedBy: access!.actorId,
      });
      const created: CustomerRecord = {
        ...customer,
        verificationArchive: {
          ...customer.verificationArchive,
          otpRecords,
          kycRecords,
          evidenceGaps,
        },
      };
      nextState.customers.push(created);
      nextState.sourceRevision += 1;
      const events: CustomerAuditEvent[] = [];
      if (session.otp) {
        events.push({
          id: `audit-customer-${nextState.sourceRevision}-onboarding-otp-requested`,
          customerId: id,
          eventType: "otp_requested",
          actorId: access!.actorId,
          occurredAt: session.otp.requestedAt,
          reason: null,
          summary: "请求 OTP 验证",
          changes: [
            { field: "otpRecordId", before: null, after: otpRecordId },
            { field: "phoneE164", before: null, after: session.phoneE164 },
            { field: "requestedAt", before: null, after: session.otp.requestedAt },
          ],
          evidenceAssetIds: [],
        });
        if (session.otp.verifiedAt) events.push({
          id: `audit-customer-${nextState.sourceRevision}-onboarding-otp-verified`,
          customerId: id,
          eventType: "otp_verified",
          actorId: access!.actorId,
          occurredAt: session.otp.verifiedAt,
          reason: null,
          summary: "完成 OTP 验证",
          changes: [
            { field: "otpRecordId", before: null, after: otpRecordId },
            { field: "verifiedAt", before: null, after: session.otp.verifiedAt },
          ],
          evidenceAssetIds: [],
        });
      }
      if (session.kyc) {
        const organizationContact = session.customerType === "organization";
        const subjectChanges: CustomerAuditEvent["changes"] = organizationContact
          ? [{ field: "subjectType", before: null, after: "organization_primary_contact" }]
          : [];
        events.push({
          id: `audit-customer-${nextState.sourceRevision}-onboarding-kyc-submitted`,
          customerId: id,
          eventType: "kyc_submitted",
          actorId: access!.actorId,
          occurredAt: session.kyc.submittedAt,
          reason: null,
          summary: organizationContact ? "提交主要联系人驾驶证证据" : "提交驾驶证 KYC 证据",
          changes: [
            { field: "kycRecordId", before: null, after: kycRecordId },
            { field: "documentType", before: null, after: "drivers_license" },
            ...subjectChanges,
            { field: "submittedAt", before: null, after: session.kyc.submittedAt },
          ],
          evidenceAssetIds: [session.kyc.frontAsset.id],
        });
        if (session.kyc.verifiedAt) events.push({
          id: `audit-customer-${nextState.sourceRevision}-onboarding-kyc-verified`,
          customerId: id,
          eventType: "kyc_verified",
          actorId: access!.actorId,
          occurredAt: session.kyc.verifiedAt!,
          reason: null,
          summary: organizationContact ? "完成主要联系人驾驶证核验" : "完成驾驶证 KYC 核验",
          changes: [
            { field: "kycRecordId", before: null, after: kycRecordId },
            ...subjectChanges,
            { field: "verifiedAt", before: null, after: session.kyc.verifiedAt! },
          ],
          evidenceAssetIds: [session.kyc.frontAsset.id],
        });
      }
      events.push({
        id: `audit-customer-${nextState.sourceRevision}-onboarding-created`,
        customerId: id,
        eventType: "customer_created",
        actorId: access!.actorId,
        occurredAt,
        reason: preview.input.reason,
        summary: preview.reminders.length > 0 ? "创建客户；后续验证资料待补" : "创建客户",
        changes: [
          ...scalarChanges(Object.keys(customerAuditValues(created)), null, customerAuditValues(created)),
          ...duplicateCandidateAuditChanges(preview.candidates),
        ],
        evidenceAssetIds: [],
      });
      nextState.auditEvents.push(...events);
      nextState.mutationReceipts.push({
        actorId: access!.actorId,
        clientMutationId: rawInput.clientMutationId.trim(),
        operation: "customer.create",
        resultEntityId: id,
        resultRevision: 1,
        createdAt: occurredAt,
      });
      if (!validateCustomerVehicleStateV3(nextState)) {
        stateValidationFailure("客户建档写入状态不符合 schema v3");
      }
      session.stage = "creating";
      try {
        persist(nextState, current.sourceRevision, "源数据已变化，请重新预览");
      } catch (error) {
        session.stage = "customer_previewed";
        if (error instanceof Error && error.message === "源数据已变化，请重新预览") {
          codedValidation(error.message, "CUSTOMER_ONBOARDING_SOURCE_REVISION_CONFLICT", 409);
        }
        throw error;
      }
      state = nextState;
      deleteOnboardingSession(session.token);
      customerNamePreviewReceipts.delete(preview.nameTransliterationToken);
      session.lastTouchedAtMs = nowMs;
      takeFault("customerOnboardingCreateResponse");
      return clone(created);
    },
    closeOnboarding: (_access, token) => {
      if (typeof token === "string") deleteOnboardingSession(token);
      return { closed: true };
    },
    workspace: (access) => {
      const current = readState(access);
      return clone({
        sourceRevision: current.sourceRevision,
        summary: summaryFor(current),
        customers: current.customers,
        vehicles: current.vehicles,
        relationships: current.relationships,
      });
    },
    customer: (access, customerIdValue) => {
      const current = readState(access);
      const customer = current.customers.find((entry) => entry.id === customerIdValue);
      if (!customer) throw new Error("客户不存在");
      return clone(customer);
    },
    vehicle: (access, vehicleIdValue) => {
      const current = readState(access);
      const vehicle = current.vehicles.find((entry) => entry.id === vehicleIdValue);
      if (!vehicle) throw new Error("车辆不存在");
      return clone(vehicle);
    },
    previewCustomerName: (access, value) => {
      assertFullRead(access);
      if (typeof value !== "string") validation("客户姓名必须是字符串");
      let canonicalResult: CustomerNameResult;
      try {
        canonicalResult = transliterateCustomerName(value);
      } catch (error) {
        const candidate = error as { message?: string; code?: string };
        throw new CustomerVehicleValidationError(
          candidate.message ?? "客户姓名音译失败",
          candidate.code ?? "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED",
          400,
        );
      }
      const confirmationToken = crypto.randomUUID();
      customerNamePreviewReceipts.set(confirmationToken, {
        actorId: access!.actorId,
        normalizedSourceValue: canonicalResult.sourceValue,
        canonicalResult: clone(canonicalResult),
        issuedAt: clock(),
      });
      return { ...clone(canonicalResult), confirmationToken };
    },
    audits: (access) => clone(readState(access).auditEvents),
    previewCustomer: (access, draft) => {
      assertFullRead(access);
      validateCustomerDraft(draft);
      const current = readState(access);
      const input = normalizeCustomerInput(draft);
      const confirmedName = resolveConfirmedName(access!, input);
      input.nameSourceValue = confirmedName.nameSourceValue;
      assertCustomerPhoneOwnershipAvailable(current, {
        primaryPhone: input.primaryPhone,
        secondaryPhone: input.secondaryPhone,
        whatsapp: input.whatsapp,
      });
      const candidates = duplicateCandidates(current, input);
      const previewToken = `customer-preview-${++tokenSequence}`;
      customerPreviews.set(previewToken, { action: "create", entityId: null, expectedRevision: null, input: clone(input), candidates: clone(candidates), sourceRevision: current.sourceRevision, actorId: access!.actorId });
      return { input: clone(input), candidates: clone(candidates), sourceRevision: current.sourceRevision, previewToken };
    },
    previewCustomerUpdate: (access, customerIdValue, draft) => {
      assertFullRead(access);
      validateCustomerUpdatePreview(draft);
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      if (draft.expectedRevision !== existing.revision) throw new Error("客户版本已变化，请重新加载");
      const input = normalizeCustomerInput({ ...customerDraftFromRecord(existing), ...draft }, { requirePrimaryPhone: false });
      const confirmedName = resolveConfirmedName(access!, input, existing);
      input.nameSourceValue = confirmedName.nameSourceValue;
      assertCustomerUpdatePhonesAvailable(current, existing, input, customerIdValue);
      const candidates = duplicateCandidates(current, input, customerIdValue);
      const previewToken = `customer-update-preview-${++tokenSequence}`;
      customerPreviews.set(previewToken, { action: "update", entityId: customerIdValue, expectedRevision: draft.expectedRevision, input: clone(input), candidates: clone(candidates), sourceRevision: current.sourceRevision, actorId: access!.actorId });
      return { input: clone(input), candidates: clone(candidates), sourceRevision: current.sourceRevision, previewToken };
    },
    createCustomer: (access, rawInput) => {
      assertFullRead(access);
      validateCustomerCreate(rawInput);
      const current = readState(access);
      const input = normalizeCustomerInput(rawInput);
      const preview = customerPreviews.get(rawInput.previewToken);
      if (!preview) throw new Error("请先预览或预览凭证无效，请重新预览");
      if (preview.action !== "create" || preview.entityId !== null) throw new Error("预览操作不一致，请重新预览");
      if (preview.actorId !== access!.actorId) throw new Error("预览操作者不一致，请重新预览");
      const confirmedName = resolveConfirmedName(access!, input);
      input.nameSourceValue = confirmedName.nameSourceValue;
      if (JSON.stringify(preview.input) !== JSON.stringify(input)) throw new Error("预览内容已变化，请重新预览");
      assertCustomerPhoneOwnershipAvailable(current, {
        primaryPhone: input.primaryPhone,
        secondaryPhone: input.secondaryPhone,
        whatsapp: input.whatsapp,
      });
      if (preview.sourceRevision !== current.sourceRevision) throw new Error("源数据已变化，请重新预览");
      takeFault("customerVehicleSave");
      const nextState = clone(current);
      const occurredAt = clock();
      const id = customerId?.(nextState) ?? `CUST-UAT-${String(nextState.customers.length + 1).padStart(3, "0")}`;
      const customer = customerFromInput(id, input, occurredAt, confirmedName);
      nextState.customers.push(customer);
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "created", access!, null, customer, input.reason, occurredAt, preview.candidates);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新预览");
      state = nextState;
      customerPreviews.delete(rawInput.previewToken);
      if (input.nameTransliterationToken) customerNamePreviewReceipts.delete(input.nameTransliterationToken);
      return clone(customer);
    },
    updateCustomer: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateCustomerUpdate(rawInput);
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      if (rawInput.expectedRevision !== existing.revision) throw new Error("客户版本已变化，请重新加载");
      const input = normalizeCustomerInput({ ...customerDraftFromRecord(existing), ...rawInput }, { requirePrimaryPhone: false });
      const preview = customerPreviews.get(rawInput.previewToken);
      if (!preview) throw new Error("请先预览或预览凭证无效，请重新预览");
      if (preview.action !== "update") throw new Error("预览操作不一致，请重新预览");
      if (preview.entityId !== customerIdValue) throw new Error("预览实体不一致，请重新预览");
      if (preview.expectedRevision !== rawInput.expectedRevision) throw new Error("预览版本不一致，请重新预览");
      if (preview.actorId !== access!.actorId) throw new Error("预览操作者不一致，请重新预览");
      const confirmedName = resolveConfirmedName(access!, input, existing);
      input.nameSourceValue = confirmedName.nameSourceValue;
      if (JSON.stringify(preview.input) !== JSON.stringify(input)) throw new Error("预览内容已变化，请重新预览");
      assertCustomerUpdatePhonesAvailable(current, existing, input, customerIdValue);
      if (preview.sourceRevision !== current.sourceRevision) throw new Error("源数据已变化，请重新预览");
      takeFault("customerVehicleSave");
      if (sameCustomerContent(existing, input)) {
        customerPreviews.delete(rawInput.previewToken);
        if (input.nameTransliterationToken) customerNamePreviewReceipts.delete(input.nameTransliterationToken);
        return clone(existing);
      }
      const nextState = clone(current);
      const index = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
      const occurredAt = clock();
      const replacement = customerFromInput(customerIdValue, input, occurredAt, confirmedName);
      const updated: CustomerRecord = {
        ...nextState.customers[index],
        ...customerNameFields(replacement),
        customerType: replacement.customerType,
        organizationName: replacement.organizationName,
        primaryContactRole: replacement.primaryContactRole,
        salutation: replacement.salutation,
        language: replacement.language,
        phone: replacement.phone,
        secondaryPhone: replacement.secondaryPhone,
        whatsapp: replacement.whatsapp,
        email: replacement.email,
        preferredChannel: replacement.preferredChannel,
        address: replacement.address,
        gender: replacement.gender,
        birthDate: replacement.birthDate,
        trn: replacement.trn,
        status: replacement.status,
        revision: nextState.customers[index].revision + 1,
        updatedAt: occurredAt,
      };
      nextState.customers[index] = updated;
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "updated", access!, existing, updated, input.reason, occurredAt, preview.candidates);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      customerPreviews.delete(rawInput.previewToken);
      if (input.nameTransliterationToken) customerNamePreviewReceipts.delete(input.nameTransliterationToken);
      return clone(updated);
    },
    previewVehicle: (access, draft) => {
      assertFullRead(access);
      validateVehicleDraft(draft);
      const current = readState(access);
      const input = normalizeVehicleInput(draft);
      assertRelationshipCustomersExist(current, input);
      const existingVehicle = input.plate ? current.vehicles.find((entry) => plate(entry.plate) === input.plate) ?? null : null;
      const previewToken = `vehicle-preview-${++tokenSequence}`;
      vehiclePreviews.set(previewToken, { action: "create", entityId: null, expectedRevision: null, input: clone(input), existingVehicleId: existingVehicle?.id ?? null, canSave: existingVehicle === null, sourceRevision: current.sourceRevision, actorId: access!.actorId });
      return { input: clone(input), existingVehicleId: existingVehicle?.id ?? null, canSave: existingVehicle === null, sourceRevision: current.sourceRevision, previewToken };
    },
    previewVehicleUpdate: (access, vehicleIdValue, draft) => {
      assertFullRead(access);
      validateVehicleUpdatePreview(draft);
      const current = readState(access);
      const existing = current.vehicles.find((entry) => entry.id === vehicleIdValue);
      if (!existing) throw new Error("车辆不存在");
      if (draft.expectedRevision !== existing.revision) throw new Error("车辆版本已变化，请重新加载");
      const currentRelationships = current.relationships.filter((entry) => entry.vehicleId === vehicleIdValue);
      const input = normalizeVehicleInput({ ...vehicleDraftFromRecord(existing), ...draft }, currentRelationships);
      assertRelationshipCustomersExist(current, input);
      const conflicting = input.plate ? current.vehicles.find((entry) => entry.id !== vehicleIdValue && plate(entry.plate) === input.plate) ?? null : null;
      const previewToken = `vehicle-update-preview-${++tokenSequence}`;
      vehiclePreviews.set(previewToken, { action: "update", entityId: vehicleIdValue, expectedRevision: draft.expectedRevision, input: clone(input), existingVehicleId: conflicting?.id ?? null, canSave: conflicting === null, sourceRevision: current.sourceRevision, actorId: access!.actorId });
      return { input: clone(input), existingVehicleId: conflicting?.id ?? null, canSave: conflicting === null, sourceRevision: current.sourceRevision, previewToken };
    },
    createVehicle: (access, rawInput) => {
      assertFullRead(access);
      validateVehicleCreate(rawInput);
      const current = readState(access);
      const input = normalizeVehicleInput(rawInput);
      const preview = vehiclePreviews.get(rawInput.previewToken);
      if (!preview) throw new Error("请先预览或预览凭证无效，请重新预览");
      if (preview.action !== "create" || preview.entityId !== null) throw new Error("预览操作不一致，请重新预览");
      if (preview.actorId !== access!.actorId) throw new Error("预览操作者不一致，请重新预览");
      if (JSON.stringify(preview.input) !== JSON.stringify(input)) throw new Error("预览内容已变化，请重新预览");
      if (preview.sourceRevision !== current.sourceRevision) throw new Error("源数据已变化，请重新预览");
      if (!preview.canSave) throw new Error("车牌已存在，不能重复建档");
      takeFault("customerVehicleSave");
      const nextState = clone(current);
      const occurredAt = clock();
      const id = vehicleId?.(nextState) ?? `VEH-UAT-${String(nextState.vehicles.length + 1).padStart(3, "0")}`;
      const vehicle = vehicleFromInput(id, input, occurredAt);
      const relationships = resolveRelationships(current, nextState, id, input, false);
      nextState.vehicles.push(vehicle);
      nextState.relationships.push(...relationships);
      nextState.sourceRevision += 1;
      addVehicleAudit(nextState, "created", access!, null, vehicle, [], relationships, input.reason, occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新预览");
      state = nextState;
      vehiclePreviews.delete(rawInput.previewToken);
      return clone(vehicle);
    },
    updateVehicle: (access, vehicleIdValue, rawInput) => {
      assertFullRead(access);
      validateVehicleUpdate(rawInput);
      const current = readState(access);
      const existing = current.vehicles.find((entry) => entry.id === vehicleIdValue);
      if (!existing) throw new Error("车辆不存在");
      if (rawInput.expectedRevision !== existing.revision) throw new Error("车辆版本已变化，请重新加载");
      const currentRelationships = current.relationships.filter((entry) => entry.vehicleId === vehicleIdValue);
      const input = normalizeVehicleInput({ ...vehicleDraftFromRecord(existing), ...rawInput }, currentRelationships);
      assertRelationshipCustomersExist(current, input);
      const preview = vehiclePreviews.get(rawInput.previewToken);
      if (!preview) throw new Error("请先预览或预览凭证无效，请重新预览");
      if (preview.action !== "update") throw new Error("预览操作不一致，请重新预览");
      if (preview.entityId !== vehicleIdValue) throw new Error("预览实体不一致，请重新预览");
      if (preview.expectedRevision !== rawInput.expectedRevision) throw new Error("预览版本不一致，请重新预览");
      if (preview.actorId !== access!.actorId) throw new Error("预览操作者不一致，请重新预览");
      if (JSON.stringify(preview.input) !== JSON.stringify(input)) throw new Error("预览内容已变化，请重新预览");
      if (preview.sourceRevision !== current.sourceRevision) throw new Error("源数据已变化，请重新预览");
      if (!preview.canSave) throw new Error("车牌已存在，不能重复建档");
      takeFault("customerVehicleSave");
      const nextState = clone(current);
      const relationships = resolveRelationships(current, nextState, vehicleIdValue, input, true);
      if (sameVehicleContent(existing, input) && sameRelationships(currentRelationships, relationships)) {
        vehiclePreviews.delete(rawInput.previewToken);
        return clone(existing);
      }
      const index = nextState.vehicles.findIndex((entry) => entry.id === vehicleIdValue);
      const occurredAt = clock();
      const replacement = vehicleFromInput(vehicleIdValue, input, occurredAt);
      const updated: VehicleRecord = {
        ...nextState.vehicles[index],
        plate: replacement.plate,
        vin: replacement.vin,
        engineNumber: replacement.engineNumber,
        make: replacement.make, makeZh: replacement.makeZh, modelZh: replacement.modelZh,
        model: replacement.model,
        variant: replacement.variant,
        year: replacement.year,
        color: replacement.color,
        powertrain: replacement.powertrain,
        bodyType: replacement.bodyType, seating: replacement.seating, ccRating: replacement.ccRating, fuelType: replacement.fuelType,
        mileage: replacement.mileage,
        mileageUnit: replacement.mileageUnit,
        mileageRecordedAt: replacement.mileageRecordedAt,
        usage: replacement.usage,
        specialNotes: replacement.specialNotes,
        status: replacement.status,
        revision: nextState.vehicles[index].revision + 1,
        updatedAt: occurredAt,
      };
      nextState.vehicles[index] = updated;
      nextState.relationships = [...nextState.relationships.filter((entry) => entry.vehicleId !== vehicleIdValue), ...relationships];
      nextState.sourceRevision += 1;
      addVehicleAudit(nextState, "updated", access!, existing, updated, currentRelationships, relationships, input.reason, occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      vehiclePreviews.delete(rawInput.previewToken);
      return clone(updated);
    },
    getDelay: (operation) => Math.max(0, faults.delayMs?.[operation] ?? 0),
    requestCustomerOtp: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateRequestCustomerOtp(rawInput);
      const current = readState(access);
      const retry = idempotentCustomerResult(
        current, access!, customerIdValue, rawInput.clientMutationId, "otp.request",
      );
      if (retry) return retry;
      const existing = customerById(current, customerIdValue);
      let phoneE164: string;
      try {
        phoneE164 = normalizePhoneE164(rawInput.phoneE164, "JM");
      } catch {
        codedValidation("OTP 手机号无法规范化为 E.164", "OTP_PHONE_INVALID");
      }
      if (!customerOwnsPhone(existing, phoneE164)) {
        assertCustomerPhoneOwnershipAvailable(current, { primaryPhone: phoneE164 }, customerIdValue);
      }
      return commitVerificationMutation(
        current, access!, customerIdValue, rawInput.clientMutationId, "otp.request",
        (existing, occurredAt) => {
          const id = verificationRecordId("OTP", customerIdValue, existing.verificationArchive.otpRecords.length);
          return {
            customer: {
              ...existing,
              verificationArchive: {
                ...existing.verificationArchive,
                otpRecords: [...existing.verificationArchive.otpRecords, { id, phoneE164, requestedAt: occurredAt }],
              },
            },
            eventType: "otp_requested",
            reason: null,
            summary: "请求 OTP 验证",
            changes: [
              { field: "otpRecordId", before: null, after: id },
              { field: "phoneE164", before: null, after: phoneE164 },
              { field: "requestedAt", before: null, after: occurredAt },
            ],
            evidenceAssetIds: [],
          };
        },
      );
    },
    verifyCustomerOtp: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateVerifyCustomerOtp(rawInput);
      const current = readState(access);
      const retry = idempotentCustomerResult(
        current, access!, customerIdValue, rawInput.clientMutationId, "otp.verify",
      );
      if (retry) return retry;
      const existing = customerById(current, customerIdValue);
      const record = existing.verificationArchive.otpRecords.find((entry) => entry.id === rawInput.otpRecordId);
      if (!record) codedValidation("OTP 记录不存在", "OTP_RECORD_NOT_FOUND", 404);
      if (record.invalidatedAt) codedValidation("OTP 记录已作废", "OTP_RECORD_INVALIDATED", 409);
      if (record.verifiedAt) codedValidation("OTP 记录不再待验证", "OTP_RECORD_NOT_PENDING", 409);
      if (rawInput.code !== "123456") codedValidation("OTP 验证码错误", "OTP_CODE_INVALID");
      if (!customerOwnsPhone(existing, record.phoneE164)) {
        assertCustomerPhoneOwnershipAvailable(current, { primaryPhone: record.phoneE164 }, customerIdValue);
      }
      return commitVerificationMutation(
        current, access!, customerIdValue, rawInput.clientMutationId, "otp.verify",
        (draft, occurredAt) => {
          const otpRecords = draft.verificationArchive.otpRecords.map((entry) => entry.id === record.id ? {
            ...entry,
            verifiedAt: occurredAt,
            verifiedBy: access!.actorId,
          } : entry);
          const changes: CustomerAuditEvent["changes"] = [
            { field: "otpRecordId", before: null, after: record.id },
            { field: "verifiedAt", before: null, after: occurredAt },
            ...(draft.phone !== record.phoneE164
              ? [{ field: "phone", before: draft.phone, after: record.phoneE164 } as const]
              : []),
          ];
          return {
            customer: {
              ...draft,
              phone: record.phoneE164,
              verificationArchive: { ...draft.verificationArchive, otpRecords },
            },
            eventType: "otp_verified",
            reason: null,
            summary: "完成 OTP 验证",
            changes,
            evidenceAssetIds: [],
          };
        },
      );
    },
    invalidateCustomerOtp: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateInvalidateCustomerOtp(rawInput);
      const current = readState(access);
      const retry = idempotentCustomerResult(
        current, access!, customerIdValue, rawInput.clientMutationId, "otp.invalidate",
      );
      if (retry) return retry;
      const existing = customerById(current, customerIdValue);
      const reason = auditReason(rawInput.reason)!;
      const record = existing.verificationArchive.otpRecords.find((entry) => entry.id === rawInput.otpRecordId);
      if (!record) codedValidation("OTP 记录不存在", "OTP_RECORD_NOT_FOUND", 404);
      if (record.invalidatedAt) codedValidation("OTP 记录已作废", "OTP_RECORD_INVALIDATED", 409);
      if (!record.verifiedAt) codedValidation("只能作废已验证 OTP 记录", "OTP_RECORD_NOT_VERIFIED", 409);
      return commitVerificationMutation(
        current, access!, customerIdValue, rawInput.clientMutationId, "otp.invalidate",
        (draft, occurredAt) => {
          const otpRecords = draft.verificationArchive.otpRecords.map((entry) => entry.id === record.id ? {
            ...entry,
            invalidatedAt: occurredAt,
            invalidatedBy: access!.actorId,
            invalidationReason: reason,
          } : entry);
          return {
            customer: {
              ...draft,
              verificationArchive: { ...draft.verificationArchive, otpRecords },
            },
            eventType: "otp_invalidated",
            reason,
            summary: "作废 OTP 验证记录",
            changes: [
              { field: "otpRecordId", before: null, after: record.id },
              { field: "invalidatedAt", before: null, after: occurredAt },
              { field: "invalidationReason", before: null, after: reason },
            ],
            evidenceAssetIds: [],
          };
        },
      );
    },
    submitCustomerKyc: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateSubmitCustomerKyc(rawInput);
      const current = readState(access);
      const retry = idempotentCustomerKycSubmitResult(current, access!, customerIdValue, rawInput);
      if (retry) return retry;
      const existing = customerById(current, customerIdValue);
      const scoped = rawInput.subjectType === "organization_primary_contact";
      if (existing.customerType === "organization" && !scoped) {
        codedValidation("机构客户必须指定主要联系人驾驶证", "KYC_SUBJECT_REQUIRED");
      }
      if (existing.customerType === "individual" && scoped) {
        codedValidation("个人客户不能提交机构联系人驾驶证", "KYC_SUBJECT_NOT_APPLICABLE");
      }
      const submitted = commitVerificationMutation(
        current, access!, customerIdValue, rawInput.clientMutationId, "kyc.submit",
        (existing, occurredAt) => {
          const frontAsset = finalizeKycAsset(rawInput.frontAsset, access!.actorId, occurredAt);
          const backAsset = rawInput.backAsset ? finalizeKycAsset(rawInput.backAsset, access!.actorId, occurredAt) : undefined;
          assertValidKycEvidence({ ...rawInput, frontAsset, ...(backAsset ? { backAsset } : {}) });
          assertUnusedEvidenceAssets(current, [frontAsset, ...(backAsset ? [backAsset] : [])]);
          const id = verificationRecordId("KYC", customerIdValue, existing.verificationArchive.kycRecords.length);
          const recordBase = {
            id,
            documentType: "drivers_license" as const,
            frontAsset: clone(frontAsset),
            ...(backAsset ? { backAsset: clone(backAsset) } : {}),
            submittedAt: occurredAt,
          };
          const record: KycVerificationRecord = rawInput.subjectType === "organization_primary_contact"
            ? {
              ...recordBase,
              subjectType: "organization_primary_contact" as const,
              subjectProfile: normalizeDriverLicenseProfile(rawInput.subjectProfile),
            }
            : recordBase;
          return {
            customer: {
              ...existing,
              verificationArchive: {
                ...existing.verificationArchive,
                kycRecords: [...existing.verificationArchive.kycRecords, record],
              },
            },
            eventType: "kyc_submitted",
            reason: null,
            summary: scoped ? "提交主要联系人驾驶证证据" : "提交驾驶证 KYC 证据",
            changes: [
              { field: "kycRecordId", before: null, after: id },
              { field: "documentType", before: null, after: "drivers_license" },
              ...(scoped
                ? [{ field: "subjectType", before: null, after: "organization_primary_contact" } as const]
                : []),
              { field: "submittedAt", before: null, after: occurredAt },
            ],
            evidenceAssetIds: [frontAsset.id, ...(backAsset ? [backAsset.id] : [])],
          };
        },
      );
      takeFault("customerKycSubmitResponse");
      return submitted;
    },
    verifyCustomerKyc: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateVerifyCustomerKyc(rawInput);
      const current = readState(access);
      const retry = idempotentCustomerResult(
        current, access!, customerIdValue, rawInput.clientMutationId, "kyc.verify",
      );
      if (retry) return retry;
      const existing = customerById(current, customerIdValue);
      const record = existing.verificationArchive.kycRecords.find((entry) => entry.id === rawInput.kycRecordId);
      if (!record) codedValidation("未找到可核验的驾驶证证据", "KYC_EVIDENCE_REQUIRED", 409);
      if (record.invalidatedAt) codedValidation("KYC 记录已作废", "KYC_RECORD_INVALIDATED", 409);
      if (record.verifiedAt) codedValidation("KYC 记录不再待验证", "KYC_RECORD_NOT_PENDING", 409);
      try {
        validateKycEvidence(record.frontAsset, record.backAsset);
      } catch (error) {
        if (error instanceof EvidenceAssetError) {
          codedValidation("驾驶证正面证据无效", "KYC_EVIDENCE_REQUIRED", 409);
        }
        throw error;
      }
      const verified = commitVerificationMutation(
        current, access!, customerIdValue, rawInput.clientMutationId, "kyc.verify",
        (draft, occurredAt) => {
          const kycRecords = draft.verificationArchive.kycRecords.map((entry) => entry.id === record.id ? {
            ...entry,
            verifiedAt: occurredAt,
            verifiedBy: access!.actorId,
          } : entry);
          return {
            customer: {
              ...draft,
              verificationArchive: { ...draft.verificationArchive, kycRecords },
            },
            eventType: "kyc_verified",
            reason: null,
            summary: record.subjectType === "organization_primary_contact"
              ? "完成主要联系人驾驶证核验"
              : "完成驾驶证 KYC 核验",
            changes: [
              { field: "kycRecordId", before: null, after: record.id },
              ...(record.subjectType === "organization_primary_contact"
                ? [{ field: "subjectType", before: null, after: "organization_primary_contact" } as const]
                : []),
              { field: "verifiedAt", before: null, after: occurredAt },
            ],
            evidenceAssetIds: [record.frontAsset.id, ...(record.backAsset ? [record.backAsset.id] : [])],
          };
        },
      );
      takeFault("customerKycVerifyResponse");
      return verified;
    },
    prepareCustomerAgreementSigning: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validatePrepareCustomerAgreementSigning(rawInput);
      const current = readState(access);
      const existing = customerById(current, customerIdValue);
      const signedAt = clock();
      if (!isStrictIsoTimestamp(signedAt)) {
        codedValidation("协议签署时间无效", "AGREEMENT_SIGNING_TOKEN_INVALID", 409);
      }
      const latestAgreement = existing.verificationArchive.agreementRecords.at(-1);
      if (signedAt < existing.updatedAt || (latestAgreement && signedAt < latestAgreement.signedAt)) {
        codedValidation("协议签署时间早于现有客户记录", "AGREEMENT_SIGNING_TIME_INVALID", 409);
      }
      const token = crypto.randomUUID();
      customerAgreementSigningReceipts.set(token, {
        actorId: access!.actorId,
        customerId: customerIdValue,
        customerRevision: existing.revision,
        version: rawInput.version.trim(),
        signedBy: rawInput.signedBy.trim(),
        signedAt,
      });
      return { token, signedAt };
    },
    signCustomerAgreement: (access, customerIdValue, rawInput) => {
      assertFullRead(access);
      validateSignCustomerAgreement(rawInput);
      const current = readState(access);
      const retry = idempotentCustomerResult(
        current, access!, customerIdValue, rawInput.clientMutationId, "agreement.sign",
      );
      if (retry) return retry;
      const existing = customerById(current, customerIdValue);
      const signingReceipt = rawInput.medium === "electronic"
        ? customerAgreementSigningReceipts.get(rawInput.signingToken)
        : undefined;
      if (rawInput.medium === "electronic"
        && (!signingReceipt
          || signingReceipt.actorId !== access!.actorId
          || signingReceipt.customerId !== customerIdValue
          || signingReceipt.customerRevision !== existing.revision
          || signingReceipt.version !== rawInput.version.trim()
          || signingReceipt.signedBy !== rawInput.signedBy.trim()
          || rawInput.signatureAsset.createdAt !== signingReceipt.signedAt
          || rawInput.signedDocumentAsset.createdAt !== signingReceipt.signedAt)) {
        codedValidation("电子协议签署时间凭证无效或已过期", "AGREEMENT_SIGNING_TOKEN_INVALID", 409);
      }
      const validationRecord = agreementRecordFromInput(
        rawInput,
        "agreement-validation",
        signingReceipt?.signedAt ?? DEFAULT_TIMESTAMP,
        access!.actorId,
      );
      assertValidAgreement(validationRecord);
      assertUnusedEvidenceAssets(current, validationRecord.medium === "electronic"
        ? [validationRecord.signatureAsset, validationRecord.signedDocumentAsset]
        : validationRecord.paperScanAsset ? [validationRecord.paperScanAsset] : []);
      const updated = commitVerificationMutation(
        current, access!, customerIdValue, rawInput.clientMutationId, "agreement.sign",
        (existing, occurredAt) => {
          if (signingReceipt && occurredAt < signingReceipt.signedAt) {
            codedValidation("协议登记时间早于签署时间", "AGREEMENT_SIGNING_TIME_INVALID", 409);
          }
          const id = verificationRecordId("AGR", customerIdValue, existing.verificationArchive.agreementRecords.length);
          const record = agreementRecordFromInput(
            rawInput,
            id,
            signingReceipt?.signedAt ?? occurredAt,
            access!.actorId,
          );
          assertValidAgreement(record);
          const evidenceAssetIds = record.medium === "electronic"
            ? [record.signatureAsset.id, record.signedDocumentAsset.id]
            : record.paperScanAsset ? [record.paperScanAsset.id] : [];
          return {
            customer: {
              ...existing,
              verificationArchive: {
                ...existing.verificationArchive,
                agreementRecords: [...existing.verificationArchive.agreementRecords, record],
              },
            },
            eventType: "agreement_signed",
            reason: null,
            summary: "记录客户服务协议签署",
            changes: [
              { field: "agreementId", before: null, after: id },
              { field: "agreementVersion", before: null, after: record.version },
              { field: "agreementMedium", before: null, after: record.medium },
              { field: "signedAt", before: null, after: record.signedAt },
            ],
            evidenceAssetIds,
          };
        },
      );
      if (rawInput.medium === "electronic") {
        customerAgreementSigningReceipts.delete(rawInput.signingToken);
      }
      return updated;
    },
    customerAuditHistory: (access, customerIdValue) => {
      const current = readState(access);
      customerById(current, customerIdValue);
      return clone(current.auditEvents
        .filter((event): event is CustomerAuditEvent => "customerId" in event && event.customerId === customerIdValue)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id)));
    },
    addCustomerRiskFlag: (access, customerIdValue, level, note) => {
      assertFullRead(access);
      if (!note.trim()) throw new Error("风险原因不能为空");
      const normalizedNote = auditReason(note)!;
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      const nextState = clone(current);
      const index = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
      const occurredAt = clock();
      const flag = {
        id: `RISK-${customerIdValue}-${nextState.customers[index].riskFlags.length + 1}`,
        level, note: normalizedNote, addedAt: occurredAt, addedBy: access!.actorId,
        removedAt: null, removedBy: null,
      };
      const updated: CustomerRecord = {
        ...nextState.customers[index],
        riskFlags: [...nextState.customers[index].riskFlags, flag],
        revision: nextState.customers[index].revision + 1,
        updatedAt: occurredAt,
      };
      nextState.customers[index] = updated;
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "updated", access!, existing, updated, "添加风险条目", occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      return clone(updated);
    },
    removeCustomerRiskFlag: (access, customerIdValue, flagId) => {
      assertFullRead(access);
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      const flag = existing.riskFlags.find((entry) => entry.id === flagId && entry.removedAt === null);
      if (!flag) throw new Error("风险条目不存在或已解除");
      const nextState = clone(current);
      const index = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
      const occurredAt = clock();
      const riskFlags = nextState.customers[index].riskFlags.map((entry) =>
        entry.id === flagId ? { ...entry, removedAt: occurredAt, removedBy: access!.actorId } : entry);
      const updated: CustomerRecord = {
        ...nextState.customers[index],
        riskFlags,
        revision: nextState.customers[index].revision + 1,
        updatedAt: occurredAt,
      };
      nextState.customers[index] = updated;
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "updated", access!, existing, updated, "解除风险条目", occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      return clone(updated);
    },
    grantCustomerCredit: (access, customerIdValue, signatureNote, signatureDataUrl, actorName) => {
      assertFullRead(access);
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      if (existing.creditEligibility.eligible) return clone(existing);
      const nextState = clone(current);
      const index = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
      const occurredAt = clock();
      const updated: CustomerRecord = {
        ...nextState.customers[index],
        creditEligibility: {
          eligible: true, registeredAt: occurredAt, registeredBy: actorName,
          signatureNote, signatureDataUrl, cancelledAt: null, cancelledBy: null,
        },
        revision: nextState.customers[index].revision + 1,
        updatedAt: occurredAt,
      };
      nextState.customers[index] = updated;
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "updated", access!, existing, updated, "登记挂账资格（签名留痕）", occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      return clone(updated);
    },
    revokeCustomerCredit: (access, customerIdValue, reason, actorName) => {
      assertFullRead(access);
      const normalizedReason = reason.trim() ? auditReason(reason) : null;
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      if (!existing.creditEligibility.eligible) throw new Error("该客户没有挂账资格");
      const nextState = clone(current);
      const index = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
      const occurredAt = clock();
      const updated: CustomerRecord = {
        ...nextState.customers[index],
        creditEligibility: {
          ...nextState.customers[index].creditEligibility,
          eligible: false, cancelledAt: occurredAt, cancelledBy: actorName,
          signatureNote: normalizedReason ? `取消原因：${normalizedReason}` : nextState.customers[index].creditEligibility.signatureNote,
        },
        revision: nextState.customers[index].revision + 1,
        updatedAt: occurredAt,
      };
      nextState.customers[index] = updated;
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "updated", access!, existing, updated, "取消挂账资格", occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      return clone(updated);
    },
    saveCustomerNote: (access, customerIdValue, noteId, content, actorName) => {
      assertFullRead(access);
      if (!content.trim()) throw new Error("备注内容不能为空");
      const current = readState(access);
      const existing = current.customers.find((entry) => entry.id === customerIdValue);
      if (!existing) throw new Error("客户不存在");
      const nextState = clone(current);
      const index = nextState.customers.findIndex((entry) => entry.id === customerIdValue);
      const occurredAt = clock();
      const notes = [...nextState.customers[index].notes];
      if (noteId === null) {
        notes.unshift({
          id: `NOTE-${customerIdValue}-${notes.length + 1}-${Date.now() % 1000}`,
          content: content.trim(), author: actorName, time: occurredAt,
        });
      } else {
        const noteIndex = notes.findIndex((entry) => entry.id === noteId);
        if (noteIndex < 0) throw new Error("备注不存在");
        notes[noteIndex] = { ...notes[noteIndex], content: content.trim(), author: actorName, time: occurredAt };
      }
      const updated: CustomerRecord = {
        ...nextState.customers[index], notes,
        revision: nextState.customers[index].revision + 1, updatedAt: occurredAt,
      };
      nextState.customers[index] = updated;
      nextState.sourceRevision += 1;
      addCustomerAudit(nextState, "updated", access!, existing, updated, noteId === null ? "新增备注" : "编辑备注", occurredAt);
      persist(nextState, current.sourceRevision, "源数据已变化，请重新加载");
      state = nextState;
      return clone(updated);
    },
  };
}

let browserStore: MockCustomerVehicleStore | undefined;
let browserStorage: StorageLike | undefined;
let browserScenario: MockCustomerVehicleE2EScenario | undefined;

export function getMockCustomerVehicleStore(): MockCustomerVehicleStore {
  const browser = typeof window === "undefined" ? undefined : window as Window & {
    __WH_CUSTOMERS_TEST_SCENARIO__?: MockCustomerVehicleE2EScenario;
  };
  const storage = browser?.localStorage;
  const scenario = browser?.__WH_CUSTOMERS_TEST_SCENARIO__;
  if (browserStore && browserStorage === storage && browserScenario === scenario) return browserStore;
  browserStore = createMockCustomerVehicleStore({ storage, faults: scenario ?? {} });
  browserStorage = storage;
  browserScenario = scenario;
  return browserStore;
}
