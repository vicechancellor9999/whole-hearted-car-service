import type { CustomerNamePreview, CustomerType } from "@/lib/customers/types";
import type {
  OnboardingCustomerPreview,
  OnboardingKycConfirmation,
  OnboardingKycSubmission,
  OnboardingLicenseProfile,
  OnboardingOtpChallenge,
  OnboardingOtpVerification,
  OnboardingPhoneDuplicateMatch,
} from "@/lib/customers/onboarding-types";
import type { LicenseExtractionField, LicenseExtractionResult } from "@/lib/customers/license-extraction/types";

export type OnboardingPhoneStatus = "idle" | "checking" | "missing" | "duplicate" | "clear" | "verified";

export interface CustomerOnboardingState {
  readonly customerType: CustomerType;
  readonly primaryPhone: string;
  readonly normalizedPhone: string | null;
  readonly phoneStatus: OnboardingPhoneStatus;
  readonly phoneMatches: readonly OnboardingPhoneDuplicateMatch[];
  readonly onboardingToken: string | null;
  readonly otpChallenge: OnboardingOtpChallenge | null;
  readonly otpVerification: OnboardingOtpVerification | null;
  readonly licenseImageKey: string | null;
  readonly licenseProfile: Omit<OnboardingLicenseProfile, "sex"> & { readonly sex: "M" | "F" | "" };
  readonly licenseAttested: boolean;
  readonly kycSubmission: OnboardingKycSubmission | null;
  readonly kycConfirmation: OnboardingKycConfirmation | null;
  readonly nameSourceValue: string;
  readonly namePreview: CustomerNamePreview | null;
  readonly customerPreview: OnboardingCustomerPreview | null;
  readonly previewPhoneMatches: readonly OnboardingPhoneDuplicateMatch[];
  readonly confirmPossibleDuplicate: boolean;
}

export type CustomerOnboardingAction =
  | { readonly type: "customerTypeChanged"; readonly value: CustomerType }
  | { readonly type: "phoneChanged"; readonly value: string }
  | { readonly type: "phoneCheckStarted" }
  | { readonly type: "phoneDuplicate"; readonly phoneE164: string; readonly matches: readonly OnboardingPhoneDuplicateMatch[] }
  | { readonly type: "phoneCleared"; readonly token: string; readonly phoneE164: string | null }
  | { readonly type: "otpRequested"; readonly challenge: OnboardingOtpChallenge }
  | { readonly type: "otpVerified"; readonly verification: OnboardingOtpVerification }
  | { readonly type: "licenseImageChanged"; readonly imageKey: string | null }
  | { readonly type: "licenseExtractionCompleted"; readonly result: LicenseExtractionResult }
  | { readonly type: "licenseFieldChanged"; readonly field: LicenseExtractionField; readonly value: string }
  | { readonly type: "licenseAttestationChanged"; readonly value: boolean }
  | { readonly type: "kycSubmitted"; readonly submission: OnboardingKycSubmission }
  | { readonly type: "kycVerified"; readonly confirmation: OnboardingKycConfirmation }
  | { readonly type: "nameSourceChanged"; readonly value: string }
  | { readonly type: "nameTransliterationConfirmed"; readonly preview: CustomerNamePreview }
  | { readonly type: "profileChanged" }
  | { readonly type: "customerPreviewed"; readonly preview: OnboardingCustomerPreview }
  | { readonly type: "customerPhoneConflict"; readonly matches: readonly OnboardingPhoneDuplicateMatch[] }
  | { readonly type: "customerPreviewInvalidated" }
  | { readonly type: "duplicateConfirmationChanged"; readonly value: boolean };

const emptyLicenseProfile = (): CustomerOnboardingState["licenseProfile"] => ({
  name: "",
  birthDate: "",
  sex: "",
  address: "",
});

export function createCustomerOnboardingState(customerType: CustomerType = "individual"): CustomerOnboardingState {
  return {
    customerType,
    primaryPhone: "",
    normalizedPhone: null,
    phoneStatus: "idle",
    phoneMatches: [],
    onboardingToken: null,
    otpChallenge: null,
    otpVerification: null,
    licenseImageKey: null,
    licenseProfile: emptyLicenseProfile(),
    licenseAttested: false,
    kycSubmission: null,
    kycConfirmation: null,
    nameSourceValue: "",
    namePreview: null,
    customerPreview: null,
    previewPhoneMatches: [],
    confirmPossibleDuplicate: false,
  };
}

function invalidateFromPhone(state: CustomerOnboardingState, primaryPhone: string): CustomerOnboardingState {
  return { ...createCustomerOnboardingState(state.customerType), primaryPhone };
}

function invalidateFromLicense(state: CustomerOnboardingState): CustomerOnboardingState {
  return {
    ...state,
    licenseProfile: emptyLicenseProfile(),
    licenseAttested: false,
    kycSubmission: null,
    kycConfirmation: null,
    nameSourceValue: "",
    namePreview: null,
    customerPreview: null,
    previewPhoneMatches: [],
    confirmPossibleDuplicate: false,
  };
}

function invalidateConfirmedLicense(state: CustomerOnboardingState): CustomerOnboardingState {
  return {
    ...state,
    licenseAttested: false,
    kycSubmission: null,
    kycConfirmation: null,
    nameSourceValue: "",
    namePreview: null,
    customerPreview: null,
    previewPhoneMatches: [],
    confirmPossibleDuplicate: false,
  };
}

export function customerOnboardingReducer(
  state: CustomerOnboardingState,
  action: CustomerOnboardingAction,
): CustomerOnboardingState {
  switch (action.type) {
    case "customerTypeChanged":
      return createCustomerOnboardingState(action.value);
    case "phoneChanged":
      return invalidateFromPhone(state, action.value);
    case "phoneCheckStarted":
      return { ...invalidateFromPhone(state, state.primaryPhone), phoneStatus: "checking" };
    case "phoneDuplicate":
      return {
        ...invalidateFromPhone(state, state.primaryPhone),
        normalizedPhone: action.phoneE164,
        phoneStatus: "duplicate",
        phoneMatches: action.matches,
      };
    case "phoneCleared":
      return {
        ...invalidateFromPhone(state, state.primaryPhone),
        normalizedPhone: action.phoneE164,
        phoneStatus: action.phoneE164 === null ? "missing" : "clear",
        onboardingToken: action.token,
      };
    case "otpRequested":
      return { ...state, otpChallenge: action.challenge, customerPreview: null, confirmPossibleDuplicate: false };
    case "otpVerified":
      return { ...state, phoneStatus: "verified", otpVerification: action.verification, customerPreview: null, confirmPossibleDuplicate: false };
    case "licenseImageChanged":
      return { ...invalidateFromLicense(state), licenseImageKey: action.imageKey };
    case "licenseExtractionCompleted":
      return {
        ...invalidateConfirmedLicense(state),
        licenseProfile: {
          name: action.result.status.name === "extracted" && action.result.profile.name !== undefined
            ? action.result.profile.name : state.licenseProfile.name,
          birthDate: action.result.status.birthDate === "extracted" && action.result.profile.birthDate !== undefined
            ? action.result.profile.birthDate : state.licenseProfile.birthDate,
          sex: action.result.status.sex === "extracted" && action.result.profile.sex !== undefined
            ? action.result.profile.sex : state.licenseProfile.sex,
          address: action.result.status.address === "extracted" && action.result.profile.address !== undefined
            ? action.result.profile.address : state.licenseProfile.address,
        },
      };
    case "licenseFieldChanged":
      return {
        ...invalidateConfirmedLicense(state),
        licenseProfile: {
          ...state.licenseProfile,
          [action.field]: action.field === "sex" ? action.value as OnboardingLicenseProfile["sex"] : action.value,
        },
      };
    case "licenseAttestationChanged":
      return {
        ...state,
        licenseAttested: action.value,
        customerPreview: null,
        confirmPossibleDuplicate: false,
        ...(action.value ? {} : {
          kycSubmission: null,
          kycConfirmation: null,
          namePreview: null,
          customerPreview: null,
          previewPhoneMatches: [],
          confirmPossibleDuplicate: false,
        }),
      };
    case "kycSubmitted":
      return { ...state, kycSubmission: action.submission, customerPreview: null, confirmPossibleDuplicate: false };
    case "kycVerified":
      return { ...state, kycConfirmation: action.confirmation, customerPreview: null, confirmPossibleDuplicate: false };
    case "nameSourceChanged":
      return {
        ...state,
        nameSourceValue: action.value,
        namePreview: null,
        customerPreview: null,
        previewPhoneMatches: [],
        confirmPossibleDuplicate: false,
      };
    case "nameTransliterationConfirmed":
      return { ...state, namePreview: action.preview, customerPreview: null, previewPhoneMatches: [], confirmPossibleDuplicate: false };
    case "profileChanged":
      return { ...state, customerPreview: null, previewPhoneMatches: [], confirmPossibleDuplicate: false };
    case "customerPreviewed":
      return { ...state, customerPreview: action.preview, previewPhoneMatches: [], confirmPossibleDuplicate: false };
    case "customerPhoneConflict":
      return { ...state, customerPreview: null, previewPhoneMatches: action.matches, confirmPossibleDuplicate: false };
    case "customerPreviewInvalidated":
      return { ...state, customerPreview: null, previewPhoneMatches: [], confirmPossibleDuplicate: false };
    case "duplicateConfirmationChanged":
      return { ...state, confirmPossibleDuplicate: action.value };
  }
}
