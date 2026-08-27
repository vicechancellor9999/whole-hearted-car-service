# Non-blocking Customer Onboarding and Organization Contact License Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow customer creation with a missing phone, OTP, or driver-license evidence while preserving hard cross-customer phone uniqueness, hard vehicle plate uniqueness, and an optional driver-license evidence flow explicitly scoped to an organization’s primary contact.

**Architecture:** Keep the existing actor-bound in-memory onboarding session and one-write create receipt, but represent OTP and KYC as independent optional facts rather than sequential prerequisites. Treat phone ownership as a separate hard invariant at every write entry point, while names, email, and organization-name matches remain non-blocking reminders. Extend the existing KYC archive with one strict scoped-record branch for organization primary contacts; do not add a contact table or overwrite the organization address with the contact’s license address.

**Tech Stack:** Next.js 14, React 18, TypeScript, in-browser Mock store, Node test runner, Playwright, Tailwind CSS.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Before every commit run `npm run typecheck`, then `npm run test:collaboration` sequentially; UI behavior changes also require the relevant Playwright tests and the final full E2E suite.
- Missing phone, OTP, license evidence, or four license fields must produce truthful reminders, not a create/save block.
- A supplied normalized phone may belong to only one customer across `phone`, `secondaryPhone`, and `whatsapp`; the same customer may reuse its own number in multiple contact fields.
- A supplied normalized plate may belong to only one vehicle; retain the existing vehicle uniqueness implementation and add regression coverage rather than rewriting it.
- Individual name and organization name remain the minimum human-readable record identity in this task. This task does not create anonymous placeholder customers.
- Name, email, and organization-name similarity are warnings only and cannot require an approval checkbox before save.
- An organization primary-contact license is optional. If present, its four-field snapshot belongs to the contact and must not overwrite the organization address, birth date, or gender.
- Do not add a real OCR/AI provider, route, SDK, key, endpoint, backend, database, or new dependency.
- Preserve access-first authorization, bound sessions, idempotent response-loss recovery, source-revision concurrency checks, evidence validation, and Base64/privacy boundaries.
- Preserve existing historical duplicate-phone records as readable data. Enforce uniqueness on new ownership or changed ownership; do not make schema-v3 loading reject legacy state.
- Keep the four existing `.next.bak-*` directories untouched and out of every commit.

---

## File Structure

- `src/lib/customers/onboarding-types.ts`: public onboarding result, reminder, and optional-phone DTOs.
- `src/lib/customers/onboarding-domain.ts`: normalized cross-customer phone ownership matching.
- `src/lib/customers/verification-types.ts`: strict organization-primary-contact KYC record and onboarding-gap unions.
- `src/lib/customers/driver-license-profile.ts`: one exact four-field normalizer shared by onboarding, existing-customer KYC, and migration validation.
- `src/lib/customers/verification-domain.ts`: subject-aware KYC derivation.
- `src/lib/customers/migrations.ts`: strict exact-key validation for old KYC, scoped KYC, legacy gaps, and onboarding gaps.
- `src/lib/customers/types.ts`: strict existing-customer KYC submit union; no CustomerRecord schema-version change.
- `src/lib/api/mock-customers.ts`: authoritative phone ownership, optional onboarding facts, scoped KYC persistence, reminders, and atomic create.
- `src/lib/api/client.ts`: propagate the exact typed DTOs through existing routes; no new route.
- `src/components/customers/customer-onboarding-state.ts`: missing/available/conflict phone states and preview reminders.
- `src/components/customers/customer-onboarding-dialog.tsx`: non-blocking orchestration and organization contact scoping.
- `src/components/customers/onboarding-phone-step.tsx`: blank-phone continuation, optional OTP, and hard conflict card.
- `src/components/customers/onboarding-license-step.tsx`: reusable optional license step with subject-specific copy.
- `src/components/customers/onboarding-profile-step.tsx`: organization address separation and warning-only similarity candidates.
- `src/components/customers/form-dialogs.tsx`: existing-customer edit keeps phone conflicts hard while making non-phone similarity warnings non-blocking.
- `src/components/customers/verification-evidence-section.tsx`: organization contact license status/action/history.
- `src/components/customers/kyc-verification-dialog.tsx`: scoped organization-contact evidence submission without formal organization-address overwrite.
- `src/components/customers/detail-shared.tsx`: count organization contact license gaps.
- Existing unit and E2E specs listed per task provide TDD coverage.

---

### Task 1: Make phone ownership the only hard customer-duplicate rule

**Files:**
- Modify: `src/lib/customers/onboarding-types.ts`
- Modify: `src/lib/customers/onboarding-domain.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `tests/unit/customer-onboarding.spec.ts`
- Modify: `tests/unit/customers-store.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`

**Interfaces:**
- Consumes: `matchOnboardingPhones(customers, incoming)` and the existing `CustomerVehicleValidationError` response mapping.
- Produces: nullable phone preview sessions, one authoritative `assertCustomerPhoneOwnershipAvailable(...)` path reused by create/update/OTP, and soft non-phone duplicate candidates.

- [ ] **Step 1: Write phone-ownership RED tests**

Add focused cases which prove:

```ts
const seededCustomer = store.customer(superadmin, "CUST-UAT-001");
const blank = store.previewOnboardingPhone(superadmin, {
  customerType: "individual",
  primaryPhone: "",
  clientMutationId: "phone-blank",
});
expect(blank).toMatchObject({ status: "clear", phoneE164: null });
expect(blank.status === "clear" && blank.onboardingToken).toBeTruthy();

const owned = store.previewOnboardingPhone(superadmin, {
  customerType: "individual",
  primaryPhone: seededCustomer.whatsapp!,
  clientMutationId: "phone-owned",
});
expect(owned.status).toBe("duplicate");
expect(owned).not.toHaveProperty("onboardingToken");

const name = store.previewCustomerName(superadmin, "陈志远");
expect(() => store.previewCustomer(superadmin, {
  customerType: "individual",
  nameSourceValue: "陈志远",
  nameTransliterationToken: name.confirmationToken,
  primaryPhone: seededCustomer.whatsapp,
})).toThrow(/电话号码已属于其他客户档案/);
```

Cover all nine incoming/stored field combinations, inactive and blacklisted owners, same-customer internal reuse, legacy duplicates preserved during unrelated edits, a historical owner re-verifying its unchanged old number, final-create races, and ordinary create/update/OTP entry points. Keep the existing plate-duplicate regression green.

Also cover a named individual and a named organization created with `phone`, `secondaryPhone`, `whatsapp`, and `email` all blank. They must save with reminder facts; the existing individual-name and organization-name minimum identity rules remain green.

- [ ] **Step 2: Run the focused tests and record RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
```

Expected: blank phone fails with `CUSTOMER_ONBOARDING_PHONE_REQUIRED`; ordinary create or existing-customer OTP exposes at least one uniqueness bypass; existing onboarding duplicate tests remain green.

- [ ] **Step 3: Change the phone preview DTO to permit an empty number**

Use this exact public shape:

```ts
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
```

Normalize whitespace-only input to `null`. Only a supplied phone can return `duplicate`.

Remove the existing `normalizeCustomerInput` requirement for at least one of phone, WhatsApp, or email. Normalize absent contact channels to `null`; retain the individual-name and organization-name requirements stated in Global Constraints.

- [ ] **Step 4: Centralize new phone ownership checks**

Add one helper in `mock-customers.ts` which excludes the current customer when a customer ID is supplied:

```ts
function assertCustomerPhoneOwnershipAvailable(
  state: CustomerVehicleState,
  incoming: Readonly<Partial<Record<OnboardingInputPhoneField, string | null>>>,
  excludedCustomerId: string | null = null,
): void {
  const matches = matchOnboardingPhones(
    excludedCustomerId ? state.customers.filter((entry) => entry.id !== excludedCustomerId) : state.customers,
    incoming,
  );
  if (matches.length > 0) {
    codedValidation("电话号码已属于其他客户档案", "CUSTOMER_PHONE_DUPLICATE", 409);
  }
}
```

Call it from onboarding preview/create, ordinary customer preview/create, and changed-phone update. For existing-customer OTP, first normalize the requested record number and compare it with all three phone fields on the target customer:

- if the target customer already owns that number in `phone`, `secondaryPhone`, or `whatsapp`, allow request and verify even when another historical customer also has the old number;
- if the target customer does not already own it, request checks other customers before issuing the challenge and verify checks again before adopting it as `phone`;
- a race discovered at verify returns `CUSTOMER_PHONE_DUPLICATE` with zero customer mutation.

Do not add uniqueness to schema-v3 loading because historical duplicates must stay readable.

- [ ] **Step 5: Separate phone conflicts from soft duplicate candidates**

Make `duplicateCandidates(...)` omit phone and WhatsApp reasons for new previews. Preserve name, email, and organization-name candidates, but remove the server requirement that `confirmPossibleDuplicate === true` before customer create/update. Keep candidates in the preview and audit snapshot as warnings.

- [ ] **Step 6: Run Task 1 GREEN gates**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
npm run typecheck
npm run test:collaboration
git diff --check
```

Expected: all focused tests pass; blank phone gets a token; every new cross-customer phone claim returns 409; plate tests remain unchanged and green.

- [ ] **Step 7: Review and commit Task 1**

Review only the files listed for Task 1, then commit:

```bash
git add src/lib/customers/onboarding-types.ts src/lib/customers/onboarding-domain.ts src/lib/api/mock-customers.ts tests/unit/customer-onboarding.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
git commit -m "fix(customers): enforce phone ownership without requiring a number"
```

---

### Task 2: Persist optional OTP/KYC facts and scoped organization-contact evidence

**Files:**
- Create: `src/lib/customers/driver-license-profile.ts`
- Modify: `src/lib/customers/onboarding-types.ts`
- Modify: `src/lib/customers/verification-types.ts`
- Modify: `src/lib/customers/verification-domain.ts`
- Modify: `src/lib/customers/migrations.ts`
- Modify: `src/lib/customers/types.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `tests/unit/customer-onboarding.spec.ts`
- Modify: `tests/unit/customer-verification-domain.spec.ts`
- Modify: `tests/unit/customer-migrations.spec.ts`
- Modify: `tests/unit/customers-store.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`

**Interfaces:**
- Consumes: nullable phone sessions from Task 1 and existing evidence validation.
- Produces: `DriverLicenseProfile`, scoped organization KYC records, `OnboardingReminder[]`, optional OTP/KYC create snapshots, and subject-aware derivation.

- [ ] **Step 1: Write optional-verification and scoped-record RED tests**

Cover these exact facts:

```ts
const preview = store.previewOnboardingCustomer(superadmin, blankPhoneToken, {
  customer: minimalNamedIndividualDraft,
  clientMutationId: "preview-with-gaps",
});
expect(preview.reminders).toEqual(expect.arrayContaining([
  { kind: "otp", status: "phone_missing" },
  { kind: "kyc", subjectType: "customer", status: "evidence_missing" },
]));

const created = store.createOnboardingCustomer(superadmin, blankPhoneToken, {
  previewToken: preview.previewToken,
  clientMutationId: "create-with-gaps",
});
expect(created.phone).toBeNull();
expect(created.verificationArchive.otpRecords).toHaveLength(0);
expect(created.verificationArchive.kycRecords).toHaveLength(0);
expect(created.verificationArchive.evidenceGaps).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "otp", reason: "onboarding_incomplete", status: "phone_missing" }),
  expect.objectContaining({ kind: "kyc", reason: "onboarding_incomplete", status: "evidence_missing" }),
]));
```

Also test requested-but-unverified OTP, submitted-but-unverified KYC, verified KYC, organization KYC subject/profile, company-address separation, old unscoped organization records, contact-name mismatch, exact-key rejection, subject-aware audit wording with no profile/Base64 leakage, write failure, response loss, and one-persist semantics.

- [ ] **Step 2: Run focused RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
```

Expected: preview still rejects missing OTP/KYC; organization submit rejects with `CUSTOMER_ONBOARDING_KYC_NOT_APPLICABLE`; scoped record shapes fail migration validation.

- [ ] **Step 3: Add reminder and profile types**

Move the four-field snapshot to `verification-types.ts`:

```ts
export interface DriverLicenseProfile {
  readonly name: string;
  readonly birthDate: string;
  readonly sex: "M" | "F";
  readonly address: string;
}

// onboarding-types.ts re-exports the shared shape instead of defining a second copy.
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
```

Create `src/lib/customers/driver-license-profile.ts` as the only runtime normalizer for this snapshot:

```ts
export const DRIVER_LICENSE_NAME_MAX = 120;
export const DRIVER_LICENSE_ADDRESS_MAX = 320;

export function normalizeDriverLicenseProfile(value: unknown): DriverLicenseProfile;
```

The function requires exactly `name`, `birthDate`, `sex`, and `address`; trims and collapses ordinary whitespace; accepts only real, non-future `YYYY-MM-DD` dates and exact `M`/`F`; rejects control characters and `data:` content; accepts name lengths 1–120 and address lengths 1–320; and never truncates or guesses. Onboarding submit, existing-customer KYC submit, migration validation, and UI response normalization must all reuse it.

Add `status: "ready"` and `reminders: readonly OnboardingReminder[]` to `OnboardingCustomerPreview` and its bound session snapshot. The `status` discriminator is required for Task 3's conflict-result union. Extend `VerificationEvidenceGap` as a strict union so a new customer can persist a real missing-evidence fact:

```ts
export interface LegacyVerificationEvidenceGap {
  readonly kind: "otp" | "kyc" | "agreement";
  readonly legacyCompletedAt: string | null;
  readonly legacyAgreementVersion?: string;
  readonly reason: "legacy_completion_without_evidence";
  readonly migratedAt: string;
}

export type VerificationEvidenceGap =
  | LegacyVerificationEvidenceGap
  | {
      readonly kind: "otp";
      readonly reason: "onboarding_incomplete";
      readonly status: "phone_missing" | "not_requested";
      readonly recordedAt: string;
      readonly recordedBy: string;
    }
  | {
      readonly kind: "kyc";
      readonly reason: "onboarding_incomplete";
      readonly subjectType: "customer" | "organization_primary_contact";
      readonly status: "evidence_missing";
      readonly recordedAt: string;
      readonly recordedBy: string;
    };
```

- [ ] **Step 4: Extend KYC records as a strict compatibility union**

Keep the old exact record branch untouched and add only:

```ts
interface BaseKycVerificationRecord {
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

export type LegacyKycVerificationRecord = BaseKycVerificationRecord & {
  readonly subjectType?: never;
  readonly subjectProfile?: never;
};

export type KycVerificationRecord =
  | LegacyKycVerificationRecord
  | (BaseKycVerificationRecord & {
      readonly subjectType: "organization_primary_contact";
      readonly subjectProfile: DriverLicenseProfile;
    });
```

Update `migrations.ts` to validate each KYC and gap branch with exact own keys. The legacy KYC branch permits only the existing base keys (including the existing paired optional timestamp/actor fields) and neither subject key. The scoped branch requires both `subjectType` and `subjectProfile`, then reuses `normalizeDriverLicenseProfile`. Each gap branch must have exactly its own discriminated keys and its own `migratedAt` or `recordedAt` chronology. Continue validating evidence signatures, IDs, and Base64 metadata boundaries. Keep schema version 3 and do not rewrite old records.

- [ ] **Step 5: Make KYC derivation subject-aware**

Implement:

```ts
export type KycSubject =
  | { readonly type: "customer" }
  | { readonly type: "organization_primary_contact"; readonly currentName: string | null };

export function deriveKycVerification(
  archive: CustomerVerificationArchive,
  subject: KycSubject = { type: "customer" },
): KycVerificationView;
```

For organizations, ignore unscoped historical records for current status, select only scoped contact records, and return `needs_reverification` when a verified snapshot name no longer matches the current contact name. Preserve all historical records for viewing.

- [ ] **Step 6: Replace the onboarding linear hard-gate stage with optional facts**

Use `stage: "collecting" | "customer_previewed" | "creating"`, `phoneE164: string | null`, and nullable OTP/KYC preview snapshots. `requestOtp` must return `CUSTOMER_ONBOARDING_PHONE_REQUIRED` only when an employee explicitly tries to request OTP without a phone; that error cannot prevent preview/create. KYC submit and verify must not require OTP and must allow both customer types.

- [ ] **Step 7: Build reminders and atomically persist only facts that exist**

At preview time:

- add `phone_missing`, `not_requested`, or `pending` OTP reminder as applicable;
- add KYC `evidence_missing` or `pending_verification` reminder as applicable;
- add profile-mismatch reminder instead of rejecting when formal fields differ from confirmed license fields;
- keep the hard phone-ownership check from Task 1.

At create time:

- write no OTP record and one exact OTP onboarding gap when no request exists;
- write a pending OTP record when requested but unverified;
- write a verified OTP record when verified;
- write no KYC record and one exact subject-scoped KYC onboarding gap when no evidence exists;
- write pending or verified KYC according to the actual session;
- for organization KYC, add `subjectType: "organization_primary_contact"` and the exact `subjectProfile` snapshot;
- never copy the organization contact’s birth date, sex, or license address into the organization CustomerRecord;
- emit audit events only for operations that actually occurred, then always emit `customer_created`; do not add new reminder-count keys to audit `changes`—the persisted evidence gaps are the source of truth, while the safe summary may say that follow-up items remain;
- use exact organization summaries `提交主要联系人驾驶证证据` and `完成主要联系人驾驶证核验`; never say `企业驾驶证`;
- keep audit changes compact: record safe IDs, document type, subject type, and timestamps only; never put `subjectProfile` values, image URLs, or Base64 into audit;
- preserve the persisted idempotency lookup before token validation and consume the session only after one successful `persist()`.

- [ ] **Step 8: Extend existing-customer KYC submission safely**

Change `SubmitCustomerKycInput` to this strict union. Individual customers accept the first branch; organization customers require the second branch. Reject a scoped organization branch for individuals and an unscoped branch for organizations.

```ts
export type SubmitCustomerKycInput =
  | {
      readonly subjectType?: never;
      readonly subjectProfile?: never;
      readonly frontAsset: EvidenceAsset;
      readonly backAsset?: EvidenceAsset;
      readonly clientMutationId: string;
    }
  | {
      readonly subjectType: "organization_primary_contact";
      readonly subjectProfile: DriverLicenseProfile;
      readonly frontAsset: EvidenceAsset;
      readonly backAsset?: EvidenceAsset;
      readonly clientMutationId: string;
};
```

Apply the same subject-aware audit summaries and compact-change rule from Step 7 to existing-customer submit/verify/invalidate operations. Unit tests must assert that organization-contact audit events contain `主要联系人驾驶证`, never `企业驾驶证`, and contain neither any of the four profile values nor a data URL/Base64 payload.

- [ ] **Step 9: Run Task 2 GREEN gates**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
npm run typecheck
npm run test:collaboration
git diff --check
```

- [ ] **Step 10: Review and commit Task 2**

Commit only the listed Task 2 files:

```bash
git add src/lib/customers/driver-license-profile.ts src/lib/customers/onboarding-types.ts src/lib/customers/verification-types.ts src/lib/customers/verification-domain.ts src/lib/customers/migrations.ts src/lib/customers/types.ts src/lib/api/mock-customers.ts src/lib/api/client.ts tests/unit/customer-onboarding.spec.ts tests/unit/customer-verification-domain.spec.ts tests/unit/customer-migrations.spec.ts tests/unit/customers-store.spec.ts tests/unit/customers-api.spec.ts
git commit -m "feat(customers): record optional verification facts"
```

---

### Task 3: Make onboarding visibly non-blocking and reuse the license step for organizations

**Files:**
- Modify: `src/lib/customers/onboarding-types.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/components/customers/customer-onboarding-state.ts`
- Modify: `src/components/customers/customer-onboarding-dialog.tsx`
- Modify: `src/components/customers/onboarding-phone-step.tsx`
- Modify: `src/components/customers/onboarding-license-step.tsx`
- Modify: `src/components/customers/onboarding-profile-step.tsx`
- Modify: `src/components/customers/form-dialogs.tsx`
- Modify: `tests/unit/customer-onboarding-state.spec.ts`
- Modify: `tests/unit/customer-onboarding.spec.ts`
- Modify: `tests/unit/customers-api.spec.ts`
- Modify: `tests/e2e/customer-onboarding.spec.ts`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Consumes: Task 2 `OnboardingCustomerPreview.reminders`, nullable normalized phone, and organization-scoped KYC store behavior.
- Produces: an optional-phone/OTP/license onboarding UI with hard conflict cards and a truthful missing-items preview.

- [ ] **Step 1: Write reducer and browser RED tests**

Add tests for:

- blank phone button text `无号码，继续建档` and token acquisition;
- a supplied owned phone showing the existing customer link and no create path;
- OTP not requested and OTP pending both reaching preview/create;
- no license image and partial four fields reaching preview/create with reminder summary;
- organization license step titled `企业主要联系人驾驶证（选填）`;
- organization can either skip it or complete it;
- organization address stays unchanged after a contact license is confirmed;
- name/email/organization candidates display as warnings without a required checkbox;
- existing-customer edits save name/email/organization warning candidates without an approval checkbox while changed-phone conflicts still fail;
- secondary/WhatsApp conflicts surface the existing owner and block preview until changed or cleared;
- 1440×900 and 430×932 no root overflow.

Also add store/API/reducer contracts for the final preview result:

```ts
export type OnboardingCustomerPreviewResult =
  | OnboardingCustomerPreview
  | {
      readonly status: "phone_conflict";
      readonly matches: readonly OnboardingPhoneDuplicateMatch[];
      readonly sourceRevision: number;
    };
```

The conflict branch has no `previewToken`. It safely supplies the existing customer IDs/names needed for links. `previewOnboardingCustomer` returns this branch for a secondary-phone or WhatsApp ownership conflict; `createOnboardingCustomer` still performs the authoritative last-moment check and returns 409 on a race.

- [ ] **Step 2: Run RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding-state.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts --grep "blank phone|organization primary contact|missing OTP|missing licence|phone ownership|plate duplicate|430|1440"
```

Expected: blank phone check is disabled; profile remains disabled without verified OTP/KYC; organization license UI is absent.

- [ ] **Step 3: Add missing phone state without weakening conflict state**

Extend phone status to `"missing"`; let `phoneCleared` accept `phoneE164: string | null`; show:

- idle: `填写号码查询，或留空继续`;
- missing: `未填写号码，可继续建档`;
- clear: `号码未被使用，可选做 OTP`;
- duplicate: `该号码属于已有客户`;
- verified: `号码已验证`.

The same action button checks a supplied phone or starts a missing-phone session for blank input. Keep duplicate conflict red and link to the existing customer.

- [ ] **Step 4: Decouple visible steps from OTP/KYC completion**

Once `onboardingToken` exists, enable both the license and formal-profile steps. Do not derive `profileEnabled` from `otpVerification` or `kycConfirmation`. Keep request/verify buttons functional but optional. Do not auto-check attestation or fabricate verification.

- [ ] **Step 5: Reuse the license component with subject-specific copy**

Add props:

```ts
interface OnboardingLicenseStepProps {
  readonly subjectLabel: "客户" | "企业主要联系人";
  readonly optional: true;
  // existing state, file, transform, extraction, and callbacks remain unchanged
}
```

Render it for both customer types. For organizations, label the four fields as contact fields and never copy address/birthDate/sex into `profileFields`; only set the contact name source after a confirmed license. The formal organization address stays editable in `OnboardingProfileStep`.

- [ ] **Step 6: Present a truthful preview and warning-only candidates**

Branch on `OnboardingCustomerPreviewResult`: dispatch the normal preview action only for `status: "ready"`; dispatch a dedicated phone-conflict action for `status: "phone_conflict"`, render every safe owner as an existing-customer link, and keep no preview token in state. Render `customerPreview.reminders` above the create button with plain copy and follow-up actions. Do not require an override checkbox for name/email/organization candidates. Apply the same warning-only behavior to `CustomerFormDialog` edit previews; the store remains authoritative for changed-phone conflicts. Keep create disabled only for busy state, committed state, absent preview, or a current phone-ownership conflict.

- [ ] **Step 7: Run Task 3 GREEN gates and visual checks**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-onboarding-state.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts
npm run typecheck
npm run test:collaboration
git diff --check
```

Capture and inspect 1440×900 and 430×932 screenshots of blank-phone individual creation, organization license skipped, and organization license completed.

- [ ] **Step 8: Review and commit Task 3**

```bash
git add src/lib/customers/onboarding-types.ts src/lib/api/mock-customers.ts src/lib/api/client.ts src/components/customers/customer-onboarding-state.ts src/components/customers/customer-onboarding-dialog.tsx src/components/customers/onboarding-phone-step.tsx src/components/customers/onboarding-license-step.tsx src/components/customers/onboarding-profile-step.tsx src/components/customers/form-dialogs.tsx tests/unit/customer-onboarding-state.spec.ts tests/unit/customer-onboarding.spec.ts tests/unit/customers-api.spec.ts tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts
git commit -m "feat(customers): allow incomplete onboarding with reminders"
```

---

### Task 4: Show and supplement organization primary-contact licenses on customer detail

**Files:**
- Modify: `src/components/customers/detail-shared.tsx`
- Modify: `src/components/customers/verification-evidence-section.tsx`
- Modify: `src/components/customers/kyc-verification-dialog.tsx`
- Modify: `src/components/customers/customer-detail-page.tsx` only if labels need a subject-profile display slot
- Modify: `tests/e2e/customer-vehicle.spec.ts`
- Modify: `tests/unit/customer-verification-domain.spec.ts`

**Interfaces:**
- Consumes: Task 2 subject-aware KYC derivation and strict organization submit union.
- Produces: current organization-contact KYC status, scoped supplement/reverify actions, evidence viewing, and name-mismatch reminders.

- [ ] **Step 1: Write detail-flow RED tests**

Cover:

- an existing organization with no scoped record shows `主要联系人驾驶证：待补` and a supplement action;
- an old unscoped organization KYC record remains in history but does not satisfy current status;
- scoped upload/verify persists the four-field snapshot and can be viewed after reload;
- the detail card shows the scoped contact name, birth date, sex, and `证件地址`, and reopening the dialog initializes those exact four values from the latest scoped record;
- the organization address remains byte-for-byte unchanged;
- changing the primary-contact name preserves evidence history but changes current status to `需重新核验`;
- individual KYC evidence behavior remains unchanged, except that a name-similarity candidate is a visible warning and no longer requires a confirmation checkbox;
- both individual and organization KYC profile mismatch/name-similarity candidates remain warning-only; a phone ownership conflict still fails independently with 409;
- 430px dialog fits and restores trigger focus.

- [ ] **Step 2: Run RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-verification-domain.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "主要联系人驾驶证|organization contact|KYC|430"
```

- [ ] **Step 3: Make the evidence card subject-aware**

Call `deriveKycVerification` with `{ type: "organization_primary_contact", currentName: customer.nameSourceValue }` for organizations. Replace the `不适用` card with the same evidence card pattern titled `主要联系人驾驶证`; include `待补`, `待核验`, `已核验`, or `需重新核验` and the appropriate supplement/reverify action. For a scoped record, display four labeled rows: `联系人姓名`, `出生日期`, `性别`, and `证件地址`. Label historical rows by subject and leave an old unscoped organization record as `主体待确认`. Continue using `EvidenceAssetViewer` for exact validated assets.

- [ ] **Step 4: Make the existing KYC dialog store contact-scoped data**

For organizations, initialize the four fields from the latest scoped `subjectProfile` when one exists. Require the four fields only when the employee chooses to submit evidence, then send:

```ts
{
  subjectType: "organization_primary_contact",
  subjectProfile: { name, birthDate, sex, address },
  frontAsset,
  ...(backAsset ? { backAsset } : {}),
  clientMutationId,
}
```

Do not PATCH the organization’s address, gender, or birth date. Assert in the browser test that `CustomerRecord.address` is byte-for-byte unchanged before and after submit, verify, reload, and reopen. If the snapshot name differs from the current contact name, save the evidence and show a reminder; do not block or silently rename the contact.

For both customer types, remove the `confirmDuplicate` checkbox as a submit/verify condition. Render the same candidate information as a warning only. This change does not soften `CUSTOMER_PHONE_DUPLICATE`; phone ownership remains a separate authoritative store error.

- [ ] **Step 5: Count organization contact KYC gaps**

Update `pendingVerificationCount` so organizations count an absent/mismatched scoped record as one pending item, just like individual customer KYC.

- [ ] **Step 6: Run Task 4 GREEN gates and commit**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customer-verification-domain.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "主要联系人驾驶证|organization contact|KYC|430"
npm run typecheck
npm run test:collaboration
git diff --check
```

Then commit:

```bash
git add src/components/customers/detail-shared.tsx src/components/customers/verification-evidence-section.tsx src/components/customers/kyc-verification-dialog.tsx src/components/customers/customer-detail-page.tsx tests/e2e/customer-vehicle.spec.ts tests/unit/customer-verification-domain.spec.ts
git commit -m "feat(customers): track organization contact licenses"
```

---

### Task 5: Full regression, visual acceptance, and live handoff

**Files:**
- Create: `.superpowers/sdd/2026-08-14-nonblocking-onboarding-organization-contact-license/final-report.md` (ignored; do not force-add)
- Modify tests only if a real regression is reproduced and fixed with a preceding RED.

**Interfaces:**
- Consumes: all prior task commits.
- Produces: fresh verification evidence and an opened product at the current app route.

- [ ] **Step 1: Run all automated gates sequentially**

```bash
npm run typecheck
npm run test:collaboration
npm run test:unit
npm run build
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
git diff --check
```

Do not run typecheck in parallel with collaboration because collaboration creates temporary TypeScript fixtures.

- [ ] **Step 2: Perform desktop and mobile visual acceptance**

Using the repository Playwright fallback if the Browser plugin is unavailable, inspect 1440×900 and 430×932 for:

- blank-phone individual creation through preview and save;
- supplied duplicate phone conflict with existing-customer link;
- OTP skipped and OTP pending reminders;
- license skipped and completed paths;
- organization primary-contact license skipped and completed;
- organization address separated from contact license address;
- no root horizontal overflow, clipped sticky actions, obscured errors, console errors, or inaccessible focus return.

Save screenshots only under `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/`.

- [ ] **Step 3: Independent bounded review**

Request review against:

- missing-data non-blocking behavior;
- complete phone ownership coverage and same-customer reuse;
- unchanged plate uniqueness;
- scoped organization-contact evidence and address separation;
- idempotent create/response-loss recovery;
- session isolation, privacy, migration exactness, and historical compatibility.

Resolve every Critical or Important finding with a new RED, minimal fix, and a fresh full gate run.

- [ ] **Step 4: Write the final report and commit any review fix**

The ignored report must list exact commands/results, screenshots, commit hashes, known concerns, and review severity counts. Do not stage `.superpowers` or `.next.bak-*`.

- [ ] **Step 5: Open the finished product for the user**

Verify the actual listener belongs to this `main` checkout, open `/customers`, and leave the product showing the new-customer flow rather than a diff or test report. Report the visible URL and the exact user flows verified.
