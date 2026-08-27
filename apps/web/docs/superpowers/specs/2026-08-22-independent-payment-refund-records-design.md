# Independent Payment and Refund Records Design

Date: 2026-08-22
Status: binding implementation design, simplified after user ruling
Authority:

- `docs/superpowers/specs/2026-08-10-orders-documents-billing-archives-design.md`
- `docs/superpowers/specs/2026-08-20-inspection-report-redesign-design.md`
- User ruling on 2026-08-22: every payment and every refund is an independent record.
- User ruling on 2026-08-22: all existing business records are disposable Mock demonstration data. They may be reset and regenerated; preservation and migration compatibility are not requirements.

## 1. Outcome

Build one visible, coherent demonstration workflow:

1. A Business Order owns editable charge lines until a formal Invoice snapshot is issued.
2. A formal Invoice freezes the charge snapshot used for money, documents, and later refunds.
3. Every payment is one append-only record.
4. Every refund is one append-only record with separate receivable-reduction and cash-refund amounts.
5. Parking charges and parking corrections remain owned by a parking claim and join an Invoice only through an explicit projection.
6. Payments, Quick Detail, Print, and PDF consume the same authoritative money workspace.

A total, balance, receipt, audit entry, status marker, or performance hedge never replaces an individual payment or refund record. A retry of the same mutation returns the same record; a new intent creates a new record.

## 2. Deliberate reset boundary

The following may be deleted or regenerated:

- Mock Business Orders, Inspection Reports, Invoices, payments, refunds, parking claims, receipts, and related demo audits;
- seed and test fixture records;
- this project’s browser `localStorage` and IndexedDB demo records.

The following must never be deleted or broadly cleaned:

- source code, Git history, specifications, screenshots, user documents, or unrelated dirty work;
- any directory, browser profile, or storage outside this project’s exact demo keys.

There is no production-data migration in this slice. Remove requirements and code whose only purpose is:

- cutover/backfill from old Mock records;
- legacy dual-write or legacy-tail facts;
- migration checkpoints, recovery journals, number floors derived from old data, or historical repair;
- preserving old embedded payment/refund arrays;
- compatibility tests for old Mock payloads and receipts.

On first load after the new schema ships, an absent or obsolete Mock state is replaced by the clean new seed. No old fact is converted, inferred, or repaired.

## 3. Clean demonstration model

### 3.1 Business Order and charge source

A normal Quick Business Order has one of two money sources:

- `shared_uninvoiced`: editable provisional charge lines; no payment or refund actions;
- `canonical_invoice`: an immutable financially effective Invoice version.

`legacy_quick` is removed from the regenerated demo data and from new write paths. Old generic money routes return `410` without reading or writing business state.

Charge lines use exact closed branches:

- unit labor: positive integer quantity × stored final unit price;
- unit parts: positive integer quantity × stored final unit price;
- fixed-total other service: one whole line amount;
- parking projection: read-only amount bound to one parking claim revision.

Pending-quote lines never enter the financial total until resolved into a priced line.

### 3.2 Invoice snapshot

Issuing an Invoice creates an immutable version with:

- logical Invoice ID, Invoice number, version ID, and version number;
- customer/vehicle owner coordinates;
- immutable charge lines, discounts/adjustments, parking projections, totals, issue time, and commitment;
- the revision at which the version became financially effective.

Later BO edits do not change the effective Invoice. A reopened Invoice creates a new version; previous versions remain read-only document history inside the current clean state.

### 3.3 Payment record

Each payment is a closed append-only fact:

```ts
type InvoicePaymentRecord = Readonly<{
  contract: "invoice_payment_v1";
  id: string;
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  amountJmd: number;
  method: string;
  note: string | null;
  receivedAt: string;
  actorId: string;
  actorName: string;
  mutationId: string;
  committedRevision: number;
}>;
```

`amountJmd` is a positive safe integer not greater than the locked collectible balance. One fact produces exactly one ledger row.

### 3.4 Ordinary refund record

Each ordinary Invoice refund is a closed append-only fact bound to the financially effective stable charge line:

```ts
type InvoiceLineRefundRecord = Readonly<{
  contract: "invoice_line_refund_v1";
  id: string;
  receiptNo: string;
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  chargeLineId: string;
  lineSnapshot: ImmutableRefundLineSnapshot;
  refundQuantity: number | null;
  wholeLine: boolean;
  receivableReductionJmd: number;
  cashRefundJmd: number;
  method: string;
  reason: string;
  refundedAt: string;
  actorId: string;
  actorName: string;
  mutationId: string;
  committedRevision: number;
}>;
```

Rules:

- labor/parts unit lines accept only a positive integer quantity no greater than remaining occupancy;
- fixed-total lines accept only `wholeLine: true` once;
- parking projection lines cannot use the ordinary refund endpoint;
- `receivableReductionJmd` and `cashRefundJmd` are two non-interchangeable fields on the same refund fact;
- a refund may reduce receivable while returning zero cash;
- each successful refund receives its own unique formal receipt number.

An eligible cross-month labor refund may atomically create one separate linked performance hedge. The hedge does not replace or merge with the refund.

### 3.5 Parking claim and correction refund

A parking claim stores its notice date, daily rate, billable days, current charge, reductions, pickup state, and revision. Claiming it into an Invoice creates a read-only parking projection.

A parking correction transaction may create one independent parking refund fact only when cash is actually returned. It preserves the immutable before/after parking snapshot and its own formal receipt number. Ordinary Invoice refund UI must never select a parking projection.

### 3.6 Receipt and evidence

Each formal refund receipt is owner-bound to exactly one refund record. It contains a customer-safe immutable projection of:

- receipt number and refund ID;
- BO/Invoice or parking source coordinates;
- customer/vehicle snapshot;
- line or parking snapshot;
- receivable reduction and cash refund separately;
- method, reason, actor display name, and time.

Receipt PDF bytes are generated deterministically from the validated receipt source. Optional acknowledgement, photo, and delivery are separate append-only evidence facts. Public DTOs expose only safe metadata and authorized byte routes; they never expose raw strokes, private Blob IDs, hashes, actor IDs, mutation IDs, or internal receipts.

## 4. Authoritative reads

### 4.1 Cross-order ledger

The Payments workspace uses one closed cross-order ledger response. It returns:

- order summaries and current financial source;
- one row for every individual payment/refund, ordered by committed revision;
- recorded totals derived from rows;
- active receivable/balance totals derived from contributing order financial ledgers.

The UI may join raw BO data only for descriptive operational metadata. It may not calculate money from raw Quick items, embedded arrays, or lifecycle markers.

### 4.2 Owner money workspace

Quick Detail, Print, and PDF use one owner-bound money workspace captured at a single revision and source fence:

- current financial summary and gates;
- immutable effective statement charges and totals;
- ordered independent ledger rows;
- allowed payment/refund actions and per-line remaining refund occupancy;
- owner/customer/vehicle coordinates needed by documents.

Consumers never stitch financial history from several revisions.

## 5. Public actions

Opaque Quick financial routes own all BO money actions:

- collect canonical Invoice payment;
- refund one canonical Invoice line;
- read cross-order ledger;
- read owner money workspace;
- read formal refund receipt and authorized bytes;
- append optional acknowledgement/photo/delivery evidence.

Parking preview/apply/payment/refund remains under the parking owner route and returns owner-bound public results.

Every mutation input contains exact path/owner/source coordinates, expected revision, stable mutation ID, and its action-specific payload. Closed validators reject extra, hidden, accessor, sparse, prototype, malformed, cross-owner, stale-source, and wrong-branch values before business writes.

## 6. Roles and session safety

- `superadmin | frontdesk_admin`: business and evidence writes.
- `finance`: authoritative money/document reads and deterministic receipt/PDF materialization only.
- mechanic/parts/anonymous: only their existing operational surfaces; no financial detail or money writes.

Every protected async request captures exact identity plus monotonic session epoch before delay, rechecks before locked read/write, and rechecks before publishing the response. Every React composite additionally uses a generation token for success, error, finally, and unmount. A→B and A→B→A races must clear old BO, money, customer, vehicle, dialog, error, and loading state immediately and must never publish the old generation.

## 7. Clean seed requirements

The regenerated Mock seed must visibly contain, at minimum:

1. one editable `shared_uninvoiced` BO with labor, parts, fixed-total, and pending-quote lines;
2. one partially paid canonical Invoice with at least two independent payments;
3. one canonical Invoice with two independent ordinary refunds, including a zero-cash receivable reduction;
4. one reopened Invoice V2 proving immutable V1/V2 documents;
5. one parking claim not yet invoiced;
6. one parking claim projected into an Invoice;
7. one parking correction with an independent cash-refund record;
8. one formal refund receipt with no acknowledgement, one with acknowledgement, and one with acknowledgement plus photo metadata;
9. one eligible cross-month labor refund with its own separate hedge.

The seed is deterministic, internally valid, small enough to understand in the browser, and generated through the same domain producers used by the UI. Do not hand-write private receipts or audits.

## 8. Consumer ownership

- **Business Orders:** BO/status/descriptive charge overview; money columns from authoritative financial summaries.
- **Payments:** read-only cross-order ledger and filters; clicking navigates to owner detail.
- **Quick Detail:** the only BO payment/refund form owner; preserves form intent on `409`, reloads the owner money workspace, then retries with a new revision coordinate.
- **Parking:** claim, reduction, projection, payment, and parking correction owner.
- **Quick Print / Invoice PDF:** immutable statement charges plus the matching independent ledger at the same source fence.
- **Refund receipt page:** exactly one owner-bound receipt and its evidence; missing/unauthorized records fail closed.
- **Performance:** separate hedge facts only; never reconstructs refunds from totals.

## 9. Verification and completion

Required automated evidence:

- exact closed contracts and semantic branch mutants;
- independent-record/idempotency/CAS/write-fault/response-loss tests;
- payment/refund/parking arithmetic and line-occupancy tests;
- role matrix and before-read/before-write/session-epoch zero-write tests;
- Payments/Detail/Print/PDF source-authority and A→B→A generation tests;
- deterministic clean-seed reset test proving obsolete Mock state is replaced, not migrated;
- old money/create/edit routes return `410` with zero business reads/writes;
- full unit, collaboration, and E2E regressions.

Required real browser evidence on port 3210:

- desktop 1470×874 and mobile 430×932;
- BO provisional → Invoice → two payments → two refunds as five distinct ledger rows;
- Parking claim → Invoice projection → parking correction refund;
- Invoice/PDF and refund receipt content match the same authoritative workspace;
- finance sees money/document reads but no business/evidence actions;
- loaded A→B→A races do not leak prior identity data.

The slice is complete only when the clean seed produces the visible business loop above and no remaining code or test is needed solely to preserve obsolete Mock business data.
