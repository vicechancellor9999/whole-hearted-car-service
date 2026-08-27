# WorkBuddy UI brief — Orders, Inspection Reports, billing and archives

Status: API boundary frozen after Task 3 focused API tests, complete unit suite,
and TypeScript checks passed. WorkBuddy consumes these APIs as read/write
boundaries; it must not create parallel demo entities or financial calculations.

## Routes and entity boundaries

### `/orders` — 调度总览

- Read only from `api.orders.operationsOverview()`.
- Render in this exact order: one first-inspection distribution capsule, one
  full-width four-team workload region, then process counts grouped by inspection,
  business, and financial/release flow.
- The capsule fields are
  `businessDate`, `firstInspectionDistribution.distinctOrdinaryVehicles`, `t1`,
  `t2`, and `difference`. Segment widths are derived from `t1 / total` and
  `t2 / total`; do not display a fairness verdict.
- Workload fields are `teamId`, `inspectionAwaiting`,
  `inspectionInProgress`, `repairAwaiting`, `repairInProgress`, `blocked`,
  `returnedAwaitingFrontdesk`, and `activeTotal`.
- Test IDs: `first-inspection-capsule`, `first-inspection-segment-t1`,
  `first-inspection-segment-t2`, `team-workload-panel`, `team-workload-t1` through
  `team-workload-t4`, and `process-counts`.

### `/orders/business` — 业务单 | Business Order

- The list reads only from `api.orders.list(query)`. Supported query fields are
  `scope: "business"`, `lifecycle`, `status`, `teamId`, `search`, `page`, and
  `pageSize`.
- List DTO fields are `id`, `orderNo`, `customer`, `vehicle`, `projectNames`,
  `laborItemCount`, `partItemCount`, `processingStatus`, `lifecycle`,
  `sourceInspection`, `teamId`, `teamName`, `mechanicNames`, `receivableJmd`,
  `netPaidJmd`, `balanceJmd`, `settlementStatus`, `createdAt`, `updatedAt`, and
  `updatedBy`.
- Details that include Invoice/parking/release facts read from
  `api.billing.businessOrder(orderId)`. Its DTO fields are `revision`,
  `businessOrder`, `invoice.version` (including `lines`, `adjustments`, `totals`,
  `issuedAt`, and `fileHash`), `payment`, `settlementStatus`, `release`, optional `parking`,
  `acknowledgements`, and `specialReleaseAuthorizations`.
- Billing overview reads `api.billing.workspace()`. Mutations use
  `api.orders.reassign(input)`, `api.billing.signCreditInvoice(input)`, and
  `api.billing.authorizeSpecialRelease(input)` exactly as typed. Always refresh
  after a successful mutation and surface stale-revision errors without optimistic
  partial state.
- Test IDs: `business-orders-workspace`, `business-orders-search`,
  `business-orders-filters`, `business-order-row`, `business-order-card`,
  `business-order-empty`, `business-order-detail`, `business-order-invoice`,
  `business-order-payment-status`, `business-order-settlement-arrangement`, and
  `business-order-release-status`.
- This route contains Business Order rows only. An Invoice is a section of the BO
  detail, not a top-level row or top-level navigation item.

### `/orders/inspections` — 检查结果 | Inspection Report

- List via `api.inspectionReports.list(query)` using `page`, `pageSize`, `search`,
  `status`, and `teamId`.
- List DTO fields are `id`, `reportNo`, `customer`, `vehicle`, `inspector`,
  `status`, `sourceVersion`, and `submittedAt`. There is no `orderNo` field.
- Detail via `api.inspectionReports.detail(reportId)`. DTO fields are `id`,
  `reportNo`, `revision`, `sourceVersion`, `customer`, `vehicle`, `inspector`,
  `status`, `submission`, `aiDraft`, `items`, `quotation`, and `communications`.
  Each `quotation.versions[].items[]` has its own ID and
  `sourceInspectionItemId`; quotation data must not be merged into the IR entity.
- Append communication events through
  `api.inspectionReports.recordCommunication(input)`. Preserve every event's
  `channel`, `target`, `delivery`, `response`, `followupDate`, and `note`; do not
  overwrite a single current channel.
- Test IDs: `inspection-reports-workspace`, `inspection-reports-search`,
  `inspection-reports-filters`, `inspection-report-row`, `inspection-report-card`,
  `inspection-report-empty`, `inspection-report-detail`,
  `inspection-internal-submission`, `inspection-ai-draft`,
  `inspection-frontdesk-review`, `inspection-approved-result`,
  `inspection-quotation`, `inspection-source-projects`,
  and `inspection-communications`.
- This route contains Inspection Report rows only. Quotation is versioned inside
  the IR detail and is not a top-level row or navigation item.

## Loading, failure and empty behavior

- Every route needs a stable loading skeleton that preserves the final section
  geometry; do not flash seeded rows before the API resolves.
- A read failure shows an inline retry state in the failed section. Retrying calls
  the same API path; never switch to local fallback data.
- Empty filters show the named `*-empty` state with a clear-filter action. Empty is
  not an error and must not restore the old mixed table.
- Mutation controls remain open on validation, stale revision, signature, preview
  expiry, or one-time write failure. Keep entered form content, show the API error,
  and refresh source DTOs when the error says the revision changed.

## Responsive geometry and accessibility

- At 1920px, the dispatch capsule remains one compact horizontal bar. The team
  workload is a separate full-width region immediately below it, never an equal
  sibling card. Business and IR lists use desktop tables inside their own
  horizontally scrollable containers.
- At 430px, preserve the same dispatch order vertically. The capsule may wrap its
  labels but retains its segmented proportion. Lists become entity-pure cards;
  the page root must not horizontally overflow.
- Support the existing light and dark themes without fixed white/black surfaces.
  Text and focus indicators must remain legible in both themes.
- Rows/cards and all primary actions are keyboard reachable. Dialogs trap focus,
  close with Escape, and restore focus to the invoking row/control. Do not remove
  visible focus outlines. Respect `prefers-reduced-motion`.

## Parking consumption and Task 10 formal-document boundary

- Parking screens consume `api.parking.list()`, `previewWaiver(input)`, and
  `applyWaiver(input)`. The list DTO fields are `caseId`, `businessOrderId`,
  `invoiceId`, `invoiceVersionId`, `vehicleId`, `notificationDate`, optional
  `pickupDate`, `dailyRateJmd`, `originalChargeableDays`, `originalAmountJmd`,
  `finalChargeableDays`, `finalAmountJmd`, `revision`, `waiverHistory`, and
  `waiverAudits`. Display original, existing, proposed, cumulative, and final
  days/amounts plus the administrator-signature requirement. Apply only the exact
  unexpired opaque preview token and source revision returned by the API.
- Parking net amount is already the one `other_service / parking_overtime` Invoice
  source line. Do not recalculate or append a second parking charge in UI code.
- Task 3 does not expose a formal PDF/archive file DTO or file operation API.
  Therefore this UI must not render or invent formal-file preview, download,
  print, or send controls/test IDs. Keep that area absent rather than simulating
  it locally. Task 10 will provide the formal file contract; connect those controls
  only after that API exists.

## Hard WorkBuddy scope boundary

- Do not reuse the 2026-08-09 mixed-document tabs or mixed-row layout.
- Do not create component-local `VISUAL_DOCUMENTS`, local API simulators, duplicate
  IR/Quotation/BO/Invoice/parking objects, or client-side financial truth.
- WorkBuddy may implement only the three routes and their entity-pure visual
  components described above.
- WorkBuddy must not modify `src/lib/**`, `tests/**`, shared sidebar/layout files,
  package files, or any performance page/component/visual. Navigation/layout and
  further domain/API changes remain Codex-owned integration work.
