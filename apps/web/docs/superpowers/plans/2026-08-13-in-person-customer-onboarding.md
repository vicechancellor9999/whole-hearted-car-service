# In-Person Customer Onboarding Implementation Plan

> **2026-08-14 — SUPERSEDED / 已废止：** 本文基于浏览器本机 Tesseract／local OCR 的 Tasks 1–3、7、8
> 已由 `docs/superpowers/plans/2026-08-14-external-ai-license-extraction-frontend.md` 取代，**不得执行**。
> 当前边界与验收以 `docs/superpowers/specs/2026-08-13-in-person-customer-onboarding-design.md`
> 的 2026-08-14 修订及上述新计划为准；下文仅保留为历史实施记录。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the create-customer form with a staged, in-person flow that blocks duplicate phone numbers before OTP, locally recognizes four driver-license fields, records employee confirmation, and creates one complete customer with verified OTP/KYC in one atomic Mock-store write.

**Approved spec:** `docs/superpowers/specs/2026-08-13-in-person-customer-onboarding-design.md`

**Architecture:** Keep unfinished onboarding in an actor-bound, expiring in-memory registry rather than creating a temporary customer or changing persisted schema v3. A browser-only OCR adapter reads four fixed regions with locally hosted Tesseract assets and returns a four-field safe DTO; the final store mutation rechecks the phone and all receipts, then persists the customer, evidence, audit events, and create receipt exactly once.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Mock API/store, Playwright unit/E2E, Tesseract.js 7.0.0 with same-origin worker/core/English data, existing Tailwind/dialog/evidence/name-transliteration primitives.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Keep all generated files and growing caches under `/Volumes/公司文件`; do not create persistent copies on Macintosh HD.
- Remain Mock-only: no real SMS, database, object storage, translation API, OCR API, CDN fallback, or external runtime request.
- The phone order is fixed: normalize → search `phone`/`secondaryPhone`/`whatsapp` → only if clear request OTP → verify OTP.
- A phone match can never be overridden; name, Email, or organization candidates retain explicit duplicate confirmation.
- Individual creation requires a driver-license JPEG/PNG evidence asset and employee confirmation of name, birth date, sex, and address. OCR failure may fall back to manual entry against that same license; absence of a license blocks individual creation.
- Organization creation requires phone lookup/OTP but no driver-license KYC.
- OCR may produce only `name`, `birthDate`, `sex`, and `address`; never persist raw OCR, confidence, blocks, coordinates, processed images, or forbidden license fields.
- Final create performs one state `persist()` only. A failure leaves customers, audits, receipts, revision, and raw storage unchanged and keeps the in-memory attempt retryable.
- Do not add tags, a first-vehicle relationship, multi-contact UI, PDF license input, or a persisted onboarding-draft schema.
- Preserve existing edit-customer behavior and the post-create re-OTP/re-KYC/evidence retrieval flows.
- Every page-behavior change updates E2E and must pass the full E2E suite plus desktop and 430 px visual QA.

---

## File Structure

- `src/lib/customers/onboarding-types.ts`: public onboarding DTOs and exact stage/input/result unions; no OCR raw types.
- `src/lib/customers/onboarding-domain.ts`: pure all-field phone matching and confirmed-profile equality; no storage or token state.
- `src/lib/customers/license-ocr/types.ts`: safe four-field recognition DTO and internal adapter boundary.
- `src/lib/customers/license-ocr/jamaica-dl-front-v1.ts`: pure Jamaican-license field normalization, ROIs, and confidence gates.
- `src/lib/customers/license-ocr/tesseract-adapter.ts`: browser-only Tesseract worker lifecycle, fixed ROI execution, cancellation, timeout, and local paths.
- `src/lib/customers/license-ocr/image-input.ts`: input signature/size/decode checks, orientation/crop workspace, and compressed KYC evidence preparation.
- `src/lib/customers/license-ocr/browser-adapter.ts`: real-adapter default and strictly typed deterministic E2E injection.
- `src/lib/customers/ocr-asset-manifest.ts`: pinned static OCR filenames, SHA-256 values, licenses, and runtime paths.
- `src/lib/customers/ocr-asset-hashes.generated.ts`: script-generated exact static-asset URL, byte-count, and SHA-256 literals.
- `scripts/sync-customer-ocr-assets.mjs`: deterministic copy/check script from locked npm packages into `public/ocr/tesseract-v7/`.
- `src/components/customers/customer-onboarding-state.ts`: pure UI reducer and receipt-invalidation rules.
- `src/components/customers/customer-onboarding-dialog.tsx`: orchestration state machine, dirty-close/session cleanup, and final save.
- `src/components/customers/onboarding-phone-step.tsx`: phone lookup, existing-customer stop state, OTP request/verify.
- `src/components/customers/onboarding-license-step.tsx`: upload/camera, rotate/crop, OCR progress, four-field edit and employee attestation.
- `src/components/customers/license-image-editor.tsx`: pointer and keyboard crop/rotation controls over the local preview.
- `src/components/customers/onboarding-profile-step.tsx`: organization/manual details, single-source name, transliteration, non-phone duplicates, final review.
- Existing `CustomerFormDialog` remains the edit form; create entry points switch to `CustomerOnboardingDialog`.

---

### Task 1: Pin and self-host the OCR runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/sync-customer-ocr-assets.mjs`
- Create: `src/lib/customers/ocr-asset-manifest.ts`
- Create: `src/lib/customers/ocr-asset-hashes.generated.ts`
- Create: `tests/collaboration/customer-ocr-assets.test.mjs`
- Create: `public/ocr/tesseract-v7/THIRD_PARTY_NOTICES.md`
- Create: `public/ocr/tesseract-v7/worker.min.js`
- Create: `public/ocr/tesseract-v7/core/*`
- Create: `public/ocr/tesseract-v7/lang/eng.traineddata.gz`

**Interfaces:**
- Consumes: npm packages `tesseract.js@7.0.0`, `tesseract.js-core@7.0.0`, `@tesseract.js-data/eng@1.0.0`.
- Produces: `CUSTOMER_OCR_ASSETS`, deterministic `sync`/`--check` script modes, and same-origin paths used by Task 3.

- [ ] **Step 1: Write the collaboration test before installing dependencies**

```js
test("customer OCR assets are pinned, local, licensed, and hash exact", async () => {
  const check = spawnSync(process.execPath, ["scripts/sync-customer-ocr-assets.mjs", "--check"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  const manifestSource = await readFile("src/lib/customers/ocr-asset-hashes.generated.ts", "utf8");
  assert.match(manifestSource, /\/ocr\/tesseract-v7\//);
  assert.doesNotMatch(await readProjectSources(), /cdn\.jsdelivr|tessdata\.projectnaptha|unpkg\.com/);
});
```

In this test, `readProjectSources()` recursively reads only first-party runtime files under `src/` and `scripts/` with extensions `.ts`, `.tsx`, `.js`, or `.mjs`. It explicitly excludes `node_modules/`, `public/ocr/`, source maps, docs/specs/plans, notices/licenses, `.next*`, and QA output; vendored upstream text is governed by the exact hash/manifest check instead.

- [ ] **Step 2: Run the RED collaboration test**

Run: `node --test tests/collaboration/customer-ocr-assets.test.mjs`

Expected: FAIL because the manifest and local assets do not exist.

- [ ] **Step 3: Install exact dependencies and implement deterministic asset sync**

Run: `npm_config_cache=/Volumes/公司文件/CodexData/npm-cache npm install --save-exact tesseract.js@7.0.0 tesseract.js-core@7.0.0 @tesseract.js-data/eng@1.0.0`

The sync script must copy the browser worker, all three LSTM core variants used by Tesseract 7 (`tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`, and `tesseract-core-relaxedsimd-lstm.wasm.js`), and `4.0.0_best_int/eng.traineddata.gz`; compute SHA-256 after every copy; reject missing or unexpected files; and write no cache outside the external-volume workspace. The manifest also records exact npm package versions/tarball integrity, upstream source and commit for the language file, Apache-2.0 notices for Tesseract/Tesseract.js/core, and the MIT notice shipped by `@tesseract.js-data/eng`. Missing relaxed-SIMD, a missing license notice, or an unregistered extra file is a test failure.

```ts
import { CUSTOMER_OCR_ASSET_HASHES } from "./ocr-asset-hashes.generated";

export const CUSTOMER_OCR_ASSETS = Object.freeze({
  version: "tesseract-v7",
  workerPath: "/ocr/tesseract-v7/worker.min.js",
  corePath: "/ocr/tesseract-v7/core/",
  langPath: "/ocr/tesseract-v7/lang/",
  files: Object.freeze(CUSTOMER_OCR_ASSET_HASHES),
});
```

`CUSTOMER_OCR_ASSET_HASHES` lives in `ocr-asset-hashes.generated.ts`. The sync script writes that file only in explicit sync mode, adds a package script named `sync:customer-ocr-assets`, and in `--check` mode compares freshly calculated URL/byte-count/SHA-256 literals byte-for-byte without rewriting tracked files. Do not run the sync script from a browser bundle or copy from an unlocked/global package path.

- [ ] **Step 4: Verify assets, runtime-link ban, and installed package versions**

Run: `node scripts/sync-customer-ocr-assets.mjs --check && node --test tests/collaboration/customer-ocr-assets.test.mjs && npm run test:collaboration`

Expected: all pass; `git diff --check` reports no whitespace error.

- [ ] **Step 5: Commit the isolated runtime boundary**

Before staging, run `npm run typecheck && npm run test:collaboration && git diff --check`; all must pass on the exact files being committed.

```bash
git add package.json package-lock.json scripts/sync-customer-ocr-assets.mjs src/lib/customers/ocr-asset-manifest.ts src/lib/customers/ocr-asset-hashes.generated.ts tests/collaboration/customer-ocr-assets.test.mjs public/ocr/tesseract-v7
git commit -m "build(customers): self-host customer OCR runtime"
```

---

### Task 2: Implement the four-field license parser

**Files:**
- Create: `src/lib/customers/license-ocr/types.ts`
- Create: `src/lib/customers/license-ocr/jamaica-dl-front-v1.ts`
- Create: `tests/unit/customer-license-ocr.spec.ts`

**Interfaces:**
- Consumes: four ephemeral ROI samples and fixed non-personal anchor results.
- Produces:

```ts
export type DriverLicenseField = "name" | "birthDate" | "sex" | "address";
export type LicenseOcrErrorCode =
  | "OCR_INPUT_UNSUPPORTED"
  | "OCR_IMAGE_TOO_LARGE"
  | "OCR_ENGINE_UNAVAILABLE"
  | "OCR_TEMPLATE_UNSUPPORTED"
  | "OCR_FIELD_MANUAL_REQUIRED"
  | "OCR_TIMEOUT"
  | "OCR_CANCELLED";
export class LicenseOcrError extends Error {
  constructor(readonly code: LicenseOcrErrorCode, message: string) { super(message); }
}
export interface DriverLicenseProfile {
  readonly name: string;
  readonly birthDate: string;
  readonly sex: "M" | "F" | "";
  readonly address: string;
}
export interface DriverLicenseRecognitionResult {
  readonly template: "jamaica-dl-front-v1";
  readonly profile: DriverLicenseProfile;
  readonly status: Readonly<Record<DriverLicenseField, "recognized" | "manual_required">>;
}
export interface PreparedLicenseEvidence {
  readonly id: string;
  readonly fileName: string;
  readonly url: string;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly sizeBytes: number;
}
```

`license-ocr/types.ts` exports only the safe types above. In `jamaica-dl-front-v1.ts`, define `/** @internal */ export interface JamaicaLicenseOcrSamples` with exactly six anchor `{ text, confidence }` entries and four value `{ text, confidence }` entries, and export `parseJamaicaDriverLicenseV1(input: JamaicaLicenseOcrSamples)` only for the parser/adapter/unit-test boundary. Do not re-export that raw-sample type from an index/barrel, import it from components/API/store, or include it in any response.

- [ ] **Step 1: Write RED parser tests**

```ts
test("parser returns exactly the approved four fields", () => {
  const result = parseJamaicaDriverLicenseV1(cleanSyntheticSamples());
  expect(Object.keys(result.profile).sort()).toEqual(["address", "birthDate", "name", "sex"]);
  expect(JSON.stringify(result)).not.toMatch(/TRN|CLASS|EXPIRY|COLLECTORATE|rawText|confidence/i);
});

test("low-confidence or invalid fields are blank, never guessed", () => {
  const result = parseJamaicaDriverLicenseV1(samplesWithInvalidDateAndUnknownSex());
  expect(result.profile.birthDate).toBe("");
  expect(result.profile.sex).toBe("");
  expect(result.status.birthDate).toBe("manual_required");
});
```

Also cover missing anchors, non-future Gregorian dates, hyphens/apostrophes in names, address line order, control characters, length caps, and a compile-time assertion that forbidden fields cannot be assigned.

- [ ] **Step 2: Run the RED parser suite**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-ocr.spec.ts`

Expected: FAIL because the parser modules do not exist.

- [ ] **Step 3: Implement versioned template and normalization**

```ts
const JAMAICA_DL_FRONT_V1 = Object.freeze({
  anchors: ["GOVERNMENT OF JAMAICA", "DRIVER'S LICENCE", "NAME", "BIRTH DATE", "SEX", "ADDRESS"],
  confidence: { name: 82, birthDate: 88, sex: 92, address: 78 },
  maxLength: { name: 120, birthDate: 10, sex: 1, address: 320 },
  regions: {
    anchors: {
      government: { x: 0.08, y: 0.03, width: 0.57, height: 0.08 },
      licence: { x: 0.11, y: 0.10, width: 0.55, height: 0.09 },
      name: { x: 0.02, y: 0.53, width: 0.28, height: 0.08 },
      birthDate: { x: 0.28, y: 0.43, width: 0.18, height: 0.08 },
      sex: { x: 0.50, y: 0.43, width: 0.10, height: 0.08 },
      address: { x: 0.02, y: 0.69, width: 0.18, height: 0.08 },
    },
    values: {
      name: { x: 0.02, y: 0.58, width: 0.58, height: 0.14 },
      birthDate: { x: 0.28, y: 0.48, width: 0.22, height: 0.10 },
      sex: { x: 0.50, y: 0.48, width: 0.10, height: 0.10 },
      address: { x: 0.02, y: 0.75, width: 0.58, height: 0.22 },
    },
  },
});
```

The six label ROIs and four value ROIs are the only ten OCR calls. Allow the exact OCR spelling variant `DRIVER'S LICENSE` while retaining the same template version. Keep `JamaicaLicenseOcrSamples` internal to the parser/adapter/test boundary. Export only the safe four-field result. Never include raw OCR in thrown errors. Calibrate these committed normalized coordinates only against the watermarked synthetic fixture; if calibration changes a coordinate or threshold, update the parser unit fixture and real-worker E2E in the same commit rather than adding alternate magic coordinates in the component.

- [ ] **Step 4: Run parser tests and typecheck**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-ocr.spec.ts && npm run typecheck`

Expected: all pass.

- [ ] **Step 5: Commit the pure parser**

Before staging, run `npm run typecheck && npm run test:collaboration && git diff --check`; all must pass on the exact files being committed.

```bash
git add src/lib/customers/license-ocr/types.ts src/lib/customers/license-ocr/jamaica-dl-front-v1.ts tests/unit/customer-license-ocr.spec.ts
git commit -m "feat(customers): parse four driver-license fields"
```

---

### Task 3: Build the cancellable browser OCR adapter and image pipeline

**Files:**
- Create: `src/lib/customers/license-ocr/image-input.ts`
- Create: `src/lib/customers/license-ocr/tesseract-adapter.ts`
- Create: `src/lib/customers/license-ocr/browser-adapter.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/customers/evidence-assets.ts`
- Modify: `tests/unit/customer-evidence-assets.spec.ts`
- Modify: `tests/unit/customer-license-ocr.spec.ts`

**Interfaces:**
- Consumes: `File`, crop/rotation state, `CUSTOMER_OCR_ASSETS`, and Task 2 parser.
- Produces:

```ts
export interface NormalizedRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface LicenseImageTransform {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly crop: NormalizedRect;
}
export interface LicenseImageSource {
  readonly file: File;
  readonly transform: LicenseImageTransform;
}
export type LicenseOcrProgressStage = "loading_engine" | "checking_template" | "recognizing_name" | "recognizing_birth_date" | "recognizing_sex" | "recognizing_address";
export interface LicenseOcrProgress { readonly stage: LicenseOcrProgressStage; readonly percent: number; }
export interface LicenseRecognitionAttempt {
  readonly attemptId: string;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: LicenseOcrProgress) => void;
}
export async function recognizeJamaicaDriverLicense(
  source: LicenseImageSource,
  attempt: LicenseRecognitionAttempt,
): Promise<DriverLicenseRecognitionResult>;
export async function prepareDriverLicenseEvidence(file: File): Promise<PreparedLicenseEvidence>;
export function validatePreparedLicenseEvidence(value: unknown): asserts value is PreparedLicenseEvidence;
export function finalizePreparedLicenseEvidence(
  draft: PreparedLicenseEvidence,
  actorId: string,
  occurredAt: string,
): EvidenceAsset;
export interface LicenseOcrAdapter {
  recognize(source: LicenseImageSource, attempt: LicenseRecognitionAttempt): Promise<DriverLicenseRecognitionResult>;
  dispose(): Promise<void>;
}
export type LicenseOcrAdapterFactory = () => Promise<LicenseOcrAdapter>;
```

- [ ] **Step 1: Write RED tests for input safety and lifecycle**

Test JPEG/PNG signatures, 12 MiB and 24 MP limits, PDF/HEIC/WebP rejection before worker creation, four sequential ROI calls, 60-second timeout, AbortSignal cancellation, one worker per attempt, and `terminate()` in every exit path. Stub the worker factory; do not load the 17 MB runtime in unit tests.

```ts
let recognizeCalls = 0;
let terminateCalls = 0;
const worker = fakeWorker({
  recognize: async () => { recognizeCalls += 1; return safeEphemeralRegionResult(); },
  terminate: async () => { terminateCalls += 1; },
});
// Run recognition, then:
expect(recognizeCalls).toBe(10); // six fixed anchor ROIs plus four value ROIs
expect(terminateCalls).toBe(1);
expect(serializedResult).not.toContain("rawText");
```

Use explicit counters/fake methods like this throughout; this repository's Playwright unit runner does not provide Jest/Vitest mock-spy matchers.

- [ ] **Step 2: Run RED adapter tests**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-ocr.spec.ts tests/unit/customer-evidence-assets.spec.ts`

Expected: new lifecycle and image-boundary tests fail.

- [ ] **Step 3: Implement local worker creation and resource cleanup**

Use a client-only dynamic import and explicit same-origin paths:

```ts
const { createWorker, OEM, PSM } = await import("tesseract.js");
const worker = await createWorker("eng", OEM.LSTM_ONLY, {
  workerPath: CUSTOMER_OCR_ASSETS.workerPath,
  corePath: CUSTOMER_OCR_ASSETS.corePath,
  langPath: CUSTOMER_OCR_ASSETS.langPath,
  cacheMethod: "none",
  gzip: true,
  legacyCore: false,
  legacyLang: false,
  workerBlobURL: false,
  logger: () => undefined,
  errorHandler: () => undefined,
});
```

Do not enable a text logger. Progress callbacks expose only stage enums and percentages. Recognize only six fixed anchor crops and four value crops, never the full card. Revoke object URLs, close ImageBitmap, clear canvases, and terminate the worker in `finally`.

Extend `MockCustomerVehicleE2EScenario` with an exact optional `licenseOcr` union: `{ kind: "result"; result: DriverLicenseRecognitionResult } | { kind: "error"; code: LicenseOcrErrorCode }`. `browser-adapter.ts` may read this typed test scenario only in the existing Mock/E2E environment; absent scenario always constructs the real local adapter. Unit tests inject a factory directly.

- [ ] **Step 4: Separate OCR work image from persisted evidence**

Refactor the image helpers so OCR sees the corrected high-resolution canvas while `prepareDriverLicenseEvidence` produces a validated `<= 512 KiB` data-URL draft without `createdAt` or `createdBy`. The Mock store calls `finalizePreparedLicenseEvidence` with its bound actor and authoritative clock when KYC is submitted.

`PreparedLicenseEvidence` is declared in the browser-safe `license-ocr/types.ts`, not in `tesseract-adapter.ts`. The Mock store may import that DTO without importing Tesseract, canvas, `window`, or any browser-only code.

- [ ] **Step 5: Run focused tests, typecheck, and bundle-boundary inspection**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-ocr.spec.ts tests/unit/customer-evidence-assets.spec.ts && npm run typecheck && rg -n "cdn\.jsdelivr|tessdata\.projectnaptha|unpkg\.com|rawText|console\.log" src/lib/customers`

Expected: tests/typecheck pass; authored runtime source contains no external URL or OCR text logging. Do not apply this raw-text scan to the vendored, hash-locked upstream worker: upstream distribution text may contain dormant defaults even though our adapter provides exact local paths and `workerBlobURL: false`. Prove runtime behavior with the Task 8 cross-origin request blocker.

- [ ] **Step 6: Commit the adapter**

Before staging, run `npm run typecheck && npm run test:collaboration && git diff --check`; all must pass on the exact files being committed.

```bash
git add src/lib/customers/license-ocr/image-input.ts src/lib/customers/license-ocr/tesseract-adapter.ts src/lib/customers/license-ocr/browser-adapter.ts src/lib/customers/evidence-assets.ts src/lib/api/mock-customers.ts tests/unit/customer-license-ocr.spec.ts tests/unit/customer-evidence-assets.spec.ts
git commit -m "feat(customers): recognize licenses locally"
```

---

### Task 4: Add actor-bound phone lookup and pre-create OTP sessions

**Files:**
- Create: `src/lib/customers/onboarding-types.ts`
- Create: `src/lib/customers/onboarding-domain.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Create: `tests/unit/customer-onboarding.spec.ts`

**Interfaces:**
- Consumes: `normalizePhoneE164`, current customer state, store clock, full-read access.
- Produces these exact public DTOs in `onboarding-types.ts`:

```ts
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
  readonly primaryPhone: string;
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
      readonly phoneE164: string;
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
export interface OnboardingLicenseProfile {
  readonly name: string;
  readonly birthDate: string;
  readonly sex: "M" | "F";
  readonly address: string;
}
export interface CloseOnboardingResult { readonly closed: true; }
```

- Produces these exact access-first store methods:

```ts
previewOnboardingPhone(access, input: PreviewOnboardingPhoneInput): OnboardingPhonePreviewResult;
requestOnboardingOtp(access, token: string, input: RequestOnboardingOtpInput): OnboardingOtpChallenge;
verifyOnboardingOtp(access, token: string, input: VerifyOnboardingOtpInput): OnboardingOtpVerification;
closeOnboarding(access, token: string): CloseOnboardingResult;
```

- [ ] **Step 1: Write RED phone-gate tests**

```ts
test("phone match blocks token and OTP across all three stored phone fields", () => {
  for (const phone of [primaryPhone, secondaryPhone, whatsapp]) {
    const preview = store.previewOnboardingPhone(superadmin, {
      customerType: "individual",
      primaryPhone: phone,
      clientMutationId: `phone-${phone}`,
    });
    expect(preview.status).toBe("duplicate");
    if (preview.status !== "duplicate") throw new Error("expected duplicate phone");
    expect("onboardingToken" in preview).toBe(false);
    expect(preview.matches[0]).toMatchObject({ customerId: expect.any(String) });
  }
});
```

Add unauthorized-before-input, invalid E.164, inactive/blacklisted match, no customer PII beyond allowed match DTO, same actor idempotent retry, cross-actor token denial without existence leak, fixed `123456`, wrong-code zero side effect, phone-change restart, 30-minute expiry, idempotent close, and one-session-per-actor tests.

- [ ] **Step 2: Run RED store tests**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts`

Expected: FAIL because onboarding types and store methods do not exist.

- [ ] **Step 3: Implement the transient registry and exact validators**

```ts
interface CustomerOnboardingSession {
  readonly token: string;
  readonly actorId: string;
  readonly customerType: CustomerType;
  readonly phoneE164: string;
  readonly createdAt: string;
  phoneSourceRevision: number;
  stage: "phone_clear" | "otp_requested" | "otp_verified" | "kyc_submitted" | "kyc_confirmed" | "customer_previewed" | "creating";
  lastTouchedAtMs: number;
  otp: null | { challengeId: string; requestedAt: string; verifiedAt: string | null };
  kyc: null | {
    draftId: string;
    frontAsset: EvidenceAsset;
    profile: OnboardingLicenseProfile;
    submittedAt: string;
    verifiedAt: string | null;
  };
  customerPreview: null | {
    previewToken: string;
    input: NormalizedCustomerInput;
    candidates: readonly CustomerDuplicateCandidate[];
    sourceRevision: number;
  };
  readonly memoryReceipts: Map<string, {
    operation: string;
    clientMutationId: string;
    requestFingerprint: string;
    response: unknown;
  }>;
}
```

Keep the session maps inside `createMockCustomerVehicleStore`; never place them in persisted state. Add `onboardingNowMs?: () => number` to `CreateMockCustomerVehicleStoreOptions`, defaulting to `Date.now`; use it only for 30-minute session expiry. Keep the existing ISO `clock()` authoritative for persisted evidence/audit timestamps, because its Mock default is fixed and cannot measure elapsed wall time. On every access, remove sessions whose `lastTouchedAtMs` is more than 30 minutes old. Starting a new clear session for an actor closes that actor's prior session. Each transient operation stores `(operation, clientMutationId, requestFingerprint, response)` so a retry is byte-stable while the same mutation ID with different input is a 409 conflict. Runtime guards must reject unknown keys, empty/data-bearing IDs, and malformed timestamps. Access checking is the first statement of every method.

Phone preview occurs before a session exists, including the duplicate result, so add an actor-level `phonePreviewReceiptsByActor: Map<string, OnboardingMemoryReceipt>`. It applies the same `(operation, clientMutationId, requestFingerprint)` idempotency rule to both `duplicate` and `clear` responses. A same-key/same-body retry returns the original response; a same key with a different phone/type returns 409 before doing a new lookup. When a new logical preview ID succeeds, replace the actor's prior phone-preview receipt and close any prior clear session.

`closeOnboarding` is deliberately existence-hiding: a current-actor token is removed; a missing or foreign token performs no mutation; all three cases return `{ closed: true }`. It is safe to retry and never reveals whether another actor's token exists.

- [ ] **Step 4: Run focused store tests and existing verification regression**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customers-store.spec.ts`

Expected: all pass; persisted schema remains version 3.

- [ ] **Step 5: Commit phone/OTP sessions**

Before staging, run `npm run typecheck && npm run test:collaboration && git diff --check`; all must pass on the exact files being committed.

```bash
git add src/lib/customers/onboarding-types.ts src/lib/customers/onboarding-domain.ts src/lib/api/mock-customers.ts tests/unit/customer-onboarding.spec.ts
git commit -m "feat(customers): gate onboarding by phone OTP"
```

---

### Task 5: Add pre-create KYC confirmation and atomic customer creation

**Files:**
- Modify: `src/lib/customers/onboarding-types.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `tests/unit/customer-onboarding.spec.ts`
- Modify: `tests/unit/customer-migrations.spec.ts`

**Interfaces:**
- Consumes: verified onboarding OTP, EvidenceAsset validation, employee-confirmed four fields, name preview token, existing customer duplicate preview rules.
- Adds these exact public DTOs to `onboarding-types.ts`:

```ts
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
export interface PreviewOnboardingCustomerInput {
  readonly customer: CustomerDraftInput;
  readonly clientMutationId: string;
}
export interface OnboardingCustomerPreview {
  readonly input: NormalizedCustomerInput;
  readonly candidates: readonly CustomerDuplicateCandidate[];
  readonly sourceRevision: number;
  readonly previewToken: string;
}
export interface CreateOnboardingCustomerInput {
  readonly previewToken: string;
  readonly confirmPossibleDuplicate?: boolean;
  readonly clientMutationId: string;
}
```

- Adds these store methods:

```ts
submitOnboardingKyc(access, token: string, input: SubmitOnboardingKycInput): OnboardingKycSubmission;
verifyOnboardingKyc(access, token: string, input: VerifyOnboardingKycInput): OnboardingKycConfirmation;
previewOnboardingCustomer(access, token: string, input: PreviewOnboardingCustomerInput): OnboardingCustomerPreview;
createOnboardingCustomer(access, token: string, input: CreateOnboardingCustomerInput): CustomerRecord;
```

- [ ] **Step 1: Write RED KYC and atomic-create tests**

Cover: KYC before OTP denied; actor/clock-stamped evidence; individual requires evidence and attestation; organization skips KYC; four-field edit invalidates confirmation; final phone/profile/name token exact binding; global evidence-ID collision; source revision race with a newly inserted duplicate phone; and non-phone duplicate confirmation. Exercise the full cross product of incoming `primaryPhone`/`secondaryPhone`/`whatsapp` against stored `phone`/`secondaryPhone`/`whatsapp`; `confirmPossibleDuplicate` must never override any phone match.

```ts
expect(created.revision).toBe(1);
expect(created.verificationArchive.otpRecords).toHaveLength(1);
expect(created.verificationArchive.otpRecords[0]).toMatchObject({ verifiedBy: superadmin.actorId });
expect(created.verificationArchive.kycRecords[0]).toMatchObject({ verifiedBy: superadmin.actorId });
expect(storage.writeCount).toBe(1);
```

Add write-failure assertions for byte-identical raw state, zero new customer/audit/receipt, retry with the same token/`clientMutationId`, response-loss retry returning the same customer, and no duplicate customer after later edits. Extend the fault harness with a one-shot `customerOnboardingCreateResponse` fault that fires only after persist/state update/receipt/session consumption; it simulates a lost response without rolling back the committed customer. A retry must hit the persisted `customer.create` receipt before checking the now-absent session.

- [ ] **Step 2: Run RED focused tests**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-migrations.spec.ts`

Expected: KYC/create cases fail while phone/OTP cases stay green.

- [ ] **Step 3: Implement KYC session state and final preview binding**

Stamp `createdAt/createdBy`, `submittedAt`, and `verifiedAt/verifiedBy` from the store clock/access. Store only the compressed EvidenceAsset and confirmed four-field snapshot in the transient session. `attested: true` represents the exact UI statement “已核对到场本人及驾驶证原件，以上四项与原件一致”; a truthy string or omitted field is invalid. Map licence sex to the existing formal-profile vocabulary deterministically (`M -> 男`, `F -> 女`) and require the final draft's `nameSourceValue`, `birthDate`, `gender`, and `address` to equal the confirmed snapshot after normalization. Bind the final preview to token, actor, source revision, normalized input, phone, KYC snapshot, name-transliteration token, and duplicate candidates. Add a dedicated all-field phone matcher in `onboarding-domain.ts`; do not rely on the legacy `duplicateCandidates()` phone logic, which does not provide the required all-field hard gate.

`submitOnboardingKyc` stores the evidence and four-field draft but does not imply verification. `verifyOnboardingKyc` must match its `kycDraftId`, validate the already-submitted profile has not changed, and record the explicit attestation. A UI field edit after submit calls submit again with a new logical mutation ID, replaces the transient KYC draft, and invalidates the old confirmation/name/final preview; it never mutates persisted state.

- [ ] **Step 4: Implement one-write create**

Build a single cloned `nextState` containing the revision-1 customer, verified OTP/KYC archive, compact audit events (`otp_requested`, `otp_verified`, `customer_created`, plus `kyc_submitted` and `kyc_verified` for an individual), `customer.create` receipt, and `sourceRevision + 1`; call `validateCustomerVehicleStateV3(nextState)` before one `persist()`. Every audit event uses the bound actor and authoritative event time, and individual KYC audit events reference only the stored driver-license evidence ID. Consume transient/name/preview tokens only after persistence succeeds.

The create-idempotency lookup must run before onboarding-token lookup, so a lost response can return the already-created customer after the transient session has been consumed. Implement a create-specific helper keyed by `(actorId, clientMutationId.trim(), "customer.create")`; return the current version of `resultEntityId` even if that customer was edited after creation. Do not reuse `idempotentCustomerResult`, whose exact-revision rule is correct for verification actions but wrong for response-loss recovery after creation.

- [ ] **Step 5: Prove schema v3 and atomicity**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts && npm run typecheck`

Expected: all pass; stored envelope remains `schemaVersion: 3`; no partial customer can be observed.

- [ ] **Step 6: Commit the store transaction**

Before staging, run `npm run typecheck && npm run test:collaboration && git diff --check`; all must pass on the exact files being committed.

```bash
git add src/lib/customers/onboarding-types.ts src/lib/api/mock-customers.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-migrations.spec.ts
git commit -m "feat(customers): create verified customers atomically"
```

---

### Task 6: Expose exact Mock routes and typed client methods

**Files:**
- Modify: `src/lib/api/client.ts`
- Modify: `tests/unit/customers-api.spec.ts`
- Modify: `tests/unit/customer-onboarding.spec.ts`

**Interfaces:**
- Consumes: Task 4/5 store methods.
- Produces `api.customers.onboarding.{previewPhone,requestOtp,verifyOtp,submitKyc,verifyKyc,preview,create,close}` and the seven POST plus one DELETE routes from the approved spec.

- [ ] **Step 1: Write RED route/client tests**

```ts
const preview = await api.customers.onboarding.previewPhone({
  customerType: "individual",
  primaryPhone: "+1 876 555 0199",
  clientMutationId: "phone-1",
});
expect(preview.status).toBe("clear");
if (preview.status !== "clear") throw new Error("expected clear onboarding phone");
await api.customers.onboarding.requestOtp(preview.onboardingToken, { clientMutationId: "request-1" });
```

Cover all seven POST routes plus idempotent DELETE; real-fetch error `code` propagation; malformed/extra keys; auth before body parsing and delay; session switch after request dispatch; cross-actor/cross-token conflicts; and no raw OCR or evidence data in phone/OTP responses. Existing create/edit behavior remains byte-for-byte unchanged in this API-only commit; the legacy create cutoff is deliberately coupled to the rendered-entry switch in Task 7 so no intermediate `main` commit contains a broken “新建客户” button.

- [ ] **Step 2: Run RED API tests**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customers-api.spec.ts --grep "onboarding"`

Expected: FAIL because routes and client methods are absent.

- [ ] **Step 3: Add route matching before generic customer-id matching**

Define onboarding regexes at the top of `mockRequest`, include every route in `isCustomerVehicleRequest`, bind `customerVehicleAccessFromSession()` before delay/body parsing, then invoke the access-first store methods. Route order is exact-path phone preview first, token subroutes second, generic `/api/customers/:id` last. Keep typed public DTOs in `onboarding-types.ts`; do not expose the internal session object. Retain the legacy create route/client entry only until Task 7 switches both workspaces in the same page-behavior commit.

- [ ] **Step 4: Run API/store focused tests and typecheck**

Run: `npx playwright test --config=playwright.unit.config.ts tests/unit/customers-api.spec.ts tests/unit/customer-onboarding.spec.ts && npm run typecheck`

Expected: all pass.

- [ ] **Step 5: Commit the API boundary**

Before staging, run `npm run typecheck && npm run test:collaboration && git diff --check`; all must pass on the exact files being committed.

```bash
git add src/lib/api/client.ts tests/unit/customers-api.spec.ts tests/unit/customer-onboarding.spec.ts
git commit -m "feat(customers): expose onboarding Mock APIs"
```

---

### Task 7: Replace create mode with the staged onboarding UI

**Files:**
- Modify: `src/lib/api/client.ts`
- Create: `src/components/customers/customer-onboarding-state.ts`
- Create: `src/components/customers/customer-onboarding-dialog.tsx`
- Create: `src/components/customers/onboarding-phone-step.tsx`
- Create: `src/components/customers/onboarding-license-step.tsx`
- Create: `src/components/customers/license-image-editor.tsx`
- Create: `src/components/customers/onboarding-profile-step.tsx`
- Modify: `src/components/customers/customers-workspace.tsx`
- Modify: `src/components/customers/customer-workspace.tsx`
- Modify: `src/components/customers/form-dialogs.tsx`
- Modify: `src/components/customers/detail-shared.tsx`
- Modify: `src/components/customers/verification-evidence-section.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Create: `tests/unit/customer-onboarding-state.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`
- Create: `tests/e2e/helpers/customer-onboarding.ts`
- Create: `tests/e2e/customer-onboarding.spec.ts`
- Modify: `tests/e2e/customer-vehicle.spec.ts`
- Modify: `tests/e2e/page-headers.spec.ts`

**Interfaces:**
- Consumes: typed onboarding API, OCR adapter, evidence helper, existing `Dialog`, name preview, duplicate display, session key, and dirty-close guard.
- Produces: a staged create UI while `CustomerFormDialog` remains edit-only.
- Test seam: `license-ocr/browser-adapter.ts` exposes an explicit `LicenseOcrAdapterFactory`. `CustomerOnboardingDialog` receives the real factory by default; E2E selects a deterministic factory through a strict `MockCustomerVehicleE2EScenario.licenseOcr` union. Do not read an untyped production global or silently fall back when local OCR assets fail. The separate Task 8 test exercises the real worker.

- [ ] **Step 1: Write RED E2E for the user-approved business order**

```ts
import path from "node:path";

const SYNTHETIC_LICENSE = path.resolve(
  process.cwd(),
  "public/seed-evidence/alicia-bennett-drivers-license-front.png",
);

test("new individual checks phone before OTP and creates with verified evidence", async ({ page }) => {
  await useOnboardingIdentity(page, "frontdesk_admin", {
    licenseOcr: {
      kind: "result",
      result: {
        template: "jamaica-dl-front-v1",
        profile: { name: "Alicia Bennett", birthDate: "1988-03-22", sex: "F", address: "12 Constant Spring Road, Kingston 8, Jamaica" },
        status: { name: "recognized", birthDate: "recognized", sex: "recognized", address: "recognized" },
      },
    },
  });
  await page.goto("/customers");
  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("onboarding-send-otp")).toBeDisabled();
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0199");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-send-otp").click();
  await page.getByTestId("onboarding-otp-code").fill("123456");
  await page.getByTestId("onboarding-verify-otp").click();
  await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
  await page.getByTestId("onboarding-license-attestation").check();
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await page.getByTestId("onboarding-preview").click();
  await expect(page.getByTestId("customer-duplicate-candidates")).toContainText("CUST-UAT-001");
  await page.getByTestId("confirm-customer-duplicate").check();
  await page.getByTestId("onboarding-create").click();
  const customerId = await findCustomerIdByPhone(page, "+18765550199");
  await page.getByTestId(`customer-row-${customerId}`).click();
  await expect(page.getByTestId("customer-otp-evidence-card")).toContainText("已验证");
  await expect(page.getByTestId("customer-kyc-evidence-card")).toContainText("已核验");
});
```

Define `useOnboardingIdentity` and `findCustomerIdByPhone` in `tests/e2e/helpers/customer-onboarding.ts`; do not import another `.spec.ts` file. The identity helper must use the same `wh_session` shape and one-time-reset marker as `customer-vehicle.spec.ts`, plus the typed deterministic OCR scenario. `findCustomerIdByPhone` reads only the current test browser's `wh_customer_vehicle_mock_v1` envelope, returns the ID matching normalized primary phone, and is used only to navigate to the visible row. The fixture deliberately shares Alicia's name so the E2E also proves a name match is soft-confirmable while the unique phone remains the hard identity gate.

Also write RED cases for an existing phone opening the existing profile with no OTP button; organization phone/OTP without license; OCR unavailable/manual four-field entry against uploaded evidence; no-license individual blocked; no tags/first-vehicle fields; change-phone invalidation; dirty close/cancel; retry after save fault; session switch; and 430 px keyboard/focus behavior.

- [ ] **Step 2: Run RED onboarding E2E**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts`

Expected: FAIL at the first missing onboarding test ID; existing customer/vehicle page still loads.

- [ ] **Step 3: Implement the orchestration dialog**

First write `customer-onboarding-state.spec.ts` RED tests for the pure reducer: changing phone resets OTP/KYC/name/final preview; changing image resets OCR/KYC/name/final preview; changing one confirmed field resets attestation/name/final preview; changing source name resets transliteration/final preview; changing customer type closes the current token and restarts. Implement the reducer before wiring React.

Use one frozen `{ sessionKey, actorId }` captured when the dialog opens. Each async step has an attempt ID and checks the frozen session before API calls and before applying responses. The close path aborts OCR, calls `close(token)` when present, clears File/object URLs, then closes. A failed close request must not retain the visible dialog or leak data; the in-memory store expiry remains the backstop.

- [ ] **Step 4: Implement phone and OTP step**

Use plain-language states: “先查询号码”, “没有找到已有客户，可以发送验证码”, “该号码已有客户”, “号码已验证”. Existing matches show only authorized customer display name, ID, matched field, and a link to `/customers/:id`. Changing the number calls `close` and restarts.

- [ ] **Step 5: Implement license and four-field confirmation step**

Provide file/camera input, preview, rotate/crop controls, non-text OCR progress, four labeled inputs, manual-required indicators, and the exact employee attestation. `license-image-editor.tsx` provides pointer-captured corner drag plus four numeric/range crop-edge controls so keyboard users can adjust the same crop; it also exposes rotate left/right/reset. Any image/rotation/crop change aborts and disposes the prior OCR attempt. The UI must display “纯 Mock 演示，请勿上传真实客户证件”. OCR errors preserve manual inputs and offer “对照原件手动填写”; they never claim success.

- [ ] **Step 6: Implement profile/duplicate/final review step**

Reuse the single source-name input and `api.customers.previewName`; show the counterpart read-only. Keep meaningful contact fields but remove tags/vehicle relationship. Organization uses organization name + one primary contact. Lock `customerType` after a clear phone session; changing type explicitly closes the session and starts over. The explicit “检查并预览” action first calls `api.customers.onboarding.preview(token, { customer, clientMutationId })`; only its returned candidates and `previewToken` enable the final create button. If candidates exist, render them and require the existing explicit confirmation checkbox before `api.customers.onboarding.create(...)`. Final save sends only `{ previewToken, confirmPossibleDuplicate, clientMutationId }`, uses a stable create mutation ID, and never resends an unbound draft. Write failure preserves all inputs, receipts, evidence, and confirmation for the same-path retry.

- [ ] **Step 7: Switch only create entry points**

Render `CustomerOnboardingDialog` from both customer workspaces. Keep `CustomerFormDialog` for detail-page edit and retain all edit, dirty-close, duplicate, permissions, retry, and session-isolation tests. In this same commit, remove its public create mode, make legacy `POST /api/customers` return `400 CUSTOMER_ONBOARDING_REQUIRED` with zero writes, and remove `api.customers.create`; this atomic switch prevents both a bypass and an intermediate broken button. Add an optional mobile-fullscreen surface class to the shared `Dialog` rather than building another modal; preserve its portal/inert/focus-trap/Escape/focus-return behavior. Replace old create-specific assertions rather than deleting unrelated coverage.

For `customerType === "organization"`, `detail-shared.tsx` excludes driver-license KYC from pending-verification counts and `verification-evidence-section.tsx` renders “驾驶证 KYC：不适用（企业客户）” with no upload/verify action. OTP and agreement remain normal. Add unit/E2E regression showing a newly created organization is not immediately labelled incomplete for missing personal driving licence.

- [ ] **Step 8: Run focused UI regression**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts tests/e2e/page-headers.spec.ts`

Expected: all pass with no `waitForTimeout` additions and no console errors.

- [ ] **Step 9: Commit the rendered flow**

Because this task changes page behavior, run `npm run typecheck && npm run test:collaboration && E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e && git diff --check` before staging. The full E2E command, not only the focused subset, is the commit gate.

```bash
git add src/lib/api/client.ts src/components/customers/customer-onboarding-state.ts src/components/customers/customer-onboarding-dialog.tsx src/components/customers/onboarding-phone-step.tsx src/components/customers/onboarding-license-step.tsx src/components/customers/license-image-editor.tsx src/components/customers/onboarding-profile-step.tsx src/components/customers/customers-workspace.tsx src/components/customers/customer-workspace.tsx src/components/customers/form-dialogs.tsx src/components/customers/detail-shared.tsx src/components/customers/verification-evidence-section.tsx src/components/ui/dialog.tsx tests/unit/customers-api.spec.ts tests/unit/customer-onboarding-state.spec.ts tests/e2e/helpers/customer-onboarding.ts tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts tests/e2e/page-headers.spec.ts
git commit -m "feat(customers): add in-person onboarding workspace"
```

---

### Task 8: Prove real local OCR, privacy, responsiveness, and the complete regression gate

**Files:**
- Modify: `tests/e2e/customer-onboarding.spec.ts`
- Create: `tests/e2e/customer-onboarding-real-ocr.spec.ts`
- Modify: `tests/collaboration/customer-ocr-assets.test.mjs`
- Create: `.superpowers/sdd/2026-08-13-customer-onboarding/task-8-report.md`

**Interfaces:**
- Consumes: all prior tasks and `public/seed-evidence/alicia-bennett-drivers-license-front.png` as the watermarked synthetic regression license.
- Produces: current-build evidence that local OCR and the full product behave as specified.

- [ ] **Step 1: Add one real-worker browser test**

Create `customer-onboarding-real-ocr.spec.ts` and call `test.setTimeout(120_000)` before the test; the product OCR timeout is 60 seconds and the Playwright harness must outlive it on a cold local model load. Do not stub OCR in this test. Block all non-localhost requests and fail on any cross-origin request. Run the synthetic watermarked license through the real local worker/core/language files; assert the four approved fields are exact or explicitly manual-required according to the calibrated fixture, and assert no forbidden field or OCR text reaches storage, URL, console, or audit.

```ts
const crossOriginRequests: string[] = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) crossOriginRequests.push(request.url());
});
// Run the real recognition flow, then:
expect(crossOriginRequests).toEqual([]);
```

- [ ] **Step 2: Run focused real-worker and deterministic onboarding E2E**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-onboarding-real-ocr.spec.ts`

Expected: all pass; network trace contains only the application origin.

- [ ] **Step 3: Prove lazy loading before recognition**

Open `/customers`, attach request listeners, and wait for the customer workspace to settle without opening onboarding; requests whose path starts `/ocr/tesseract-v7/` must remain zero. Open onboarding and proceed only through phone/OTP; the count must still be zero. Only clicking “本机辅助识别” may request worker/core/lang. Keep this assertion in the real-worker E2E so a future top-level import or prewarm cannot silently add a 17 MB customer-list load.

- [ ] **Step 4: Run fresh build, static, and unit gates**

Run: `npm run typecheck && npm run build && npm run test:collaboration && npm run test:unit && git diff --check`

Expected: all pass; record exact counts and duration in the report.

- [ ] **Step 5: Run the required full E2E suite from a clean port**

Ensure port 3210 is not occupied by an old checkout, then run:

`E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e`

Expected: the full suite passes against the current `main` working tree; record the server PID/cwd and exact test count.

- [ ] **Step 6: Perform visible desktop and 430 px QA**

Capture the current rendered product, not a code diff. At 1440 px verify the staged flow, existing-phone stop state, OTP state, license preview, four fields, final review, and fixed actions. At 430 px verify root width equals viewport width, the dialog scrolls vertically, controls are not clipped, focus returns correctly, Escape/dirty-close works, and there are no console errors. Store QA output under the external-volume workspace and do not stage large screenshots unless explicitly requested.

- [ ] **Step 7: Audit privacy and persistence directly**

Inspect the final `wh_customer_vehicle_mock_v1` raw value after creation. It may contain the compressed EvidenceAsset, the confirmed four fields, and the existing formal `trn` property; it must not contain `rawText`, confidence, anchor OCR output, any OCR-extracted TRN/class/license-number value, processed image fields, OTP code, object/blob URLs, or onboarding session tokens. Also inspect `localStorage`, `sessionStorage`, IndexedDB databases, request bodies, page URL, audit history, and captured console messages for the same forbidden values.

- [ ] **Step 8: Write the report and request independent review**

The report must list commits, exact files, RED/GREEN evidence, current full gates, visual sizes, real-worker network result, known Mock-only privacy warning, and zero/remaining Critical or Important review findings. Use `superpowers:requesting-code-review` before the final commit.

- [ ] **Step 9: Commit verified delivery**

```bash
git add tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-onboarding-real-ocr.spec.ts tests/collaboration/customer-ocr-assets.test.mjs
git add -f .superpowers/sdd/2026-08-13-customer-onboarding/task-8-report.md
git commit -m "test(customers): verify in-person onboarding"
```

---

## Plan Self-Review Checklist

- Every product requirement in `docs/superpowers/specs/2026-08-13-in-person-customer-onboarding-design.md` maps to Tasks 1–8.
- No task creates a temporary/persisted customer before final create.
- Phone duplicate lookup precedes OTP in store, API, UI, and E2E.
- Individual KYC is employee-confirmed at creation; OCR alone never verifies KYC.
- Organization creation skips license KYC but not phone lookup/OTP.
- Organization details show driver-license KYC as not applicable and do not count it as missing.
- Tesseract assets are local, version/hash locked, lazy-loaded, and covered by a no-CDN test.
- OCR raw data has no persisted/public DTO path.
- Final create has one persist and a response-loss-safe create receipt.
- The same commit that switches both create buttons also disables legacy `POST /api/customers`, so no bypass or broken intermediate UI is committed.
- Existing edit and post-create verification flows remain in regression scope.
- Full E2E and desktop/430 px visible QA are mandatory before completion.
