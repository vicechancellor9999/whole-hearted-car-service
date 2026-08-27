import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { findCustomerIdByPhone, useOnboardingIdentity } from "./helpers/customer-onboarding";

const SYNTHETIC_LICENSE = path.resolve(
  process.cwd(),
  "public/seed-evidence/alicia-bennett-drivers-license-front.png",
);
const SYNTHETIC_LICENSE_BYTES = readFileSync(SYNTHETIC_LICENSE);

const EXTRACTION_RESULT = {
  profile: {
    name: "Alicia Bennett",
    birthDate: "1988-03-22",
    sex: "F" as const,
    address: "12 Constant Spring Road, Kingston 8, Jamaica",
  },
  status: { name: "extracted", birthDate: "extracted", sex: "extracted", address: "extracted" } as const,
};

const LATEST_EXTRACTION_RESULT = {
  ...EXTRACTION_RESULT,
  profile: {
    ...EXTRACTION_RESULT.profile,
    name: "Latest Alicia",
    address: "18 Latest Constant Spring Road, Kingston",
  },
};

const PARTIAL_EXTRACTION_RESULT = {
  profile: { name: "Alicia Bennett" },
  status: {
    name: "extracted",
    birthDate: "manual_required",
    sex: "manual_required",
    address: "manual_required",
  } as const,
};

const DEFERRED_EXTRACTION_RELEASE_EVENT = "wh:customers:onboarding-extraction-release";
const DEFERRED_EVIDENCE_RELEASE_EVENT = "wh:customers:onboarding-evidence-release";
const FORBIDDEN_PRIVACY_KEYS = new Set([
  "rawtext",
  "rawresponse",
  "confidence",
  "blocks",
  "hocr",
  "tsv",
  "providerrequestid",
  "providerid",
  "providername",
  "modelname",
  "processedimage",
  "extractionsession",
  "extractionattempt",
  "objecturl",
  "bloburl",
]);
const FORBIDDEN_PRIVACY_KEY_FAMILY = /^(?:providerrequestids?|processedimages?|extractionsessions?|extractionattempts?|objecturls?|bloburls?|coordinates?|templatenames?|fulltexts?|ocrraws?|licensenumbers?|documentnumbers?)$/;
const FORBIDDEN_PRIVACY_VALUE = /(?:^|[^a-z0-9])(?:raw[ _-]?text|raw[ _-]?response|confidence|blocks?|hocr|tsv|provider[ _-]?(?:request[ _-]?)?ids?|provider[ _-]?name|model[ _-]?name|processed[ _-]?images?|extraction[ _-]?(?:sessions?|attempts?)|object[ _-]?urls?|blob[ _-]?urls?)(?:$|[^a-z0-9])/i;
const FORBIDDEN_COORDINATE_VALUE = /(?:^|[^a-z0-9])coordinates?(?=\s*(?:$|[:=([{]))/i;
const FORBIDDEN_DOCUMENT_METADATA_VALUE = /(?:^|[^a-z0-9])(?:template[ _-]?names?|full[ _-]?texts?|ocr[ _-]?raws?|license[ _-]?numbers?|document[ _-]?numbers?)(?=\s*(?:$|[:=([{]))/i;
const ALLOWED_KYC_EVIDENCE_DATA_PATH = /(?:^|\.)verificationArchive\.kycRecords\[\d+\]\.frontAsset\.url$/;
const ALLOWED_INSPECTION_RAW_TEXT_PATH = /^\$\.wh_linked_operations_state_v1\.inspectionReports\[\d+\]\.rawText$/;
const SAFE_KYC_EVIDENCE_DATA_URL = /^data:image\/(?:jpeg|png);base64,/i;

function privacyViolations(value: unknown, path = "$", violations: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => privacyViolations(item, `${path}[${index}]`, violations));
    return violations;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const childPath = `${path}.${key}`;
      if (
        (FORBIDDEN_PRIVACY_KEYS.has(normalizedKey) || FORBIDDEN_PRIVACY_KEY_FAMILY.test(normalizedKey))
        && !ALLOWED_INSPECTION_RAW_TEXT_PATH.test(childPath)
      ) {
        violations.push(`${path}.${key}: forbidden key`);
      }
      privacyViolations(child, childPath, violations);
    }
    return violations;
  }
  if (typeof value !== "string") return violations;
  const allowedEvidenceData = ALLOWED_KYC_EVIDENCE_DATA_PATH.test(path)
    && SAFE_KYC_EVIDENCE_DATA_URL.test(value);
  if (allowedEvidenceData) return violations;
  if (/(?:^|\D)123456(?:$|\D)/.test(value)) violations.push(`${path}: OTP code persisted`);
  if (/(?:blob|filesystem):/i.test(value)) violations.push(`${path}: object/blob URL persisted`);
  if (/data:/i.test(value)) violations.push(`${path}: data URL outside confirmed KYC evidence`);
  if (FORBIDDEN_COORDINATE_VALUE.test(value)) {
    violations.push(`${path}: extraction coordinate token persisted`);
  }
  if (FORBIDDEN_DOCUMENT_METADATA_VALUE.test(value)) {
    violations.push(`${path}: extraction metadata token persisted`);
  }
  if (FORBIDDEN_PRIVACY_VALUE.test(value)) {
    violations.push(`${path}: extraction raw/provider token persisted`);
  }
  return violations;
}

function parseStorageValueForPrivacy(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

test("privacy helper rejects normalized forbidden key families through nested objects and arrays", () => {
  const malicious = {
    providerRequestId: "request-1",
    provider_request_ids: ["request-2"],
    payload: [
      { processed_image: "redacted", "processed-images": ["redacted"] },
      {
        sessions: {
          extractionSession: "redacted",
          "extraction-sessions": [{ extraction_attempt: "redacted", extractionAttempts: ["redacted"] }],
        },
      },
      {
        urls: {
          object_url: "https://example.test/object",
          "object-urls": ["https://example.test/objects"],
          blobUrl: "https://example.test/blob",
          blob_urls: ["https://example.test/blobs"],
        },
      },
    ],
  };

  expect(privacyViolations(malicious)).toEqual([
    "$.providerRequestId: forbidden key",
    "$.provider_request_ids: forbidden key",
    "$.payload[0].processed_image: forbidden key",
    "$.payload[0].processed-images: forbidden key",
    "$.payload[1].sessions.extractionSession: forbidden key",
    "$.payload[1].sessions.extraction-sessions: forbidden key",
    "$.payload[1].sessions.extraction-sessions[0].extraction_attempt: forbidden key",
    "$.payload[1].sessions.extraction-sessions[0].extractionAttempts: forbidden key",
    "$.payload[2].urls.object_url: forbidden key",
    "$.payload[2].urls.object-urls: forbidden key",
    "$.payload[2].urls.blobUrl: forbidden key",
    "$.payload[2].urls.blob_urls: forbidden key",
  ]);
});

test("privacy helper rejects coordinate metadata without treating address words as extraction tokens", () => {
  expect(privacyViolations({
    coordinate: { x: 12, y: 24 },
    nested: [{ "co-ordinates": "legacy-shape" }, { coordinates: [18.0, -76.0] }],
    rawStorage: "coordinates=[18.0,-76.0]",
  })).toEqual([
    "$.coordinate: forbidden key",
    "$.nested[0].co-ordinates: forbidden key",
    "$.nested[1].coordinates: forbidden key",
    "$.rawStorage: extraction coordinate token persisted",
  ]);

  expect(privacyViolations({
    address: "12 Coordinate Avenue, Kingston",
    directions: "Turn left after Coordinates Plaza",
  })).toEqual([]);
});

test("privacy helper rejects forbidden extraction document metadata without broad text matches", () => {
  expect(privacyViolations({
    metadata: {
      template_name: "jamaica-license-v1",
      fullTexts: ["raw licence content"],
      "ocr-raw": "raw licence content",
      license_number: "LIC-123",
      documentNumbers: ["DOC-456"],
    },
    storage: [
      "templateName=jamaica-license-v1",
      "full_text:raw licence content",
      "ocr-raw=[raw licence content]",
      "license-number=LIC-123",
      "documentNumber:DOC-456",
    ],
  })).toEqual([
    "$.metadata.template_name: forbidden key",
    "$.metadata.fullTexts: forbidden key",
    "$.metadata.ocr-raw: forbidden key",
    "$.metadata.license_number: forbidden key",
    "$.metadata.documentNumbers: forbidden key",
    "$.storage[0]: extraction metadata token persisted",
    "$.storage[1]: extraction metadata token persisted",
    "$.storage[2]: extraction metadata token persisted",
    "$.storage[3]: extraction metadata token persisted",
    "$.storage[4]: extraction metadata token persisted",
  ]);

  expect(privacyViolations({
    templateDescription: "Customer welcome template named Standard",
    notes: "Use the full text supplied by the customer",
    material: "OCR raw material is not stored",
    address: "12 License Number Road, Document Number Plaza",
  })).toEqual([]);
});

test("privacy helper parses storage leaks and allows data image evidence only at the confirmed KYC path", () => {
  const nestedStorage = JSON.stringify({
    otpCode: "123456",
    previewUrl: "blob:https://example.test/leak",
    provider_request_ids: ["request-3"],
  });
  const rawStorage = "providerRequestIds=request-4 OTP=123456 preview=filesystem:https://example.test/leak";
  const parsedStorage = parseStorageValueForPrivacy(nestedStorage);

  expect(privacyViolations({ wh_customer_vehicle_mock_v1: parsedStorage }, "$.localStorage")).toEqual([
    "$.localStorage.wh_customer_vehicle_mock_v1.otpCode: OTP code persisted",
    "$.localStorage.wh_customer_vehicle_mock_v1.previewUrl: object/blob URL persisted",
    "$.localStorage.wh_customer_vehicle_mock_v1.provider_request_ids: forbidden key",
  ]);
  expect(privacyViolations({ bad: rawStorage }, "$.sessionStorage")).toEqual([
    "$.sessionStorage.bad: OTP code persisted",
    "$.sessionStorage.bad: object/blob URL persisted",
    "$.sessionStorage.bad: extraction raw/provider token persisted",
  ]);
  expect(privacyViolations({ profileImage: "data:image/png;base64,QUJD" })).toEqual([
    "$.profileImage: data URL outside confirmed KYC evidence",
  ]);
  expect(privacyViolations({
    nameSourceValue: "Alicia Bennett",
    birthDate: "1988-03-22",
    gender: "女",
    address: "12 Constant Spring Road, Kingston 8, Jamaica",
    verificationArchive: {
      kycRecords: [{ frontAsset: { url: "data:image/png;base64,QUJD" } }],
    },
  })).toEqual([]);
});

async function releaseDeferredExtraction(page: Page) {
  await page.evaluate(async (releaseEvent) => {
    window.dispatchEvent(new Event(releaseEvent));
    await new Promise<void>((next) => requestAnimationFrame(() => next()));
    await new Promise<void>((next) => requestAnimationFrame(() => next()));
  }, DEFERRED_EXTRACTION_RELEASE_EVENT);
}

async function releaseDeferredEvidence(page: Page) {
  await page.evaluate(async (releaseEvent) => {
    window.dispatchEvent(new Event(releaseEvent));
    await new Promise<void>((next) => requestAnimationFrame(() => next()));
    await new Promise<void>((next) => requestAnimationFrame(() => next()));
  }, DEFERRED_EVIDENCE_RELEASE_EVENT);
}

const runtimeErrors = new WeakMap<Page, string[]>();
function watchRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  runtimeErrors.set(page, errors);
}

test.beforeEach(async ({ page }) => watchRuntimeErrors(page));
test.afterEach(async ({ page }) => expect(runtimeErrors.get(page) ?? []).toEqual([]));

async function verifyPhone(page: Page, phone: string) {
  await page.getByTestId("onboarding-phone").fill(phone);
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-send-otp").click();
  await page.getByTestId("onboarding-otp-code").fill("123456");
  await page.getByTestId("onboarding-verify-otp").click();
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("号码已验证");
}

async function completeLicence(page: Page) {
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
  await expect(page.getByTestId("onboarding-extraction-status"))
    .toContainText("模拟 AI 辅助结果（仅演示）");
  await expect(page.getByTestId("onboarding-license-attestation")).not.toBeChecked();
  await page.getByTestId("onboarding-license-attestation").check();
  await expect(page.getByTestId("onboarding-kyc-status")).toContainText("驾驶证已人工核验");
}

test("new individual checks phone before OTP and creates with verified evidence", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", { licenseExtraction: { kind: "result", result: EXTRACTION_RESULT } });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("onboarding-send-otp")).toBeDisabled();
  await verifyPhone(page, "+1 876 555 0199");
  await completeLicence(page);
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("customer-duplicate-candidates")).toContainText("CUST-UAT-001");
  await expect(page.getByTestId("confirm-customer-duplicate")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-create")).toBeEnabled();
  await page.getByTestId("onboarding-create").click();
  const customerId = await findCustomerIdByPhone(page, "+18765550199");
  await page.getByTestId(`customer-row-${customerId}`).click();
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await expect(page.getByTestId("customer-otp-evidence-card")).toContainText("已验证");
  await expect(page.getByTestId("customer-kyc-evidence-card")).toContainText("已核验");
});

test("explicit Mock success keeps the persisted onboarding privacy boundary", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  await useOnboardingIdentity(page, "superadmin", { licenseExtraction: { kind: "result", result: EXTRACTION_RESULT } });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0149");
  await completeLicence(page);
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("confirm-customer-duplicate")).toHaveCount(0);
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);

  const snapshot = await page.evaluate(async (expectedPhone) => {
    const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
    if (!raw) throw new Error("missing customer storage");
    const envelope = JSON.parse(raw) as {
      state: {
        customers: Array<Record<string, unknown> & { phone?: string }>;
        auditEvents: Array<Record<string, unknown> & { customerId?: string }>;
      };
    };
    const customer = envelope.state.customers.find((entry) => entry.phone === expectedPhone);
    if (!customer || typeof customer.id !== "string") throw new Error("missing created customer");
    const localStorageEntries = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, localStorage.getItem(key)]),
    );
    const sessionStorageEntries = Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, sessionStorage.getItem(key)]),
    );
    const databaseNames = typeof indexedDB.databases === "function"
      ? (await indexedDB.databases()).map((database) => database.name ?? "")
      : ["indexedDB.databases unavailable"];
    return {
      customer,
      audits: envelope.state.auditEvents.filter((event) => event.customerId === customer.id),
      localStorageEntries,
      sessionStorageEntries,
      databaseNames,
      url: location.href,
    };
  }, "+18765550149");

  expect({
    name: snapshot.customer.nameSourceValue,
    birthDate: snapshot.customer.birthDate,
    sex: snapshot.customer.gender,
    address: snapshot.customer.address,
  }).toEqual({
    name: EXTRACTION_RESULT.profile.name,
    birthDate: EXTRACTION_RESULT.profile.birthDate,
    sex: "女",
    address: EXTRACTION_RESULT.profile.address,
  });
  const verificationArchive = snapshot.customer.verificationArchive as {
    kycRecords: Array<{ frontAsset: { url: string; sizeBytes: number } }>;
  };
  const evidence = verificationArchive.kycRecords.at(-1)?.frontAsset;
  expect(evidence?.url).toMatch(/^data:image\/(?:jpeg|png);base64,/);
  expect(evidence?.sizeBytes).toBeGreaterThan(0);
  expect(evidence?.sizeBytes).toBeLessThanOrEqual(512 * 1024);

  const parsedLocalStorageEntries = Object.fromEntries(
    Object.entries(snapshot.localStorageEntries)
      .map(([key, value]) => [key, parseStorageValueForPrivacy(value)]),
  );
  const parsedSessionStorageEntries = Object.fromEntries(
    Object.entries(snapshot.sessionStorageEntries)
      .map(([key, value]) => [key, parseStorageValueForPrivacy(value)]),
  );

  expect(privacyViolations(snapshot.customer)).toEqual([]);
  expect(privacyViolations(snapshot.audits)).toEqual([]);
  expect(privacyViolations(parsedLocalStorageEntries)).toEqual([]);
  expect(privacyViolations(parsedSessionStorageEntries)).toEqual([]);
  expect(snapshot.databaseNames).toEqual([]);
  expect(privacyViolations(snapshot.url)).toEqual([]);
  expect(privacyViolations(consoleMessages)).toEqual([]);
});

test("existing phone opens the existing profile and never offers OTP", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0101");
  await page.getByTestId("onboarding-check-phone").click();
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("该号码属于已有客户");
  await expect(page.getByTestId("onboarding-send-otp")).toHaveCount(0);
  await page.getByTestId("onboarding-existing-customer-CUST-UAT-001").click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
});

test("1440 phone is required while OTP and licence stay optional reminders（2026-08-17）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();

  // 手机号必填：空号不可查询、后续步骤禁用
  await expect(page.getByTestId("onboarding-check-phone")).toHaveText("请先填写号码");
  await expect(page.getByTestId("onboarding-check-phone")).toBeDisabled();
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("请填写主要号码（必填）");
  await expect(page.getByTestId("onboarding-license-step")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("onboarding-profile-step")).toHaveAttribute("aria-disabled", "true");

  // 填号 → 查重 → 解锁；OTP 可选
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0199");
  await page.getByTestId("onboarding-check-phone").click();
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("号码未被使用，可选做 OTP");
  await expect(page.getByTestId("onboarding-license-step")).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByTestId("onboarding-profile-step")).toHaveAttribute("aria-disabled", "false");

  await page.getByTestId("onboarding-license-name").fill("Only one optional licence field");
  await page.getByTestId("onboarding-name-source").fill("赵明轩");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-reminders")).toContainText("验证码尚未请求");
  await expect(page.getByTestId("onboarding-reminders")).toContainText("驾驶证证据未提交");
  await expect(page.getByTestId("onboarding-create")).toBeEnabled();

  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  const customerId = await page.evaluate(() => {
    const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
    if (!raw) throw new Error("missing customer storage");
    const envelope = JSON.parse(raw) as { state: { customers: Array<{ id: string; nameSourceValue: string | null }> } };
    return envelope.state.customers.find((customer) => customer.nameSourceValue === "赵明轩")?.id ?? null;
  });
  expect(customerId).toBeTruthy();
  await page.goto(`/customers/${customerId}`);
  await expect(page.getByTestId("verification-row-otp")).toContainText("待补验证");
  await expect(page.getByTestId("verification-row-kyc")).toContainText("驾驶证待补");
});

test("missing OTP supports both not-requested and pending sessions through preview and create", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");

  for (const scenario of [
    { phone: "+1 876 555 0187", name: "赵明轩", pending: false, reminder: "验证码尚未请求" },
    { phone: "+1 876 555 0186", name: "顾明轩", pending: true, reminder: "验证码待完成" },
  ]) {
    await page.getByTestId("create-customer-btn").click();
    await page.getByTestId("onboarding-phone").fill(scenario.phone);
    await page.getByTestId("onboarding-check-phone").click();
    if (scenario.pending) await page.getByTestId("onboarding-send-otp").click();
    await expect(page.getByTestId("onboarding-profile-step")).toHaveAttribute("aria-disabled", "false");
    await page.getByTestId("onboarding-name-source").fill(scenario.name);
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await page.getByTestId("onboarding-preview").click();
    await expect(page.getByTestId("onboarding-reminders")).toContainText(scenario.reminder);
    await expect(page.getByTestId("onboarding-create")).toBeEnabled();
    if (!scenario.pending) {
      await page.getByTestId("onboarding-send-otp").click();
      await expect(page.getByTestId("onboarding-otp-code")).toBeVisible();
      await expect(page.getByTestId("onboarding-create")).toBeDisabled();
      await page.getByTestId("onboarding-preview").click();
      await expect(page.getByTestId("onboarding-reminders")).toContainText("验证码待完成");
      await expect(page.getByTestId("onboarding-create")).toBeEnabled();
    }
    await page.getByTestId("onboarding-create").click();
    await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  }
});

test("OTP request and verify retries reuse their token-lifecycle mutation IDs after response loss", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    failNext: {
      customerOnboardingOtpRequestResponse: "演示 OTP 请求响应丢失",
      customerOnboardingOtpVerifyResponse: "演示 OTP 验证响应丢失",
    },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0185");
  await page.getByTestId("onboarding-check-phone").click();

  await page.getByTestId("onboarding-send-otp").click();
  await expect(page.getByTestId("onboarding-phone-error")).toContainText("演示 OTP 请求响应丢失");
  await page.getByTestId("onboarding-send-otp").click();
  await expect(page.getByTestId("onboarding-otp-code")).toBeVisible();
  await page.getByTestId("onboarding-otp-code").fill("123456");

  await page.getByTestId("onboarding-verify-otp").click();
  await expect(page.getByTestId("onboarding-phone-error")).toContainText("演示 OTP 验证响应丢失");
  await page.getByTestId("onboarding-verify-otp").click();
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("号码已验证");
});

for (const scenario of [
  {
    label: "submit",
    fault: "customerOnboardingKycSubmitResponse",
    message: "演示 KYC 提交响应丢失",
    phone: "+1 876 555 0184",
  },
  {
    label: "verify",
    fault: "customerOnboardingKycVerifyResponse",
    message: "演示 KYC 核验响应丢失",
    phone: "+1 876 555 0183",
  },
] as const) {
  test(`KYC ${scenario.label} response loss is cleared before the employee skips evidence and creates`, async ({ page }) => {
    await useOnboardingIdentity(page, "superadmin", {
      licenseExtraction: { kind: "result", result: EXTRACTION_RESULT },
      failNext: { [scenario.fault]: scenario.message } as never,
    });
    await page.goto("/customers");
    await page.getByTestId("create-customer-btn").click();
    await verifyPhone(page, scenario.phone);
    await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
    await page.getByTestId("onboarding-license-extract").click();
    await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");

    await page.getByTestId("onboarding-license-attestation").check();
    await expect(page.getByTestId("onboarding-license-error")).toContainText(scenario.message);
    await expect(page.getByTestId("onboarding-license-attestation")).not.toBeChecked();
    await expect(page.getByTestId("onboarding-phone-status")).toContainText("号码已验证");

    await page.getByTestId("onboarding-name-source").fill("Alicia Bennett");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await page.getByTestId("onboarding-preview").click();
    await expect(page.getByTestId("onboarding-reminders")).toContainText("驾驶证证据未提交");
    await expect(page.getByTestId("onboarding-reminders")).not.toContainText("验证码");
    await page.getByTestId("onboarding-create").click();
    await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);

    const customerId = await findCustomerIdByPhone(page, scenario.phone);
    const verificationArchive = await page.evaluate((id) => {
      const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
      if (!raw) throw new Error("missing customer storage");
      const envelope = JSON.parse(raw) as {
        state: {
          customers: Array<{
            id: string;
            verificationArchive: {
              otpRecords: Array<{ phoneE164: string; verifiedAt?: string }>;
              kycRecords: unknown[];
              evidenceGaps: Array<{ kind: string; status: string }>;
            };
          }>;
        };
      };
      return envelope.state.customers.find((customer) => customer.id === id)?.verificationArchive ?? null;
    }, customerId);
    expect(verificationArchive).not.toBeNull();
    expect(verificationArchive?.otpRecords).toEqual([
      expect.objectContaining({ phoneE164: `+${scenario.phone.replace(/\D/g, "")}`, verifiedAt: expect.any(String) }),
    ]);
    expect(verificationArchive?.kycRecords).toEqual([]);
    expect(verificationArchive?.evidenceGaps).toContainEqual(
      expect.objectContaining({ kind: "kyc", status: "evidence_missing" }),
    );
  });
}

test("organization primary contact licence can be skipped without changing the formal company address", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-customer-type").selectOption("organization");
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0196");
  await page.getByTestId("onboarding-check-phone").click();
  await expect(page.getByTestId("onboarding-license-step")).toContainText("企业主要联系人驾驶证（选填）");
  await page.getByTestId("onboarding-organization-name").fill("Kingston Fleet Services Ltd");
  await page.getByTestId("onboarding-name-source").fill("赵明轩");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-primary-contact-role").fill("Fleet manager");
  await page.getByTestId("onboarding-address").fill("88 Formal Company Road, Kingston");
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-reminders")).toContainText("企业主要联系人驾驶证证据未提交");
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  const created = await page.evaluate(() => {
    const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
    if (!raw) throw new Error("missing customer storage");
    const envelope = JSON.parse(raw) as { state: { customers: Array<Record<string, unknown>> } };
    return envelope.state.customers.find((customer) => customer.organizationName === "Kingston Fleet Services Ltd");
  });
  expect(created).toMatchObject({ address: "88 Formal Company Road, Kingston", birthDate: null, gender: null });
  const customerId = (created as { id?: unknown } | undefined)?.id;
  expect(typeof customerId).toBe("string");
  await page.goto(`/customers/${customerId}`);
  await expect(page.getByTestId("verification-row-otp")).toContainText("待补验证");
  await expect(page.getByTestId("verification-row-otp")).toContainText("尚未验证");
  await expect(page.getByTestId("verification-row-kyc")).toContainText("企业主要联系人驾驶证待补");
});

test("organization primary contact licence can be completed without copying contact identity into company fields", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", { licenseExtraction: { kind: "result", result: EXTRACTION_RESULT } });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-customer-type").selectOption("organization");
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0197");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-organization-name").fill("Contact Licence Fleet Ltd");
  await page.getByTestId("onboarding-address").fill("99 Formal Company Avenue, Kingston");
  await completeLicence(page);
  await expect(page.getByTestId("onboarding-address")).toHaveValue("99 Formal Company Avenue, Kingston");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  const created = await page.evaluate(() => {
    const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
    if (!raw) throw new Error("missing customer storage");
    const envelope = JSON.parse(raw) as { state: { customers: Array<Record<string, unknown>> } };
    return envelope.state.customers.find((customer) => customer.organizationName === "Contact Licence Fleet Ltd");
  });
  expect(created).toMatchObject({
    address: "99 Formal Company Avenue, Kingston",
    birthDate: null,
    gender: null,
    verificationArchive: {
      kycRecords: [expect.objectContaining({
        subjectType: "organization_primary_contact",
        subjectProfile: EXTRACTION_RESULT.profile,
      })],
    },
  });
});

test("final secondary and WhatsApp phone ownership conflicts show safe owner links and no create path", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0198");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-name-source").fill("Alicia Bennett");
  await page.getByTestId("customer-name-transliteration-confirm").click();

  await page.getByTestId("onboarding-secondary-phone").fill("+1 876 555 0101");
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-phone-ownership-conflict")).toContainText("Alicia Bennett");
  await expect(page.getByTestId("onboarding-preview-existing-customer-CUST-UAT-001")).toHaveAttribute("href", "/customers/CUST-UAT-001");
  await expect(page.getByTestId("onboarding-create")).toBeDisabled();
  await expect(page.getByTestId("onboarding-profile-step")).not.toContainText("最终预览已生成");

  await page.getByTestId("onboarding-secondary-phone").fill("");
  await page.getByTestId("onboarding-whatsapp").fill("+1 876 555 0102");
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-preview-existing-customer-CUST-UAT-002")).toBeVisible();
  await expect(page.getByTestId("onboarding-create")).toBeDisabled();

  await page.getByTestId("onboarding-whatsapp").fill("");
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-phone-ownership-conflict")).toHaveCount(0);
  await expect(page.getByTestId("customer-duplicate-candidates")).toBeVisible();
  await expect(page.getByTestId("confirm-customer-duplicate")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-create")).toBeEnabled();
});

test("default unavailable extraction appears only after the explicit action and preserves manual values for retry", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0177");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await page.getByTestId("onboarding-license-name").fill("Manual Alicia");
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-extraction-status"))
    .toHaveText("AI辅助识别当前不可用，请对照原件手动填写");
  await expect(page.getByTestId("onboarding-license-extract"))
    .toHaveText("重新尝试AI辅助识别");
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Manual Alicia");
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Manual Alicia");
  await page.getByTestId("onboarding-license-birth-date").fill("1988-03-22");
  await page.getByTestId("onboarding-license-sex").selectOption("F");
  await page.getByTestId("onboarding-license-address").fill("12 Constant Spring Road");
  await page.getByTestId("onboarding-license-attestation").check();
  await expect(page.getByTestId("onboarding-kyc-status")).toContainText("驾驶证已人工核验");
});

test("upload, AI mode selection, rotation, and crop never extract until the explicit action", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", { licenseExtraction: { kind: "result", result: EXTRACTION_RESULT } });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0176");
  await page.getByTestId("onboarding-license-mode-manual").click();
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await page.getByTestId("onboarding-license-mode-ai").click();
  await expect(page.getByTestId("onboarding-license-mode-ai"))
    .toContainText("选择后使用下方AI辅助识别按钮");
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await page.getByTestId("onboarding-license-rotate-left").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await page.getByTestId("onboarding-crop-left-number").fill("0.1");
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
  await expect(page.getByTestId("onboarding-extraction-status"))
    .toContainText("模拟 AI 辅助结果（仅演示）");
});

test("AI extraction stays unavailable until the current evidence preparation succeeds", async ({ page }) => {
  await page.addInitScript(({ targetName, releaseEvent }) => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function arrayBuffer() {
      if (this.name !== targetName) return originalArrayBuffer.call(this);
      const file = this;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        window.addEventListener(releaseEvent, () => {
          originalArrayBuffer.call(file).then(resolve, reject);
        }, { once: true });
      });
    };
  }, {
    targetName: path.basename(SYNTHETIC_LICENSE),
    releaseEvent: DEFERRED_EVIDENCE_RELEASE_EVENT,
  });
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "result", result: EXTRACTION_RESULT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0174");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);

  await expect(page.getByTestId("onboarding-license-extract")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await expect(page.getByTestId("onboarding-extraction-status")).toHaveCount(0);

  await releaseDeferredEvidence(page);
  await expect(page.getByTestId("onboarding-license-extract")).toBeVisible();
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
});

test("reselecting either current licence mode is a no-op and actual mode changes preserve manual fields", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0172");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-name").fill("Manual Alicia");
  await page.getByTestId("onboarding-license-birth-date").fill("1988-03-22");
  await page.getByTestId("onboarding-license-sex").selectOption("F");
  await page.getByTestId("onboarding-license-address").fill("Manual address");

  const expectManualFields = async () => {
    await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Manual Alicia");
    await expect(page.getByTestId("onboarding-license-birth-date")).toHaveValue("1988-03-22");
    await expect(page.getByTestId("onboarding-license-sex")).toHaveValue("F");
    await expect(page.getByTestId("onboarding-license-address")).toHaveValue("Manual address");
  };

  await page.getByTestId("onboarding-license-mode-ai").click();
  await expect(page.getByTestId("onboarding-license-mode-ai")).toHaveAttribute("aria-pressed", "true");
  await expectManualFields();

  await page.getByTestId("onboarding-license-mode-manual").click();
  await expect(page.getByTestId("onboarding-license-mode-manual")).toHaveAttribute("aria-pressed", "true");
  await expectManualFields();

  await page.getByTestId("onboarding-license-mode-manual").click();
  await expectManualFields();
});

test("damaged, byte-oversized, and pixel-oversized images never reach the extraction client", async ({ page }) => {
  await page.addInitScript(() => {
    const originalCreateImageBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((image: ImageBitmapSource) => {
      if (image instanceof File && image.name === "pixel-overflow.png") {
        return Promise.resolve({
          width: 6001,
          height: 4000,
          close: () => {
            const browser = window as Window & { __WH_LICENSE_DECODE_CLOSES__?: number };
            browser.__WH_LICENSE_DECODE_CLOSES__ = (browser.__WH_LICENSE_DECODE_CLOSES__ ?? 0) + 1;
          },
        } as ImageBitmap);
      }
      return originalCreateImageBitmap(image);
    }) as typeof window.createImageBitmap;
  });
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: {
      kind: "result",
      result: EXTRACTION_RESULT,
      attempts: [
        { delayMs: 0, result: EXTRACTION_RESULT },
        { delayMs: 80, result: LATEST_EXTRACTION_RESULT },
      ],
    },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0173");

  for (const file of [
    { name: "magic-only.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    { name: "magic-only.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) },
    { name: "byte-overflow.png", mimeType: "image/png", buffer: Buffer.alloc(12 * 1024 * 1024 + 1) },
    { name: "pixel-overflow.png", mimeType: "image/png", buffer: SYNTHETIC_LICENSE_BYTES },
  ]) {
    await page.getByTestId("onboarding-license-file").setInputFiles(file);
    await expect(page.getByTestId("onboarding-license-error")).toBeVisible();
    await expect(page.getByTestId("onboarding-license-extract")).toHaveCount(0);
    await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
    await expect(page.getByTestId("onboarding-extraction-status")).toHaveCount(0);
  }

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __WH_LICENSE_DECODE_CLOSES__?: number }
  ).__WH_LICENSE_DECODE_CLOSES__ ?? 0)).toBe(1);

  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
  await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 120)));
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
});

test("partial Mock AI result fills only safe fields and marks the rest for manual entry", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "result", result: PARTIAL_EXTRACTION_RESULT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0175");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-birth-date").fill("1980-01-02");
  await page.getByTestId("onboarding-license-address").fill("Manual address");
  await page.getByTestId("onboarding-license-extract").click();

  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
  await expect(page.getByTestId("onboarding-license-birth-date")).toHaveValue("1980-01-02");
  await expect(page.getByTestId("onboarding-license-sex")).toHaveValue("");
  await expect(page.getByTestId("onboarding-license-address")).toHaveValue("Manual address");
  await expect(page.getByTestId("onboarding-extraction-status"))
    .toContainText("模拟 AI 辅助结果（仅演示）");
  await expect(page.getByTestId("onboarding-license-step").getByText("请人工填写"))
    .toHaveCount(3);
});

test("one explicit extraction button click invokes exactly one Mock attempt", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: {
      kind: "result",
      result: EXTRACTION_RESULT,
      attempts: [
        { delayMs: 0, result: EXTRACTION_RESULT },
        { delayMs: 80, result: LATEST_EXTRACTION_RESULT },
      ],
    },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0171");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
  await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 120)));
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
});

test("individual can preview without licence and the flow exposes no tags or first-vehicle fields", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0166");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-name-source").fill("顾明轩");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await expect(page.getByTestId("onboarding-preview")).toBeEnabled();
  await expect(page.getByTestId("form-customer-tags")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-first-vehicle")).toHaveCount(0);
});

test("changing a verified phone invalidates downstream steps and checks the replacement number", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", { licenseExtraction: { kind: "result", result: EXTRACTION_RESULT } });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0155");
  await completeLicence(page);
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0144");
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("请填写主要号码（必填），然后查询");
  await expect(page.getByTestId("onboarding-send-otp")).toBeDisabled();
  await expect(page.getByTestId("onboarding-license-editor")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-license-file")).toBeDisabled();
});

test("editing the phone keeps one check in flight, closes its late token, and releases busy after that request", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0154");

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="onboarding-check-phone"]');
    const input = document.querySelector<HTMLInputElement>('[data-testid="onboarding-phone"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!button || !input || !setValue) throw new Error("missing phone race controls");
    button.click();
    setValue.call(input, "+1 876 555 0153");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  });

  await expect(page.getByTestId("onboarding-phone")).toHaveValue("+1 876 555 0153");
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("请填写主要号码（必填），然后查询");
  await expect(page.getByTestId("onboarding-check-phone")).toBeDisabled();
  await expect(page.getByTestId("onboarding-cancel")).toBeDisabled();

  await expect(page.getByTestId("onboarding-check-phone")).toBeEnabled({ timeout: 2_000 });
  await expect(page.getByTestId("onboarding-cancel")).toBeEnabled();
  await page.getByTestId("onboarding-check-phone").click();
  await expect(page.getByTestId("onboarding-send-otp")).toBeEnabled();
});

test("running starts at zero, disables attestation, and manual editing cancels the late result", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "deferred", result: EXTRACTION_RESULT, releaseEvent: DEFERRED_EXTRACTION_RELEASE_EVENT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0152");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-name").fill("Manual before extraction");
  await page.getByTestId("onboarding-license-birth-date").fill("1988-03-22");
  await page.getByTestId("onboarding-license-sex").selectOption("F");
  await page.getByTestId("onboarding-license-address").fill("Manual address");
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-extraction-progress")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByTestId("onboarding-license-extract")).toHaveText("识别中…");
  await expect(page.getByTestId("onboarding-license-attestation")).toBeDisabled();

  await page.getByTestId("onboarding-license-name").fill("Manual Alicia");
  await expect(page.getByTestId("onboarding-extraction-progress")).toHaveCount(0);
  await releaseDeferredExtraction(page);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Manual Alicia");
  await expect(page.getByTestId("onboarding-license-attestation")).not.toBeChecked();
  await expect(page.getByTestId("onboarding-kyc-status")).not.toContainText("驾驶证已人工核验");
});

test("image, rotation, crop, and mode changes each invalidate an active extraction", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "deferred", result: LATEST_EXTRACTION_RESULT, releaseEvent: DEFERRED_EXTRACTION_RELEASE_EVENT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0151");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);

  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-extraction-progress")).toBeVisible();
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await releaseDeferredExtraction(page);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");

  await page.getByTestId("onboarding-license-extract").click();
  await page.getByTestId("onboarding-license-rotate-left").click();
  await releaseDeferredExtraction(page);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");

  await page.getByTestId("onboarding-license-extract").click();
  await page.getByTestId("onboarding-crop-left-number").fill("0.1");
  await releaseDeferredExtraction(page);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");

  await page.getByTestId("onboarding-license-name").fill("Manual Alicia");
  await page.getByTestId("onboarding-license-birth-date").fill("1988-03-22");
  await page.getByTestId("onboarding-license-sex").selectOption("F");
  await page.getByTestId("onboarding-license-address").fill("Manual address");
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-extraction-progress")).toBeVisible();
  await page.getByTestId("onboarding-license-mode-manual").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Manual Alicia");
  await expect(page.getByTestId("onboarding-license-birth-date")).toHaveValue("1988-03-22");
  await expect(page.getByTestId("onboarding-license-sex")).toHaveValue("F");
  await expect(page.getByTestId("onboarding-license-address")).toHaveValue("Manual address");
  await releaseDeferredExtraction(page);
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Manual Alicia");
  await expect(page.getByTestId("onboarding-license-birth-date")).toHaveValue("1988-03-22");
  await expect(page.getByTestId("onboarding-license-sex")).toHaveValue("F");
  await expect(page.getByTestId("onboarding-license-address")).toHaveValue("Manual address");
});

test("changing licence evidence clears all derived PII but preserves unrelated contact fields", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", { licenseExtraction: { kind: "result", result: EXTRACTION_RESULT } });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0150");
  await completeLicence(page);
  await page.getByTestId("onboarding-email").fill("keep-contact@example.test");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-profile-step")).toContainText("最终预览已生成");
  await expect(page.getByTestId("onboarding-name-source")).toHaveValue("Alicia Bennett");
  await expect(page.getByTestId("onboarding-profile-birth-date")).toHaveValue("1988-03-22");
  await expect(page.getByTestId("onboarding-profile-gender")).toHaveValue("女");
  await expect(page.getByTestId("onboarding-address")).toHaveValue("12 Constant Spring Road, Kingston 8, Jamaica");

  await page.getByTestId("onboarding-license-rotate-left").click();
  await expect(page.getByTestId("onboarding-kyc-status")).toContainText("等待员工确认");
  await expect(page.getByTestId("onboarding-license-attestation")).not.toBeChecked();
  await expect(page.getByTestId("onboarding-profile-step")).not.toContainText("最终预览已生成");
  await expect(page.getByTestId("customer-duplicate-candidates")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-preview")).toBeDisabled();
  await expect(page.getByTestId("onboarding-name-source")).toHaveValue("");
  await expect(page.getByTestId("onboarding-profile-birth-date")).toHaveValue("");
  await expect(page.getByTestId("onboarding-profile-gender")).toHaveValue("");
  await expect(page.getByTestId("onboarding-address")).toHaveValue("");
  await expect(page.getByTestId("onboarding-email")).toHaveValue("keep-contact@example.test");
});

test("transforming verified licence evidence creates only the missing-evidence reminder and no KYC record", async ({ page }) => {
  const phone = "+1 876 555 0147";
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "result", result: EXTRACTION_RESULT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, phone);
  await completeLicence(page);

  await page.getByTestId("onboarding-license-rotate-left").click();
  await page.getByTestId("onboarding-name-source").fill("Alicia Bennett");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-reminders")).toContainText("驾驶证证据未提交");
  await expect(page.getByTestId("onboarding-reminders")).not.toContainText("验证码");
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);

  const customerId = await findCustomerIdByPhone(page, phone);
  const verificationArchive = await page.evaluate((id) => {
    const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
    if (!raw) throw new Error("missing customer storage");
    const envelope = JSON.parse(raw) as {
      state: {
        customers: Array<{
          id: string;
          verificationArchive: {
            otpRecords: Array<{ verifiedAt?: string }>;
            kycRecords: unknown[];
            evidenceGaps: Array<{ kind: string; status: string }>;
          };
        }>;
      };
    };
    return envelope.state.customers.find((customer) => customer.id === id)?.verificationArchive ?? null;
  }, customerId);
  expect(verificationArchive?.otpRecords).toEqual([
    expect.objectContaining({ verifiedAt: expect.any(String) }),
  ]);
  expect(verificationArchive?.kycRecords).toEqual([]);
  expect(verificationArchive?.evidenceGaps).toContainEqual(
    expect.objectContaining({ kind: "kyc", status: "evidence_missing" }),
  );
});

test("cancelling confirmed licence evidence clears only token KYC and keeps verified OTP usable", async ({ page }) => {
  const phone = "+1 876 555 0148";
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "result", result: EXTRACTION_RESULT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, phone);
  await completeLicence(page);

  await page.getByTestId("onboarding-license-attestation").uncheck();
  await expect(page.getByTestId("onboarding-kyc-status")).not.toContainText("驾驶证已人工核验");
  await page.getByTestId("onboarding-name-source").fill("Alicia Bennett");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();

  await expect(page.getByTestId("onboarding-reminders")).toContainText("驾驶证证据未提交");
  await expect(page.getByTestId("onboarding-reminders")).not.toContainText("验证码");
  await expect(page.getByTestId("onboarding-create")).toBeEnabled();
  await page.getByTestId("onboarding-create").click();
  const customerId = await findCustomerIdByPhone(page, phone);
  await page.getByTestId(`customer-row-${customerId}`).click();
  await expect(page.getByTestId("customer-otp-evidence-card")).toContainText("已验证");
  await expect(page.getByTestId("customer-kyc-evidence-card")).toContainText("待补");
});

test("dirty close and cancel require explicit discard while clean cancel closes", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-cancel").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0133");
  await page.getByTestId("onboarding-close").click();
  await expect(page.getByTestId("onboarding-discard-confirmation")).toBeVisible();
  await page.getByTestId("onboarding-continue-editing").click();
  await expect(page.getByTestId("onboarding-phone")).toHaveValue("+1 876 555 0133");
  await page.getByTestId("onboarding-cancel").click();
  await page.getByTestId("onboarding-discard-changes").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
});

test("discarding the dialog invalidates an active extraction before it can publish PII", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "deferred", result: EXTRACTION_RESULT, releaseEvent: DEFERRED_EXTRACTION_RELEASE_EVENT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0132");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-extraction-progress")).toBeVisible();

  await page.getByTestId("onboarding-close").click();
  await page.getByTestId("onboarding-discard-changes").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  await releaseDeferredExtraction(page);
  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await expect(page.getByTestId("onboarding-license-editor")).toHaveCount(0);
});

test("save failure preserves preview and evidence for same-path retry", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "result", result: EXTRACTION_RESULT },
    failNext: { customerVehicleSave: "演示建档保存失败" },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0122");
  await completeLicence(page);
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("confirm-customer-duplicate")).toHaveCount(0);
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("onboarding-save-error")).toContainText("演示建档保存失败");
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
  await expect(page.getByTestId("onboarding-create")).toBeEnabled();
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
});

test("source revision conflict clears only the stale final preview and succeeds after a fresh preview", async ({ page }) => {
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");

  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0195");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-name-source").fill("赵明轩");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);

  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0119");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-name-source").fill("顾明轩");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-profile-step")).toContainText("最终预览已生成");

  await page.evaluate(() => {
    const key = "wh_customer_vehicle_mock_v1";
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("missing persisted source conflict fixture");
    const envelope = JSON.parse(raw) as { state: { sourceRevision: number } };
    envelope.state.sourceRevision += 1;
    localStorage.setItem(key, JSON.stringify(envelope));
  });
  await page.getByTestId("onboarding-create").click();

  await expect(page.getByTestId("onboarding-save-error")).toContainText("源数据已变化，请重新预览");
  await expect(page.getByTestId("onboarding-profile-step")).not.toContainText("最终预览已生成");
  await expect(page.getByTestId("onboarding-create")).toBeDisabled();
  await expect(page.getByTestId("onboarding-preview")).toBeEnabled();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-profile-step")).toContainText("最终预览已生成");
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  await expect(page.getByTestId(`customer-row-${await findCustomerIdByPhone(page, "+1 876 555 0119")}`)).toBeVisible();
});

test("pending create is immutable and its response-loss retry creates exactly one customer", async ({ page }) => {
  const phone = "+1 876 555 0121";
  await useOnboardingIdentity(page, "superadmin", {
    delayMs: { customerVehicleSave: 1_200 },
    failNext: { customerOnboardingCreateResponse: "演示建档响应丢失" },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-customer-type").selectOption("organization");
  await verifyPhone(page, phone);
  await page.getByTestId("onboarding-organization-name").fill("Pending Create Fleet Ltd");
  await page.getByTestId("onboarding-name-source").fill("赵明轩");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("onboarding-profile-step")).toContainText("最终预览已生成");

  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("onboarding-phone")).toBeDisabled();
  await expect(page.getByTestId("onboarding-phone")).toHaveValue(phone);
  await expect(page.getByTestId("onboarding-create")).toBeDisabled();

  await expect(page.getByTestId("onboarding-save-error")).toContainText("演示建档响应丢失");
  await expect(page.getByTestId("onboarding-profile-step")).toContainText("最终预览已生成");
  await expect(page.getByTestId("onboarding-phone")).toHaveValue(phone);
  await expect(page.getByTestId("onboarding-create")).toBeEnabled();
  await page.getByTestId("onboarding-create").click();

  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0, { timeout: 5_000 });
  const customerId = await findCustomerIdByPhone(page, phone);
  await expect(page.getByTestId(`customer-row-${customerId}`)).toBeVisible();
  const createdWithPhone = await page.evaluate((expectedPhone) => {
    const raw = localStorage.getItem("wh_customer_vehicle_mock_v1");
    if (!raw) throw new Error("missing customer storage");
    const envelope = JSON.parse(raw) as { state: { customers: Array<{ phone: string | null }> } };
    return envelope.state.customers.filter((customer) => customer.phone === expectedPhone).length;
  }, "+18765550121");
  expect(createdWithPhone).toBe(1);
});

test("session switch closes onboarding during pending extraction and its late PII never enters the new session", async ({ page }) => {
  await page.addInitScript(() => {
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    (window as typeof window & { __WH_REVOKED_ONBOARDING_URLS__?: string[] })
      .__WH_REVOKED_ONBOARDING_URLS__ = [];
    URL.revokeObjectURL = (url: string) => {
      (window as typeof window & { __WH_REVOKED_ONBOARDING_URLS__?: string[] })
        .__WH_REVOKED_ONBOARDING_URLS__?.push(url);
      originalRevoke(url);
    };
  });
  await useOnboardingIdentity(page, "superadmin", {
    licenseExtraction: { kind: "deferred", result: EXTRACTION_RESULT, releaseEvent: DEFERRED_EXTRACTION_RELEASE_EVENT },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await verifyPhone(page, "+1 876 555 0111");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-extract").click();
  await expect(page.getByTestId("onboarding-extraction-progress")).toBeVisible();
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem("wh_session")!);
    localStorage.setItem("wh_session", JSON.stringify({ ...current, identity: { ...current.identity, id: "revoked-test-session", role: "superadmin" } }));
    window.history.pushState({}, "", `${location.pathname}?identity-switch=1`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __WH_REVOKED_ONBOARDING_URLS__?: string[] })
      .__WH_REVOKED_ONBOARDING_URLS__?.length ?? 0
  ))).toBeGreaterThan(0);
  await releaseDeferredExtraction(page);
  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("onboarding-phone")).toHaveValue("");
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
  await expect(page.getByTestId("onboarding-license-editor")).toHaveCount(0);
});

test("430px keeps the staged dialog within the viewport and focuses the OTP input", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await useOnboardingIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0196");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-send-otp").click();
  await expect(page.getByTestId("onboarding-otp-code")).toBeFocused();
  await page.getByTestId("onboarding-otp-code").fill("123456");
  await page.getByTestId("onboarding-verify-otp").click();
  await expect(page.getByTestId("onboarding-phone-status")).toContainText("号码已验证");
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await expect(page.getByTestId("onboarding-license-extract")).toBeVisible();
  await expect(page.getByTestId("onboarding-license-extract")).toBeEnabled();
  await page.getByTestId("onboarding-license-name").fill("Mobile Alicia");
  await page.getByTestId("onboarding-license-birth-date").fill("1988-03-22");
  await page.getByTestId("onboarding-license-sex").selectOption("F");
  await page.getByTestId("onboarding-license-address").fill("Mobile address");
  await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Mobile Alicia");
  await expect(page.getByTestId("onboarding-license-address")).toHaveValue("Mobile address");
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("onboarding-footer")).toBeVisible();
});
