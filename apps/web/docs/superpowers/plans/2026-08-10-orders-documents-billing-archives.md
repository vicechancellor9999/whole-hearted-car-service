# Orders, Documents, Billing, and Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the operations area so dispatch, Business Orders, Inspection Reports, customer and vehicle archives, Invoice settlement, parking fees, formal PDFs, and Chinese/English UI work as separate but linked domains.

**Architecture:** Keep one canonical mock store with typed references between customers, vehicles, Inspection Reports, Quotations, Business Orders, Invoices, parking cases, and signatures. Existing `api.orders.*` remains the Business Order and dispatch API; new feature APIs expose Inspection Reports, archives, billing, parking, and formal-document payloads. UI routes consume typed DTOs only and never merge heterogeneous records into one table.

**Tech Stack:** Next.js 14.2.5, React 18.3.1, TypeScript 5.5.4, Tailwind CSS 3.4.7, Playwright 1.54, `@react-pdf/renderer` for real in-app PDF rendering.

## Global Constraints

- Work only in `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发`; verify the external volume is mounted and writable before every new worktree or generated asset.
- The approved source of truth is `docs/superpowers/specs/2026-08-10-orders-documents-billing-archives-design.md`.
- Preserve the existing blue-gray visual system, dark mode, 22px radii, restrained shadows, reduced motion, one `main`, and one page `h1`.
- `Business Order`, `Inspection Report`, `Quotation`, and `Invoice` are separate typed entities; never return them through one list-item union for rendering in one table.
- Invoice is rendered inside Business Order detail and is not a navigation item.
- Quotation is rendered inside Inspection Report detail and in customer/vehicle archives; it is not a navigation item.
- Charge categories are exactly `labor`, `parts`, and `other_service`; `parking_overtime`, `towing`, and `offsite_service` are `other_service` codes.
- Payment status and settlement arrangement are separate axes; release status is a third independent fact.
- `项目实施率` is completed source projects divided by valid proposed projects; aggregate by summed project counts, never average vehicle percentages.
- `特殊协商` release preserves the unpaid Invoice and creates an immutable authorization record.
- Parking: notification day `D`, one grace day at `D+1`, `D+2` 开始计费, pickup day excluded, JMD 2,500 per calendar day.
- Parking waiver authority uses the same case's cumulative actual waived amount: `<= JMD 50,000` front desk; `> JMD 50,000` onsite administrator signature.
- Every formal document version produces 中文、English、`中英对照` PDF renderings from one canonical approved payload.
- System interface `语言` switching is Chinese/English per employee and is stored independently from formal-document language.
- Customer-facing Inspection Report PDFs exclude mechanic raw text, mechanic identity/signature, AI drafts, internal notes, and review audit.
- WorkBuddy owns visual component implementation only after Codex freezes DTOs and RED E2E contracts. WorkBuddy must not edit domain types, mock stores, API routing, or tests.
- Only the integration owner edits shared files `src/lib/api/client.ts`, `src/components/layout/sidebar.tsx`, `src/app/layout.tsx`, `package.json`, and `package-lock.json`.
- Do not commit `test-results/`, `.next/`, QA screenshots, browser caches, or temporary PDF blobs.
- Use the system Chrome executable and an isolated port for every E2E pass; do not reuse the user's port 3002 during test runs.

## Delivery Tracks and Order

1. **Canonical domain and API track:** Tasks 1–3. Blocks all visual work.
2. **Orders and Inspection UI track:** Tasks 4–5. WorkBuddy can run after Task 3.
3. **Archives, billing, and parking track:** Tasks 6–9. Customer UI integration and financial workflows.
4. **Documents and language track:** Tasks 10–11. Formal PDF preview and UI locale.
5. **Integration gate:** Task 12.

## File Structure

### Canonical domain

- Create `src/lib/orders/business-order-types.ts`: execution, charge lines, source links, and independent financial/release summaries.
- Create `src/lib/orders/inspection-report.ts`: Inspection Report content states, approved versions, communication events, and list DTOs.
- Create `src/lib/orders/quotation.ts`: Quotation records and immutable versions.
- Create `src/lib/orders/implementation-metrics.ts`: per-report and aggregate project metrics.
- Create `src/lib/billing/types.ts`: Invoice, credit acknowledgement, special release, and archive references.
- Create `src/lib/billing/calculations.ts`: charge totals, payment status, balance, and amount-conservation validation.
- Create `src/lib/parking/types.ts`: parking case, notice, accrual, waiver, and authority DTOs.
- Create `src/lib/parking/calculations.ts`: Jamaica calendar-day accrual and waiver validation.
- Create `src/lib/archives/types.ts`: customer and vehicle archive responses.
- Create `src/lib/customers/credit-facility.ts`: customer-level credit grant/revoke/reopen invariants.
- Extend `src/lib/orders/document-number.ts`: distinct Business Order, Inspection Report, Quotation, and Invoice numbers.

### Mock API

- Create `src/lib/api/mock-inspection-reports.ts`.
- Create `src/lib/api/mock-billing.ts`.
- Create `src/lib/api/mock-parking.ts`.
- Reuse and extend `src/lib/api/mock-customers.ts` from `feat/customer-vehicle-management`.
- Modify `src/lib/api/client.ts` once, after the new stores expose stable functions.

### Routes and UI

- Change `src/app/orders/page.tsx` to dispatch overview.
- Create `src/app/orders/business/page.tsx`.
- Create `src/app/orders/inspections/page.tsx`.
- Create `src/components/orders/operations-overview-workspace.tsx`.
- Create `src/components/orders/business-orders-workspace.tsx` and `business-orders-table.tsx`.
- Create `src/components/orders/inspection-reports-workspace.tsx`, `inspection-reports-table.tsx`, `inspection-report-detail.tsx`, `quotation-panel.tsx`, and `implementation-rate-panel.tsx`.
- Integrate `src/components/customers/*` from the customer branch, then split customer and vehicle workspaces.
- Create `src/components/billing/payment-handover-workspace.tsx` and `business-order-invoice-panel.tsx`.
- Create `src/components/parking/parking-workspace.tsx` and `parking-waiver-dialog.tsx`.
- Create `src/components/documents/formal-document.tsx` and `pdf-preview-dialog.tsx`.
- Create `src/components/i18n/language-provider.tsx` and `src/lib/i18n/messages.ts`.

---

### Task 1: Freeze Route and Entity-Separation Contracts

**Files:**
- Create: `tests/e2e/orders-navigation.spec.ts`
- Modify: `tests/e2e/orders.spec.ts`
- Modify: `tests/e2e/orders-operations.spec.ts`
- Modify: `tests/e2e/page-headers.spec.ts`

**Interfaces:**
- Consumes: current `/orders?tab=...` page and existing session helper.
- Produces: RED browser contracts for `/orders`, `/orders/business`, and `/orders/inspections`.

- [ ] **Step 1: Add the route separation RED test**

```ts
test("dispatch, Business Orders, and Inspection Reports are separate pages", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByRole("heading", { level: 1, name: "调度总览" })).toBeVisible();
  await expect(page.getByTestId("first-inspection-capsule")).toBeVisible();
  await expect(page.getByTestId("business-orders-table")).toHaveCount(0);
  await expect(page.getByTestId("inspection-reports-table")).toHaveCount(0);

  await page.goto("/orders/business");
  await expect(page.getByRole("heading", { level: 1, name: "业务单" })).toBeVisible();
  await expect(page.getByTestId("business-order-row")).toHaveCount(10);
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(0);

  await page.goto("/orders/inspections");
  await expect(page.getByRole("heading", { level: 1, name: "检查结果" })).toBeVisible();
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(9);
  await expect(page.getByTestId("business-order-row")).toHaveCount(0);
});
```

- [ ] **Step 2: Add the dispatch geometry RED test**

```ts
const capsule = await page.getByTestId("first-inspection-capsule").boundingBox();
const workload = await page.getByTestId("team-workload-panel").boundingBox();
expect(capsule).not.toBeNull();
expect(workload).not.toBeNull();
expect(capsule!.height).toBeLessThan(120);
expect(workload!.y).toBeGreaterThan(capsule!.y + capsule!.height);
expect(Math.abs(workload!.width - capsule!.width)).toBeLessThanOrEqual(2);
await expect(page.getByText(/公平|不公平|基本均衡/)).toHaveCount(0);
```

- [ ] **Step 3: Run RED E2E**

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/orders-navigation.spec.ts`

Expected: FAIL because the new routes and test IDs do not exist.

- [ ] **Step 4: Commit the RED contract**

```bash
git add tests/e2e/orders-navigation.spec.ts tests/e2e/orders.spec.ts tests/e2e/orders-operations.spec.ts tests/e2e/page-headers.spec.ts
git commit -m "test: define separated orders routes"
```

### Task 2: Create Canonical Document, Invoice, Parking, and Metric Types

**Files:**
- Create: `src/lib/orders/business-order-types.ts`
- Create: `src/lib/orders/inspection-report.ts`
- Create: `src/lib/orders/quotation.ts`
- Create: `src/lib/orders/implementation-metrics.ts`
- Create: `src/lib/billing/types.ts`
- Create: `src/lib/billing/calculations.ts`
- Create: `src/lib/parking/types.ts`
- Create: `src/lib/parking/calculations.ts`
- Modify: `src/lib/orders/document-number.ts`
- Test: `tests/unit/orders-document-number.spec.ts`
- Create test: `tests/unit/orders-implementation-metrics.spec.ts`
- Create test: `tests/unit/invoice-calculations.spec.ts`
- Create test: `tests/unit/parking-calculations.spec.ts`

**Interfaces:**
- Consumes: `OrderTeamId`, existing immutable inspection submission, Jamaica business date utilities.
- Produces: the canonical types and pure functions used by every later task.

- [ ] **Step 1: Write failing type/calculation tests**

```ts
test("uses three charge categories and keeps invoice totals exact", () => {
  const result = calculateInvoiceTotals({
    lines: [
      { id: "L1", category: "labor", code: "repair", quantity: 1, unitPriceJmd: 10_000 },
      { id: "P1", category: "parts", code: "part", quantity: 2, unitPriceJmd: 5_000 },
      { id: "O1", category: "other_service", code: "towing", quantity: 1, unitPriceJmd: 7_500 },
    ],
    adjustments: [{ id: "A1", kind: "discount", amountJmd: -2_500 }],
    paidJmd: 5_000,
  });
  expect(result.totalJmd).toBe(25_000);
  expect(result.balanceJmd).toBe(20_000);
  expect(result.paymentStatus).toBe("partially_paid");
});

test("rejects charge codes assigned to the wrong category", () => {
  expect(() => validateChargeLine({ ...inspectionLine, category: "other_service" })).toThrow(/inspection.*labor/i);
  expect(() => validateChargeLine({ ...parkingLine, category: "labor" })).toThrow(/parking_overtime.*other_service/i);
});

test("8/10 notice and 8/13 pickup charges one day", () => {
  expect(calculateParkingAccrual({
    notificationDate: "2026-08-10",
    pickupDate: "2026-08-13",
    dailyRateJmd: 2_500,
  })).toEqual({ chargeableDays: 1, originalAmountJmd: 2_500 });
});

test("aggregates implementation rate by project count, not average percentages", () => {
  const aggregate = aggregateImplementationMetrics([
    { proposed: 1, accepted: 1, converted: 1, completed: 1 },
    { proposed: 9, accepted: 0, converted: 0, completed: 0 },
  ]);
  expect(aggregate.implementationRate).toBe(0.1);
});
```

- [ ] **Step 2: Run the pure-function tests and confirm RED**

Run: `npm run test:unit -- tests/unit/orders-implementation-metrics.spec.ts tests/unit/invoice-calculations.spec.ts tests/unit/parking-calculations.spec.ts`

Expected: FAIL because modules and exports are missing.

- [ ] **Step 3: Implement the exact canonical interfaces**

```ts
export type ChargeCategory = "labor" | "parts" | "other_service";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid";
export type SettlementArrangement = "normal" | "credit" | "special_agreement";
export type ReleaseStatus = "not_authorized" | "authorized" | "released";

export interface ChargeLine {
  readonly id: string;
  readonly category: ChargeCategory;
  readonly code: "inspection" | "diagnosis" | "maintenance" | "repair" | "part" | "parking_overtime" | "towing" | "offsite_service" | "other";
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  readonly quantity: number;
  readonly unitPriceJmd: number;
  readonly sourceId?: string;
}

export interface CustomerCreditFacility {
  readonly customerId: string;
  readonly status: "not_enabled" | "active" | "revoked";
  readonly currentGrantId?: string;
  readonly activatedAt?: string;
  readonly revokedAt?: string;
}

export interface ParkingWaiverPreview {
  readonly caseId: string;
  readonly originalAmountJmd: number;
  readonly existingWaivedAmountJmd: number;
  readonly proposedWaivedAmountJmd: number;
  readonly cumulativeWaivedAmountJmd: number;
  readonly requiresAdministratorSignature: boolean;
  readonly finalAmountJmd: number;
}

export interface SourceProjectLink {
  readonly inspectionReportId: string;
  readonly inspectionItemId: string;
  readonly quotationId: string;
  readonly quotationVersionId: string;
  readonly quotationItemId: string;
  readonly businessOrderId: string;
  readonly businessOrderItemId: string;
  readonly inspectorTeamId: OrderTeamId;
  readonly executionTeamId: OrderTeamId;
  readonly executionStatus: "planned" | "in_progress" | "completed" | "cancelled";
}
```

- [ ] **Step 4: Implement pure calculations and numbering**

Add `formatQuotationNo()` and `formatInvoiceNo()` beside the existing Business Order and Inspection Report formatters. Implement `calculateInvoiceTotals()`, `calculateParkingAccrual()`, `validateParkingWaiver()`, `calculateImplementationMetric()`, and `aggregateImplementationMetrics()` without reading browser state.

- [ ] **Step 5: Run focused GREEN and typecheck**

Run: `npm run test:unit -- tests/unit/orders-document-number.spec.ts tests/unit/orders-implementation-metrics.spec.ts tests/unit/invoice-calculations.spec.ts tests/unit/parking-calculations.spec.ts`

Run: `npm run typecheck`

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit canonical domain**

```bash
git add src/lib/orders src/lib/billing src/lib/parking tests/unit/orders-document-number.spec.ts tests/unit/orders-implementation-metrics.spec.ts tests/unit/invoice-calculations.spec.ts tests/unit/parking-calculations.spec.ts
git commit -m "feat: separate orders document and billing domains"
```

### Task 3: Build Single-Source Mock Stores and APIs

**Files:**
- Create: `src/lib/api/mock-inspection-reports.ts`
- Create: `src/lib/api/mock-billing.ts`
- Create: `src/lib/api/mock-parking.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/client.ts`
- Modify test: `tests/unit/orders-api.spec.ts`
- Create test: `tests/unit/inspection-reports-api.spec.ts`
- Create test: `tests/unit/billing-api.spec.ts`
- Create test: `tests/unit/parking-api.spec.ts`
- Create: `docs/workbuddy/2026-08-10-orders-archives-ui-brief.md`

**Interfaces:**
- Consumes: Task 2 canonical types.
- Produces: `api.orders`, `api.inspectionReports`, `api.billing`, and `api.parking` DTOs.

- [ ] **Step 1: Write API RED tests for entity isolation and source identity**

```ts
const business = await api.orders.list({ lifecycle: "all", page: 1, pageSize: 50 });
expect(business.items.every((item) => item.orderNo.startsWith("KGN-WH-20"))).toBe(true);

const inspections = await api.inspectionReports.list({ page: 1, pageSize: 50 });
expect(inspections.items.every((item) => item.reportNo.includes("-IR-"))).toBe(true);
expect(inspections.items.some((item) => "orderNo" in item)).toBe(false);

const report = await api.inspectionReports.detail(inspections.items[0].id);
expect(report.quotation.inspectionReportId).toBe(report.id);
expect(report.quotation.versions[0].items[0].sourceInspectionItemId).toBeTruthy();
```

- [ ] **Step 2: Write parking authority and billing RED tests**

```ts
const small = await api.parking.previewWaiver({ caseId: "PARK-001", waiveDays: 1, reason: "客户关系维护" });
expect(small.waivedAmountJmd).toBe(2_500);
expect(small.requiresAdministratorSignature).toBe(false);

const large = await api.parking.previewWaiver({ caseId: "PARK-002", waiveDays: 21, reason: "管理决定" });
expect(large.waivedAmountJmd).toBe(52_500);
expect(large.requiresAdministratorSignature).toBe(true);
```

- [ ] **Step 3: Run API tests and confirm RED**

Run: `npm run test:unit -- tests/unit/orders-api.spec.ts tests/unit/inspection-reports-api.spec.ts tests/unit/billing-api.spec.ts tests/unit/parking-api.spec.ts`

Expected: FAIL on missing API namespaces.

- [ ] **Step 4: Implement mock stores with shared IDs**

The stores must reference canonical customer, vehicle, report, quotation, Business Order, Invoice, and parking IDs. Archive consumers receive references from these stores; no component-local `VISUAL_DOCUMENTS` data remains.

Expose exactly:

```ts
api.inspectionReports.list(query)
api.inspectionReports.detail(reportId)
api.inspectionReports.recordCommunication(input)
api.orders.list(query)
api.orders.operationsOverview()
api.orders.reassign(input)
api.billing.workspace()
api.billing.businessOrder(orderId)
api.billing.signCreditInvoice(input)
api.billing.authorizeSpecialRelease(input)
api.parking.list()
api.parking.previewWaiver(input)
api.parking.applyWaiver(input)
```

- [ ] **Step 5: Run focused GREEN, all unit tests, and typecheck**

Run: `npm run test:unit -- tests/unit/orders-api.spec.ts tests/unit/inspection-reports-api.spec.ts tests/unit/billing-api.spec.ts tests/unit/parking-api.spec.ts`

Run: `npm run test:unit`

Run: `npm run typecheck`

- [ ] **Step 6: Freeze and hand off the WorkBuddy UI boundary**

Only after the focused API tests, full unit suite, and typecheck are GREEN,
create `docs/workbuddy/2026-08-10-orders-archives-ui-brief.md`. It must name the
three routes, DTO fields and test IDs, desktop/430px behavior, loading/error
states, and the rule that WorkBuddy consumes the canonical APIs only. WorkBuddy
must not reuse the 2026-08-09 mixed-document layout, component-local demo data,
or edit `src/lib`, tests, shared layout, package files, or performance visuals.

- [ ] **Step 7: Commit API boundary**

```bash
git add src/lib/api src/lib/orders tests/unit docs/workbuddy/2026-08-10-orders-archives-ui-brief.md
git commit -m "feat: add linked operations mock APIs"
```

### Task 4: Split Navigation and Build Dispatch Overview

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/orders/page.tsx`
- Create: `src/app/orders/business/page.tsx`
- Create: `src/app/orders/inspections/page.tsx`
- Create: `src/components/orders/operations-overview-workspace.tsx`
- Modify: `src/components/orders/first-inspection-balance.tsx`
- Modify: `src/components/orders/operations-judgment.tsx`
- Modify: `src/components/orders/process-counts.tsx`
- Test: `tests/e2e/orders-navigation.spec.ts`
- Test: `tests/e2e/orders-operations.spec.ts`

**Interfaces:**
- Consumes: `api.orders.operationsOverview()` and Task 1 RED contracts.
- Produces: canonical routing and dispatch overview; unblocks WorkBuddy page work.

- [ ] **Step 1: Consume the frozen WorkBuddy UI boundary**

WorkBuddy may begin visual implementation only after Task 3 is complete and
`docs/workbuddy/2026-08-10-orders-archives-ui-brief.md` exists. Keep its scope to
the three orders routes and their entity-pure visual components; do not change
performance visuals or restore the 2026-08-09 mixed-document design.

- [ ] **Step 2: Replace the mixed tab navigation**

The `工单管理` disclosure contains exactly:

```ts
[
  { label: "调度总览", href: "/orders" },
  { label: "业务单｜Business Order", href: "/orders/business" },
  { label: "检查结果｜Inspection Report", href: "/orders/inspections" },
]
```

Add a second disclosure containing `客户档案` and `车辆档案`. Keep `收付款与交车` and `停车费` as separate top-level items in that order.

Legacy `/orders?tab=business` redirects to `/orders/business`; `tab=inspection` redirects to `/orders/inspections`; other legacy tabs redirect to `/orders`.

- [ ] **Step 3: Implement one segmented first-inspection capsule**

Use `t1Count / total` and `t2Count / total` for segment widths; show exact values, total, and difference. Remove all `公平`, `不公平`, and `基本均衡` verdicts.

- [ ] **Step 4: Stack full-width workload below the capsule**

Render the four-team workload panel below the capsule. Process-count links route inspection stages to `/orders/inspections`, work stages to `/orders/business`, and financial stages to `/payments`.

- [ ] **Step 5: Run route and geometry GREEN tests**

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/orders-navigation.spec.ts tests/e2e/orders-operations.spec.ts`

- [ ] **Step 6: Commit dispatch UI**

```bash
git add docs/workbuddy src/app/orders src/components/orders src/components/layout/sidebar.tsx tests/e2e/orders-navigation.spec.ts tests/e2e/orders-operations.spec.ts
git commit -m "feat: split orders navigation and dispatch overview"
```

### Task 5: Build Separate Business Order and Inspection Report Workspaces

**Files:**
- Create: `src/components/orders/business-orders-workspace.tsx`
- Create: `src/components/orders/business-orders-table.tsx`
- Create: `src/components/orders/business-order-detail.tsx`
- Create: `src/components/orders/inspection-reports-workspace.tsx`
- Create: `src/components/orders/inspection-reports-table.tsx`
- Create: `src/components/orders/inspection-report-detail.tsx`
- Create: `src/components/orders/quotation-panel.tsx`
- Create: `src/components/orders/implementation-rate-panel.tsx`
- Delete after replacement: `src/components/orders/document-tabs.tsx`
- Delete after replacement: component-local mixed records from `src/components/orders/visual-data.ts`
- Modify test: `tests/e2e/orders.spec.ts`
- Create test: `tests/e2e/inspection-reports.spec.ts`

**Interfaces:**
- Consumes: Task 3 API DTOs, existing reassignment API, and existing dialog focus behavior.
- Produces: two entity-pure searchable workspaces.

- [ ] **Step 1: Extend E2E RED tests for pure lists**

```ts
await page.goto("/orders/business");
await expect(page.getByTestId("business-order-row")).toHaveCount(10);
await expect(page.getByText(/KGN-WH-IR-/)).toHaveCount(0);

await page.goto("/orders/inspections");
await expect(page.getByTestId("inspection-report-row")).toHaveCount(9);
await expect(page.getByTestId("business-order-row")).toHaveCount(0);
```

- [ ] **Step 2: Implement Business Order workspace**

Reuse search, filters, desktop table, 430px cards, keyboard row activation, contact isolation, and reassignment dialog. Move completion history to a Business Order lifecycle filter instead of an entity tab.

When accepted Inspection Report items create a Business Order, default its repair team to the report's signed inspector team. Keep the original inspector team immutable; a reassignment before formal handover changes only the current repair team and creates an audit event.

- [ ] **Step 3: Implement Inspection Report workspace**

The detail dialog sections are: internal submission, AI draft, front-desk review, approved result, Quotation versions, source-project implementation links, customer communication, and formal files. Do not render mechanic raw text in the customer-file section.

- [ ] **Step 4: Prove Quotation version isolation**

The UI must show the report approved version separately from Quotation `V1`, `V2`, and `V3`. Switching a Quotation version must not change approved report findings.

- [ ] **Step 5: Run focused browser tests**

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/orders.spec.ts tests/e2e/inspection-reports.spec.ts`

- [ ] **Step 6: Commit the two workspaces**

```bash
git add src/components/orders tests/e2e/orders.spec.ts tests/e2e/inspection-reports.spec.ts
git commit -m "feat: separate business orders and inspection reports"
```

### Task 6: Integrate and Split Customer and Vehicle Archives

**Files:**
- Integrate: `src/lib/customers/types.ts`
- Integrate: `src/lib/customers/selectors.ts`
- Integrate: `src/lib/api/mock-customers.ts`
- Integrate: `src/components/customers/*`
- Create: `src/lib/archives/types.ts`
- Create: `src/lib/customers/archive-selectors.ts`
- Create: `src/components/customers/customer-archive-workspace.tsx`
- Create: `src/components/customers/vehicle-archive-workspace.tsx`
- Create: `src/components/customers/archive-document-list.tsx`
- Modify: `src/app/customers/page.tsx`
- Modify: `src/app/vehicles/page.tsx`
- Test: `tests/unit/customers-store.spec.ts`
- Create test: `tests/unit/archive-selectors.spec.ts`
- Test: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Consumes: canonical document IDs from Tasks 2–3 and stable customer code from `feat/customer-vehicle-management@eb0a5ab`.
- Produces: independent customer and vehicle archive routes sharing document references.

- [ ] **Step 1: Selectively integrate the stable customer branch**

Integrate customer domain, mock store, components, and tests from `feat/customer-vehicle-management`; do not merge that branch wholesale. Preserve the current `src/lib/api/client.ts`, PageHeader implementation, orders routes, and sidebar, then manually add the customer API routes.

- [ ] **Step 2: Write archive identity RED tests**

```ts
const customerArchive = buildCustomerArchive(state, "CUST-001");
const vehicleArchive = buildVehicleArchive(state, "VEH-001");
const customerInvoice = customerArchive.documents.find((item) => item.kind === "invoice");
const vehicleInvoice = vehicleArchive.documents.find((item) => item.kind === "invoice");
expect(customerInvoice?.id).toBe(vehicleInvoice?.id);
expect("receivable" in vehicleArchive).toBe(false);
expect(customerArchive.receivable.customerId).toBe("CUST-001");
```

- [ ] **Step 3: Implement archive responses**

```ts
export type ArchiveDocumentRef =
  | InspectionReportRef
  | QuotationRef
  | BusinessOrderRef
  | InvoiceRef;

interface ArchiveDocumentBase {
  id: string;
  customerId: string;
  vehicleId: string;
  documentNo: string;
  href: string;
}

interface InspectionReportRef extends ArchiveDocumentBase { kind: "inspection_report"; status: InspectionReportStatus }
interface QuotationRef extends ArchiveDocumentBase { kind: "quotation"; version: string; decisionStatus: "pending" | "accepted" | "rejected" | "deferred" }
interface BusinessOrderRef extends ArchiveDocumentBase { kind: "business_order"; executionStatus: BusinessOrderExecutionStatus }
interface InvoiceRef extends ArchiveDocumentBase {
  kind: "invoice";
  businessOrderId: string;
  version: string;
  paymentStatus: PaymentStatus;
  settlementArrangement: SettlementArrangement;
  totalJmd: number;
  paidJmd: number;
  balanceJmd: number;
}

export interface CustomerArchiveResponse {
  customer: CustomerRecord;
  vehicles: VehicleSummary[];
  documents: ArchiveDocumentRef[];
  receivable: CustomerReceivableSummary;
  creditFacility: CustomerCreditFacility;
  communications: CommunicationRecord[];
}

export interface VehicleArchiveResponse {
  vehicle: VehicleRecord;
  relationships: VehicleCustomerRelationship[];
  documents: ArchiveDocumentRef[];
  serviceItems: ServiceItemRef[];
  photos: PhotoRef[];
  parkingCases: ParkingCaseRef[];
}
```

- [ ] **Step 4: Split routes instead of using a view query**

`/customers?customer=CUST-001` opens a customer archive. `/vehicles?vehicle=VEH-001` opens a vehicle archive. Canonicalize old `/customers?view=vehicles` URLs to `/vehicles`. Render only one dialog for conflicting entity parameters.

- [ ] **Step 5: Run customer unit and E2E tests**

Run: `npm run test:unit -- tests/unit/customers-store.spec.ts tests/unit/archive-selectors.spec.ts tests/unit/customers-api.spec.ts`

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/customer-vehicle.spec.ts`

- [ ] **Step 6: Commit archive integration**

```bash
git add src/app/customers src/app/vehicles src/components/customers src/lib/customers src/lib/archives src/lib/api/mock-customers.ts tests/unit tests/e2e/customer-vehicle.spec.ts
git commit -m "feat: add separate customer and vehicle archives"
```

### Task 7: Add Customer Credit Facility and Per-Invoice Acknowledgement

**Files:**
- Create: `src/lib/customers/credit-facility.ts`
- Create: `src/components/customers/credit-facility-panel.tsx`
- Create: `src/components/customers/signature-capture-dialog.tsx`
- Create: `src/components/billing/invoice-credit-sign-dialog.tsx`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `src/lib/api/mock-billing.ts`
- Modify: `src/lib/api/client.ts`
- Create test: `tests/unit/credit-facility.spec.ts`
- Modify test: `tests/unit/customers-api.spec.ts`
- Modify test: `tests/unit/billing-api.spec.ts`
- Modify test: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Consumes: customer archive and Invoice types.
- Produces: active/revoked credit facility and immutable per-Invoice customer acknowledgements.

Role contract: superadmin and front desk can edit customer master data, capture onsite administrator signatures, revoke future credit, and capture customer Invoice acknowledgements; finance can read archives, receivables, facilities, and acknowledgements but cannot mutate them. Ordinary parts and mechanic identities cannot read full customer financial archives. Viewing permitted records never requires a signature.

- [ ] **Step 1: Write credit lifecycle RED tests**

```ts
const first = activateCreditFacility(state, {
  customerId: "CUST-001",
  administratorId: "ADM-001",
  administratorSignature: "data:image/png;base64,signature-one",
  submittedBy: "FRONT-001",
  termsVersion: "CREDIT-2026-01",
});
const revoked = revokeCreditFacility(first.state, { customerId: "CUST-001", actorId: "FRONT-001", reason: "客户要求停止" });
expect(revoked.facility.status).toBe("revoked");
expect(revoked.state.receivables).toEqual(first.state.receivables);
expect(() => activateCreditFacility(revoked.state, { ...input, administratorSignature: "" })).toThrow(/管理员签名/);

const restoreFinance = installBrowser(finance);
try {
  await expect(api.customers.activateCreditFacility("CUST-001", validInput)).rejects.toMatchObject({ status: 403 });
} finally {
  restoreFinance();
}
const restoreParts = installBrowser(parts);
try {
  await expect(api.customers.archive("CUST-001")).rejects.toMatchObject({ status: 403 });
} finally {
  restoreParts();
}
```

- [ ] **Step 2: Implement customer-level facility states**

Use exactly `not_enabled`, `active`, and `revoked`; do not add `pending_approval`. Every activation creates a new immutable grant. Revocation affects future credit use only.

Expose exactly:

```ts
api.customers.archive(customerId)
api.vehicles.archive(vehicleId)
api.customers.activateCreditFacility(customerId, input)
api.customers.revokeCreditFacility(customerId, input)
api.billing.signCreditInvoice(invoiceId, input)
```

- [ ] **Step 3: Implement per-Invoice customer signing**

Bind the customer signature to Invoice ID, Invoice version, unpaid amount, language edition, signing time, customer ID, and front-desk operator. An administrator credit signature never substitutes for this acknowledgement.

- [ ] **Step 4: Implement onsite signature UI**

The front desk opens the signature canvas and hands the device to the administrator. Submitting does not create an asynchronous administrator task. Preserve focus trap, Escape, background inertness, and return focus.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test:unit -- tests/unit/credit-facility.spec.ts tests/unit/customers-api.spec.ts tests/unit/billing-api.spec.ts`

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/customer-vehicle.spec.ts`

```bash
git add src/lib/customers src/lib/api src/components/customers src/components/billing tests/unit tests/e2e/customer-vehicle.spec.ts
git commit -m "feat: add customer credit facility and invoice signing"
```

### Task 8: Build Invoice, Payment, Handover, and Special Release

**Files:**
- Create: `src/components/billing/business-order-invoice-panel.tsx`
- Create: `src/components/billing/payment-handover-workspace.tsx`
- Create: `src/components/billing/special-release-dialog.tsx`
- Modify: `src/app/payments/page.tsx`
- Modify: `src/components/orders/business-order-detail.tsx`
- Create test: `tests/e2e/payment-handover.spec.ts`
- Test: `tests/unit/invoice-calculations.spec.ts`
- Test: `tests/unit/billing-api.spec.ts`

**Interfaces:**
- Consumes: Invoice and credit APIs.
- Produces: Business Order-contained Invoice and independent payment/release facts.

- [ ] **Step 1: Write state-axis RED tests**

```ts
expect(detail.executionStatus).toBe("completed");
expect(detail.invoice.paymentStatus).toBe("partially_paid");
expect(detail.invoice.settlementArrangement).toBe("credit");
expect(detail.releaseStatus).toBe("released");
expect(detail.invoice.balanceJmd).toBeGreaterThan(0);
```

- [ ] **Step 2: Render Invoice inside Business Order detail**

Show charge lines grouped by labor, parts, and other services; show adjustments separately. Display payment status and settlement arrangement as two badges so `未付清 · 挂账` remains expressible.

- [ ] **Step 3: Build payment and handover queue**

Before formal handover, aggregate all current-visit Business Orders, Invoices, parking fees, and other charges for the vehicle. A paid, valid credit, or authorized special-agreement path may release the vehicle.

- [ ] **Step 4: Implement special agreement audit**

Record balance, reason, expected payment date, front-desk actor, onsite administrator authorization, customer acknowledgement, and timestamp. Releasing the vehicle must not change Invoice payment status.

- [ ] **Step 5: Run billing E2E and commit**

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/payment-handover.spec.ts`

```bash
git add src/app/payments src/components/billing src/components/orders/business-order-detail.tsx tests/e2e/payment-handover.spec.ts
git commit -m "feat: add invoice settlement and handover workflow"
```

### Task 9: Build Parking Accrual and Waiver Management

**Files:**
- Modify: `src/app/parking/page.tsx`
- Create: `src/components/parking/parking-workspace.tsx`
- Create: `src/components/parking/parking-waiver-dialog.tsx`
- Modify: `src/lib/api/mock-parking.ts`
- Modify: `src/lib/api/client.ts`
- Test: `tests/unit/parking-calculations.spec.ts`
- Test: `tests/unit/parking-api.spec.ts`
- Create test: `tests/e2e/parking.spec.ts`

**Interfaces:**
- Consumes: Task 2 parking calculations and Task 3 API.
- Produces: independently managed parking cases and net Invoice source lines.

- [ ] **Step 1: Add exact calendar and waiver E2E RED tests**

```ts
await expect(page.getByTestId("parking-notice-date")).toHaveText("2026-08-10");
await expect(page.getByTestId("parking-grace-date")).toHaveText("2026-08-11");
await expect(page.getByTestId("parking-billing-start")).toHaveText("2026-08-12");
await expect(page.getByTestId("parking-original-amount")).toHaveText("JMD 2,500");
```

- [ ] **Step 2: Implement parking list and detail**

Show original days and amount, waiver days and amount, reason, actor, authorization, final days and amount, and linked Invoice source line.

- [ ] **Step 3: Implement waiver authority without split evasion**

Validate the same parking case's cumulative waived amount after the proposed change. Front desk submits directly at or below JMD 50,000; above JMD 50,000 opens the onsite administrator signature flow. A JMD 60,000 original charge with a JMD 2,500 waiver does not require administrator signature.

- [ ] **Step 4: Prove Invoice reads net result without recalculating days**

The generated `other_service / parking_overtime` line references the parking case and its final net amount. Billing code must not repeat parking date arithmetic.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- tests/unit/parking-calculations.spec.ts tests/unit/parking-api.spec.ts`

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/parking.spec.ts`

```bash
git add src/app/parking src/components/parking src/lib/api/mock-parking.ts src/lib/api/client.ts tests/unit/parking-calculations.spec.ts tests/unit/parking-api.spec.ts tests/e2e/parking.spec.ts
git commit -m "feat: add parking accrual and waiver workflow"
```

### Task 10: Generate and Preview Real Trilingual PDFs

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `public/fonts/NotoSansSC-Regular.ttf`
- Create: `public/fonts/NotoSansSC-Bold.ttf`
- Create: `public/fonts/OFL.txt`
- Create: `src/lib/documents/types.ts`
- Create: `src/lib/documents/customer-payload.ts`
- Create: `src/components/documents/formal-document.tsx`
- Create: `src/components/documents/pdf-preview-dialog.tsx`
- Modify: `src/components/orders/inspection-report-detail.tsx`
- Modify: `src/components/orders/business-order-detail.tsx`
- Modify: `src/components/customers/customer-archive-workspace.tsx`
- Modify: `src/components/customers/vehicle-archive-workspace.tsx`
- Modify: `src/components/billing/payment-handover-workspace.tsx`
- Modify: `src/components/parking/parking-workspace.tsx`
- Create test: `tests/unit/formal-document-payload.spec.ts`
- Create test: `tests/e2e/formal-documents.spec.ts`

**Interfaces:**
- Consumes: approved report, Quotation, Business Order, Invoice, signature, release, and parking payloads.
- Produces: one canonical payload and `zh`, `en`, `bilingual` PDF renderings.

- [ ] **Step 1: Install the PDF renderer and licensed fonts**

Run: `npm install @react-pdf/renderer`

Add the open-licensed Noto Sans SC regular and bold font files plus their license. Register local fonts; do not load customer PDFs from a network font URL.

- [ ] **Step 2: Write customer-payload leakage RED tests**

```ts
const payload = buildCustomerInspectionPayload(internalReport, "bilingual");
expect(JSON.stringify(payload)).not.toContain(internalReport.submission.naturalLanguageResult);
expect(JSON.stringify(payload)).not.toContain(internalReport.submission.inspectorName);
expect(JSON.stringify(payload)).not.toContain(internalReport.aiDraft.internalNotes);
expect(payload.quotation.id).toBe(internalReport.quotation.id);
```

- [ ] **Step 3: Define formal document descriptors**

```ts
export type FormalDocumentLanguage = "zh" | "en" | "bilingual";

export interface FormalDocumentDescriptor {
  readonly documentId: string;
  readonly documentNo: string;
  readonly version: string;
  readonly language: FormalDocumentLanguage;
  readonly generatedAt: string;
  readonly kind: "inspection_report" | "quotation" | "business_order" | "invoice" | "credit_acknowledgement" | "special_release" | "parking_waiver";
}
```

- [ ] **Step 4: Render the final PDF in-app before download**

Use `PDFViewer` or `BlobProvider` from `@react-pdf/renderer`. Load the viewer through a client-only dynamic import with server-side rendering disabled. The dialog exposes language tabs, page viewer, zoom controls, download, print, and send. All actions use the same descriptor and generated blob; opening a document never triggers an automatic download. Sending an Inspection Report records the exact descriptor, language, version, and delivery channel through `api.inspectionReports.recordCommunication()`.

Render and preview all seven declared document kinds. The Business Order, Invoice, credit acknowledgement, special release, and parking waiver previews use the same language/version contract as Inspection Report and Quotation.

- [ ] **Step 5: Run payload and browser tests**

Run: `npm run test:unit -- tests/unit/formal-document-payload.spec.ts`

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/formal-documents.spec.ts`

Expected: the preview exposes an `application/pdf` blob URL, all three language tabs work, and customer PDFs expose no internal-only text.

- [ ] **Step 6: Commit PDF preview**

```bash
git add package.json package-lock.json public/fonts src/lib/documents src/components/documents tests/unit/formal-document-payload.spec.ts tests/e2e/formal-documents.spec.ts
git commit -m "feat: add trilingual formal PDF preview"
```

### Task 11: Add Hidden Chinese and English Interface Switching

**Files:**
- Create: `src/lib/i18n/messages.ts`
- Create: `src/components/i18n/language-provider.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/layout/identity-switcher.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/dashboard/*`
- Modify: `src/components/revenue/*`
- Modify: `src/components/performance/*`
- Modify: `src/components/ui/page-placeholder.tsx`
- Modify: new orders, archives, billing, parking, and document components.
- Create test: `tests/e2e/language.spec.ts`

**Interfaces:**
- Consumes: stable UI copy keys.
- Produces: per-employee `zh` or `en` locale without changing formal-document language.

- [ ] **Step 1: Write locale persistence RED test**

```ts
await page.getByTestId("identity-menu-trigger").click();
await page.getByRole("menuitem", { name: "English" }).click();
await expect(page.getByRole("link", { name: "Operations Overview" })).toBeVisible();
await page.reload();
await expect(page.getByRole("link", { name: "Operations Overview" })).toBeVisible();
await expect(page.getByRole("tab", { name: "中文 PDF" })).toBeVisible();
```

- [ ] **Step 2: Implement typed messages**

```ts
export const messages = {
  zh: { navOverview: "经营概览", navOrders: "工单管理", ordersDispatch: "调度总览" },
  en: { navOverview: "Operations Overview", navOrders: "Work Order Management", ordersDispatch: "Dispatch Overview" },
} as const;
```

Store locale per employee ID in local storage. Put the switch inside the existing identity/avatar menu; do not add a permanent sidebar control.

- [ ] **Step 3: Translate the complete currently reachable interface**

Replace inline visible copy in the shell, dashboard, revenue, performance, placeholders, orders, archives, billing, parking, and document components with typed message keys. Formal-document language buttons remain available regardless of UI locale. Add E2E assertions that dashboard, revenue, performance, orders, customers, vehicles, payments, and parking each change visible headings and controls after locale switching.

- [ ] **Step 4: Run language E2E and commit**

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/language.spec.ts`

```bash
git add src/lib/i18n src/components/i18n src/app/layout.tsx src/components/layout src/components/dashboard src/components/revenue src/components/performance src/components/ui/page-placeholder.tsx src/components/orders src/components/customers src/components/billing src/components/parking src/components/documents tests/e2e/language.spec.ts
git commit -m "feat: add per-employee interface language"
```

### Task 12: Integration, Review, and Visual Acceptance

**Files:**
- Modify only files required by review findings.
- Evidence: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/orders-documents-billing-archives-final/`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one clean, review-approved implementation commit chain.

- [ ] **Step 1: Run the complete automated gate**

Run: `npm run typecheck`

Run: `npm run test:unit`

Run: `npm run test:collaboration`

Run: `E2E_BASE_URL=http://127.0.0.1:3020 E2E_REUSE_SERVER=0 npm run test:e2e`

Run: `npm run build`

Run: `git diff --check`

Expected: zero failures, zero type errors, and a successful production build.

- [ ] **Step 2: Request independent code review**

Review domain invariants, permission boundaries, stale-source protection, one-source archive references, PDF data leakage, dialog focus, URL canonicalization, and 430px overflow. Fix every P0–P2 finding, then rerun the affected focused tests and the complete gate.

- [ ] **Step 3: Perform production visual QA**

Use system Chrome against a production server on port 3020. Capture 1920×1000 and 430×932 in light and dark modes for dispatch, Business Orders, Inspection Reports, customer archive, vehicle archive, payment/handover, parking, and PDF preview.

For every page assert:

- console errors = 0;
- page errors = 0;
- Next overlay = 0;
- root horizontal overflow = 0;
- one `main` and one page `h1`;
- keyboard access and focus restoration work;
- PDF preview opens without download;
- UI language switching persists.

- [ ] **Step 4: Verify the shared integration server**

Stop stale extra Next processes, rebuild the integration worktree, restart only port 3002, and verify the user's exact routes open successfully. Do not declare completion based only on port 3020.

- [ ] **Step 5: Final clean-state check**

Run: `git status --short --branch`

Expected: only intentionally retained untracked user artifacts; no generated test or QA output in the worktree.
