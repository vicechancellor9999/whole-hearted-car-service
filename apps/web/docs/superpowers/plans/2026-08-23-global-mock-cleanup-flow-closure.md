# Whole Hearted Global Mock Cleanup and Flow Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one clean, editable Mock business flow from customer and vehicle creation through BO charges, independent payment/refund records, signed refund receipt, Invoice/PDF, pickup, parking, and live dashboard totals.

**Architecture:** Keep the existing Mock-only linked operations store as the sole financial source and reset obsolete demo state by schema anchor instead of migrating it. Remove inherited hand-seed identities and teams, make customer/vehicle and employee/team dictionaries owner-created, and have every visible consumer read the same customer, vehicle, BO, money, parking, and dashboard facts. Replace wide fixed tables with responsive record rows on desktop and labeled cards on narrow screens.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Tailwind CSS, Playwright unit/E2E tests, browser localStorage/IndexedDB Mock stores.

**Spec:** `docs/superpowers/specs/2026-08-23-global-mock-cleanup-flow-closure-design.md`

## Global Constraints

- Only Mock business records, seed/fixture data, and this project's browser demo storage may be reset.
- Source code, Git history, specs, screenshots, user files, QA evidence, and unrelated dirty changes must be preserved.
- Initial identity is only `超级管理员`; no employee or team may appear before the owner creates it.
- Every payment and every refund is an independent permanent record; totals are derived displays.
- A positive cash refund is not tied to a charge item and does not mutate charge lines or discounts.
- Every visible editable record needs a real create and edit entry.
- No core business page or core record container may require horizontal scrolling at desktop or 430px.
- Work directly on `main` as required by repository `AGENTS.md`; stage only task-owned files.

---

### Task 1: Clean Mock Root, Owner Identity, and Empty Team Dictionary

**Files:**
- Modify: `src/lib/orders/quick-order-seed.ts`
- Modify: `src/lib/orders/types.ts`
- Modify: `src/lib/teams/team-dictionary.ts`
- Modify: `src/lib/api/mock-data.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/mock-clean-demo.ts`
- Test: `tests/unit/clean-demo-seed.spec.ts`
- Test: `tests/unit/team-dictionary.spec.ts`

**Interfaces:**
- Consumes: `createMockLinkedOperationsStore(storage)`, `seedQuickOrders()`, `mockIdentities()`, `loadTeams()`.
- Produces: a schema-anchored clean store with one `superadmin`, no teams, and BO seeds that never copy `teamId`, mechanic, status history, customer, or vehicle from `handSeedSpecs()`.

- [ ] **Step 1: Write the failing seed and team tests**

```ts
test("clean BO owners never inherit a hand-seed team or mechanic", () => {
  const orders = seedQuickOrders();
  expect(orders.every((order) => order.teamId === null)).toBe(true);
  expect(orders.every((order) => order.mechanicName === null)).toBe(true);
});

test("empty team dictionary has no invented workshop groups", () => {
  expect(BUILTIN_TEAMS).toEqual([]);
  expect(loadTeams()).toEqual([]);
  expect(teamNameOf("t1")).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run: `npm run test:unit -- tests/unit/clean-demo-seed.spec.ts tests/unit/team-dictionary.spec.ts`

Expected: FAIL because clean orders still copy `base.teamId` and the existing team test still expects four invented teams.

- [ ] **Step 3: Build every clean order directly from an explicit owner fact**

```ts
const owner = {
  customerId: spec.customerId,
  vehicleId: spec.vehicleId,
  teamId: null,
  mechanicName: null,
  assignedAt: null,
  acceptedAt: null,
  returnedAt: null,
  submittedAt: null,
};
```

Remove `ownerTemplate` and all `base.*` spreading from `seedQuickOrders()`. Define `OrderTeamId` as `string` so owner-created dictionary IDs are valid without hardcoded `ORDER_TEAMS`.

- [ ] **Step 4: Bump the clean protection anchor and reset only obsolete project business state**

Use the explicit anchor `clean-demo-state-v5:` in `mock-orders.ts`. Keep `wh_session` and unrelated keys untouched, and remove materialized fake payment/refund histories from startup.

- [ ] **Step 5: Run the focused tests and typecheck**

Run: `npm run test:unit -- tests/unit/clean-demo-seed.spec.ts tests/unit/team-dictionary.spec.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit only Task 1 files**

```bash
git add src/lib/orders/quick-order-seed.ts src/lib/orders/types.ts src/lib/teams/team-dictionary.ts src/lib/api/mock-data.ts src/lib/api/mock-orders.ts src/lib/api/mock-clean-demo.ts tests/unit/clean-demo-seed.spec.ts tests/unit/team-dictionary.spec.ts
git commit -m "fix: reset mock business data without invented teams"
```

### Task 2: Honest Navigation and Owner-Created Employee/Team Entrances

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/mobile-nav.tsx`
- Modify: `src/app/employees/page.tsx`
- Modify: `src/components/dashboard/team-performance.tsx`
- Test: `tests/e2e/orders-navigation.spec.ts`
- Test: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: `/employees`, `loadTeams()`, existing employee directory actions.
- Produces: one employee management route with visible `新增员工` and `新增班组` actions; no placeholder links in desktop or mobile navigation.

- [ ] **Step 1: Add a navigation and empty-state behavior test**

```ts
test("navigation exposes only operable modules and empty team state links to creation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "配件报价大厅" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Jamaica 本地采购" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "International 国际采购" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "客户联系与通知" })).toHaveCount(0);
  await page.getByRole("link", { name: "员工管理" }).click();
  await expect(page.getByRole("button", { name: "新增员工" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增班组" })).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify it fails on placeholder links or missing actions**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/orders-navigation.spec.ts tests/e2e/dashboard.spec.ts`

- [ ] **Step 3: Remove unfinished navigation items and wire empty dashboard CTA buttons to `/employees`**

Keep only `/`, `/workbench`, `/orders/business`, `/orders/inspections`, `/employees`, `/performance`, `/payments`, `/parking`, `/customers`, `/vehicles`, and `/settings` in both navigation components.

- [ ] **Step 4: Run the navigation/dashboard tests and typecheck**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/orders-navigation.spec.ts tests/e2e/dashboard.spec.ts && npm run typecheck`

- [ ] **Step 5: Commit only Task 2 files**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/mobile-nav.tsx src/app/employees/page.tsx src/components/dashboard/team-performance.tsx tests/e2e/orders-navigation.spec.ts tests/e2e/dashboard.spec.ts
git commit -m "fix: expose only operable management entrances"
```

### Task 3: Customer and Vehicle Create/Edit Flow

**Files:**
- Modify: `src/components/customers/customer-onboarding-dialog.tsx`
- Modify: `src/components/customers/customer-onboarding-state.ts`
- Modify: `src/components/customers/customer-workspace.tsx`
- Modify: `src/components/customers/vehicle-detail-page.tsx`
- Modify: `src/components/customers/form-dialogs.tsx`
- Test: `tests/e2e/customer-onboarding.spec.ts`
- Test: `tests/e2e/customer-vehicle.spec.ts`
- Test: `tests/unit/customer-onboarding-state.spec.ts`

**Interfaces:**
- Consumes: `api.customers.onboarding.*`, `currentSessionKey()`, customer and vehicle revision APIs.
- Produces: a stable staged dialog that can check a phone, explicitly skip allowed OTP/license gates, save a customer, add a vehicle, and reopen both edit forms.

- [ ] **Step 1: Add a single happy-path E2E from empty storage**

```ts
test("super administrator creates and edits one customer and vehicle from empty storage", async ({ page }) => {
  await page.goto("/customers");
  await page.getByRole("button", { name: "新增客户" }).click();
  await page.getByLabel("手机号码").fill("+1 876 555 0101");
  await page.getByRole("button", { name: "检查号码" }).click();
  await page.getByRole("button", { name: "跳过 OTP" }).click();
  await page.getByRole("button", { name: "手动录入" }).click();
  await page.getByLabel("客户姓名").fill("流程验收客户");
  await page.getByRole("button", { name: "保存客户" }).click();
  await page.getByRole("button", { name: "新增车辆" }).click();
  await page.getByLabel("车牌").fill("FLOW 101");
  await page.getByLabel("品牌").fill("Toyota");
  await page.getByLabel("车型").fill("Hiace");
  await page.getByRole("button", { name: "保存车辆" }).click();
  await expect(page.getByText("FLOW 101")).toBeVisible();
  await page.getByRole("button", { name: "编辑客户" }).click();
  await page.getByLabel("邮箱").fill("flow@example.test");
  await page.getByRole("button", { name: "保存修改" }).click();
});
```

- [ ] **Step 2: Run the test and capture the first real failing gate**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts --max-failures=1`

- [ ] **Step 3: Fix session binding and make only business-allowed skip actions explicit**

Keep `boundSession` stable for one open dialog; invalidate attempts only on a real identity change. Dispatch reducer events for `OTP_SKIPPED` and `LICENSE_MANUAL` so the profile step becomes reachable without faking verification evidence.

- [ ] **Step 4: Re-run the happy path and customer unit tests**

Run: `npm run test:unit -- tests/unit/customer-onboarding-state.spec.ts tests/unit/customer-onboarding.spec.ts && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts`

- [ ] **Step 5: Commit only Task 3 files**

```bash
git add src/components/customers/customer-onboarding-dialog.tsx src/components/customers/customer-onboarding-state.ts src/components/customers/customer-workspace.tsx src/components/customers/vehicle-detail-page.tsx src/components/customers/form-dialogs.tsx tests/e2e/customer-onboarding.spec.ts tests/e2e/customer-vehicle.spec.ts tests/unit/customer-onboarding-state.spec.ts
git commit -m "fix: complete customer and vehicle entry flow"
```

### Task 4: Inspection Result, Quotation, and BO Bridge

**Files:**
- Modify: `src/components/orders/ir-create-dialog.tsx`
- Modify: `src/components/orders/quotation-panel.tsx`
- Modify: `src/components/orders/inspection-detail-modal.tsx`
- Modify: `src/lib/orders/inspection-report.ts`
- Modify: `src/lib/orders/quotation.ts`
- Test: `tests/e2e/inspection-reports.spec.ts`
- Test: `tests/unit/ir-quick-bo-bridge.spec.ts`

**Interfaces:**
- Consumes: the customer/vehicle facts from Task 3 and the existing inspection report and quotation producers.
- Produces: visible create/edit actions for inspection facts and quotation lines, plus a BO creation action that carries the same customer and vehicle IDs.

- [ ] **Step 1: Add a create/edit/bridge behavior test**

```ts
test("inspection result and quotation can be created edited and converted to one BO", async ({ page }) => {
  await page.goto("/orders/inspections");
  await page.getByRole("button", { name: "新建检查结果" }).click();
  await page.getByLabel("车辆").selectOption({ label: /FLOW 101/ });
  await page.getByLabel("检查事实").fill("右前刹车片磨损");
  await page.getByRole("button", { name: "保存检查结果" }).click();
  await page.getByRole("button", { name: "创建 Quotation" }).click();
  await page.getByLabel("项目名称").fill("右前刹车片更换");
  await page.getByLabel("报价金额").fill("12000");
  await page.getByRole("button", { name: "保存 Quotation" }).click();
  await page.getByRole("button", { name: "修改 Quotation" }).click();
  await page.getByLabel("报价金额").fill("11000");
  await page.getByRole("button", { name: "保存 Quotation" }).click();
  await page.getByRole("button", { name: "创建业务单" }).click();
  await expect(page).toHaveURL(/\/orders\/business\//);
  await expect(page.getByText("FLOW 101")).toBeVisible();
});
```

- [ ] **Step 2: Run the bridge behavior and verify the first missing or broken entry**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/inspection-reports.spec.ts --grep "created edited and converted"`

- [ ] **Step 3: Wire the existing domain producers to visible create/edit actions**

Keep inspection facts separate from Quotation state. BO creation copies only customer ID, vehicle ID, and the accepted quotation charge projection; subsequent BO edits do not mutate the source inspection or quotation.

- [ ] **Step 4: Run the inspection suite and bridge unit tests**

Run: `npm run test:unit -- tests/unit/ir-quick-bo-bridge.spec.ts tests/unit/orders-inspection-domain.spec.ts && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/inspection-reports.spec.ts`

- [ ] **Step 5: Commit only Task 5 files**

```bash
git add src/components/orders/ir-create-dialog.tsx src/components/orders/quotation-panel.tsx src/components/orders/inspection-detail-modal.tsx src/lib/orders/inspection-report.ts src/lib/orders/quotation.ts tests/e2e/inspection-reports.spec.ts tests/unit/ir-quick-bo-bridge.spec.ts
git commit -m "feat: close inspection quotation BO bridge"
```

### Task 5: BO Charge Items, Per-Item Discounts, and Responsive Editing

**Files:**
- Modify: `src/components/orders/quick-order-detail.tsx`
- Modify: `src/components/orders/quick-order-shared-charge-edit.tsx`
- Modify: `src/components/orders/quick-order-create-dialog.tsx`
- Modify: `src/lib/billing/quoted-charges.ts`
- Test: `tests/e2e/orders.spec.ts`
- Test: `tests/unit/quoted-charge-totals.spec.ts`

**Interfaces:**
- Consumes: `UpdateSharedQuickOrderChargesInput`, shared charge lines, `calculateQuotedChargeTotals()`.
- Produces: create/edit/delete charge actions and a visible calculation row for original amount, per-unit discount, discounted unit price, total discount, and discounted subtotal.

- [ ] **Step 1: Add a BO behavior test that changes one line discount**

```ts
test("BO charge editor saves a per-item discount without horizontal scrolling", async ({ page }) => {
  await page.goto("/orders/business/demo-v2-provisional");
  await page.getByRole("button", { name: "修改收费项目" }).click();
  const row = page.getByTestId("shared-charge-row-0");
  await row.getByLabel("原单价").fill("10000");
  await row.getByLabel("每单位项目折扣").fill("1500");
  await page.getByRole("button", { name: "保存收费项目" }).click();
  await expect(page.getByTestId("quick-shared-charge-lines")).toContainText("JMD 1,500");
  const overflow = await page.getByTestId("quick-shared-charge-lines").evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 2: Run the test and verify the existing 1320px grid fails**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/orders.spec.ts --grep "per-item discount"`

- [ ] **Step 3: Replace fixed-width charge tables with responsive line cards**

Use `grid-cols-1 lg:grid-cols-[minmax(220px,2fr)_repeat(5,minmax(90px,1fr))]` without `min-w-[1320px]` or `overflow-x-auto`. On narrow screens render label/value pairs inside each line card.

- [ ] **Step 4: Verify arithmetic and browser behavior**

Run: `npm run test:unit -- tests/unit/quoted-charge-totals.spec.ts && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/orders.spec.ts`

- [ ] **Step 5: Commit only Task 4 files**

```bash
git add src/components/orders/quick-order-detail.tsx src/components/orders/quick-order-shared-charge-edit.tsx src/components/orders/quick-order-create-dialog.tsx src/lib/billing/quoted-charges.ts tests/e2e/orders.spec.ts tests/unit/quoted-charge-totals.spec.ts
git commit -m "feat: make BO charges editable and responsive"
```

### Task 6: Independent Payment, Arbitrary Refund, and Signed Refund Receipt

**Files:**
- Modify: `src/lib/billing/quick-order-financial-ledger.ts`
- Modify: `src/lib/billing/quick-order-money-actions.ts`
- Modify: `src/lib/billing/refunds.ts`
- Modify: `src/components/orders/quick-order-detail.tsx`
- Modify: `src/components/orders/refund-receipt-print.tsx`
- Modify: `src/components/payments/payments-workspace.tsx`
- Test: `tests/unit/quick-order-financial-ledger.spec.ts`
- Test: `tests/unit/refund-rules.spec.ts`
- Test: `tests/e2e/payments.spec.ts`

**Interfaces:**
- Consumes: `recordMockQuickPayment()`, `recordMockQuickRefund()`, and Task 5 charge totals.
- Produces: append-only ledger rows; `balanceJmd = receivableJmd - paidJmd + cashRefundedJmd`; refund receipt with BO, customer, amount, method, reason, time, actor, and customer signature.

- [ ] **Step 1: Add independent arithmetic tests with hand-derived numbers**

```ts
test("cash refund increases the remaining balance without changing charges", () => {
  const model = deriveQuickOrderFinancialModel({
    receivableJmd: 21_000,
    payments: [{ amountJmd: 8_000 }],
    refunds: [{ amountJmd: 5_000, method: "cash" }],
  });
  expect(model.receivableJmd).toBe(21_000);
  expect(model.paidJmd).toBe(8_000);
  expect(model.cashRefundedJmd).toBe(5_000);
  expect(model.balanceJmd).toBe(18_000);
});
```

- [ ] **Step 2: Run the tests and verify any hidden offset behavior fails**

Run: `npm run test:unit -- tests/unit/quick-order-financial-ledger.spec.ts tests/unit/refund-rules.spec.ts`

- [ ] **Step 3: Implement append-only money actions and receipt projection**

Reject non-positive amounts, never require `chargeLineId`, never edit prior events, and preserve signature stroke evidence in the refund record. Render totals and each event in chronological order.

- [ ] **Step 4: Run payment/refund unit and E2E tests**

Run: `npm run test:unit -- tests/unit/quick-order-financial-ledger.spec.ts tests/unit/refund-rules.spec.ts tests/unit/quick-order-money-actions-public-api.spec.ts && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/payments.spec.ts`

- [ ] **Step 5: Commit only Task 6 files**

```bash
git add src/lib/billing/quick-order-financial-ledger.ts src/lib/billing/quick-order-money-actions.ts src/lib/billing/refunds.ts src/components/orders/quick-order-detail.tsx src/components/orders/refund-receipt-print.tsx src/components/payments/payments-workspace.tsx tests/unit/quick-order-financial-ledger.spec.ts tests/unit/refund-rules.spec.ts tests/e2e/payments.spec.ts
git commit -m "feat: record signed arbitrary BO refunds"
```

### Task 7: Invoice/PDF, Pickup, and Parking Continuity

**Files:**
- Modify: `src/lib/billing/quick-order-financial-statement.ts`
- Modify: `src/lib/orders/quick-invoice-pdf.ts`
- Modify: `src/components/orders/quick-invoice-pdf-section.tsx`
- Modify: `src/components/orders/quick-order-detail.tsx`
- Modify: `src/components/parking/parking-workspace.tsx`
- Test: `tests/unit/quick-order-financial-statement-consumer.spec.ts`
- Test: `tests/unit/quick-invoice-pdf.spec.ts`
- Test: `tests/e2e/quick-order-financial-statement-consumers.spec.ts`
- Test: `tests/e2e/parking.spec.ts`

**Interfaces:**
- Consumes: the Task 6 financial statement and existing pickup/parking producers.
- Produces: one consistent Invoice/PDF view and parking facts that link to the originating BO and ledger records.

- [ ] **Step 1: Add a cross-consumer test for identical totals**

```ts
test("BO, Payments, Invoice PDF and Parking show the same ledger totals", async ({ page }) => {
  await page.goto("/orders/business/demo-v2-parking");
  const boBalance = await page.getByTestId("quick-balance").textContent();
  await page.getByRole("button", { name: "生成 Invoice" }).click();
  await expect(page.getByTestId("quick-invoice-financials")).toContainText(boBalance ?? "");
  await page.goto("/payments");
  await expect(page.getByTestId("payments-workspace")).toContainText(boBalance ?? "");
});
```

- [ ] **Step 2: Run the cross-consumer test and verify the current permission/version mismatch**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/quick-order-financial-statement-consumers.spec.ts --max-failures=1`

- [ ] **Step 3: Make every consumer read the same statement and preserve pickup/parking links**

Remove Invoice V1/V2 display divergence. Use the current superadmin actor for owner actions, keep parking payments and correction refunds as separate ledger rows, and show a direct source BO link on each parking case.

- [ ] **Step 4: Run Invoice and parking tests**

Run: `npm run test:unit -- tests/unit/quick-order-financial-statement-consumer.spec.ts tests/unit/quick-invoice-pdf.spec.ts tests/unit/parking-correction-refund.spec.ts && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/quick-order-financial-statement-consumers.spec.ts tests/e2e/parking.spec.ts`

- [ ] **Step 5: Commit only Task 7 files**

```bash
git add src/lib/billing/quick-order-financial-statement.ts src/lib/orders/quick-invoice-pdf.ts src/components/orders/quick-invoice-pdf-section.tsx src/components/orders/quick-order-detail.tsx src/components/parking/parking-workspace.tsx tests/unit/quick-order-financial-statement-consumer.spec.ts tests/unit/quick-invoice-pdf.spec.ts tests/e2e/quick-order-financial-statement-consumers.spec.ts tests/e2e/parking.spec.ts
git commit -m "fix: keep invoice pickup and parking totals consistent"
```

### Task 8: Live Dashboard and Owner-Created Performance Data

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/team-performance.tsx`
- Modify: `src/lib/api/mock-dashboard.ts`
- Modify: `src/lib/api/mock-performance.ts`
- Modify: `src/components/performance/performance-workspace.tsx`
- Test: `tests/e2e/dashboard.spec.ts`
- Test: `tests/e2e/performance-detail.spec.ts`
- Test: `tests/unit/performance-api.spec.ts`

**Interfaces:**
- Consumes: current linked BO, money, parking, employee, and team facts.
- Produces: live today/week/month filters inside the original dashboard metrics and an empty performance state until actual teams exist.

- [ ] **Step 1: Add tests for empty teams and record-driven totals**

```ts
test("dashboard changes when a new payment is recorded and invents no team cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid^="team-performance-"]')).toHaveCount(0);
  const before = await page.getByTestId("dashboard-cash-received").textContent();
  await page.goto("/orders/business/demo-v2-provisional");
  await page.getByRole("button", { name: "收款" }).click();
  await page.getByLabel("金额").fill("1000");
  await page.getByRole("button", { name: "确认收款" }).click();
  await page.goto("/");
  await expect(page.getByTestId("dashboard-cash-received")).not.toHaveText(before ?? "");
});
```

- [ ] **Step 2: Run the tests and verify fixed performance fixtures fail**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/performance-detail.spec.ts --max-failures=1`

- [ ] **Step 3: Derive dashboard and performance rows from current records**

Return no team rows when `loadTeams()` is empty. Provide `新增班组` and `新增员工` actions from the empty state. Keep daily/weekly/monthly as filters or drill-downs within the original overview rather than three permanent duplicate cards.

- [ ] **Step 4: Run dashboard, performance, and API tests**

Run: `npm run test:unit -- tests/unit/performance-api.spec.ts tests/unit/performance-calculations.spec.ts && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/performance-detail.spec.ts tests/e2e/performance-rules.spec.ts`

- [ ] **Step 5: Commit only Task 8 files**

```bash
git add src/app/page.tsx src/components/dashboard/team-performance.tsx src/lib/api/mock-dashboard.ts src/lib/api/mock-performance.ts src/components/performance/performance-workspace.tsx tests/e2e/dashboard.spec.ts tests/e2e/performance-detail.spec.ts tests/unit/performance-api.spec.ts
git commit -m "fix: derive overview and performance from live records"
```

### Task 9: Remove Horizontal Scrolling Across Core Business UI

**Files:**
- Modify: `src/components/orders/business-orders-table.tsx`
- Modify: `src/components/orders/inspection-reports-table.tsx`
- Modify: `src/components/orders/quotation-panel.tsx`
- Modify: `src/components/payments/payments-workspace.tsx`
- Modify: `src/components/parking/parking-workspace.tsx`
- Modify: `src/components/customers/customer-list.tsx`
- Modify: `src/components/customers/vehicle-list.tsx`
- Modify: `src/components/performance/member-payroll-table.tsx`
- Modify: `src/components/performance/performance-history-table.tsx`
- Modify: `src/components/revenue/revenue-history-table.tsx`
- Modify: `src/components/orders/pdf-canvas-preview.tsx`
- Test: `tests/e2e/no-horizontal-overflow.spec.ts`

**Interfaces:**
- Consumes: existing record view models and page test IDs.
- Produces: desktop auto-fit grids and 430px labeled cards with `scrollWidth <= clientWidth` for the page root and every core business container.

- [ ] **Step 1: Add a route/container overflow matrix**

```ts
for (const route of ["/orders/business", "/orders/inspections", "/payments", "/parking", "/customers", "/vehicles", "/performance", "/revenue"]) {
  test(`${route} has no core horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto(route);
    const offenders = await page.locator("[data-core-business-container]").evaluateAll((nodes) =>
      nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.getAttribute("data-testid")),
    );
    expect(offenders).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
```

- [ ] **Step 2: Run the matrix and record all actual offenders**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/no-horizontal-overflow.spec.ts`

- [ ] **Step 3: Convert each offender to responsive rows/cards and mark core containers**

Remove fixed `min-w-[...]` and `overflow-x-auto` from core business data. Use CSS grid with `minmax(0, 1fr)`, `break-words`, and mobile label/value cards; preserve semantic buttons and links. Fit PDF canvases to their own container width so zooming never expands the page root.

- [ ] **Step 4: Run the overflow matrix at 430px and desktop**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/no-horizontal-overflow.spec.ts tests/e2e/mobile-nav.spec.ts tests/e2e/revenue-detail.spec.ts`

- [ ] **Step 5: Commit only Task 9 files**

```bash
git add src/components/orders/business-orders-table.tsx src/components/orders/inspection-reports-table.tsx src/components/orders/quotation-panel.tsx src/components/payments/payments-workspace.tsx src/components/parking/parking-workspace.tsx src/components/customers/customer-list.tsx src/components/customers/vehicle-list.tsx src/components/performance/member-payroll-table.tsx src/components/performance/performance-history-table.tsx src/components/revenue/revenue-history-table.tsx src/components/orders/pdf-canvas-preview.tsx tests/e2e/no-horizontal-overflow.spec.ts
git commit -m "fix: remove core business horizontal scrolling"
```

### Task 10: New-Browser Acceptance Walk and Full Verification

**Files:**
- Create: `tests/e2e/business-flow-acceptance.spec.ts`

**Interfaces:**
- Consumes: every flow produced by Tasks 1–9.
- Produces: one executable acceptance chain and visual proof at port 3210.

- [ ] **Step 1: Write one acceptance E2E that starts from cleared project storage**

```ts
test("super administrator completes the clean business flow", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("wh_") && key !== "wh_session") localStorage.removeItem(key);
    }
    indexedDB.deleteDatabase("whole-hearted-attachments");
  });
  await page.reload();

  await page.goto("/customers");
  await page.getByRole("button", { name: "新增客户" }).click();
  await page.getByLabel("手机号码").fill("+1 876 555 0101");
  await page.getByRole("button", { name: "检查号码" }).click();
  await page.getByRole("button", { name: "跳过 OTP" }).click();
  await page.getByRole("button", { name: "手动录入" }).click();
  await page.getByLabel("客户姓名").fill("流程验收客户");
  await page.getByRole("button", { name: "保存客户" }).click();
  await page.getByRole("button", { name: "新增车辆" }).click();
  await page.getByLabel("车牌").fill("FLOW 101");
  await page.getByLabel("品牌").fill("Toyota");
  await page.getByLabel("车型").fill("Hiace");
  await page.getByRole("button", { name: "保存车辆" }).click();

  await page.goto("/orders/inspections");
  await page.getByRole("button", { name: "新建检查结果" }).click();
  await page.getByLabel("车辆").selectOption({ label: /FLOW 101/ });
  await page.getByLabel("检查事实").fill("右前刹车片磨损");
  await page.getByRole("button", { name: "保存检查结果" }).click();
  await page.getByRole("button", { name: "创建 Quotation" }).click();
  await page.getByLabel("项目名称").fill("刹车片更换");
  await page.getByLabel("报价金额").fill("21000");
  await page.getByRole("button", { name: "保存 Quotation" }).click();
  await page.getByRole("button", { name: "创建业务单" }).click();

  await page.getByRole("button", { name: "修改收费项目" }).click();
  const line = page.getByTestId("shared-charge-row-0");
  await line.getByLabel("数量").fill("2");
  await line.getByLabel("原单价").fill("10000");
  await line.getByLabel("每单位项目折扣").fill("2000");
  await page.getByRole("button", { name: "新增收费项目" }).click();
  const fixed = page.getByTestId("shared-charge-row-1");
  await fixed.getByLabel("项目名称").fill("外出救援服务");
  await fixed.getByLabel("一口价").fill("5000");
  await page.getByRole("button", { name: "保存收费项目" }).click();

  await page.getByRole("button", { name: "收款" }).click();
  await page.getByLabel("金额").fill("8000");
  await page.getByLabel("备注").fill("第一笔收款");
  await page.getByRole("button", { name: "确认收款" }).click();
  await page.getByRole("button", { name: "收款" }).click();
  await page.getByLabel("金额").fill("13000");
  await page.getByLabel("备注").fill("第二笔收款");
  await page.getByRole("button", { name: "确认收款" }).click();
  await page.getByRole("button", { name: "退款" }).click();
  await page.getByLabel("退款金额").fill("5000");
  await page.getByLabel("退款原因").fill("客户确认收到退款");
  await page.getByTestId("signature-pad").dispatchEvent("pointerdown", { clientX: 10, clientY: 10 });
  await page.getByTestId("signature-pad").dispatchEvent("pointermove", { clientX: 80, clientY: 40 });
  await page.getByTestId("signature-pad").dispatchEvent("pointerup");
  await page.getByRole("button", { name: "确认退款" }).click();
  await expect(page.getByTestId("quick-receivable")).toContainText("JMD 21,000");
  await expect(page.getByTestId("quick-paid")).toContainText("JMD 21,000");
  await expect(page.getByTestId("quick-refunded")).toContainText("JMD 5,000");
  await expect(page.getByTestId("quick-balance")).toContainText("JMD 5,000");

  await page.getByRole("button", { name: "生成 Invoice" }).click();
  await expect(page.getByTestId("quick-invoice-financials")).toContainText("JMD 5,000");
  await page.getByRole("button", { name: "打印退款说明单" }).click();
  await expect(page.getByTestId("refund-receipt-print")).toContainText("客户确认收到退款");

  await page.goto("/employees");
  await page.getByRole("button", { name: "新增班组" }).click();
  await page.getByLabel("班组名称").fill("验收维修组");
  await page.getByRole("button", { name: "保存班组" }).click();
  await page.goto("/orders/business");
  await page.getByText("FLOW 101").click();
  await page.getByRole("button", { name: "派单" }).click();
  await page.getByLabel("维修班组").selectOption({ label: "验收维修组" });
  await page.getByRole("button", { name: "确认派单" }).click();
  await page.getByRole("button", { name: "接单" }).click();
  await page.getByRole("button", { name: "回单" }).click();
  await page.getByRole("button", { name: "交单" }).click();
  await page.getByRole("button", { name: "交车" }).click();
  await page.goto("/parking");
  await expect(page.getByText("FLOW 101")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("dashboard-business-orders")).toContainText("1");
});
```

- [ ] **Step 2: Run the acceptance E2E and fix only observed defects with a new failing focused test first**

Run: `E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npx playwright test tests/e2e/business-flow-acceptance.spec.ts --trace on`

- [ ] **Step 3: Run required repository gates**

Run: `npm run typecheck && npm run test:collaboration && npm run test:unit && E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 npm run test:e2e`

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 4: Walk the same chain in the in-app browser at 1368px and 430px**

Open `/customers`, `/vehicles`, `/orders/inspections`, `/orders/business`, `/payments`, `/parking`, and `/` on `http://127.0.0.1:3210`; operate every create/edit/payment/refund/signature/PDF/pickup action and confirm no core container overflows.

- [ ] **Step 5: Commit acceptance coverage and any final focused fixes**

```bash
git add tests/e2e/business-flow-acceptance.spec.ts
git commit -m "test: verify complete mock business flow"
```
