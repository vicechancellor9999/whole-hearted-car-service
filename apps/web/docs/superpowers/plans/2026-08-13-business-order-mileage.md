# Business Order Mileage Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mileage a traceable Business Order fact, show it on each related BO row and BO detail, and remove independent vehicle-master mileage editing/display.

**Architecture:** `BusinessOrder.startMileage` becomes the single displayed mileage source. Linked Operations schema v4 preserves existing v3 browser data by migrating already-started legacy BOs to an explicit `legacy_missing` fact and never infers mileage from vehicle master or inspection data. A vehicle-scoped read DTO joins BOs to their `OrderRecord` timestamps, sorts newest BO first, and feeds the vehicle detail page.

**Tech Stack:** TypeScript, React 18, Next.js 14, Mock API/localStorage, Playwright unit and E2E tests.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Do not modify or remove unrelated untracked files, including `.next.bak-*` and the in-person onboarding plan.
- Store generated project files only under `/Volumes/公司文件`.
- Mileage displayed anywhere in the affected UI must come from `BusinessOrder.startMileage`; never fall back to `VehicleRecord.mileage` or `InspectionSubmission.mileageKm`.
- `VEH-UAT-001` has 14 related BOs (`order-demo-11` through `order-demo-24`); the newest row is `order-demo-24` and its fresh synthetic mileage is `84,200 km`.
- A legacy started BO without reliable mileage displays `未记录`; a not-yet-started BO has `startMileage: null` and also displays `未记录`.
- Page behavior changes require updated E2E and a full E2E pass, plus `npm run typecheck` and `npm run test:collaboration` before commit.

---

### Task 1: Business Order mileage fact and safe schema v4 migration

**Files:**
- Modify: `src/lib/orders/business-order-types.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Test: `tests/unit/orders-api.spec.ts`
- Test: `tests/unit/billing-api.spec.ts`

**Interfaces:**
- Produces: `BusinessOrderStartMileage`, `BusinessOrder.startMileage`.
- Produces: Linked Operations schema v4 with v1 -> v2 -> v3 -> v4 migration.
- Consumes: `OrderRecord.acceptedAt`, `OrderRecord.mechanics`, and deterministic BO seed order.

- [ ] **Step 1: Write the failing domain tests**

Add assertions that fresh `order-demo-24` has the exact recorded fact below, a planned BO has `null`, and the validator rejects negative mileage, invalid unit, mismatched `recordedAt`, or missing recorder identity:

```ts
expect(state.businessOrders.find((order) => order.id === "order-demo-24")?.startMileage).toEqual({
  status: "recorded",
  value: 84_200,
  unit: "km",
  recordedAt: state.orderRecords.find((order) => order.id === "order-demo-24")?.acceptedAt,
  recordedById: expect.any(String),
  recordedByName: expect.any(String),
});
```

Add a genuine v3 envelope test that removes `startMileage`, persists `schemaVersion: 3`, reloads through `createMockLinkedOperationsStore`, and asserts: schema 4, revision unchanged, raw rewritten in place, started BOs become `legacy_missing`, and unstarted BOs become `null`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/orders-api.spec.ts tests/unit/billing-api.spec.ts --grep "start mileage|schema v3 mileage"
```

Expected: assertions fail because `startMileage` and schema v4 migration do not exist.

- [ ] **Step 3: Add the domain type and deterministic fresh facts**

Add:

```ts
export type BusinessOrderStartMileage =
  | {
      readonly status: "recorded";
      readonly value: number;
      readonly unit: "km" | "mile";
      readonly recordedAt: string;
      readonly recordedById: string;
      readonly recordedByName: string;
    }
  | {
      readonly status: "legacy_missing";
      readonly reason: "created_before_start_mileage_rule";
    };
```

Add `readonly startMileage: BusinessOrderStartMileage | null` to `BusinessOrder`. Fresh started seeds receive a deterministic recorded fact; `order-demo-11` through `order-demo-24` use a monotonic series ending at `84_200`, while unstarted seeds receive `null`.

- [ ] **Step 4: Add schema v4 recognition, migration, and invariants**

Keep the storage key unchanged. Add a true `LegacyBusinessOrderV3 = Omit<BusinessOrder, "startMileage">`, an `isLegacyLinkedStateV3` guard that accepts current 300-order v3 envelopes, and `migrateLegacyLinkedStateV3`. Migration rules are exact:

```ts
const startMileage = record?.acceptedAt || record?.returnedAt || record?.submittedAt
  || order.executionStatus === "in_progress" || order.executionStatus === "completed"
  ? { status: "legacy_missing", reason: "created_before_start_mileage_rule" } as const
  : null;
```

The v4 validator enforces non-negative safe integer values, `km | mile`, valid ISO timestamp equal to the matching `OrderRecord.acceptedAt`, non-empty recorder identity, and started execution status. The dispatcher checks v3 before v2/v1 so a valid v3 envelope is migrated rather than removed.

- [ ] **Step 5: Run focused unit tests and commit**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/orders-api.spec.ts tests/unit/billing-api.spec.ts
npm run typecheck
```

Expected: all pass. Commit only Task 1 files with `feat(orders): attach mileage to business orders`.

---

### Task 2: Vehicle-related BO read model and typed API

**Files:**
- Modify: `src/lib/orders/business-order-types.ts`
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/client.ts`
- Test: `tests/unit/customers-api.spec.ts`

**Interfaces:**
- Produces: `VehicleBusinessOrderRow` and `api.vehicles.businessOrders(vehicleId)`.
- Consumes: `LinkedOperationsState.businessOrders` joined by BO ID to `orderRecords`.

- [ ] **Step 1: Write the failing API tests**

Assert that `api.vehicles.businessOrders("VEH-UAT-001")` returns exactly 14 rows, all for `VEH-UAT-001`, ordered `order-demo-24` first through `order-demo-11` last, with the first row carrying `84_200 km`. Assert a missing vehicle returns 404 and unauthorized roles fail before data is returned.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customers-api.spec.ts --grep "vehicle business orders"
```

Expected: fail because the typed method and route do not exist.

- [ ] **Step 3: Implement the read model and route**

Add this DTO:

```ts
export interface VehicleBusinessOrderRow {
  readonly id: string;
  readonly businessOrderNo: string;
  readonly vehicleId: string;
  readonly executionStatus: BusinessOrderExecutionStatus;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
  readonly startMileage: BusinessOrderStartMileage | null;
}
```

The selector filters by `vehicleId`, joins the same-ID `OrderRecord`, and sorts by `createdAt DESC`, then `businessOrderNo DESC`, then `id DESC`. Add authenticated `GET /api/vehicles/:id/business-orders` and `api.vehicles.businessOrders(id)`. The route returns 404 when the canonical vehicle does not exist.

- [ ] **Step 4: Run focused API tests and commit**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customers-api.spec.ts
npm run typecheck
```

Expected: all pass. Commit Task 2 files with `feat(vehicles): expose related business order mileage`.

---

### Task 3: Replace vehicle-master mileage UI with related BO rows

**Files:**
- Modify: `src/components/customers/vehicle-detail-page.tsx`
- Modify: `src/components/customers/vehicle-list.tsx`
- Modify: `src/components/customers/form-dialogs.tsx`
- Modify: `src/app/orders/business/[id]/page.tsx`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Consumes: `api.vehicles.businessOrders(vehicleId)` and `BusinessOrder.startMileage`.
- Produces stable test IDs: `vehicle-section-business-orders`, `vehicle-business-order-{id}`, `vehicle-business-order-mileage-{id}`, and `bo-start-mileage`.

- [ ] **Step 1: Replace E2E expectations and verify RED**

Update the vehicle E2E to assert:

```ts
await expect(page.getByTestId("vehicle-section-mileage")).toHaveCount(0);
await expect(page.getByTestId("form-vehicle-mileage")).toHaveCount(0);
await expect(page.getByTestId("vehicle-section-business-orders")).toBeVisible();
await expect(page.getByTestId("vehicle-business-order-order-demo-24")).toContainText("84,200 km");
await page.getByTestId("vehicle-business-order-order-demo-24").click();
await expect(page).toHaveURL(/\/orders\/business\/order-demo-24$/);
await expect(page.getByTestId("bo-start-mileage")).toContainText("84,200 km");
```

Also assert the global vehicle table/card no longer has `vehicle-mileage-*` elements and the 430px vehicle edit form has no mileage fields or horizontal overflow.

- [ ] **Step 2: Run the targeted E2E and verify RED**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test tests/e2e/customer-vehicle.spec.ts --grep "vehicle master facts|validation errors|430px"
```

Expected: fail because the old mileage card/form still exists and the BO list does not.

- [ ] **Step 3: Implement the vehicle and BO detail rendering**

Load vehicle detail, customer workspace, and BO rows in one `Promise.all`. Replace the independent mileage section with a related BO section. Each row displays BO number, status, created/start time, and either the recorded mileage with recorder/timestamp or `入场里程：未记录`. The entire row links to `/orders/business/{id}`.

Remove mileage state, validation, and the three mileage inputs from `VehicleFormDialog`. Remove the mileage column/badge from desktop and mobile vehicle list cards. Add an `入场里程` card to the BO route detail using `businessOrder.startMileage`, never using vehicle or inspection fields.

- [ ] **Step 4: Run focused and complete UI verification**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/unit/customers-api.spec.ts tests/unit/orders-api.spec.ts tests/unit/billing-api.spec.ts
npm run typecheck
npm run test:collaboration
npm run test:unit
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
```

Expected: every command passes.

- [ ] **Step 5: Render desktop and 430px evidence, review, and commit**

Use Playwright because the Browser plugin is unavailable. Capture the real vehicle page and linked BO detail at 1440px and 430px under an external-volume QA directory. Verify no framework overlay, relevant console errors, clipping, or horizontal overflow; click the newest BO row and confirm the URL and matching `84,200 km`. Commit only the mileage plan, implementation, and tests with `feat(vehicles): show mileage through business orders`.
