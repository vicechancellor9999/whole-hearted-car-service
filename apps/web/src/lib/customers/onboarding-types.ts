import type {
  CustomerDraftInput,
  CustomerDuplicateCandidate,
  CustomerStatus,
  CustomerType,
  NormalizedCustomerInput,
} from "./types";
import type { PreparedLicenseEvidence } from "./license-extraction/types";
import type { DriverLicenseProfile } from "./verification-types";

export type { DriverLicenseProfile } from "./verification-types";

export type OnboardingInputPhoneField = "primaryPhone" | "secondaryPhone" | "whatsapp";
export type CustomerStoredPhoneField = "phone" | "secondaryPhone" | "whatsapp";

export interface OnboardingPhoneDuplicateMatch {
  readonly customerId: string;
  readonly customerDisplayName: string;
  readonly customerStatus: CustomerStatus;
  readonly incomingField: OnboardingInputPhoneField;
  readonly existingField: CustomerStoredPhoneField;
  readonly phoneE164: string;
}

export interface PreviewOnboardingPhoneInput {
  readonly customerType: CustomerType;
  readonly primaryPhone: string | null;
  readonly clientMutationId: string;
}

export type OnboardingPhonePreviewResult =
  | {
      readonly status: "duplicate";
      readonly phoneE164: string;
      readonly matches: readonly OnboardingPhoneDuplicateMatch[];
      readonly sourceRevision: number;
    }
  | {
      readonly status: "clear";
      readonly phoneE164: string | null;
      readonly matches: readonly [];
      readonly sourceRevision: number;
      readonly onboardingToken: string;
      readonly expiresAt: string;
    };

export interface RequestOnboardingOtpInput { readonly clientMutationId: string; }
export interface OnboardingOtpChallenge {
  readonly otpChallengeId: string;
  readonly phoneE164: string;
  readonly requestedAt: string;
}
export interface VerifyOnboardingOtpInput {
  readonly otpChallengeId: string;
  readonly code: string;
  readonly clientMutationId: string;
}
export interface OnboardingOtpVerification {
  readonly otpChallengeId: string;
  readonly phoneE164: string;
  readonly verifiedAt: string;
}
export type OnboardingLicenseProfile = DriverLicenseProfile;
export type OnboardingReminder =
  | { readonly kind: "otp"; readonly status: "phone_missing" | "not_requested" | "pending" }
  | {
      readonly kind: "kyc";
      readonly subjectType: "customer" | "organization_primary_contact";
      readonly status: "evidence_missing" | "pending_verification";
    }
  | {
      readonly kind: "kyc_profile_mismatch";
      readonly subjectType: "customer" | "organization_primary_contact";
    };
export interface SubmitOnboardingKycInput {
  readonly frontAsset: PreparedLicenseEvidence;
  readonly profile: OnboardingLicenseProfile;
  readonly clientMutationId: string;
}
export interface OnboardingKycSubmission {
  readonly kycDraftId: string;
  readonly submittedAt: string;
}
export interface VerifyOnboardingKycInput {
  readonly kycDraftId: string;
  readonly attested: true;
  readonly clientMutationId: string;
}
export interface OnboardingKycConfirmation {
  readonly kycDraftId: string;
  readonly profile: OnboardingLicenseProfile;
  readonly verifiedAt: string;
}
export interface ClearOnboardingKycInput { readonly clientMutationId: string; }
export interface ClearOnboardingKycResult { readonly cleared: true; }
export interface PreviewOnboardingCustomerInput {
  readonly customer: CustomerDraftInput;
  readonly clientMutationId: string;
}
export interface OnboardingCustomerPreview {
  readonly status: "ready";
  readonly input: NormalizedCustomerInput;
  readonly candidates: readonly CustomerDuplicateCandidate[];
  readonly sourceRevision: number;
  readonly previewToken: string;
  readonly reminders: readonly OnboardingReminder[];
}
export type OnboardingCustomerPreviewResult =
  | OnboardingCustomerPreview
  | {
      readonly status: "phone_conflict";
      readonly matches: readonly OnboardingPhoneDuplicateMatch[];
      readonly sourceRevision: number;
    };
export interface CreateOnboardingCustomerInput {
  readonly previewToken: string;
  readonly confirmPossibleDuplicate?: boolean;
  readonly clientMutationId: string;
}
export interface CloseOnboardingResult { readonly closed: true; }
