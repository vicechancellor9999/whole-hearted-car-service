# Inspection Report, Quotation, Billing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each production change follows RED → verified failure → GREEN → focused verification → review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Inspection Report and its Quotation as the approved customer-communication workflow, introduce one shared three-category charge contract with item discounts and one-time high-discount signatures, copy selected current quotation rows directly into independent Business Orders, and carry the same money facts through Invoice, parking, and independent payment/refund flows using a clean, deterministic Mock demonstration dataset.

**Architecture:** `QuotedChargeLine` is the only mutable charge representation shared by IR Quotation and Quick BO. Labor and parts are unit-priced lines with per-unit discount; other fees are fixed-total lines with no discount; parking is a separate read-only Invoice projection. One current linked-operations envelope is initialized from a deterministic clean seed and stores append-only mutation, signature, generation, notification, response, payment, refund, and parking-claim facts. UI and PDFs consume the same authoritative totals and independent ledger records. Current Quotation remains editable; V1/V2 are generation counters and Jamaica generation timestamps, not immutable business revisions.

**Tech Stack:** TypeScript 5.5, React 18, Next.js 14 App Router, browser localStorage/IndexedDB mock persistence, pdf-lib, Playwright unit/E2E tests.

**Spec:**
- `docs/superpowers/specs/2026-08-20-inspection-report-redesign-design.md`
- `docs/superpowers/specs/2026-08-10-orders-documents-billing-archives-design.md`
- `docs/superpowers/specs/2026-08-22-independent-payment-refund-records-design.md`

## Global Constraints

- Work directly on `main`; the repository explicitly forbids branches and git worktrees.
- Preserve and audit all inherited dirty changes. Do not discard, reset, or overwrite them. The current untracked BO-selection dialog contradicts the approved direct-row selection model and must not be shipped.
- Keep `wh_linked_operations_state_v1` and the `wh-linked-operations-v2` lock name stable.
- Existing business records are disposable Mock demonstration data. Missing or obsolete project state is reset to the clean seed; do not migrate, backfill, dual-write, repair, or preserve old Mock facts.
- Reset scope is limited to this project's exact Mock business keys and IndexedDB demo records. Never delete source, Git history, specs, screenshots, user files, session/preferences, or unrelated dirty work.
- New IR → Quick BO writes no source graph, revision snapshot, hash, or structured back-reference that could block current Quotation edits or deletions.
- All new money values are non-negative safe integer JMD. Manual item discounts may be any integer amount; only automatic allocation constrains final unit prices to JMD 50 steps.
- Other fees are fixed one-price charges. They have no quantity, unit discount, pending-quote state, auto-allocation participation, or discount-signature threshold.
- Parking is not an IR Quotation other fee. It is a read-only Invoice projection acquired by an atomic parking-case claim.
- Labor discounts strictly above 20% and priced-parts discounts strictly above 12.5% require one non-empty raw signature trace for that successful write. Equal thresholds do not. Quotation, BO, and Invoice each consume their own signature; no cross-document reuse.
- Every mutable write uses `expectedRevision` plus a stable `mutationId`; actor account and role come from the authenticated session, never from the client payload.
- Customer PDF content excludes raw natural language, AI instructions, internal stages, internal photos, audit data, and BO controls.
- Report photos are report-level vehicle-record attachments stored as IndexedDB Blobs with localStorage metadata only; never persist Base64 payloads in canonical localStorage.
- Before each implementation commit run focused tests and `npm run typecheck`; before any page-behavior commit also update E2E. Before final completion run `npm run typecheck`, `npm run test:collaboration`, full unit tests, full E2E, and real desktop/430px browser QA.

---

### Task 1: Shared three-category charge contract and deterministic totals

**Files:**
- Create: `src/lib/billing/quoted-charges.ts`
- Create: `src/lib/billing/discount-approval.ts`
- Modify: `src/lib/billing/types.ts`
- Modify: `src/lib/billing/calculations.ts`
- Modify: `src/lib/orders/quick-order-types.ts`
- Create: `tests/unit/quoted-charge-totals.spec.ts`
- Create: `tests/unit/discount-approval.spec.ts`
- Modify: `tests/unit/invoice-calculations.spec.ts`

**Interfaces:**
- Produces `UnitPricedChargeLine`, `FixedTotalChargeLine`, `ParkingProjectionChargeLine`, and `QuotedChargeLine` as a discriminated union.
- Produces `calculateQuotedChargeTotals(lines)` and `allocateOrderDiscount(lines, targetDiscountJmd, participatingIds)`.
- Produces `discountApprovalRequirement(lines)` and raw one-time `DiscountApprovalEvidence` validation.
- Produces a `QuickOrderChargeLine` labor/parts/fixed-total subset for current writes. Clean seeds and all newly created BOs use this shape directly; obsolete Mock item shapes are reset, not adapted.

- [x] **Step 1: Write failing table-driven totals tests**

Use hand-calculated literals to cover: zero discount, arbitrary manual discount, quantity greater than one, free unit, pending parts excluded, fixed-total other fee included once, parking included only in Invoice totals, unsafe/negative values rejected, and duplicate IDs rejected. Include this exact core fixture:

```ts
expect(calculateQuotedChargeTotals([
  { id: "labor-1", category: "labor", pricingMode: "unit", quantity: 2, unitPriceJmd: 25_000, unitDiscountJmd: 1_250, pendingQuote: false, /* bilingual text */ },
  { id: "parts-1", category: "parts", pricingMode: "unit", quantity: 1, unitPriceJmd: 10_000, unitDiscountJmd: 0, pendingQuote: true, /* bilingual text */ },
  { id: "other-1", category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 7_500, /* bilingual text */ },
])).toMatchObject({ laborGrossJmd: 50_000, laborDiscountJmd: 2_500, laborNetJmd: 47_500, partsNetJmd: 0, otherFeeTotalJmd: 7_500, grandTotalJmd: 55_000 });
```

- [x] **Step 2: Run the new tests and verify RED**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/quoted-charge-totals.spec.ts tests/unit/discount-approval.spec.ts tests/unit/invoice-calculations.spec.ts
```

Expected: the new modules/types are missing and old Invoice totals cannot represent fixed-total or per-unit discounts.

- [x] **Step 3: Implement validation and totals as pure functions**

Labor/parts formulas are exact:

```text
finalUnitPriceJmd = unitPriceJmd - unitDiscountJmd
grossLineJmd = quantity * unitPriceJmd
lineDiscountJmd = quantity * unitDiscountJmd
finalLineJmd = quantity * finalUnitPriceJmd
```

Pending parts have no price/discount contribution. `fixed_total.amountJmd` is the full charge. `parking_projection.amountJmd` is included only when the caller explicitly accepts parking lines. Use checked safe-integer addition/multiplication and one canonical derived-field name, `finalLineJmd`.

- [x] **Step 4: Implement deterministic automatic allocation tests and code**

The allocation target means the participating labor/parts lines' desired total discount after application. Reject any pending, fixed-total, parking, unknown, or duplicate participant ID rather than silently ignoring it. Emit final unit prices on a JMD 50 grid and never exceed the target. First minimize `targetDiscountJmd - appliedDiscountJmd`; then, with applied discount `A` and participating gross `G`, minimize `Σ(lineDiscountJmd × G - A × grossLineJmd)²` using safe integers or BigInt; finally break equal scores by stable charge-line ID. If no valid grid result exists, return a non-applicable preview without mutating input. Return target, applied amount, unallocated difference, whole-order discount before/after, and proposed per-unit discounts.

- [x] **Step 5: Implement discount-threshold tests and code**

Calculate labor and priced-parts ratios independently from their category gross and discount totals. Return required when labor is strictly greater than 20% or parts strictly greater than 12.5%. Empty scribbles fail; any non-empty ordered stroke payload passes. Evidence records document kind/id, operation-account id/name, raw strokes, signed-at Jamaica instant, mutation ID, and category ratios; it never accepts an approver name/id from the request.

- [x] **Step 6: Adapt Invoice calculations and Quick BO totals without double discounts**

Invoice calculations consume shared line facts directly. Category-level discounts do not participate in the clean model; every discount is represented on its charge line and is counted exactly once.

- [x] **Step 7: Run focused verification and commit**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/quoted-charge-totals.spec.ts tests/unit/discount-approval.spec.ts tests/unit/invoice-calculations.spec.ts tests/unit/orders-calculations.spec.ts
npm run typecheck
npm run test:collaboration
```

Commit only Task 1 files with `feat(billing): unify quoted charge calculations`.

---

### Task 2: Current Linked Operations schema and clean Mock reset

**Files:**
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/mock-inspection-reports.ts`
- Modify: `src/lib/orders/quotation.ts`
- Create: `tests/unit/clean-demo-seed.spec.ts`
- Modify: `tests/unit/billing-api.spec.ts`
- Modify: `tests/unit/inspection-reports-api.spec.ts`

**Interfaces:**
- Produces one current schema envelope, deterministic clean seed, current validator, and existing storage lock.
- Adds mutable Quotation lines/notes/generation counter; report-level photo metadata; append-only generation, communication, response, signature, mutation-receipt, refund, and parking facts.
- Obsolete Mock business state is replaced by the clean seed. There is no migration, backfill, dual-write, legacy recovery, or old-record preservation contract.

- [x] **Step 1: Add clean current-state fixtures and verify RED**
- [x] **Step 2: Reset absent or obsolete project Mock state without touching session/preferences**
- [x] **Step 3: Keep current-state validation fail-closed and retire migration protection from normal reads/writes**
- [x] **Step 4: Keep photo bytes outside localStorage in the current IndexedDB repository**
- [x] **Step 5: Remove old compatibility-only tests as affected suites are revisited**
- [x] **Step 6: Run focused verification**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/clean-demo-seed.spec.ts tests/unit/billing-api.spec.ts tests/unit/inspection-reports-api.spec.ts tests/unit/orders-api.spec.ts
npm run typecheck
npm run test:collaboration
```

---

### Task 3: Mutable IR Quotation API, three charge groups, and one-time signatures

**Files:**
- Modify: `src/lib/api/mock-inspection-reports.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/orders/ir-nl-parse.ts`
- Modify: `src/components/orders/quotation-panel.tsx`
- Modify: `src/app/orders/inspections/[id]/page.tsx`
- Modify: `tests/unit/inspection-reports-api.spec.ts`
- Modify: `tests/e2e/inspection-reports.spec.ts`

**Interfaces:**
- Produces `updateQuotation({ reportId, expectedRevision, mutationId, lines, noteZh, noteEn, signature? })` over one continuously editable current Quotation.
- Produces separate Labor, Parts, and Other Charges editors; labor/parts rows expose editable bilingual name/note/unit/quantity/original price/manual per-unit discount, derived final unit price/subtotal, translation, delete, and BO checkbox. Other-fee rows expose bilingual name/note, fixed code, one `amountJmd`, delete, translation, and BO checkbox only.

- [x] **Step 1: Replace conflicting API tests and verify RED**

Delete assertions that protect immutable quotation versions, source-link deletion blocking, category-level discounts, or English-required BO creation. Add behavior tests for unlimited current edits, stable line IDs, fixed-total other fees, arbitrary manual discounts, threshold equality/no signature, threshold exceed/signature, failed write not consuming a signature, replay idempotency, and stale revision no partial write.

- [x] **Step 2: Implement the mutable Quotation store contract**

Preserve current line IDs on reorder/edit, allocate never-reused IDs for new rows, allow deletion, and save all lines/notes in one locked transaction. AI parsing supplies prices when present, leaves unconfirmed parts pending, and never invents facts or other fees.

- [x] **Step 3: Write E2E for three editors, inline translations, discounts, allocation, and signature**

Assert each labor/parts row has its translation below and a right-side translation button; fixed-total rows have no unit/quantity/discount/pending controls. Cover manual arbitrary discount, JMD-50 automatic allocation result and explicit remainder, both signature thresholds, and cancel/retry behavior.

- [x] **Step 4: Implement the Quotation editor and automatic-allocation sheet**

Use shared totals only. Wide rows scroll inside their own group; the 430px document root never overflows. The signature sheet uses the existing signature-pad primitive but stores the raw stroke sequence only after a successful mutation.

- [x] **Step 5: Run focused verification and commit**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/inspection-reports-api.spec.ts tests/unit/quoted-charge-totals.spec.ts tests/unit/discount-approval.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 pnpm exec playwright test tests/e2e/inspection-reports.spec.ts --grep "Quotation|优惠|签字|其他费用"
npm run typecheck
npm run test:collaboration
```

Commit Task 3 files with `feat(inspections): rebuild editable quotation charges`.

---

### Task 4: Direct IR-to-Quick-BO copy with independent approval

**Files:**
- Modify: `src/lib/api/mock-inspection-reports.ts`
- Modify: `src/lib/api/mock-quick-orders.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/orders/quick-order-types.ts`
- Modify: `src/components/orders/quotation-panel.tsx`
- Delete: `src/components/orders/ir-generate-business-order-dialog.tsx`
- Create: `tests/unit/ir-quick-bo-bridge.spec.ts`
- Modify: `tests/e2e/inspection-reports.spec.ts`
- Modify: `tests/e2e/orders.spec.ts`

**Interfaces:**
- Produces `createQuickOrderFromInspectionQuotation({ reportId, expectedRevision, quotationMutationId?, quickOrderMutationId, selectedLineIds, quotationSignature?, quickOrderSignature? })`.
- Copies current customer ID, vehicle ID, selected charge facts, and editable plain note `来自检查结果 {IR number}`. It writes no link and permits repeated BO creation from the same IR.

- [x] **Step 1: Write bridge RED tests**

Assert exact field copy for one labor, one pending part, and one fixed-total line; new BO/item IDs; blank legitimate `rawInput`; plain editable/deletable source note; later edits on either side do not propagate; no `SourceProjectLink`; missing English does not block; no selected rows rejects without a write; identical mutation retry creates one BO.

- [x] **Step 2: Add independent-signature and two-write boundary tests**

If an unsaved Quotation edit crosses a threshold, saving it consumes its own signature. The target BO then recomputes its own totals and requires a second fresh signature. A Quotation success followed by BO failure leaves the saved Quotation and selected UI state available for retry; no signature/mutation ID is reused across the two writes.

- [x] **Step 3: Implement the locked bridge and Quick BO contract**

Allow valid IR-origin BOs to keep `rawInput` empty. Copy shared line facts directly. Other fees remain fixed totals; pending parts remain pending. Clear row selection only after successful creation.

- [x] **Step 4: Replace the Dialog UI with row selection and one direct action**

The only permanent action is below totals. It reads QuotationPanel's current row state, not a stale saved version. There is no selection popup and no default selection. The returned BO link is an ephemeral success link and is not reconstructed as a relationship after reload.

- [x] **Step 5: Run focused verification and commit**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/ir-quick-bo-bridge.spec.ts tests/unit/inspection-reports-api.spec.ts tests/unit/quick-order-completion.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 pnpm exec playwright test tests/e2e/inspection-reports.spec.ts tests/e2e/orders.spec.ts --grep "创建业务单|检查结果"
npm run typecheck
npm run test:collaboration
```

Commit Task 4 files with `feat(inspections): copy selected quotation lines to business orders`.

---

### Task 5: Customer-file generation lifecycle and formal three-language PDF

**Files:**
- Modify: `src/lib/api/mock-inspection-reports.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/orders/ir-pdf.ts`
- Modify: `src/components/orders/ir-pdf-section.tsx`
- Modify: `tests/unit/ir-pdf.spec.ts`
- Modify: `tests/unit/inspection-reports-api.spec.ts`
- Modify: `tests/e2e/inspection-reports.spec.ts`

**Interfaces:**
- Produces one generation action that snapshots current saved Quotation input, atomically allocates the next V number and Jamaica generation time, renders zh/en/bilingual from the same input, and caches the successful outputs for preview/download/send until the next successful generation.
- Failure does not increment the counter or replace the last successful generation.

- [x] **Step 1: Write generation and PDF RED tests**

Generate V1, edit current Quotation, and prove the existing preview is stale but unchanged until V2 succeeds. For one generation, assert all languages carry the same V/time/totals. Assert the A4 file contains company header, customer, vehicle, Labor, Parts, optional Other Charges, per-item discounts, totals, overall note, parts-sourcing prompt, and empty customer signature/date; it excludes raw intake, AI text, internal statuses, photos, audit, and BO controls.

- [x] **Step 2: Implement atomic generation receipts and cache metadata**

Store generation counter, generated-at Jamaica instant, language availability, renderer version, and Blob attachment IDs. Do not create immutable business revisions or bind BO to a file version. Repeated mutation IDs return the first successful generation.

- [x] **Step 3: Rebuild the PDF layout from the approved Invoice visual hierarchy**

Use A4, separate Labor/Parts/Other Charges tables, aligned numeric columns, no decimal amounts, explicit pending-parts wording, totals by category, overall note, and signature/date on the final page. Preview, download, and notification attachment resolve the same generated Blob ID.

- [x] **Step 4: Run focused verification**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/ir-pdf.spec.ts tests/unit/inspection-reports-api.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 pnpm exec playwright test tests/e2e/inspection-reports.spec.ts --grep "正式文件|预览|PDF|V1|V2"
npm run typecheck
npm run test:collaboration
```

Commit Task 5 files with `feat(inspections): generate formal quotation files`.

---

### Task 6: Report-level photo Blob repository and vehicle-archive references

**Files:**
- Create: `src/lib/attachments/indexeddb-attachment-store.ts`
- Modify: `src/lib/api/mock-inspection-reports.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/components/orders/ir-photos-section.tsx`
- Modify: `src/components/customers/vehicle-detail-page.tsx`
- Create: `tests/unit/attachment-store.spec.ts`
- Modify: `tests/unit/inspection-reports-api.spec.ts`
- Modify: `tests/e2e/inspection-reports.spec.ts`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Produces stable attachment metadata in v8 canonical state and bytes in IndexedDB.
- Validates JPEG/PNG/WebP magic bytes, computes SHA-256, preflights quota, writes a multi-file batch atomically, and appends upload/delete audit facts.

- [x] **Step 1: Write repository and API RED tests**

Cover valid JPEG/PNG/WebP independent of extension/MIME, invalid signatures, duplicate-byte policy, ordered multi-upload, quota rejection, mid-batch failure rollback, stale revision, and delete audit. Assert localStorage JSON never contains `data:image`, Blob bytes, or the test file payload.

- [x] **Step 2: Implement the IndexedDB repository for the current clean Mock model**

Use one object store keyed by stable attachment ID. Metadata includes report ID, vehicle ID, original name, detected media type, byte length, SHA-256, created-at, and uploader account. The clean demo seed contains no legacy inline-photo migration path.

- [x] **Step 3: Implement independent report and vehicle-archive UI**

Photos are not attached to findings/quotation rows and never enter customer PDFs. The vehicle archive reads the same metadata/Blob IDs rather than copying bytes. Upload/remove stays local until one explicit save; failed saves preserve the unsaved selection for retry.

- [x] **Step 4: Run focused verification**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/attachment-store.spec.ts tests/unit/inspection-reports-api.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 pnpm exec playwright test tests/e2e/inspection-reports.spec.ts tests/e2e/customer-vehicle.spec.ts --grep "现场照片|车辆档案"
npm run typecheck
npm run test:collaboration
```

Commit Task 6 files with `feat(inspections): archive report photos as blobs`.

---

### Task 7: Three-state Chevron, customer notifications, replies, and list buckets

**Files:**
- Modify: `src/lib/orders/inspection-report.ts`
- Modify: `src/lib/api/mock-inspection-reports.ts`
- Modify: `src/lib/api/mock-ir-followup.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/components/orders/arrow-chain-status.tsx`
- Create: `src/components/orders/ir-notification-section.tsx`
- Create: `src/components/orders/ir-response-section.tsx`
- Modify: `src/components/orders/inspection-reports-workspace.tsx`
- Modify: `src/app/orders/inspections/[id]/page.tsx`
- Modify: `tests/unit/inspection-reports-api.spec.ts`
- Modify: `tests/e2e/inspection-reports.spec.ts`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Produces statuses `not_notified`, `awaiting_reply`, `closed`; notification channels `sms`, `whatsapp`, `email`; replies `interested`, `not_interested`.
- Produces append-only notification/reply events with accepted/failed results, immutable target/channel/time/actor/language, and stable mutation receipts.

- [x] **Step 1: Write notification/state RED tests**

Assert failed provider attempts do not change status or append success; first accepted SMS/Email or manually confirmed WhatsApp changes only `not_notified → awaiting_reply`; repeated notifications do not reopen/close; interested/not-interested reply changes to closed; changing the conclusion appends old→new history; editing/generating does not notify or reopen.

- [x] **Step 2: Implement mock channel adapters and canonical events**

SMS carries a non-localhost demo report URL and clearly identifies Mock mode. Email carries the selected generated PDF attachment. WhatsApp opens a link without a success event; a separate explicit confirmation records success. Photos are a separate attachment action and do not drive report status.

- [x] **Step 3: Replace the old five-stage UI with the three-segment Chevron**

Render exactly `尚未通知客户`, `已通知，等待回复`, `客户已回复，闭环`; set `aria-current="step"`; show the last successful channel/time beneath. Keep the approved first/middle/last chevron geometry and local overflow without root overflow.

- [x] **Step 4: Implement notification templates, history, response controls, and list buckets**

Template includes customer honorific/name, plate/model, current generated-file link/attachment behavior, 24-hour free parking warning, JMD 2,500/day overtime notice, and editable bilingual content. List filters are exactly: not notified, awaiting reply, closed, interested, not interested; rows show latest V/time, last notification, response, and updated time.

- [x] **Step 5: Add permission, session-switch, and 430px E2E coverage**

Finance is read-only; frontdesk admin/superadmin can mutate; mechanic uses a privacy-minimized intake DTO; parts cannot read generic IR. Anonymous/unauthorized/session-switch paths remove stale customer/vehicle/file/photo UI before returning an error.

- [x] **Step 6: Run focused verification**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/inspection-reports-api.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 pnpm exec playwright test tests/e2e/inspection-reports.spec.ts tests/e2e/customer-vehicle.spec.ts
npm run typecheck
npm run test:collaboration
```

Commit Task 7 files with `feat(inspections): close the customer response loop`.

---

### Task 8: Quick BO, Invoice, fixed-total refunds, and parking claims

Task 8 implementation after the completed 6A/6B slices continues under the binding independent-record plan at `docs/superpowers/plans/2026-08-22-independent-payment-refund-records.md`. That plan supersedes this task's original payment/refund consumer and persistence steps while preserving the approved Invoice snapshot, refund arithmetic, and parking-claim work already completed.

**Files:**
- Modify: `src/lib/api/mock-quick-orders.ts`
- Modify: `src/lib/api/mock-billing.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/mock-quick-parking.ts`
- Modify: `src/lib/billing/types.ts`
- Modify: `src/lib/billing/calculations.ts`
- Modify: `src/lib/parking/types.ts`
- Modify: `src/lib/parking/calculations.ts`
- Modify: `src/lib/orders/quick-invoice-pdf.ts`
- Modify: `src/components/orders/quick-order-inline-edit.tsx`
- Modify: `src/components/orders/quick-order-edit-dialog.tsx`
- Modify: `src/components/orders/quick-order-print.tsx`
- Modify: `src/components/orders/quick-invoice-pdf-section.tsx`
- Create: `tests/unit/quick-invoice-snapshot.spec.ts`
- Create: `tests/unit/parking-invoice-claim.spec.ts`
- Modify: `tests/unit/refund-rules.spec.ts`
- Modify: `tests/unit/parking-api.spec.ts`
- Modify: `tests/unit/invoice-calculations.spec.ts`
- Modify: `tests/e2e/orders.spec.ts`
- Modify: `tests/e2e/payments.spec.ts`
- Modify: `tests/e2e/parking.spec.ts`

**Interfaces:**
- Produces financially-effective Invoice versions with stable line lineage and full charge snapshots.
- Produces fixed-total one-time full-line refund, labor/parts quantity refund at stored final unit price, and atomic parking claims/corrections.

- [x] **Step 1: Write Invoice snapshot and independent-signature RED tests**

Creating/enabling an Invoice snapshots BO lines and recomputes its own thresholds. A high-discount Invoice requires a new signature even when BO or Quotation was signed. Signature failure or persistence failure leaves no half-version and consumes no evidence. All customer Invoice copies show Labor, Parts, Other Fees, and Parking separately with consistent totals.

- [x] **Step 2: Write refund RED tests**

Labor/parts refund uses `refundQuantity × invoiceLine.finalUnitPriceJmd`, cannot exceed stable-line quantity across versions, and separates receivable reduction from cash refund. Fixed-total can refund the full line once only; any prior occupancy/reduction or insufficient whole-Invoice credit rejects rather than silently using `min`.

- [x] **Step 3: Write parking-claim and correction RED tests**

First financially-effective Invoice atomically compare-and-set acquires `activeParkingClaim[parkingCaseId]`; a new version of the same logical Invoice transfers it; a competing Invoice fails. Clean demo parking claims are created through the same domain producer. Parking source changes never mutate old Invoice snapshots.

- [x] **Step 4: Implement Invoice source-of-truth and parking correction transaction**

The newly enabled Invoice version total is authoritative; parking delta is audit-only and never separately applied to receivable. When parking falls after payment, calculate `cashRefundJmd = max(0, netPaidBeforeJmd - receivableAfterCorrectionJmd)` capped by the correction and net paid, then atomically write parking revision, Invoice version, receivable change/audit, cash refund, and claim transfer. Delivery aggregation counts a parking case once and lists only uninvoiced parking separately.

- [x] **Step 5: Update Quick BO editors, Invoice prints, payment, and parking UI**

Labor/parts expose per-unit discounts; other fees expose fixed amount only; parking remains read-only. New category-level discounts cannot be written. Invoice preview/download/print consume the canonical financially-effective snapshot and share identical totals.

- [x] **Step 6: Run focused verification**

Run:

```bash
pnpm exec playwright test --config=playwright.unit.config.ts tests/unit/quick-invoice-snapshot.spec.ts tests/unit/parking-invoice-claim.spec.ts tests/unit/refund-rules.spec.ts tests/unit/parking-api.spec.ts tests/unit/invoice-calculations.spec.ts
E2E_BASE_URL=http://127.0.0.1:3210 pnpm exec playwright test tests/e2e/orders.spec.ts tests/e2e/payments.spec.ts tests/e2e/parking.spec.ts
npm run typecheck
npm run test:collaboration
```

Commit Task 8 files with `feat(billing): preserve charge facts through invoice and refund`.

---

### Task 9: Whole-goal review, full regression, and real browser acceptance

**Files:**
- Review and, only through a task-scoped failing test, modify the exact production paths listed under Tasks 1–8 and Tasks 2–7 of `docs/superpowers/plans/2026-08-22-independent-payment-refund-records.md`; Task 9 authorizes no additional production path
- Replace: `design-qa.md`
- Replace: `docs/screenshots/ir-chevron-stepper-20260820.png`
- Replace: `docs/screenshots/ir-chevron-stepper-430px-20260820.png`
- Remove if no longer evidence: `docs/screenshots/ir-chevron-stepper-comparison.png`
- Preserve as reference only: `docs/screenshots/reference-chevron-stepper.png`

- [x] **Step 1: Dispatch whole-branch specification and code review**

Review the full plan diff against the current clean-data specification. Explicitly audit mutation replay, failed persistence, stale sessions/epochs, financial double-counting, parking claim ownership, one-row-per-payment/refund behavior, receipt-number non-reuse, and customer-file leakage. Do not reopen old Mock migration or compatibility work.

- [x] **Step 2: Run mandatory complete verification**

Run from a fresh single dev-server instance on port 3210:

```bash
npm run typecheck
npm run test:collaboration
pnpm exec playwright test --config=playwright.unit.config.ts
E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 pnpm exec playwright test
```

No test is considered passing if it only asserts a mock element, source text, PDF dark-pixel count, or a page-ready endpoint. PDF correctness requires extracted text plus layout/geometry checks.

- [x] **Step 3: Perform desktop and 430px browser acceptance**

At 1470×874 and 430×932, exercise the real IR list/detail, three charge groups, arbitrary manual discount, auto allocation, both signature thresholds, row selection/direct BO creation, formal file V1/V2 generation, zh/en/bilingual preview/download, photo batch/upload failure, SMS/WhatsApp/Email result paths, reply conclusion/history, Quick BO edit/print, and the clean independent-money matrix below:

- clean provisional BO → formal Invoice V1 → Invoice V2 while V1 document remains available;
- two payments and two refunds remain four separate facts and four separate ledger rows, with amount, method, time, owner, and source shown independently;
- unit refund, whole fixed-total refund, zero-cash receivable reduction, and parking-owned correction refund each follow their own rules and never merge into an order-level history blob;
- BO, Payments, Quick Detail, Parking, Invoice print/PDF, and refund receipt read the same authoritative financial source for the selected order;
- formal refund receipts use distinct refund/receipt owners and show receivable reduction separately from cash returned;
- `finance` remains read/document-only while authorized front-desk users can perform the visible current actions;
- loaded identity switches and deterministic success/error/`finally` A→B→A races clear stale business and customer data before a new generation publishes.

Assert root `scrollWidth === clientWidth`, internally scrolling tables/forms, no framework overlay, no unexpected console/page errors, visible keyboard focus/return behavior, and correct fail-closed identity/epoch switches.

- [x] **Step 4: Replace QA evidence and prepare an unstaged handoff**

Write `design-qa.md` with commands, exact pass counts, every real URL, viewport sizes, observed state transitions, separate ledger IDs/amounts/methods/times, refund IDs/receipt owners, session-race checkpoints, screenshot paths, and PDF content/byte-identity evidence. Save current screenshots under `docs/screenshots`. Keep the handoff unstaged and uncommitted while the shared worktree contains inherited or parallel changes; commit only when explicitly authorized with a reviewed task-scoped file list.

- [x] **Step 5: Verify non-destructive handoff**

Confirm the full verification gates pass, the staged index remains empty, unrelated user changes are preserved, only current project screenshots are retained as QA evidence, and no temporary Blob/Base64/test artifact was introduced into project storage. Do not use broad cleanup commands in the shared dirty worktree.
