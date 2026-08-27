import { expect, test } from "@playwright/test";
import { ApiError, api } from "../../src/lib/api/client";
import type {
  ClearOnboardingKycInput,
  CreateOnboardingCustomerInput,
  OnboardingCustomerPreview,
  OnboardingCustomerPreviewResult,
  PreviewOnboardingCustomerInput,
  RequestOnboardingOtpInput,
  SubmitOnboardingKycInput,
  VerifyOnboardingKycInput,
  VerifyOnboardingOtpInput,
} from "../../src/lib/customers/onboarding-types";
import type {
  InvalidateCustomerOtpInput,
  RequestCustomerOtpInput,
  CustomerDraftInput,
  SaveVehicleInput,
  SignCustomerAgreementInput,
  SubmitCustomerKycInput,
  UpdateCustomerInput,
  UpdateVehicleInput,
  VehicleDraftInput,
  VerifyCustomerKycInput,
  VerifyCustomerOtpInput,
} from "../../src/lib/customers/types";
import { SEED_EVIDENCE_ASSETS } from "../../src/lib/customers/seed-evidence";

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function installBrowser(session: unknown = null, scenario?: unknown, linkedScenario?: unknown): () => void {
  const values = new Map<string, string>();
  if (session !== null) values.set("wh_session", typeof session === "string" ? session : JSON.stringify(session));
  const storage: MemoryStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      __WH_CUSTOMERS_TEST_SCENARIO__: scenario,
      __WH_LINKED_OPERATIONS_TEST_SCENARIO__: linkedScenario,
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

const superadmin = { identity: { id: "emp-001", role: "superadmin" } };
const frontdesk = { identity: { id: "emp-003", role: "frontdesk_admin" } };
const parts = { identity: { id: "emp-004", role: "parts" } };

type AgreementSigningPreviewApi = typeof api.customers & {
  prepareAgreementSigning(
    customerId: string,
    input: { readonly version: string; readonly signedBy: string },
  ): Promise<{ readonly token: string; readonly signedAt: string }>;
};

const agreementSigningApi = api.customers as AgreementSigningPreviewApi;

async function caughtApiError(operation: Promise<unknown>): Promise<ApiError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected API error");
}

const onboardingLicense = {
  id: "api-onboarding-license-front",
  fileName: "api-onboarding-license-front.png",
  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
  mimeType: "image/png" as const,
  sizeBytes: 70,
};

function readyPreview(result: OnboardingCustomerPreviewResult): OnboardingCustomerPreview {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected ready onboarding preview");
  return result;
}

async function prepareIndividualOnboarding({
  name,
  primaryPhone,
  email,
  id,
}: {
  name: string;
  primaryPhone: string;
  email?: string;
  id: string;
}) {
  const phone = await api.customers.onboarding.previewPhone({
    customerType: "individual",
    primaryPhone,
    clientMutationId: `${id}-phone`,
  });
  if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
  const challenge = await api.customers.onboarding.requestOtp(phone.onboardingToken, {
    clientMutationId: `${id}-otp-request`,
  });
  await api.customers.onboarding.verifyOtp(phone.onboardingToken, {
    otpChallengeId: challenge.otpChallengeId,
    code: "123456",
    clientMutationId: `${id}-otp-verify`,
  });
  const profile = { name, birthDate: "1990-04-05", sex: "M" as const, address: "12 Hope Road" };
  const submission = await api.customers.onboarding.submitKyc(phone.onboardingToken, {
    frontAsset: onboardingLicense,
    profile,
    clientMutationId: `${id}-kyc-submit`,
  });
  await api.customers.onboarding.verifyKyc(phone.onboardingToken, {
    kycDraftId: submission.kycDraftId,
    attested: true,
    clientMutationId: `${id}-kyc-verify`,
  });
  const namePreview = await api.customers.previewName(name);
  const preview = readyPreview(await api.customers.onboarding.preview(phone.onboardingToken, {
    customer: {
      customerType: "individual",
      nameSourceValue: name,
      nameTransliterationToken: namePreview.confirmationToken,
      primaryPhone,
      email: email ?? null,
      birthDate: profile.birthDate,
      gender: "男",
      address: profile.address,
    },
    clientMutationId: `${id}-preview`,
  }));
  return { token: phone.onboardingToken, preview };
}

const dangerousOnboardingTokens = [
  ".",
  "..",
  "a/b",
  "%2e",
  "%252e",
  "\uD800",
  "\uDC00",
] as const;

function onboardingTokenCalls(token: string, malformedBody = false) {
  return [
    {
      name: "requestOtp",
      call: () => api.customers.onboarding.requestOtp(token, malformedBody
        ? null as unknown as RequestOnboardingOtpInput
        : { clientMutationId: "opaque-request" }),
    },
    {
      name: "verifyOtp",
      call: () => api.customers.onboarding.verifyOtp(token, malformedBody
        ? null as unknown as VerifyOnboardingOtpInput
        : { otpChallengeId: "opaque-challenge", code: "123456", clientMutationId: "opaque-verify" }),
    },
    {
      name: "submitKyc",
      call: () => api.customers.onboarding.submitKyc(token, malformedBody
        ? null as unknown as SubmitOnboardingKycInput
        : {
            frontAsset: onboardingLicense,
            profile: { name: "陈志远", birthDate: "1990-04-05", sex: "M", address: "12 Hope Road" },
            clientMutationId: "opaque-kyc-submit",
          }),
    },
    {
      name: "verifyKyc",
      call: () => api.customers.onboarding.verifyKyc(token, malformedBody
        ? null as unknown as VerifyOnboardingKycInput
        : { kycDraftId: "opaque-kyc", attested: true, clientMutationId: "opaque-kyc-verify" }),
    },
    {
      name: "clearKyc",
      call: () => api.customers.onboarding.clearKyc(token, malformedBody
        ? null as unknown as ClearOnboardingKycInput
        : { clientMutationId: "opaque-kyc-clear" }),
    },
    {
      name: "preview",
      call: () => api.customers.onboarding.preview(token, malformedBody
        ? null as unknown as PreviewOnboardingCustomerInput
        : {
            customer: { customerType: "individual", nameSourceValue: "陈志远" },
            clientMutationId: "opaque-preview",
          }),
    },
    {
      name: "create",
      call: () => api.customers.onboarding.create(token, malformedBody
        ? null as unknown as CreateOnboardingCustomerInput
        : { previewToken: "opaque-preview-token", clientMutationId: "opaque-create" }),
    },
    { name: "close", call: () => api.customers.onboarding.close(token) },
  ];
}

type RawMockClientModule = typeof import("../../src/lib/api/client") & {
  __rawMockRequest<T>(path: string, options?: RequestInit): Promise<T>;
};

function loadClientWithRawMockRequest(): RawMockClientModule {
  const fs = require("node:fs") as typeof import("node:fs");
  const NodeModule = require("node:module") as typeof import("node:module");
  const typescript = require("typescript") as typeof import("typescript");
  const modulePath = require.resolve("../../src/lib/api/client");
  const source = `${fs.readFileSync(modulePath, "utf8")}\nexport { mockRequest as __rawMockRequest };\n`;
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  }).outputText;
  const loaded = new NodeModule.Module(modulePath, module);
  loaded.filename = modulePath;
  loaded.paths = module.paths;
  (loaded as typeof loaded & { _compile(content: string, filename: string): void })
    ._compile(compiled, modulePath);
  return loaded.exports as RawMockClientModule;
}

test("onboarding typed API exposes all eight POST routes and idempotent DELETE without leaking transient evidence", async () => {
  test.setTimeout(20_000);
  const restore = installBrowser(superadmin);
  try {
    const blank = await api.customers.onboarding.previewPhone({
      customerType: "organization",
      primaryPhone: "   ",
      clientMutationId: "api-onboarding-blank-phone",
    });
    expect(blank).toMatchObject({ status: "clear", phoneE164: null });
    expect(blank.status === "clear" && blank.onboardingToken).toBeTruthy();

    const duplicate = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0101",
      clientMutationId: "api-onboarding-duplicate-phone",
    });
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate).not.toHaveProperty("onboardingToken");
    expect(JSON.stringify(duplicate)).not.toMatch(/data\s*:|rawText|confidence|frontAsset|evidence|url/i);

    const phone = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0199",
      clientMutationId: "api-onboarding-phone",
    });
    expect(phone.status).toBe("clear");
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    expect(Reflect.ownKeys(phone).sort()).toEqual([
      "expiresAt", "matches", "onboardingToken", "phoneE164", "sourceRevision", "status",
    ]);

    const challenge = await api.customers.onboarding.requestOtp(phone.onboardingToken, {
      clientMutationId: "api-onboarding-otp-request",
    });
    expect(Reflect.ownKeys(challenge).sort()).toEqual(["otpChallengeId", "phoneE164", "requestedAt"]);
    const verification = await api.customers.onboarding.verifyOtp(phone.onboardingToken, {
      otpChallengeId: challenge.otpChallengeId,
      code: "123456",
      clientMutationId: "api-onboarding-otp-verify",
    });
    expect(Reflect.ownKeys(verification).sort()).toEqual(["otpChallengeId", "phoneE164", "verifiedAt"]);
    for (const response of [phone, challenge, verification]) {
      expect(JSON.stringify(response)).not.toMatch(/data\s*:|rawText|confidence|frontAsset|evidence|url/i);
    }

    const submitted = await api.customers.onboarding.submitKyc(phone.onboardingToken, {
      frontAsset: onboardingLicense,
      profile: {
        name: "陈志远",
        birthDate: "1990-04-05",
        sex: "M",
        address: "12 Hope Road, Kingston",
      },
      clientMutationId: "api-onboarding-kyc-submit",
    });
    expect(Reflect.ownKeys(submitted).sort()).toEqual(["kycDraftId", "submittedAt"]);
    const confirmed = await api.customers.onboarding.verifyKyc(phone.onboardingToken, {
      kycDraftId: submitted.kycDraftId,
      attested: true,
      clientMutationId: "api-onboarding-kyc-verify",
    });
    expect(Reflect.ownKeys(confirmed).sort()).toEqual(["kycDraftId", "profile", "verifiedAt"]);

    const name = await api.customers.previewName("陈志远");
    const preview = readyPreview(await api.customers.onboarding.preview(phone.onboardingToken, {
      customer: {
        customerType: "individual",
        nameSourceValue: "陈志远",
        nameTransliterationToken: name.confirmationToken,
        primaryPhone: phone.phoneE164,
        birthDate: "1990-04-05",
        gender: "男",
        address: "12 Hope Road, Kingston",
      },
      clientMutationId: "api-onboarding-customer-preview",
    }));
    const created = await api.customers.onboarding.create(phone.onboardingToken, {
      previewToken: preview.previewToken,
      confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
      clientMutationId: "api-onboarding-customer-create",
    });
    expect(created).toMatchObject({ phone: phone.phoneE164, revision: 1 });
    await expect(api.customers.onboarding.close(phone.onboardingToken)).resolves.toEqual({ closed: true });
    await expect(api.customers.onboarding.close(phone.onboardingToken)).resolves.toEqual({ closed: true });
  } finally {
    restore();
  }
});

test("typed KYC clear keeps the onboarding token and OTP while recovering the same response-loss receipt", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin, {
    failNext: { customerOnboardingKycClearResponse: "typed KYC clear response lost" },
  });
  try {
    const phone = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0189",
      clientMutationId: "api-kyc-clear-phone",
    });
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    const challenge = await api.customers.onboarding.requestOtp(phone.onboardingToken, {
      clientMutationId: "api-kyc-clear-otp-request",
    });
    await api.customers.onboarding.verifyOtp(phone.onboardingToken, {
      otpChallengeId: challenge.otpChallengeId,
      code: "123456",
      clientMutationId: "api-kyc-clear-otp-verify",
    });
    await api.customers.onboarding.submitKyc(phone.onboardingToken, {
      frontAsset: { ...onboardingLicense, id: "api-kyc-clear-license" },
      profile: {
        name: "陈志远",
        birthDate: "1990-04-05",
        sex: "M",
        address: "12 Hope Road, Kingston",
      },
      clientMutationId: "api-kyc-clear-submit",
    });
    const clearInput = { clientMutationId: "api-kyc-clear-1" };

    await expect(api.customers.onboarding.clearKyc(phone.onboardingToken, clearInput))
      .rejects.toThrow("typed KYC clear response lost");
    await expect(api.customers.onboarding.clearKyc(phone.onboardingToken, clearInput))
      .resolves.toEqual({ cleared: true });
    await expect(api.customers.onboarding.clearKyc(phone.onboardingToken, clearInput))
      .resolves.toEqual({ cleared: true });

    const name = await api.customers.previewName("陈志远");
    const preview = readyPreview(await api.customers.onboarding.preview(phone.onboardingToken, {
      customer: {
        customerType: "individual",
        nameSourceValue: "陈志远",
        nameTransliterationToken: name.confirmationToken,
        primaryPhone: phone.phoneE164,
      },
      clientMutationId: "api-kyc-clear-preview",
    }));
    expect(preview.reminders).toContainEqual({
      kind: "kyc",
      subjectType: "customer",
      status: "evidence_missing",
    });
    expect(preview.reminders.some((reminder) => reminder.kind === "otp")).toBe(false);
  } finally {
    restore();
  }
});

test("typed onboarding OTP request and verify recover post-receipt response loss with the same IDs", async () => {
  const restore = installBrowser(superadmin, {
    failNext: {
      customerOnboardingOtpRequestResponse: "typed OTP request response lost",
      customerOnboardingOtpVerifyResponse: "typed OTP verify response lost",
    },
  });
  try {
    const phone = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0188",
      clientMutationId: "api-otp-response-loss-phone",
    });
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    const requestInput = { clientMutationId: "api-otp-response-loss-request" };
    await expect(api.customers.onboarding.requestOtp(phone.onboardingToken, requestInput))
      .rejects.toThrow("typed OTP request response lost");
    const challenge = await api.customers.onboarding.requestOtp(phone.onboardingToken, requestInput);
    await expect(api.customers.onboarding.requestOtp(phone.onboardingToken, requestInput))
      .resolves.toEqual(challenge);

    const verifyInput = {
      otpChallengeId: challenge.otpChallengeId,
      code: "123456",
      clientMutationId: "api-otp-response-loss-verify",
    };
    await expect(api.customers.onboarding.verifyOtp(phone.onboardingToken, verifyInput))
      .rejects.toThrow("typed OTP verify response lost");
    const verification = await api.customers.onboarding.verifyOtp(phone.onboardingToken, verifyInput);
    await expect(api.customers.onboarding.verifyOtp(phone.onboardingToken, verifyInput))
      .resolves.toEqual(verification);
  } finally {
    restore();
  }
});

test("onboarding typed API returns safe final phone ownership conflicts without a preview token", async () => {
  const restore = installBrowser(superadmin);
  try {
    const phone = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 000 0041",
      clientMutationId: "api-final-phone-conflict-session",
    });
    expect(phone.status).toBe("clear");
    if (phone.status !== "clear") throw new Error("expected clear onboarding session");
    const name = await api.customers.previewName("Alicia Bennett");
    const result = await api.customers.onboarding.preview(phone.onboardingToken, {
      customer: {
        customerType: "individual",
        nameSourceValue: "Alicia Bennett",
        nameTransliterationToken: name.confirmationToken,
        primaryPhone: "+1 876 000 0041",
        secondaryPhone: "+1 876 555 0101",
      },
      clientMutationId: "api-final-phone-conflict-preview",
    });

    expect(result).toMatchObject({ status: "phone_conflict", sourceRevision: 1 });
    expect(result.status === "phone_conflict" && result.matches).toContainEqual(expect.objectContaining({
        customerId: "CUST-UAT-001",
        customerDisplayName: expect.stringContaining("Alicia Bennett"),
        incomingField: "secondaryPhone",
        existingField: "phone",
        phoneE164: "+18765550101",
      }));
    expect(result).not.toHaveProperty("previewToken");
  } finally {
    restore();
  }
});

test("legacy customer POST is cut off with onboarding required and performs zero writes", async () => {
  const restore = installBrowser(superadmin);
  try {
    const client = loadClientWithRawMockRequest();
    const before = await api.customers.workspace();
    let error: { status?: number; code?: string } | null = null;
    try {
      await client.__rawMockRequest("/api/customers", {
        method: "POST",
        body: JSON.stringify({ customerType: "individual", nameSourceValue: "Legacy bypass" }),
      });
    } catch (caught) {
      error = caught as { status?: number; code?: string };
    }
    expect(error).toMatchObject({ status: 400, code: "CUSTOMER_ONBOARDING_REQUIRED" });
    const after = await api.customers.workspace();
    expect(after.customers).toEqual(before.customers);
    expect("create" in api.customers).toBe(false);
  } finally {
    restore();
  }
});

test("onboarding API enforces exact own-key bodies and safely decodes token paths", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    const phone = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0198",
      clientMutationId: "api-onboarding-shape-phone",
    });
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    const token = phone.onboardingToken;
    const badCalls: Array<() => Promise<unknown>> = [
      () => api.customers.onboarding.previewPhone({
        customerType: "individual", primaryPhone: "+1 876 555 0197",
        clientMutationId: "api-onboarding-extra-phone", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.requestOtp(token, {
        clientMutationId: "api-onboarding-extra-request", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.verifyOtp(token, {
        otpChallengeId: "api-onboarding-unused-challenge", code: "123456",
        clientMutationId: "api-onboarding-extra-verify", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.submitKyc(token, {
        frontAsset: onboardingLicense,
        profile: { name: "陈志远", birthDate: "1990-04-05", sex: "M", address: "12 Hope Road" },
        clientMutationId: "api-onboarding-extra-kyc-submit", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.verifyKyc(token, {
        kycDraftId: "api-onboarding-unused-kyc", attested: true,
        clientMutationId: "api-onboarding-extra-kyc-verify", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.clearKyc(token, {
        clientMutationId: "api-onboarding-extra-kyc-clear", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.preview(token, {
        customer: { customerType: "individual", nameSourceValue: "陈志远" },
        clientMutationId: "api-onboarding-extra-preview", extra: "PRIVATE_API_EXTRA",
      } as never),
      () => api.customers.onboarding.create(token, {
        previewToken: "api-onboarding-unused-preview",
        clientMutationId: "api-onboarding-extra-create", extra: "PRIVATE_API_EXTRA",
      } as never),
    ];
    for (const call of badCalls) {
      const error = await caughtApiError(call());
      expect(error).toMatchObject({ status: 400, code: "CUSTOMER_ONBOARDING_INPUT_INVALID" });
      expect(String(error)).not.toContain("PRIVATE_API_EXTRA");
    }
    await expect(api.customers.onboarding.previewPhone(null as never)).rejects.toMatchObject({
      status: 400,
      code: "CUSTOMER_ONBOARDING_INPUT_INVALID",
    });
    const unsafe = await caughtApiError(api.customers.onboarding.requestOtp(
      "data:text/plain,PRIVATE_TOKEN",
      { clientMutationId: "api-onboarding-unsafe-token" },
    ));
    expect(unsafe).toMatchObject({ status: 400, code: "CUSTOMER_ONBOARDING_TOKEN_INVALID" });
    expect(String(unsafe)).not.toContain("PRIVATE_TOKEN");
  } finally {
    restore();
  }
});

test("non-close onboarding routes authorize before delay and malformed body parsing", async () => {
  test.setTimeout(5_000);
  const malformedCalls = () => [
    () => api.customers.onboarding.previewPhone(null as never),
    () => api.customers.onboarding.requestOtp("data:text/plain,private", null as unknown as RequestOnboardingOtpInput),
    () => api.customers.onboarding.verifyOtp("data:text/plain,private", null as unknown as VerifyOnboardingOtpInput),
    () => api.customers.onboarding.submitKyc("data:text/plain,private", null as unknown as SubmitOnboardingKycInput),
    () => api.customers.onboarding.verifyKyc("data:text/plain,private", null as unknown as VerifyOnboardingKycInput),
    () => api.customers.onboarding.clearKyc("data:text/plain,private", null as unknown as ClearOnboardingKycInput),
    () => api.customers.onboarding.preview("data:text/plain,private", null as unknown as PreviewOnboardingCustomerInput),
    () => api.customers.onboarding.create("data:text/plain,private", null as unknown as CreateOnboardingCustomerInput),
  ];
  for (const [session, status] of [[parts, 403], ["{not valid JSON", 401]] as const) {
    const restore = installBrowser(session);
    const startedAt = Date.now();
    try {
      for (const call of malformedCalls()) await expect(call()).rejects.toMatchObject({ status });
      expect(Date.now() - startedAt).toBeLessThan(250);
    } finally {
      restore();
    }
  }
});

test("onboarding request dispatch binds the original actor before a session switch", async () => {
  const restore = installBrowser(superadmin);
  try {
    const pending = api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0196",
      clientMutationId: "api-onboarding-dispatch-actor",
    });
    const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
    browser.localStorage.setItem("wh_session", JSON.stringify(frontdesk));
    const phone = await pending;
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    await expect(api.customers.onboarding.requestOtp(phone.onboardingToken, {
      clientMutationId: "api-onboarding-foreign-after-switch",
    })).rejects.toMatchObject({ status: 404, code: "CUSTOMER_ONBOARDING_SESSION_UNAVAILABLE" });
    browser.localStorage.setItem("wh_session", JSON.stringify(superadmin));
    await expect(api.customers.onboarding.requestOtp(phone.onboardingToken, {
      clientMutationId: "api-onboarding-owner-after-switch",
    })).resolves.toMatchObject({ phoneE164: "+18765550196" });
  } finally {
    restore();
  }
});

test("typed bearer close destroys an old actor token before auth or simulated delay", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
    for (const [index, closingSession] of [
      JSON.stringify(frontdesk),
      "",
      "{not valid JSON",
    ].entries()) {
      browser.localStorage.setItem("wh_session", JSON.stringify(superadmin));
      const phone = await api.customers.onboarding.previewPhone({
        customerType: "individual",
        primaryPhone: null,
        clientMutationId: `bearer-close-${index}-phone`,
      });
      if (phone.status !== "clear") throw new Error("expected clear onboarding session");
      await api.customers.onboarding.submitKyc(phone.onboardingToken, {
        frontAsset: { ...onboardingLicense, id: `bearer-close-${index}-temporary-license` },
        profile: {
          name: "Temporary Private Profile",
          birthDate: "1990-04-05",
          sex: "M",
          address: "Temporary Private Address",
        },
        clientMutationId: `bearer-close-${index}-kyc-submit`,
      });

      browser.localStorage.setItem("wh_session", closingSession);
      const startedAt = Date.now();
      await expect(api.customers.onboarding.close(phone.onboardingToken))
        .resolves.toEqual({ closed: true });
      expect(Date.now() - startedAt).toBeLessThan(250);

      browser.localStorage.setItem("wh_session", JSON.stringify(superadmin));
      const closedError = await caughtApiError(api.customers.onboarding.requestOtp(phone.onboardingToken, {
        clientMutationId: `bearer-close-${index}-closed-request`,
      }));
      const missingError = await caughtApiError(api.customers.onboarding.requestOtp("onboarding-missing-safe", {
        clientMutationId: `bearer-close-${index}-missing-request`,
      }));
      expect([closedError.status, closedError.code, closedError.message])
        .toEqual([missingError.status, missingError.code, missingError.message]);
    }

    for (const token of [null, undefined, 0, false, {}, [], "", "data:text/plain,private"] as const) {
      browser.localStorage.setItem("wh_session", "{not valid JSON");
      await expect(api.customers.onboarding.close(token as never)).resolves.toEqual({ closed: true });
    }
  } finally {
    restore();
  }
});

test("a late bearer close for token A cannot close replacement token B or block its OTP request", async () => {
  const restore = installBrowser(superadmin);
  try {
    const tokenAResult = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0158",
      clientMutationId: "late-close-token-a-phone",
    });
    if (tokenAResult.status !== "clear") throw new Error("expected clear token A");
    const tokenBResult = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0157",
      clientMutationId: "late-close-token-b-phone",
    });
    if (tokenBResult.status !== "clear") throw new Error("expected clear token B");

    await expect(api.customers.onboarding.close(tokenAResult.onboardingToken))
      .resolves.toEqual({ closed: true });
    await expect(api.customers.onboarding.requestOtp(tokenBResult.onboardingToken, {
      clientMutationId: "late-close-token-b-otp-request",
    })).resolves.toMatchObject({ phoneE164: "+18765550157" });
  } finally {
    restore();
  }
});

test("all onboarding token routes hide missing and foreign token existence", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    const phone = await api.customers.onboarding.previewPhone({
      customerType: "individual",
      primaryPhone: "+1 876 555 0195",
      clientMutationId: "api-onboarding-existence-phone",
    });
    if (phone.status !== "clear") throw new Error("expected clear onboarding phone");
    const foreignToken = phone.onboardingToken;
    const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
    browser.localStorage.setItem("wh_session", JSON.stringify(frontdesk));
    const missingToken = "onboarding-missing-safe";
    const calls = (token: string) => [
      () => api.customers.onboarding.requestOtp(token, { clientMutationId: "existence-request" }),
      () => api.customers.onboarding.verifyOtp(token, {
        otpChallengeId: "existence-challenge", code: "123456", clientMutationId: "existence-verify",
      }),
      () => api.customers.onboarding.submitKyc(token, {
        frontAsset: onboardingLicense,
        profile: { name: "陈志远", birthDate: "1990-04-05", sex: "M", address: "12 Hope Road" },
        clientMutationId: "existence-kyc-submit",
      }),
      () => api.customers.onboarding.verifyKyc(token, {
        kycDraftId: "existence-kyc", attested: true, clientMutationId: "existence-kyc-verify",
      }),
      () => api.customers.onboarding.clearKyc(token, { clientMutationId: "existence-kyc-clear" }),
      () => api.customers.onboarding.preview(token, {
        customer: { customerType: "individual", nameSourceValue: "陈志远" },
        clientMutationId: "existence-preview",
      }),
      () => api.customers.onboarding.create(token, {
        previewToken: "existence-preview-token", clientMutationId: "existence-create",
      }),
    ];
    const foreignErrors = [];
    const missingErrors = [];
    for (const call of calls(foreignToken)) foreignErrors.push(await caughtApiError(call()));
    for (const call of calls(missingToken)) missingErrors.push(await caughtApiError(call()));
    expect(foreignErrors.map(({ status, code, message }) => [status, code, message]))
      .toEqual(missingErrors.map(({ status, code, message }) => [status, code, message]));
    await expect(api.customers.onboarding.close(foreignToken)).resolves.toEqual({ closed: true });
    await expect(api.customers.onboarding.close(missingToken)).resolves.toEqual({ closed: true });
  } finally {
    restore();
  }
});

test("every typed onboarding token route keeps dot, slash, percent, and lone-surrogate tokens opaque", async () => {
  test.setTimeout(45_000);
  const restore = installBrowser(superadmin);
  try {
    for (const token of dangerousOnboardingTokens) {
      for (const operation of onboardingTokenCalls(token)) {
        if (operation.name === "close") {
          await expect(operation.call(), `${operation.name} ${JSON.stringify(token)}`)
            .resolves.toEqual({ closed: true });
          continue;
        }
        const error = await caughtApiError(operation.call());
        expect(error, `${operation.name} ${JSON.stringify(token)}`).toMatchObject({
          status: 404,
          code: "CUSTOMER_ONBOARDING_SESSION_UNAVAILABLE",
        });
        expect(error.code).not.toMatch(/^(CUSTOMER_NOT_FOUND|CUSTOMER_VERIFICATION_INPUT_INVALID)$/);
      }
    }
  } finally {
    restore();
  }
});

test("dangerous typed tokens still authorize before delay, malformed body, or path detail", async () => {
  test.setTimeout(5_000);
  for (const [session, status] of [[parts, 403], ["{not valid JSON", 401]] as const) {
    const restore = installBrowser(session);
    const startedAt = Date.now();
    try {
      for (const token of dangerousOnboardingTokens) {
        for (const operation of onboardingTokenCalls(token, true)) {
          if (operation.name === "close") {
            await expect(operation.call(), `${operation.name} ${JSON.stringify(token)}`)
              .resolves.toEqual({ closed: true });
            continue;
          }
          await expect(operation.call(), `${operation.name} ${JSON.stringify(token)}`)
            .rejects.toMatchObject({ status });
        }
      }
      expect(Date.now() - startedAt).toBeLessThan(250);
    } finally {
      restore();
    }
  }
});

test("a runtime non-string token cannot throw before onboarding authorization", async () => {
  const restoreDenied = installBrowser(parts);
  try {
    await expect(api.customers.onboarding.requestOtp(
      null as never,
      null as unknown as RequestOnboardingOtpInput,
    )).rejects.toMatchObject({ status: 403 });
  } finally {
    restoreDenied();
  }

  const restoreAuthorized = installBrowser(superadmin);
  try {
    await expect(api.customers.onboarding.requestOtp(
      null as never,
      { clientMutationId: "opaque-runtime-null" },
    )).rejects.toMatchObject({ status: 400, code: "CUSTOMER_ONBOARDING_TOKEN_INVALID" });
  } finally {
    restoreAuthorized();
  }
});

test("raw onboarding traversal candidates fail with a stable 400 before auth or URL normalization", async () => {
  test.setTimeout(5_000);
  const rawClient = loadClientWithRawMockRequest();
  const rawPaths = [
    "/api/customers/onboarding/./otp/request",
    "/api/customers/onboarding/../create",
    "/api/customers/onboarding/%2e/otp/verify",
    "/api/customers/onboarding/%2E%2E",
    "/api/customers/onboarding/a/b/kyc/submit",
    "/api/customers/onboarding\\..\\create",
    "\\api/customers/onboarding/../otp/request",
    "/api\\customers/onboarding/../otp/request",
    "/api/customers\\onboarding/../otp/request",
    "/api\\customers\\onboarding/../otp/request",
    "\\api\\customers\\onboarding\\..\\otp\\request",
    "/api/customers/onboarding/%/preview",
    "/api/customers/onboarding/\uD800/create",
  ];

  for (const session of [parts, "{not valid JSON"] as const) {
    const restore = installBrowser(session);
    const startedAt = Date.now();
    try {
      for (const path of rawPaths) {
        await expect(rawClient.__rawMockRequest(path, { method: "POST", body: "null" }))
          .rejects.toMatchObject({ status: 400, code: "CUSTOMER_ONBOARDING_TOKEN_INVALID" });
      }
      expect(Date.now() - startedAt).toBeLessThan(250);
    } finally {
      restore();
    }
  }

  const restore = installBrowser(superadmin);
  try {
    for (const path of rawPaths) {
      let error: InstanceType<typeof rawClient.ApiError>;
      try {
        await rawClient.__rawMockRequest(path, { method: "POST", body: "null" });
        throw new Error("raw onboarding traversal unexpectedly succeeded");
      } catch (caught) {
        expect(caught).toBeInstanceOf(rawClient.ApiError);
        error = caught as InstanceType<typeof rawClient.ApiError>;
      }
      expect(error).toMatchObject({ status: 400, code: "CUSTOMER_ONBOARDING_TOKEN_INVALID" });
      expect(rawPaths.every((candidate) => !error.message.includes(candidate))).toBe(true);
    }
  } finally {
    restore();
  }
});

test("onboarding typed client preserves real-fetch status and code without adding internal session data", async () => {
  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    delete require.cache[modulePath];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/customers/onboarding/phone-preview");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        customerType: "individual",
        primaryPhone: "+1 876 555 0194",
        clientMutationId: "api-onboarding-real-fetch",
      });
      return new Response(JSON.stringify({
        error: "建档手机号冲突",
        code: "CUSTOMER_ONBOARDING_PHONE_DUPLICATE",
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    let error: InstanceType<typeof realClient.ApiError>;
    try {
      await realClient.api.customers.onboarding.previewPhone({
        customerType: "individual",
        primaryPhone: "+1 876 555 0194",
        clientMutationId: "api-onboarding-real-fetch",
      });
      throw new Error("real-fetch onboarding unexpectedly succeeded");
    } catch (caught) {
      expect(caught).toBeInstanceOf(realClient.ApiError);
      error = caught as InstanceType<typeof realClient.ApiError>;
    }
    expect(error).toMatchObject({
      status: 409,
      code: "CUSTOMER_ONBOARDING_PHONE_DUPLICATE",
      message: "建档手机号冲突",
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUseMock === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_USE_MOCK");
    else process.env.NEXT_PUBLIC_USE_MOCK = previousUseMock;
    delete require.cache[modulePath];
  }
});

test("name transliteration preview API returns a coded canonical confirmation and rejects unsupported English", async () => {
  const restore = installBrowser(superadmin);
  try {
    await expect(api.customers.previewName("  alicia BENNETT ")).resolves.toMatchObject({
      sourceScript: "en",
      sourceValue: "Alicia Bennett",
      nameZh: "艾丽西亚·贝内特",
      nameEn: "Alicia Bennett",
      method: "exact_name_dictionary",
      version: "customer-name-v1",
      status: "confirmed",
    });
    try {
      await api.customers.previewName("Jason Wong");
      throw new Error("unsupported preview unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 400, code: "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED" });
    }
  } finally {
    restore();
  }
});

test("customer API preserves stable codes for discriminator and audit-text validation without echoing input", async () => {
  const restore = installBrowser(superadmin);
  try {
    const name = await api.customers.previewName("陈志远");
    await expect(api.customers.preview({
      customerType: "individual",
      nameSourceValue: "陈志远",
      nameTransliterationToken: name.confirmationToken,
      organizationName: "Hidden API Fleet",
      primaryPhone: "+18765550993",
    })).rejects.toMatchObject({ status: 400, code: "CUSTOMER_TYPE_FIELDS_INVALID" });

    try {
      await api.customers.preview({
        customerType: "individual",
        nameSourceValue: "陈志远",
        nameTransliterationToken: name.confirmationToken,
        primaryPhone: "+18765550993",
        reason: "reviewed | data : image/png;base64,API_PRIVATE",
      });
      throw new Error("sensitive audit text unexpectedly accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 400, code: "CUSTOMER_AUDIT_TEXT_INVALID" });
      expect(String(error)).not.toContain("API_PRIVATE");
    }
  } finally {
    restore();
  }
});

async function expectStatus(operation: Promise<unknown>, status: number, message: RegExp): Promise<void> {
  try {
    await operation;
    throw new Error("API unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect(error).toHaveProperty("message", expect.stringMatching(message));
    expect((error as Error).message).not.toMatch(/Alicia|0101|1HGBH41JXMN100001|风险|金额/);
  }
}

async function expectRawClientStatus(
  operation: Promise<unknown>,
  status: number,
  message: RegExp,
  code?: string,
): Promise<void> {
  try {
    await operation;
    throw new Error("API unexpectedly succeeded");
  } catch (error) {
    expect(error).toMatchObject({ status, ...(code ? { code } : {}) });
    expect(error).toHaveProperty("message", expect.stringMatching(message));
  }
}

test("客户车辆 public API 覆盖 workspace、详情、预览、新建及 PATCH 路由", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    const workspace = await api.customers.workspace();
    expect(workspace.summary).toMatchObject({ totalCustomers: 300, totalVehicles: 324 });
    await expect(api.customers.detail("CUST-UAT-001")).resolves.toMatchObject({ id: "CUST-UAT-001" });
    await expect(api.vehicles.detail("VEH-UAT-001")).resolves.toMatchObject({ id: "VEH-UAT-001" });

    const preparedCustomer = await prepareIndividualOnboarding({
      name: "陈志远",
      primaryPhone: "+18765550992",
      email: "route.customer@example.test",
      id: "route-customer",
    });
    const createdCustomer = await api.customers.onboarding.create(preparedCustomer.token, {
      previewToken: preparedCustomer.preview.previewToken,
      confirmPossibleDuplicate: preparedCustomer.preview.candidates.length > 0 ? true : undefined,
      clientMutationId: "route-customer-create",
    });
    expect(createdCustomer).toMatchObject({ nameZh: "陈志远", nameEn: "Chen Zhiyuan", revision: 1 });
    const customerUpdatePreview = await api.customers.previewUpdate(createdCustomer.id, {
      customerType: "individual", nameSourceValue: "陈志远", email: "route.customer@example.test",
      status: "inactive", expectedRevision: createdCustomer.revision,
    });
    const updatedCustomer = await api.customers.update(createdCustomer.id, {
      ...customerUpdatePreview.input,
      expectedRevision: createdCustomer.revision,
      previewToken: customerUpdatePreview.previewToken,
      confirmPossibleDuplicate: customerUpdatePreview.candidates.length > 0 ? true : undefined,
    });
    expect(updatedCustomer).toMatchObject({ id: createdCustomer.id, status: "inactive", revision: 2 });

    const vehiclePreview = await api.vehicles.preview({
      plate: "API 987", vin: "VIN-API-987", make: "Honda", model: "Fit", year: 2022,
      relationships: [{ customerId: createdCustomer.id, startedAt: "2026-08-09T00:00:00.000Z", endedAt: null }],
    });
    const createdVehicle = await api.vehicles.create({
      ...vehiclePreview.input, previewToken: vehiclePreview.previewToken,
    });
    expect(createdVehicle).toMatchObject({ plate: "API987", revision: 1 });
    const vehicleUpdatePreview = await api.vehicles.previewUpdate(createdVehicle.id, {
      plate: "API987", vin: "VIN-API-987", make: "Honda", model: "Jazz", year: 2022,
      expectedRevision: createdVehicle.revision,
    });
    const updatedVehicle = await api.vehicles.update(createdVehicle.id, {
      ...vehicleUpdatePreview.input,
      expectedRevision: createdVehicle.revision,
      previewToken: vehicleUpdatePreview.previewToken,
    });
    expect(updatedVehicle).toMatchObject({ id: createdVehicle.id, model: "Jazz", revision: 2 });
  } finally {
    restore();
  }
});

test("完整目录 API 仅向 superadmin 和 frontdesk_admin 提供读写，并对缺失或损坏会话不泄露 PII", async () => {
  const restoreFrontdesk = installBrowser(frontdesk);
  try {
    await expect(api.customers.workspace()).resolves.toMatchObject({ summary: { totalCustomers: 300 } });
    const name = await api.customers.previewName("赵明轩");
    await expect(api.customers.preview({
      customerType: "individual", nameSourceValue: "赵明轩", nameTransliterationToken: name.confirmationToken,
      primaryPhone: "+1 876 000 0042",
      email: "frontdesk.route@example.test",
    })).resolves.toMatchObject({ candidates: [] });
  } finally {
    restoreFrontdesk();
  }

  for (const session of [null, parts, "{not valid JSON", { identity: { id: "", role: "superadmin" } }]) {
    const restore = installBrowser(session);
    try {
      const expectedStatus = session === "{not valid JSON"
        || typeof session === "object" && session !== null && session !== parts ? 401 : 403;
      await expectStatus(api.customers.workspace(), expectedStatus, /无权|会话无效/);
      await expectStatus(api.vehicles.detail("VEH-UAT-001"), expectedStatus, /无权|会话无效/);
    } finally {
      restore();
    }
  }

  const restoreDenied = installBrowser(parts);
  try {
    await expectStatus(api.vehicles.preview({ make: "Honda", model: "Fit", year: 2022 }), 403, /无权/);
  } finally {
    restoreDenied();
  }
});

test("vehicle business orders API returns the vehicle's mileage history in descending creation order", async () => {
  const restore = installBrowser(superadmin);
  try {
    const rows = await api.vehicles.businessOrders("VEH-UAT-001");

    expect(rows).toHaveLength(14);
    expect(rows.every((row) => row.vehicleId === "VEH-UAT-001")).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      "order-demo-24", "order-demo-23", "order-demo-22", "order-demo-21", "order-demo-20", "order-demo-19", "order-demo-18",
      "order-demo-17", "order-demo-16", "order-demo-15", "order-demo-14", "order-demo-13", "order-demo-12", "order-demo-11",
    ]);
    expect(rows[0]).toMatchObject({
      id: "order-demo-24",
      startMileage: { status: "recorded", value: 84_200, unit: "km" },
    });
  } finally {
    restore();
  }
});

test("frontdesk_admin can read vehicle business-order mileage history", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const rows = await api.vehicles.businessOrders("VEH-UAT-001");
    expect(rows).toHaveLength(14);
    expect(rows.every((row) => row.vehicleId === "VEH-UAT-001")).toBe(true);
  } finally {
    restore();
  }
});

test("vehicle business orders API checks the customer master before linked data and refuses unauthorized sessions", async () => {
  const restore = installBrowser(superadmin);
  try {
    await expect(api.vehicles.businessOrders("VEH-UAT-002")).resolves.toEqual([]);
    await expectStatus(api.vehicles.businessOrders("VEH-NOT-FOUND"), 404, /车辆不存在/);
  } finally {
    restore();
  }

  for (const [session, status] of [[null, 403], [parts, 403], ["{not valid JSON", 401]] as const) {
    const restoreDenied = installBrowser(session);
    try {
      await expectStatus(api.vehicles.businessOrders("VEH-UAT-001"), status, /无权|会话无效/);
    } finally {
      restoreDenied();
    }
  }
});

test("vehicle business orders API keeps denied and unknown-master requests outside linked fault handling", async () => {
  const linkedFault = () => ({
    failNext: { byAction: { "vehicles.businessOrders.read": "vehicle history read fault" } },
  });

  for (const [session, vehicleId, status, message] of [
    [null, "VEH-UAT-001", 403, /无权/],
    [parts, "VEH-UAT-001", 403, /无权/],
    ["{not valid JSON", "VEH-UAT-001", 401, /会话无效/],
    [superadmin, "VEH-NOT-FOUND", 404, /车辆不存在/],
  ] as const) {
    const fault = linkedFault();
    const restoreDenied = installBrowser(session, undefined, fault);
    try {
      await expectStatus(api.vehicles.businessOrders(vehicleId), status, message);
    } finally {
      restoreDenied();
    }

    const restoreAuthorized = installBrowser(superadmin, undefined, fault);
    try {
      await expectStatus(api.vehicles.businessOrders("VEH-UAT-001"), 503, /车辆关联业务单读取失败/);
    } finally {
      restoreAuthorized();
    }
  }
});

test("frontdesk_admin 可通过客户 API 完成实际保存", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const prepared = await prepareIndividualOnboarding({
      name: "周雅雯",
      primaryPhone: "+18765550991",
      email: "frontdesk.save@example.test",
      id: "frontdesk-save",
    });
    await expect(api.customers.onboarding.create(prepared.token, {
      previewToken: prepared.preview.previewToken,
      confirmPossibleDuplicate: prepared.preview.candidates.length > 0 ? true : undefined,
      clientMutationId: "frontdesk-save-create",
    }))
      .resolves.toMatchObject({ nameZh: "周雅雯", nameEn: "Zhou Yawen" });
  } finally {
    restore();
  }
});

test("PATCH 在路由边界拒绝路径 ID 与 body ID 不一致，不让篡改内容进入 domain", async () => {
  const restore = installBrowser(superadmin);
  try {
    const customerTampered = {
      customerType: "individual", nameSourceValue: "陈志远", email: "tamper@example.test", expectedRevision: 1,
      previewToken: "forged", id: "CUST-UAT-002",
    } as UpdateCustomerInput;
    await expectStatus(api.customers.update("CUST-UAT-001", customerTampered), 400, /路径与保存内容不一致/);

    const vehicleTampered = {
      plate: "7012 AB", vin: "1HGBH41JXMN100001", make: "Honda", model: "CR-V", year: 2021,
      expectedRevision: 1, previewToken: "forged", id: "VEH-UAT-002",
    } as UpdateVehicleInput;
    await expectStatus(api.vehicles.update("VEH-UAT-001", vehicleTampered), 400, /路径与保存内容不一致/);

    await expect(api.customers.detail("CUST-UAT-001")).resolves.toMatchObject({
      id: "CUST-UAT-001", nameEn: "Alicia Bennett", nameZh: "艾丽西亚·贝内特", revision: 1,
    });
    await expect(api.vehicles.detail("VEH-UAT-001")).resolves.toMatchObject({
      id: "VEH-UAT-001", model: "CR-V", revision: 1,
    });
  } finally {
    restore();
  }
});

test("未授权 PATCH 先拒绝会话，不能被 path/body 篡改降级为 400", async () => {
  const customerTampered = {
    customerType: "individual", nameSourceValue: "陈志远", email: "unauthorized@example.test",
    expectedRevision: 1, previewToken: "forged", id: "CUST-UAT-002",
  } as UpdateCustomerInput;
  const vehicleTampered = {
    plate: "7012 AB", vin: "1HGBH41JXMN100001", make: "Honda", model: "CR-V", year: 2021,
    expectedRevision: 1, previewToken: "forged", id: "VEH-UAT-002",
  } as UpdateVehicleInput;

  for (const [session, status, message] of [
    [null, 403, /无权/],
    ["{not valid JSON", 401, /会话无效/],
    [parts, 403, /无权/],
  ] as const) {
    const restore = installBrowser(session);
    try {
      await expectStatus(api.customers.update("CUST-UAT-001", customerTampered), status, message);
      await expectStatus(api.vehicles.update("VEH-UAT-001", vehicleTampered), status, message);
    } finally {
      restore();
    }
  }
});

test("客户车辆场景支持延迟读取、一次性读取故障及同路径重试", async () => {
  const restoreDelay = installBrowser(superadmin, { delayMs: { customerVehicleRead: 320 } });
  try {
    const startedAt = Date.now();
    await api.customers.workspace();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(600);
  } finally {
    restoreDelay();
  }

  const restoreFailure = installBrowser(superadmin, {
    failNext: { customerVehicleRead: "可重试客户车辆读取故障" },
  });
  try {
    await expect(api.customers.workspace()).rejects.toThrow(/可重试客户车辆读取故障/);
    await expect(api.customers.workspace()).resolves.toMatchObject({ summary: { totalCustomers: 300 } });
  } finally {
    restoreFailure();
  }
});

test("客户车辆目录读取在响应前拒绝采用另一个已授权会话且不写状态", async () => {
  const restore = installBrowser(superadmin, { delayMs: { customerVehicleRead: 1_000 } });
  try {
    const storage = (globalThis.window as unknown as {
      localStorage: MemoryStorage;
    }).localStorage;
    const before = storage.getItem("wh_customer_vehicle_mock_v1");
    const pending = api.customers.workspace();

    // The common request delay has elapsed, while the customer workspace read
    // remains deliberately pending. A second authorized account must not adopt
    // the first account's in-flight response.
    await new Promise((resolve) => setTimeout(resolve, 650));
    storage.setItem("wh_session", JSON.stringify(frontdesk));

    await expectStatus(pending, 403, /会话已变更|重新读取/);
    expect(storage.getItem("wh_customer_vehicle_mock_v1")).toBe(before);
  } finally {
    restore();
  }
});

test("旧式 OTP、KYC 与协议一键动作不再是第二条成功路径", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.customers.detail("CUST-UAT-003");
    const actions = [
      { type: "verify_otp" as const },
      { type: "verify_kyc" as const },
      { type: "sign_agreement" as const, version: "v1.2" },
    ];

    for (const action of actions) {
      await expect(api.customers.action(before.id, action as never)).rejects.toMatchObject({ status: 400 });
    }

    await expect(api.customers.detail(before.id)).resolves.toEqual(before);
  } finally {
    restore();
  }
});

test("typed customer verification API exposes all evidence routes and preserves stable error codes", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    await expect(api.customers.requestOtp("CUST-UAT-003", {
      phoneE164: " ",
      clientMutationId: "api-otp-empty",
    })).rejects.toMatchObject({ status: 400, code: "OTP_PHONE_REQUIRED" });

    const requested = await api.customers.requestOtp("CUST-UAT-003", {
      phoneE164: "(876) 555-0140",
      clientMutationId: "api-otp-request",
    });
    const otpRecordId = requested.verificationArchive.otpRecords.at(-1)!.id;
    await expect(api.customers.verifyOtp(requested.id, {
      otpRecordId,
      code: "654321",
      clientMutationId: "api-otp-wrong",
    })).rejects.toMatchObject({ status: 400, code: "OTP_CODE_INVALID" });
    await expect(api.customers.verifyOtp(requested.id, {
      otpRecordId,
      code: "123456",
      clientMutationId: "api-otp-verify",
    })).resolves.toMatchObject({ phone: "+18765550140" });
    await expect(api.customers.invalidateOtp(requested.id, {
      otpRecordId,
      reason: "unreachable",
      clientMutationId: "api-otp-invalidate",
    })).resolves.toMatchObject({
      verificationArchive: { otpRecords: [expect.objectContaining({ invalidationReason: "unreachable" })] },
    });

    const frontAsset = {
      id: "api-kyc-front",
      fileName: "license-front.png",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
      mimeType: "image/png" as const,
      sizeBytes: 70,
      createdAt: "2026-08-13T12:00:00.000Z",
      createdBy: "emp-001",
    };
    const submitted = await api.customers.submitKyc(requested.id, {
      frontAsset,
      clientMutationId: "api-kyc-submit",
    });
    await expect(api.customers.verifyKyc(requested.id, {
      kycRecordId: submitted.verificationArchive.kycRecords.at(-1)!.id,
      clientMutationId: "api-kyc-verify",
    })).resolves.toMatchObject({
      verificationArchive: { kycRecords: [expect.objectContaining({ verifiedBy: "emp-001" })] },
    });

    await expect(api.customers.signAgreement(requested.id, {
      medium: "paper",
      version: "1.3",
      signedBy: "Marcia Reid",
      physicalRecordNumber: "PAPER-API-001",
      physicalStorageLocation: "Cabinet API-01",
      clientMutationId: "api-agreement-sign",
    })).resolves.toMatchObject({
      verificationArchive: { agreementRecords: [expect.objectContaining({ medium: "paper", version: "1.3" })] },
    });

    const audit = await api.customers.auditHistory(requested.id);
    expect(audit.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "otp_requested", "otp_verified", "otp_invalidated", "kyc_submitted", "kyc_verified", "agreement_signed",
    ]));
  } finally {
    restore();
  }
});

test("typed KYC verify retries a persisted response-loss receipt without duplicating records or audits", async () => {
  const restore = installBrowser(superadmin, {
    failNext: { customerKycVerifyResponse: "演示 KYC 核验响应丢失" },
  });
  try {
    const customerId = "CUST-UAT-003";
    const before = await api.customers.detail(customerId);
    const beforeRecordCount = before.verificationArchive.kycRecords.length;
    const beforeAudits = await api.customers.auditHistory(customerId);
    const submitted = await api.customers.submitKyc(customerId, {
      frontAsset: {
        id: "api-kyc-response-loss-front",
        fileName: "api-kyc-response-loss-front.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        sizeBytes: 70,
        createdAt: "2026-08-14T13:20:00.000Z",
        createdBy: "emp-001",
      },
      clientMutationId: "api-kyc-response-loss-submit",
    });
    const record = submitted.verificationArchive.kycRecords.at(-1)!;
    const verifyInput = {
      kycRecordId: record.id,
      clientMutationId: "api-kyc-response-loss-verify",
    };

    await expect(api.customers.verifyKyc(customerId, verifyInput))
      .rejects.toThrow("演示 KYC 核验响应丢失");
    const retried = await api.customers.verifyKyc(customerId, verifyInput);
    expect(retried.verificationArchive.kycRecords).toHaveLength(beforeRecordCount + 1);
    expect(retried.verificationArchive.kycRecords.at(-1)).toMatchObject({
      id: record.id,
      verifiedBy: "emp-001",
    });
    const audits = await api.customers.auditHistory(customerId);
    expect(audits.filter((event) => event.eventType === "kyc_submitted")).toHaveLength(
      beforeAudits.filter((event) => event.eventType === "kyc_submitted").length + 1,
    );
    expect(audits.filter((event) => event.eventType === "kyc_verified")).toHaveLength(
      beforeAudits.filter((event) => event.eventType === "kyc_verified").length + 1,
    );

    await expect(api.customers.verifyKyc(customerId, {
      kycRecordId: record.id,
      clientMutationId: "api-kyc-response-loss-different-verify",
    })).rejects.toMatchObject({ status: 409, code: "KYC_RECORD_NOT_PENDING" });
  } finally {
    restore();
  }
});

test("typed KYC submit response loss replays only unchanged canonical evidence and organization profile", async () => {
  test.setTimeout(30_000);
  const restore = installBrowser(superadmin, {
    failNext: { customerKycSubmitResponse: "演示 KYC 提交响应丢失" },
  });
  try {
    const customerId = "CUST-UAT-003";
    const before = await api.customers.detail(customerId);
    const beforeAudits = await api.customers.auditHistory(customerId);
    const submitInput = {
      frontAsset: {
        id: "api-kyc-submit-loss-front",
        fileName: "api-kyc-submit-loss-front.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
        mimeType: "image/png" as const,
        sizeBytes: 70,
        createdAt: "2026-08-14T13:25:00.000Z",
        createdBy: "emp-001",
      },
      clientMutationId: "api-kyc-submit-loss-mutation",
    };

    await expect(api.customers.submitKyc(customerId, submitInput))
      .rejects.toThrow("演示 KYC 提交响应丢失");
    const persisted = await api.customers.detail(customerId);
    const record = persisted.verificationArchive.kycRecords.at(-1)!;
    expect(persisted.verificationArchive.kycRecords).toHaveLength(
      before.verificationArchive.kycRecords.length + 1,
    );
    expect(record.frontAsset).toEqual(submitInput.frontAsset);

    const replayed = await api.customers.submitKyc(customerId, submitInput);
    expect(replayed.verificationArchive.kycRecords.at(-1)?.id).toBe(record.id);
    expect(replayed.verificationArchive.kycRecords).toHaveLength(
      before.verificationArchive.kycRecords.length + 1,
    );
    const auditsAfterReplay = await api.customers.auditHistory(customerId);
    expect(auditsAfterReplay.filter((event) => event.eventType === "kyc_submitted")).toHaveLength(
      beforeAudits.filter((event) => event.eventType === "kyc_submitted").length + 1,
    );

    await expect(api.customers.submitKyc(customerId, {
      ...submitInput,
      frontAsset: { ...submitInput.frontAsset, id: "api-kyc-submit-loss-changed-front" },
    })).rejects.toMatchObject({ status: 409, code: "CUSTOMER_IDEMPOTENCY_CONFLICT" });
    expect(await api.customers.detail(customerId)).toEqual(persisted);
    expect(await api.customers.auditHistory(customerId)).toEqual(auditsAfterReplay);

    const organizationId = "CUST-UAT-002";
    const organizationInput = {
      subjectType: "organization_primary_contact" as const,
      subjectProfile: {
        name: "  Dwayne   Clarke  ",
        birthDate: "1987-09-14",
        sex: "M" as const,
        address: "  14 Contact Lane,   Kingston  ",
      },
      frontAsset: {
        ...submitInput.frontAsset,
        id: "api-kyc-submit-org-profile-front",
        fileName: "api-kyc-submit-org-profile-front.png",
      },
      clientMutationId: "api-kyc-submit-org-profile-mutation",
    };
    const organizationSubmitted = await api.customers.submitKyc(organizationId, organizationInput);
    expect(await api.customers.submitKyc(organizationId, {
      ...organizationInput,
      subjectProfile: {
        ...organizationInput.subjectProfile,
        name: "Dwayne Clarke",
        address: "14 Contact Lane, Kingston",
      },
    })).toEqual(organizationSubmitted);
    const organizationAudits = await api.customers.auditHistory(organizationId);
    await expect(api.customers.submitKyc(organizationId, {
      ...organizationInput,
      subjectProfile: { ...organizationInput.subjectProfile, address: "99 Changed Road, Kingston" },
    })).rejects.toMatchObject({ status: 409, code: "CUSTOMER_IDEMPOTENCY_CONFLICT" });
    expect(await api.customers.detail(organizationId)).toEqual(organizationSubmitted);
    expect(await api.customers.auditHistory(organizationId)).toEqual(organizationAudits);
  } finally {
    restore();
  }
});

test("typed existing-customer evidence writes reject global asset ID reuse atomically and preserve idempotent success", async () => {
  const restore = installBrowser(superadmin);
  try {
    const customerId = "CUST-UAT-003";
    const before = await api.customers.detail(customerId);
    const beforeAudits = await api.customers.auditHistory(customerId);
    const collisionInputs = [
      {
        frontAsset: { ...SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront },
        clientMutationId: "api-global-evidence-customer",
      },
      {
        frontAsset: { ...SEED_EVIDENCE_ASSETS.aliciaAgreementSignature },
        clientMutationId: "api-global-evidence-agreement-asset",
      },
    ];
    for (const input of collisionInputs) {
      const error = await caughtApiError(api.customers.submitKyc(customerId, input));
      expect(error).toMatchObject({ status: 409, code: "EVIDENCE_ASSET_INVALID" });
      expect(String(error)).not.toMatch(/CUST-UAT-001|Alicia Bennett|North Coast Logistics/);
    }
    const paperError = await caughtApiError(api.customers.signAgreement(customerId, {
      medium: "paper",
      version: "1.3",
      signedBy: "Marcia Reid",
      paperScanAsset: { ...SEED_EVIDENCE_ASSETS.aliciaAgreementSignature },
      clientMutationId: "api-global-evidence-paper",
    }));
    expect(paperError).toMatchObject({ status: 409, code: "EVIDENCE_ASSET_INVALID" });
    expect(await api.customers.detail(customerId)).toEqual(before);
    expect(await api.customers.auditHistory(customerId)).toEqual(beforeAudits);

    const successInput = {
      frontAsset: {
        id: "api-global-evidence-success",
        fileName: "api-global-evidence-success.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
        mimeType: "image/png" as const,
        sizeBytes: 70,
        createdAt: "2026-08-14T13:30:00.000Z",
        createdBy: "emp-001",
      },
      clientMutationId: "api-global-evidence-success",
    };
    const saved = await api.customers.submitKyc(customerId, successInput);
    expect(await api.customers.submitKyc(customerId, successInput)).toEqual(saved);
    const after = await api.customers.detail(customerId);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.verificationArchive.kycRecords).toHaveLength(before.verificationArchive.kycRecords.length + 1);
    const afterAudits = await api.customers.auditHistory(customerId);
    expect(afterAudits.filter((event) => event.eventType === "kyc_submitted")).toHaveLength(
      beforeAudits.filter((event) => event.eventType === "kyc_submitted").length + 1,
    );
  } finally {
    restore();
  }
});

test("typed customer KYC API requires and returns scoped organization-primary-contact evidence", async () => {
  const restore = installBrowser(superadmin);
  try {
    const organization = await api.customers.detail("CUST-UAT-002");
    await expect(api.customers.submitKyc(organization.id, {
      frontAsset: {
        id: "api-org-unscoped",
        fileName: "api-org-unscoped.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        sizeBytes: 70,
        createdAt: "2026-08-14T13:10:00.000Z",
        createdBy: "emp-001",
      },
      clientMutationId: "api-org-unscoped-submit",
    })).rejects.toBeInstanceOf(ApiError);

    const profile = {
      name: organization.nameSourceValue!,
      birthDate: "1988-06-07",
      sex: "M" as const,
      address: "14 Contact Lane, Kingston",
    };
    const submitted = await api.customers.submitKyc(organization.id, {
      subjectType: "organization_primary_contact",
      subjectProfile: profile,
      frontAsset: {
        id: "api-org-scoped",
        fileName: "api-org-scoped.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        sizeBytes: 70,
        createdAt: "2026-08-14T13:10:00.000Z",
        createdBy: "emp-001",
      },
      clientMutationId: "api-org-scoped-submit",
    });
    const record = submitted.verificationArchive.kycRecords.at(-1)!;
    expect(record).toMatchObject({
      subjectType: "organization_primary_contact",
      subjectProfile: profile,
    });
    await expect(api.customers.verifyKyc(organization.id, {
      kycRecordId: record.id,
      clientMutationId: "api-org-scoped-verify",
    })).resolves.toMatchObject({
      verificationArchive: {
        kycRecords: expect.arrayContaining([
          expect.objectContaining({ subjectType: "organization_primary_contact", verifiedBy: "emp-001" }),
        ]),
      },
    });
    const audits = await api.customers.auditHistory(organization.id);
    expect(audits.filter((event) => event.eventType.startsWith("kyc_"))
      .map((event) => event.summary)).toEqual(expect.arrayContaining([
      "提交主要联系人驾驶证证据",
      "完成主要联系人驾驶证核验",
    ]));
  } finally {
    restore();
  }
});

test("real-fetch customer responses normalize the shared four-field driver-license profile", async () => {
  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    delete require.cache[modulePath];
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "CUST-REAL-ORG-001",
      verificationArchive: {
        otpRecords: [],
        agreementRecords: [],
        evidenceGaps: [],
        kycRecords: [{
          id: "KYC-REAL-ORG-001",
          subjectType: "organization_primary_contact",
          subjectProfile: {
            name: "  顾明轩  ",
            birthDate: "1988-06-07",
            sex: "M",
            address: "  14 Contact Lane, Kingston  ",
          },
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    const response = await realClient.api.customers.detail("CUST-REAL-ORG-001");
    expect(response.verificationArchive.kycRecords[0]).toMatchObject({
      subjectProfile: {
        name: "顾明轩",
        birthDate: "1988-06-07",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUseMock === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_USE_MOCK");
    else process.env.NEXT_PUBLIC_USE_MOCK = previousUseMock;
    delete require.cache[modulePath];
  }
});

test("electronic agreement signing API exposes the authoritative time receipt without a preview write", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
    const rawBefore = browser.localStorage.getItem("wh_customer_vehicle_mock_v1");
    const preview = await agreementSigningApi.prepareAgreementSigning("CUST-UAT-003", {
      version: "1.3",
      signedBy: "Marcia Reid",
    });
    expect(preview.token).toMatch(/^[0-9a-f-]{20,}$/i);
    expect(preview.signedAt).toBe("2026-08-09T00:00:00.000Z");
    expect(browser.localStorage.getItem("wh_customer_vehicle_mock_v1")).toBe(rawBefore);
  } finally {
    restore();
  }
});

test("paper agreement API rejects a scan with explicitly present blank physical metadata atomically", async () => {
  const paperScanAsset = {
    id: "api-paper-blank-physical-scan",
    fileName: "paper-scan.png",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
    mimeType: "image/png" as const,
    sizeBytes: 70,
    createdAt: "2026-08-13T12:00:00.000Z",
    createdBy: "emp-001",
  };
  for (const [index, metadata] of [
    { physicalRecordNumber: " " },
    { physicalStorageLocation: "\t" },
  ].entries()) {
    const restore = installBrowser(superadmin);
    try {
      const customerId = "CUST-UAT-003";
      const before = await api.customers.detail(customerId);
      const auditBefore = await api.customers.auditHistory(customerId);
      const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
      const rawBefore = browser.localStorage.getItem("wh_customer_vehicle_mock_v1");
      await expect(api.customers.signAgreement(customerId, {
        medium: "paper",
        version: "1.3",
        signedBy: "Marcia Reid",
        paperScanAsset: { ...paperScanAsset, id: `${paperScanAsset.id}-${index}` },
        ...metadata,
        clientMutationId: `api-agreement-paper-blank-physical-${index}`,
      })).rejects.toMatchObject({ status: 400, code: "AGREEMENT_EVIDENCE_REQUIRED" });
      expect(browser.localStorage.getItem("wh_customer_vehicle_mock_v1")).toBe(rawBefore);
      await expect(api.customers.detail(customerId)).resolves.toEqual(before);
      await expect(api.customers.auditHistory(customerId)).resolves.toEqual(auditBefore);
    } finally {
      restore();
    }
  }
});

test("verification API binds authorization before bad bodies and does not leak path customer PII", async () => {
  const malformedOperations = () => [
    () => agreementSigningApi.prepareAgreementSigning("CUST-UAT-001", null as unknown as { version: string; signedBy: string }),
    () => api.customers.requestOtp("CUST-UAT-001", null as unknown as RequestCustomerOtpInput),
    () => api.customers.verifyOtp("CUST-UAT-001", null as unknown as VerifyCustomerOtpInput),
    () => api.customers.invalidateOtp("CUST-UAT-001", null as unknown as InvalidateCustomerOtpInput),
    () => api.customers.submitKyc("CUST-UAT-001", null as unknown as SubmitCustomerKycInput),
    () => api.customers.verifyKyc("CUST-UAT-001", null as unknown as VerifyCustomerKycInput),
    () => api.customers.signAgreement("CUST-UAT-001", null as unknown as SignCustomerAgreementInput),
    () => api.customers.auditHistory("CUST-UAT-001"),
  ];

  for (const [session, status, message] of [
    [null, 403, /无权/],
    ["{not valid JSON", 401, /会话无效/],
    [parts, 403, /无权/],
  ] as const) {
    const restore = installBrowser(session);
    try {
      for (const operation of malformedOperations()) {
        await expectStatus(operation(), status, message);
      }
    } finally {
      restore();
    }
  }
});

test("verification API rejects a data-bearing session actor before mutation", async () => {
  const restore = installBrowser({
    identity: { id: "data:image/png;base64,PRIVATE_SESSION_ACTOR", role: "superadmin" },
  });
  try {
    await expect(api.customers.requestOtp("CUST-UAT-003", {
      phoneE164: "+18765550146",
      clientMutationId: "api-unsafe-actor",
    })).rejects.toMatchObject({ status: 401 });
    const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
    expect(browser.localStorage.getItem("wh_customer_vehicle_mock_v1")).toBeNull();
  } finally {
    restore();
  }
});

test("an in-flight verification mutation keeps the actor bound at request invocation", async () => {
  const restore = installBrowser(superadmin);
  try {
    const pending = api.customers.requestOtp("CUST-UAT-003", {
      phoneE164: "+18765550145",
      clientMutationId: "api-actor-bound-before-delay",
    });
    const browser = globalThis.window as unknown as { localStorage: MemoryStorage };
    browser.localStorage.setItem("wh_session", JSON.stringify(frontdesk));
    await expect(pending).resolves.toMatchObject({
      verificationArchive: { otpRecords: [expect.objectContaining({ phoneE164: "+18765550145" })] },
    });
    const history = await api.customers.auditHistory("CUST-UAT-003");
    expect(history.find((event) => event.eventType === "otp_requested")).toMatchObject({
      actorId: "emp-001",
    });
    const raw = browser.localStorage.getItem("wh_customer_vehicle_mock_v1");
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!) as {
      state: { mutationReceipts: Array<Record<string, unknown>> };
    };
    expect(envelope.state.mutationReceipts).toContainEqual(expect.objectContaining({
      actorId: "emp-001",
      clientMutationId: "api-actor-bound-before-delay",
      operation: "otp.request",
      resultEntityId: "CUST-UAT-003",
      resultRevision: 2,
    }));
  } finally {
    restore();
  }
});

test("一次性保存故障先于 mutation，保留 preview token 和数据以供同路径重试", async () => {
  const restore = installBrowser(superadmin, {
    failNext: { customerVehicleSave: "可重试客户车辆保存故障" },
  });
  try {
    const prepared = await prepareIndividualOnboarding({
      name: "林浩然",
      primaryPhone: "+18765550990",
      email: "retry.customer@example.test",
      id: "retry-customer",
    });
    const input = {
      previewToken: prepared.preview.previewToken,
      confirmPossibleDuplicate: prepared.preview.candidates.length > 0 ? true : undefined,
      clientMutationId: "retry-customer-create",
    };
    await expect(api.customers.onboarding.create(prepared.token, input)).rejects.toThrow(/可重试客户车辆保存故障/);
    await expect(api.customers.workspace()).resolves.toMatchObject({ summary: { totalCustomers: 300 } });
    await expect(api.customers.onboarding.create(prepared.token, input)).resolves.toMatchObject({ nameZh: "林浩然", nameEn: "Lin Haoran", revision: 1 });
    await expect(api.customers.workspace()).resolves.toMatchObject({ summary: { totalCustomers: 301 } });
  } finally {
    restore();
  }
});

test("客户和车辆 public API 编辑必须经 previewUpdate 且路由 token 绑定实体与 exact input", async () => {
  const restore = installBrowser(superadmin);
  try {
    const customer = await api.customers.detail("CUST-UAT-004");
    const customerPreview = await api.customers.previewUpdate(customer.id, {
      customerType: customer.customerType,
      nameSourceValue: customer.nameSourceValue,
      organizationName: customer.organizationName,
      primaryPhone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      status: customer.status,
      expectedRevision: customer.revision,
    });
    expect(customerPreview.candidates.some((entry) => entry.customerId === customer.id)).toBe(false);
    await expect(api.customers.update(customer.id, {
      ...customerPreview.input,
      organizationName: "Tampered after API preview",
      expectedRevision: customer.revision,
      previewToken: customerPreview.previewToken,
    })).rejects.toThrow(/预览内容已变化/);

    const vehicle = await api.vehicles.detail("VEH-UAT-001");
    const vehiclePreview = await api.vehicles.previewUpdate(vehicle.id, {
      plate: vehicle.plate,
      vin: vehicle.vin,
      make: vehicle.make,
      model: "CR-V API Preview",
      year: vehicle.year,
      status: vehicle.status,
      expectedRevision: vehicle.revision,
    });
    expect(vehiclePreview).toMatchObject({ existingVehicleId: null, canSave: true });
    await expect(api.vehicles.update(vehicle.id, {
      ...vehiclePreview.input,
      model: "Tampered after API preview",
      expectedRevision: vehicle.revision,
      previewToken: vehiclePreview.previewToken,
    })).rejects.toThrow(/预览内容已变化/);
  } finally {
    restore();
  }
});

test("public API detail 对 v3 有效嵌套 read model 返回深克隆", async () => {
  const restore = installBrowser(superadmin);
  try {
    const firstCustomer = await api.customers.detail("CUST-UAT-001");
    (firstCustomer.notes as unknown as Array<{ content: string }>)[0]!.content = "api-mutated";
    (firstCustomer.riskFlags as unknown as Array<Record<string, unknown>>).push({ id: "caller-only", level: "attention", note: "caller", addedAt: "2026-01-01T00:00:00.000Z", addedBy: "caller", removedAt: null, removedBy: null });
    const nextCustomer = await api.customers.detail("CUST-UAT-001");
    expect(nextCustomer).toMatchObject({
      notes: [expect.objectContaining({ content: "Prefers morning pickup and WhatsApp confirmation." })],
      riskFlags: [],
    });

    const firstVehicle = await api.vehicles.detail("VEH-UAT-001");
    firstVehicle.photos[0]!.note = "api-mutated";
    firstVehicle.partsNeeds[0]!.name = "api-mutated";
    const nextVehicle = await api.vehicles.detail("VEH-UAT-001");
    expect(nextVehicle).toMatchObject({
      photos: [expect.objectContaining({ note: "注册证（Registration Certificate）" }), expect.anything(), expect.anything()],
      partsNeeds: [expect.objectContaining({ name: "Timing belt kit" })],
    });
  } finally {
    restore();
  }
});

test("客户编辑 API 以稳定 409 拒绝其他客户任一已登记手机号", async () => {
  const restore = installBrowser(superadmin);
  try {
    const target = await api.customers.detail("CUST-UAT-004");
    const occupied = await api.customers.detail("CUST-UAT-001");
    const error = await caughtApiError(api.customers.previewUpdate(target.id, {
      customerType: target.customerType,
      organizationName: target.organizationName,
      nameSourceValue: target.nameSourceValue,
      primaryPhone: target.phone,
      secondaryPhone: occupied.whatsapp,
      whatsapp: target.whatsapp,
      email: target.email,
      expectedRevision: target.revision,
    }));
    expect(error).toMatchObject({ status: 409, code: "CUSTOMER_PHONE_DUPLICATE" });
  } finally {
    restore();
  }
});

test("public API 将新手机号所有权冲突映射为 409，并让非手机号候选保持非阻断", async () => {
  const restore = installBrowser(superadmin);
  try {
    const occupied = await api.customers.detail("CUST-UAT-001");
    const name = await api.customers.previewName("陈志远");
    await expect(api.customers.preview({
      customerType: "individual",
      nameSourceValue: "陈志远",
      nameTransliterationToken: name.confirmationToken,
      primaryPhone: occupied.whatsapp,
    })).rejects.toMatchObject({ status: 409, code: "CUSTOMER_PHONE_DUPLICATE" });

    await expect(api.customers.requestOtp("CUST-UAT-003", {
      phoneE164: occupied.secondaryPhone!,
      clientMutationId: "api-otp-other-owner",
    })).rejects.toMatchObject({ status: 409, code: "CUSTOMER_PHONE_DUPLICATE" });

    const target = await api.customers.detail("CUST-UAT-004");
    const warningPreview = await api.customers.previewUpdate(target.id, {
      customerType: target.customerType,
      organizationName: target.organizationName,
      nameSourceValue: target.nameSourceValue,
      primaryPhone: target.phone,
      secondaryPhone: target.secondaryPhone,
      whatsapp: target.whatsapp,
      email: occupied.email,
      expectedRevision: target.revision,
    });
    expect(warningPreview.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerId: occupied.id, reasons: expect.arrayContaining(["email"]) }),
    ]));
    await expect(api.customers.update(target.id, {
      ...warningPreview.input,
      expectedRevision: target.revision,
      previewToken: warningPreview.previewToken,
    })).resolves.toMatchObject({ id: target.id, email: occupied.email });
  } finally {
    restore();
  }
});

test("public API 对所有 preview/mutation 坏 body 返回 400，不能依赖 TypeScript cast", async () => {
  const restore = installBrowser(superadmin);
  try {
    await expectRawClientStatus(
      loadClientWithRawMockRequest().__rawMockRequest("/api/customers", {
        method: "POST",
        body: JSON.stringify({ previewToken: 7 }),
      }),
      400,
      /现场客户建档流程/,
      "CUSTOMER_ONBOARDING_REQUIRED",
    );
    const operations: Array<() => Promise<unknown>> = [
      () => api.customers.preview(null as unknown as CustomerDraftInput),
      () => api.customers.previewUpdate("CUST-UAT-001", {
        customerType: "individual", name: "Bad", email: "bad@example.test", status: "paused", expectedRevision: 1,
      } as unknown as Parameters<typeof api.customers.previewUpdate>[1]),
      () => api.customers.update("CUST-UAT-001", {
        customerType: "individual", name: "Bad", email: "bad@example.test", expectedRevision: "1", previewToken: "forged",
      } as unknown as UpdateCustomerInput),
      () => api.vehicles.preview(null as unknown as VehicleDraftInput),
      () => api.vehicles.create({ previewToken: [] } as unknown as SaveVehicleInput),
      () => api.vehicles.previewUpdate("VEH-UAT-001", {
        make: "Honda", model: "Fit", year: 2020, status: "inactive", expectedRevision: 1,
      } as unknown as Parameters<typeof api.vehicles.previewUpdate>[1]),
      () => api.vehicles.update("VEH-UAT-001", {
        make: "Honda", model: "Fit", year: 2020, expectedRevision: 1, previewToken: "forged", relationships: {},
      } as unknown as UpdateVehicleInput),
    ];
    for (const operation of operations) await expectStatus(operation(), 400, /必须|无效|数组/);
  } finally {
    restore();
  }
});

test("未授权坏 body 的所有 customer/vehicle preview 与 mutation 仍先返回 401/403", async () => {
  for (const [session, status, message] of [
    [null, 403, /无权/],
    ["{not valid JSON", 401, /会话无效/],
    [parts, 403, /无权/],
  ] as const) {
    const restore = installBrowser(session);
    try {
      await expectRawClientStatus(
        loadClientWithRawMockRequest().__rawMockRequest("/api/customers", { method: "POST", body: "null" }),
        status,
        message,
      );
      const operations: Array<() => Promise<unknown>> = [
        () => api.customers.preview(null as unknown as CustomerDraftInput),
        () => api.customers.previewUpdate("CUST-UAT-001", null as unknown as Parameters<typeof api.customers.previewUpdate>[1]),
        () => api.customers.update("CUST-UAT-001", null as unknown as UpdateCustomerInput),
        () => api.vehicles.preview(null as unknown as VehicleDraftInput),
        () => api.vehicles.create(null as unknown as SaveVehicleInput),
        () => api.vehicles.previewUpdate("VEH-UAT-001", null as unknown as Parameters<typeof api.vehicles.previewUpdate>[1]),
        () => api.vehicles.update("VEH-UAT-001", null as unknown as UpdateVehicleInput),
      ];
      for (const operation of operations) await expectStatus(operation(), status, message);
    } finally {
      restore();
    }
  }
});
