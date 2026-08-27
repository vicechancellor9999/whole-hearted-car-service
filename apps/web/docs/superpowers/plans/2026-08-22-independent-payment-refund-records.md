# Independent Payment and Refund Records — Completed Delivery Plan

**Goal:** Keep every payment and refund as its own durable fact and ledger row while BO charges, formal Invoice versions, parking claims, customer/office documents, and the Payments workspace read one authoritative financial model.

**Workspace:** `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main`

**Runtime:** `http://127.0.0.1:3210`

## Current data contract

- The application starts from a small deterministic Mock business dataset built for the current charge and Invoice contracts.
- Project demo reset replaces only the project business state and its IndexedDB sidecar data. Session, UI preferences, user files, source files, Git history, specifications, screenshots, and unrelated browser keys remain unchanged.
- The seed contains five named orders: provisional charges, a partially paid Invoice, a refund/V2 Invoice, a claimed parking Invoice, and an unclaimed parking case.
- Invoice, payment, refund, pickup, parking claim, and parking correction facts are created through the same domain producers used by the application.

## Delivered business loop

### 1. Charges and Invoice

- [x] Labor and parts use positive integer quantity, original unit price, per-unit discount, derived final unit price, and derived line total.
- [x] Pending-quote parts stay outside current monetary totals.
- [x] Other charges use independent `fixed_total` rows with one authoritative `amountJmd` and no discount fields.
- [x] Parking remains a `parking_projection` with stable case, source revision, as-of time, and amount coordinates.
- [x] Formal Invoice V1/V2 snapshots preserve immutable lines, adjustments, totals, effective-version identity, and parking claim ownership.

### 2. Independent payments and refunds

- [x] Quick-owned opaque actions record canonical Invoice payments and line refunds.
- [x] Each successful intent creates one independent payment or refund fact; raw Quick embedded arrays are not the financial authority.
- [x] Unit refunds use a positive integer quantity and the stored discounted unit price.
- [x] Fixed-total refunds are whole-line operations and cannot become arbitrary partial amounts.
- [x] `receivableReductionJmd` and `cashRefundJmd` remain separate values, including a zero-cash receivable reduction.
- [x] Stable line occupancy is enforced across Invoice versions so V2 cannot restore an already used refund allowance.
- [x] Parking corrections remain parking-owned and can create their own cash-refund fact when the corrected Invoice becomes overpaid.

### 3. Authoritative reads

- [x] Financial list/detail provide one authoritative order summary and source coordinate.
- [x] Statement reads preserve immutable charges and ordered payment/refund history for one owner.
- [x] The cross-order ledger exposes one row per payment/refund with ID, amount, method, committed time, owner, and provenance.
- [x] BO list/detail, Payments, Print, Invoice PDF, customer debt, pickup balance, and Parking use the appropriate authoritative financial projection.
- [x] Canonical Invoice facts remain detached from raw mutable BO data.

### 4. Consumer actions and documents

- [x] Payments shows five current BO summaries and eight independent money rows in the clean demonstration.
- [x] Quick Detail records a new payment or stable-line refund, refreshes the authoritative financial composite, and renders each result as another independent row.
- [x] Provisional orders expose no canonical money action.
- [x] Parking projections do not appear in the ordinary line-refund selector.
- [x] Customer and office Invoice views use the immutable statement source; the technician copy remains finance-free.
- [x] Canonical and legacy PDF previews are generated locally from a validated statement and owner-bound identity projection.
- [x] Shared-uninvoiced orders do not expose a formal Invoice PDF.

### 5. Roles, sessions, and consistency

- [x] `superadmin` and `frontdesk_admin` can perform the current business writes.
- [x] `finance` can read financial and document surfaces but does not receive BO-create, payment, refund, notification, or report-edit controls.
- [x] Protected reads and writes bind the invocation identity and response identity.
- [x] Composite consumers clear on `wh_session` and `popstate` changes and use monotonic generations for success, error, and `finally` publication.
- [x] Deterministic A→B→A tests prove stale customer, order, statement, financial, parking, loading, and error state cannot republish.
- [x] Closed validators reject cross-owner, duplicate, sparse, accessor, prototype, hidden, malformed, wrong-source, and contradictory monetary projections.

## Clean demonstration facts

- `demo-v2-partial-payment-1`: JMD 4,000 cash.
- `demo-v2-partial-payment-2`: JMD 3,500 card.
- `demo-v2-refunds-payment-1`: JMD 13,000 cash.
- `demo-v2-parking-claim-payment-1`: parking-owned card payment.
- `demo-v2-parking-invoice-balance-payment-1`: separate card payment for the remaining Invoice balance.
- `demo-v2-refunds-refund-1`: JMD 8,000 receivable reduction and JMD 0 cash returned.
- `demo-v2-refunds-refund-2`: JMD 5,000 receivable reduction and JMD 5,000 cash returned.
- `demo-v2-parking-correction-apply-1`: JMD 2,500 parking correction returned by card.

## Verification and visible acceptance

- [x] `pnpm typecheck` passed.
- [x] `pnpm test:collaboration` passed 11/11.
- [x] Final clean-model unit coverage passed 881/881; migration-only cases were removed. The last clean-seed/IR focused gate passed 79/79.
- [x] Final E2E coverage is 241/241 across the frozen tree: 184/184 non-IR cases from the full run plus the complete IR file at 57/57 after its retired-photo expectations were removed. The final affected IR gate passed 4/4.
- [x] Exact 1470×874 and 430×932 captures report no root horizontal overflow and no framework error portal.
- [x] BO, Payments, Parking, and Invoice/PDF pages remain available on port 3210.
- [x] `git diff --check`, untracked text-file whitespace checks, and the empty staged-index check passed.

Detailed runtime observations and screenshot paths are recorded in `design-qa.md`.

## Handoff boundary

The shared worktree remains unstaged and uncommitted. Existing unrelated changes are preserved. Any later commit must use a reviewed task-scoped file list.
