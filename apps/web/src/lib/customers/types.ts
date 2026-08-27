import type {
  CustomerNameResult,
  NameSourceScript,
  TransliterationMethod,
} from "./name-transliteration";
import type {
  CustomerVerificationArchive,
  DriverLicenseProfile,
  EvidenceAsset,
} from "./verification-types";

export type CustomerType = "individual" | "organization";
export type CustomerStatus = "active" | "inactive" | "blacklisted";
export type VehicleStatus = "on_site" | "off_site";
export type PreferredChannel = "whatsapp" | "sms" | "phone" | "email";
export type RiskLevel = "normal" | "attention" | "high";
export type ProfileCompleteness = "complete" | "incomplete";
export type MileageUnit = "km" | "mile";

/** 风险条目（2026-08-12 老板口述）：等级+原因+留痕，提醒但不阻止办理。 */
export interface RiskFlag {
  id: string;
  level: "attention" | "high" | "blacklist";
  note: string;
  addedAt: string;
  addedBy: string;
  removedAt: string | null;
  removedBy: string | null;
}

/** 挂账资格（2026-08-12 老板口述）：登记即时生效，无审批；可取消；签名只留痕。 */
export interface CreditEligibility {
  eligible: boolean;
  registeredAt: string | null;
  registeredBy: string | null;
  signatureNote: string | null;
  /** 签名笔迹图（data URL，留痕可回看）。 */
  signatureDataUrl: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

/** 验证与协议状态（后补制，不阻止创建与业务）。 */
export interface VerificationState {
  otpVerified: boolean;
  otpVerifiedAt: string | null;
  kycStatus: "pending" | "verified";
  kycVerifiedAt: string | null;
  agreementStatus: "pending" | "signed" | "expired";
  agreementVersion: string | null;
  agreementSignedAt: string | null;
}

export interface CustomerContact {
  id: string;
  label: string;
  name: string;
  phone: string;
  email: string | null;
  relation: string | null;
}

export interface CustomerOrderRef {
  id: string;
  type: "order" | "quote";
  title: string;
  amount: number;
  status: string;
  date: string;
}

export interface CustomerPaymentSummary {
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  orderCount: number;
}

export interface CommunicationRecord {
  id: string;
  channel: PreferredChannel;
  direction: "outbound" | "inbound";
  summary: string;
  operator: string;
  time: string;
}

export interface CustomerVehicleTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  assignee: string;
  dueAt: string | null;
}

export interface CustomerVehicleAttachment {
  id: string;
  fileName: string;
  category: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface CustomerNote {
  id: string;
  content: string;
  author: string;
  time: string;
}

export interface ChangeRecord {
  id: string;
  field: string;
  from: string;
  to: string;
  operator: string;
  time: string;
}

export interface VehicleServiceRecord {
  id: string;
  date: string;
  title: string;
  mileage: number;
  amount: number;
  status: string;
}

export interface VehiclePartNeed {
  id: string;
  name: string;
  urgency: "normal" | "urgent";
  status: "pending" | "ordered" | "arrived";
  estimatedCost: number;
}

export type StoredCustomerName =
  | {
      readonly nameSourceScript: NameSourceScript;
      readonly nameSourceValue: string;
      readonly nameZh: string;
      readonly nameEn: string;
      readonly transliterationMethod: TransliterationMethod;
      readonly transliterationVersion: "customer-name-v1";
      readonly transliterationStatus: "confirmed";
    }
  | {
      readonly nameSourceScript: "en";
      readonly nameSourceValue: string;
      readonly nameZh: null;
      readonly nameEn: string;
      readonly transliterationMethod: null;
      readonly transliterationVersion: null;
      readonly transliterationStatus: "needs_transliteration_review";
    }
  | {
      readonly nameSourceScript: "zh";
      readonly nameSourceValue: string;
      readonly nameZh: string;
      readonly nameEn: null;
      readonly transliterationMethod: null;
      readonly transliterationVersion: null;
      readonly transliterationStatus: "needs_transliteration_review";
    }
  | {
      readonly nameSourceScript: null;
      readonly nameSourceValue: null;
      readonly nameZh: null;
      readonly nameEn: null;
      readonly transliterationMethod: null;
      readonly transliterationVersion: null;
      readonly transliterationStatus: "needs_profile_review";
    };

export type CustomerRecordV3 = StoredCustomerName & {
  readonly id: string;
  /** 正式后端姓名原值，避免编辑其他字段时丢失双语内容。 */
  readonly formalFullName?: string;
  readonly customerType: CustomerType;
  readonly organizationName: string | null;
  readonly primaryContactRole: string | null;
  readonly salutation: string | null;
  readonly gender: string | null;
  readonly birthDate: string | null;
  readonly trn: string | null;
  readonly language: string;
  readonly phone: string | null;
  readonly secondaryPhone: string | null;
  readonly whatsapp: string | null;
  readonly email: string | null;
  readonly preferredChannel: PreferredChannel;
  readonly address: string | null;
  readonly status: CustomerStatus;
  readonly riskFlags: readonly RiskFlag[];
  readonly verificationArchive: CustomerVerificationArchive;
  readonly creditEligibility: CreditEligibility;
  readonly notes: readonly CustomerNote[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** @deprecated schema v1/v2 internal migration shape; never expose from the v3 store. */
export interface LegacyCustomerRecord {
  id: string;
  customerType: CustomerType;
  name: string | null;
  nameZh: string | null;
  nameSourceScript?: NameSourceScript | null;
  nameSourceValue?: string | null;
  nameEn?: string | null;
  transliterationMethod?: TransliterationMethod | null;
  transliterationVersion?: "customer-name-v1" | null;
  transliterationStatus?: "confirmed" | "needs_transliteration_review" | "needs_profile_review";
  primaryContactRole?: string | null;
  organizationName: string | null;
  salutation: string | null;
  language: string;
  phone: string | null;
  secondaryPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  preferredChannel: PreferredChannel;
  address: string | null;
  gender: string | null;
  birthDate: string | null;
  trn: string | null;
  licensePhotoUrl: string | null;
  source: string | null;
  riskLevel: RiskLevel;
  riskNote: string | null;
  riskFlags: RiskFlag[];
  verification: VerificationState;
  creditEligibility: CreditEligibility;
  tags: string[];
  profileCompleteness: ProfileCompleteness;
  recentBusiness: string | null;
  recentBusinessDate: string | null;
  activeBusinessCount: number;
  status: CustomerStatus;
  contacts: CustomerContact[];
  orders: CustomerOrderRef[];
  paymentSummary: CustomerPaymentSummary;
  communications: CommunicationRecord[];
  tasks: CustomerVehicleTask[];
  attachments: CustomerVehicleAttachment[];
  notes: CustomerNote[];
  changeHistory: ChangeRecord[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Public schema-v3 customer record. Legacy records are migration-only. */
export type CustomerRecord = CustomerRecordV3;

/** 车辆档案照片（2026-08-12 老板口述）：车证/适航证/维修过程照片都归车辆档案。 */
export interface VehiclePhoto {
  id: string;
  /** registration=注册证 fitness=检验合格证 repair=维修过程 other=其他 */
  kind: "registration" | "fitness" | "repair" | "other";
  /** Mock 演示直接指向 /seed-photos/ 静态资源。 */
  url: string;
  note: string;
  /** 维修照片可关联到业务单。 */
  linkedOrderId: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

export interface VehicleRecordV3 {
  id: string;
  /** 正式后端内部主键，仅用于把车辆关联到正式业务记录。 */
  formalId?: number;
  /** 正式后端档案启用状态，编辑时必须原样回传。 */
  formalIsActive?: boolean;
  plate: string;
  /** 车架号（Chassis No.，证件 OCR 采集）。 */
  vin: string;
  engineNumber: string | null;
  make: string;
  model: string;
  /** 品牌中文名（丰田/本田…，双语自动翻译）。 */
  makeZh: string | null;
  /** 车型中文名（卡罗拉/飞度…）。 */
  modelZh: string | null;
  variant: string | null;
  year: number;
  color: string | null;
  powertrain: string | null;
  /** 车身类型（Stn/Wagon、Hatch Back 等，证件 OCR）。 */
  bodyType: string | null;
  /** 座位数（证件 OCR）。 */
  seating: string | null;
  /** 排量 CC（证件 OCR）。 */
  ccRating: string | null;
  /** 燃油类型（PETROL/DIESEL 等，证件 OCR）。 */
  fuelType: string | null;
  mileage: number | null;
  mileageUnit: MileageUnit;
  mileageRecordedAt: string | null;
  usage: string | null;
  specialNotes: string | null;
  /** 照片档案：车证、适航证、维修过程照片。 */
  photos: VehiclePhoto[];
  status: VehicleStatus;
  /** 正式后端的独立车辆争议事实；Mock/UAT 档案可省略。 */
  hasOpenDispute?: boolean;
  openDisputeId?: number | null;
  partsNeeds: VehiclePartNeed[];
  tasks: CustomerVehicleTask[];
  attachments: EvidenceAsset[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated schema v1/v2 internal migration shape; never expose from the v3 store. */
export interface LegacyVehicleRecord extends Omit<VehicleRecordV3, "attachments"> {
  recentService: string | null;
  recentServiceDate: string | null;
  linkedOrderCount: number;
  totalAmount: number;
  unpaidAmount: number;
  serviceHistory: VehicleServiceRecord[];
  attachments: CustomerVehicleAttachment[];
  changeHistory: ChangeRecord[];
}

/** Public schema-v3 vehicle record. Legacy records are migration-only. */
export type VehicleRecord = VehicleRecordV3;

export interface VehicleCustomerRelationship {
  id: string;
  vehicleId: string;
  customerId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface CompanyContactRelationship {
  id: string;
  companyId: string;
  personalCustomerId: string;
  personalCustomerName: string;
  normalizedPhone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  canSign: boolean;
  receivesInvoice: boolean;
  receivesCollection: boolean;
  isActive: boolean;
  revision: number;
}

export interface VehicleRelationshipDraft {
  relationshipId?: string | null;
  customerId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface VehicleDraftInputV3 {
  formalIsActive?: boolean;
  plate?: string | null;
  vin?: string | null;
  engineNumber?: string | null;
  make?: string | null;
  model?: string | null;
  makeZh?: string | null;
  modelZh?: string | null;
  variant?: string | null;
  year?: number | null;
  color?: string | null;
  powertrain?: string | null;
  bodyType?: string | null;
  seating?: string | null;
  ccRating?: string | null;
  fuelType?: string | null;
  mileage?: number | null;
  mileageUnit?: MileageUnit;
  mileageRecordedAt?: string | null;
  usage?: string | null;
  specialNotes?: string | null;
  status?: VehicleStatus;
  reason?: string | null;
  relationships?: VehicleRelationshipDraft[];
}

export interface LegacyVehicleDraftInput extends VehicleDraftInputV3 {
  recentService?: string | null;
  recentServiceDate?: string | null;
  linkedOrderCount?: number | null;
  totalAmount?: number | null;
  unpaidAmount?: number | null;
}

export type VehicleDraftInput = VehicleDraftInputV3;

export interface NormalizedVehicleInputV3 {
  formalIsActive?: boolean;
  plate: string | null;
  vin: string;
  engineNumber: string | null;
  make: string;
  model: string;
  /** 品牌中文名（丰田/本田…，双语自动翻译）。 */
  makeZh: string | null;
  /** 车型中文名（卡罗拉/飞度…）。 */
  modelZh: string | null;
  variant: string | null;
  year: number;
  color: string | null;
  powertrain: string | null;
  bodyType: string | null;
  seating: string | null;
  ccRating: string | null;
  fuelType: string | null;
  mileage: number | null;
  mileageUnit: MileageUnit;
  mileageRecordedAt: string | null;
  usage: string | null;
  specialNotes: string | null;
  status: VehicleStatus;
  reason: string | null;
  relationships: Array<Required<VehicleRelationshipDraft>>;
}

export interface LegacyNormalizedVehicleInput extends NormalizedVehicleInputV3 {
  recentService: string | null;
  recentServiceDate: string | null;
  linkedOrderCount: number;
  totalAmount: number;
  unpaidAmount: number;
}

export type NormalizedVehicleInput = NormalizedVehicleInputV3;

export interface VehicleSavePreview {
  input: NormalizedVehicleInput;
  existingVehicleId: string | null;
  canSave: boolean;
  sourceRevision: number;
  previewToken: string;
}

export interface SaveVehicleInput extends VehicleDraftInput {
  previewToken: string;
}

export interface PreviewVehicleUpdateInput extends VehicleDraftInput {
  expectedRevision: number;
}

export interface UpdateVehicleInput extends PreviewVehicleUpdateInput {
  previewToken: string;
}

export interface CustomerVehicleSummary {
  totalCustomers: number;
  activeCustomers: number;
  totalVehicles: number;
  activeVehicles: number;
  activeRelationships: number;
}

export interface CustomerVehicleWorkspaceResponse {
  sourceRevision: number;
  summary: CustomerVehicleSummary;
  customers: CustomerRecord[];
  vehicles: VehicleRecord[];
  relationships: VehicleCustomerRelationship[];
  /** 正式公司账户与个人客户之间的联系人关系。 */
  companyContacts?: CompanyContactRelationship[];
}

export interface CustomerVehicleAccessContext {
  actorId: string;
  role: string;
}

export interface CustomerDraftInputV3 {
  customerType: CustomerType;
  organizationName?: string | null;
  nameSourceValue?: string | null;
  nameTransliterationToken?: string | null;
  primaryContactRole?: string | null;
  salutation?: string | null;
  language?: string | null;
  primaryPhone?: string | null;
  secondaryPhone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  preferredChannel?: PreferredChannel;
  address?: string | null;
  gender?: string | null;
  birthDate?: string | null;
  trn?: string | null;
  status?: CustomerStatus;
  reason?: string | null;
}

export interface LegacyCustomerDraftInput extends Omit<CustomerDraftInputV3, "nameSourceValue" | "nameTransliterationToken" | "primaryContactRole"> {
  name?: string | null;
  nameZh?: string | null;
  licensePhotoUrl?: string | null;
  source?: string | null;
  riskLevel?: RiskLevel;
  riskNote?: string | null;
  tags?: string[];
  profileCompleteness?: ProfileCompleteness;
  recentBusiness?: string | null;
  recentBusinessDate?: string | null;
  activeBusinessCount?: number | null;
}

export type CustomerDraftInput = CustomerDraftInputV3;

export type CustomerDuplicateReason = "phone" | "whatsapp" | "email" | "name" | "nameZh" | "nameEn" | "organizationName";

export interface CustomerDuplicateCandidate {
  customerId: string;
  reasons: CustomerDuplicateReason[];
}

export interface NormalizedCustomerInputV3 {
  customerType: CustomerType;
  organizationName: string | null;
  nameSourceValue: string | null;
  nameTransliterationToken: string | null;
  primaryContactRole: string | null;
  salutation: string | null;
  language: string;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  preferredChannel: PreferredChannel;
  address: string | null;
  /** 正式资料中的性别；证据预览经人工确认后才可更新。 */
  gender: string | null;
  /** 正式资料中的生日；证据预览经人工确认后才可更新。 */
  birthDate: string | null;
  /** 正式资料中的 TRN 税号；不是驾驶证提取字段。 */
  trn: string | null;
  status: CustomerStatus;
  reason: string | null;
}

export interface LegacyNormalizedCustomerInput extends Omit<NormalizedCustomerInputV3, "nameSourceValue" | "nameTransliterationToken" | "primaryContactRole"> {
  name: string | null;
  nameZh: string | null;
  licensePhotoUrl: string | null;
  source: string | null;
  riskLevel: RiskLevel;
  riskNote: string | null;
  tags: string[];
  profileCompleteness: ProfileCompleteness;
  recentBusiness: string | null;
  recentBusinessDate: string | null;
  activeBusinessCount: number;
}

export type NormalizedCustomerInput = NormalizedCustomerInputV3;

export interface CustomerSavePreview {
  input: NormalizedCustomerInput;
  candidates: CustomerDuplicateCandidate[];
  sourceRevision: number;
  previewToken: string;
}

export interface CustomerNamePreview extends CustomerNameResult {
  readonly confirmationToken: string;
}

export interface SaveCustomerInput extends CustomerDraftInput {
  previewToken: string;
  confirmPossibleDuplicate?: boolean;
}

export interface PreviewCustomerUpdateInput extends CustomerDraftInput {
  expectedRevision: number;
}

export interface UpdateCustomerInput extends PreviewCustomerUpdateInput {
  previewToken: string;
  confirmPossibleDuplicate?: boolean;
}

export interface RequestCustomerOtpInput {
  readonly phoneE164: string;
  readonly clientMutationId: string;
}

export interface VerifyCustomerOtpInput {
  readonly otpRecordId: string;
  readonly code: string;
  readonly clientMutationId: string;
}

export interface InvalidateCustomerOtpInput {
  readonly otpRecordId: string;
  readonly reason: string;
  readonly clientMutationId: string;
}

export type SubmitCustomerKycInput =
  | {
      readonly subjectType?: never;
      readonly subjectProfile?: never;
      readonly frontAsset: EvidenceAsset;
      readonly backAsset?: EvidenceAsset;
      readonly clientMutationId: string;
    }
  | {
      readonly subjectType: "organization_primary_contact";
      readonly subjectProfile: DriverLicenseProfile;
      readonly frontAsset: EvidenceAsset;
      readonly backAsset?: EvidenceAsset;
      readonly clientMutationId: string;
    };

export interface VerifyCustomerKycInput {
  readonly kycRecordId: string;
  readonly clientMutationId: string;
}

export interface PrepareCustomerAgreementSigningInput {
  readonly version: string;
  readonly signedBy: string;
}

export interface CustomerAgreementSigningPreview {
  readonly token: string;
  readonly signedAt: string;
}

export type SignCustomerAgreementInput =
  | {
      readonly medium: "electronic";
      readonly version: string;
      readonly signedBy: string;
      readonly signatureAsset: EvidenceAsset;
      readonly signedDocumentAsset: EvidenceAsset;
      readonly signingToken: string;
      readonly clientMutationId: string;
    }
  | {
      readonly medium: "paper";
      readonly version: string;
      readonly signedBy: string;
      readonly paperScanAsset?: EvidenceAsset;
      readonly physicalRecordNumber?: string;
      readonly physicalStorageLocation?: string;
      readonly clientMutationId: string;
    };

export interface CustomerMutationReceipt {
  readonly actorId: string;
  readonly clientMutationId: string;
  readonly operation: string;
  readonly resultEntityId: string;
  readonly resultRevision: number;
  readonly createdAt: string;
}

export interface AuditFieldChange {
  readonly field: string;
  readonly before: string | number | boolean | null;
  readonly after: string | number | boolean | null;
}

export interface CustomerAuditEvent {
  readonly id: string;
  readonly customerId: string;
  readonly eventType:
    | "customer_created"
    | "customer_updated"
    | "otp_requested"
    | "otp_verified"
    | "otp_invalidated"
    | "kyc_submitted"
    | "kyc_verified"
    | "agreement_signed"
    | "legacy_communication"
    | "legacy_task_snapshot"
    | "legacy_attachment_metadata"
    | "migration";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly summary: string;
  readonly changes: readonly AuditFieldChange[];
  readonly evidenceAssetIds: readonly string[];
}

export interface VehicleAuditEvent {
  readonly id: string;
  readonly vehicleId: string;
  readonly eventType: "vehicle_created" | "vehicle_updated" | "migration";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly summary: string;
  readonly changes: readonly AuditFieldChange[];
  readonly beforeRelationships: readonly VehicleCustomerRelationship[];
  readonly afterRelationships: readonly VehicleCustomerRelationship[];
}

export type CustomerVehicleAuditEvent = CustomerAuditEvent | VehicleAuditEvent;

/** @deprecated schema v1/v2 audit snapshot retained only for migration input. */
export interface CustomerAuditRecord {
  id: string;
  entityType: "customer";
  entityId: string;
  action: "created" | "updated";
  actorId: string;
  occurredAt: string;
  reason: string | null;
  before: LegacyCustomerRecord | null;
  after: LegacyCustomerRecord;
}

/** @deprecated schema v1/v2 audit snapshot retained only for migration input. */
export interface VehicleAuditRecord {
  id: string;
  entityType: "vehicle";
  entityId: string;
  action: "created" | "updated";
  actorId: string;
  occurredAt: string;
  reason: string | null;
  before: LegacyVehicleRecord | null;
  after: LegacyVehicleRecord;
  beforeRelationships: VehicleCustomerRelationship[];
  afterRelationships: VehicleCustomerRelationship[];
}

/** @deprecated schema v1/v2 audit snapshot retained only for migration input. */
export type CustomerVehicleAuditRecord = CustomerAuditRecord | VehicleAuditRecord;

export interface CustomerVehicleStateV3 {
  customers: CustomerRecordV3[];
  vehicles: VehicleRecordV3[];
  relationships: VehicleCustomerRelationship[];
  auditEvents: CustomerVehicleAuditEvent[];
  mutationReceipts: CustomerMutationReceipt[];
  sourceRevision: number;
}

export interface PersistedCustomerVehicleEnvelopeV3 {
  readonly schemaVersion: 3;
  readonly state: CustomerVehicleStateV3;
}
