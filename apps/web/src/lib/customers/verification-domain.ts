import {
  EvidenceAssetError,
  validateAgreementEvidence,
  validateEvidenceAsset,
  validateKycEvidence,
} from "./evidence-assets";
import { normalizeDriverLicenseProfile } from "./driver-license-profile";
import { normalizePhoneE164 } from "./phone";
import type {
  AgreementRecord,
  AgreementVerificationView,
  CustomerVerificationArchive,
  KycVerificationView,
  OtpVerificationView,
} from "./verification-types";

export type KycSubject =
  | { readonly type: "customer" }
  | { readonly type: "organization_primary_contact"; readonly currentName: string | null };

export class AgreementEvidenceRequiredError extends Error {
  readonly code = "AGREEMENT_EVIDENCE_REQUIRED" as const;

  constructor() {
    super("AGREEMENT_EVIDENCE_REQUIRED");
    this.name = "AgreementEvidenceRequiredError";
  }
}

function latest<T>(records: readonly T[]): T | undefined {
  return records[records.length - 1];
}

function hasGap(archive: CustomerVerificationArchive, kind: "otp" | "kyc" | "agreement"): boolean {
  return archive.evidenceGaps.some((gap) => gap.kind === kind);
}

export function deriveOtpVerification(
  archive: CustomerVerificationArchive,
  currentPhoneE164: string | null,
): OtpVerificationView {
  const activeRecord = latest(archive.otpRecords);
  if (!activeRecord) {
    const otpGap = archive.evidenceGaps.find((gap) => gap.kind === "otp");
    const missing = otpGap !== undefined
      && (otpGap.reason === "legacy_completion_without_evidence" || ("status" in otpGap && otpGap.status === "phone_missing"));
    return { status: missing ? "evidence_missing" : "unverified" };
  }
  if (!activeRecord.verifiedAt) return { status: "pending", activeRecord };
  if (activeRecord.invalidatedAt || !currentPhoneE164 || normalizePhoneE164(activeRecord.phoneE164) !== normalizePhoneE164(currentPhoneE164)) {
    return { status: "needs_reverification", activeRecord };
  }
  return { status: "verified", activeRecord };
}

export function deriveKycVerification(
  archive: CustomerVerificationArchive,
  subject: KycSubject = { type: "customer" },
): KycVerificationView {
  const matchingRecords = archive.kycRecords.filter((record) => subject.type === "customer"
    ? record.subjectType === undefined
    : record.subjectType === "organization_primary_contact");
  const activeRecord = latest(matchingRecords);
  const matchingGap = archive.evidenceGaps.some((gap) => gap.kind === "kyc"
    && (subject.type === "customer"
      ? gap.reason === "legacy_completion_without_evidence"
        || gap.reason === "onboarding_incomplete" && gap.subjectType === "customer"
      : gap.reason === "onboarding_incomplete" && gap.subjectType === "organization_primary_contact"));
  if (!activeRecord) return { status: matchingGap ? "evidence_missing" : "pending" };
  if (activeRecord.invalidatedAt) return { status: "needs_reverification", activeRecord };
  if (activeRecord.verifiedAt && subject.type === "organization_primary_contact"
    && activeRecord.subjectType === "organization_primary_contact") {
    const currentName = subject.currentName?.trim().replace(/\s+/gu, " ").toLocaleLowerCase() ?? null;
    const storedName = normalizeDriverLicenseProfile(activeRecord.subjectProfile).name.toLocaleLowerCase();
    if (currentName !== storedName) {
      return { status: "needs_reverification", activeRecord };
    }
  }
  return { status: activeRecord.verifiedAt ? "verified" : "pending", activeRecord };
}

export function deriveAgreementVerification(
  archive: CustomerVerificationArchive,
  currentAgreementVersion: string,
): AgreementVerificationView {
  const activeRecord = latest(archive.agreementRecords);
  if (!activeRecord) return { status: hasGap(archive, "agreement") ? "evidence_missing" : "pending" };
  return {
    status: activeRecord.version === currentAgreementVersion ? "signed" : "expired",
    activeRecord,
  };
}

export function validateAgreementRecord(record: AgreementRecord): void {
  if (record.medium === "electronic") {
    if (!record.signatureAsset || !record.signedDocumentAsset) throw new AgreementEvidenceRequiredError();
    validateAgreementEvidence({
      signatureAsset: record.signatureAsset,
      signedDocumentAsset: record.signedDocumentAsset,
    });
    return;
  }

  const hasPhysicalRecordNumber = Boolean(record.physicalRecordNumber?.trim());
  const hasPhysicalStorageLocation = Boolean(record.physicalStorageLocation?.trim());
  if (hasPhysicalRecordNumber !== hasPhysicalStorageLocation) throw new AgreementEvidenceRequiredError();
  if (record.paperScanAsset) {
    validateEvidenceAsset(record.paperScanAsset);
    return;
  }
  if (!hasPhysicalRecordNumber) throw new AgreementEvidenceRequiredError();
}

export { EvidenceAssetError };
