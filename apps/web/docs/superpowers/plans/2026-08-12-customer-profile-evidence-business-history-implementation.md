# Customer Profile Evidence and Business History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every bilingual customer name, formal profile field, verification state, customer/vehicle link, and financial summary traceable to one maintainable Mock fact chain, including a fully reconciling Alicia Bennett UAT archive.

**Architecture:** Add three pure foundations first: deterministic name transliteration, append-only verification evidence, and one canonical customer/vehicle identity catalog. Upgrade the customer store from schema v2 to v3 and Linked Operations from v3 to v4 without changing either storage key or clearing user data. Customer and vehicle pages consume typed Mock API DTOs; all business totals are derived by stable IDs from BO, latest Invoice version, Payment, and Refund records.

**Tech Stack:** Next.js 14.2.5, React 18.3.1, TypeScript 5.5.4, Tailwind CSS 3.4.7, Playwright 1.54, `pinyin-pro@3.28.1`, and `pdf-lib@1.17.1`.

## Global Constraints

- Work only in `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main` on `main`; do not create a branch or worktree.
- Before generating code or assets, verify `/Volumes/公司文件` is mounted and writable. Never create a persistent fallback copy on Macintosh HD.
- The approved source of truth is `docs/superpowers/specs/2026-08-12-customer-profile-evidence-business-history-design.md`; its customer-profile decisions override the older archive sections in `docs/superpowers/specs/2026-08-10-orders-documents-billing-archives-design.md`.
- Keep the implementation pure Mock: no real SMS, OCR, translation API, object storage, database, or independent Invoice route.
- Driver-license profile extraction is limited to name, birth date, sex, and address. The real reference licence supplied on 2026-08-13 is layout-only and must never enter the repository. The synthetic seed may use a deterministic four-field Mock extraction; arbitrary uploads require editable human confirmation and must never claim real OCR.
- Keep storage keys `wh_customer_vehicle_mock_v1` and `wh_linked_operations_state_v1`; migrate their envelope versions in place and never call `localStorage.removeItem`, silently reseed a valid legacy envelope, or overwrite the original serialized value after a migration write failure.
- Preserve user-created customers, vehicles, relationships, notes, verification history, communications, acknowledgements, reassignments, and audit events.
- Customer, vehicle, BO, Invoice, Payment, and Refund associations use stable IDs only. A display name, phone number, plate text, or snapshot must never determine ownership.
- Verification history is append-only. A current status is derived from records and evidence; no evidence means `evidence_missing`, never “verified”.
- Formal customer details contain only editable facts or named audit facts. Remove free tags, extra personal contacts, static business summaries, manual risk level, source, recent-business fields, active-business count, and risk note from the v3 model and UI.
- Preserve the existing blue-gray responsive visual system. The customer detail order is identity, formal details, verification evidence, vehicles, business summary, business history, then risk, notes, and audit history.
- Every task must leave `npm run typecheck` green before commit. Do not commit generated `.next`, `test-results`, Playwright browser data, or temporary evidence blobs.
- A page-behavior task is incomplete until its unit/API tests and the affected E2E test pass. The final gate includes the full unit, collaboration, E2E, build, and whitespace checks.
- E2E commands assume Playwright starts the configured server on 3210 when none exists. If a verified app server is already listening there, add `E2E_REUSE_SERVER=1`; do not start a second process on the same port.

## Delivery Order

1. **Pure foundations:** Tasks 1–3 add transliteration, evidence rules, and canonical identity catalogs without changing pages.
2. **Customer archive:** Tasks 4–7 migrate the customer store, replace the customer form, and implement evidence-backed verification UI.
3. **Business fact chain:** Tasks 8–9 migrate Linked Operations, seed Alicia's real ledger, and expose shared derived business profiles.
4. **Page integration:** Task 10 wires customer/vehicle pages, lists, and stable return navigation to those APIs.
5. **Acceptance gate:** Task 11 exercises desktop, 430px, accessibility, persistence, and the full repository checks.

---

### Task 1: Build the Versioned Offline Name-Transliteration Domain

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/customers/name-dictionary.ts`
- Create: `src/lib/customers/name-transliteration.ts`
- Modify: `src/lib/customers/bilingual.ts`
- Create: `tests/unit/customer-name-transliteration.spec.ts`

**Interfaces:**

- Consumes: one user-entered personal name and the approved full-name dictionary.
- Produces: a canonical `CustomerNameResult` or the stable error code `CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED`.
- Compatibility boundary: `bilingual.ts` may re-export the new exact helpers during migration, but its surname-only fallback must be deleted.

- [ ] **Step 1: Install the two exact, reviewed dependencies**

Run:

```bash
npm install --save-exact pinyin-pro@3.28.1 pdf-lib@1.17.1
```

Expected: `package.json` and `package-lock.json` record exact versions; no caret ranges are added.

- [ ] **Step 2: Write the RED transliteration tests**

```ts
import { describe, expect, test } from "@playwright/test";
import {
  CustomerNameTransliterationError,
  transliterateCustomerName,
} from "../../src/lib/customers/name-transliteration";

test("formats Chinese surnames and given names without tone marks", () => {
  expect(transliterateCustomerName("陈志远")).toMatchObject({
    sourceScript: "zh",
    sourceValue: "陈志远",
    nameZh: "陈志远",
    nameEn: "Chen Zhiyuan",
    method: "offline_pinyin",
    version: "customer-name-v1",
    status: "confirmed",
  });
  expect(transliterateCustomerName("欧阳娜娜").nameEn).toBe("Ouyang Nana");
});

test("uses an exact full-name dictionary for English input", () => {
  expect(transliterateCustomerName("  alicia BENNETT ")).toMatchObject({
    sourceScript: "en",
    sourceValue: "Alicia Bennett",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    method: "exact_name_dictionary",
  });
});

test("never reduces an unknown English full name to one surname character", () => {
  expect(() => transliterateCustomerName("Jason Wong")).toThrow(
    new CustomerNameTransliterationError(
      "当前纯 Mock 音译库没有该完整姓名",
      "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED",
    ),
  );
});

test("rejects blank, mixed-script, numeric, and unsupported Chinese input", () => {
  for (const value of ["", "王 David", "Alicia 2", "陈🙂"]) {
    expect(() => transliterateCustomerName(value)).toThrow(
      CustomerNameTransliterationError,
    );
  }
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-name-transliteration.spec.ts
```

Expected: FAIL because the transliteration modules and exports do not exist.

- [ ] **Step 4: Implement the exact public types and error**

```ts
export const CUSTOMER_TRANSLITERATION_VERSION = "customer-name-v1" as const;

export type NameSourceScript = "zh" | "en";
export type TransliterationMethod = "offline_pinyin" | "exact_name_dictionary";

export interface CustomerNameResult {
  readonly sourceScript: NameSourceScript;
  readonly sourceValue: string;
  readonly nameZh: string | null;
  readonly nameEn: string;
  readonly method: TransliterationMethod;
  readonly version: typeof CUSTOMER_TRANSLITERATION_VERSION;
  readonly status: "confirmed";
}

export class CustomerNameTransliterationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED"
      | "CUSTOMER_NAME_SCRIPT_INVALID",
  ) {
    super(message);
  }
}

export function transliterateCustomerName(input: string): CustomerNameResult;
```

`transliterateCustomerName()` returns confirmed results only. `needs_transliteration_review` and `needs_profile_review` are persisted legacy-review states defined in Task 4 and can never be emitted by a new-name preview.

Implementation rules:

- Normalize Unicode and surrounding whitespace before script detection.
- Define an explicit `COMPOUND_SURNAMES` set containing the supported common compound surnames, including `欧阳`, `司马`, `上官`, `诸葛`, `东方`, `皇甫`, `尉迟`, `公孙`, `慕容`, and `司徒`. `splitChinesePersonalName()` chooses a matching two-character surname before falling back to the first character; add `欧阳娜娜` and `司马光` boundary tests.
- For Chinese, consult an approved exact override first, then use `pinyin-pro` with `toneType: "none"`, `type: "array"`, and `surname: "head"`; transliterate the surname slice and given-name slice separately, add one space between them, and join all given-name syllables without spaces.
- Fail when the library leaves any source character unresolved.
- For English, normalize internal spaces and case for lookup but return the dictionary's canonical capitalization.
- The dictionary must include Alicia Bennett, all 20 current English demo people, the three current organization contacts, every named `ORDER_DEMO_SEED` fixture, and the ten existing Chinese-name pairs. The ten Chinese canonical pairs are `陈志远/Chen Zhiyuan`, `林美华/Lin Meihua`, `黄国强/Huang Guoqiang`, `李秀兰/Li Xiulan`, `张伟明/Zhang Weiming`, `吴雅婷/Wu Yating`, `周建华/Zhou Jianhua`, `郑丽珍/Zheng Lizhen`, `何俊杰/He Junjie`, and `罗淑芬/Luo Shufen`.
- Never implement surname-only lookup.

- [ ] **Step 5: Add a dictionary round-trip invariant test**

```ts
import { APPROVED_FULL_NAME_PAIRS } from "../../src/lib/customers/name-dictionary";

test("every approved full-name pair round-trips through one canonical tuple", () => {
  for (const pair of APPROVED_FULL_NAME_PAIRS) {
    const fromEnglish = transliterateCustomerName(pair.en);
    expect(fromEnglish.nameZh).toBe(pair.zh);
    expect(fromEnglish.nameEn).toBe(pair.en);

    const fromChinese = transliterateCustomerName(pair.zh);
    expect(fromChinese.nameZh).toBe(pair.zh);
    expect(fromChinese.nameEn).toBe(pair.en);
  }
});
```

- [ ] **Step 6: Run the task gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-name-transliteration.spec.ts
npm run typecheck
```

Expected: both commands pass; `Jason Wong` and `Alice Chin` have no fallback result.

- [ ] **Step 7: Commit the name domain**

```bash
git add package.json package-lock.json src/lib/customers/name-dictionary.ts src/lib/customers/name-transliteration.ts src/lib/customers/bilingual.ts tests/unit/customer-name-transliteration.spec.ts
git commit -m "feat(customers): add safe offline name transliteration"
```

### Task 2: Define Evidence Assets and Append-Only Verification Rules

**Files:**

- Create: `src/lib/customers/verification-types.ts`
- Create: `src/lib/customers/verification-domain.ts`
- Create: `src/lib/customers/evidence-assets.ts`
- Create: `src/lib/customers/agreement-pdf.ts`
- Create: `src/lib/customers/phone.ts`
- Create: `tests/unit/customer-verification-domain.spec.ts`
- Create: `tests/unit/customer-evidence-assets.spec.ts`

**Interfaces:**

- Consumes: evidence metadata, the current primary phone, current agreement version, and append-only verification records.
- Produces: evidence validation, deterministic current statuses, and a real signed-agreement PDF asset.
- Maximum persisted runtime asset size: `524_288` bytes.

- [ ] **Step 1: Write RED status and evidence tests**

```ts
test("a verified OTP becomes needs_reverification when the primary phone changes", () => {
  const archive = otpArchive({ phoneE164: "+18765550101", verifiedAt: NOW });
  expect(deriveOtpVerification(archive, "+18765550101").status).toBe("verified");
  expect(deriveOtpVerification(archive, "+18765550999").status).toBe(
    "needs_reverification",
  );
});

test("normalizes equivalent Jamaica phone formatting before OTP comparison", () => {
  expect(normalizePhoneE164("+1 876 555 0101")).toBe("+18765550101");
  expect(normalizePhoneE164("(876) 555-0101", "JM")).toBe("+18765550101");
  expect(formatPhoneE164("+18765550101")).toBe("+1 876 555 0101");
  expect(
    deriveOtpVerification(otpArchive({ phoneE164: "+18765550101" }), "+1 876 555 0101").status,
  ).toBe("verified");
});

test("legacy completion without an evidence record is evidence_missing", () => {
  expect(deriveKycVerification(legacyGapArchive("kyc")).status).toBe(
    "evidence_missing",
  );
  expect(
    deriveAgreementVerification(legacyGapArchive("agreement"), "1.3").status,
  ).toBe("evidence_missing");
});

test("invalidating OTP preserves its verified history", () => {
  const archive = archiveWithInvalidatedOtp();
  expect(archive.otpRecords).toHaveLength(1);
  expect(archive.otpRecords[0]).toMatchObject({
    verifiedAt: NOW,
    invalidatedAt: LATER,
    invalidationReason: "号码无法接通",
  });
  expect(deriveOtpVerification(archive, "+18765550101").status).toBe(
    "needs_reverification",
  );
});

test("rejects blob URLs, unsupported MIME types, and oversized assets", () => {
  expect(() => validateEvidenceAsset(asset({ url: "blob:temporary" }))).toThrow(
    /EVIDENCE_ASSET_INVALID/,
  );
  expect(() => validateEvidenceAsset(asset({ mimeType: "text/plain" }))).toThrow(
    /EVIDENCE_ASSET_INVALID/,
  );
  expect(() => validateEvidenceAsset(asset({ sizeBytes: 524_289 }))).toThrow(
    /EVIDENCE_ASSET_INVALID/,
  );
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-evidence-assets.spec.ts
```

Expected: FAIL because the evidence and verification modules do not exist.

- [ ] **Step 3: Implement the exact archive model**

```ts
export interface EvidenceAsset {
  readonly id: string;
  readonly fileName: string;
  readonly url: string;
  readonly mimeType: "image/jpeg" | "image/png" | "application/pdf";
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly createdBy: string;
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

export interface KycVerificationRecord {
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

export interface VerificationEvidenceGap {
  readonly kind: "otp" | "kyc" | "agreement";
  readonly legacyCompletedAt: string | null;
  readonly legacyAgreementVersion?: string;
  readonly reason: "legacy_completion_without_evidence";
  readonly migratedAt: string;
}

export interface CustomerVerificationArchive {
  readonly otpRecords: readonly OtpVerificationRecord[];
  readonly kycRecords: readonly KycVerificationRecord[];
  readonly agreementRecords: readonly AgreementRecord[];
  readonly evidenceGaps: readonly VerificationEvidenceGap[];
}
```

Status functions must return these unions and the active record, if any:

```ts
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
export type AgreementStatus =
  | "pending"
  | "signed"
  | "expired"
  | "evidence_missing";

export function deriveOtpVerification(
  archive: CustomerVerificationArchive,
  currentPhoneE164: string | null,
): OtpVerificationView;
export function deriveKycVerification(
  archive: CustomerVerificationArchive,
): KycVerificationView;
export function deriveAgreementVerification(
  archive: CustomerVerificationArchive,
  currentAgreementVersion: string,
): AgreementVerificationView;

export function normalizePhoneE164(
  input: string,
  defaultRegion?: "JM",
): string;
export function formatPhoneE164(input: string): string;
```

`normalizePhoneE164` accepts a leading `+` international value or Jamaica's ten-digit/national display form, removes display punctuation, validates 8–15 digits after `+`, and returns one canonical E.164 string. It rejects extensions, letters, and ambiguous lengths. OTP records always persist this canonical value; formal-profile `CustomerRecord.phone` also stores canonical E.164 after create/update. UI uses `formatPhoneE164` only for display. All OTP status comparisons normalize both sides, so `+1 876 555 0101` and `+18765550101` are the same number.

- [ ] **Step 4: Implement persistent evidence helpers and signed PDF generation**

```ts
export const MAX_EVIDENCE_ASSET_BYTES = 524_288;

export async function createEvidenceAssetFromFile(
  file: File,
  actorId: string,
  clock: () => string,
): Promise<EvidenceAsset>;

export async function createSignedAgreementPdf(input: {
  customerDisplayName: string;
  agreementVersion: string;
  signedBy: string;
  signedAt: string;
  signatureAsset: EvidenceAsset;
  actorId: string;
}): Promise<EvidenceAsset>;
```

`createEvidenceAssetFromFile` must convert accepted runtime files to persistent `data:` URLs, compress JPEG/PNG input until the final decoded size is at most 512 KiB, reject `blob:` URLs, and reject an image if it still cannot meet the limit. `createSignedAgreementPdf` must use `pdf-lib` to create an actual `%PDF-` document containing the agreement version, customer, signer, timestamp, and embedded signature; it returns an `application/pdf` data URL validated by the same size rule.

The generic validator checks only URL persistence, decoded byte size, and the global MIME union. Context validators are stricter: `validateKycEvidence` accepts JPEG/PNG only; an electronic agreement requires a PNG signature and a PDF signed document; a paper scan accepts JPEG/PNG/PDF. Add negative tests for a PDF submitted as KYC, JPEG submitted as an electronic signature, and an image submitted as the signed electronic document.

- [ ] **Step 5: Add agreement-medium invariants**

```ts
test("electronic agreement needs both signature and signed PDF", () => {
  expect(() => validateAgreementRecord(electronicAgreement({ signedDocumentAsset: undefined }))).toThrow(
    /AGREEMENT_EVIDENCE_REQUIRED/,
  );
});

test("paper agreement needs a scan or both physical archive fields", () => {
  expect(() => validateAgreementRecord(paperAgreement({}))).toThrow(
    /AGREEMENT_EVIDENCE_REQUIRED/,
  );
  expect(() => validateAgreementRecord(paperAgreement({
    physicalRecordNumber: "PAPER-2026-001",
    physicalStorageLocation: "前台档案柜 A-03",
  }))).not.toThrow();
});
```

- [ ] **Step 6: Run the task gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-evidence-assets.spec.ts
npm run typecheck
```

Expected: both commands pass; a PDF asset starts with `data:application/pdf;base64,` and all invalid evidence produces code `EVIDENCE_ASSET_INVALID`.

- [ ] **Step 7: Commit the verification primitives**

```bash
git add src/lib/customers/verification-types.ts src/lib/customers/verification-domain.ts src/lib/customers/evidence-assets.ts src/lib/customers/agreement-pdf.ts src/lib/customers/phone.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-evidence-assets.spec.ts
git commit -m "feat(customers): define evidence-backed verification"
```

### Task 3: Establish One Canonical Customer, Vehicle, and Order Identity Catalog

**Files:**

- Create: `src/lib/customers/canonical-identities.ts`
- Modify: `src/lib/api/mock-bulk-seed.ts`
- Modify: `src/lib/orders/seed.ts`
- Create: `tests/unit/canonical-customer-identities.spec.ts`
- Modify: `tests/unit/orders-api.spec.ts`

**Interfaces:**

- Consumes: deterministic seed index and the canonical full-name dictionary from Task 1.
- Produces: immutable customer, vehicle, relationship, and operation identity catalogs shared by both Mock stores.
- Does not yet migrate persisted Linked Operations; that happens in Task 8.

- [ ] **Step 1: Write the RED catalog-integrity tests**

```ts
test("every operation identity references a canonical customer and vehicle", () => {
  const customerIds = new Set(CANONICAL_CUSTOMERS.map((item) => item.id));
  const vehicleIds = new Set(CANONICAL_VEHICLES.map((item) => item.id));

  for (const operation of CANONICAL_OPERATIONS) {
    expect(customerIds.has(operation.customerId), operation.orderId).toBe(true);
    expect(vehicleIds.has(operation.vehicleId), operation.orderId).toBe(true);
  }
});

test("Alicia owns exactly the fourteen reserved demo operations", () => {
  const alicia = CANONICAL_OPERATIONS.filter(
    (item) => item.customerId === "CUST-UAT-001",
  );
  expect(alicia.map((item) => item.orderId)).toEqual(
    Array.from({ length: 14 }, (_, index) => `order-demo-${index + 11}`),
  );
  expect(new Set(alicia.map((item) => item.vehicleId))).toEqual(
    new Set(["VEH-UAT-001"]),
  );
});

test("preserves the first ten identity anchors while normalizing bilingual names", () => {
  const operation = operationIdentityForSequence(1);
  expect(operation).toEqual({
    sequence: 1,
    orderId: "order-demo-01",
    customerId: "CUST-BULK-001",
    vehicleId: "VEH-BULK-001",
  });
  expect(canonicalCustomerById(operation.customerId).contactName).toMatchObject({
    nameZh: "陈美玲",
    nameEn: "Chen Meiling",
  });
  expect(canonicalVehicleById(operation.vehicleId).plate).toBe("8765 JZ");
});

test("does not declare an independent demo customer directory", () => {
  expect(ORDER_DEMO_SEED_META).not.toHaveProperty("kind", "independent_demo");
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/canonical-customer-identities.spec.ts tests/unit/orders-api.spec.ts
```

Expected: FAIL because the canonical catalog does not exist and orders still generate `customer-demo-*` and `vehicle-demo-*` identities.

- [ ] **Step 3: Implement the catalog contracts**

```ts
export interface CanonicalCustomerIdentity {
  readonly id: string;
  readonly kind: "individual" | "organization";
  readonly organizationName: string | null;
  readonly contactName: CustomerNameResult;
  readonly phone: string | null;
  readonly email: string | null;
}

export interface CanonicalVehicleIdentity {
  readonly id: string;
  readonly currentCustomerId: string;
  readonly plate: string;
  readonly modelZh: string | null;
  readonly modelEn: string;
}

export interface CanonicalOperationIdentity {
  readonly sequence: number;
  readonly orderId: string;
  readonly customerId: string;
  readonly vehicleId: string;
}

export interface CanonicalRelationshipIdentity {
  readonly id: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export const CANONICAL_CUSTOMERS: readonly CanonicalCustomerIdentity[];
export const CANONICAL_VEHICLES: readonly CanonicalVehicleIdentity[];
export const CANONICAL_RELATIONSHIPS: readonly CanonicalRelationshipIdentity[];
export const CANONICAL_OPERATIONS: readonly CanonicalOperationIdentity[];
export function canonicalCustomerById(id: string): CanonicalCustomerIdentity;
export function canonicalVehicleById(id: string): CanonicalVehicleIdentity;
export function operationIdentityForSequence(
  sequence: number,
): CanonicalOperationIdentity;
```

Catalog rules:

- `CUST-UAT-001` is `Alicia Bennett / 艾丽西亚·贝内特`; keep the existing Bennett email and family identity.
- `VEH-UAT-001` belongs to `CUST-UAT-001`.
- Preserve the explicit historical Alicia relationship to `VEH-UAT-003` in `CANONICAL_RELATIONSHIPS`; this is the acceptance fixture for a valid historical `fromCustomerId` return source.
- Reserve `order-demo-11` through `order-demo-24` for Alicia.
- Keep the Chinese identity, plate, BO/IR/Invoice IDs, and other business anchors of `order-demo-01` through `order-demo-10`, but normalize their English side under the approved v1 rule and use existing `CUST-BULK-*` and `VEH-BULK-*` master IDs. For example, the old `陈美玲 / Meiling Chen` snapshot becomes `陈美玲 / Chen Meiling`.
- Map every remaining generated operation to a catalog customer and vehicle; do not create another customer or vehicle inside `orders/seed.ts`.
- Preserve current global seed cardinalities and stable BO/IR/Invoice/document IDs so existing deep links remain valid.

- [ ] **Step 4: Make both seed builders consume the catalog**

Keep all existing financial, workflow, mechanic, and timestamp inputs in `SeedInput`, but make the identity fields explicit and separated:

```ts
export interface SeedInput {
  readonly sequence: number;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly customerNameZh: string | null;
  readonly customerNameEn: string;
  readonly phone: string;
  readonly plate: string;
  readonly modelZh: string | null;
  readonly modelEn: string;
  readonly laborName: string;
  readonly laborJmd: number;
  readonly partName?: string;
  readonly partsJmd?: number;
  readonly parkingFeeJmd?: number;
  readonly payments?: readonly { id: string; amountJmd: number }[];
  readonly refunds?: readonly { id: string; amountJmd: number }[];
  readonly teamId?: OrderTeamId;
  readonly mechanicNames?: readonly string[];
  readonly acceptedAt?: string;
  readonly returnedAt?: string;
  readonly submittedAt?: string;
  readonly pickedUpAt?: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}
```

`operationIdentityForSequence()` supplies only the master IDs; `canonicalCustomerById()` and `canonicalVehicleById()` supply separated name/model fields. Delete all internal `customer-demo-${sequence}` and `vehicle-demo-${sequence}` construction. Change `src/lib/api/mock-bulk-seed.ts` to obtain customer and vehicle facts from the canonical catalogs, never by separately choosing names or models.

Dependency direction is one-way: `canonical-identities.ts` owns its deterministic primitive arrays and imports only customer domain types; `mock-bulk-seed.ts` and `orders/seed.ts` import the canonical catalog. The canonical module must not import either seed builder, preventing an initialization cycle.

- [ ] **Step 5: Add a full bilingual seed invariant**

```ts
test("every bilingual canonical personal name is produced by one approved rule", () => {
  for (const customer of CANONICAL_CUSTOMERS) {
    const name = customer.contactName;
    expect(transliterateCustomerName(name.sourceValue)).toEqual(name);
  }
});
```

- [ ] **Step 6: Run the task gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/canonical-customer-identities.spec.ts tests/unit/orders-api.spec.ts
npm run typecheck
```

Expected: both pass; repository search finds no generated `customer-demo-` or `vehicle-demo-` identity values and no `independent_demo` seed kind.

- [ ] **Step 7: Commit the canonical catalog**

```bash
git add src/lib/customers/canonical-identities.ts src/lib/api/mock-bulk-seed.ts src/lib/orders/seed.ts tests/unit/canonical-customer-identities.spec.ts tests/unit/orders-api.spec.ts
git commit -m "refactor(mock): share canonical customer vehicle identities"
```

### Task 4: Migrate the Customer Store to Schema v3 and Replace the Customer Form

**Files:**

- Modify: `src/lib/customers/types.ts`
- Create: `src/lib/customers/migrations.ts`
- Modify: `src/lib/customers/selectors.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/components/customers/form-dialogs.tsx`
- Modify: `src/components/customers/customer-detail-page.tsx`
- Modify: `src/components/customers/vehicle-detail-page.tsx`
- Modify: `src/components/customers/customer-list.tsx`
- Modify: `src/components/customers/vehicle-list.tsx`
- Modify: `src/components/customers/customers-workspace.tsx`
- Modify: `src/components/customers/vehicles-workspace.tsx`
- Modify: `src/components/customers/customer-workspace.tsx`
- Modify: `src/components/customers/badges.tsx`
- Modify: `src/components/customers/detail-shared.tsx`
- Modify: `src/components/customers/verification-risk-sections.tsx`
- Create: `tests/unit/customer-migrations.spec.ts`
- Modify: `tests/unit/customers-store.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**

- Consumes: canonical identities, `CustomerNameResult`, `CustomerVerificationArchive`, and genuine v1/v2 serialized envelopes.
- Produces: strict customer/vehicle schema v3, a name-preview confirmation contract, one formal-profile edit flow, derived risk, and compact audit events.
- Storage key remains `wh_customer_vehicle_mock_v1`; envelope `schemaVersion` becomes `3`.

- [ ] **Step 1: Write genuine legacy migration RED tests**

Use literal fixtures that omit all fields introduced after each historical version; do not create a current envelope and merely change its version number.

```ts
test("migrates a genuine v2 Alicia tuple without resetting user records", () => {
  const legacy = genuineV2Envelope({
    customers: [
      legacyAlicia({ id: "CUST-UAT-001", name: "Alicia Bennett", nameZh: "黄艾丽" }),
      legacyUserCustomer({ id: "CUST-USER-991" }),
    ],
  });

  const migrated = migrateCustomerVehicleEnvelope(legacy, MIGRATED_AT);
  expect(migrated?.schemaVersion).toBe(3);
  expect(migrated?.state.customers).toHaveLength(2);
  expect(migrated?.state.customers[0]).toMatchObject({
    nameSourceScript: "en",
    nameSourceValue: "Alicia Bennett",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    transliterationStatus: "confirmed",
  });
});

test("keeps unknown legacy English names single-language for review", () => {
  const migrated = migrateCustomerVehicleEnvelope(
    genuineV2Envelope({ customers: [legacyEnglishCustomer("Jason Wong")] }),
    MIGRATED_AT,
  );
  expect(migrated?.state.customers[0]).toMatchObject({
    nameSourceValue: "Jason Wong",
    nameZh: null,
    nameEn: "Jason Wong",
    transliterationStatus: "needs_transliteration_review",
  });
});

test("turns unsupported legacy completion into evidence gaps without inventing evidence", () => {
  const migrated = migrateCustomerVehicleEnvelope(
    genuineV2Envelope({ customers: [legacyVerifiedCustomer()] }),
    MIGRATED_AT,
  );
  const customer = migrated!.state.customers[0];
  expect(customer.verificationArchive.otpRecords).toEqual([]);
  expect(customer.verificationArchive.kycRecords).toEqual([]);
  expect(customer.verificationArchive.agreementRecords).toEqual([]);
  expect(customer.verificationArchive.evidenceGaps.map((gap) => gap.kind)).toEqual([
    "otp",
    "kyc",
    "agreement",
  ]);
});

test("migration is idempotent and preserves the raw string when persistence fails", () => {
  const storage = storageThatThrowsOnSet(JSON.stringify(genuineV2Envelope()));
  const store = createMockCustomerVehicleStore({ storage });
  const workspace = store.workspace(superadmin);
  expect(workspace.customers.some((customer) => customer.id === "CUST-USER-991")).toBe(true);
  expect(storage.getItem("wh_customer_vehicle_mock_v1")).toBe(storage.originalValue);

  const once = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT);
  expect(migrateCustomerVehicleEnvelope(once, MIGRATED_AT)).toEqual(once);
});
```

- [ ] **Step 2: Run the migration tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts
```

Expected: FAIL because the v3 model, true legacy guards, and migration entry point do not exist.

- [ ] **Step 3: Replace the public customer model with the v3 facts**

```ts
export type StoredCustomerName =
  | {
      readonly nameSourceScript: NameSourceScript;
      readonly nameSourceValue: string;
      readonly nameZh: string;
      readonly nameEn: string;
      readonly transliterationMethod: TransliterationMethod;
      readonly transliterationVersion: typeof CUSTOMER_TRANSLITERATION_VERSION;
      readonly transliterationStatus: "confirmed";
    }
  | {
      readonly nameSourceScript: "en";
      readonly nameSourceValue: string;
      readonly nameZh: null;
      readonly nameEn: string;
      readonly transliterationMethod: null;
      readonly transliterationVersion: null;
      readonly transliterationStatus: "needs_transliteration_review";
    }
  | {
      readonly nameSourceScript: null;
      readonly nameSourceValue: null;
      readonly nameZh: null;
      readonly nameEn: null;
      readonly transliterationMethod: null;
      readonly transliterationVersion: null;
      readonly transliterationStatus: "needs_profile_review";
    };

export type CustomerRecord = StoredCustomerName & {
  readonly id: string;
  readonly customerType: "individual" | "organization";
  readonly organizationName: string | null;
  readonly primaryContactRole: string | null;
  readonly salutation: string | null;
  readonly gender: string | null;
  readonly birthDate: string | null;
  readonly trn: string | null;
  readonly language: string;
  readonly phone: string | null;
  readonly secondaryPhone: string | null;
  readonly whatsapp: string | null;
  readonly email: string | null;
  readonly preferredChannel: PreferredChannel;
  readonly address: string | null;
  readonly status: CustomerStatus;
  readonly riskFlags: readonly RiskFlag[];
  readonly verificationArchive: CustomerVerificationArchive;
  readonly creditEligibility: CreditEligibility;
  readonly notes: readonly CustomerNote[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
```

New individual customers and all newly created/edited organizations require a confirmed name tuple. A genuine legacy organization with no contact name migrates to the `needs_profile_review` branch instead of being rejected, reset, or assigned an invented person. It remains viewable; editing it requires adding and confirming one primary contact. An individual may never be newly saved in `needs_profile_review`.

Apply these exact v3 field dispositions:

- Delete from the stored customer record and draft: `source`, `recentBusiness`, `recentBusinessDate`, `activeBusinessCount`, `tags`, `contacts`, `riskNote`, stored `riskLevel`, `orders`, `paymentSummary`, and `licensePhotoUrl`.
- Replace persisted `profileCompleteness` with a selector derived from required formal fields and `transliterationStatus`; it is not editable.
- Keep customer notes as first-class records.
- Convert old `changeHistory` and customer-audit `before/after` snapshots to compact `CustomerAuditEvent` changes.
- Convert non-seed communication history into `legacy_communication` audit events preserving channel, direction, summary, operator, and time. Delete only the known fixed placeholder communication IDs.
- Convert non-seed task metadata into `legacy_task_snapshot` audit events preserving title, status, assignee, and due date. Delete only the known fixed placeholder task IDs because there is no complete customer-task action in this scope.
- Convert non-seed attachment metadata without a retrievable URL into `legacy_attachment_metadata` audit events preserving file name, category, uploader, and time; never present it as an openable file. Delete only known fixed placeholder attachment IDs. Verification evidence uses `EvidenceAsset` instead.

Keep `CustomerStatus` as `active | inactive | blacklisted`; blacklist status contributes to derived risk but is not a second editable risk-level field.

Delete the vehicle's static business truth from the v3 record and draft: `recentService`, `recentServiceDate`, `linkedOrderCount`, `totalAmount`, `unpaidAmount`, and `serviceHistory`. Vehicle photos remain in the vehicle archive; vehicle `partsNeeds` and tasks remain where their existing action path consumes them. Upgrade any retrievable vehicle attachment to `EvidenceAsset`; migrate filename-only legacy metadata to the vehicle audit stream and hide it from attachment UI until a real URL exists.

Define the only customer draft name input as a confirmed tuple token:

```ts
export interface CustomerDraftInput {
  readonly customerType: CustomerType;
  readonly organizationName?: string | null;
  readonly nameSourceValue?: string | null;
  readonly nameTransliterationToken?: string | null;
  readonly primaryContactRole?: string | null;
  readonly salutation?: string | null;
  readonly gender?: string | null;
  readonly birthDate?: string | null;
  readonly trn?: string | null;
  readonly language?: string | null;
  readonly primaryPhone?: string | null;
  readonly secondaryPhone?: string | null;
  readonly whatsapp?: string | null;
  readonly email?: string | null;
  readonly preferredChannel?: PreferredChannel;
  readonly address?: string | null;
  readonly status?: CustomerStatus;
  readonly reason?: string | null;
}

export interface CustomerNamePreview extends CustomerNameResult {
  readonly confirmationToken: string;
}
```

- [ ] **Step 4: Implement explicit v1, v2, and v3 guards and migration**

```ts
export function migrateCustomerVehicleEnvelope(
  value: unknown,
  migratedAt: string,
): PersistedCustomerVehicleEnvelopeV3 | null;
```

Requirements:

- Use separate `isLegacyCustomerEnvelopeV1`, `isLegacyCustomerEnvelopeV2`, and `isCustomerEnvelopeV3` guards. New-field guards must never reject an otherwise valid legacy envelope before migration.
- Run the same customer/vehicle conversion on any legacy audit `before` and `after` snapshot, then compact it into field changes; preserve the old and new name tuple in the migration event.
- Convert customer audits into `CustomerAuditEvent` entries with `eventType`, actor, timestamp, reason, changed scalar fields, and `evidenceAssetIds`. Never copy a verification `data:` URL into audit history.
- Preserve every legacy vehicle relationship, note, revision, credit record, and user-created entity.
- Fix overlapping current vehicle relationships with the existing deterministic legacy rule before emitting v3.
- On load, use migrated state only if schema validation and relationship validation pass. On persistence failure, keep using the safely migrated in-memory view but leave the original storage string untouched.

The first workspace/customer/vehicle read eagerly attempts to persist the validated v3 migration. If that `setItem` fails, the read returns the migrated in-memory view but the raw legacy string stays unchanged. A later mutation persists atomically; if its write fails, it throws and leaves both the last in-memory state and the legacy storage string unchanged.

Define the final v3 state and audit types during this task so Task 5 does not change schema v3 after it has been persisted:

```ts
export interface CustomerMutationReceipt {
  readonly actorId: string;
  readonly clientMutationId: string;
  readonly operation: string;
  readonly resultEntityId: string;
  readonly createdAt: string;
}

export interface CustomerAuditEvent {
  readonly id: string;
  readonly customerId: string;
  readonly eventType:
    | "customer_created"
    | "customer_updated"
    | "otp_requested"
    | "otp_verified"
    | "otp_invalidated"
    | "kyc_submitted"
    | "kyc_verified"
    | "agreement_signed"
    | "legacy_communication"
    | "legacy_task_snapshot"
    | "legacy_attachment_metadata"
    | "migration";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly summary: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | number | boolean | null;
    readonly after: string | number | boolean | null;
  }[];
  readonly evidenceAssetIds: readonly string[];
}

export interface VehicleAuditEvent {
  readonly id: string;
  readonly vehicleId: string;
  readonly eventType: "vehicle_created" | "vehicle_updated" | "migration";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly summary: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | number | boolean | null;
    readonly after: string | number | boolean | null;
  }[];
  readonly beforeRelationships: readonly VehicleCustomerRelationship[];
  readonly afterRelationships: readonly VehicleCustomerRelationship[];
}

export type CustomerVehicleAuditEvent = CustomerAuditEvent | VehicleAuditEvent;

export interface CustomerVehicleStateV3 {
  customers: CustomerRecord[];
  vehicles: VehicleRecord[];
  relationships: VehicleCustomerRelationship[];
  auditEvents: CustomerVehicleAuditEvent[];
  mutationReceipts: CustomerMutationReceipt[];
  sourceRevision: number;
}
```

This persisted internal state is deliberately mutable because the existing Mock store clones a draft, pushes audit/receipt records, replaces relationship arrays, and increments `sourceRevision`. Public records/DTOs stay readonly and every store read still returns a clone. Customer notes remain embedded in each `CustomerRecord`, matching the existing store. Preserve both customer and vehicle audit streams: migrate vehicle `before/after` snapshots into `VehicleAuditEvent.changes` and keep before/after relationship arrays. Preserve legacy audit IDs when one source record maps to one event; deterministic suffixes handle one-to-many conversion. Event identity plus migrated timestamp is stable so rerunning migration cannot duplicate events. Task 4 emits `mutationReceipts: []`; Task 5 starts writing the already-defined field. Never put a verification `data:` URL in `changes`.

- [ ] **Step 5: Add derived risk and formal-profile selectors**

```ts
export function deriveCustomerRiskLevel(customer: Pick<CustomerRecord, "status" | "riskFlags">): RiskLevel {
  const active = customer.riskFlags.filter((flag) => flag.removedAt === null);
  if (customer.status === "blacklisted" || active.some((flag) => flag.level === "high" || flag.level === "blacklist")) {
    return "high";
  }
  return active.some((flag) => flag.level === "attention") ? "attention" : "normal";
}

export function customerDisplayName(customer: CustomerRecord): string {
  if (customer.customerType === "organization") return customer.organizationName!;
  if (customer.nameEn === null) return "姓名待补";
  return customer.nameZh ? `${customer.nameZh} / ${customer.nameEn}` : customer.nameEn;
}
```

Update customer and vehicle search to use `nameZh`, `nameEn`, organization name, contact channels, plate, VIN, make/model, and relationship IDs. Do not search removed tags or static business fields.

- [ ] **Step 6: Add the name-preview endpoint and confirmation-token binding**

Route and client contract:

```ts
POST /api/customers/name-transliteration/preview
api.customers.previewName(value: string): Promise<CustomerNamePreview>
```

Store preview confirmations in the Mock store's non-persisted registry under an unpredictable `crypto.randomUUID()` token:

```ts
interface CustomerNamePreviewReceipt {
  readonly actorId: string;
  readonly normalizedSourceValue: string;
  readonly canonicalResult: CustomerNameResult;
  readonly issuedAt: string;
}

const customerNamePreviewReceipts = new Map<string, CustomerNamePreviewReceipt>();
```

The receipt binds actor, normalized source, complete canonical output, method, and rule version. Creation always requires a current receipt. Update may omit it whenever the normalized `nameSourceValue` is unchanged from the stored tuple, including a legacy `needs_transliteration_review` or `needs_profile_review` record, so a phone/address edit is never locked. Any actual name change requires a new confirmed receipt; a legacy review state therefore cannot change to another unsupported name. Changing the source input invalidates both the name receipt and duplicate-preview token; a successful save consumes the receipt.

Extend the error types without string matching:

```ts
export class CustomerVehicleValidationError extends Error {
  constructor(
    message: string,
    readonly code = "CUSTOMER_VALIDATION_FAILED",
    readonly status = 400,
  ) {
    super(message);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
```

- [ ] **Step 7: Replace the form with one confirmed name field and one formal-details section**

Required test IDs:

- `form-customer-organization-name`: organization name; it is not transliterated as a person.
- `form-customer-name`: the only editable individual/primary-contact personal name field.
- `customer-name-transliteration-preview`: read-only canonical counterpart.
- `customer-name-transliteration-confirm`: explicit confirmation action.
- `customer-formal-details`: the merged identity and contact section.

Remove `form-customer-name-zh`, source, recent business, risk level/note, tags, contact-list controls, fake OCR, and license-photo controls. For an individual, no secondary contact block renders. For an organization, `form-customer-organization-name` holds the enterprise name, while the one `form-customer-name` flow represents its sole primary contact and `primaryContactRole` appears beside it. These are not two customer-name inputs. `createdAt` renders as read-only registration time on detail, not an editable draft field.

Update duplicate detection at the same boundary: individual/contact duplicates compare normalized canonical `nameZh` or `nameEn`; organization duplicates compare normalized `organizationName`. Never compare an unconfirmed raw source or the removed `name` field. Add tests proving `  ALICIA bennett ` still finds `CUST-UAT-001`, while a different customer with only a matching phone remains a separate reason code.

- [ ] **Step 8: Make existing pages compile against v3 without displaying substitute values**

Update list/detail/workspace components to read `nameEn`, derived risk, and the reduced formal profile. `detail-shared.tsx` and `verification-risk-sections.tsx` temporarily render Task 2's truthful derived read-only status with no one-click completion action; Task 7 replaces that presentation with the full dialogs. Hide the old static vehicle/customer financial widgets until Tasks 9–10 supply the derived business profile; do not temporarily copy their old numbers into a new DTO. Update current unit and E2E tests that intentionally inspect removed fields so they instead assert those keys are absent.

Replace arbitrary successful English create/update fixtures such as `Fresh Customer`, `Retry Customer`, and `Migration Preserved` with approved dictionary names or unique valid Chinese names. Test helpers must call `api.customers.previewName()` and pass its token. Keep arbitrary English only in tests that assert `CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED`; never expand the production dictionary merely to preserve an old test string.

Add store/API tests that updating only a phone does not require reconfirming an unchanged current name, changing one character invalidates the old receipt, and a legacy review-name cannot be edited without confirmation.

- [ ] **Step 9: Run the customer v3 gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-name-transliteration.spec.ts tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
npm run typecheck
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
```

Expected: all commands pass; a newly created customer can only be saved with one confirmed canonical tuple; real v1/v2 fixtures migrate without reset.

- [ ] **Step 10: Commit customer schema v3 and the formal-profile flow**

```bash
git add src/lib/customers/types.ts src/lib/customers/migrations.ts src/lib/customers/selectors.ts src/lib/api/mock-customers.ts src/lib/api/client.ts src/components/customers/form-dialogs.tsx src/components/customers/customer-detail-page.tsx src/components/customers/vehicle-detail-page.tsx src/components/customers/customer-list.tsx src/components/customers/vehicle-list.tsx src/components/customers/customers-workspace.tsx src/components/customers/vehicles-workspace.tsx src/components/customers/customer-workspace.tsx src/components/customers/badges.tsx src/components/customers/detail-shared.tsx src/components/customers/verification-risk-sections.tsx tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts tests/e2e/customer-vehicle.spec.ts
git commit -m "feat(customers): migrate formal profiles to schema v3"
```

### Task 5: Add Idempotent OTP, KYC, Agreement, and Audit APIs

**Files:**

- Modify: `src/lib/customers/types.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `tests/unit/customers-store.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`

**Interfaces:**

- Consumes: customer v3 archive, evidence assets, actor context, fixed Mock OTP `123456`, and `clientMutationId`.
- Produces: separate request/verify/invalidate/submit/sign operations, compact audit history, and persisted mutation receipts.
- Does not expose the complete stored archive through a debug route.

- [ ] **Step 1: Write RED store tests for evidence requirements and idempotency**

```ts
test("records the exact OTP phone and does not duplicate a retried mutation", () => {
  const requested = store.requestCustomerOtp(actor, "CUST-UAT-002", {
    phoneE164: "+18765550122",
    clientMutationId: "otp-request-1",
  });
  const retried = store.requestCustomerOtp(actor, "CUST-UAT-002", {
    phoneE164: "+18765550122",
    clientMutationId: "otp-request-1",
  });
  expect(retried).toEqual(requested);
  expect(store.customer(actor, "CUST-UAT-002")!.verificationArchive.otpRecords).toHaveLength(1);
});

test("rejects missing phone and a wrong Mock OTP with stable codes", () => {
  expectStoreError(() => store.requestCustomerOtp(actor, "CUST-UAT-002", {
    phoneE164: "",
    clientMutationId: "otp-request-empty",
  }), "OTP_PHONE_REQUIRED");
  expectStoreError(() => store.verifyCustomerOtp(actor, "CUST-UAT-002", {
    otpRecordId: "OTP-001",
    code: "654321",
    clientMutationId: "otp-verify-wrong",
  }), "OTP_CODE_INVALID");
});

test("KYC cannot verify until a driver's-license front asset exists", () => {
  expectStoreError(() => store.verifyCustomerKyc(actor, "CUST-UAT-002", {
    kycRecordId: "KYC-MISSING",
    clientMutationId: "kyc-verify-missing",
  }), "KYC_EVIDENCE_REQUIRED");
});

test("paper and electronic agreements enforce different evidence", () => {
  expectStoreError(() => store.signCustomerAgreement(actor, "CUST-UAT-002", {
    medium: "paper",
    version: "1.3",
    signedBy: "Test Customer",
    clientMutationId: "agreement-paper-missing",
  }), "AGREEMENT_EVIDENCE_REQUIRED");
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
```

Expected: FAIL because the existing API only toggles completion status and has no evidence records or stable error codes.

- [ ] **Step 3: Add exact mutation request contracts**

```ts
export interface RequestCustomerOtpInput {
  readonly phoneE164: string;
  readonly clientMutationId: string;
}

export interface VerifyCustomerOtpInput {
  readonly otpRecordId: string;
  readonly code: string;
  readonly clientMutationId: string;
}

export interface InvalidateCustomerOtpInput {
  readonly otpRecordId: string;
  readonly reason: string;
  readonly clientMutationId: string;
}

export interface SubmitCustomerKycInput {
  readonly frontAsset: EvidenceAsset;
  readonly backAsset?: EvidenceAsset;
  readonly clientMutationId: string;
}

export interface VerifyCustomerKycInput {
  readonly kycRecordId: string;
  readonly clientMutationId: string;
}

export type SignCustomerAgreementInput =
  | {
      readonly medium: "electronic";
      readonly version: string;
      readonly signedBy: string;
      readonly signatureAsset: EvidenceAsset;
      readonly signedDocumentAsset: EvidenceAsset;
      readonly clientMutationId: string;
    }
  | {
      readonly medium: "paper";
      readonly version: string;
      readonly signedBy: string;
      readonly paperScanAsset?: EvidenceAsset;
      readonly physicalRecordNumber?: string;
      readonly physicalStorageLocation?: string;
      readonly clientMutationId: string;
    };
```

Replace the old one-click methods on `MockCustomerVehicleStore` with these access-first signatures:

```ts
requestCustomerOtp(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
  input: RequestCustomerOtpInput,
): CustomerRecord;
verifyCustomerOtp(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
  input: VerifyCustomerOtpInput,
): CustomerRecord;
invalidateCustomerOtp(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
  input: InvalidateCustomerOtpInput,
): CustomerRecord;
submitCustomerKyc(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
  input: SubmitCustomerKycInput,
): CustomerRecord;
verifyCustomerKyc(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
  input: VerifyCustomerKycInput,
): CustomerRecord;
signCustomerAgreement(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
  input: SignCustomerAgreementInput,
): CustomerRecord;
customerAuditHistory(
  access: CustomerVehicleAccessContext | undefined,
  customerId: string,
): readonly CustomerAuditEvent[];
```

- [ ] **Step 4: Persist receipts and append the already-defined audit events**

Use Task 4's final `CustomerMutationReceipt`, `CustomerAuditEvent`, and `CustomerVehicleStateV3` types without changing schema version or adding another required envelope field. An idempotent retry returns the first result without incrementing revision or writing another record/event. Verification audit events populate `reason`, scalar `changes`, and `evidenceAssetIds`; they must not contain a `data:` URL or a complete customer snapshot.

- [ ] **Step 5: Expose the Mock routes and typed client methods**

```text
POST /api/customers/:id/otp/request
POST /api/customers/:id/otp/verify
POST /api/customers/:id/otp/invalidate
POST /api/customers/:id/kyc/submit
POST /api/customers/:id/kyc/verify
POST /api/customers/:id/agreements/sign
GET  /api/customers/:id/audit-history
```

Add matching `api.customers.*` methods. Route errors must preserve `status` and `code`; use `OTP_PHONE_REQUIRED`, `OTP_CODE_INVALID`, `KYC_EVIDENCE_REQUIRED`, `AGREEMENT_EVIDENCE_REQUIRED`, and `EVIDENCE_ASSET_INVALID` exactly.

The server normalizes `RequestCustomerOtpInput.phoneE164` again and rejects an invalid value before creating a record. Successful verification atomically stores the same canonical E.164 value in `CustomerRecord.phone`; the page uses `formatPhoneE164` for display without altering the comparison value.

- [ ] **Step 6: Add the phone-change invariant**

When formal-profile update changes `phone`, do not mutate old OTP records. `deriveOtpVerification` then reports `needs_reverification`. A later successful OTP for a new number may update the primary phone in the same atomic mutation and must append an audit event naming the old and new numbers.

- [ ] **Step 7: Run the task gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
npm run typecheck
npm run test:collaboration
```

Expected: all pass; retries are byte-for-byte stable after reload and no audit event contains `data:image/` or `data:application/pdf`.

- [ ] **Step 8: Commit the evidence APIs**

```bash
git add src/lib/customers/types.ts src/lib/api/mock-customers.ts src/lib/api/client.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
git commit -m "feat(customers): add auditable verification APIs"
```

### Task 6: Create Synthetic, Retrievable Seed Evidence

**Files:**

- Create: `public/seed-evidence/alicia-bennett-drivers-license-front.png`
- Create: `public/seed-evidence/alicia-bennett-agreement-v1.3-signature.png`
- Create: `public/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf`
- Create: `public/seed-evidence/demo-paper-agreement-scan.png`
- Create: `src/lib/customers/seed-evidence.ts`
- Create: `scripts/generate-customer-seed-agreement.mjs`
- Modify: `src/lib/api/mock-customers.ts`
- Create: `tests/unit/customer-seed-evidence.spec.ts`

**Interfaces:**

- Consumes: repository-hosted synthetic files and deterministic UAT actor/timestamps.
- Produces: valid `EvidenceAsset` records for Alicia and one paper-agreement demo; every URL is refresh-stable and every asset is visibly fictional.

- [ ] **Step 1: Invoke the `imagegen` skill before generating bitmap evidence**

The implementing agent must read and follow the `imagegen` skill. Generate a fictional Jamaican-style driver-license front for Alicia Bennett, a fictional paper agreement scan, and a simple fictional signature image spelling `Alicia Bennett`. The license and paper scan must show the prominent bilingual watermark `SYNTHETIC DEMO / 合成演示资料`; the signature image must show `SYNTHETIC SIGNATURE / 合成签名` beneath the stroke. The driver-license mockup contains only NAME, DATE OF BIRTH, SEX, and ADDRESS; it must not include TRN, class, licence number, issue/expiry date, collectorate, or signature. The real licence supplied by the product owner is a layout reference only and must not be copied into the repository. Stay inside this repository under `public/seed-evidence/`.

- [ ] **Step 2: Write the RED asset test before attaching assets to the seed**

```ts
test("every seed evidence URL resolves to a real, bounded repository file", async () => {
  for (const asset of Object.values(SEED_EVIDENCE_ASSETS)) {
    expect(asset.url).toMatch(/^\/seed-evidence\//);
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.sizeBytes).toBeLessThanOrEqual(524_288);
    expect(await readPublicAsset(asset.url)).toHaveLength(asset.sizeBytes);
  }
});

test("Alicia's completed verification derives from retrievable evidence", () => {
  const customer = seededCustomer("CUST-UAT-001");
  expect(deriveOtpVerification(customer.verificationArchive, customer.phone)).toMatchObject({
    status: "verified",
    phoneE164: customer.phone,
  });
  expect(deriveKycVerification(customer.verificationArchive)).toMatchObject({
    status: "verified",
    activeRecord: { frontAsset: { mimeType: "image/png" } },
  });
  expect(deriveAgreementVerification(customer.verificationArchive, "1.3")).toMatchObject({
    status: "signed",
    activeRecord: { medium: "electronic" },
  });
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-seed-evidence.spec.ts
```

Expected: FAIL because the seed assets and registry do not exist.

- [ ] **Step 4: Create the signed PDF from the canonical agreement payload**

Implement `scripts/generate-customer-seed-agreement.mjs` with `pdf-lib`. It reads the generated signature PNG, renders agreement version `1.3`, Alicia's synthetic customer name, a fixed UAT signing timestamp, and the `SYNTHETIC DEMO / 合成演示资料` watermark, then writes `public/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf`. Run:

```bash
node scripts/generate-customer-seed-agreement.mjs
head -c 5 public/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf
wc -c public/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf
```

Expected: the header is `%PDF-` and the size is between 1 and 524,288 bytes. Keep `createSignedAgreementPdf` covered separately as the runtime electronic-signing path.

- [ ] **Step 5: Register assets and replace false UAT evidence**

```ts
export const SEED_EVIDENCE_ASSETS = {
  aliciaDriversLicenseFront: evidenceAsset({
    id: "EVID-UAT-ALICIA-DL-FRONT",
    url: "/seed-evidence/alicia-bennett-drivers-license-front.png",
    mimeType: "image/png",
  }),
  aliciaAgreementSignature: evidenceAsset({
    id: "EVID-UAT-ALICIA-AGR-SIG",
    url: "/seed-evidence/alicia-bennett-agreement-v1.3-signature.png",
    mimeType: "image/png",
  }),
  aliciaSignedAgreement: evidenceAsset({
    id: "EVID-UAT-ALICIA-AGR-PDF",
    url: "/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf",
    mimeType: "application/pdf",
  }),
  demoPaperAgreementScan: evidenceAsset({
    id: "EVID-UAT-PAPER-AGR-SCAN",
    url: "/seed-evidence/demo-paper-agreement-scan.png",
    mimeType: "image/png",
  }),
} as const;
```

Seed Alicia with an OTP record for her actual seeded primary phone, a verified driver's-license KYC record, and an electronic version 1.3 agreement using the registered signature and PDF. Delete the prior vehicle-registration image from Alicia's KYC path. Other fixed UAT customers may be `evidence_missing`, pending, or use the explicit paper demo, but none may claim completion without a registered asset or OTP phone record.

Do not backfill a previously migrated `evidence_missing` Alicia archive: that would invent evidence for an old completion and could attach an OTP to a phone the user later changed. Fresh v3 seed receives the new deterministic evidence. Existing v1/v2 browsers migrate to `evidence_missing` and the UI requires the user to re-run OTP/KYC/agreement. Add a test proving an empty v3 Alicia archive and its legacy gaps remain unchanged after the code upgrade.

- [ ] **Step 6: Run the task gate and visually inspect both PNGs**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-seed-evidence.spec.ts
npm run typecheck
```

Then inspect both generated PNG files at original resolution. Expected: all tests pass; identity fields are fictional, the license is clearly a driver license rather than a vehicle registration, and both watermarks are readable.

- [ ] **Step 7: Commit the synthetic evidence**

```bash
git add public/seed-evidence scripts/generate-customer-seed-agreement.mjs src/lib/customers/seed-evidence.ts src/lib/api/mock-customers.ts tests/unit/customer-seed-evidence.spec.ts
git commit -m "feat(customers): add retrievable synthetic verification evidence"
```

### Task 7: Replace Formal Verification Status Cards with Evidence Workflows

**Files:**

- Create: `src/components/customers/evidence-asset-viewer.tsx`
- Create: `src/components/customers/otp-verification-dialog.tsx`
- Create: `src/components/customers/kyc-verification-dialog.tsx`
- Create: `src/components/customers/agreement-evidence-dialog.tsx`
- Create: `src/components/customers/verification-evidence-section.tsx`
- Create: `src/components/customers/customer-audit-history.tsx`
- Modify: `src/components/customers/verification-risk-sections.tsx`
- Modify: `src/components/customers/customer-detail-page.tsx`
- Modify: `src/components/ui/signature-pad.tsx`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**

- Consumes: verification views, evidence assets, audit events, and Task 5's typed API methods.
- Produces: three compact evidence cards plus dialogs for OTP, KYC, paper/electronic agreements, persistent evidence viewing, audit history, and a four-field driver-license profile confirmation preview.
- `verification-risk-sections.tsx` retains risk-entry UI only; verification moves to its own component.

- [ ] **Step 1: Add the RED browser contracts**

```ts
test("OTP shows its phone, invalidates unreachable evidence, and re-verifies a new phone", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-001");
  const otp = page.getByTestId("customer-otp-evidence-card");
  await expect(otp).toContainText("+1");
  await expect(otp).toContainText("已验证");

  await otp.getByRole("button", { name: "标记联系不上" }).click();
  await page.getByLabel("作废原因").fill("号码无法接通");
  await page.getByRole("button", { name: "确认作废" }).click();
  await expect(otp).toContainText("需重新验证");

  await otp.getByRole("button", { name: "重新 OTP" }).click();
  await page.getByLabel("验证号码").fill("+18765550999");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await page.getByLabel("验证码").fill("123456");
  await page.getByRole("button", { name: "确认验证" }).click();
  await expect(otp).toContainText("+1 876 555 0999");
});

test("opens the exact driver-license and signed-agreement evidence", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-001");
  await page.getByRole("button", { name: "查看驾驶证" }).click();
  await expect(page.getByTestId("evidence-asset-viewer")).toContainText("合成演示资料");
  await page.getByRole("button", { name: "关闭证据" }).click();

  await expect(page.getByTestId("customer-agreement-evidence-card")).toContainText("电子版");
  await page.getByRole("button", { name: "查看签署文件" }).click();
  await expect(page.getByTestId("evidence-pdf-frame")).toHaveAttribute("src", /signed\.pdf$/);
});

test("does not permit KYC completion without a driver-license image", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-002");
  await page.getByRole("button", { name: "补充驾驶证" }).click();
  await page.getByRole("button", { name: "提交并核验" }).click();
  await expect(page.getByRole("alert")).toContainText("请先上传驾驶证正面");
});
```

- [ ] **Step 2: Run the affected E2E and confirm RED**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "OTP|driver-license|KYC"
```

Expected: FAIL because current cards expose neither evidence nor the complete actions.

- [ ] **Step 3: Implement the evidence viewer and accessible dialog behavior**

`EvidenceAssetViewer` accepts one `EvidenceAsset`, renders images with a zoom control and PDFs with a named iframe plus download link, and rejects any runtime URL that is neither `/seed-evidence/` nor an allowed `data:` URL. Every dialog must trap focus, close on Escape, restore focus to its trigger, keep API errors inside with `role="alert"`, and preserve input after a failed request.

- [ ] **Step 4: Implement the three evidence cards**

Each card must answer status, evidence, and next action:

- OTP: exact current/verified number, time, “标记联系不上”, and “重新 OTP”. The fixed code `123456` is visibly labeled as a Mock code only after request.
- KYC: driver-license status, verified time, “查看驾驶证”, and “重新 KYC/补充驾驶证”. Submission and verification remain separate API calls even if the dialog offers one composed button.
- Driver-license profile preview: only name, birth date, sex, and address. The values are editable and require explicit confirmation before updating formal details. The name must pass the existing one-field transliteration receipt flow. Do not expose or persist TRN, class, licence number, issue/expiry date, collectorate, or signature as extracted profile facts. The known synthetic seed may prefill a deterministic Mock fixture; arbitrary uploads remain blank/manual unless a trustworthy extractor exists, and the UI must not label that as successful OCR.
- Agreement: status, `纸质版` or `电子版`, version, signer, time, and either view/download evidence or physical record number and location. Never hardcode “电子协议” before medium exists.

- [ ] **Step 5: Implement paper and electronic signing paths**

Electronic signing captures the existing signature pad as PNG, calls `createSignedAgreementPdf`, then sends both assets. Paper signing accepts JPEG/PNG/PDF scan or requires both `physicalRecordNumber` and `physicalStorageLocation`. The UI validates type and 512 KiB bound before calling the API.

- [ ] **Step 6: Render compact customer audit history**

Show actor, time, event summary, field changes, and evidence asset IDs/links where the current archive resolves them. Do not render raw JSON or duplicate a base64 string in the DOM. Verification history drawers list every OTP, KYC, and agreement record, including invalidated and expired records.

- [ ] **Step 7: Run the task gate**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "OTP|driver-license|KYC|agreement|audit"
npm run typecheck
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
```

Expected: all pass; after page reload, the new OTP record and each evidence view remain available.

- [ ] **Step 8: Commit the evidence UI**

```bash
git add src/components/customers/evidence-asset-viewer.tsx src/components/customers/otp-verification-dialog.tsx src/components/customers/kyc-verification-dialog.tsx src/components/customers/agreement-evidence-dialog.tsx src/components/customers/verification-evidence-section.tsx src/components/customers/customer-audit-history.tsx src/components/customers/verification-risk-sections.tsx src/components/customers/customer-detail-page.tsx src/components/ui/signature-pad.tsx tests/e2e/customer-vehicle.spec.ts
git commit -m "feat(customers): expose verification evidence workflows"
```

### Task 8: Migrate Linked Operations to Schema v4 and Seed Alicia's Real Ledger

**Files:**

- Modify: `src/lib/customers/canonical-identities.ts`
- Modify: `src/lib/orders/seed.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/mock-billing.ts`
- Modify: `src/lib/api/mock-parking.ts`
- Create: `tests/fixtures/linked-operations-v3.ts`
- Modify: `tests/unit/customers-store.spec.ts`
- Modify: `tests/unit/billing-api.spec.ts`
- Modify: `tests/unit/orders-api.spec.ts`
- Modify: `tests/unit/parking-api.spec.ts`

**Interfaces:**

- Consumes: customer-store reference catalog and Linked Operations v1/v2/v3/v4 envelopes.
- Produces: validated Linked Operations schema v4, canonical customer/vehicle references, and Alicia's deterministic BO/Invoice/Payment/Refund ledger.
- Storage key remains `wh_linked_operations_state_v1`; envelope `schemaVersion` becomes `4`.

- [ ] **Step 1: Write RED cross-store and v3 migration tests**

```ts
test("every Linked Operations customer and vehicle exists in the master catalog", () => {
  const references = customerStore.references();
  const linked = linkedStore.read(
    (state) => structuredClone(state),
    "test.master-reference-integrity",
  );
  expect(linked.customers.every((customer) => references.customerIds.has(customer.id))).toBe(true);
  expect(linked.vehicles.every((vehicle) => references.vehicleIds.has(vehicle.id))).toBe(true);
  expect(linked.businessOrders.every((bo) =>
    references.customerIds.has(bo.customerId) && references.vehicleIds.has(bo.vehicleId),
  )).toBe(true);
});

test("rejects orphan master references with stable error codes", () => {
  expectLinkedStateError(
    () => validateLinkedOperationsState(stateWithCustomerId("CUST-MISSING"), references),
    "LINKED_CUSTOMER_REFERENCE_MISSING",
  );
  expectLinkedStateError(
    () => validateLinkedOperationsState(stateWithVehicleId("VEH-MISSING"), references),
    "LINKED_VEHICLE_REFERENCE_MISSING",
  );
});

test("migrates a genuine v3 envelope without losing mutable user facts", () => {
  const legacy = linkedOperationsV3Fixture({
    communication: userCommunication("COM-USER-1"),
    acknowledgement: userAcknowledgement("ACK-USER-1"),
    reassignment: userReassignment("REASSIGN-USER-1"),
  });
  const migrated = migrateLegacyLinkedStateV3(legacy, references);
  expect(migrated.schemaVersion).toBe(4);
  expect(findCommunication(migrated, "COM-USER-1")).toBeDefined();
  expect(findAcknowledgement(migrated, "ACK-USER-1")).toBeDefined();
  expect(findReassignment(migrated, "REASSIGN-USER-1")).toBeDefined();
  expect(parseAndMigrateLinkedOperationsState(migrated, references)).toEqual(migrated);
});

test("fails closed on a persisted v4 orphan without deleting or reseeding", () => {
  const raw = JSON.stringify(v4FixtureWithCustomerId("CUST-MISSING"));
  const storage = storageSpy({ wh_linked_operations_state_v1: raw });
  const store = createMockLinkedOperationsStore(storage, { references: () => references });
  expectLinkedStateError(
    () => store.read((state) => state.revision, "test.orphan-read"),
    "LINKED_CUSTOMER_REFERENCE_MISSING",
    "$.customers",
  );
  expect(storage.getItem("wh_linked_operations_state_v1")).toBe(raw);
  expect(storage.removeItem).not.toHaveBeenCalled();
});
```

`tests/fixtures/linked-operations-v3.ts` must export a literal schema-v3 fixture containing every v3 collection and one recognized item in each mutable collection. Do not manufacture it by generating v4 and changing the version number. Define file-local `expectLinkedStateError()` by catching `LinkedStateInvariantError` and comparing both `code` and `path`.

- [ ] **Step 2: Write the RED Alicia ledger conservation test**

```ts
test("Alicia's fourteen invoices reconcile from actual records", () => {
  const state = createInitialLinkedOperationsState(references);
  const businessOrders = state.businessOrders.filter(
    (bo) => bo.customerId === "CUST-UAT-001",
  );
  const invoices = state.invoices.filter((invoice) =>
    businessOrders.some((bo) => bo.id === invoice.businessOrderId),
  );
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const grossPaid = state.payments
    .filter((payment) => invoiceIds.has(payment.invoiceId))
    .reduce((sum, payment) => sum + payment.amountJmd, 0);
  const refunded = state.refunds
    .filter((refund) => invoiceIds.has(refund.invoiceId))
    .reduce((sum, refund) => sum + refund.amountJmd, 0);

  expect(businessOrders).toHaveLength(14);
  expect(invoices).toHaveLength(14);
  const latestVersions = invoices.map(latestInvoiceVersion);
  expect(latestVersions.reduce((sum, version) => sum + version.totals.totalJmd, 0)).toBe(532_000);
  expect(grossPaid).toBe(494_000);
  expect(refunded).toBe(5_000);
  expect(grossPaid - refunded).toBe(489_000);
  const unpaid = invoices.reduce((sum, invoice) => {
    const total = latestInvoiceVersion(invoice).totals.totalJmd;
    const paid = state.payments
      .filter((payment) => payment.invoiceId === invoice.id)
      .reduce((value, payment) => value + payment.amountJmd, 0);
    const returned = state.refunds
      .filter((refund) => refund.invoiceId === invoice.id)
      .reduce((value, refund) => value + refund.amountJmd, 0);
    return sum + Math.max(total - (paid - returned), 0);
  }, 0);
  expect(unpaid).toBe(43_000);
});
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/billing-api.spec.ts tests/unit/customers-store.spec.ts tests/unit/orders-api.spec.ts tests/unit/parking-api.spec.ts
```

Expected: FAIL because Linked Operations is schema v3, has its own `customer-demo-*`/`vehicle-demo-*` directory, and Alicia has no real 14-record ledger.

- [ ] **Step 4: Expose the read-only master reference catalog**

```ts
export interface CustomerVehicleReferenceCatalog {
  readonly customerIds: ReadonlySet<string>;
  readonly vehicleIds: ReadonlySet<string>;
  readonly relationships: readonly VehicleCustomerRelationship[];
}

export interface MockCustomerVehicleStore {
  references(): CustomerVehicleReferenceCatalog;
}
```

The catalog returns IDs and relationship facts only; it does not expose writable customer records or formal details. The Linked store accepts a function returning a current catalog so newly created valid customers and vehicles work without recreating the singleton.

Linked validation uses only `customerIds` and `vehicleIds`. Relationships are supplied for customer/vehicle navigation and must not be used to reassign historical BO ownership. `LinkedVehicleFact.customerId` is a display snapshot: it must reference an existing master customer, but it need not equal the vehicle's current relationship after a transfer.

- [ ] **Step 5: Implement schema v4 validation and exact legacy migration**

```ts
export const LINKED_OPERATIONS_SCHEMA_VERSION = 4 as const;

export function validateLinkedOperationsState(
  value: unknown,
  references: CustomerVehicleReferenceCatalog,
): asserts value is LinkedOperationsState;

export function migrateLegacyLinkedStateV3(
  value: LegacyLinkedOperationsStateV3,
  references: CustomerVehicleReferenceCatalog,
): LinkedOperationsState;

export function parseAndMigrateLinkedOperationsState(
  value: unknown,
  references: CustomerVehicleReferenceCatalog,
): LinkedOperationsState;

export function createInitialLinkedOperationsState(
  references: CustomerVehicleReferenceCatalog,
): LinkedOperationsState;
```

Keep the existing `LinkedStateInvariantError.code` and `.path` contract. `parseAndMigrateLinkedOperationsState` dispatches through separate guards and chains `v1 → v2 → v3 → v4`, `v2 → v3 → v4`, or `v3 → v4`; v4 is strictly validated in place. Every loader/read/initialization path obtains the current reference provider before its final v4 validation.

The v3-to-v4 mapper must update every reference location:

- Linked customer and vehicle snapshots;
- `OrderRecord.customer.id` and `OrderRecord.vehicle.id`;
- Inspection Report customer/vehicle IDs;
- Business Order customer/vehicle IDs;
- release and parking vehicle IDs;
- operations-document and assignment vehicle IDs;
- acknowledgement customer and payer IDs.

Build deterministic `legacyCustomerId → canonicalCustomerId` and `legacyVehicleId → canonicalVehicleId` maps from `CANONICAL_OPERATIONS`, never from name, phone, or plate. Because `customer-demo-11..24` and `vehicle-demo-11..24` collapse to Alicia and one vehicle, rebuild Linked snapshot arrays keyed by canonical ID and deterministically keep one canonical snapshot; do not emit 14 duplicate master rows. Map each business reference using its order/legacy ID before deduplication.

After mapping, re-derive operations documents and assignments, then run both Linked-internal validation and master-reference validation. Preserve all IDs for BO, IR, Quotation, Invoice, Payment, Refund, parking case, document, acknowledgement, communication, and audit records. Preserve later user-created Invoice versions and user mutations. A corrupt or orphan persisted state fails closed with its stable invariant error; it is not removed and does not fall back to seed. On a migration persistence failure, leave the original serialized v1/v2/v3 string untouched.

- [ ] **Step 6: Define and seed Alicia's exact ledger**

```ts
export const ALICIA_INVOICE_TOTALS_JMD = [
  28_500, 42_000, 65_000, 22_000, 18_000, 35_000, 40_000,
  27_500, 55_000, 33_000, 48_000, 36_000, 39_000, 43_000,
] as const;
```

Use `order-demo-11` through `order-demo-24`, `invoice-demo-11` through `invoice-demo-24`, and their existing document-number patterns. Each BO uses `CUST-UAT-001` and `VEH-UAT-001`. Invoice 11 has a JMD 28,500 Payment and a JMD 5,000 Refund; invoices 12–23 are paid in full; invoice 24 has a JMD 5,000 Payment. Therefore gross Payment is 494,000, Refund is 5,000, net paid is 489,000, and balances are 5,000 on invoice 11 plus 38,000 on invoice 24.

Replace `netPaidJmd`'s mutually exclusive Payment/Refund shortcut with the explicit `payments` and `refunds` arrays already added to `SeedInput` in Task 3. Invoice 11 must therefore carry both events.

For every reserved BO, construct one canonical base charge amount and use it consistently in all four representations: `OrderRecord.laborItems/partItems/parkingFeeJmd/payments/refunds`, Business Order `items[].chargeLines`, Invoice v1 `lines/totals`, and state-level `payments/refunds`. Add a test that the order-list receivable/net-paid calculation for each reserved order equals the corresponding latest Invoice/Payment/Refund calculation.

For an untouched v3 seed, replace the immutable base facts for these exact reserved IDs with the v4 Alicia fixture. Detect untouched facts per known document/event ID and exact legacy base payload, not by global revision. Preserve user-created later Invoice versions and any Payment/Refund whose ID is not one of the known legacy seed IDs. Fresh v4 and an untouched v3 migration must equal 532,000/489,000/43,000; a mutated v3 fixture instead asserts preservation and derives its possibly changed totals from the retained records.

Add one shared helper and use it everywhere billing facts are read:

```ts
export function latestInvoiceVersion(invoice: Invoice): InvoiceVersion {
  return invoice.versions.at(-1)!;
}
```

The v4 validator requires at least one version and strictly increasing numeric `version` values, so `.at(-1)` is unambiguous. Replace independent “highest version” or direct `.at(-1)` logic in Mock billing, parking validation, financial summaries, and Task 9's profile selector with this helper.

- [ ] **Step 7: Inject live master references into the Linked singleton**

```ts
export function createMockLinkedOperationsStore(
  browserStorage?: Storage,
  options?: {
    coordinator?: LinkedOperationsMutationCoordinator;
    references?: () => CustomerVehicleReferenceCatalog;
  },
): MockLinkedOperationsStore;

createMockLinkedOperationsStore(browserStorage, {
  references: () => getMockCustomerVehicleStore().references(),
});
```

Preserve the positional storage argument and existing coordinator option so current tests do not break. Non-browser stores without an explicit provider use the immutable canonical catalog. Do not cache the set at module initialization. Public create/update routes must reject a BO, IR, parking, release, or acknowledgement mutation that introduces an orphan customer or vehicle ID.

- [ ] **Step 8: Run the task gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/billing-api.spec.ts tests/unit/customers-store.spec.ts tests/unit/orders-api.spec.ts tests/unit/parking-api.spec.ts
npm run typecheck
npm run test:collaboration
```

Expected: all pass; fresh and migrated states validate as v4; Alicia's source records reconcile exactly; user mutation fixtures survive migration.

- [ ] **Step 9: Commit Linked Operations v4**

```bash
git add src/lib/customers/canonical-identities.ts src/lib/orders/seed.ts src/lib/api/mock-customers.ts src/lib/api/mock-orders.ts src/lib/api/mock-billing.ts src/lib/api/mock-parking.ts tests/fixtures/linked-operations-v3.ts tests/unit/customers-store.spec.ts tests/unit/billing-api.spec.ts tests/unit/orders-api.spec.ts tests/unit/parking-api.spec.ts
git commit -m "feat(mock): reconcile linked operations with customer masters"
```

### Task 9: Derive Customer and Vehicle Business Profiles from One Ledger

**Files:**

- Create: `src/lib/customers/business-profile.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/client.ts`
- Create: `tests/unit/customer-business-profile.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`
- Modify: `tests/unit/orders-api.spec.ts`

**Interfaces:**

- Consumes: one validated `LinkedOperationsState` and a customer or vehicle master ID.
- Produces: customer and vehicle `BusinessProfile` DTOs plus summary maps for list pages.
- No writable customer-store field caches the result.

- [ ] **Step 1: Write the RED pure-selector tests**

```ts
test("derives Alicia's complete profile from IDs and latest invoice versions", () => {
  const profile = deriveCustomerBusinessProfile(state, "CUST-UAT-001");
  expect(profile).toMatchObject({
    businessOrderCount: 14,
    invoiceCount: 14,
    billedJmd: 532_000,
    grossPaidJmd: 494_000,
    refundedJmd: 5_000,
    netPaidJmd: 489_000,
    unpaidJmd: 43_000,
  });
  expect(profile.rows).toHaveLength(14);
  expect(new Set(profile.rows.map((row) => row.vehicle.id))).toEqual(
    new Set(["VEH-UAT-001"]),
  );
});

test("uses only the latest invoice version and clamps aggregate unpaid at zero", () => {
  const profile = deriveCustomerBusinessProfile(
    stateWithInvoiceVersions({
      customerId: "CUST-UAT-001",
      versions: [
        { version: 1, totalJmd: 999_000 },
        { version: 2, totalJmd: 10_000 },
      ],
      paymentsJmd: [12_000],
      refundsJmd: [1_000],
    }),
    "CUST-UAT-001",
  );
  expect(profile.billedJmd).toBe(10_000);
  expect(profile.grossPaidJmd).toBe(12_000);
  expect(profile.refundedJmd).toBe(1_000);
  expect(profile.netPaidJmd).toBe(11_000);
  expect(profile.unpaidJmd).toBe(0);
  expect(profile.rows[0].invoices[0].balanceJmd).toBe(-1_000);
});

test("counts a BO without Invoice but does not create money", () => {
  const profile = deriveCustomerBusinessProfile(stateWithUninvoicedBo(), "CUST-UAT-001");
  expect(profile.businessOrderCount).toBe(15);
  expect(profile.invoiceCount).toBe(14);
  expect(profile.billedJmd).toBe(532_000);
});

test("never joins by a matching name, phone, or plate", () => {
  const collision = stateWithDifferentIdsButAliciaDisplaySnapshots();
  const profile = deriveCustomerBusinessProfile(collision, "CUST-UAT-001");
  expect(profile.rows.some((row) => row.businessOrderId === "order-collision")).toBe(false);
});

test("a later vehicle transfer does not reassign historical BO ownership", () => {
  const transferred = stateWithVehicleCurrentOwner("VEH-UAT-001", "CUST-UAT-002");
  expect(deriveCustomerBusinessProfile(transferred, "CUST-UAT-001").businessOrderCount).toBe(14);
  expect(deriveCustomerBusinessProfile(transferred, "CUST-UAT-002").businessOrderCount).toBe(0);
});
```

- [ ] **Step 2: Run the selector test and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-business-profile.spec.ts
```

Expected: FAIL because there is no shared customer/vehicle profile selector.

- [ ] **Step 3: Implement the exact DTOs and shared core**

```ts
export interface BusinessProfileInvoiceRow {
  readonly id: string;
  readonly invoiceNo: string;
  readonly version: number;
  readonly totalJmd: number;
  readonly grossPaidJmd: number;
  readonly refundedJmd: number;
  readonly netPaidJmd: number;
  readonly balanceJmd: number;
  readonly paymentStatus: PaymentStatus;
  readonly settlementStatus: "due" | "settled" | "overpaid";
  readonly payments: readonly {
    readonly id: string;
    readonly amountJmd: number;
    readonly receivedAt: string;
  }[];
  readonly refunds: readonly {
    readonly id: string;
    readonly amountJmd: number;
    readonly refundedAt: string;
  }[];
}

export interface BusinessProfileRow {
  readonly businessOrderId: string;
  readonly businessOrderNo: string;
  readonly createdAt: string;
  readonly executionStatus: BusinessOrder["executionStatus"];
  readonly vehicle: {
    readonly id: string;
    readonly plate: string;
    readonly modelZh: string | null;
    readonly modelEn: string;
  };
  readonly invoices: readonly BusinessProfileInvoiceRow[];
}

export interface BusinessProfile {
  readonly subjectKind: "customer" | "vehicle";
  readonly subjectId: string;
  readonly businessOrderCount: number;
  readonly invoiceCount: number;
  readonly billedJmd: number;
  readonly grossPaidJmd: number;
  readonly refundedJmd: number;
  readonly netPaidJmd: number;
  readonly unpaidJmd: number;
  readonly latestBusinessAt: string | null;
  readonly rows: readonly BusinessProfileRow[];
}

export function deriveCustomerBusinessProfile(
  state: LinkedOperationsState,
  customerId: string,
): BusinessProfile;

export function deriveVehicleBusinessProfile(
  state: LinkedOperationsState,
  vehicleId: string,
): BusinessProfile;

export function deriveCustomerBusinessProfileMap(
  state: LinkedOperationsState,
  customerIds: readonly string[],
): Record<string, BusinessProfile>;

export function deriveVehicleBusinessProfileMap(
  state: LinkedOperationsState,
  vehicleIds: readonly string[],
): Record<string, BusinessProfile>;
```

All four exports call one non-exported grouped-scan core. Customer filtering is `BusinessOrder.customerId === customerId`; vehicle filtering is `BusinessOrder.vehicleId === vehicleId`. For each Invoice, call Task 8's shared `latestInvoiceVersion()`, sum and retain matching Payment and Refund events, and calculate `balanceJmd = totalJmd - netPaidJmd`. `paymentStatus` remains the existing billing axis; `settlementStatus` distinguishes a true overpayment. Aggregate `unpaidJmd` is the sum of `Math.max(balanceJmd, 0)`. BO time comes from the `OrderRecord` with the same BO ID. Rows sort by `createdAt` descending and then `businessOrderId` ascending; `latestBusinessAt` is the first row's time or null.

- [ ] **Step 4: Add detail and list-summary Mock API routes**

```text
GET /api/customers/:id/business-profile
GET /api/vehicles/:id/business-profile
GET /api/customer-business-profiles
GET /api/vehicle-business-profiles
```

Client methods:

```ts
api.customers.businessProfile(id: string): Promise<BusinessProfile>
api.customers.businessProfileMap(): Promise<Record<string, BusinessProfile>>
api.vehicles.businessProfile(id: string): Promise<BusinessProfile>
api.vehicles.businessProfileMap(): Promise<Record<string, BusinessProfile>>
```

Every route reads one current Linked snapshot and calls the pure selector. Detail existence and map key sets come from the current customer-store reference catalog, so a valid master with no Linked facts returns a zero profile and an unknown master returns 404. Add all four routes to `isCustomerVehicleRequest` so the current `customerVehicleAccess` authorization contract applies. Do not expose or let UI read the debug state to calculate business profiles. Existing non-financial IR/in-site BO/parking panels may keep their current typed/debug feed during this scope; Task 10 must remove only its financial matching logic.

- [ ] **Step 5: Add API equivalence and absence tests**

```ts
test("business profile endpoints equal direct selectors", async () => {
  const linked = linkedStore.read((state) => structuredClone(state), "test.profile-equivalence");
  await expect(api.customers.businessProfile("CUST-UAT-001")).resolves.toEqual(
    deriveCustomerBusinessProfile(linked, "CUST-UAT-001"),
  );
  await expect(api.vehicles.businessProfile("VEH-UAT-001")).resolves.toEqual(
    deriveVehicleBusinessProfile(linked, "VEH-UAT-001"),
  );
});

test("customer and vehicle records have no writable business summary", () => {
  expect(customerStore.customer(superadmin, "CUST-UAT-001")).not.toHaveProperty("paymentSummary");
  expect(customerStore.vehicle(superadmin, "VEH-UAT-001")).not.toHaveProperty("totalAmount");
  expect(customerStore.vehicle(superadmin, "VEH-UAT-001")).not.toHaveProperty("linkedOrderCount");
});
```

- [ ] **Step 6: Run the task gate**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-business-profile.spec.ts tests/unit/customers-api.spec.ts tests/unit/orders-api.spec.ts
npm run typecheck
```

Expected: all pass; all four routes share the selector result and Alicia's profile reconciles exactly.

- [ ] **Step 7: Commit the derived business APIs**

```bash
git add src/lib/customers/business-profile.ts src/lib/api/mock-orders.ts src/lib/api/client.ts tests/unit/customer-business-profile.spec.ts tests/unit/customers-api.spec.ts tests/unit/orders-api.spec.ts
git commit -m "feat(customers): derive business profiles from linked ledger"
```

### Task 10: Integrate Business History and Stable Customer-to-Vehicle Return Navigation

**Files:**

- Create: `src/components/customers/business-history-section.tsx`
- Modify: `src/components/customers/customer-detail-page.tsx`
- Modify: `src/components/customers/vehicle-detail-page.tsx`
- Modify: `src/components/customers/customer-list.tsx`
- Modify: `src/components/customers/vehicle-list.tsx`
- Modify: `src/components/customers/customers-workspace.tsx`
- Modify: `src/components/customers/vehicles-workspace.tsx`
- Modify: `src/components/customers/customer-workspace.tsx`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**

- Consumes: `BusinessProfile`, customer/vehicle workspace relationship facts, and `fromCustomerId` query parameter.
- Produces: one shared business-history renderer, list/detail summaries from the same ledger, and a reload-stable return link.

- [ ] **Step 1: Add RED Alicia and navigation browser contracts**

```ts
test("Alicia summary and fourteen source rows reconcile", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-001");
  const summary = page.getByTestId("customer-business-summary");
  await expect(summary).toContainText("14");
  await expect(summary).toContainText("JMD 532,000");
  await expect(summary).toContainText("JMD 489,000");
  await expect(summary).toContainText("JMD 43,000");
  await expect(page.getByTestId("business-history-row")).toHaveCount(14);

  const firstHref = await page.getByTestId("business-history-row").first()
    .getByRole("link", { name: "查看 BO" })
    .getAttribute("href");
  expect(firstHref).toMatch(/^\/orders\/business\/order-demo-(1[1-9]|2[0-4])$/);
});

test("customer vehicle link keeps a validated return source across reload", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-001");
  await page.getByTestId("customer-vehicle-link-VEH-UAT-001").click();
  await expect(page).toHaveURL(/\/vehicles\/VEH-UAT-001\?fromCustomerId=CUST-UAT-001$/);
  await page.reload();
  const back = page.getByTestId("vehicle-detail-back");
  await expect(back).toHaveText("返回 艾丽西亚·贝内特 / Alicia Bennett");
  await expect(back).toHaveAttribute("href", "/customers/CUST-UAT-001");
  await back.click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
});

test("direct or invalid vehicle sources return to the vehicle list", async ({ page }) => {
  await useIdentity(page, "superadmin");
  for (const url of [
    "/vehicles/VEH-UAT-001",
    "/vehicles/VEH-UAT-001?fromCustomerId=CUST-MISSING",
    "/vehicles/VEH-UAT-001?fromCustomerId=CUST-UAT-002",
  ]) {
    await page.goto(url);
    await expect(page.getByTestId("vehicle-detail-back")).toHaveText("返回车辆列表");
    await expect(page.getByTestId("vehicle-detail-back")).toHaveAttribute("href", "/vehicles");
  }
});

test("a historical relationship is a valid explicit return source", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/vehicles/VEH-UAT-003?fromCustomerId=CUST-UAT-001");
  await expect(page.getByTestId("vehicle-detail-back")).toHaveAttribute(
    "href",
    "/customers/CUST-UAT-001",
  );
});
```

- [ ] **Step 2: Run the affected E2E and confirm RED**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "Alicia|return|historical relationship"
```

Expected: FAIL because the pages still use static summaries, fuzzy name/phone matching, and a hardcoded vehicle-list back link.

- [ ] **Step 3: Implement one shared business-history renderer**

`BusinessHistorySection` receives a `BusinessProfile` and a context label. It renders BO number/time, vehicle plate/model, execution status, every latest Invoice number/version, total, gross paid, refund, net paid, balance, payment status, and `/orders/business/${businessOrderId}` link. A BO with no Invoice still renders with “尚未开票”. It never performs another data fetch or ID match.

- [ ] **Step 4: Replace all customer-detail summary sources**

Fetch `api.customers.businessProfile(customer.id)` once and pass that one object to the hero count, financial summary, and history. Delete both name/phone merge loops and every fallback to customer `orders`, `activeBusinessCount`, or `paymentSummary`. Both current and historical vehicle links use:

```ts
`/vehicles/${vehicle.id}?fromCustomerId=${customer.id}`
```

- [ ] **Step 5: Replace vehicle-detail summary and back-link sources**

Read `fromCustomerId` with `useSearchParams()`. Treat it as valid only when the workspace contains the customer and any relationship, current or historical, matches both IDs. Render `返回 ${customerDisplayName(sourceCustomer)}` to `/customers/${sourceCustomer.id}` when valid; otherwise render `返回车辆列表` to `/vehicles`. Fetch `api.vehicles.businessProfile(vehicle.id)` and delete plate-based matching and static vehicle amounts.

- [ ] **Step 6: Replace list/workspace filters and columns with summary maps**

Load customer/vehicle workspace and the corresponding business-profile map together. Any BO count, billed, paid, unpaid, latest-business sort, or business filter must use the map keyed by master ID. Remove UI branches for tags, contacts, source, recent business, recent service, and static totals. Missing profile map entry means a zero-valued derived profile, not a record fallback.

- [ ] **Step 7: Add a collision test at the page boundary**

Seed or intercept a second customer's display snapshot with Alicia's name and phone but a distinct customer ID. Assert Alicia still shows exactly 14 rows and the collision BO never appears. This test must modify display snapshots only, not the master IDs.

- [ ] **Step 8: Run the task gate**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "Alicia|business|return|historical|collision"
npm run typecheck
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
```

Expected: all pass; customer and vehicle pages show the same source rows/totals, and return navigation survives reload.

- [ ] **Step 9: Commit business history and navigation**

```bash
git add src/components/customers/business-history-section.tsx src/components/customers/customer-detail-page.tsx src/components/customers/vehicle-detail-page.tsx src/components/customers/customer-list.tsx src/components/customers/vehicle-list.tsx src/components/customers/customers-workspace.tsx src/components/customers/vehicles-workspace.tsx src/components/customers/customer-workspace.tsx tests/e2e/customer-vehicle.spec.ts
git commit -m "feat(customers): show ledger-backed history and return context"
```

### Task 11: Complete Desktop, Mobile, Persistence, Accessibility, and Repository Acceptance

**Files:**

- Modify: `tests/e2e/customer-vehicle.spec.ts`
- Modify: `tests/e2e/page-headers.spec.ts`
- Modify: `tests/e2e/mobile-nav.spec.ts`
- Modify: implementation files only when a failing acceptance assertion identifies a defect.

**Interfaces:**

- Consumes: the complete customer v3 and Linked Operations v4 implementation.
- Produces: end-to-end acceptance evidence for every approved behavior and a clean `main` commit.

- [ ] **Step 1: Add the remaining RED product acceptance scenarios**

The final E2E file must explicitly cover:

```ts
test("new customer has one name input and requires confirmed transliteration", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers");
  await page.getByRole("button", { name: "新建客户" }).click();
  await expect(page.getByTestId("form-customer-name")).toHaveCount(1);
  await expect(page.getByTestId("form-customer-name-zh")).toHaveCount(0);

  await page.getByTestId("form-customer-name").fill("陈志远");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("Chen Zhiyuan");

  await page.getByTestId("form-customer-name").fill("Jason Wong");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await expect(page.getByRole("alert")).toContainText("当前纯 Mock 音译库没有该完整姓名");
  await expect(page.getByText(/^王$/)).toHaveCount(0);
});

test("formal profile contains contacts but no unusable legacy fields", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-001");
  await expect(page.getByTestId("customer-formal-details")).toContainText("主要电话");
  for (const text of ["来源", "近期业务", "进行中业务", "风险说明", "loyal", "morning-pickup", "联系人列表"]) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
});

test("organization has one editable primary contact and individual has no extra contact", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-001");
  await expect(page.getByTestId("customer-extra-contacts")).toHaveCount(0);
  await page.goto("/customers/CUST-UAT-004");
  await page.getByRole("button", { name: "编辑正式资料" }).click();
  await expect(page.getByLabel("主要联系人职位／关系")).toHaveCount(1);
  await expect(page.getByTestId("form-customer-name")).toHaveCount(1);
});
```

Add persistence scenarios for OTP invalidate/reverify, KYC view, electronic PDF reopen/download, paper scan or physical location, and audit history after reload. Add a test that a legacy evidence gap says “证据待补”. Add all Alicia financial and customer-to-vehicle tests from Tasks 7 and 10.

- [ ] **Step 2: Add desktop and 430px geometry/accessibility assertions**

At desktop width, the OTP/KYC/agreement cards must form three columns with top edges within 2 px. At 430px, they must form one column, the page must have no horizontal overflow, and all buttons remain in the viewport. Test Tab focus into each dialog, Escape close, and focus restoration to the trigger. Assert one visible page `h1` and one `main` landmark.

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
await expect(page.locator("main")).toHaveCount(1);
await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
```

- [ ] **Step 3: Run the customer unit and E2E suite from a clean browser state**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-name-transliteration.spec.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-evidence-assets.spec.ts tests/unit/customer-seed-evidence.spec.ts tests/unit/customer-migrations.spec.ts tests/unit/canonical-customer-identities.spec.ts tests/unit/customer-business-profile.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts tests/unit/billing-api.spec.ts tests/unit/orders-api.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts tests/e2e/page-headers.spec.ts tests/e2e/mobile-nav.spec.ts
```

Expected: all selected tests pass with no retries required.

- [ ] **Step 4: Inspect the actual browser at desktop and 430px**

Open `/customers/CUST-UAT-001`, complete the OTP/KYC/agreement evidence views, enter `VEH-UAT-001`, reload, return to Alicia, and open one BO. Capture or inspect the desktop and 430px states. Confirm the visible values are 14 BO, JMD 532,000 billed, JMD 489,000 net paid, and JMD 43,000 unpaid; confirm every evidence action opens a real asset and no horizontal overflow exists. A passing HTTP response alone is not acceptance.

- [ ] **Step 5: Run the full repository gate**

Run in this order:

```bash
npm run typecheck
npm run test:unit
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
npm run build
git diff --check
```

Expected: every command exits `0`; no tracked build/test artifact appears in `git status --short`.

- [ ] **Step 6: Review the final diff against the approved deletions and invariants**

Run:

```bash
rg -n "customer-demo-|vehicle-demo-|independent_demo|morning-pickup|\bloyal\b|riskNote|activeBusinessCount|paymentSummary|licensePhotoUrl" src tests
rg -n "customer\.name\b|contacts\[|recentBusiness|recentService|linkedOrderCount|totalAmount|unpaidAmount" src/components/customers src/lib/customers src/lib/api/mock-customers.ts
git status --short
```

Expected: the first two commands show only explicit legacy migration fixtures or assertions that removed fields are absent; no production model, seed, selector, form, or page consumes them. Status contains only the intended task files plus the pre-existing untracked `.next.bak-*` directories.

- [ ] **Step 7: Commit final acceptance tests**

```bash
git add tests/e2e/customer-vehicle.spec.ts tests/e2e/page-headers.spec.ts tests/e2e/mobile-nav.spec.ts
git commit -m "test(customers): verify truthful profiles and evidence flows"
```

If an acceptance assertion exposes a source defect, return to its owning Task 1–10, change only that task's named implementation files, rerun that task gate, and make a separate scoped fix commit before this test-only commit. Never use a broad `git add src` to collect unknown changes.

- [ ] **Step 8: Record final verification evidence**

In the handoff, list the exact commands, exit results, inspected URLs and viewport sizes, customer and Linked schema versions, Alicia's derived totals, and any intentionally preserved legacy-only fields. Do not report the feature complete if the real browser evidence viewer, return link after reload, or one of the full repository gates remains unverified.
