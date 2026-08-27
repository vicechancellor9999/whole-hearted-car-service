export interface EvidenceAsset {
  readonly id: string;
  readonly fileName: string;
  readonly url: string;
  readonly mimeType: "image/jpeg" | "image/png" | "application/pdf";
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface DriverLicenseProfile {
  readonly name: string;
  readonly birthDate: string;
  readonly sex: "M" | "F";
  readonly address: string;
}

export interface OtpVerificationRecord {
  readonly id: string;
  readonly phoneE164: string;
  readonly requestedAt: string;
  readonly verifiedAt?: string;
  readonly verifiedBy?: string;
  readonly invalidatedAt?: string;
  readonly invalidatedBy?: string;
  readonly invalidationReason?: string;
}

interface BaseKycVerificationRecord {
  readonly id: string;
  readonly documentType: "drivers_license";
  readonly frontAsset: EvidenceAsset;
  readonly backAsset?: EvidenceAsset;
  readonly submittedAt: string;
  readonly verifiedAt?: string;
  readonly verifiedBy?: string;
  readonly invalidatedAt?: string;
  readonly invalidationReason?: string;
}

export type LegacyKycVerificationRecord = BaseKycVerificationRecord & {
  readonly subjectType?: never;
  readonly subjectProfile?: never;
};

export type KycVerificationRecord =
  | LegacyKycVerificationRecord
  | (BaseKycVerificationRecord & {
      readonly subjectType: "organization_primary_contact";
      readonly subjectProfile: DriverLicenseProfile;
    });

export type AgreementRecord =
  | {
      readonly id: string;
      readonly version: string;
      readonly medium: "electronic";
      readonly signedAt: string;
      readonly signedBy: string;
      readonly recordedBy: string;
      readonly signedDocumentAsset: EvidenceAsset;
      readonly signatureAsset: EvidenceAsset;
    }
  | {
      readonly id: string;
      readonly version: string;
      readonly medium: "paper";
      readonly signedAt: string;
      readonly signedBy: string;
      readonly recordedBy: string;
      readonly paperScanAsset?: EvidenceAsset;
      readonly physicalRecordNumber?: string;
      readonly physicalStorageLocation?: string;
    };

export interface LegacyVerificationEvidenceGap {
  readonly kind: "otp" | "kyc" | "agreement";
  readonly legacyCompletedAt: string | null;
  readonly legacyAgreementVersion?: string;
  readonly reason: "legacy_completion_without_evidence";
  readonly migratedAt: string;
}

export type VerificationEvidenceGap =
  | LegacyVerificationEvidenceGap
  | {
      readonly kind: "otp";
      readonly reason: "onboarding_incomplete";
      readonly status: "phone_missing" | "not_requested";
      readonly recordedAt: string;
      readonly recordedBy: string;
    }
  | {
      readonly kind: "kyc";
      readonly reason: "onboarding_incomplete";
      readonly subjectType: "customer" | "organization_primary_contact";
      readonly status: "evidence_missing";
      readonly recordedAt: string;
      readonly recordedBy: string;
    };

export interface CustomerVerificationArchive {
  readonly otpRecords: readonly OtpVerificationRecord[];
  readonly kycRecords: readonly KycVerificationRecord[];
  readonly agreementRecords: readonly AgreementRecord[];
  readonly evidenceGaps: readonly VerificationEvidenceGap[];
}

export type OtpVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "needs_reverification"
  | "evidence_missing";

export type KycVerificationStatus =
  | "pending"
  | "verified"
  | "needs_reverification"
  | "evidence_missing";

export type AgreementStatus = "pending" | "signed" | "expired" | "evidence_missing";

export interface OtpVerificationView {
  readonly status: OtpVerificationStatus;
  readonly activeRecord?: OtpVerificationRecord;
}

export interface KycVerificationView {
  readonly status: KycVerificationStatus;
  readonly activeRecord?: KycVerificationRecord;
}

export interface AgreementVerificationView {
  readonly status: AgreementStatus;
  readonly activeRecord?: AgreementRecord;
}
