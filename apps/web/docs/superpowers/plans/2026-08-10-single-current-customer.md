# Single Current Customer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce that each vehicle has zero or one current customer while preserving immutable customer relationship history during create, clear, handover, persistence migration, and UI editing.

**Architecture:** Keep `VehicleCustomerRelationship[]` as the historical source of truth, but enforce at most one `endedAt === null` row per vehicle at normalization, persistence, and seed boundaries. Upgrade Mock persistence to schema v2 and deterministically repair schema v1 multi-current records without dropping other state. Replace the vehicle form's multi-checkbox state with one current-customer selector that closes the previous relationship and creates the replacement in one preview-backed save.

**Tech Stack:** TypeScript 5.5, Next.js 14 client components, storage-backed Mock API, Playwright unit/E2E tests, System Chrome.

## Global Constraints

- Work only in `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/customer-vehicle-management` on `feat/customer-vehicle-management`.
- Never reuse or stop port 3002; tests and preview use port 3003.
- A vehicle may have zero or one current customer, never two.
- Handover ends the previous current relationship and creates the new current relationship atomically; old work orders, money, photos, payments, and relationship history remain unchanged.
- Do not introduce owner/driver/payer relationship roles.
- Every production behavior starts with a focused failing test.

---

### Task 1: Domain invariant, seed repair, and storage migration

**Files:**
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `tests/unit/customers-store.spec.ts`

**Interfaces:**
- Consumes: existing `VehicleCustomerRelationship`, `NormalizedVehicleInput`, `createMockCustomerVehicleStore()`.
- Produces: storage schema v2, deterministic v1 migration, and an at-most-one-active validation used by vehicle preview/create/update and persisted-state reads.

- [ ] **Step 1: Replace the old multi-active seed test with failing literal invariants**

Add tests whose expected values are independent literals:

```ts
test("固定种子每辆车最多一个当前客户并保留换绑历史", () => {
  const workspace = createMockCustomerVehicleStore().workspace(superadmin);
  const vehicle3 = workspace.relationships.filter((entry) => entry.vehicleId === "VEH-UAT-003");
  expect(vehicle3.filter((entry) => entry.endedAt === null)).toEqual([
    expect.objectContaining({ id: "REL-UAT-005", customerId: "CUST-UAT-002" }),
  ]);
  expect(vehicle3.find((entry) => entry.id === "REL-UAT-004")).toEqual(
    expect.objectContaining({ customerId: "CUST-UAT-001", endedAt: "2026-07-01T00:00:00.000Z" }),
  );
});

test("车辆预览拒绝绕过 UI 提交多个当前客户", () => {
  const store = createMockCustomerVehicleStore();
  expect(() => store.previewVehicle(superadmin, {
    make: "Honda", model: "Fit", year: 2025,
    relationships: [
      { customerId: "CUST-UAT-001", startedAt: "2026-08-10T09:00:00.000Z", endedAt: null },
      { customerId: "CUST-UAT-002", startedAt: "2026-08-10T09:00:00.000Z", endedAt: null },
    ],
  })).toThrow("一辆车只能绑定一个当前客户");
});
```

- [ ] **Step 2: Add failing handover, clear-current, and migration tests**

The handover test must assert one active CUST-UAT-003 row, the prior CUST-UAT-002 row ended at the handover timestamp, all pre-existing historical rows remain byte-for-byte equal, and vehicle audit `beforeRelationships`/`afterRelationships` record both sides. The clear-current test must assert zero active rows without deleting history. The migration test must build a literal schema-v1 envelope with two active rows, preserve a customer edit and vehicle aggregate, then reload and assert schema-v2 behavior keeps only the latest-started relationship active and ends the older row at that start time.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run test:unit -- tests/unit/customers-store.spec.ts --grep "最多一个当前客户|多个当前客户|换绑|清除当前客户|schema v1"
```

Expected: the seed still has two active relationships; multi-active preview is accepted; handover/migration assertions fail.

- [ ] **Step 4: Implement the minimum invariant and migration**

Add these internal helpers in `mock-customers.ts`:

```ts
const STORAGE_SCHEMA_VERSION = 2;

function assertAtMostOneCurrentRelationship(
  relationships: Array<Pick<VehicleRelationshipDraft, "customerId" | "endedAt">>,
): void {
  if (relationships.filter((entry) => entry.endedAt === null).length > 1) {
    validation("一辆车只能绑定一个当前客户");
  }
}

function hasAtMostOneCurrentPerVehicle(relationships: VehicleCustomerRelationship[]): boolean {
  const activeCounts = new Map<string, number>();
  for (const entry of relationships) {
    if (entry.endedAt !== null) continue;
    activeCounts.set(entry.vehicleId, (activeCounts.get(entry.vehicleId) ?? 0) + 1);
  }
  return [...activeCounts.values()].every((count) => count <= 1);
}
```

Call `assertAtMostOneCurrentRelationship()` after normalized relationship construction. Update fixed relationships so REL-UAT-004 ends at `2026-07-01T00:00:00.000Z` and REL-UAT-005 starts at that timestamp and remains current. Persist schema v2. For a structurally valid schema-v1 state, group active rows per vehicle, sort by `startedAt` then `id`, retain the last row, and set every other active row's `endedAt` to the retained row's `startedAt`; return a clone without deleting any other field. Schema-v2 reads require `hasAtMostOneCurrentPerVehicle()`.

- [ ] **Step 5: Verify GREEN and commit domain behavior**

Run:

```bash
npm run test:unit -- tests/unit/customers-store.spec.ts
npm run test:unit -- tests/unit/customers-api.spec.ts
npm run typecheck
git diff --check
```

Then commit only domain/test files:

```bash
git add src/lib/api/mock-customers.ts tests/unit/customers-store.spec.ts
git commit -m "fix(customers): enforce one current customer per vehicle"
```

---

### Task 2: Single-select vehicle form and one-current presentation

**Files:**
- Modify: `src/components/customers/form-dialogs.tsx`
- Modify: `src/components/customers/summary-cards.tsx`
- Modify: `src/components/customers/vehicle-list.tsx`
- Modify: `src/components/customers/vehicle-detail-dialog.tsx`
- Modify: `tests/e2e/customer-vehicle.spec.ts`

**Interfaces:**
- Consumes: the existing preview-backed `api.vehicles.preview/create/previewUpdate/update` methods and relationship history arrays.
- Produces: `data-testid="form-vehicle-current-customer"`, single-current list/detail rendering, and atomic relationship drafts for handover or clearing.

- [ ] **Step 1: Write failing browser tests for create, handover, and clear**

Replace the multi-checkbox E2E expectations with real user behavior:

```ts
const currentCustomer = page.getByTestId("form-vehicle-current-customer");
await currentCustomer.selectOption("CUST-UAT-001");
await expect(currentCustomer).toHaveValue("CUST-UAT-001");
await expect(page.getByTestId("vehicle-relationship-CUST-UAT-002")).toHaveCount(0);
```

Create NEW909 and assert only Alicia appears in `vehicle-active-relationships`. Edit VEH-UAT-003, select CUST-UAT-003, save, and assert Marcia is the only current customer while North Coast appears in historical customers. Edit again, select the empty option, save, and assert “暂无当前客户” with all former customers retained in history. Assert the summary subtext contains `一车一位当前客户` and never `允许多位当前客户`.

- [ ] **Step 2: Run E2E and verify RED**

Run on the isolated server:

```bash
E2E_BASE_URL=http://127.0.0.1:3003 E2E_REUSE_SERVER=1 npm run test:e2e -- tests/e2e/customer-vehicle.spec.ts --grep "one current customer|换绑|清除当前客户"
```

Expected: `form-vehicle-current-customer` is absent and the old checkbox/multi-current behavior violates the assertions.

- [ ] **Step 3: Replace Set state with one selected customer**

In `VehicleFormDialog`, derive one original active relationship and store one string:

```ts
const originalCurrentCustomerId = relationships.find((entry) => entry.endedAt === null)?.customerId ?? "";
const [currentCustomerId, setCurrentCustomerId] = useState(originalCurrentCustomerId);
```

Build drafts using one `changedAt` value: preserve every historical row; close the previous active row when its customer differs from `currentCustomerId`; create one new active row only when `currentCustomerId` is non-empty and differs from the original. Render a `<select data-testid="form-vehicle-current-customer">` whose first option is `暂无当前客户`, followed by enabled customers. Changing the selection invalidates any prior preview.

- [ ] **Step 4: Make list, detail, and summary singular**

Change summary subtext to `一车一位当前客户`. In the vehicle list, resolve a single active customer name and fall back to `暂无当前客户`. In the vehicle detail, render one current relationship card or the empty message; keep the historical section unchanged.

- [ ] **Step 5: Verify focused GREEN and commit UI behavior**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3003 E2E_REUSE_SERVER=1 npm run test:e2e -- tests/e2e/customer-vehicle.spec.ts
npm run typecheck
git diff --check
```

Then commit:

```bash
git add src/components/customers/form-dialogs.tsx src/components/customers/summary-cards.tsx src/components/customers/vehicle-list.tsx src/components/customers/vehicle-detail-dialog.tsx tests/e2e/customer-vehicle.spec.ts
git commit -m "feat(customers): use one current customer selector"
```

---

### Task 3: Full regression and real-browser acceptance

**Files:**
- Modify only if evidence finds a defect in the files owned by Tasks 1-2.
- Evidence: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/customer-vehicle-single-current-20260810/`

**Interfaces:**
- Consumes: committed domain and UI changes from Tasks 1-2.
- Produces: fresh test/build evidence and desktop/mobile screenshots for the final branch.

- [ ] **Step 1: Run the complete verification matrix**

```bash
npm run test:unit
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3003 E2E_REUSE_SERVER=1 npm run test:e2e
npm run build
npm run typecheck
git diff --check
```

Expected: zero failures; only the two already-known unrelated build warnings may remain (`aria-selected` in performance and native `<img>` in logo).

- [ ] **Step 2: Verify System Chrome at 1920 and 430 pixels**

Use a fresh Chrome context in light and dark modes. Capture vehicle list, VEH-UAT-003 detail, and edit form after choosing a replacement customer. Assert one `aria-modal`, zero console/page errors, root `scrollWidth === clientWidth`, the current-customer control is actionable, and no page contains `允许多位当前客户`.

- [ ] **Step 3: Request read-only review and close any Important finding with RED/GREEN evidence**

The review scope is the domain invariant, migration determinism, historical immutability, radio/select accessibility, URL/dialog behavior, and regression-test validity. Do not broaden into unrelated customer fields or global layout refactors.

- [ ] **Step 4: Confirm branch state**

```bash
git status --short
git log -5 --oneline
lsof -nP -iTCP:3002 -sTCP:LISTEN
lsof -nP -iTCP:3003 -sTCP:LISTEN
```

Expected: clean worktree, 3002 unchanged, and 3003 serving this worktree for user review.
