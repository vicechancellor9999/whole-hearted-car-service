# Formal Customer Driver License Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-grade driver-license capture, recognition, verification, persistence, history, and follow-up states to formal personal customers and company primary contacts in the unified 3220 candidate.

**Architecture:** Extend the formal PostgreSQL customer domain with phone ownership and immutable driver-license records linked to `stored_files`. Add authenticated same-origin recognition and multipart persistence routes, then integrate a focused license section into the existing formal create/detail UI while preserving the current JSON customer-create contract.

**Tech Stack:** Next.js 16.3.2 Route Handlers, React 19.2.8, TypeScript 5.9.3, PostgreSQL 18, Drizzle ORM 0.45.2, Zod 4.4.3, Sharp 0.35.3, Vitest 4.1.11, Playwright 1.62.1.

**Spec:** `apps/web/docs/superpowers/specs/2026-08-27-formal-customer-driver-license-design.md`

## Global Constraints

- All generated files, uploads, database data, build output, screenshots, and caches remain under `/Volumes/公司文件`.
- Development and acceptance run only against the isolated 3220 candidate, PostgreSQL port 55433, and its candidate upload root.
- Current 3210, 3211, the current formal database, and the frozen backup are read-only for this work.
- PostgreSQL is the business source of truth; localStorage may not hold customer, license, verification, identity, or permission facts.
- Missing license evidence or incomplete profile data produces `待补`, `待核验`, or `需重新核验` and does not block customer creation.
- Supplied normalized phone values are unique across customer phone/WhatsApp fields and customer owners; supplied TRN values remain globally unique.
- Driver-license images, Base64, raw OCR, provider payloads, credentials, and full document fields never enter logs, audit JSON, URLs, or browser storage.
- Formal writes require server-side session, role, schema, transaction, audit, and storage-path validation.
- Existing JSON `POST /api/formal/customers` callers remain compatible.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before changing Route Handlers.

## Spec Coverage Map

- 个人客户建档、证件资料和缺项状态：Tasks 1, 3, 5, 6, 7.
- 公司客户与主要联系人、地址分离和联系人复用：Tasks 1, 2, 3, 5, 6, 7.
- 客户详情、补录、替换、历史和证据查看：Tasks 3, 5, 7.
- 正式识别、图片处理和 AI 隐私：Tasks 3, 4, 6.
- 电话身份唯一性与资料非阻断：Tasks 1, 2, 5, 6.
- 权限、审计、错误回滚和存储隔离：Tasks 3, 4, 5, 8.
- 数据迁移、兼容、自动测试与真实浏览器验收：Tasks 1, 5, 8.

---

### Task 1: Database schema and migration

**Files:**
- Modify: `src/db/schema/customer-vehicle.ts`
- Create: `drizzle/0025_customer_driver_license.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: generated `drizzle/meta/0025_snapshot.json`
- Modify: `src/db/schema/customer-vehicle.integration.test.ts`

**Interfaces:**
- Produces: `customerPhoneRegistry`, `customerDriverLicenseRecords`, `customerLicenseSubjectType`, and `customerLicenseStatus` Drizzle exports.
- Produces: nullable `personalCustomers.birthDate` and `personalCustomers.gender`.
- Preserves: existing customer/company/vehicle primary keys and current rows.

- [ ] **Step 1: Write failing integration assertions for the new schema**

Add assertions that `personal_customers` has `birth_date` and `gender`, `customer_phone_registry` and `customer_driver_license_records` exist, the current-record partial unique indexes exist, and the old `personal_customers_identity_present` constraint does not exist:

```ts
expect(columns).toEqual(expect.arrayContaining(["birth_date", "gender"]));
expect(tables).toEqual(expect.arrayContaining([
  "customer_phone_registry",
  "customer_driver_license_records",
]));
expect(constraints).not.toContain("personal_customers_identity_present");
```

- [ ] **Step 2: Run the focused schema test and verify RED**

Run: `pnpm exec vitest run src/db/schema/customer-vehicle.integration.test.ts`

Expected: FAIL because the columns, tables, enums, and indexes do not exist.

- [ ] **Step 3: Add Drizzle schema definitions**

Define the exact public types:

```ts
export const customerLicenseSubjectType = pgEnum("customer_license_subject_type", [
  "individual_customer",
  "organization_primary_contact",
]);
export const customerLicenseStatus = pgEnum("customer_license_status", [
  "pending_verification",
  "verified",
  "needs_reverification",
]);
```

Add `customerPhoneRegistry` with `normalizedPhone`, `ownerKind`, `ownerId`, and `registeredAt`. Add `customerDriverLicenseRecords` with the exact fields and constraints in the approved spec, including one current record per person/company and one record per `fileId`.

- [ ] **Step 4: Generate and inspect migration SQL**

Run: `pnpm db:generate`

Rename the generated migration to `drizzle/0025_customer_driver_license.sql` if needed. Add deterministic backfill SQL that normalizes existing person/company phone and WhatsApp values into `customer_phone_registry`. The migration must abort on cross-owner conflicts instead of selecting a winner.

- [ ] **Step 5: Run migration and schema tests on the isolated candidate database**

Run: `pnpm db:migrate`

Run: `pnpm exec vitest run src/db/schema/customer-vehicle.integration.test.ts`

Expected: PASS; migration applies once and a second `pnpm db:migrate` reports no pending migration.

- [ ] **Step 6: Commit the schema task**

```bash
git add src/db/schema/customer-vehicle.ts src/db/schema/customer-vehicle.integration.test.ts drizzle/0025_customer_driver_license.sql drizzle/meta/_journal.json drizzle/meta/0025_snapshot.json
git commit -m "feat: add formal customer license schema"
```

### Task 2: Phone ownership and optional identity

**Files:**
- Modify: `src/modules/customer-vehicle/customer-vehicle-schemas.ts`
- Create: `src/modules/customer-vehicle/customer-phone-registry.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-service.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-service.integration.test.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-schemas.test.ts`

**Interfaces:**
- Produces: `syncCustomerPhoneOwnership(executor, input)` and `findPhoneOwner(executor, normalizedPhone)`.
- `syncCustomerPhoneOwnership` consumes `{ ownerKind: "person" | "company"; ownerId: number; phones: Array<string | null> }` and performs transaction-local registry synchronization.
- Changes `createPersonalCustomerSchema` so both phone and TRN may be absent while retaining validation when supplied.

- [ ] **Step 1: Write failing schema and service tests**

Cover these cases explicitly:

```ts
expect(createPersonalCustomerSchema.parse({ fullName: "No Number" })).toMatchObject({
  fullName: "No Number",
  phone: null,
  trn: null,
});
```

Integration cases: same person uses one number for phone and WhatsApp; another person/company cannot reuse it; clearing a field releases only numbers no longer used by that owner; concurrent claims produce one success and one conflict.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run src/modules/customer-vehicle/customer-vehicle-schemas.test.ts src/modules/customer-vehicle/customer-vehicle-service.integration.test.ts`

Expected: FAIL on identity optionality and cross-field ownership.

- [ ] **Step 3: Implement the registry module**

Implement:

```ts
export async function syncCustomerPhoneOwnership(
  executor: AuthSqlExecutor,
  input: { ownerKind: "person" | "company"; ownerId: number; phones: Array<string | null> },
): Promise<void>;

export async function findPhoneOwner(
  executor: AuthSqlExecutor,
  normalizedPhone: string,
): Promise<{ ownerKind: "person" | "company"; ownerId: number } | null>;
```

Normalize before calling, deduplicate within the owner, lock registry rows in sorted number order, reject a different owner, upsert the current owner, and delete only stale numbers for the same owner.

- [ ] **Step 4: Wire registry synchronization into customer create/update transactions**

Call `syncCustomerPhoneOwnership` after the customer row has an ID and before commit for personal and company create/update. Map registry conflicts to `CustomerVehicleConflictError` with a user-safe message containing the conflicting customer number resolved inside the transaction.

- [ ] **Step 5: Run focused and regression tests**

Run: `pnpm exec vitest run src/modules/customer-vehicle/customer-vehicle-schemas.test.ts src/modules/customer-vehicle/customer-vehicle-service.integration.test.ts src/app/api/customers/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the identity task**

```bash
git add src/modules/customer-vehicle/customer-vehicle-schemas.ts src/modules/customer-vehicle/customer-phone-registry.ts src/modules/customer-vehicle/customer-vehicle-service.ts src/modules/customer-vehicle/customer-vehicle-service.integration.test.ts src/modules/customer-vehicle/customer-vehicle-schemas.test.ts
git commit -m "feat: enforce formal customer phone ownership"
```

### Task 3: Driver-license domain and immutable storage

**Files:**
- Create: `src/modules/customer-vehicle/customer-driver-license-schemas.ts`
- Create: `src/modules/customer-vehicle/customer-driver-license-storage.ts`
- Create: `src/modules/customer-vehicle/customer-driver-license-service.ts`
- Create: `src/modules/customer-vehicle/customer-driver-license-service.integration.test.ts`
- Create: `src/modules/customer-vehicle/customer-driver-license-storage.test.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-runtime.ts`

**Interfaces:**
- Produces: `CustomerDriverLicenseService.record`, `.replace`, `.history`, `.getFile`.
- Produces: `storeCustomerDriverLicenseUpload(file, transform, options)` and `removeStoredCustomerDriverLicenseUpload(storageKey, root?)`.
- Consumes: formal database executor, `stored_files`, `UPLOAD_ROOT`, staff actor context, and the four-field snapshot.

- [ ] **Step 1: Write failing storage tests**

Test JPEG/PNG MIME plus magic bytes, zero-byte/oversize rejection, 24 MP rejection, rotation/crop normalization, max 2400 px output, 5 MiB output limit, SHA-256, safe storage prefix, `flag: "wx"`, and cleanup.

Run: `pnpm exec vitest run src/modules/customer-vehicle/customer-driver-license-storage.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement prepared immutable evidence storage**

Expose:

```ts
export type CustomerLicenseImageTransform = {
  rotation: 0 | 90 | 180 | 270;
  crop: { x: number; y: number; width: number; height: number } | null;
};

export async function storeCustomerDriverLicenseUpload(
  file: File,
  transform: CustomerLicenseImageTransform,
  options?: { root?: string; now?: Date; uuid?: string },
): Promise<StoredCustomerDriverLicenseUpload>;
```

Use Sharp metadata before decode/output, orient, rotate, clamp crop to decoded bounds, resize with `withoutEnlargement`, encode JPEG or PNG, and write under `customer-license-files/YYYY/MM`.

- [ ] **Step 3: Write failing domain-service tests**

Cover record pending, record verified, missing verified actor/time rejection, exact subject ownership constraints, replace current record, history ordering, name change to `needs_reverification`, permissions, audit redaction, and transaction failure zero rows.

Run: `pnpm exec vitest run src/modules/customer-vehicle/customer-driver-license-service.integration.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement strict schemas and service methods**

Use these inputs:

```ts
type LicenseSubject =
  | { type: "individual_customer"; personalCustomerId: number }
  | { type: "organization_primary_contact"; companyAccountId: number; companyContactId: number | null; personalCustomerId: number | null };

type RecordLicenseInput = {
  subject: LicenseSubject;
  file: StoredCustomerDriverLicenseUpload;
  profile: { name: string; birthDate: string; sex: "M" | "F"; address: string };
  verified: boolean;
  context: CustomerVehicleActionContext;
};
```

Register `stored_files` and the license row in one transaction, use `requireReader`/`requireWriter` equivalents local to the service, supersede instead of update, and write redacted audit fields only.

- [ ] **Step 5: Expose the service from the runtime and pass focused tests**

Run: `pnpm exec vitest run src/modules/customer-vehicle/customer-driver-license-storage.test.ts src/modules/customer-vehicle/customer-driver-license-service.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the domain task**

```bash
git add src/modules/customer-vehicle/customer-driver-license-* src/modules/customer-vehicle/customer-vehicle-runtime.ts
git commit -m "feat: persist formal customer license evidence"
```

### Task 4: Authenticated driver-license recognition

**Files:**
- Create: `apps/web/src/lib/customers/customer-driver-license-recognition.ts`
- Create: `apps/web/src/lib/server/customer-driver-license-image.ts`
- Create: `apps/web/src/lib/server/customer-driver-license-recognizer.ts`
- Create: `apps/web/src/app/api/formal/customer-driver-license/recognize/route.ts`
- Create: `apps/web/tests/unit/customer-driver-license-recognition.spec.ts`
- Create: `apps/web/tests/unit/customer-driver-license-route.spec.ts`

**Interfaces:**
- Produces: `CustomerLicenseRecognition`, `validateCustomerLicenseRecognition`, and `recognizeCustomerDriverLicense`.
- Route consumes multipart `{ image, rotation, crop }`, formal session, and existing document-AI credential settings.
- Route returns only the four-field safe DTO and field status.

- [ ] **Step 1: Read the installed Next.js Route Handler guide**

Read: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`

Record no separate artifact; apply its current Request/FormData/Response conventions in the route tests and implementation.

- [ ] **Step 2: Write failing DTO, parser, and route tests**

Tests cover exact-key validation, future/invalid dates, sex values, address control characters, OpenAI structured response mapping, Google OCR mapping, missing fields, 401, 403, unsupported image, timeout, and sanitized 502.

Run: `pnpm --dir apps/web test:unit --grep "customer driver license"`

Expected: FAIL because the modules and route do not exist.

- [ ] **Step 3: Implement the strict recognition DTO**

Define:

```ts
export type CustomerLicenseRecognition = Readonly<{
  fields: Readonly<{ name: string | null; birthDate: string | null; sex: "M" | "F" | null; address: string | null }>;
  status: Readonly<Record<"name" | "birthDate" | "sex" | "address", "extracted" | "manual_required">>;
}>;
```

Reject extra keys and downgrade invalid individual fields to `manual_required` without returning guessed values.

- [ ] **Step 4: Implement provider adapters and authenticated route**

Use the existing server-held OpenAI/Google credential selection. OpenAI requests use `store: false`, strict JSON schema, and a prompt limited to the approved four fields. Google OCR text goes through a deterministic Jamaica driver-license parser. Require `super_admin` or `front_desk` before reading the image or invoking a provider.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --dir apps/web test:unit --grep "customer driver license"`

Expected: PASS with no secret, Base64, provider payload, or raw OCR in response snapshots.

- [ ] **Step 6: Commit the recognition task**

```bash
git add apps/web/src/lib/customers/customer-driver-license-recognition.ts apps/web/src/lib/server/customer-driver-license-* apps/web/src/app/api/formal/customer-driver-license/recognize/route.ts apps/web/tests/unit/customer-driver-license-*.spec.ts
git commit -m "feat: recognize formal customer licenses"
```

### Task 5: Compound formal customer create and supplement APIs

**Files:**
- Modify: `src/modules/customer-vehicle/customer-vehicle-schemas.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-service.ts`
- Modify: `src/app/api/customers/route.ts`
- Modify: `src/app/api/customers/route.test.ts`
- Create: `src/app/api/customers/[customerNo]/driver-license/route.ts`
- Create: `src/app/api/customers/[customerNo]/driver-license/route.test.ts`
- Create: `src/app/api/customers/[customerNo]/driver-license-history/route.ts`
- Create: `src/app/api/customer-driver-license-records/[recordId]/file/route.ts`
- Create: `src/modules/customer-vehicle/customer-compound-create.integration.test.ts`
- Create: `apps/web/src/app/api/formal/customers/[customerNo]/driver-license/route.ts`
- Create: `apps/web/src/app/api/formal/customers/[customerNo]/driver-license-history/route.ts`
- Create: `apps/web/src/app/api/formal/customer-driver-license-records/[recordId]/file/route.ts`

**Interfaces:**
- Extends `POST /api/customers` to accept existing JSON or multipart `{ payload, licenseFront? }`.
- Produces `createPersonalCustomerWithLicense` and `createCompanyWithPrimaryContact` transaction methods.
- Produces supplement/history/file formal routes with the contracts in the spec.

- [ ] **Step 1: Write failing API and integration tests**

Cover JSON compatibility, personal multipart verified/pending/missing evidence, company with new contact, company with confirmed existing contact, mutually exclusive contact inputs, no-contact company, address separation, duplicate phone, storage cleanup, audit events, and refresh-readable response.

Run: `pnpm exec vitest run src/app/api/customers/route.test.ts src/modules/customer-vehicle/customer-compound-create.integration.test.ts src/app/api/customers/\[customerNo\]/driver-license/route.test.ts`

Expected: FAIL on the new multipart and supplement contracts while existing JSON tests remain green.

- [ ] **Step 2: Implement strict payload parsing**

Detect `multipart/form-data`; parse `payload` as JSON with Zod; accept at most one `licenseFront`; validate `existingPersonalCustomerNo` xor `newPrimaryContact`; require all four profile fields before a license record can be stored; allow the entire license portion to be absent.

- [ ] **Step 3: Implement compound transactions**

Personal transaction: create person, synchronize phone registry, optionally register file/license, update `birth_date`/`gender`/address from verified snapshot, and audit. Company transaction: create company, resolve or create personal contact, establish unique primary contact, store company-scoped license evidence, preserve company address, and audit.

- [ ] **Step 4: Implement supplement/history/file routes**

Supplement writes a new immutable record and supersedes current in one transaction. History orders newest first. File route resolves the safe upload path, verifies reader permission before lookup, returns the recorded media type, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.

- [ ] **Step 5: Implement physical-file cleanup around database failures**

Store the prepared file before the service call; call `removeStoredCustomerDriverLicenseUpload` on any rejected transaction; do not delete after a committed transaction. Tests inject transaction and filesystem failures to prove no customer/license half-success and no orphan from rejected writes.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm exec vitest run src/app/api/customers/route.test.ts src/modules/customer-vehicle/customer-compound-create.integration.test.ts src/app/api/customers/\[customerNo\]/driver-license/route.test.ts`

Expected: PASS.

```bash
git add src/modules/customer-vehicle src/app/api/customers src/app/api/customer-driver-license-records apps/web/src/app/api/formal/customers apps/web/src/app/api/formal/customer-driver-license-records
git commit -m "feat: create customers with license evidence"
```

### Task 6: Formal create-dialog license workflow

**Files:**
- Create: `apps/web/src/components/customers/formal-customer-license-section.tsx`
- Create: `apps/web/src/lib/customers/formal-customer-license-client.ts`
- Modify: `apps/web/src/components/customers/formal-customer-create-dialog.tsx`
- Modify: `apps/web/src/lib/customers/formal-customer-create.ts`
- Modify: `apps/web/tests/unit/formal-customer-create.spec.ts`
- Create: `apps/web/tests/unit/formal-customer-license-client.spec.ts`
- Create: `apps/web/tests/e2e/formal-customer-license-create.spec.ts`

**Interfaces:**
- Produces reusable `FormalCustomerLicenseSection` with controlled file, transform, four fields, recognition state, attestation, and cleanup callbacks.
- `createFormalCustomer` sends JSON when no license/contact extension is used and multipart when formal license/contact data exists.

- [ ] **Step 1: Write failing client and E2E tests**

Unit tests verify exact multipart parts, safe error mapping, AbortController cancellation, late-response discard, and JSON compatibility. E2E covers visible personal/company scan labels, capture input, manual mode, missing summary, successful creation, and retained form after error.

Run: `pnpm --dir apps/web test:unit --grep "formal customer license|正式新建客户"`

Expected: FAIL for missing section/client while current JSON test still passes.

- [ ] **Step 2: Implement the formal recognition client**

Expose:

```ts
export async function recognizeFormalCustomerLicense(
  input: { file: File; transform: LicenseImageTransform; signal: AbortSignal },
  fetcher?: typeof fetch,
): Promise<CustomerLicenseRecognition>;
```

Import `LicenseImageTransform` from the existing `license-extraction/image-input.ts`. Send multipart to `/api/formal/customer-driver-license/recognize`, validate the safe DTO, and map 401/403/4xx/5xx to stable Chinese messages.

- [ ] **Step 3: Implement the controlled license section**

Reuse `LicenseImageEditor` for preview/rotation/crop. Show upload/camera, `AI 辅助识别`, manual entry, field status, and attestation. Revoke object URLs on replace/unmount; cancel recognition on file/transform/field/identity changes; apply a response only if attempt ID, session key, file revision, transform revision, and edit revision still match.

- [ ] **Step 4: Expand the formal create dialog**

Add the license section and missing-fact summary. Personal selection uses “扫描客户驾驶证”. Company selection adds primary-contact fields plus “扫描主要联系人驾驶证”; exact phone matches require explicit existing contact confirmation. License absence and identity absence do not disable submit.

- [ ] **Step 5: Extend the formal create client**

Keep the current JSON body for the old draft shape. Build multipart only when license/contact extension data exists. Map the returned formal person/company through the existing adapters and preserve backend conflict messages.

- [ ] **Step 6: Run unit and focused E2E tests**

Run: `pnpm --dir apps/web test:unit --grep "formal customer license|正式新建客户"`

Run: `pnpm --dir apps/web test:e2e -- formal-customer-license-create.spec.ts`

Expected: PASS at desktop and 430 px projects defined by the test.

- [ ] **Step 7: Commit the create UI task**

```bash
git add apps/web/src/components/customers/formal-customer-* apps/web/src/lib/customers/formal-customer-* apps/web/tests/unit/formal-customer-* apps/web/tests/e2e/formal-customer-license-create.spec.ts
git commit -m "feat: scan licenses during formal customer creation"
```

### Task 7: Customer detail status, supplement, and history

**Files:**
- Create: `apps/web/src/components/customers/formal-customer-license-card.tsx`
- Create: `apps/web/src/components/customers/formal-customer-license-dialog.tsx`
- Modify: `apps/web/src/components/customers/customer-detail-page.tsx`
- Modify: `apps/web/src/lib/customers/formal-customer-vehicle-adapter.ts`
- Create: `apps/web/tests/unit/formal-customer-license-detail.spec.ts`
- Create: `apps/web/tests/e2e/formal-customer-license-detail.spec.ts`

**Interfaces:**
- Adapter exposes `driverLicense: { status, current, historyCount }` for formal customer detail records.
- Card consumes formal read model and role; dialog reuses `FormalCustomerLicenseSection` and posts supplement multipart.

- [ ] **Step 1: Write failing adapter/UI/E2E tests**

Cover derived `待补`, `待核验`, `已核验`, `需重新核验`; individual/company titles; company address separation; owner read-only controls; front-desk supplement; replace/history; evidence headers; refresh and relogin persistence.

Run: `pnpm --dir apps/web test:unit --grep "formal customer license detail"`

Expected: FAIL because the formal read model and card do not exist.

- [ ] **Step 2: Extend formal read adapters and workspace payloads**

Map current license status and safe profile metadata from formal responses. Do not put file bytes or storage keys in workspace JSON. History and image are loaded only when the authorized user opens them.

- [ ] **Step 3: Implement the status card and supplement dialog**

Render the four fixed Chinese states, profile snapshot, verifier/time in Jamaica timezone, and actions by role. Use the shared section for new evidence; successful supplement reloads from the formal API and closes only after the new current record is readable.

- [ ] **Step 4: Implement history and evidence viewing**

List immutable records newest first with status and superseded metadata. Open the protected file URL in the existing evidence viewer without Base64 conversion or storage-key exposure.

- [ ] **Step 5: Run unit and E2E tests**

Run: `pnpm --dir apps/web test:unit --grep "formal customer license detail"`

Run: `pnpm --dir apps/web test:e2e -- formal-customer-license-detail.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the detail task**

```bash
git add apps/web/src/components/customers/formal-customer-license-* apps/web/src/components/customers/customer-detail-page.tsx apps/web/src/lib/customers/formal-customer-vehicle-adapter.ts apps/web/tests/unit/formal-customer-license-detail.spec.ts apps/web/tests/e2e/formal-customer-license-detail.spec.ts
git commit -m "feat: manage formal customer license history"
```

### Task 8: Full regression and browser acceptance

**Files:**
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`
- Create: `apps/web/docs/screenshots/formal-customer-license-personal-20260827.png`
- Create: `apps/web/docs/screenshots/formal-customer-license-company-20260827.png`
- Create: `apps/web/docs/screenshots/formal-customer-license-mobile-20260827.png`

**Interfaces:**
- Consumes all tasks.
- Produces verified candidate evidence and an updated continuation record.

- [ ] **Step 1: Run formatting, type, unit, integration, and build gates**

Run:

```bash
git diff --check
pnpm typecheck
pnpm typecheck:web
pnpm test
pnpm test:web:collaboration
pnpm test:web:unit
pnpm build
```

Expected: all exit 0.

- [ ] **Step 2: Run focused and full browser suites**

Run:

```bash
pnpm --dir apps/web test:e2e -- formal-customer-license-create.spec.ts formal-customer-license-detail.spec.ts
pnpm --dir apps/web test:e2e
```

Expected: all projects pass with no retry-only success.

- [ ] **Step 3: Verify listener and storage isolation**

Confirm 3220 is the unified Next.js listener, PostgreSQL is 55433, candidate `UPLOAD_ROOT` is under `/Volumes/公司文件`, and no request targets 3211. Record the exact listener PIDs and resolved paths in the continuation document without exposing credentials.

- [ ] **Step 4: Perform real browser acceptance on 3220**

With formal super admin/front desk/owner sessions and isolated test data, verify personal recognized create, company primary-contact create with different company/document addresses, missing-evidence create, AI failure manual fallback, supplement/replace/history, owner read-only, refresh, logout/login, and console logs. Save the three named screenshots.

- [ ] **Step 5: Reconcile database, files, audit, and UI**

For each accepted record, compare page state to `personal_customers`, `company_accounts`, `company_contacts`, `customer_phone_registry`, `customer_driver_license_records`, `stored_files`, the candidate upload file, and `audit_events`. Verify no Base64/raw OCR/provider payload appears in persisted JSON or logs.

- [ ] **Step 6: Update continuation and commit verification evidence**

Document commit SHAs, commands and pass counts, browser URLs/titles, database/attachment isolation, accepted cases, and any remaining non-feature blocker.

```bash
git add docs/CONTINUATION_ENTRYPOINT.md apps/web/docs/screenshots/formal-customer-license-*.png
git commit -m "test: verify formal customer license workflow"
```

- [ ] **Step 7: Final repository readback**

Run:

```bash
git status --short --branch
git log --oneline --decorate -10
git diff fa5f236..HEAD --check
```

Expected: clean task worktree, only task-owned commits, and no whitespace errors.
