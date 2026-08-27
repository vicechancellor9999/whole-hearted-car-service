# External AI License Extraction Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete browser Tesseract stack and replace it with a fail-closed, provider-neutral driver-license extraction boundary plus an explicit Mock AI-assisted UI that preserves manual entry, OTP/KYC, and atomic customer creation.

**Approved spec:** `docs/superpowers/specs/2026-08-13-in-person-customer-onboarding-design.md` at `d5767635c393d4538d9b1fc3c22faf62de50587c`.

**Start commit:** `d5767635c393d4538d9b1fc3c22faf62de50587c` on `main`.

**Architecture:** The customer UI depends only on `LicenseExtractionClient.extract({ file, transform, signal, onProgress? })` and a four-field safe DTO. The current browser factory returns success only for an explicitly injected Mock/test scenario; without one it fails as `LICENSE_EXTRACTION_UNAVAILABLE` and the employee continues manually. A future real adapter may call only a same-origin system API that proxies an AI provider; this plan adds no provider SDK, external request, provider key, or real backend route.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, existing Mock API/store, Playwright unit/E2E, Node collaboration tests, existing JPEG/PNG evidence utilities. No new dependency.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Keep generated files and growing caches under `/Volumes/公司文件`; do not create persistent output on Macintosh HD.
- Remain Mock-only: no real AI provider, provider SDK, provider endpoint, provider key, real SMS, database, object storage, or backend extraction implementation.
- Reuse existing repository/runtime capability first. Add no dependency in this plan. If a later real adapter lacks a suitable existing or mature open-source tool, stop and ask the product owner before adding one.
- Mock success is allowed only when `MockCustomerVehicleE2EScenario.licenseExtraction` is explicitly configured. An arbitrary uploaded image with no scenario must never receive fabricated extracted values.
- The browser must never contain an AI provider key or call a provider domain. A future adapter may call only the same-origin `POST /api/customers/onboarding/:token/license-extraction` system API described in the approved spec.
- Extraction may return only `name`, `birthDate`, `sex`, and `address` plus the four-field status map. Provider/OCR raw text, confidence, blocks, coordinates, request IDs, and forbidden license fields never enter UI state, persistence, audit, URL, console, or network DTOs.
- Preserve upload/camera, preview, rotation, crop, four-field editing, employee attestation, phone duplicate check, OTP, KYC evidence, name confirmation, response-loss retry, and one-persist atomic creation.
- Upload, rotation, crop, mode changes, manual field edits, dialog close, and identity change cancel and invalidate an active extraction. A late result never overwrites manual input.
- Every task ends with a fresh independent review and its own commit. Resolve all Critical and Important findings before that commit.
- Any page-behavior change requires updated E2E, the full E2E gate, and visible desktop plus 430 px acceptance before final delivery.

---

## Final File Structure

- `src/lib/customers/license-extraction/types.ts`: provider-neutral fields, partial result, exact status, stable errors, client/factory signatures, and prepared-evidence DTO.
- `src/lib/customers/license-extraction/image-input.ts`: retained JPEG/PNG signature, byte/pixel, and transform validation; no AI/OCR engine code.
- `src/lib/customers/license-extraction/prepared-evidence.ts`: retained exact prepared-evidence validation/finalization.
- `src/lib/customers/license-extraction/mock-client.ts`: explicit deterministic result/error/deferred scenarios; no file-content inference and no network.
- `src/lib/customers/license-extraction/browser-client.ts`: selects the explicit Mock scenario or returns the fail-closed unavailable client; future same-origin adapter is not implemented here.
- `src/components/customers/customer-onboarding-dialog.tsx`: attempt ownership, cancellation, partial result application, and protection against late responses.
- `src/components/customers/onboarding-license-step.tsx`: explicit `AI辅助识别` action, progress, simulated-result disclosure, failure, retry, manual fallback, and field status.
- `tests/unit/customer-license-extraction.spec.ts`: safe DTO, input/transform, unavailable default, explicit Mock, cancellation, and zero-network contract.
- `tests/collaboration/customer-license-extraction-boundary.test.mjs`: dependency/asset removal, no old runtime reference, no provider secret/direct endpoint, and active-doc boundary.
- `tests/e2e/customer-onboarding.spec.ts`: explicit extraction interaction, manual fallback, stale-result races, privacy, and responsive acceptance.

### Task 1: Remove Tesseract and establish the fail-closed neutral core

**Files:**
- Create: `src/lib/customers/license-extraction/types.ts`
- Create: `src/lib/customers/license-extraction/browser-client.ts`
- Create: `src/lib/customers/license-extraction/mock-client.ts`
- Move/Modify: `src/lib/customers/license-ocr/image-input.ts` → `src/lib/customers/license-extraction/image-input.ts`
- Move/Modify: `src/lib/customers/license-ocr/prepared-evidence.ts` → `src/lib/customers/license-extraction/prepared-evidence.ts`
- Create: `tests/unit/customer-license-extraction.spec.ts`
- Create: `tests/collaboration/customer-license-extraction-boundary.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/customers/onboarding-types.ts`
- Modify: `src/lib/customers/evidence-assets.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/components/customers/customer-onboarding-state.ts`
- Modify: `src/components/customers/customer-onboarding-dialog.tsx`
- Modify: `src/components/customers/onboarding-license-step.tsx`
- Modify: `src/components/customers/license-image-editor.tsx`
- Modify: `tests/unit/customer-onboarding.spec.ts`
- Modify: `tests/e2e/customer-onboarding.spec.ts`
- Delete: `scripts/sync-customer-ocr-assets.mjs`
- Delete: `src/lib/customers/ocr-asset-manifest.ts`
- Delete: `src/lib/customers/ocr-asset-hashes.generated.ts`
- Delete: `src/lib/customers/license-ocr/browser-adapter.ts`
- Delete: `src/lib/customers/license-ocr/jamaica-dl-front-v1.ts`
- Delete: `src/lib/customers/license-ocr/tesseract-adapter.ts`
- Delete: `src/lib/customers/license-ocr/types.ts`
- Delete: `tests/unit/customer-license-ocr.spec.ts`
- Delete: `tests/collaboration/customer-ocr-assets.test.mjs`
- Delete directory: `public/ocr/tesseract-v7/` (all 14,779,906 tracked bytes: notice, worker, three core files, and English data)
- Preserve unchanged: `public/seed-evidence/alicia-bennett-drivers-license-front.png`

**Interfaces:**
- Consumes: existing `LicenseImageTransform`, `PreparedLicenseEvidence`, evidence finalization rules, and explicit `window.__WH_CUSTOMERS_TEST_SCENARIO__` injection.
- Produces:

```ts
export type LicenseExtractionField = "name" | "birthDate" | "sex" | "address";
export type LicenseExtractionProfile = Readonly<Partial<{
  name: string;
  birthDate: string;
  sex: "M" | "F";
  address: string;
}>>;
export type LicenseExtractionStatus = Readonly<Record<
  LicenseExtractionField,
  "extracted" | "manual_required"
>>;
export interface LicenseExtractionResult {
  readonly profile: LicenseExtractionProfile;
  readonly status: LicenseExtractionStatus;
}
export interface LicenseExtractionInput {
  readonly file: File;
  readonly transform: LicenseImageTransform;
  readonly signal: AbortSignal;
  readonly onProgress?: (percent: number) => void;
}
export interface LicenseExtractionClient {
  extract(input: LicenseExtractionInput): Promise<LicenseExtractionResult>;
}
export type LicenseExtractionClientFactory = () => LicenseExtractionClient;
export function createBrowserLicenseExtractionClient(
  scenario?: MockCustomerVehicleE2EScenario["licenseExtraction"],
): LicenseExtractionClient;
```

- Stable errors: `LICENSE_EXTRACTION_INPUT_UNSUPPORTED`, `LICENSE_EXTRACTION_IMAGE_TOO_LARGE`, `LICENSE_EXTRACTION_UNAVAILABLE`, `LICENSE_EXTRACTION_RESPONSE_INVALID`, `LICENSE_EXTRACTION_TIMEOUT`, and `LICENSE_EXTRACTION_CANCELLED`.
- `MockCustomerVehicleE2EScenario.licenseExtraction` replaces `licenseOcr`; kinds remain `result`, `deferred`, and `error`, but use `LicenseExtractionResult` and `LicenseExtractionErrorCode`.

- [ ] **Step 1: Write the removal and neutral-contract RED tests**

Create the new unit and collaboration tests before deleting anything. Lock these cases:

```ts
test("default browser client is unavailable and never fabricates values", async () => {
  const client = createBrowserLicenseExtractionClient(undefined);
  await expect(client.extract(validInput())).rejects.toMatchObject({
    code: "LICENSE_EXTRACTION_UNAVAILABLE",
  });
  expect(fetchCalls).toBe(0);
});

test("safe result rejects a fifth field and raw provider metadata", () => {
  expect(() => validateLicenseExtractionResult({
    profile: { name: "Synthetic Person", licenseNumber: "FORBIDDEN" },
    status: manualStatus,
    confidence: 99,
  })).toThrowError(expect.objectContaining({ code: "LICENSE_EXTRACTION_RESPONSE_INVALID" }));
});
```

The collaboration test must read `package.json`, `package-lock.json`, tracked runtime directories, `src/`, and `scripts/`; it fails while any direct Tesseract dependency, `sync:customer-ocr-assets`, `public/ocr/tesseract-v7`, `CUSTOMER_OCR_ASSETS`, old `license-ocr` import, or Tesseract runtime reference remains.

- [ ] **Step 2: Run RED and record the expected failures**

Run:

```bash
node --test tests/collaboration/customer-license-extraction-boundary.test.mjs
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-extraction.spec.ts
```

Expected: collaboration fails on the three direct dependencies and 14.10 MiB runtime; unit fails because `license-extraction/types` and `browser-client` do not exist.

- [ ] **Step 3: Implement exact safe types and migrate reusable validation**

Move the image and evidence modules, replace `LicenseOcrError` with `LicenseExtractionError`, and keep the existing limits exactly: JPEG/PNG signature plus MIME, 12 MiB, 24 MP, normalized crop, rotations `0 | 90 | 180 | 270`, and 512 KiB prepared evidence. `validateLicenseExtractionResult()` must require exact root keys `profile/status`, reject symbol/non-enumerable/extra keys, normalize no provider text, accept only non-future `YYYY-MM-DD` and exact `M/F`, and return only the safe DTO.

Update all imports listed under **Files**. Rename reducer action `ocrCompleted` to `licenseExtractionCompleted`; merge only present extracted fields into the existing four-field form so omitted/manual-required fields do not erase earlier manual values.

- [ ] **Step 4: Implement explicit Mock selection and fail-closed default**

`createBrowserLicenseExtractionClient()` must return `createMockLicenseExtractionClient(scenario)` only when `licenseExtraction` exists. With no scenario it returns a client whose `extract()` rejects `LICENSE_EXTRACTION_UNAVAILABLE` before reading file bytes or calling `fetch`. The Mock client may emit progress and delays from its explicit scenario, must honor `AbortSignal`, and must validate the configured result before returning it. It must never derive values from filename, pixels, MIME, or arbitrary uploaded content.

- [ ] **Step 5: Remove the old supply chain atomically**

Run with the external-volume cache:

```bash
npm_config_cache='/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/.cache/npm' npm uninstall @tesseract.js-data/eng tesseract.js tesseract.js-core
```

Remove the sync script, manifests, parser, worker adapter, old tests, and full `public/ocr/tesseract-v7/` directory listed above. Remove `sync:customer-ocr-assets` from `package.json`. Do not delete or alter the synthetic seed evidence.

- [ ] **Step 6: Migrate scenarios and prove GREEN**

Rename `licenseOcr` fixtures/constants to `licenseExtraction`/`EXTRACTION_RESULT`, change status values from `recognized` to `extracted`, and keep the existing E2E behavior temporarily so this structural commit remains green. Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-extraction.spec.ts tests/unit/customer-evidence-assets.spec.ts tests/unit/customer-onboarding.spec.ts
npm run typecheck
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
git diff --check
rg -n -i 'tesseract|CUSTOMER_OCR_ASSETS|/ocr/tesseract-v7|license-ocr' package.json package-lock.json src scripts tests --glob '!docs/**'
```

Expected: all tests pass; final `rg` returns no matches; the current onboarding E2E remains green through explicit scenarios; no default extraction succeeds.

- [ ] **Step 7: Obtain independent review and commit Task 1**

Use `superpowers:requesting-code-review` against the Task 1 diff. Resolve all Critical and Important findings, rerun Step 6, then commit only the listed files:

```bash
git add package.json package-lock.json
git add -A -- scripts/sync-customer-ocr-assets.mjs public/ocr/tesseract-v7 src/lib/customers/ocr-asset-manifest.ts src/lib/customers/ocr-asset-hashes.generated.ts src/lib/customers/license-ocr tests/unit/customer-license-ocr.spec.ts tests/collaboration/customer-ocr-assets.test.mjs
git add src/lib/customers/license-extraction src/lib/customers/onboarding-types.ts src/lib/customers/evidence-assets.ts src/lib/api/mock-customers.ts src/components/customers/customer-onboarding-state.ts src/components/customers/customer-onboarding-dialog.tsx src/components/customers/onboarding-license-step.tsx src/components/customers/license-image-editor.tsx tests/unit/customer-onboarding.spec.ts tests/unit/customer-license-extraction.spec.ts tests/collaboration/customer-license-extraction-boundary.test.mjs tests/e2e/customer-onboarding.spec.ts
git commit -m "refactor(customers): remove local license OCR"
```

### Task 2: Add the explicit Mock AI extraction experience and race-safe lifecycle

**Files:**
- Modify: `src/lib/customers/license-extraction/mock-client.ts`
- Modify: `src/lib/customers/license-extraction/browser-client.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/components/customers/customer-onboarding-state.ts`
- Modify: `src/components/customers/customer-onboarding-dialog.tsx`
- Modify: `src/components/customers/onboarding-license-step.tsx`
- Modify: `tests/unit/customer-license-extraction.spec.ts`
- Modify: `tests/unit/customer-onboarding-state.spec.ts`
- Modify: `tests/e2e/customer-onboarding.spec.ts`
- Modify: `tests/e2e/helpers/customer-onboarding.ts` only if the shared helper needs the renamed scenario type; do not add a second scenario mechanism.

**Interfaces:**
- Consumes: `LicenseExtractionClient`, explicit `licenseExtraction` scenarios, existing image/evidence transforms, and `CustomerOnboardingState` invalidation.
- Produces: `data-testid="onboarding-license-extract"`; mode values `ai | manual`; UI states `idle | running | success | error`; exact copy `AI辅助识别`, `识别中…`, `模拟 AI 辅助结果（仅演示）`, `AI辅助识别当前不可用，请对照原件手动填写`, and `重新尝试AI辅助识别`.

- [ ] **Step 1: Write RED UI and lifecycle tests**

Add deterministic tests that fail against the auto-run UI:

```ts
await page.getByTestId("onboarding-license-file").setInputFiles(SYNTHETIC_LICENSE);
await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
await page.getByTestId("onboarding-license-rotate-left").click();
await expect(page.getByTestId("onboarding-license-name")).toHaveValue("");
await page.getByTestId("onboarding-license-extract").click();
await expect(page.getByTestId("onboarding-license-name")).toHaveValue("Alicia Bennett");
await expect(page.getByTestId("onboarding-extraction-status"))
  .toContainText("模拟 AI 辅助结果（仅演示）");
```

Also cover: no-scenario click → unavailable/manual with blank fields; partial result → only present fields filled and others marked `manual_required`; error → retry button; manual edit during deferred extraction → abort and late result ignored; image/rotation/crop/mode/close/session change → late result ignored; explicit success never checks attestation or KYC.

- [ ] **Step 2: Run focused RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-extraction.spec.ts tests/unit/customer-onboarding-state.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts
```

Expected: failures show the missing explicit button/copy and current upload/rotate auto-extraction behavior.

- [ ] **Step 3: Implement the explicit AI action and states**

Rename UI mode `ocr` to `ai`. Upload, switching to AI, rotation, and crop only prepare/invalidate the image; none calls `extract()`. Render the button only in AI mode after a valid image exists. A click creates one `AbortController`, calls the injected client once, renders `识别中…`, and disables attestation while `running` (including progress `0`). Failure preserves all manual values and exposes retry. Success applies only safe present keys, renders the Mock disclosure, leaves `manual_required` fields editable, and never checks employee attestation.

- [ ] **Step 4: Enforce attempt ownership**

Rename attempt/ref/callback symbols from OCR to extraction. Before applying a result, require the same attempt ID, session identity, file key, and transform revision. Any manual field change cancels and invalidates the active attempt before updating the field. Cancel on image/mode/transform/close/session changes. Do not add a provider URL, API key, `fetch`, or real same-origin route in this task.

- [ ] **Step 5: Run GREEN and the behavior gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-license-extraction.spec.ts tests/unit/customer-onboarding-state.spec.ts tests/unit/customer-onboarding.spec.ts
npm run typecheck
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
git diff --check
```

Expected: all pass; existing phone/OTP/KYC/manual/create/response-loss tests remain green; no test uses `waitForTimeout`; default unconfigured upload never receives fabricated values.

- [ ] **Step 6: Obtain independent review and commit Task 2**

Use `superpowers:requesting-code-review`, resolve all Critical and Important findings, rerun Step 5, then commit:

```bash
git add src/lib/customers/license-extraction/mock-client.ts src/lib/customers/license-extraction/browser-client.ts src/lib/api/mock-customers.ts src/components/customers/customer-onboarding-state.ts src/components/customers/customer-onboarding-dialog.tsx src/components/customers/onboarding-license-step.tsx tests/unit/customer-license-extraction.spec.ts tests/unit/customer-onboarding-state.spec.ts tests/e2e/customer-onboarding.spec.ts tests/e2e/helpers/customer-onboarding.ts
git commit -m "feat(customers): add mock AI license extraction"
```

### Task 3: Lock the boundary and complete build, privacy, visual, and full regression acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-in-person-customer-onboarding.md`
- Modify: `tests/collaboration/customer-license-extraction-boundary.test.mjs`
- Modify: `tests/e2e/customer-onboarding.spec.ts`
- Create: `.superpowers/sdd/2026-08-14-external-ai-license-extraction-frontend/task-3-report.md`
- Reference unchanged: `docs/superpowers/specs/2026-08-13-in-person-customer-onboarding-design.md`
- Reference unchanged: `docs/superpowers/plans/2026-08-14-external-ai-license-extraction-frontend.md`

**Interfaces:**
- Consumes: Tasks 1–2 and approved spec `d576763`.
- Produces: an explicit superseded notice on the old local-OCR plan; automated no-runtime/no-secret/no-direct-provider/privacy boundaries; current-build desktop/430 evidence; complete gate/review report.

- [ ] **Step 1: Write the final boundary and privacy RED checks**

Extend the collaboration test to read both the approved spec and old plan. Require the spec to contain `LicenseExtractionClient`, the same-origin proxy boundary, and the no-provider-key rule. Require the old plan header to say that its Tesseract/local-OCR Tasks 1–3/7/8 are superseded by this new plan and must not be executed. Require active runtime/package sources to contain no old dependency/path, provider SDK, provider key literal, or direct provider URL. Keep historical text in the old plan allowed only below the superseded banner.

Extend E2E to parse `wh_customer_vehicle_mock_v1` after a successful explicit Mock flow. Assert only confirmed four fields and compressed evidence persist; recursively reject keys/tokens `rawText`, `confidence`, `blocks`, `hocr`, `tsv`, provider request IDs, processed images, extraction session data, object/blob URLs, and OTP code. Assert console, page URL, audit details, `sessionStorage`, and IndexedDB contain no extraction raw/provider data.

- [ ] **Step 2: Run final RED**

Run:

```bash
node --test tests/collaboration/customer-license-extraction-boundary.test.mjs
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts --grep "privacy|default unavailable"
```

Expected: the collaboration check fails until the old plan receives the superseded banner; any missing privacy assertion fails explicitly rather than silently passing.

- [ ] **Step 3: Add the superseded notice and close the boundary**

At the top of the 2026-08-13 plan, add a dated notice pointing to this plan and approved spec revision. Do not rewrite historical completed-task evidence. Tighten the collaboration and E2E checks from Step 1 until they pass. Do not change the approved spec unless a reviewer identifies a factual contradiction; any such change requires product-owner approval before editing.

- [ ] **Step 4: Run fresh build and complete automated gates**

From current `main`, with no reused server on port 3210, run and record counts/durations:

```bash
npm run typecheck
npm run test:collaboration
npm run test:unit
npm run build
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
git diff --check
```

Also record the E2E server PID, cwd, and port. A passing focused suite is not a substitute for these full gates.

- [ ] **Step 5: Perform visible desktop and 430 px reference comparison**

Open the current `/customers` product and compare it with the approved spec and the prior Task 7 references:

- `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/task-7/onboarding-desktop-1920x1080.png`
- `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/task-7/onboarding-mobile-430x932.png`

Capture current synthetic-only QA under `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/external-ai-license-extraction/` at 1440×900 and 430×932. Verify upload/preview/rotate/crop do not auto-extract; `AI辅助识别`, running, success disclosure, unavailable/manual, failure/retry, four fields, attestation, and fixed actions are visible; root width equals viewport; dialog scroll/focus/Escape/dirty close work; no console errors. Do not stage screenshots.

- [ ] **Step 6: Write the report and obtain final independent review**

The report must list commits, exact deleted bytes/files, no-new-dependency evidence, RED/GREEN commands, full counts/durations, server identity, privacy result, desktop/mobile paths, default-unavailable proof, known pure-Mock evidence warning, and remaining review findings. Use `superpowers:requesting-code-review`; resolve all Critical and Important findings and rerun Steps 4–5 after the final fix.

- [ ] **Step 7: Commit verified delivery and open the product**

```bash
git add docs/superpowers/plans/2026-08-13-in-person-customer-onboarding.md tests/collaboration/customer-license-extraction-boundary.test.mjs tests/e2e/customer-onboarding.spec.ts
git add -f .superpowers/sdd/2026-08-14-external-ai-license-extraction-frontend/task-3-report.md
git commit -m "test(customers): verify AI extraction boundary"
```

After the commit, run `git status --short --untracked-files=no`, confirm tracked clean, and open the verified `/customers` flow for product review. Report the exact URL/port and current visible state; do not claim real AI connectivity.

## Plan Self-Review

- Spec coverage: Task 1 covers dependency/runtime removal, safe DTO, image/evidence retention, default unavailable, no key/provider request, and explicit Mock-only success. Task 2 covers explicit UI, partial/manual fields, cancellation, stale-result protection, OTP/KYC/atomic-create preservation. Task 3 covers active-doc boundary, privacy, full gates, build, visual QA, independent review, and product opening.
- File/type consistency: every task uses `LicenseExtractionClient`, `LicenseExtractionResult`, `LicenseExtractionField`, `licenseExtraction`, `licenseExtractionCompleted`, `ai | manual`, and `onboarding-license-extract`; no later task refers to the deleted OCR interfaces.
- Scope: exactly three independently reviewable tasks; no real provider adapter, backend route, new dependency, real-image inference, or unrelated refactor.
- Completeness: no unresolved placeholders remain; every created/deleted/modified path, RED/GREEN command, review gate, and commit is explicit.
