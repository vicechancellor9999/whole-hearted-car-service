import { transliterateCustomerName } from "./name-transliteration";
import { normalizePhoneE164 } from "./phone";
import { validateEvidenceAsset, validateKycEvidence } from "./evidence-assets";
import { validateAgreementRecord } from "./verification-domain";
import { normalizeDriverLicenseProfile } from "./driver-license-profile";
import type {
  AgreementRecord,
  CustomerVerificationArchive,
  EvidenceAsset,
  KycVerificationRecord,
} from "./verification-types";
import type {
  AuditFieldChange,
  CreditEligibility,
  CustomerAuditEvent,
  CustomerRecordV3,
  CustomerVehicleAuditEvent,
  CustomerVehicleStateV3,
  PersistedCustomerVehicleEnvelopeV3,
  RiskFlag,
  StoredCustomerName,
  VehicleAuditEvent,
  VehicleCustomerRelationship,
  VehicleRecordV3,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const LEGACY_COMMUNICATION_PLACEHOLDERS = new Set(["COMM-UAT-001", "COMM-UAT-002"]);
const LEGACY_CUSTOMER_TASK_PLACEHOLDERS = new Set(["TASK-CUST-UAT-001", "TASK-CUST-UAT-002"]);
const LEGACY_CUSTOMER_ATTACHMENT_PLACEHOLDERS = new Set(["ATT-CUST-UAT-001", "ATT-CUST-UAT-002"]);
const LEGACY_VEHICLE_TASK_PLACEHOLDERS = new Set(["TASK-VEH-UAT-001"]);
const LEGACY_VEHICLE_ATTACHMENT_PLACEHOLDERS = new Set(["ATT-VEH-UAT-001"]);
const DATA_URL = /(?:^|[^A-Za-z0-9])data\s*:/i;
const LEGACY_DATA_URL = /(^|[^A-Za-z0-9])data\s*:[^\s]*/gi;
const STRICT_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_PHONE = /^\+[1-9]\d{7,14}$/;
const AUDIT_SCALAR_FIELDS = new Set([
  "customerType", "organizationName", "primaryContactRole", "nameSourceScript", "nameSourceValue",
  "nameZh", "nameEn", "transliterationStatus", "salutation", "gender", "birthDate", "trn",
  "language", "phone", "secondaryPhone", "whatsapp", "email", "preferredChannel", "address", "status",
  "riskFlagCount", "activeRiskFlagCount", "creditEligible", "noteCount",
  "plate", "vin", "engineNumber", "make", "makeZh", "model", "modelZh", "variant", "year", "color",
  "powertrain", "bodyType", "seating", "ccRating", "fuelType", "mileage", "mileageUnit",
  "mileageRecordedAt", "usage", "specialNotes", "photoCount", "partsNeedCount", "taskCount", "attachmentCount",
  "channel", "direction", "summary", "title", "assignee", "dueAt", "fileName", "category", "uploadedBy",
  "otpRecordId", "phoneE164", "requestedAt", "verifiedAt", "invalidatedAt", "invalidationReason",
  "kycRecordId", "documentType", "submittedAt", "agreementId", "agreementVersion", "agreementMedium", "signedAt",
  "subjectType",
  "duplicateCandidateCustomerIds", "duplicateCandidateReasons",
  "legacy_change",
]);

function object(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function nullableString(value: unknown): value is string | null {
  return value === null || string(value);
}

function array(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function iso(value: unknown): value is string {
  return string(value) && !Number.isNaN(Date.parse(value));
}

function strictIso(value: unknown): value is string {
  return string(value) && STRICT_ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function nonEmptyString(value: unknown): value is string {
  return string(value) && value.trim().length > 0;
}

function canonicalPhone(value: unknown): value is string | null {
  return value === null || string(value) && CANONICAL_PHONE.test(value);
}

function optionalStrictIso(value: unknown): value is string | undefined {
  return value === undefined || strictIso(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || string(value);
}

function legacyRelationship(value: unknown): value is VehicleCustomerRelationship {
  return object(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.vehicleId)
    && nonEmptyString(value.customerId)
    && strictIso(value.startedAt)
    && (value.endedAt === null || strictIso(value.endedAt))
    && (value.endedAt === null || value.endedAt >= value.startedAt);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return nonNegativeNumber(value) && Number.isInteger(value);
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function present(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyOwnKeys(value: UnknownRecord, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactOwnKeys(value: UnknownRecord, expectedKeys: readonly string[]): boolean {
  return Object.keys(value).length === expectedKeys.length && hasOnlyOwnKeys(value, expectedKeys);
}

function optionalPresent(value: UnknownRecord, key: string, guard: (entry: unknown) => boolean): boolean {
  return !present(value, key) || guard(value[key]);
}

function optionalArray(value: UnknownRecord, key: string, guard: (entry: unknown) => boolean): boolean {
  if (!present(value, key)) return true;
  const entries = value[key];
  return array(entries) && entries.every(guard) && uniqueRecordIds(entries);
}

function chronologicallySorted(values: readonly unknown[], timestampKey: string): boolean {
  let previous: string | null = null;
  for (const value of values) {
    if (!object(value) || !strictIso(value[timestampKey])) return false;
    if (previous !== null && value[timestampKey] < previous) return false;
    previous = value[timestampKey];
  }
  return true;
}

function legacyContact(value: unknown): boolean {
  if (!object(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)
    || !string(value.phone) || !(value.email === null || string(value.email))) return false;
  return nonEmptyString(value.label) && (value.relation === null || string(value.relation))
    || string(value.role) && typeof value.isPrimary === "boolean";
}

function legacyOrder(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && (value.type === "order" || value.type === "quote")
    && nonEmptyString(value.title) && nonNegativeNumber(value.amount) && string(value.status)
    && strictIso(value.date);
}

function legacyPayment(value: unknown): boolean {
  return object(value) && nonNegativeNumber(value.totalAmount) && nonNegativeNumber(value.paidAmount)
    && nonNegativeNumber(value.unpaidAmount) && nonNegativeInteger(value.orderCount)
    && (value.paidAmount as number) + (value.unpaidAmount as number) === value.totalAmount;
}

function legacyCommunication(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id)
    && ["whatsapp", "sms", "phone", "email"].includes(String(value.channel))
    && (value.direction === "outbound" || value.direction === "inbound")
    && string(value.summary) && nonEmptyString(value.operator) && strictIso(value.time);
}

function legacyTask(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && nonEmptyString(value.title)
    && ["pending", "in_progress", "completed"].includes(String(value.status))
    && nonEmptyString(value.assignee) && (value.dueAt === null || strictIso(value.dueAt));
}

function legacyAttachment(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && nonEmptyString(value.fileName)
    && string(value.category) && nonEmptyString(value.uploadedBy) && strictIso(value.uploadedAt);
}

function legacyNote(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && nonEmptyString(value.content)
    && nonEmptyString(value.author) && strictIso(value.time);
}

function legacyChange(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && nonEmptyString(value.field)
    && string(value.from) && string(value.to) && nonEmptyString(value.operator) && strictIso(value.time);
}

function legacyVerification(value: unknown): boolean {
  return object(value) && typeof value.otpVerified === "boolean"
    && (value.otpVerifiedAt === null || strictIso(value.otpVerifiedAt))
    && (value.kycStatus === "pending" || value.kycStatus === "verified")
    && (value.kycVerifiedAt === null || strictIso(value.kycVerifiedAt))
    && ["pending", "signed", "expired"].includes(String(value.agreementStatus))
    && nullableString(value.agreementVersion)
    && (value.agreementSignedAt === null || strictIso(value.agreementSignedAt));
}

function legacyCredit(value: unknown): boolean {
  return object(value) && typeof value.eligible === "boolean"
    && (value.registeredAt === null || strictIso(value.registeredAt))
    && nullableString(value.registeredBy) && nullableString(value.signatureNote)
    && optionalPresent(value, "signatureDataUrl", nullableString)
    && (value.cancelledAt === null || strictIso(value.cancelledAt))
    && nullableString(value.cancelledBy);
}

function legacyRiskFlag(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id)
    && ["attention", "high", "blacklist"].includes(String(value.level))
    && nonEmptyString(value.note) && strictIso(value.addedAt) && nonEmptyString(value.addedBy)
    && (value.removedAt === null || strictIso(value.removedAt))
    && (value.removedBy === null || nonEmptyString(value.removedBy))
    && (value.removedAt === null) === (value.removedBy === null);
}

function legacyService(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && strictIso(value.date)
    && nonEmptyString(value.title) && nonNegativeNumber(value.mileage)
    && nonNegativeNumber(value.amount) && string(value.status);
}

function legacyPartNeed(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id) && nonEmptyString(value.name)
    && (value.urgency === "normal" || value.urgency === "urgent")
    && ["pending", "ordered", "arrived"].includes(String(value.status))
    && nonNegativeNumber(value.estimatedCost);
}

function legacyVehiclePhoto(value: unknown): boolean {
  return object(value) && nonEmptyString(value.id)
    && ["registration", "fitness", "repair", "other"].includes(String(value.kind))
    && nonEmptyString(value.url) && string(value.note) && nullableString(value.linkedOrderId)
    && nonEmptyString(value.uploadedBy) && strictIso(value.uploadedAt);
}

function legacyCustomerRecord(value: unknown): value is UnknownRecord {
  if (!object(value) || !nonEmptyString(value.id)
    || (value.customerType !== "individual" && value.customerType !== "organization")
    || !nullableString(value.name) || !nullableString(value.organizationName)
    || !positiveInteger(value.revision) || !strictIso(value.createdAt) || !strictIso(value.updatedAt)) return false;
  if (value.customerType === "individual" && !nonEmptyString(value.name)
    || value.customerType === "organization" && !nonEmptyString(value.organizationName)) return false;
  const nullableFields = [
    "nameZh", "primaryContactRole", "salutation", "phone", "secondaryPhone", "whatsapp", "email",
    "address", "source", "riskNote", "recentBusiness", "gender", "birthDate", "trn", "licensePhotoUrl",
  ];
  if (nullableFields.some((key) => !optionalPresent(value, key, nullableString))) return false;
  if (!optionalPresent(value, "language", string)
    || !optionalPresent(value, "preferredChannel", (entry) => ["whatsapp", "sms", "phone", "email"].includes(String(entry)))
    || !optionalPresent(value, "status", (entry) => ["active", "inactive", "blacklisted"].includes(String(entry)))
    || !optionalPresent(value, "riskLevel", (entry) => ["normal", "attention", "high"].includes(String(entry)))
    || !optionalPresent(value, "profileCompleteness", (entry) => entry === "complete" || entry === "incomplete")
    || !optionalPresent(value, "recentBusinessDate", (entry) => entry === null || strictIso(entry))
    || !optionalPresent(value, "activeBusinessCount", nonNegativeInteger)
    || !optionalPresent(value, "paymentSummary", legacyPayment)
    || !optionalPresent(value, "verification", legacyVerification)
    || !optionalPresent(value, "creditEligibility", legacyCredit)) return false;
  if (!optionalPresent(value, "tags", (entries) => array(entries) && entries.every(string))
    || !optionalArray(value, "contacts", legacyContact)
    || !optionalArray(value, "orders", legacyOrder)
    || !optionalArray(value, "communications", legacyCommunication)
    || !optionalArray(value, "tasks", legacyTask)
    || !optionalArray(value, "attachments", legacyAttachment)
    || !optionalArray(value, "notes", legacyNote)
    || !optionalArray(value, "changeHistory", legacyChange)
    || !optionalArray(value, "riskFlags", legacyRiskFlag)) return false;
  if (present(value, "verificationArchive") && !isVerificationArchive(value.verificationArchive)) return false;
  return true;
}

function legacyVehicleRecord(value: unknown): value is UnknownRecord {
  if (!object(value) || !nonEmptyString(value.id) || !string(value.plate) || !string(value.vin)
    || !string(value.make) || !string(value.model) || !Number.isInteger(value.year)
    || (value.year as number) < 1886 || !positiveInteger(value.revision)
    || !strictIso(value.createdAt) || !strictIso(value.updatedAt)) return false;
  const nullableFields = [
    "engineNumber", "makeZh", "modelZh", "variant", "color", "powertrain", "bodyType", "seating",
    "ccRating", "fuelType", "transmission", "mileageRecordedAt", "usage", "specialNotes", "recentService",
    "recentServiceDate", "registrationExpiry",
  ];
  if (nullableFields.some((key) => !optionalPresent(value, key, (entry) => {
    if (["mileageRecordedAt", "recentServiceDate", "registrationExpiry"].includes(key)) {
      return entry === null || strictIso(entry);
    }
    return nullableString(entry);
  }))) return false;
  if (!optionalPresent(value, "mileage", (entry) => entry === null || nonNegativeNumber(entry))
    || !optionalPresent(value, "mileageUnit", (entry) => entry === "km" || entry === "mile")
    || !optionalPresent(value, "status", (entry) => ["active", "inactive", "idle", "scrapped", "on_site", "off_site"].includes(String(entry)))
    || !optionalPresent(value, "linkedOrderCount", nonNegativeInteger)
    || !optionalPresent(value, "totalAmount", nonNegativeNumber)
    || !optionalPresent(value, "unpaidAmount", nonNegativeNumber)) return false;
  if (nonNegativeNumber(value.totalAmount) && nonNegativeNumber(value.unpaidAmount) && value.unpaidAmount > value.totalAmount) return false;
  if (!optionalArray(value, "photos", legacyVehiclePhoto)
    || !optionalArray(value, "serviceHistory", legacyService)
    || !optionalArray(value, "partsNeeds", legacyPartNeed)
    || !optionalArray(value, "tasks", legacyTask)
    || !optionalArray(value, "attachments", (entry) => legacyAttachment(entry) || isEvidenceAsset(entry))
    || !optionalArray(value, "changeHistory", legacyChange)) return false;
  return true;
}

function legacyAuditRecord(value: unknown): value is UnknownRecord {
  if (!object(value) || !nonEmptyString(value.id) || !nonEmptyString(value.entityId)
    || (value.action !== "created" && value.action !== "updated") || !nonEmptyString(value.actorId)
    || !strictIso(value.occurredAt) || !nullableString(value.reason)) return false;
  if (value.entityType === "customer") {
    return (value.before === null || legacyCustomerRecord(value.before))
      && legacyCustomerRecord(value.after) && value.after.id === value.entityId
      && (value.before === null || value.before.id === value.entityId);
  }
  if (value.entityType !== "vehicle"
    || !(value.before === null || legacyVehicleRecord(value.before))
    || !legacyVehicleRecord(value.after) || value.after.id !== value.entityId
    || !(value.before === null || value.before.id === value.entityId)) return false;
  const beforePresent = present(value, "beforeRelationships");
  const afterPresent = present(value, "afterRelationships");
  return beforePresent === afterPresent
    && (!beforePresent || array(value.beforeRelationships) && value.beforeRelationships.every(legacyRelationship)
      && uniqueRecordIds(value.beforeRelationships)
      && array(value.afterRelationships) && value.afterRelationships.every(legacyRelationship)
      && uniqueRecordIds(value.afterRelationships));
}

function legacyState(value: unknown): value is UnknownRecord & {
  customers: UnknownRecord[];
  vehicles: UnknownRecord[];
  relationships: VehicleCustomerRelationship[];
  auditRecords: UnknownRecord[];
  sourceRevision: number;
} {
  if (!object(value)
    || !Number.isInteger(value.sourceRevision)
    || (value.sourceRevision as number) < 0
    || !array(value.customers)
    || !array(value.vehicles)
    || !array(value.relationships)
    || !array(value.auditRecords)) return false;
  if (!value.customers.every(legacyCustomerRecord) || !uniqueRecordIds(value.customers)
    || !value.vehicles.every(legacyVehicleRecord) || !uniqueRecordIds(value.vehicles)
    || !value.relationships.every(legacyRelationship) || !uniqueRecordIds(value.relationships)
    || !value.auditRecords.every(legacyAuditRecord) || !uniqueRecordIds(value.auditRecords)) return false;
  const customerIds = new Set(value.customers.map((customer) => customer.id));
  const vehicleIds = new Set(value.vehicles.map((vehicle) => vehicle.id));
  const plates = value.vehicles.map((vehicle) => string(vehicle.plate)
    ? vehicle.plate.replace(/\s+/g, "").toLocaleUpperCase() : "").filter(Boolean);
  if (new Set(plates).size !== plates.length
    || value.relationships.some((relationship) => !customerIds.has(relationship.customerId)
      || !vehicleIds.has(relationship.vehicleId))) return false;
  return value.auditRecords.every((audit) => {
    if (audit.entityType === "customer") return customerIds.has(String(audit.entityId));
    if (!vehicleIds.has(String(audit.entityId))) return false;
    for (const key of ["beforeRelationships", "afterRelationships"] as const) {
      if (!array(audit[key])) continue;
      if (audit[key].some((relationship) => !object(relationship)
        || relationship.vehicleId !== audit.entityId || !customerIds.has(String(relationship.customerId)))) return false;
    }
    return true;
  });
}

function legacyEnvelope(value: unknown, schemaVersion: 1 | 2): value is {
  schemaVersion: 1 | 2;
  state: ReturnType<typeof legacyState> extends true ? never : UnknownRecord;
} {
  return object(value) && value.schemaVersion === schemaVersion && legacyState(value.state);
}

export function isLegacyCustomerEnvelopeV1(value: unknown): boolean {
  return legacyEnvelope(value, 1);
}

export function isLegacyCustomerEnvelopeV2(value: unknown): boolean {
  return legacyEnvelope(value, 2);
}

function hasRemovedCustomerKeys(value: UnknownRecord): boolean {
  return [
    "name", "source", "recentBusiness", "recentBusinessDate", "activeBusinessCount", "tags", "contacts",
    "riskNote", "riskLevel", "orders", "paymentSummary", "licensePhotoUrl", "profileCompleteness",
    "communications", "tasks", "attachments", "changeHistory", "verification",
  ].some((key) => key in value);
}

function isStoredName(value: UnknownRecord): boolean {
  if (value.transliterationStatus === "confirmed") {
    const hasShape = (value.nameSourceScript === "zh" || value.nameSourceScript === "en")
      && string(value.nameSourceValue)
      && string(value.nameZh)
      && string(value.nameEn)
      && (value.transliterationMethod === "offline_pinyin" || value.transliterationMethod === "exact_name_dictionary")
      && value.transliterationVersion === "customer-name-v1";
    if (!hasShape) return false;
    try {
      const canonical = transliterateCustomerName(value.nameSourceValue as string);
      return canonical.sourceScript === value.nameSourceScript
        && canonical.sourceValue === value.nameSourceValue
        && canonical.nameZh === value.nameZh
        && canonical.nameEn === value.nameEn
        && canonical.method === value.transliterationMethod
        && canonical.version === value.transliterationVersion;
    } catch {
      return false;
    }
  }
  if (value.transliterationStatus === "needs_transliteration_review") {
    return value.nameSourceScript === "en" && nonEmptyString(value.nameSourceValue)
      && /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(value.nameSourceValue)
      && value.nameZh === null && value.nameEn === value.nameSourceValue
      && value.transliterationMethod === null && value.transliterationVersion === null;
  }
  return value.transliterationStatus === "needs_profile_review"
    && value.nameSourceScript === null && value.nameSourceValue === null
    && value.nameZh === null && value.nameEn === null
    && value.transliterationMethod === null && value.transliterationVersion === null;
}

function isEvidenceAsset(value: unknown): value is EvidenceAsset {
  if (!(object(value) && hasExactOwnKeys(value, [
    "id", "fileName", "url", "mimeType", "sizeBytes", "createdAt", "createdBy",
  ])
    && nonEmptyString(value.id)
    && nonEmptyString(value.fileName)
    && nonEmptyString(value.url)
    && !DATA_URL.test(value.id)
    && !DATA_URL.test(value.fileName)
    && ["image/jpeg", "image/png", "application/pdf"].includes(String(value.mimeType))
    && Number.isInteger(value.sizeBytes)
    && strictIso(value.createdAt)
    && nonEmptyString(value.createdBy)
    && !DATA_URL.test(value.createdBy))) return false;
  try {
    validateEvidenceAsset(value as unknown as EvidenceAsset);
    return true;
  } catch {
    return false;
  }
}

function isOtpRecord(value: unknown): boolean {
  if (!object(value) || !hasOnlyOwnKeys(value, [
    "id", "phoneE164", "requestedAt", "verifiedAt", "verifiedBy",
    "invalidatedAt", "invalidatedBy", "invalidationReason",
  ]) || !nonEmptyString(value.id) || !string(value.phoneE164)
    || DATA_URL.test(value.id) || !CANONICAL_PHONE.test(value.phoneE164)
    || !strictIso(value.requestedAt)) return false;

  const hasVerifiedAt = value.verifiedAt !== undefined;
  const hasVerifiedBy = value.verifiedBy !== undefined;
  if (hasVerifiedAt !== hasVerifiedBy) return false;
  if (hasVerifiedAt && (!strictIso(value.verifiedAt) || !nonEmptyString(value.verifiedBy)
    || DATA_URL.test(value.verifiedBy) || value.verifiedAt < value.requestedAt)) return false;

  const hasInvalidatedAt = value.invalidatedAt !== undefined;
  const hasInvalidatedBy = value.invalidatedBy !== undefined;
  const hasInvalidationReason = value.invalidationReason !== undefined;
  if (hasInvalidatedAt !== hasInvalidatedBy || hasInvalidatedAt !== hasInvalidationReason) return false;
  if (hasInvalidatedAt && (!hasVerifiedAt || !strictIso(value.invalidatedAt)
    || !nonEmptyString(value.invalidatedBy) || !nonEmptyString(value.invalidationReason)
    || DATA_URL.test(value.invalidatedBy) || DATA_URL.test(value.invalidationReason)
    || value.invalidatedAt < value.requestedAt
    || strictIso(value.verifiedAt) && value.invalidatedAt < value.verifiedAt)) return false;
  return true;
}

function isKycRecord(value: unknown): boolean {
  if (!(object(value) && hasOnlyOwnKeys(value, [
    "id", "documentType", "frontAsset", "backAsset", "submittedAt",
    "verifiedAt", "verifiedBy", "invalidatedAt", "invalidationReason", "subjectType", "subjectProfile",
  ]) && nonEmptyString(value.id) && value.documentType === "drivers_license"
    && !DATA_URL.test(value.id)
    && isEvidenceAsset(value.frontAsset)
    && (value.backAsset === undefined || isEvidenceAsset(value.backAsset))
    && strictIso(value.submittedAt) && optionalStrictIso(value.verifiedAt)
    && optionalString(value.verifiedBy) && optionalStrictIso(value.invalidatedAt)
    && optionalString(value.invalidationReason))) return false;
  const scoped = value.subjectType === "organization_primary_contact";
  if (scoped !== present(value, "subjectProfile")) return false;
  if (!scoped && (present(value, "subjectType") || present(value, "subjectProfile"))) return false;
  if (scoped) {
    try {
      normalizeDriverLicenseProfile(value.subjectProfile);
    } catch {
      return false;
    }
  }
  const hasVerifiedAt = value.verifiedAt !== undefined;
  const hasVerifiedBy = value.verifiedBy !== undefined;
  if (hasVerifiedAt !== hasVerifiedBy) return false;
  if (hasVerifiedAt && (!strictIso(value.verifiedAt) || !nonEmptyString(value.verifiedBy)
    || DATA_URL.test(value.verifiedBy) || value.verifiedAt < value.submittedAt)) return false;
  const hasInvalidatedAt = value.invalidatedAt !== undefined;
  const hasInvalidationReason = value.invalidationReason !== undefined;
  if (hasInvalidatedAt !== hasInvalidationReason) return false;
  if (hasInvalidatedAt && (!hasVerifiedAt || !strictIso(value.invalidatedAt)
    || !nonEmptyString(value.invalidationReason) || DATA_URL.test(value.invalidationReason)
    || value.invalidatedAt < value.submittedAt
    || strictIso(value.verifiedAt) && value.invalidatedAt < value.verifiedAt)) return false;
  try {
    const record = value as unknown as KycVerificationRecord;
    validateKycEvidence(record.frontAsset, record.backAsset);
    return true;
  } catch {
    return false;
  }
}

function isAgreementRecord(value: unknown): boolean {
  if (!object(value) || !nonEmptyString(value.id) || !nonEmptyString(value.version)
    || !strictIso(value.signedAt) || !nonEmptyString(value.signedBy) || !nonEmptyString(value.recordedBy)
    || DATA_URL.test(value.id) || DATA_URL.test(value.version)
    || DATA_URL.test(value.signedBy) || DATA_URL.test(value.recordedBy)) return false;
  const shapeValid = value.medium === "electronic"
    ? hasExactOwnKeys(value, [
      "id", "version", "medium", "signedAt", "signedBy", "recordedBy", "signedDocumentAsset", "signatureAsset",
    ]) && isEvidenceAsset(value.signedDocumentAsset) && value.signedDocumentAsset.mimeType === "application/pdf"
      && isEvidenceAsset(value.signatureAsset) && value.signatureAsset.mimeType === "image/png"
    : value.medium === "paper"
    && hasOnlyOwnKeys(value, [
      "id", "version", "medium", "signedAt", "signedBy", "recordedBy",
      "paperScanAsset", "physicalRecordNumber", "physicalStorageLocation",
    ])
    && (value.paperScanAsset === undefined || isEvidenceAsset(value.paperScanAsset))
    && optionalString(value.physicalRecordNumber)
    && optionalString(value.physicalStorageLocation)
    && !(string(value.physicalRecordNumber) && DATA_URL.test(value.physicalRecordNumber))
    && !(string(value.physicalStorageLocation) && DATA_URL.test(value.physicalStorageLocation))
    && (value.paperScanAsset !== undefined
      || Boolean((value.physicalRecordNumber as string | undefined)?.trim()
        && (value.physicalStorageLocation as string | undefined)?.trim()));
  if (!shapeValid) return false;
  try {
    validateAgreementRecord(value as unknown as AgreementRecord);
    return true;
  } catch {
    return false;
  }
}

function isEvidenceGap(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.reason === "legacy_completion_without_evidence") {
    if (!hasOnlyOwnKeys(value, [
      "kind", "legacyCompletedAt", "legacyAgreementVersion", "reason", "migratedAt",
    ]) || !["otp", "kyc", "agreement"].includes(String(value.kind))
      || !present(value, "kind") || !present(value, "legacyCompletedAt")
      || !present(value, "reason") || !present(value, "migratedAt")
      || (value.legacyCompletedAt !== null && !strictIso(value.legacyCompletedAt))
      || !optionalString(value.legacyAgreementVersion)
      || (value.kind !== "agreement" && present(value, "legacyAgreementVersion"))
      || !strictIso(value.migratedAt)
      || (value.legacyCompletedAt !== null && value.legacyCompletedAt > value.migratedAt)) return false;
    return true;
  }
  if (value.reason !== "onboarding_incomplete" || !strictIso(value.recordedAt)
    || !nonEmptyString(value.recordedBy) || DATA_URL.test(value.recordedBy)) return false;
  if (value.kind === "otp") {
    return hasExactOwnKeys(value, ["kind", "reason", "status", "recordedAt", "recordedBy"])
      && (value.status === "phone_missing" || value.status === "not_requested");
  }
  return value.kind === "kyc"
    && hasExactOwnKeys(value, ["kind", "reason", "subjectType", "status", "recordedAt", "recordedBy"])
    && (value.subjectType === "customer" || value.subjectType === "organization_primary_contact")
    && value.status === "evidence_missing";
}

function chronologicallySortedEvidenceGaps(values: readonly unknown[]): boolean {
  let previous: string | null = null;
  for (const value of values) {
    if (!object(value)) return false;
    const timestamp = value.reason === "onboarding_incomplete" ? value.recordedAt : value.migratedAt;
    if (!strictIso(timestamp) || previous !== null && timestamp < previous) return false;
    previous = timestamp;
  }
  return true;
}

function uniqueRecordIds(values: unknown[]): boolean {
  const ids = values.map((entry) => object(entry) ? entry.id : undefined);
  return ids.every(string) && new Set(ids).size === ids.length;
}

function isVerificationArchive(value: unknown): value is CustomerVerificationArchive {
  if (!(object(value) && hasExactOwnKeys(value, ["otpRecords", "kycRecords", "agreementRecords", "evidenceGaps"])
    && array(value.otpRecords) && value.otpRecords.every(isOtpRecord) && uniqueRecordIds(value.otpRecords)
    && array(value.kycRecords) && value.kycRecords.every(isKycRecord) && uniqueRecordIds(value.kycRecords)
    && array(value.agreementRecords) && value.agreementRecords.every(isAgreementRecord) && uniqueRecordIds(value.agreementRecords)
    && array(value.evidenceGaps) && value.evidenceGaps.every(isEvidenceGap))) return false;
  const gapKinds = value.evidenceGaps.map((gap) => object(gap) ? gap.kind : undefined);
  return chronologicallySorted(value.otpRecords, "requestedAt")
    && chronologicallySorted(value.kycRecords, "submittedAt")
    && chronologicallySorted(value.agreementRecords, "signedAt")
    && chronologicallySortedEvidenceGaps(value.evidenceGaps)
    && new Set(gapKinds).size === gapKinds.length;
}

function isRiskFlag(value: unknown): boolean {
  return object(value) && hasExactOwnKeys(value, [
    "id", "level", "note", "addedAt", "addedBy", "removedAt", "removedBy",
  ]) && nonEmptyString(value.id)
    && ["attention", "high", "blacklist"].includes(String(value.level))
    && nonEmptyString(value.note) && strictIso(value.addedAt) && nonEmptyString(value.addedBy)
    && (value.removedAt === null || strictIso(value.removedAt))
    && (value.removedBy === null || nonEmptyString(value.removedBy))
    && (value.removedAt === null) === (value.removedBy === null)
    && (value.removedAt === null || value.removedAt >= value.addedAt);
}

function isCreditEligibility(value: unknown): value is CreditEligibility {
  if (!(object(value) && hasExactOwnKeys(value, [
    "eligible", "registeredAt", "registeredBy", "signatureNote", "signatureDataUrl", "cancelledAt", "cancelledBy",
  ]) && typeof value.eligible === "boolean"
    && (value.registeredAt === null || strictIso(value.registeredAt))
    && (value.registeredBy === null || nonEmptyString(value.registeredBy)) && nullableString(value.signatureNote)
    && nullableString(value.signatureDataUrl)
    && (value.cancelledAt === null || strictIso(value.cancelledAt))
    && (value.cancelledBy === null || nonEmptyString(value.cancelledBy)))) return false;
  const registered = value.registeredAt !== null;
  const cancelled = value.cancelledAt !== null;
  if (registered !== (value.registeredBy !== null) || cancelled !== (value.cancelledBy !== null)
    || cancelled && (!registered || value.cancelledAt! < value.registeredAt!)) return false;
  if (value.eligible) return registered && !cancelled;
  if (!registered) return !cancelled && value.signatureNote === null && value.signatureDataUrl === null;
  return cancelled;
}

function isCustomerNote(value: unknown): boolean {
  return object(value) && hasExactOwnKeys(value, ["id", "content", "author", "time"])
    && nonEmptyString(value.id) && nonEmptyString(value.content)
    && nonEmptyString(value.author) && strictIso(value.time);
}

function isCustomerV3(value: unknown): value is CustomerRecordV3 {
  if (!(object(value) && hasExactOwnKeys(value, [
    "id", "customerType", "organizationName", "primaryContactRole",
    "nameSourceScript", "nameSourceValue", "nameZh", "nameEn", "transliterationMethod",
    "transliterationVersion", "transliterationStatus", "salutation", "gender", "birthDate", "trn",
    "language", "phone", "secondaryPhone", "whatsapp", "email", "preferredChannel", "address", "status",
    "riskFlags", "verificationArchive", "creditEligibility", "notes", "revision", "createdAt", "updatedAt",
  ]) && !hasRemovedCustomerKeys(value)
    && nonEmptyString(value.id)
    && (value.customerType === "individual" || value.customerType === "organization")
    && isStoredName(value)
    && nullableString(value.organizationName)
    && nullableString(value.primaryContactRole)
    && nullableString(value.salutation) && nullableString(value.gender)
    && nullableString(value.birthDate) && nullableString(value.trn)
    && nonEmptyString(value.language)
    && canonicalPhone(value.phone) && canonicalPhone(value.secondaryPhone) && canonicalPhone(value.whatsapp)
    && nullableString(value.email)
    && ["whatsapp", "sms", "phone", "email"].includes(String(value.preferredChannel))
    && nullableString(value.address)
    && ["active", "inactive", "blacklisted"].includes(String(value.status))
    && array(value.riskFlags) && value.riskFlags.every(isRiskFlag) && uniqueRecordIds(value.riskFlags)
    && isVerificationArchive(value.verificationArchive)
    && isCreditEligibility(value.creditEligibility)
    && array(value.notes) && value.notes.every(isCustomerNote) && uniqueRecordIds(value.notes)
    && Number.isInteger(value.revision) && (value.revision as number) > 0
    && strictIso(value.createdAt)
    && strictIso(value.updatedAt)
    && value.updatedAt >= value.createdAt)) return false;
  if (value.customerType === "individual") {
    return value.organizationName === null && value.primaryContactRole === null
      && value.transliterationStatus !== "needs_profile_review";
  }
  return nonEmptyString(value.organizationName);
}

function hasRemovedVehicleKeys(value: UnknownRecord): boolean {
  return [
    "recentService", "recentServiceDate", "linkedOrderCount", "totalAmount", "unpaidAmount", "serviceHistory",
    "changeHistory",
  ].some((key) => key in value);
}

function isVehiclePhoto(value: unknown): boolean {
  return object(value) && hasExactOwnKeys(value, [
    "id", "kind", "url", "note", "linkedOrderId", "uploadedBy", "uploadedAt",
  ]) && nonEmptyString(value.id)
    && ["registration", "fitness", "repair", "other"].includes(String(value.kind))
    && nonEmptyString(value.url) && string(value.note) && nullableString(value.linkedOrderId)
    && nonEmptyString(value.uploadedBy) && strictIso(value.uploadedAt);
}

function isVehiclePartNeed(value: unknown): boolean {
  return object(value) && hasExactOwnKeys(value, ["id", "name", "urgency", "status", "estimatedCost"])
    && nonEmptyString(value.id) && nonEmptyString(value.name)
    && ["normal", "urgent"].includes(String(value.urgency))
    && ["pending", "ordered", "arrived"].includes(String(value.status))
    && typeof value.estimatedCost === "number" && Number.isFinite(value.estimatedCost) && value.estimatedCost >= 0;
}

function isVehicleTask(value: unknown): boolean {
  return object(value) && hasExactOwnKeys(value, ["id", "title", "status", "assignee", "dueAt"])
    && nonEmptyString(value.id) && nonEmptyString(value.title)
    && ["pending", "in_progress", "completed"].includes(String(value.status))
    && nonEmptyString(value.assignee) && (value.dueAt === null || strictIso(value.dueAt));
}

function isVehicleV3(value: unknown): value is VehicleRecordV3 {
  return object(value) && hasExactOwnKeys(value, [
    "id", "plate", "vin", "engineNumber", "make", "model", "makeZh", "modelZh", "variant", "year", "color",
    "powertrain", "bodyType", "seating", "ccRating", "fuelType", "mileage", "mileageUnit", "mileageRecordedAt",
    "usage", "specialNotes", "photos", "status", "partsNeeds", "tasks", "attachments", "revision", "createdAt", "updatedAt",
  ]) && !hasRemovedVehicleKeys(value)
    && nonEmptyString(value.id) && string(value.plate) && string(value.vin)
    && nullableString(value.engineNumber)
    && nonEmptyString(value.make) && nonEmptyString(value.model) && nullableString(value.makeZh) && nullableString(value.modelZh)
    && nullableString(value.variant) && Number.isInteger(value.year) && (value.year as number) >= 1886 && nullableString(value.color)
    && nullableString(value.powertrain) && nullableString(value.bodyType) && nullableString(value.seating)
    && nullableString(value.ccRating) && nullableString(value.fuelType)
    && (value.mileage === null || typeof value.mileage === "number" && Number.isFinite(value.mileage) && value.mileage >= 0)
    && (value.mileageUnit === "km" || value.mileageUnit === "mile")
    && (value.mileageRecordedAt === null || strictIso(value.mileageRecordedAt))
    && nullableString(value.usage) && nullableString(value.specialNotes)
    && array(value.photos) && value.photos.every(isVehiclePhoto) && uniqueRecordIds(value.photos)
    && (value.status === "on_site" || value.status === "off_site")
    && array(value.partsNeeds) && value.partsNeeds.every(isVehiclePartNeed) && uniqueRecordIds(value.partsNeeds)
    && array(value.tasks) && value.tasks.every(isVehicleTask) && uniqueRecordIds(value.tasks)
    && array(value.attachments) && value.attachments.every(isEvidenceAsset) && uniqueRecordIds(value.attachments)
    && Number.isInteger(value.revision) && (value.revision as number) > 0
    && strictIso(value.createdAt) && strictIso(value.updatedAt) && value.updatedAt >= value.createdAt;
}

function auditScalarValue(value: unknown): value is AuditFieldChange["before"] {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number" && Number.isFinite(value);
}

function isAuditChange(value: unknown): value is AuditFieldChange {
  return object(value) && hasExactOwnKeys(value, ["field", "before", "after"])
    && string(value.field) && AUDIT_SCALAR_FIELDS.has(value.field)
    && auditScalarValue(value.before) && auditScalarValue(value.after)
    && value.before !== value.after
    && !(string(value.before) && DATA_URL.test(value.before))
    && !(string(value.after) && DATA_URL.test(value.after));
}

function isAuditEvent(value: unknown): value is CustomerVehicleAuditEvent {
  if (!object(value) || !nonEmptyString(value.id) || !nonEmptyString(value.actorId) || !strictIso(value.occurredAt)
    || DATA_URL.test(value.id) || DATA_URL.test(value.actorId)
    || !nullableString(value.reason) || !string(value.summary)
    || string(value.reason) && DATA_URL.test(value.reason) || DATA_URL.test(value.summary)
    || !array(value.changes) || !value.changes.every(isAuditChange)) return false;
  if (nonEmptyString(value.customerId)) {
    return hasExactOwnKeys(value, [
      "id", "customerId", "eventType", "actorId", "occurredAt", "reason", "summary", "changes", "evidenceAssetIds",
    ]) && [
      "customer_created", "customer_updated", "otp_requested", "otp_verified", "otp_invalidated",
      "kyc_submitted", "kyc_verified", "agreement_signed", "legacy_communication",
      "legacy_task_snapshot", "legacy_attachment_metadata", "migration",
    ].includes(String(value.eventType))
      && array(value.evidenceAssetIds) && value.evidenceAssetIds.every((id) => nonEmptyString(id) && !DATA_URL.test(id));
  }
  return nonEmptyString(value.vehicleId) && hasExactOwnKeys(value, [
    "id", "vehicleId", "eventType", "actorId", "occurredAt", "reason", "summary", "changes",
    "beforeRelationships", "afterRelationships",
  ]) && ["vehicle_created", "vehicle_updated", "migration"].includes(String(value.eventType))
    && array(value.beforeRelationships) && value.beforeRelationships.every(strictRelationship)
    && array(value.afterRelationships) && value.afterRelationships.every(strictRelationship);
}

function isMutationReceipt(value: unknown): boolean {
  return object(value) && hasExactOwnKeys(value, [
    "actorId", "clientMutationId", "operation", "resultEntityId", "resultRevision", "createdAt",
  ]) && nonEmptyString(value.actorId) && nonEmptyString(value.clientMutationId)
    && nonEmptyString(value.operation) && nonEmptyString(value.resultEntityId)
    && !DATA_URL.test(value.actorId) && !DATA_URL.test(value.clientMutationId)
    && !DATA_URL.test(value.resultEntityId)
    && Number.isInteger(value.resultRevision) && (value.resultRevision as number) > 0
    && strictIso(value.createdAt);
}

const MUTATION_OPERATION_ENTITY_KIND = new Map<string, "customer" | "vehicle">([
  ["customer.create", "customer"],
  ["customer.update", "customer"],
  ["vehicle.create", "vehicle"],
  ["vehicle.update", "vehicle"],
  ["otp.request", "customer"],
  ["otp.verify", "customer"],
  ["otp.invalidate", "customer"],
  ["kyc.submit", "customer"],
  ["kyc.verify", "customer"],
  ["agreement.sign", "customer"],
]);

function mutationReceiptEntityKind(operation: string): "customer" | "vehicle" | null {
  return MUTATION_OPERATION_ENTITY_KIND.get(operation) ?? null;
}

function mutationReceiptsValid(
  receipts: readonly CustomerVehicleStateV3["mutationReceipts"][number][],
  customerRevisions: ReadonlyMap<string, number>,
  vehicleRevisions: ReadonlyMap<string, number>,
): boolean {
  const idempotencyKeys = new Set<string>();
  for (const receipt of receipts) {
    const key = JSON.stringify([receipt.actorId, receipt.clientMutationId, receipt.operation]);
    if (idempotencyKeys.has(key)) return false;
    idempotencyKeys.add(key);
    const entityKind = mutationReceiptEntityKind(receipt.operation);
    const entityRevision = entityKind === "customer"
      ? customerRevisions.get(receipt.resultEntityId)
      : entityKind === "vehicle" ? vehicleRevisions.get(receipt.resultEntityId) : undefined;
    if (entityRevision === undefined || receipt.resultRevision > entityRevision
      || entityKind === null) return false;
  }
  return true;
}

function strictRelationship(value: unknown): value is VehicleCustomerRelationship {
  return object(value) && hasExactOwnKeys(value, ["id", "vehicleId", "customerId", "startedAt", "endedAt"])
    && legacyRelationship(value) && strictIso(value.startedAt)
    && (value.endedAt === null || strictIso(value.endedAt));
}

function relationshipsValid(state: Pick<CustomerVehicleStateV3, "customers" | "vehicles" | "relationships">): boolean {
  const customerIds = new Set(state.customers.map((customer) => customer.id));
  const vehicleIds = new Set(state.vehicles.map((vehicle) => vehicle.id));
  const relationshipIds = new Set<string>();
  const currentByVehicle = new Set<string>();
  for (const relationship of state.relationships) {
    if (!strictRelationship(relationship) || relationshipIds.has(relationship.id)
      || !customerIds.has(relationship.customerId) || !vehicleIds.has(relationship.vehicleId)
      || relationship.endedAt !== null && relationship.endedAt < relationship.startedAt) return false;
    relationshipIds.add(relationship.id);
    if (relationship.endedAt === null) {
      if (currentByVehicle.has(relationship.vehicleId)) return false;
      currentByVehicle.add(relationship.vehicleId);
    }
  }
  const plates = new Set<string>();
  for (const vehicle of state.vehicles) {
    const normalized = vehicle.plate.replace(/\s+/g, "").toLocaleUpperCase();
    if (normalized && plates.has(normalized)) return false;
    if (normalized) plates.add(normalized);
  }
  return true;
}

function relationshipSnapshotValid(
  relationships: readonly VehicleCustomerRelationship[],
  customerIds: ReadonlySet<string>,
  vehicleIds: ReadonlySet<string>,
  expectedVehicleId: string,
): boolean {
  const ids = new Set<string>();
  const currentByVehicle = new Set<string>();
  for (const relationship of relationships) {
    if (!strictRelationship(relationship) || ids.has(relationship.id)
      || relationship.vehicleId !== expectedVehicleId
      || !vehicleIds.has(relationship.vehicleId) || !customerIds.has(relationship.customerId)
      || relationship.endedAt !== null && relationship.endedAt < relationship.startedAt) return false;
    ids.add(relationship.id);
    if (relationship.endedAt === null) {
      if (currentByVehicle.has(relationship.vehicleId)) return false;
      currentByVehicle.add(relationship.vehicleId);
    }
  }
  return true;
}

function customerEvidenceAssetIds(customer: CustomerRecordV3): Set<string> | null {
  const ids = new Set<string>();
  const add = (asset: EvidenceAsset | undefined): boolean => {
    if (!asset) return true;
    if (ids.has(asset.id)) return false;
    ids.add(asset.id);
    return true;
  };
  for (const record of customer.verificationArchive.kycRecords) {
    if (!add(record.frontAsset) || !add(record.backAsset)) return null;
  }
  for (const record of customer.verificationArchive.agreementRecords) {
    if (record.medium === "electronic") {
      if (!add(record.signedDocumentAsset) || !add(record.signatureAsset)) return null;
    } else if (!add(record.paperScanAsset)) return null;
  }
  return ids;
}

export function isCustomerEnvelopeV3(value: unknown): value is PersistedCustomerVehicleEnvelopeV3 {
  if (!object(value) || !hasExactOwnKeys(value, ["schemaVersion", "state"])
    || value.schemaVersion !== 3 || !object(value.state)
    || !hasExactOwnKeys(value.state, [
      "customers", "vehicles", "relationships", "auditEvents", "mutationReceipts", "sourceRevision",
    ])) return false;
  const state = value.state;
  if (!array(state.customers) || !state.customers.every(isCustomerV3)
    || !array(state.vehicles) || !state.vehicles.every(isVehicleV3)
    || !array(state.relationships) || !state.relationships.every(strictRelationship)
    || !array(state.auditEvents) || !state.auditEvents.every(isAuditEvent)
    || !array(state.mutationReceipts) || !state.mutationReceipts.every(isMutationReceipt)
    || !Number.isInteger(state.sourceRevision) || (state.sourceRevision as number) < 0) return false;
  const typedState = state as unknown as CustomerVehicleStateV3;
  const customerIds = typedState.customers.map((customer) => customer.id);
  const vehicleIds = typedState.vehicles.map((vehicle) => vehicle.id);
  if (new Set(customerIds).size !== customerIds.length || new Set(vehicleIds).size !== vehicleIds.length) return false;
  const customerIdSet = new Set(customerIds);
  const vehicleIdSet = new Set(vehicleIds);
  const customerRevisions = new Map(typedState.customers.map((customer) => [customer.id, customer.revision]));
  const vehicleRevisions = new Map(typedState.vehicles.map((vehicle) => [vehicle.id, vehicle.revision]));
  if (!mutationReceiptsValid(typedState.mutationReceipts, customerRevisions, vehicleRevisions)) return false;
  const auditIds = typedState.auditEvents.map((event) => event.id);
  if (new Set(auditIds).size !== auditIds.length) return false;
  const evidenceByCustomer = new Map<string, Set<string>>();
  for (const customer of typedState.customers) {
    const evidenceIds = customerEvidenceAssetIds(customer);
    if (!evidenceIds) return false;
    evidenceByCustomer.set(customer.id, evidenceIds);
  }
  for (const event of typedState.auditEvents) {
    if ("customerId" in event) {
      if (!customerIdSet.has(event.customerId)
        || new Set(event.evidenceAssetIds).size !== event.evidenceAssetIds.length
        || event.evidenceAssetIds.some((id) => !evidenceByCustomer.get(event.customerId)?.has(id))) return false;
    } else if (!vehicleIdSet.has(event.vehicleId)
      || !relationshipSnapshotValid(event.beforeRelationships, customerIdSet, vehicleIdSet, event.vehicleId)
      || !relationshipSnapshotValid(event.afterRelationships, customerIdSet, vehicleIdSet, event.vehicleId)) return false;
  }
  return relationshipsValid(typedState);
}

function normalizedPhone(value: unknown): string | null {
  if (!string(value) || !value.trim()) return null;
  try {
    return normalizePhoneE164(value, "JM");
  } catch {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) {
      try { return normalizePhoneE164(`+${digits}`); } catch { return null; }
    }
    return null;
  }
}

function storedName(customer: UnknownRecord): StoredCustomerName {
  const legacyName = string(customer.name) ? customer.name.trim().replace(/\s+/g, " ") : "";
  const legacyChineseName = string(customer.nameZh) ? customer.nameZh.trim() : "";
  const source = legacyName || legacyChineseName;
  if (!source) {
    return {
      nameSourceScript: null, nameSourceValue: null, nameZh: null, nameEn: null,
      transliterationMethod: null, transliterationVersion: null, transliterationStatus: "needs_profile_review",
    };
  }
  try {
    const result = transliterateCustomerName(source);
    return {
      nameSourceScript: result.sourceScript,
      nameSourceValue: result.sourceValue,
      nameZh: result.nameZh!,
      nameEn: result.nameEn,
      transliterationMethod: result.method,
      transliterationVersion: result.version,
      transliterationStatus: "confirmed",
    };
  } catch {
    if (/^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(source)) {
      return {
        nameSourceScript: "en", nameSourceValue: source, nameZh: null, nameEn: source,
        transliterationMethod: null, transliterationVersion: null,
        transliterationStatus: "needs_transliteration_review",
      };
    }
    return {
      nameSourceScript: null, nameSourceValue: null, nameZh: null, nameEn: null,
      transliterationMethod: null, transliterationVersion: null, transliterationStatus: "needs_profile_review",
    };
  }
}

function verificationArchive(customer: UnknownRecord, migratedAt: string): CustomerVerificationArchive {
  if (isVerificationArchive(customer.verificationArchive)) return structuredClone(customer.verificationArchive);
  const verification = object(customer.verification) ? customer.verification : {};
  const evidenceGaps: CustomerVerificationArchive["evidenceGaps"][number][] = [];
  if (verification.otpVerified === true) evidenceGaps.push({
    kind: "otp", legacyCompletedAt: string(verification.otpVerifiedAt) ? verification.otpVerifiedAt : null,
    reason: "legacy_completion_without_evidence", migratedAt,
  });
  if (verification.kycStatus === "verified") evidenceGaps.push({
    kind: "kyc", legacyCompletedAt: string(verification.kycVerifiedAt) ? verification.kycVerifiedAt : null,
    reason: "legacy_completion_without_evidence", migratedAt,
  });
  if (verification.agreementStatus === "signed") evidenceGaps.push({
    kind: "agreement", legacyCompletedAt: string(verification.agreementSignedAt) ? verification.agreementSignedAt : null,
    legacyAgreementVersion: string(verification.agreementVersion) ? verification.agreementVersion : undefined,
    reason: "legacy_completion_without_evidence", migratedAt,
  });
  return { otpRecords: [], kycRecords: [], agreementRecords: [], evidenceGaps };
}

function creditEligibility(value: unknown): CreditEligibility {
  if (!object(value)) return {
    eligible: false, registeredAt: null, registeredBy: null, signatureNote: null,
    signatureDataUrl: null, cancelledAt: null, cancelledBy: null,
  };
  return {
    eligible: value.eligible === true,
    registeredAt: nullableString(value.registeredAt) ? value.registeredAt : null,
    registeredBy: nullableString(value.registeredBy) ? value.registeredBy : null,
    signatureNote: nullableString(value.signatureNote) ? value.signatureNote : null,
    signatureDataUrl: nullableString(value.signatureDataUrl) ? value.signatureDataUrl : null,
    cancelledAt: nullableString(value.cancelledAt) ? value.cancelledAt : null,
    cancelledBy: nullableString(value.cancelledBy) ? value.cancelledBy : null,
  };
}

function riskFlags(value: unknown): RiskFlag[] {
  if (!array(value)) return [];
  return structuredClone(value.filter((entry): entry is RiskFlag => object(entry)
    && string(entry.id) && ["attention", "high", "blacklist"].includes(String(entry.level))
    && string(entry.note) && string(entry.addedAt) && string(entry.addedBy)));
}

function convertCustomer(customer: UnknownRecord, migratedAt: string): CustomerRecordV3 {
  const name = storedName(customer);
  const customerType = customer.customerType === "organization" ? "organization" : "individual";
  return {
    ...name,
    id: String(customer.id),
    customerType,
    organizationName: customerType === "organization" && nullableString(customer.organizationName)
      ? customer.organizationName : null,
    primaryContactRole: customerType === "organization" && nullableString(customer.primaryContactRole)
      ? customer.primaryContactRole : null,
    salutation: nullableString(customer.salutation) ? customer.salutation : null,
    gender: nullableString(customer.gender) ? customer.gender : null,
    birthDate: nullableString(customer.birthDate) ? customer.birthDate : null,
    trn: nullableString(customer.trn) ? customer.trn : null,
    language: string(customer.language) && customer.language.trim() ? customer.language : "English",
    phone: normalizedPhone(customer.phone),
    secondaryPhone: normalizedPhone(customer.secondaryPhone),
    whatsapp: normalizedPhone(customer.whatsapp),
    email: nullableString(customer.email) ? customer.email : null,
    preferredChannel: ["whatsapp", "sms", "phone", "email"].includes(String(customer.preferredChannel))
      ? customer.preferredChannel as CustomerRecordV3["preferredChannel"] : "phone",
    address: nullableString(customer.address) ? customer.address : null,
    status: ["active", "inactive", "blacklisted"].includes(String(customer.status))
      ? customer.status as CustomerRecordV3["status"] : "active",
    riskFlags: riskFlags(customer.riskFlags),
    verificationArchive: verificationArchive(customer, migratedAt),
    creditEligibility: creditEligibility(customer.creditEligibility),
    notes: array(customer.notes) ? structuredClone(customer.notes) as CustomerRecordV3["notes"] : [],
    revision: Number.isInteger(customer.revision) ? customer.revision as number : 1,
    createdAt: iso(customer.createdAt) ? customer.createdAt : migratedAt,
    updatedAt: iso(customer.updatedAt) ? customer.updatedAt : migratedAt,
  };
}

function evidenceAsset(value: unknown): value is EvidenceAsset {
  return object(value) && string(value.id) && string(value.fileName) && string(value.url)
    && ["image/jpeg", "image/png", "application/pdf"].includes(String(value.mimeType))
    && typeof value.sizeBytes === "number" && iso(value.createdAt) && string(value.createdBy);
}

function convertVehicle(vehicle: UnknownRecord, migratedAt: string): VehicleRecordV3 {
  const tasks = array(vehicle.tasks)
    ? vehicle.tasks.filter((task) => object(task) && string(task.id) && !LEGACY_VEHICLE_TASK_PLACEHOLDERS.has(task.id))
    : [];
  const attachments = array(vehicle.attachments) ? vehicle.attachments.filter(evidenceAsset) : [];
  return {
    id: String(vehicle.id),
    plate: string(vehicle.plate) ? vehicle.plate : "",
    vin: string(vehicle.vin) ? vehicle.vin : "",
    engineNumber: nullableString(vehicle.engineNumber) ? vehicle.engineNumber : null,
    make: string(vehicle.make) ? vehicle.make : "",
    model: string(vehicle.model) ? vehicle.model : "",
    makeZh: nullableString(vehicle.makeZh) ? vehicle.makeZh : null,
    modelZh: nullableString(vehicle.modelZh) ? vehicle.modelZh : null,
    variant: nullableString(vehicle.variant) ? vehicle.variant : null,
    year: Number.isInteger(vehicle.year) ? vehicle.year as number : new Date(migratedAt).getUTCFullYear(),
    color: nullableString(vehicle.color) ? vehicle.color : null,
    powertrain: nullableString(vehicle.powertrain) ? vehicle.powertrain : null,
    bodyType: nullableString(vehicle.bodyType) ? vehicle.bodyType : null,
    seating: nullableString(vehicle.seating) ? vehicle.seating : null,
    ccRating: nullableString(vehicle.ccRating) ? vehicle.ccRating : null,
    fuelType: nullableString(vehicle.fuelType) ? vehicle.fuelType : null,
    mileage: typeof vehicle.mileage === "number" ? vehicle.mileage : null,
    mileageUnit: vehicle.mileageUnit === "mile" ? "mile" : "km",
    mileageRecordedAt: nullableString(vehicle.mileageRecordedAt) ? vehicle.mileageRecordedAt : null,
    usage: nullableString(vehicle.usage) ? vehicle.usage : null,
    specialNotes: nullableString(vehicle.specialNotes) ? vehicle.specialNotes : null,
    photos: array(vehicle.photos) ? structuredClone(vehicle.photos) as VehicleRecordV3["photos"] : [],
    status: vehicle.status === "on_site" ? "on_site" : "off_site",
    partsNeeds: array(vehicle.partsNeeds) ? structuredClone(vehicle.partsNeeds) as VehicleRecordV3["partsNeeds"] : [],
    tasks: structuredClone(tasks) as VehicleRecordV3["tasks"],
    attachments: structuredClone(attachments),
    revision: Number.isInteger(vehicle.revision) ? vehicle.revision as number : 1,
    createdAt: iso(vehicle.createdAt) ? vehicle.createdAt : migratedAt,
    updatedAt: iso(vehicle.updatedAt) ? vehicle.updatedAt : migratedAt,
  };
}

function sanitizedLegacyAuditText(value: string): string {
  if (!DATA_URL.test(value)) return value;
  const sanitized = value.replace(LEGACY_DATA_URL, (_match, prefix: string) => `${prefix}[legacy data redacted]`);
  return DATA_URL.test(sanitized) ? "[legacy audit text redacted]" : sanitized;
}

function auditScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (string(value)) return sanitizedLegacyAuditText(value);
  return typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" ? value : null;
}

function auditReason(value: unknown): string | null {
  return string(value) ? sanitizedLegacyAuditText(value) : null;
}

function compactAuditChanges(changes: AuditFieldChange[]): AuditFieldChange[] {
  return changes.filter((change) => AUDIT_SCALAR_FIELDS.has(change.field) && change.before !== change.after);
}

function changesBetween(before: UnknownRecord | null, after: UnknownRecord): AuditFieldChange[] {
  const keys = [
    "customerType", "organizationName", "primaryContactRole", "nameSourceScript", "nameSourceValue",
    "nameZh", "nameEn", "transliterationStatus", "salutation", "gender", "birthDate", "trn",
    "language", "phone", "secondaryPhone", "whatsapp", "email", "preferredChannel", "address", "status",
    "plate", "vin", "engineNumber", "make", "makeZh", "model", "modelZh", "variant", "year", "color",
    "powertrain", "bodyType", "seating", "ccRating", "fuelType", "mileage", "mileageUnit",
    "mileageRecordedAt", "usage", "specialNotes",
  ];
  const result: AuditFieldChange[] = [];
  for (const field of keys) {
    const beforeValue = auditScalar(before?.[field]);
    const afterValue = auditScalar(after[field]);
    if (beforeValue !== afterValue) result.push({ field, before: beforeValue, after: afterValue });
  }
  return result;
}

function customerMetadataEvents(customer: UnknownRecord, migratedAt: string): CustomerAuditEvent[] {
  const customerId = String(customer.id);
  const result: CustomerAuditEvent[] = [];
  const add = (entry: UnknownRecord, eventType: CustomerAuditEvent["eventType"], summary: string, changes: AuditFieldChange[]) => {
    result.push({
      id: String(entry.id), customerId, eventType,
      actorId: string(entry.operator) ? entry.operator : string(entry.assignee) ? entry.assignee : string(entry.uploadedBy) ? entry.uploadedBy : "migration",
      occurredAt: iso(entry.time) ? entry.time : iso(entry.uploadedAt) ? entry.uploadedAt : migratedAt,
      reason: null, summary, changes: compactAuditChanges(changes), evidenceAssetIds: [],
    });
  };
  if (array(customer.communications)) for (const value of customer.communications) {
    if (!object(value) || !string(value.id) || LEGACY_COMMUNICATION_PLACEHOLDERS.has(value.id)) continue;
    add(value, "legacy_communication", "迁移旧联系记录", [
      { field: "channel", before: null, after: auditScalar(value.channel) },
      { field: "direction", before: null, after: auditScalar(value.direction) },
      { field: "summary", before: null, after: auditScalar(value.summary) },
    ]);
  }
  if (array(customer.tasks)) for (const value of customer.tasks) {
    if (!object(value) || !string(value.id) || LEGACY_CUSTOMER_TASK_PLACEHOLDERS.has(value.id)) continue;
    add(value, "legacy_task_snapshot", "迁移旧客户任务快照", [
      { field: "title", before: null, after: auditScalar(value.title) },
      { field: "status", before: null, after: auditScalar(value.status) },
      { field: "assignee", before: null, after: auditScalar(value.assignee) },
      { field: "dueAt", before: null, after: auditScalar(value.dueAt) },
    ]);
  }
  if (array(customer.attachments)) for (const value of customer.attachments) {
    if (!object(value) || !string(value.id) || LEGACY_CUSTOMER_ATTACHMENT_PLACEHOLDERS.has(value.id)) continue;
    add(value, "legacy_attachment_metadata", "迁移无可调取文件的旧附件元数据", [
      { field: "fileName", before: null, after: auditScalar(value.fileName) },
      { field: "category", before: null, after: auditScalar(value.category) },
      { field: "uploadedBy", before: null, after: auditScalar(value.uploadedBy) },
    ]);
  }
  if (array(customer.changeHistory)) for (const value of customer.changeHistory) {
    if (!object(value) || !string(value.id)) continue;
    add(value, "migration", "迁移旧客户变更记录", [{
      field: string(value.field) && AUDIT_SCALAR_FIELDS.has(value.field) ? value.field : "legacy_change",
      before: auditScalar(value.from), after: auditScalar(value.to),
    }]);
  }
  const converted = convertCustomer(customer, migratedAt);
  result.push({
    id: `MIGRATION-${customerId}`, customerId, eventType: "migration", actorId: "migration",
    occurredAt: migratedAt, reason: null, summary: "客户档案迁移至 schema v3",
    changes: [
      { field: "organizationName", before: auditScalar(customer.organizationName), after: converted.organizationName },
      { field: "primaryContactRole", before: auditScalar(customer.primaryContactRole), after: converted.primaryContactRole },
      { field: "nameSourceValue", before: auditScalar(customer.name), after: converted.nameSourceValue },
      { field: "nameZh", before: auditScalar(customer.nameZh), after: converted.nameZh },
      { field: "nameEn", before: null, after: converted.nameEn },
      { field: "transliterationStatus", before: null, after: converted.transliterationStatus },
    ].filter((change) => change.before !== change.after), evidenceAssetIds: [],
  });
  return result;
}

function vehicleMetadataEvents(vehicle: UnknownRecord, migratedAt: string): VehicleAuditEvent[] {
  const vehicleId = String(vehicle.id);
  const result: VehicleAuditEvent[] = [];
  const metadata = array(vehicle.attachments)
    ? vehicle.attachments.filter((entry) => object(entry) && string(entry.id)
      && !LEGACY_VEHICLE_ATTACHMENT_PLACEHOLDERS.has(entry.id) && !evidenceAsset(entry))
    : [];
  for (const entry of metadata) {
    const metadataEntry = entry as UnknownRecord;
    result.push({
      id: String(metadataEntry.id), vehicleId, eventType: "migration",
      actorId: string(metadataEntry.uploadedBy) ? metadataEntry.uploadedBy : "migration",
      occurredAt: iso(metadataEntry.uploadedAt) ? metadataEntry.uploadedAt : migratedAt,
      reason: null, summary: "迁移无可调取文件的车辆旧附件元数据",
      changes: compactAuditChanges([
        { field: "fileName", before: null, after: auditScalar(metadataEntry.fileName) },
        { field: "category", before: null, after: auditScalar(metadataEntry.category) },
        { field: "uploadedBy", before: null, after: auditScalar(metadataEntry.uploadedBy) },
      ]), beforeRelationships: [], afterRelationships: [],
    });
  }
  if (array(vehicle.changeHistory)) for (const entry of vehicle.changeHistory) {
    if (!object(entry) || !string(entry.id)) continue;
    result.push({
      id: entry.id, vehicleId, eventType: "migration",
      actorId: string(entry.operator) ? entry.operator : "migration",
      occurredAt: iso(entry.time) ? entry.time : migratedAt,
      reason: null, summary: "迁移车辆旧变更记录",
      changes: compactAuditChanges([{
        field: string(entry.field) && AUDIT_SCALAR_FIELDS.has(entry.field) ? entry.field : "legacy_change",
        before: auditScalar(entry.from), after: auditScalar(entry.to),
      }]),
      beforeRelationships: [], afterRelationships: [],
    });
  }
  return result;
}

function convertLegacyAudit(record: UnknownRecord, migratedAt: string): CustomerVehicleAuditEvent | null {
  const before = object(record.before) ? record.before : null;
  const after = object(record.after) ? record.after : null;
  if (!after || !string(record.id) || !string(record.entityId)) return null;
  if (record.entityType === "customer") {
    const beforeV3 = before ? convertCustomer(before, migratedAt) : null;
    const afterV3 = convertCustomer(after, migratedAt);
    return {
      id: record.id, customerId: record.entityId,
      eventType: record.action === "created" ? "customer_created" : "customer_updated",
      actorId: string(record.actorId) ? record.actorId : "migration",
      occurredAt: iso(record.occurredAt) ? record.occurredAt : migratedAt,
      reason: auditReason(record.reason),
      summary: record.action === "created" ? "创建客户" : "更新客户",
      changes: changesBetween(beforeV3 as unknown as UnknownRecord | null, afterV3 as unknown as UnknownRecord),
      evidenceAssetIds: [],
    };
  }
  if (record.entityType === "vehicle") {
    const beforeV3 = before ? convertVehicle(before, migratedAt) : null;
    const afterV3 = convertVehicle(after, migratedAt);
    return {
      id: record.id, vehicleId: record.entityId,
      eventType: record.action === "created" ? "vehicle_created" : "vehicle_updated",
      actorId: string(record.actorId) ? record.actorId : "migration",
      occurredAt: iso(record.occurredAt) ? record.occurredAt : migratedAt,
      reason: auditReason(record.reason),
      summary: record.action === "created" ? "创建车辆" : "更新车辆",
      changes: changesBetween(beforeV3 as unknown as UnknownRecord | null, afterV3 as unknown as UnknownRecord),
      beforeRelationships: repairOverlaps(array(record.beforeRelationships) ? structuredClone(record.beforeRelationships) as VehicleCustomerRelationship[] : []),
      afterRelationships: repairOverlaps(array(record.afterRelationships) ? structuredClone(record.afterRelationships) as VehicleCustomerRelationship[] : []),
    };
  }
  return null;
}

function repairOverlaps(relationships: VehicleCustomerRelationship[]): VehicleCustomerRelationship[] {
  const repaired = structuredClone(relationships);
  const byVehicle = new Map<string, VehicleCustomerRelationship[]>();
  for (const relationship of repaired) {
    if (relationship.endedAt !== null) continue;
    const current = byVehicle.get(relationship.vehicleId) ?? [];
    current.push(relationship);
    byVehicle.set(relationship.vehicleId, current);
  }
  for (const current of byVehicle.values()) {
    if (current.length <= 1) continue;
    current.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
    const winner = current[current.length - 1]!;
    for (const relationship of current.slice(0, -1)) relationship.endedAt = winner.startedAt;
  }
  return repaired;
}

function makeAuditEventIdsUnique(events: CustomerVehicleAuditEvent[]): CustomerVehicleAuditEvent[] {
  const used = new Set<string>();
  return events.map((event) => {
    const base = event.id;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}--${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id === event.id ? event : { ...event, id };
  });
}

export function migrateCustomerVehicleEnvelope(
  value: unknown,
  migratedAt: string,
): PersistedCustomerVehicleEnvelopeV3 | null {
  if (isCustomerEnvelopeV3(value)) return value;
  if (!isLegacyCustomerEnvelopeV1(value) && !isLegacyCustomerEnvelopeV2(value)) return null;
  const source = (value as { schemaVersion: 1 | 2; state: ReturnType<typeof legacyState> extends true ? never : UnknownRecord }).state as UnknownRecord & {
    customers: UnknownRecord[];
    vehicles: UnknownRecord[];
    relationships: VehicleCustomerRelationship[];
    auditRecords: UnknownRecord[];
    sourceRevision: number;
  };
  const auditEvents: CustomerVehicleAuditEvent[] = [];
  for (const customer of source.customers) auditEvents.push(...customerMetadataEvents(customer, migratedAt));
  for (const vehicle of source.vehicles) auditEvents.push(...vehicleMetadataEvents(vehicle, migratedAt));
  for (const audit of source.auditRecords) {
    const converted = convertLegacyAudit(audit, migratedAt);
    if (converted) auditEvents.push(converted);
  }
  const envelope: PersistedCustomerVehicleEnvelopeV3 = {
    schemaVersion: 3,
    state: {
      sourceRevision: source.sourceRevision,
      customers: source.customers.map((customer) => convertCustomer(customer, migratedAt)),
      vehicles: source.vehicles.map((vehicle) => convertVehicle(vehicle, migratedAt)),
      relationships: repairOverlaps(source.relationships),
      auditEvents: makeAuditEventIdsUnique(auditEvents),
      mutationReceipts: [],
    },
  };
  return isCustomerEnvelopeV3(envelope) ? envelope : null;
}

export function validateCustomerVehicleStateV3(state: CustomerVehicleStateV3): boolean {
  return isCustomerEnvelopeV3({ schemaVersion: 3, state });
}

export function migrateLegacyCustomerVehicleState(
  state: unknown,
  schemaVersion: 1 | 2,
  migratedAt: string,
): PersistedCustomerVehicleEnvelopeV3 | null {
  return migrateCustomerVehicleEnvelope({ schemaVersion, state }, migratedAt);
}
