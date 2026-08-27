import { expect, test } from "@playwright/test";
import {
  createMockCustomerVehicleStore,
  CustomerVehicleValidationError,
} from "../../src/lib/api/mock-customers";
import type {
  OnboardingCustomerPreview,
  OnboardingCustomerPreviewResult,
  OnboardingLicenseProfile,
  OnboardingPhoneDuplicateMatch,
} from "../../src/lib/customers/onboarding-types";
import { isCustomerEnvelopeV3 } from "../../src/lib/customers/migrations";
import type { CustomerDraftInput, CustomerRecord } from "../../src/lib/customers/types";
import type { PreparedLicenseEvidence } from "../../src/lib/customers/license-extraction/types";

const superadmin = { actorId: "emp-onboarding-001", role: "superadmin" };
const frontdeskAdmin = { actorId: "emp-onboarding-002", role: "frontdesk_admin" };
const denied = { actorId: "emp-onboarding-denied", role: "mechanic" };
const clearPhone = "+18760000001";
const otherClearPhone = "+18760000002";
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==";

function readyPreview(result: OnboardingCustomerPreviewResult): OnboardingCustomerPreview {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected ready onboarding preview");
  return result;
}

function preparedLicense(id = "onboarding-license-front-001"): PreparedLicenseEvidence {
  return {
    id,
    fileName: `${id}.png`,
    url: PNG_DATA_URL,
    mimeType: "image/png",
    sizeBytes: 70,
  };
}

function memoryStorage() {
  return {
    raw: null as string | null,
    writeCount: 0,
    failWrites: false,
    getItem() { return this.raw; },
    setItem(_key: string, value: string) {
      if (this.failWrites) throw new Error("onboarding write failed");
      this.writeCount += 1;
      this.raw = value;
    },
  };
}

function verifiedOnboarding(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  {
    access = superadmin,
    customerType = "individual",
    phone = clearPhone,
    id = "verified-onboarding",
  }: {
    access?: typeof superadmin;
    customerType?: "individual" | "organization";
    phone?: string;
    id?: string;
  } = {},
) {
  const phonePreview = store.previewOnboardingPhone(access, {
    customerType,
    primaryPhone: phone,
    clientMutationId: `${id}-phone`,
  });
  expect(phonePreview.status).toBe("clear");
  if (phonePreview.status !== "clear") throw new Error("expected clear onboarding phone");
  const challenge = store.requestOnboardingOtp(access, phonePreview.onboardingToken, {
    clientMutationId: `${id}-otp-request`,
  });
  const verification = store.verifyOnboardingOtp(access, phonePreview.onboardingToken, {
    otpChallengeId: challenge.otpChallengeId,
    code: "123456",
    clientMutationId: `${id}-otp-verify`,
  });
  return { phonePreview, challenge, verification, token: phonePreview.onboardingToken };
}

function confirmedIndividualOnboarding(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  {
    phone = clearPhone,
    id = "confirmed-individual",
    asset = preparedLicense(),
    profile = {
      name: "陈志远",
      birthDate: "1990-04-05",
      sex: "M" as const,
      address: "12 Hope Road, Kingston",
    },
  }: {
    phone?: string;
    id?: string;
    asset?: PreparedLicenseEvidence;
    profile?: OnboardingLicenseProfile;
  } = {},
) {
  const verified = verifiedOnboarding(store, { phone, id });
  const submitted = store.submitOnboardingKyc(superadmin, verified.token, {
    frontAsset: asset,
    profile,
    clientMutationId: `${id}-kyc-submit`,
  });
  const confirmed = store.verifyOnboardingKyc(superadmin, verified.token, {
    kycDraftId: submitted.kycDraftId,
    attested: true,
    clientMutationId: `${id}-kyc-verify`,
  });
  return { ...verified, submitted, confirmed, asset, profile };
}

function individualDraft(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  phone: string | null = clearPhone,
  overrides: Partial<CustomerDraftInput> = {},
): CustomerDraftInput {
  const nameSourceValue = overrides.nameSourceValue ?? "陈志远";
  const name = store.previewCustomerName(superadmin, nameSourceValue!);
  return {
    customerType: "individual",
    nameSourceValue,
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: phone,
    birthDate: "1990-04-05",
    gender: "男",
    address: "12 Hope Road, Kingston",
    ...overrides,
  };
}

function organizationDraft(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  phone: string | null,
  overrides: Partial<CustomerDraftInput> = {},
): CustomerDraftInput {
  const nameSourceValue = overrides.nameSourceValue ?? "顾明轩";
  const name = store.previewCustomerName(superadmin, nameSourceValue!);
  return {
    customerType: "organization",
    organizationName: "Harbour Test Fleet Ltd",
    nameSourceValue,
    nameTransliterationToken: name.confirmationToken,
    primaryContactRole: "Fleet manager",
    primaryPhone: phone,
    address: "88 Company Road, Kingston",
    ...overrides,
  };
}

function previewConfirmedIndividual(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  token: string,
  phone = clearPhone,
  id = "individual-final-preview",
  overrides: Partial<CustomerDraftInput> = {},
) {
  return readyPreview(store.previewOnboardingCustomer(superadmin, token, {
    customer: individualDraft(store, phone, overrides),
    clientMutationId: id,
  }));
}

function updateStoredPhone(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  field: "primaryPhone" | "secondaryPhone" | "whatsapp",
  value: string,
): CustomerRecord {
  const current = store.customer(superadmin, "CUST-UAT-004");
  const preview = store.previewCustomerUpdate(superadmin, current.id, {
    customerType: current.customerType,
    organizationName: current.organizationName,
    nameSourceValue: current.nameSourceValue,
    primaryPhone: current.phone,
    secondaryPhone: current.secondaryPhone,
    whatsapp: current.whatsapp,
    expectedRevision: current.revision,
    [field]: value,
  });
  return store.updateCustomer(superadmin, current.id, {
    ...preview.input,
    expectedRevision: current.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
  });
}

function previewClear(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  access = superadmin,
  phone = clearPhone,
  clientMutationId = "preview-clear-1",
) {
  const result = store.previewOnboardingPhone(access, {
    customerType: "individual",
    primaryPhone: phone,
    clientMutationId,
  });
  expect(result.status).toBe("clear");
  if (result.status !== "clear") throw new Error("expected clear phone");
  return result;
}

function caught(run: () => unknown): CustomerVehicleValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CustomerVehicleValidationError);
    return error as CustomerVehicleValidationError;
  }
  throw new Error("expected validation error");
}

test("non-close onboarding methods authorize before inspecting malformed bodies or tokens", () => {
  const store = createMockCustomerVehicleStore();
  const calls = [
    () => store.previewOnboardingPhone(denied, null as never),
    () => store.requestOnboardingOtp(denied, "data:text/plain,secret", null as never),
    () => store.verifyOnboardingOtp(denied, "", null as never),
    () => store.submitOnboardingKyc(denied, "data:text/plain,secret", null as never),
    () => store.verifyOnboardingKyc(denied, "", null as never),
    () => store.previewOnboardingCustomer(denied, "data:text/plain,secret", null as never),
    () => store.createOnboardingCustomer(denied, "data:text/plain,secret", null as never),
  ];
  for (const call of calls) expect(call).toThrow("403 无权读取客户与车辆完整目录");
  expect(store.closeOnboarding(denied, "data:text/plain,secret")).toEqual({ closed: true });
});

test("phone preview permits a blank phone while preserving exact safe input and Jamaica E.164 validation", () => {
  const store = createMockCustomerVehicleStore();
  const blank = store.previewOnboardingPhone(superadmin, {
    customerType: "individual",
    primaryPhone: "   ",
    clientMutationId: "blank-phone-preview",
  });
  expect(blank).toMatchObject({ status: "clear", phoneE164: null, sourceRevision: 1 });
  expect(blank.status === "clear" && blank.onboardingToken).toBeTruthy();

  const absent = store.previewOnboardingPhone(superadmin, {
    customerType: "organization",
    primaryPhone: null,
    clientMutationId: "absent-phone-preview",
  });
  expect(absent).toMatchObject({ status: "clear", phoneE164: null, sourceRevision: 1 });
  expect(absent.status === "clear" && absent.onboardingToken).toBeTruthy();

  const local = store.previewOnboardingPhone(superadmin, {
    customerType: "individual",
    primaryPhone: "(876) 000-0001",
    clientMutationId: "jm-local-preview",
  });
  expect(local).toMatchObject({ status: "clear", phoneE164: clearPhone, sourceRevision: 1 });

  for (const input of [
    { customerType: "individual", primaryPhone: "555-0101", clientMutationId: "invalid-phone" },
    { customerType: "person", primaryPhone: clearPhone, clientMutationId: "invalid-type" },
    { customerType: "individual", primaryPhone: clearPhone, clientMutationId: "" },
    { customerType: "individual", primaryPhone: clearPhone, clientMutationId: "data:text/plain,private" },
    { customerType: "individual", primaryPhone: clearPhone, clientMutationId: "extra-key", extra: true },
  ]) {
    const error = caught(() => store.previewOnboardingPhone(superadmin, input as never));
    expect(error.status).toBe(400);
    expect(String(error)).not.toContain("private");
  }

  const malformedClockStore = createMockCustomerVehicleStore({ clock: () => "13 August 2026" });
  expect(() => malformedClockStore.previewOnboardingPhone(superadmin, {
    customerType: "individual",
    primaryPhone: otherClearPhone,
    clientMutationId: "bad-clock",
  })).toThrow(/时间/);
});

test("preview and create persist explicit onboarding gaps without requiring OTP or KYC（手机号必填，2026-08-17）", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({
    storage,
    clock: () => "2026-08-14T12:00:00.000Z",
    customerId: () => "CUST-OPTIONAL-GAPS-001",
  });
  const phone = store.previewOnboardingPhone(superadmin, {
    customerType: "individual",
    primaryPhone: clearPhone,
    clientMutationId: "optional-gaps-phone",
  });
  expect(phone.status).toBe("clear");
  if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
  // 手机号在，可正常发起 OTP（不强制验证）
  const otp = store.requestOnboardingOtp(superadmin, phone.onboardingToken, {
    clientMutationId: "explicit-request-with-phone",
  });
  expect(otp.otpChallengeId).toBeTruthy();
  const preview = readyPreview(store.previewOnboardingCustomer(superadmin, phone.onboardingToken, {
    customer: individualDraft(store, clearPhone, { birthDate: null, gender: null, address: null }),
    clientMutationId: "preview-with-gaps",
  }));
  expect(preview.status).toBe("ready");
  expect(preview.reminders).toEqual(expect.arrayContaining([
    { kind: "otp", status: "pending" },
    { kind: "kyc", subjectType: "customer", status: "evidence_missing" },
  ]));

  const created = store.createOnboardingCustomer(superadmin, phone.onboardingToken, {
    previewToken: preview.previewToken,
    clientMutationId: "create-with-gaps",
  });
  expect(created.phone).toBe(clearPhone);
  expect(created.verificationArchive.otpRecords).toHaveLength(1);
  expect(created.verificationArchive.kycRecords).toHaveLength(0);
  expect(created.verificationArchive.evidenceGaps).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "kyc",
      reason: "onboarding_incomplete",
      subjectType: "customer",
      status: "evidence_missing",
    }),
  ]));
  expect(store.customerAuditHistory(superadmin, created.id).map((event) => event.eventType))
    .toEqual(["customer_created", "otp_requested"]);
  expect(storage.writeCount).toBe(1);
  expect(JSON.parse(storage.raw!).schemaVersion).toBe(3);
});

test("requested but unverified OTP and submitted but unverified KYC persist as pending facts", () => {
  const store = createMockCustomerVehicleStore({ clock: () => "2026-08-14T12:10:00.000Z" });
  const phone = previewClear(store, superadmin, clearPhone, "pending-facts-phone");
  store.requestOnboardingOtp(superadmin, phone.onboardingToken, {
    clientMutationId: "pending-facts-otp-request",
  });
  store.submitOnboardingKyc(superadmin, phone.onboardingToken, {
    frontAsset: preparedLicense("pending-facts-license"),
    profile: {
      name: "陈志远",
      birthDate: "1990-04-05",
      sex: "M",
      address: "12 Hope Road, Kingston",
    },
    clientMutationId: "pending-facts-kyc-submit",
  });
  const preview = readyPreview(store.previewOnboardingCustomer(superadmin, phone.onboardingToken, {
    customer: individualDraft(store),
    clientMutationId: "pending-facts-preview",
  }));
  expect(preview.reminders).toEqual(expect.arrayContaining([
    { kind: "otp", status: "pending" },
    { kind: "kyc", subjectType: "customer", status: "pending_verification" },
  ]));
  const created = store.createOnboardingCustomer(superadmin, phone.onboardingToken, {
    previewToken: preview.previewToken,
    clientMutationId: "pending-facts-create",
  });
  expect(created.verificationArchive.otpRecords).toEqual([
    expect.objectContaining({ phoneE164: clearPhone }),
  ]);
  expect(created.verificationArchive.otpRecords[0]).not.toHaveProperty("verifiedAt");
  expect(created.verificationArchive.kycRecords).toEqual([
    expect.objectContaining({ documentType: "drivers_license" }),
  ]);
  expect(created.verificationArchive.kycRecords[0]).not.toHaveProperty("verifiedAt");
  expect(created.verificationArchive.evidenceGaps).toEqual([]);
  expect(store.customerAuditHistory(superadmin, created.id).map((event) => event.eventType))
    .toEqual(["customer_created", "kyc_submitted", "otp_requested"]);
});

test("requesting OTP after preview invalidates the stale not-requested snapshot and same-key preview receipt", () => {
  const store = createMockCustomerVehicleStore();
  const phone = previewClear(store, superadmin, clearPhone, "preview-then-request-phone");
  const customer = individualDraft(store);
  const input = { customer, clientMutationId: "preview-then-request-customer" };
  const before = readyPreview(store.previewOnboardingCustomer(superadmin, phone.onboardingToken, input));
  expect(before.reminders).toContainEqual({ kind: "otp", status: "not_requested" });

  store.requestOnboardingOtp(superadmin, phone.onboardingToken, {
    clientMutationId: "preview-then-request-otp",
  });
  const refreshed = readyPreview(store.previewOnboardingCustomer(superadmin, phone.onboardingToken, input));
  expect(refreshed.previewToken).not.toBe(before.previewToken);
  expect(refreshed.reminders).toContainEqual({ kind: "otp", status: "pending" });
});

test("organization onboarding scopes verified KYC to the primary contact without overwriting company fields or leaking PII", () => {
  const store = createMockCustomerVehicleStore({
    clock: () => "2026-08-14T12:20:00.000Z",
    customerId: () => "CUST-ORG-CONTACT-KYC-001",
  });
  const phone = store.previewOnboardingPhone(superadmin, {
    customerType: "organization",
    primaryPhone: clearPhone,
    clientMutationId: "org-contact-phone",
  });
  expect(phone.status).toBe("clear");
  if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
  const profile = {
    name: "顾明轩",
    birthDate: "1988-06-07",
    sex: "M" as const,
    address: "14 Contact Lane, Kingston",
  };
  const submission = store.submitOnboardingKyc(superadmin, phone.onboardingToken, {
    frontAsset: preparedLicense("org-contact-license"),
    profile,
    clientMutationId: "org-contact-submit",
  });
  store.verifyOnboardingKyc(superadmin, phone.onboardingToken, {
    kycDraftId: submission.kycDraftId,
    attested: true,
    clientMutationId: "org-contact-verify",
  });
  const preview = readyPreview(store.previewOnboardingCustomer(superadmin, phone.onboardingToken, {
    customer: organizationDraft(store, clearPhone),
    clientMutationId: "org-contact-preview",
  }));
  expect(preview.reminders).toEqual([{ kind: "otp", status: "not_requested" }]);
  const created = store.createOnboardingCustomer(superadmin, phone.onboardingToken, {
    previewToken: preview.previewToken,
    clientMutationId: "org-contact-create",
  });
  expect(created).toMatchObject({
    address: "88 Company Road, Kingston",
    birthDate: null,
    gender: null,
  });
  expect(created.verificationArchive.kycRecords).toEqual([
    expect.objectContaining({
      subjectType: "organization_primary_contact",
      subjectProfile: profile,
      verifiedBy: superadmin.actorId,
    }),
  ]);
  const audit = store.customerAuditHistory(superadmin, created.id);
  expect(audit.find((event) => event.eventType === "kyc_submitted")?.summary).toBe("提交主要联系人驾驶证证据");
  expect(audit.find((event) => event.eventType === "kyc_verified")?.summary).toBe("完成主要联系人驾驶证核验");
  const serialized = JSON.stringify(audit.filter((event) => event.eventType.startsWith("kyc_")));
  expect(serialized).not.toContain("企业驾驶证");
  for (const value of Object.values(profile)) expect(serialized).not.toContain(value);
  expect(serialized).not.toMatch(/data:image|base64/i);
});

test("confirmed license profile differences become reminders and never overwrite the formal customer draft", () => {
  const store = createMockCustomerVehicleStore();
  const onboarding = confirmedIndividualOnboarding(store, { id: "profile-reminder" });
  const preview = readyPreview(store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: individualDraft(store, clearPhone, {
      nameSourceValue: "陈志原",
      birthDate: "1991-04-05",
      gender: "女",
      address: "99 Formal Address",
    }),
    clientMutationId: "profile-reminder-preview",
  }));
  expect(preview.reminders).toContainEqual({ kind: "kyc_profile_mismatch", subjectType: "customer" });
  const created = store.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: preview.previewToken,
    clientMutationId: "profile-reminder-create",
  });
  expect(created).toMatchObject({
    nameSourceValue: "陈志原",
    birthDate: "1991-04-05",
    gender: "女",
    address: "99 Formal Address",
  });
  expect(created.verificationArchive.kycRecords[0]).toMatchObject({
    frontAsset: { id: onboarding.asset.id },
  });
});

test("driver-license profiles reject unknown keys, controls, data payloads, bad bounds, and future or impossible dates", () => {
  const badProfiles = [
    { name: "A", birthDate: "1990-04-05", sex: "M", address: "B", extra: "unknown" },
    { name: "A\nB", birthDate: "1990-04-05", sex: "M", address: "B" },
    { name: "data:text/plain,secret", birthDate: "1990-04-05", sex: "M", address: "B" },
    { name: "A".repeat(121), birthDate: "1990-04-05", sex: "M", address: "B" },
    { name: "A", birthDate: "1990-04-05", sex: "M", address: "B".repeat(321) },
    { name: "A", birthDate: "2026-02-30", sex: "M", address: "B" },
    { name: "A", birthDate: "2999-01-01", sex: "M", address: "B" },
    { name: "A", birthDate: "1990-04-05", sex: "X", address: "B" },
  ];
  for (const [index, profile] of badProfiles.entries()) {
    const store = createMockCustomerVehicleStore();
    const phone = store.previewOnboardingPhone(superadmin, {
      customerType: "individual",
      primaryPhone: null,
      clientMutationId: `profile-invalid-phone-${index}`,
    });
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    expect(caught(() => store.submitOnboardingKyc(superadmin, phone.onboardingToken, {
      frontAsset: preparedLicense(`profile-invalid-license-${index}`),
      profile,
      clientMutationId: `profile-invalid-submit-${index}`,
    } as never))).toMatchObject({ code: "CUSTOMER_ONBOARDING_KYC_PROFILE_INVALID", status: 400 });
  }
});

test("driver-license profiles reject data content after an alphanumeric prefix", () => {
  const store = createMockCustomerVehicleStore();
  const phone = store.previewOnboardingPhone(superadmin, {
    customerType: "individual",
    primaryPhone: null,
    clientMutationId: "profile-prefixed-data-phone",
  });
  if (phone.status !== "clear") throw new Error("expected clear onboarding phone");

  expect(caught(() => store.submitOnboardingKyc(superadmin, phone.onboardingToken, {
    frontAsset: preparedLicense("profile-prefixed-data-license"),
    profile: {
      name: "Xdata:text/plain,secret",
      birthDate: "1990-04-05",
      sex: "M",
      address: "B",
    },
    clientMutationId: "profile-prefixed-data-submit",
  }))).toMatchObject({ code: "CUSTOMER_ONBOARDING_KYC_PROFILE_INVALID", status: 400 });
});

test("phone match blocks a token across all three stored phone fields and exposes only the match DTO", () => {
  const store = createMockCustomerVehicleStore();
  const customer = store.customer(superadmin, "CUST-UAT-001");
  const storedFields = ["phone", "secondaryPhone", "whatsapp"] as const;
  for (const [index, phone] of [customer.phone, customer.secondaryPhone, customer.whatsapp].entries()) {
    expect(phone).toBeTruthy();
    const preview = store.previewOnboardingPhone(superadmin, {
      customerType: "individual",
      primaryPhone: phone!,
      clientMutationId: `stored-field-${index}`,
    });
    expect(preview.status).toBe("duplicate");
    if (preview.status !== "duplicate") throw new Error("expected duplicate phone");
    expect("onboardingToken" in preview).toBe(false);
    expect(preview.sourceRevision).toBe(1);
    expect(preview.matches.length).toBeGreaterThan(0);
    expect(preview.matches.find((match) =>
      match.customerId === "CUST-UAT-001" && match.existingField === storedFields[index])).toMatchObject({
      customerId: "CUST-UAT-001",
      customerDisplayName: "艾丽西亚·贝内特 / Alicia Bennett",
      customerStatus: "active",
      incomingField: "primaryPhone",
      existingField: storedFields[index],
      phoneE164: phone!.replaceAll(" ", ""),
    });
    for (const match of preview.matches) {
      expect(Reflect.ownKeys(match).sort()).toEqual([
        "customerDisplayName", "customerId", "customerStatus", "existingField", "incomingField", "phoneE164",
      ].sort());
      for (const forbidden of ["email", "address", "birthDate", "trn", "riskFlags", "verificationArchive"]) {
        expect(match).not.toHaveProperty(forbidden);
      }
    }
  }

  const name = store.previewCustomerName(superadmin, "陈志远");
  expect(() => store.previewCustomer(superadmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: customer.whatsapp,
  })).toThrow(/电话号码已属于其他客户档案/);
});

test("inactive and blacklisted customer statuses still block onboarding", () => {
  const store = createMockCustomerVehicleStore();
  const inactive = store.customer(superadmin, "CUST-UAT-004");
  const inactiveResult = store.previewOnboardingPhone(superadmin, {
    customerType: "organization",
    primaryPhone: inactive.phone!,
    clientMutationId: "inactive-match",
  });
  expect(inactiveResult.status).toBe("duplicate");
  if (inactiveResult.status !== "duplicate") throw new Error("expected inactive duplicate");
  expect(inactiveResult.matches.find((match) => match.customerId === inactive.id))
    .toMatchObject({ customerStatus: "inactive" });

  const updatePreview = store.previewCustomerUpdate(superadmin, inactive.id, {
    customerType: inactive.customerType,
    organizationName: inactive.organizationName,
    nameSourceValue: inactive.nameSourceValue,
    primaryPhone: inactive.phone,
    status: "blacklisted",
    expectedRevision: inactive.revision,
  });
  store.updateCustomer(superadmin, inactive.id, {
    ...updatePreview.input,
    expectedRevision: inactive.revision,
    previewToken: updatePreview.previewToken,
    confirmPossibleDuplicate: updatePreview.candidates.length > 0 ? true : undefined,
  });
  const blacklistedResult = store.previewOnboardingPhone(superadmin, {
    customerType: "organization",
    primaryPhone: inactive.phone!,
    clientMutationId: "blacklisted-match",
  });
  expect(blacklistedResult.status).toBe("duplicate");
  if (blacklistedResult.status !== "duplicate") throw new Error("expected blacklisted duplicate");
  expect(blacklistedResult.matches.find((match) => match.customerId === inactive.id))
    .toMatchObject({ customerStatus: "blacklisted" });
  expect(blacklistedResult.sourceRevision).toBe(2);
});

test("phone preview retry is byte-stable and deep-cloned while changed input conflicts before lookup", () => {
  const store = createMockCustomerVehicleStore();
  const input = {
    customerType: "individual" as const,
    primaryPhone: "+1 876 555 0101",
    clientMutationId: "duplicate-retry",
  };
  const first = store.previewOnboardingPhone(superadmin, input);
  expect(first.status).toBe("duplicate");
  if (first.status !== "duplicate") throw new Error("expected duplicate phone");
  const snapshot = JSON.stringify(first);
  (first.matches[0] as OnboardingPhoneDuplicateMatch & { customerDisplayName: string }).customerDisplayName = "mutated";
  const retry = store.previewOnboardingPhone(superadmin, input);
  expect(JSON.stringify(retry)).toBe(snapshot);
  const conflict = caught(() => store.previewOnboardingPhone(superadmin, {
    ...input,
    primaryPhone: otherClearPhone,
  }));
  expect(conflict).toMatchObject({ code: "CUSTOMER_ONBOARDING_IDEMPOTENCY_CONFLICT", status: 409 });
});

test("a new logical preview closes only that actor's previous session", () => {
  const store = createMockCustomerVehicleStore();
  const first = previewClear(store);
  const firstSnapshot = JSON.stringify(first);
  (first as { phoneE164: string }).phoneE164 = "+19999999999";
  expect(JSON.stringify(store.previewOnboardingPhone(superadmin, {
    customerType: "individual",
    primaryPhone: clearPhone,
    clientMutationId: "preview-clear-1",
  }))).toBe(firstSnapshot);
  const otherActor = previewClear(store, frontdeskAdmin, "+18760000003", "other-actor-preview");
  const replacement = previewClear(store, superadmin, otherClearPhone, "preview-clear-2");
  expect(replacement.onboardingToken).not.toBe(first.onboardingToken);

  const oldError = caught(() => store.requestOnboardingOtp(superadmin, first.onboardingToken, {
    clientMutationId: "request-old-session",
  }));
  const missingError = caught(() => store.requestOnboardingOtp(superadmin, "onboarding-missing-safe", {
    clientMutationId: "request-missing-session",
  }));
  expect({ code: oldError.code, status: oldError.status, message: oldError.message })
    .toEqual({ code: missingError.code, status: missingError.status, message: missingError.message });
  expect(store.requestOnboardingOtp(frontdeskAdmin, otherActor.onboardingToken, {
    clientMutationId: "request-other-actor-session",
  }).phoneE164).toBe("+18760000003");
});

test("OTP request rechecks current customer phones and forces a phone restart when newly occupied", () => {
  const store = createMockCustomerVehicleStore();
  const preview = previewClear(store);
  const current = store.customer(superadmin, "CUST-UAT-001");
  const updatePreview = store.previewCustomerUpdate(superadmin, current.id, {
    customerType: current.customerType,
    nameSourceValue: current.nameSourceValue,
    primaryPhone: current.phone,
    secondaryPhone: clearPhone,
    expectedRevision: current.revision,
  });
  store.updateCustomer(superadmin, current.id, {
    ...updatePreview.input,
    expectedRevision: current.revision,
    previewToken: updatePreview.previewToken,
    confirmPossibleDuplicate: updatePreview.candidates.length > 0 ? true : undefined,
  });
  const error = caught(() => store.requestOnboardingOtp(superadmin, preview.onboardingToken, {
    clientMutationId: "request-after-phone-occupied",
  }));
  expect(error).toMatchObject({ code: "CUSTOMER_PHONE_DUPLICATE", status: 409 });
});

test("OTP request and verification are idempotent, deep-cloned, and wrong code makes zero progress", () => {
  const store = createMockCustomerVehicleStore({ clock: () => "2026-08-13T12:00:00.000Z" });
  const preview = previewClear(store);
  const requestInput = { clientMutationId: "otp-request-1" };
  const firstChallenge = store.requestOnboardingOtp(superadmin, preview.onboardingToken, requestInput);
  expect(Reflect.ownKeys(firstChallenge).sort()).toEqual(["otpChallengeId", "phoneE164", "requestedAt"]);
  expect(JSON.stringify(firstChallenge)).not.toMatch(/data\s*:|rawText|confidence|frontAsset|evidence|url/i);
  const challengeSnapshot = JSON.stringify(firstChallenge);
  (firstChallenge as { phoneE164: string }).phoneE164 = "+19999999999";
  expect(JSON.stringify(store.requestOnboardingOtp(superadmin, preview.onboardingToken, requestInput)))
    .toBe(challengeSnapshot);
  expect(firstChallenge.otpChallengeId.trim()).not.toBe("");
  expect(firstChallenge.otpChallengeId).not.toMatch(/data\s*:/i);

  const verifyInput = {
    otpChallengeId: JSON.parse(challengeSnapshot).otpChallengeId as string,
    code: "000000",
    clientMutationId: "otp-verify-1",
  };
  const wrong = caught(() => store.verifyOnboardingOtp(superadmin, preview.onboardingToken, verifyInput));
  expect(wrong).toMatchObject({ code: "CUSTOMER_ONBOARDING_OTP_CODE_INVALID", status: 400 });

  const verified = store.verifyOnboardingOtp(superadmin, preview.onboardingToken, {
    ...verifyInput,
    code: "123456",
  });
  expect(verified).toEqual({
    otpChallengeId: verifyInput.otpChallengeId,
    phoneE164: clearPhone,
    verifiedAt: "2026-08-13T12:00:00.000Z",
  });
  expect(Reflect.ownKeys(verified).sort()).toEqual(["otpChallengeId", "phoneE164", "verifiedAt"]);
  expect(JSON.stringify(verified)).not.toMatch(/data\s*:|rawText|confidence|frontAsset|evidence|url/i);
  const verifiedSnapshot = JSON.stringify(verified);
  (verified as { phoneE164: string }).phoneE164 = "+19999999999";
  expect(JSON.stringify(store.verifyOnboardingOtp(superadmin, preview.onboardingToken, {
    ...verifyInput,
    code: "123456",
  }))).toBe(verifiedSnapshot);

  const conflict = caught(() => store.verifyOnboardingOtp(superadmin, preview.onboardingToken, {
    ...verifyInput,
    otpChallengeId: "otp-challenge-other-safe",
    code: "123456",
  }));
  expect(conflict).toMatchObject({ code: "CUSTOMER_ONBOARDING_IDEMPOTENCY_CONFLICT", status: 409 });
});

test("OTP request and verify recover post-receipt response loss with one challenge and one verified fact", () => {
  const store = createMockCustomerVehicleStore({
    clock: () => "2026-08-13T12:00:00.000Z",
    faults: {
      failNext: {
        customerOnboardingOtpRequestResponse: "OTP request response lost",
        customerOnboardingOtpVerifyResponse: "OTP verify response lost",
      },
    },
  });
  const phone = previewClear(store, superadmin, clearPhone, "otp-response-loss-phone");
  const requestInput = { clientMutationId: "otp-response-loss-request" };

  expect(() => store.requestOnboardingOtp(superadmin, phone.onboardingToken, requestInput))
    .toThrow("OTP request response lost");
  const challenge = store.requestOnboardingOtp(superadmin, phone.onboardingToken, requestInput);
  expect(store.requestOnboardingOtp(superadmin, phone.onboardingToken, requestInput)).toEqual(challenge);

  const verifyInput = {
    otpChallengeId: challenge.otpChallengeId,
    code: "123456",
    clientMutationId: "otp-response-loss-verify",
  };
  expect(() => store.verifyOnboardingOtp(superadmin, phone.onboardingToken, verifyInput))
    .toThrow("OTP verify response lost");
  const verified = store.verifyOnboardingOtp(superadmin, phone.onboardingToken, verifyInput);
  expect(store.verifyOnboardingOtp(superadmin, phone.onboardingToken, verifyInput)).toEqual(verified);

  const preview = previewConfirmedIndividual(store, phone.onboardingToken, clearPhone, "otp-response-loss-preview");
  const created = store.createOnboardingCustomer(superadmin, phone.onboardingToken, {
    previewToken: preview.previewToken,
    clientMutationId: "otp-response-loss-create",
  });
  expect(created.verificationArchive.otpRecords).toHaveLength(1);
  expect(created.verificationArchive.otpRecords[0]).toMatchObject({
    id: expect.any(String),
    phoneE164: clearPhone,
    requestedAt: challenge.requestedAt,
    verifiedAt: verified.verifiedAt,
  });
  const audits = store.audits(superadmin).filter((event) => "customerId" in event && event.customerId === created.id);
  expect(audits.filter((event) => event.eventType === "otp_requested")).toHaveLength(1);
  expect(audits.filter((event) => event.eventType === "otp_verified")).toHaveLength(1);
});

test("request and verify reject unknown, blank, and data-bearing identifiers without reflecting them", () => {
  const store = createMockCustomerVehicleStore();
  const preview = previewClear(store);
  for (const input of [
    { clientMutationId: "" },
    { clientMutationId: "data:text/plain,request-private" },
    { clientMutationId: "request-extra", extra: true },
  ]) {
    const error = caught(() => store.requestOnboardingOtp(superadmin, preview.onboardingToken, input as never));
    expect(error.status).toBe(400);
    expect(String(error)).not.toContain("private");
  }
  const challenge = store.requestOnboardingOtp(superadmin, preview.onboardingToken, {
    clientMutationId: "request-valid-after-invalid",
  });
  for (const input of [
    { otpChallengeId: "", code: "123456", clientMutationId: "verify-blank" },
    { otpChallengeId: "data:text/plain,challenge-private", code: "123456", clientMutationId: "verify-data" },
    { otpChallengeId: challenge.otpChallengeId, code: "", clientMutationId: "verify-code-blank" },
    { otpChallengeId: challenge.otpChallengeId, code: "123456", clientMutationId: "verify-extra", extra: true },
  ]) {
    const error = caught(() => store.verifyOnboardingOtp(superadmin, preview.onboardingToken, input as never));
    expect(error.status).toBe(400);
    expect(String(error)).not.toContain("private");
  }
  expect(store.closeOnboarding(superadmin, "")).toEqual({ closed: true });
  expect(store.closeOnboarding(superadmin, "data:text/plain,close-private")).toEqual({ closed: true });
});

test("missing and cross-actor tokens have identical request and verify failures", () => {
  const store = createMockCustomerVehicleStore();
  const preview = previewClear(store);
  const challenge = store.requestOnboardingOtp(superadmin, preview.onboardingToken, {
    clientMutationId: "owner-request",
  });
  const requestForeign = caught(() => store.requestOnboardingOtp(frontdeskAdmin, preview.onboardingToken, {
    clientMutationId: "foreign-request",
  }));
  const requestMissing = caught(() => store.requestOnboardingOtp(frontdeskAdmin, "onboarding-missing-safe", {
    clientMutationId: "missing-request",
  }));
  expect([requestForeign.code, requestForeign.status, requestForeign.message])
    .toEqual([requestMissing.code, requestMissing.status, requestMissing.message]);

  const verifyInput = { otpChallengeId: challenge.otpChallengeId, code: "123456", clientMutationId: "foreign-verify" };
  const verifyForeign = caught(() => store.verifyOnboardingOtp(frontdeskAdmin, preview.onboardingToken, verifyInput));
  const verifyMissing = caught(() => store.verifyOnboardingOtp(frontdeskAdmin, "onboarding-missing-safe", verifyInput));
  expect([verifyForeign.code, verifyForeign.status, verifyForeign.message])
    .toEqual([verifyMissing.code, verifyMissing.status, verifyMissing.message]);
});

test("bearer close is idempotent and destroys owned temporary KYC state without actor or session access", () => {
  const store = createMockCustomerVehicleStore();
  const createSessionWithEvidence = (id: string) => {
    const preview = store.previewOnboardingPhone(superadmin, {
      customerType: "individual",
      primaryPhone: null,
      clientMutationId: `${id}-phone`,
    });
    if (preview.status !== "clear") throw new Error("expected clear onboarding session");
    store.submitOnboardingKyc(superadmin, preview.onboardingToken, {
      frontAsset: preparedLicense(`${id}-temporary-license`),
      profile: {
        name: "Temporary Private Profile",
        birthDate: "1990-04-05",
        sex: "M",
        address: "Temporary Private Address",
      },
      clientMutationId: `${id}-kyc-submit`,
    });
    return preview.onboardingToken;
  };
  const assertUnavailableLikeMissing = (token: string, id: string) => {
    const closed = caught(() => store.requestOnboardingOtp(superadmin, token, {
      clientMutationId: `${id}-closed-request`,
    }));
    const missing = caught(() => store.requestOnboardingOtp(superadmin, "onboarding-missing-safe", {
      clientMutationId: `${id}-missing-request`,
    }));
    expect([closed.code, closed.status, closed.message])
      .toEqual([missing.code, missing.status, missing.message]);
  };

  const foreignClosed = createSessionWithEvidence("foreign-bearer-close");
  expect(store.closeOnboarding(frontdeskAdmin, foreignClosed)).toEqual({ closed: true });
  assertUnavailableLikeMissing(foreignClosed, "foreign-bearer-close");

  const anonymousClosed = createSessionWithEvidence("anonymous-bearer-close");
  expect(store.closeOnboarding(undefined, anonymousClosed)).toEqual({ closed: true });
  assertUnavailableLikeMissing(anonymousClosed, "anonymous-bearer-close");

  const malformedClosed = createSessionWithEvidence("malformed-bearer-close");
  expect(store.closeOnboarding({ actorId: "data:text/plain,private", role: "superadmin" }, malformedClosed))
    .toEqual({ closed: true });
  assertUnavailableLikeMissing(malformedClosed, "malformed-bearer-close");

  expect(store.closeOnboarding(undefined, foreignClosed)).toEqual({ closed: true });
  expect(store.closeOnboarding(undefined, "onboarding-missing-safe")).toEqual({ closed: true });
});

test("session expiry uses elapsed time with an inclusive 30-minute boundary", () => {
  let nowMs = 1_000;
  const boundaryStore = createMockCustomerVehicleStore({
    clock: () => "2026-08-13T12:00:00.000Z",
    onboardingNowMs: () => nowMs,
  });
  const boundary = previewClear(boundaryStore);
  expect(boundary.expiresAt).toBe("2026-08-13T12:30:00.000Z");
  nowMs += 30 * 60 * 1_000;
  expect(boundaryStore.requestOnboardingOtp(superadmin, boundary.onboardingToken, {
    clientMutationId: "request-at-boundary",
  })).toMatchObject({ requestedAt: "2026-08-13T12:00:00.000Z" });

  nowMs = 1_000;
  const expiredStore = createMockCustomerVehicleStore({ onboardingNowMs: () => nowMs });
  const expired = previewClear(expiredStore);
  nowMs += 30 * 60 * 1_000 + 1;
  const expiredError = caught(() => expiredStore.requestOnboardingOtp(superadmin, expired.onboardingToken, {
    clientMutationId: "request-after-expiry",
  }));
  const missingError = caught(() => expiredStore.requestOnboardingOtp(superadmin, "onboarding-missing-safe", {
    clientMutationId: "request-missing-for-expiry",
  }));
  expect([expiredError.code, expiredError.status, expiredError.message])
    .toEqual([missingError.code, missingError.status, missingError.message]);
});

test("phone preview, OTP, and close never write storage or change the persisted envelope or audit view", () => {
  const storage = {
    raw: null as string | null,
    writeCount: 0,
    getItem() { return this.raw; },
    setItem(_key: string, value: string) { this.writeCount += 1; this.raw = value; },
  };
  const store = createMockCustomerVehicleStore({ storage, clock: () => "2026-08-13T12:00:00.000Z" });
  store.grantCustomerCredit(superadmin, "CUST-UAT-001", "Onboarding raw baseline", null, "Test operator");
  const beforeWorkspace = store.workspace(superadmin);
  const beforeAudits = store.audits(superadmin);
  const beforeRaw = storage.raw;
  expect(beforeRaw).not.toBeNull();
  storage.writeCount = 0;
  const preview = previewClear(store);
  const challenge = store.requestOnboardingOtp(superadmin, preview.onboardingToken, {
    clientMutationId: "no-write-request",
  });
  store.verifyOnboardingOtp(superadmin, preview.onboardingToken, {
    otpChallengeId: challenge.otpChallengeId,
    code: "123456",
    clientMutationId: "no-write-verify",
  });
  store.closeOnboarding(superadmin, preview.onboardingToken);

  expect(storage.writeCount).toBe(0);
  expect(storage.raw).toBe(beforeRaw);
  expect(store.workspace(superadmin)).toEqual(beforeWorkspace);
  expect(store.audits(superadmin)).toEqual(beforeAudits);
  expect(store.workspace(superadmin).sourceRevision).toBe(beforeWorkspace.sourceRevision);
});

test("KYC is optional and independent from OTP, accepts both customer types, and never persists before create", () => {
  const storage = memoryStorage();
  const times = [
    "2026-08-13T12:00:00.000Z",
    "2026-08-13T12:01:00.000Z",
    "2026-08-13T12:02:00.000Z",
    "2026-08-13T12:03:00.000Z",
    "2026-08-13T12:04:00.000Z",
  ];
  let tick = 0;
  const store = createMockCustomerVehicleStore({
    storage,
    clock: () => times[Math.min(tick++, times.length - 1)]!,
  });
  const phonePreview = previewClear(store, superadmin, clearPhone, "kyc-stage-phone");
  const profile = {
    name: "  陈志远  ",
    birthDate: "1990-04-05",
    sex: "M" as const,
    address: "  12 Hope Road, Kingston  ",
  };
  const optionalStore = createMockCustomerVehicleStore();
  const optionalPhone = previewClear(optionalStore, superadmin, otherClearPhone, "kyc-before-otp-phone");
  expect(optionalStore.submitOnboardingKyc(superadmin, optionalPhone.onboardingToken, {
    frontAsset: preparedLicense("kyc-before-otp-license"), profile, clientMutationId: "kyc-before-otp",
  })).toMatchObject({ kycDraftId: expect.any(String) });
  const challenge = store.requestOnboardingOtp(superadmin, phonePreview.onboardingToken, {
    clientMutationId: "kyc-stage-otp-request",
  });
  store.verifyOnboardingOtp(superadmin, phonePreview.onboardingToken, {
    otpChallengeId: challenge.otpChallengeId,
    code: "123456",
    clientMutationId: "kyc-stage-otp-verify",
  });

  const malformed = [
    { frontAsset: { ...preparedLicense(), createdAt: "2000-01-01T00:00:00.000Z" }, profile, clientMutationId: "kyc-extra-asset-time" },
    { frontAsset: preparedLicense("data:image/png;base64,PRIVATE_ID"), profile, clientMutationId: "kyc-data-id" },
    { frontAsset: preparedLicense(), profile: { ...profile, rawText: "PRIVATE OCR" }, clientMutationId: "kyc-raw-text" },
    { frontAsset: preparedLicense(), profile: { ...profile, confidence: 0.99 }, clientMutationId: "kyc-confidence" },
    { frontAsset: preparedLicense(), profile: { ...profile, trn: "PRIVATE TRN" }, clientMutationId: "kyc-trn" },
    { frontAsset: preparedLicense(), profile: { ...profile, licenseNumber: "PRIVATE LICENCE" }, clientMutationId: "kyc-license-number" },
    { frontAsset: preparedLicense(), profile, clientMutationId: "kyc-extra-top", rawText: "PRIVATE OCR" },
  ];
  for (const input of malformed) {
    const error = caught(() => store.submitOnboardingKyc(superadmin, phonePreview.onboardingToken, input as never));
    expect(error.status).toBe(400);
    expect(String(error)).not.toMatch(/PRIVATE/);
  }

  const submission = store.submitOnboardingKyc(superadmin, phonePreview.onboardingToken, {
    frontAsset: preparedLicense(),
    profile,
    clientMutationId: "kyc-valid-submit",
  });
  expect(Reflect.ownKeys(submission).sort()).toEqual(["kycDraftId", "submittedAt"]);
  expect(submission.submittedAt).toBe("2026-08-13T12:03:00.000Z");
  for (const input of [
    { kycDraftId: submission.kycDraftId, attested: false, clientMutationId: "kyc-false-attestation" },
    { kycDraftId: submission.kycDraftId, attested: "true", clientMutationId: "kyc-string-attestation" },
    { kycDraftId: submission.kycDraftId, clientMutationId: "kyc-missing-attestation" },
    { kycDraftId: "kyc-other-safe", attested: true, clientMutationId: "kyc-wrong-draft" },
  ]) {
    expect(() => store.verifyOnboardingKyc(superadmin, phonePreview.onboardingToken, input as never)).toThrow();
  }
  const confirmation = store.verifyOnboardingKyc(superadmin, phonePreview.onboardingToken, {
    kycDraftId: submission.kycDraftId,
    attested: true,
    clientMutationId: "kyc-valid-verification",
  });
  expect(confirmation).toEqual({
    kycDraftId: submission.kycDraftId,
    profile: { name: "陈志远", birthDate: "1990-04-05", sex: "M", address: "12 Hope Road, Kingston" },
    verifiedAt: "2026-08-13T12:04:00.000Z",
  });
  const snapshot = JSON.stringify(confirmation);
  (confirmation.profile as { address: string }).address = "caller mutation";
  expect(JSON.stringify(store.verifyOnboardingKyc(superadmin, phonePreview.onboardingToken, {
    kycDraftId: submission.kycDraftId,
    attested: true,
    clientMutationId: "kyc-valid-verification",
  }))).toBe(snapshot);
  expect(storage.writeCount).toBe(0);
  expect(storage.raw).toBeNull();

  const organization = verifiedOnboarding(store, {
    access: frontdeskAdmin,
    customerType: "organization",
    phone: "+18760000003",
    id: "organization-no-kyc",
  });
  expect(store.submitOnboardingKyc(frontdeskAdmin, organization.token, {
    frontAsset: preparedLicense("organization-license"), profile, clientMutationId: "organization-kyc-submit",
  })).toMatchObject({ kycDraftId: expect.any(String) });
});

test("KYC clear preserves phone and OTP, invalidates KYC previews, and never writes persistent state", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage, clock: () => "2026-08-13T12:00:00.000Z" });
  store.grantCustomerCredit(superadmin, "CUST-UAT-001", "KYC clear persistence baseline", null, "Test operator");
  const onboarding = confirmedIndividualOnboarding(store, {
    id: "kyc-clear",
    asset: preparedLicense("kyc-clear-license"),
  });
  const oldPreview = previewConfirmedIndividual(store, onboarding.token, clearPhone, "kyc-clear-old-preview");
  const beforeWorkspace = store.workspace(superadmin);
  const beforeAudits = store.audits(superadmin);
  const beforeRaw = storage.raw;
  storage.writeCount = 0;

  const cleared = store.clearOnboardingKyc(superadmin, onboarding.token, {
    clientMutationId: "kyc-clear-1",
  });

  expect(cleared).toEqual({ cleared: true });
  expect(Reflect.ownKeys(cleared)).toEqual(["cleared"]);
  expect(storage.writeCount).toBe(0);
  expect(storage.raw).toBe(beforeRaw);
  expect(store.workspace(superadmin)).toEqual(beforeWorkspace);
  expect(store.audits(superadmin)).toEqual(beforeAudits);
  expect(() => store.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: oldPreview.previewToken,
    clientMutationId: "kyc-clear-old-create",
  })).toThrow();

  const superseded = caught(() => store.submitOnboardingKyc(superadmin, onboarding.token, {
    frontAsset: onboarding.asset,
    profile: onboarding.profile,
    clientMutationId: "kyc-clear-kyc-submit",
  }));
  expect(superseded).toMatchObject({
    code: "CUSTOMER_ONBOARDING_KYC_SUPERSEDED",
    status: 409,
  });

  expect(store.clearOnboardingKyc(superadmin, onboarding.token, {
    clientMutationId: "kyc-clear-empty",
  })).toEqual({ cleared: true });
  const ready = previewConfirmedIndividual(store, onboarding.token, clearPhone, "kyc-clear-new-preview");
  expect(ready.reminders).toContainEqual({
    kind: "kyc",
    subjectType: "customer",
    status: "evidence_missing",
  });
  expect(ready.reminders.some((reminder) => reminder.kind === "otp")).toBe(false);
});

test("KYC clear is actor-bound, exact-body idempotent, and recovers a post-receipt response loss", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({
    storage,
    faults: { failNext: { customerOnboardingKycClearResponse: "KYC clear response lost" } },
  });
  const onboarding = confirmedIndividualOnboarding(store, {
    id: "kyc-clear-response-loss",
    asset: preparedLicense("kyc-clear-response-loss-license"),
  });
  const input = { clientMutationId: "kyc-clear-response-loss-1" };
  const beforeRaw = storage.raw;
  storage.writeCount = 0;

  expect(() => store.clearOnboardingKyc(denied, onboarding.token, null as never)).toThrow(/^403 /);
  const foreignError = caught(() => store.clearOnboardingKyc(frontdeskAdmin, onboarding.token, input));
  const missingError = caught(() => store.clearOnboardingKyc(frontdeskAdmin, "onboarding-missing-safe", input));
  expect([foreignError.code, foreignError.status, foreignError.message])
    .toEqual([missingError.code, missingError.status, missingError.message]);
  for (const invalid of [
    null,
    {},
    { clientMutationId: "" },
    { clientMutationId: "data:text/plain,private" },
    { clientMutationId: "kyc-clear-extra", extra: true },
  ]) {
    const error = caught(() => store.clearOnboardingKyc(superadmin, onboarding.token, invalid as never));
    expect(error.status).toBe(400);
    expect(String(error)).not.toContain("private");
  }

  expect(() => store.clearOnboardingKyc(superadmin, onboarding.token, input))
    .toThrow("KYC clear response lost");
  expect(store.clearOnboardingKyc(superadmin, onboarding.token, input)).toEqual({ cleared: true });
  expect(store.clearOnboardingKyc(superadmin, onboarding.token, input)).toEqual({ cleared: true });
  expect(storage.writeCount).toBe(0);
  expect(storage.raw).toBe(beforeRaw);
});

for (const operation of ["submit", "verify"] as const) {
  test(`KYC ${operation} response fault fires after the receipt and same-ID retry recovers it`, () => {
    const fault = operation === "submit"
      ? "customerOnboardingKycSubmitResponse"
      : "customerOnboardingKycVerifyResponse";
    const message = `KYC ${operation} response lost`;
    const store = createMockCustomerVehicleStore({
      faults: { failNext: { [fault]: message } as never },
    });
    const onboarding = verifiedOnboarding(store, { id: `kyc-${operation}-response-loss` });
    const profile = {
      name: "陈志远",
      birthDate: "1990-04-05",
      sex: "M" as const,
      address: "12 Hope Road, Kingston",
    };
    const submitInput = {
      frontAsset: preparedLicense(`kyc-${operation}-response-loss-license`),
      profile,
      clientMutationId: `kyc-${operation}-response-loss-submit`,
    };

    if (operation === "submit") {
      expect(() => store.submitOnboardingKyc(superadmin, onboarding.token, submitInput)).toThrow(message);
      const recovered = store.submitOnboardingKyc(superadmin, onboarding.token, submitInput);
      expect(store.submitOnboardingKyc(superadmin, onboarding.token, submitInput)).toEqual(recovered);
      return;
    }

    const submission = store.submitOnboardingKyc(superadmin, onboarding.token, submitInput);
    const verifyInput = {
      kycDraftId: submission.kycDraftId,
      attested: true as const,
      clientMutationId: "kyc-verify-response-loss-verify",
    };
    expect(() => store.verifyOnboardingKyc(superadmin, onboarding.token, verifyInput)).toThrow(message);
    const recovered = store.verifyOnboardingKyc(superadmin, onboarding.token, verifyInput);
    expect(store.verifyOnboardingKyc(superadmin, onboarding.token, verifyInput)).toEqual(recovered);
  });
}

test("a new KYC submission invalidates the old attestation, name token, and final preview", () => {
  const store = createMockCustomerVehicleStore();
  const onboarding = confirmedIndividualOnboarding(store, { id: "kyc-resubmit" });
  const oldDraft = individualDraft(store);
  const oldPreview = readyPreview(store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: oldDraft,
    clientMutationId: "kyc-resubmit-old-preview",
  }));
  const replacementProfile = {
    name: "陈志原",
    birthDate: "1990-04-05",
    sex: "M" as const,
    address: "12 Hope Road, Kingston",
  };
  const replacement = store.submitOnboardingKyc(superadmin, onboarding.token, {
    frontAsset: preparedLicense("onboarding-license-front-002"),
    profile: replacementProfile,
    clientMutationId: "kyc-resubmit-new-draft",
  });
  expect(replacement.kycDraftId).not.toBe(onboarding.submitted.kycDraftId);
  expect(() => store.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: oldPreview.previewToken,
    clientMutationId: "kyc-resubmit-old-create",
  })).toThrow();
  const pendingPreview = readyPreview(store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: individualDraft(store, clearPhone, { nameSourceValue: replacementProfile.name }),
    clientMutationId: "kyc-resubmit-before-new-attestation",
  }));
  expect(pendingPreview.reminders).toContainEqual({
    kind: "kyc",
    subjectType: "customer",
    status: "pending_verification",
  });
  store.verifyOnboardingKyc(superadmin, onboarding.token, {
    kycDraftId: replacement.kycDraftId,
    attested: true,
    clientMutationId: "kyc-resubmit-new-verification",
  });
  expect(() => store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: {
      ...oldDraft,
      nameSourceValue: replacementProfile.name,
      birthDate: replacementProfile.birthDate,
      gender: "男",
      address: replacementProfile.address,
    },
    clientMutationId: "kyc-resubmit-old-name-token",
  })).toThrow(/姓名确认/);
  expect(readyPreview(store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: individualDraft(store, clearPhone, { nameSourceValue: replacementProfile.name }),
    clientMutationId: "kyc-resubmit-new-preview",
  })).input.nameSourceValue).toBe("陈志原");
});

test("final preview binds OTP phone, confirmed KYC snapshot, mapped sex, actor-owned name token, and exact request shapes", () => {
  const otpOnlyStore = createMockCustomerVehicleStore();
  const otpOnly = verifiedOnboarding(otpOnlyStore, { id: "final-preview-needs-kyc" });
  const otpOnlyPreview = readyPreview(otpOnlyStore.previewOnboardingCustomer(superadmin, otpOnly.token, {
    customer: individualDraft(otpOnlyStore), clientMutationId: "final-preview-without-kyc",
  }));
  expect(otpOnlyPreview.reminders).toContainEqual({
    kind: "kyc",
    subjectType: "customer",
    status: "evidence_missing",
  });

  const store = createMockCustomerVehicleStore();
  const onboarding = confirmedIndividualOnboarding(store, { id: "final-preview-binding" });
  const foreignName = store.previewCustomerName(frontdeskAdmin, "陈志远");
  expect(() => store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: {
      ...individualDraft(store),
      nameTransliterationToken: foreignName.confirmationToken,
    },
    clientMutationId: "final-preview-foreign-name",
  })).toThrow(/姓名确认/);

  expect(() => store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: individualDraft(store, clearPhone, { primaryPhone: otherClearPhone }),
    clientMutationId: "final-preview-mismatch-phone",
  })).toThrow(/手机号/);
  const mismatches: Array<{ id: string; override: Partial<CustomerDraftInput> }> = [
    { id: "name", override: { nameSourceValue: "陈志原" } },
    { id: "birth", override: { birthDate: "1990-04-06" } },
    { id: "gender-unmapped", override: { gender: "M" } },
    { id: "gender-opposite", override: { gender: "女" } },
    { id: "address", override: { address: "14 Hope Road, Kingston" } },
  ];
  for (const { id, override } of mismatches) {
    const mismatch = readyPreview(store.previewOnboardingCustomer(superadmin, onboarding.token, {
      customer: individualDraft(store, clearPhone, override),
      clientMutationId: `final-preview-mismatch-${id}`,
    }));
    expect(mismatch.reminders).toContainEqual({ kind: "kyc_profile_mismatch", subjectType: "customer" });
  }
  for (const input of [
    { customer: individualDraft(store), clientMutationId: "final-preview-extra", rawText: "PRIVATE" },
    { customer: { ...individualDraft(store), rawText: "PRIVATE" }, clientMutationId: "final-preview-customer-extra" },
  ]) {
    const error = caught(() => store.previewOnboardingCustomer(superadmin, onboarding.token, input as never));
    expect(error.status).toBe(400);
    expect(String(error)).not.toContain("PRIVATE");
  }
  const preview = previewConfirmedIndividual(store, onboarding.token, clearPhone, "final-preview-valid");
  expect(preview.input).toMatchObject({
    primaryPhone: clearPhone,
    nameSourceValue: "陈志远",
    birthDate: "1990-04-05",
    gender: "男",
    address: "12 Hope Road, Kingston",
  });
  expect(Reflect.ownKeys(preview).sort()).toEqual([
    "candidates", "input", "previewToken", "reminders", "sourceRevision", "status",
  ]);
});

test("organization onboarding skips KYC but still creates from verified OTP and a confirmed contact name in one write", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage, clock: () => "2026-08-13T13:00:00.000Z" });
  const onboarding = verifiedOnboarding(store, {
    customerType: "organization",
    phone: "+18760000003",
    id: "organization-create",
  });
  const name = store.previewCustomerName(superadmin, "顾明轩");
  const preview = readyPreview(store.previewOnboardingCustomer(superadmin, onboarding.token, {
    customer: {
      customerType: "organization",
      organizationName: "Harbour Test Fleet Ltd",
      nameSourceValue: "顾明轩",
      nameTransliterationToken: name.confirmationToken,
      primaryContactRole: "Fleet manager",
      primaryPhone: "+18760000003",
    },
    clientMutationId: "organization-final-preview",
  }));
  const created = store.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: preview.previewToken,
    clientMutationId: "organization-create-commit",
  });
  expect(created).toMatchObject({
    customerType: "organization",
    organizationName: "Harbour Test Fleet Ltd",
    phone: "+18760000003",
    revision: 1,
  });
  expect(created.verificationArchive.otpRecords).toHaveLength(1);
  expect(created.verificationArchive.kycRecords).toEqual([]);
  expect(store.audits(superadmin).filter((event) => "customerId" in event && event.customerId === created.id)
    .map((event) => event.eventType)).toEqual(["otp_requested", "otp_verified", "customer_created"]);
  const createdAudit = store.customerAuditHistory(superadmin, created.id)
    .find((event) => event.eventType === "customer_created");
  expect(createdAudit?.changes.map((change) => change.field)).not.toEqual(expect.arrayContaining([
    "duplicateCandidateCustomerIds",
    "duplicateCandidateReasons",
  ]));
  expect(storage.writeCount).toBe(1);
});

test("individual create commits one strict-v3 snapshot with actor/time-bound OTP, KYC, compact audits, and receipt", () => {
  const storage = memoryStorage();
  const times = [
    "2026-08-13T14:00:00.000Z",
    "2026-08-13T14:01:00.000Z",
    "2026-08-13T14:02:00.000Z",
    "2026-08-13T14:03:00.000Z",
    "2026-08-13T14:04:00.000Z",
    "2026-08-13T14:05:00.000Z",
    "2026-08-13T14:06:00.000Z",
  ];
  let tick = 0;
  const store = createMockCustomerVehicleStore({
    storage,
    clock: () => times[Math.min(tick++, times.length - 1)]!,
    customerId: () => "CUST-ONBOARDING-ATOMIC-001",
  });
  const onboarding = confirmedIndividualOnboarding(store, { id: "atomic-create" });
  const preview = previewConfirmedIndividual(store, onboarding.token, clearPhone, "atomic-create-preview");
  const created = store.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
    clientMutationId: "atomic-create-commit",
  });
  expect(created.revision).toBe(1);
  expect(created.createdAt).toBe(times[6]);
  expect(created.updatedAt).toBe(times[6]);
  expect(created.verificationArchive.otpRecords).toEqual([{
    id: "OTP-CUST-ONBOARDING-ATOMIC-001-001",
    phoneE164: clearPhone,
    requestedAt: times[1],
    verifiedAt: times[2],
    verifiedBy: superadmin.actorId,
  }]);
  expect(created.verificationArchive.kycRecords).toEqual([{
    id: "KYC-CUST-ONBOARDING-ATOMIC-001-001",
    documentType: "drivers_license",
    frontAsset: {
      ...onboarding.asset,
      createdAt: times[3],
      createdBy: superadmin.actorId,
    },
    submittedAt: times[3],
    verifiedAt: times[4],
    verifiedBy: superadmin.actorId,
  }]);
  const customerAudits = store.audits(superadmin)
    .filter((event) => "customerId" in event && event.customerId === created.id);
  expect(customerAudits.map((event) => event.eventType)).toEqual([
    "otp_requested", "otp_verified", "kyc_submitted", "kyc_verified", "customer_created",
  ]);
  expect(customerAudits.map((event) => event.occurredAt)).toEqual([times[1], times[2], times[3], times[4], times[6]]);
  expect(customerAudits.every((event) => event.actorId === superadmin.actorId)).toBe(true);
  expect(customerAudits.map((event) => "customerId" in event ? event.evidenceAssetIds : [])).toEqual([
    [], [], [onboarding.asset.id], [onboarding.asset.id], [],
  ]);
  expect(storage.writeCount).toBe(1);
  const envelope = JSON.parse(storage.raw!);
  expect(envelope.schemaVersion).toBe(3);
  expect(Reflect.ownKeys(envelope).sort()).toEqual(["schemaVersion", "state"]);
  expect(Reflect.ownKeys(envelope.state).sort()).toEqual([
    "auditEvents", "customers", "mutationReceipts", "relationships", "sourceRevision", "vehicles",
  ]);
  expect(envelope.state.sourceRevision).toBe(2);
  expect(envelope.state.mutationReceipts).toContainEqual({
    actorId: superadmin.actorId,
    clientMutationId: "atomic-create-commit",
    operation: "customer.create",
    resultEntityId: created.id,
    resultRevision: 1,
    createdAt: times[6],
  });
  expect(isCustomerEnvelopeV3(envelope)).toBe(true);
  expect(storage.raw).not.toContain(onboarding.token);
  expect(storage.raw).not.toContain(onboarding.submitted.kycDraftId);
  expect(storage.raw).not.toMatch(/rawText|confidence/);
  (created as { address: string | null }).address = "caller mutation";
  expect(store.customer(superadmin, created.id).address).toBe("12 Hope Road, Kingston");
});

test("all nine incoming/stored phone combinations are a hard gate that duplicate confirmation cannot override", () => {
  const incomingFields = ["primaryPhone", "secondaryPhone", "whatsapp"] as const;
  const storedFields = ["primaryPhone", "secondaryPhone", "whatsapp"] as const;
  let sequence = 0;
  for (const incomingField of incomingFields) {
    for (const storedField of storedFields) {
      const matchPhone = `+18760000${String(100 + sequence)}`;
      const sessionPhone = incomingField === "primaryPhone"
        ? matchPhone
        : `+18760001${String(100 + sequence)}`;
      const store = createMockCustomerVehicleStore();
      const onboarding = confirmedIndividualOnboarding(store, {
        phone: sessionPhone,
        id: `phone-cross-${sequence}`,
        asset: preparedLicense(`phone-cross-evidence-${sequence}`),
      });
      updateStoredPhone(store, storedField, matchPhone);
      const override = incomingField === "primaryPhone"
        ? {}
        : { [incomingField]: matchPhone };
      const runPreview = () => store.previewOnboardingCustomer(superadmin, onboarding.token, {
        customer: individualDraft(store, sessionPhone, override),
        clientMutationId: `phone-cross-preview-${sequence}`,
      });
      if (incomingField === "primaryPhone") {
        expect(caught(runPreview), `${incomingField} -> ${storedField}`).toMatchObject({
          code: "CUSTOMER_PHONE_DUPLICATE",
          status: 409,
        });
        sequence += 1;
        continue;
      }
      const result = runPreview();
      const expectedStoredField = storedField === "primaryPhone" ? "phone" : storedField;
      expect(result, `${incomingField} -> ${storedField}`).toMatchObject({
        status: "phone_conflict",
      });
      expect(result.status === "phone_conflict" && result.matches).toContainEqual(
        expect.objectContaining({ incomingField, existingField: expectedStoredField, phoneE164: matchPhone }),
      );
      expect(result).not.toHaveProperty("previewToken");
      sequence += 1;
    }
  }
});

test("create rechecks newly claimed phones and allows non-phone duplicate warnings without confirmation", () => {
  const raceStore = createMockCustomerVehicleStore();
  const race = confirmedIndividualOnboarding(raceStore, { id: "source-race" });
  const racePreview = previewConfirmedIndividual(raceStore, race.token, clearPhone, "source-race-preview");
  const claimant = raceStore.customer(superadmin, "CUST-UAT-003");
  const claimantPreview = raceStore.previewCustomerUpdate(superadmin, claimant.id, {
    customerType: claimant.customerType,
    nameSourceValue: claimant.nameSourceValue,
    primaryPhone: clearPhone,
    expectedRevision: claimant.revision,
  });
  raceStore.updateCustomer(superadmin, claimant.id, {
    ...claimantPreview.input,
    expectedRevision: claimant.revision,
    previewToken: claimantPreview.previewToken,
    confirmPossibleDuplicate: claimantPreview.candidates.length > 0 ? true : undefined,
  });
  expect(caught(() => raceStore.createOnboardingCustomer(superadmin, race.token, {
    previewToken: racePreview.previewToken,
    confirmPossibleDuplicate: true,
    clientMutationId: "source-race-create",
  }))).toMatchObject({ code: "CUSTOMER_PHONE_DUPLICATE", status: 409 });

  const evidenceStore = createMockCustomerVehicleStore();
  const collidingAsset = preparedLicense("globally-colliding-evidence");
  evidenceStore.submitCustomerKyc(superadmin, "CUST-UAT-003", {
    frontAsset: collidingAsset,
    clientMutationId: "seed-global-evidence-collision",
  } as never);
  const evidenceOnboarding = confirmedIndividualOnboarding(evidenceStore, {
    id: "evidence-collision",
    asset: collidingAsset,
  });
  const evidencePreview = previewConfirmedIndividual(
    evidenceStore, evidenceOnboarding.token, clearPhone, "evidence-collision-preview",
  );
  expect(caught(() => evidenceStore.createOnboardingCustomer(superadmin, evidenceOnboarding.token, {
    previewToken: evidencePreview.previewToken,
    confirmPossibleDuplicate: true,
    clientMutationId: "evidence-collision-create",
  }))).toMatchObject({ code: "EVIDENCE_ASSET_INVALID", status: 409 });

  const duplicateStorage = memoryStorage();
  const duplicateStore = createMockCustomerVehicleStore({ storage: duplicateStorage });
  const duplicate = confirmedIndividualOnboarding(duplicateStore, {
    id: "non-phone-duplicate",
    profile: {
      name: "Alicia Bennett",
      birthDate: "1990-04-05",
      sex: "F",
      address: "12 Hope Road, Kingston",
    },
  });
  const duplicateName = duplicateStore.previewCustomerName(superadmin, "Alicia Bennett");
  const duplicatePreview = readyPreview(duplicateStore.previewOnboardingCustomer(superadmin, duplicate.token, {
    customer: {
      customerType: "individual",
      nameSourceValue: "Alicia Bennett",
      nameTransliterationToken: duplicateName.confirmationToken,
      primaryPhone: clearPhone,
      email: "alicia.bennett@synthetic.example",
      birthDate: "1990-04-05",
      gender: "女",
      address: "12 Hope Road, Kingston",
    },
    clientMutationId: "non-phone-duplicate-preview",
  }));
  expect(duplicatePreview.candidates.length).toBeGreaterThan(0);
  expect(duplicatePreview.candidates.flatMap((candidate) => candidate.reasons))
    .not.toEqual(expect.arrayContaining(["phone", "whatsapp"]));
  const duplicateCreated = duplicateStore.createOnboardingCustomer(superadmin, duplicate.token, {
    previewToken: duplicatePreview.previewToken,
    clientMutationId: "non-phone-duplicate-create",
  });
  expect(duplicateCreated.revision).toBe(1);
  expect(duplicateStorage.raw).not.toBeNull();
  expect(isCustomerEnvelopeV3(JSON.parse(duplicateStorage.raw!))).toBe(true);
  const duplicateReloaded = createMockCustomerVehicleStore({ storage: duplicateStorage });
  const duplicateAudit = duplicateReloaded.customerAuditHistory(superadmin, duplicateCreated.id)
    .find((event) => event.eventType === "customer_created");
  expect(duplicateAudit?.changes).toEqual(expect.arrayContaining([
    {
      field: "duplicateCandidateCustomerIds",
      before: null,
      after: [...new Set(duplicatePreview.candidates.map((candidate) => candidate.customerId))].sort().join(","),
    },
    {
      field: "duplicateCandidateReasons",
      before: null,
      after: [...new Set(duplicatePreview.candidates.flatMap((candidate) => candidate.reasons))].sort().join(","),
    },
  ]));
});

test("write failure keeps raw, state, audits, receipt count, revisions, and transient identifiers retryable", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage, customerId: () => "CUST-ONBOARDING-RETRY-001" });
  const onboarding = confirmedIndividualOnboarding(store, { id: "write-failure" });
  const preview = previewConfirmedIndividual(store, onboarding.token, clearPhone, "write-failure-preview");
  const input = {
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
    clientMutationId: "write-failure-create",
  };
  const beforeWorkspace = store.workspace(superadmin);
  const beforeAudits = store.audits(superadmin);
  const beforeRaw = storage.raw;
  storage.failWrites = true;
  expect(() => store.createOnboardingCustomer(superadmin, onboarding.token, input)).toThrow("onboarding write failed");
  expect(storage.raw).toBe(beforeRaw);
  expect(store.workspace(superadmin)).toEqual(beforeWorkspace);
  expect(store.audits(superadmin)).toEqual(beforeAudits);
  expect(store.workspace(superadmin).customers).toHaveLength(beforeWorkspace.customers.length);
  storage.failWrites = false;
  const recovered = store.createOnboardingCustomer(superadmin, onboarding.token, input);
  expect(recovered).toMatchObject({ id: "CUST-ONBOARDING-RETRY-001", revision: 1 });
  expect(recovered.verificationArchive.otpRecords).toHaveLength(1);
  expect(recovered.verificationArchive.kycRecords).toHaveLength(1);
  expect(storage.writeCount).toBe(1);
});

test("cross-store onboarding persist conflict returns the stable source-revision 409 and remains re-previewable", () => {
  const storage = memoryStorage();
  const onboardingStore = createMockCustomerVehicleStore({ storage });
  const onboarding = confirmedIndividualOnboarding(onboardingStore, {
    id: "cross-store-source-conflict",
    asset: preparedLicense("cross-store-source-conflict-license"),
  });
  const stalePreview = previewConfirmedIndividual(
    onboardingStore,
    onboarding.token,
    clearPhone,
    "cross-store-source-conflict-preview",
  );
  const competingStore = createMockCustomerVehicleStore({ storage });
  competingStore.grantCustomerCredit(
    superadmin,
    "CUST-UAT-003",
    "Competing store revision",
    null,
    "Test operator",
  );
  const rawAfterCompetingWrite = storage.raw;

  const conflict = caught(() => onboardingStore.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: stalePreview.previewToken,
    clientMutationId: "cross-store-source-conflict-create",
  }));
  expect(conflict).toMatchObject({
    code: "CUSTOMER_ONBOARDING_SOURCE_REVISION_CONFLICT",
    status: 409,
  });
  expect(storage.raw).toBe(rawAfterCompetingWrite);

  const freshPreview = previewConfirmedIndividual(
    onboardingStore,
    onboarding.token,
    clearPhone,
    "cross-store-source-conflict-preview-retry",
  );
  expect(onboardingStore.createOnboardingCustomer(superadmin, onboarding.token, {
    previewToken: freshPreview.previewToken,
    clientMutationId: "cross-store-source-conflict-create-retry",
  })).toMatchObject({ phone: clearPhone, revision: 1 });
});

test("post-commit response loss consumes the session, then persisted create idempotency returns the current edited customer without another write", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({
    storage,
    customerId: () => "CUST-ONBOARDING-LOST-001",
    faults: { failNext: { customerOnboardingCreateResponse: "customer response lost" } },
  });
  const onboarding = confirmedIndividualOnboarding(store, { id: "lost-response" });
  const preview = previewConfirmedIndividual(store, onboarding.token, clearPhone, "lost-response-preview");
  const input = {
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
    clientMutationId: "lost-response-create",
  };
  expect(() => store.createOnboardingCustomer(superadmin, onboarding.token, input)).toThrow("customer response lost");
  expect(storage.writeCount).toBe(1);
  const rawAfterCommit = storage.raw;
  const afterCommit = store.workspace(superadmin);
  expect(afterCommit.customers.filter((customer) => customer.id === "CUST-ONBOARDING-LOST-001")).toHaveLength(1);

  const recovered = store.createOnboardingCustomer(superadmin, onboarding.token, input);
  expect(recovered).toMatchObject({ id: "CUST-ONBOARDING-LOST-001", revision: 1 });
  expect(storage.raw).toBe(rawAfterCommit);
  expect(storage.writeCount).toBe(1);

  const editPreview = store.previewCustomerUpdate(superadmin, recovered.id, {
    customerType: recovered.customerType,
    nameSourceValue: recovered.nameSourceValue,
    primaryPhone: recovered.phone,
    email: "edited-after-create@example.test",
    expectedRevision: recovered.revision,
  });
  const edited = store.updateCustomer(superadmin, recovered.id, {
    ...editPreview.input,
    expectedRevision: recovered.revision,
    previewToken: editPreview.previewToken,
    confirmPossibleDuplicate: editPreview.candidates.length > 0 ? true : undefined,
  });
  expect(edited.revision).toBe(2);
  const writesAfterEdit = storage.writeCount;
  const rawAfterEdit = storage.raw;
  const afterEditRetry = store.createOnboardingCustomer(superadmin, onboarding.token, input);
  expect(afterEditRetry).toMatchObject({
    id: recovered.id,
    revision: 2,
    email: "edited-after-create@example.test",
  });
  expect(storage.writeCount).toBe(writesAfterEdit);
  expect(storage.raw).toBe(rawAfterEdit);
  expect(store.workspace(superadmin).customers.filter((customer) => customer.id === recovered.id)).toHaveLength(1);
});
