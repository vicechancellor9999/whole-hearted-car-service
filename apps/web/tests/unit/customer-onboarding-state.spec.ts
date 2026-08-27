import { expect, test } from "@playwright/test";
import {
  createCustomerOnboardingState,
  customerOnboardingReducer,
} from "../../src/components/customers/customer-onboarding-state";

function reduce(
  state: ReturnType<typeof createCustomerOnboardingState>,
  ...actions: Parameters<typeof customerOnboardingReducer>[1][]
) {
  return actions.reduce(customerOnboardingReducer, state);
}

function completedIndividualState() {
  return reduce(
    createCustomerOnboardingState("individual"),
    { type: "phoneChanged", value: "+1 876 555 0199" },
    { type: "phoneCleared", token: "onboarding-token", phoneE164: "+18765550199" },
    { type: "otpVerified", verification: { otpChallengeId: "otp-1", phoneE164: "+18765550199", verifiedAt: "2026-08-13T12:00:00.000Z" } },
    { type: "licenseImageChanged", imageKey: "license-1" },
    { type: "licenseExtractionCompleted", result: {
      profile: { name: "Alicia Bennett", birthDate: "1988-03-22", sex: "F", address: "12 Constant Spring Road" },
      status: { name: "extracted", birthDate: "extracted", sex: "extracted", address: "extracted" },
    } },
    { type: "licenseAttestationChanged", value: true },
    { type: "kycSubmitted", submission: { kycDraftId: "kyc-1", submittedAt: "2026-08-13T12:00:30.000Z" } },
    { type: "kycVerified", confirmation: { kycDraftId: "kyc-1", profile: { name: "Alicia Bennett", birthDate: "1988-03-22", sex: "F", address: "12 Constant Spring Road" }, verifiedAt: "2026-08-13T12:01:00.000Z" } },
    { type: "nameSourceChanged", value: "Alicia Bennett" },
    { type: "nameTransliterationConfirmed", preview: { sourceScript: "en", sourceValue: "Alicia Bennett", nameZh: "艾丽西亚·贝内特", nameEn: "Alicia Bennett", method: "exact_name_dictionary", version: "customer-name-v1", status: "confirmed", confirmationToken: "name-token" } },
    { type: "customerPreviewed", preview: { input: { customerType: "individual", nameSourceValue: "Alicia Bennett" }, candidates: [], sourceRevision: 1, previewToken: "preview-token" } as never },
  );
}

test("changing the checked phone clears the token and every phone-bound receipt", () => {
  const next = customerOnboardingReducer(completedIndividualState(), {
    type: "phoneChanged",
    value: "+1 876 555 0188",
  });

  expect(next.primaryPhone).toBe("+1 876 555 0188");
  expect(next.onboardingToken).toBeNull();
  expect(next.otpVerification).toBeNull();
  expect(next.kycConfirmation).toBeNull();
  expect(next.namePreview).toBeNull();
  expect(next.customerPreview).toBeNull();
});

test("changing the licence image clears extraction, KYC, name confirmation, and final preview", () => {
  const next = customerOnboardingReducer(completedIndividualState(), {
    type: "licenseImageChanged",
    imageKey: "license-2",
  });

  expect(next.licenseImageKey).toBe("license-2");
  expect(next.licenseProfile).toEqual({ name: "", birthDate: "", sex: "", address: "" });
  expect(next.licenseAttested).toBe(false);
  expect(next.kycSubmission).toBeNull();
  expect(next.kycConfirmation).toBeNull();
  expect(next.nameSourceValue).toBe("");
  expect(next.namePreview).toBeNull();
  expect(next.customerPreview).toBeNull();
});

test("license extraction merges only present extracted fields without erasing manual values", () => {
  const current = reduce(
    createCustomerOnboardingState("individual"),
    { type: "licenseFieldChanged", field: "birthDate", value: "1980-01-02" },
    { type: "licenseFieldChanged", field: "address", value: "Manual address" },
  );
  const next = customerOnboardingReducer(current, {
    type: "licenseExtractionCompleted",
    result: {
      profile: { name: "Alicia Bennett" },
      status: {
        name: "extracted",
        birthDate: "manual_required",
        sex: "manual_required",
        address: "manual_required",
      },
    },
  });

  expect(next.licenseProfile).toEqual({
    name: "Alicia Bennett",
    birthDate: "1980-01-02",
    sex: "",
    address: "Manual address",
  });
});

test("editing one confirmed licence field invalidates attestation and downstream receipts", () => {
  const next = customerOnboardingReducer(completedIndividualState(), {
    type: "licenseFieldChanged",
    field: "address",
    value: "14 Constant Spring Road",
  });

  expect(next.licenseProfile.address).toBe("14 Constant Spring Road");
  expect(next.licenseAttested).toBe(false);
  expect(next.kycSubmission).toBeNull();
  expect(next.kycConfirmation).toBeNull();
  expect(next.nameSourceValue).toBe("");
  expect(next.namePreview).toBeNull();
  expect(next.customerPreview).toBeNull();
});

test("changing the source name invalidates transliteration and final preview only", () => {
  const current = completedIndividualState();
  const next = customerOnboardingReducer(current, {
    type: "nameSourceChanged",
    value: "Alicia B. Bennett",
  });

  expect(next.nameSourceValue).toBe("Alicia B. Bennett");
  expect(next.namePreview).toBeNull();
  expect(next.customerPreview).toBeNull();
  expect(next.otpVerification).toEqual(current.otpVerification);
  expect(next.kycConfirmation).toEqual(current.kycConfirmation);
});

test("changing customer type drops the current token and restarts all staged data", () => {
  const next = customerOnboardingReducer(completedIndividualState(), {
    type: "customerTypeChanged",
    value: "organization",
  });

  expect(next).toEqual(createCustomerOnboardingState("organization"));
});

test("blank phone clearance starts a missing-phone session without fabricating verification", () => {
  const next = customerOnboardingReducer(createCustomerOnboardingState("individual"), {
    type: "phoneCleared",
    token: "onboarding-missing-phone",
    phoneE164: null,
  });

  expect(next).toMatchObject({
    normalizedPhone: null,
    phoneStatus: "missing",
    onboardingToken: "onboarding-missing-phone",
    otpChallenge: null,
    otpVerification: null,
  });
});

test("final phone ownership conflict keeps safe owners but never keeps a ready preview", () => {
  const ready = customerOnboardingReducer(createCustomerOnboardingState("individual"), {
    type: "phoneCleared",
    token: "onboarding-token",
    phoneE164: "+18765550199",
  });
  const match = {
    customerId: "CUST-UAT-001",
    customerDisplayName: "Alicia Bennett",
    customerStatus: "active" as const,
    incomingField: "secondaryPhone" as const,
    existingField: "phone" as const,
    phoneE164: "+18765550101",
  };
  const next = customerOnboardingReducer(ready, {
    type: "customerPhoneConflict",
    matches: [match],
  });

  expect(next.customerPreview).toBeNull();
  expect(next.previewPhoneMatches).toEqual([match]);

  const cleared = customerOnboardingReducer(next, { type: "profileChanged" });
  expect(cleared.previewPhoneMatches).toEqual([]);
});

test("source revision invalidation clears only final preview state and dead duplicate confirmation", () => {
  const match = {
    customerId: "CUST-UAT-001",
    customerDisplayName: "Alicia Bennett",
    customerStatus: "active" as const,
    incomingField: "secondaryPhone" as const,
    existingField: "phone" as const,
    phoneE164: "+18765550101",
  };
  const current = {
    ...completedIndividualState(),
    previewPhoneMatches: [match],
    confirmPossibleDuplicate: true,
  };

  const next = customerOnboardingReducer(current, { type: "customerPreviewInvalidated" });

  expect(next).toEqual({
    ...current,
    customerPreview: null,
    previewPhoneMatches: [],
    confirmPossibleDuplicate: false,
  });
});

test("progressing optional OTP or licence evidence invalidates a stale final preview", () => {
  const actions: Parameters<typeof customerOnboardingReducer>[1][] = [
    { type: "otpRequested", challenge: { otpChallengeId: "otp-2", phoneE164: "+18765550199", requestedAt: "2026-08-13T12:02:00.000Z" } },
    { type: "otpVerified", verification: { otpChallengeId: "otp-2", phoneE164: "+18765550199", verifiedAt: "2026-08-13T12:02:00.000Z" } },
    { type: "licenseAttestationChanged", value: true },
    { type: "kycSubmitted", submission: { kycDraftId: "kyc-2", submittedAt: "2026-08-13T12:02:30.000Z" } },
    { type: "kycVerified", confirmation: { kycDraftId: "kyc-2", profile: { name: "Alicia Bennett", birthDate: "1988-03-22", sex: "F", address: "12 Constant Spring Road" }, verifiedAt: "2026-08-13T12:03:00.000Z" } },
  ];

  for (const action of actions) {
    const current = action.type === "licenseAttestationChanged"
      ? { ...completedIndividualState(), licenseAttested: false }
      : completedIndividualState();
    const next = customerOnboardingReducer(current, action);
    expect(next.customerPreview, action.type).toBeNull();
  }
});
