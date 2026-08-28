# Business Order Workspaces and Three Copies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the formal Business Order detail into four URL-addressable workspaces without losing any existing action, and add a persisted customer copy beside the existing mechanic and office copies.

**Architecture:** Keep the existing detail controller and mutation handlers intact while introducing a small tab/navigation layer and workspace containers around the existing sections. Extend the immutable Business Order document snapshot union with `customer_copy`, then thread that kind through the schema, migration, service, route, client types, print renderer, and documents workspace.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, PostgreSQL, Drizzle ORM, Vitest, Playwright unit tests.

**Spec:** `docs/superpowers/specs/2026-08-28-business-order-four-workspaces-design.md`

## Global Constraints

- Preserve every current Business Order action, link, form, status message, permission check, API call, and print path.
- Keep charge items as the primary visual content of the default workspace.
- Keep the five-stage progress bar below the title facts.
- Keep notes visible in the charge workspace.
- Use `operations`, `documents`, `history`, and `messages` as the only tab query values.
- Generate `customer_copy`, `office_archive`, and `mechanic_work` as separate immutable snapshots.
- Customer copy must exclude `internal` notes and internal audit/performance data.
- Do not alter the current 3210 runtime during candidate acceptance.

---

### Task 1: Freeze the existing detail capability contract

**Files:**
- Create: `apps/web/src/components/orders/formal-business-order-capabilities.ts`
- Create: `apps/web/tests/unit/formal-business-order-capabilities.spec.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`

**Interfaces:**
- Produces: `FORMAL_BUSINESS_ORDER_ACTIONS`, the stable inventory used by the page and regression tests.

- [ ] **Step 1: Write the failing inventory test**

```ts
import { expect, test } from "@playwright/test";
import { FORMAL_BUSINESS_ORDER_ACTIONS } from "../../src/components/orders/formal-business-order-capabilities";

test("the detail contract retains every formal action", () => {
  expect(new Set(FORMAL_BUSINESS_ORDER_ACTIONS.map((item) => item.id))).toEqual(new Set([
    "assign-team", "withdraw-assignment", "cancel-after-sales-round", "record-paper-acceptance",
    "record-mileage", "create-inspection", "submit-return", "approve-return", "reject-return",
    "formal-handoff", "cancel-formal-handoff", "start-after-sales", "edit-charges", "ai-stage-charges",
    "translate-charge", "edit-charge-notes", "record-payment", "record-refund", "upload-refund-proof",
    "upload-refund-acknowledgement", "open-receipt-zh", "open-receipt-en", "open-refund-acknowledgement",
    "generate-customer-copy", "generate-mechanic-copy", "generate-office-copy", "open-document",
  ]));
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-business-order-capabilities.spec.ts`

Expected: FAIL because `formal-business-order-capabilities.ts` does not exist.

- [ ] **Step 3: Add the typed inventory and page markers**

```ts
export type FormalBusinessOrderWorkspace = "operations" | "documents" | "history" | "messages";
export type FormalBusinessOrderAction = { id: string; workspace: FormalBusinessOrderWorkspace };
export const FORMAL_BUSINESS_ORDER_ACTIONS = [
  { id: "assign-team", workspace: "operations" },
  { id: "withdraw-assignment", workspace: "operations" },
  { id: "cancel-after-sales-round", workspace: "operations" },
  { id: "record-paper-acceptance", workspace: "operations" },
  { id: "record-mileage", workspace: "operations" },
  { id: "create-inspection", workspace: "operations" },
  { id: "submit-return", workspace: "operations" },
  { id: "approve-return", workspace: "operations" },
  { id: "reject-return", workspace: "operations" },
  { id: "formal-handoff", workspace: "operations" },
  { id: "cancel-formal-handoff", workspace: "operations" },
  { id: "start-after-sales", workspace: "operations" },
  { id: "edit-charges", workspace: "operations" },
  { id: "ai-stage-charges", workspace: "operations" },
  { id: "translate-charge", workspace: "operations" },
  { id: "edit-charge-notes", workspace: "operations" },
  { id: "record-payment", workspace: "operations" },
  { id: "record-refund", workspace: "operations" },
  { id: "upload-refund-proof", workspace: "operations" },
  { id: "upload-refund-acknowledgement", workspace: "operations" },
  { id: "open-receipt-zh", workspace: "operations" },
  { id: "open-receipt-en", workspace: "operations" },
  { id: "open-refund-acknowledgement", workspace: "operations" },
  { id: "generate-customer-copy", workspace: "documents" },
  { id: "generate-mechanic-copy", workspace: "documents" },
  { id: "generate-office-copy", workspace: "documents" },
  { id: "open-document", workspace: "documents" },
] as const satisfies readonly FormalBusinessOrderAction[];
```

Add the matching `data-formal-action` attribute to each existing control without changing its handler, disabled state, or permission guard.

- [ ] **Step 4: Re-run the inventory test and typecheck**

Run: `pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-business-order-capabilities.spec.ts && pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the frozen contract**

```bash
git add apps/web/src/components/orders/formal-business-order-capabilities.ts apps/web/src/components/orders/formal-business-order-detail.tsx apps/web/tests/unit/formal-business-order-capabilities.spec.ts
git commit -m 'test: freeze formal business order detail capabilities'
```

### Task 2: Add the URL-addressable four-workspace shell

**Files:**
- Create: `apps/web/src/components/orders/formal-business-order-tabs.tsx`
- Create: `apps/web/tests/unit/formal-business-order-tabs.spec.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`

**Interfaces:**
- Consumes: `FormalBusinessOrderWorkspace` from Task 1.
- Produces: `parseBusinessOrderWorkspace(value)` and `FormalBusinessOrderTabs`.

- [ ] **Step 1: Write failing tab parser and navigation tests**

```ts
expect(parseBusinessOrderWorkspace("documents")).toBe("documents");
expect(parseBusinessOrderWorkspace("unknown")).toBe("operations");
expect(FORMAL_BUSINESS_ORDER_TABS.map((tab) => tab.label)).toEqual([
  "收费 · 收款 · 维修班组", "三联生成 · 预览 · 打印", "历史记录", "沟通交流",
]);
```

Render the tab component with `active="operations"`, click “历史记录”, and assert `onChange("history")`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-business-order-tabs.spec.ts`

Expected: FAIL because the tab module does not exist.

- [ ] **Step 3: Implement the tab module**

```ts
export const FORMAL_BUSINESS_ORDER_TABS = [
  { id: "operations", label: "收费 · 收款 · 维修班组" },
  { id: "documents", label: "三联生成 · 预览 · 打印" },
  { id: "history", label: "历史记录" },
  { id: "messages", label: "沟通交流" },
] as const;

export function parseBusinessOrderWorkspace(value: string | null): FormalBusinessOrderWorkspace {
  return FORMAL_BUSINESS_ORDER_TABS.some((tab) => tab.id === value)
    ? value as FormalBusinessOrderWorkspace
    : "operations";
}
```

The component uses `role="tablist"`, `role="tab"`, `aria-selected`, keyboard focus, and optional unread message count.

- [ ] **Step 4: Wrap the current sections without replacing handlers**

Read the current query with `useSearchParams`; update it with `router.replace` while preserving unrelated query keys. Keep all section state in `FormalBusinessOrderDetail`. Render:

```tsx
<FormalBusinessOrderTabs active={activeWorkspace} onChange={changeWorkspace} />
<div hidden={activeWorkspace !== "operations"} className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
  <div className="min-w-0">{chargeSection}</div>
  <div className="min-w-0 space-y-3">{repairSection}{financeSection}</div>
</div>
<div hidden={activeWorkspace !== "documents"}>{documentsSection}</div>
<div hidden={activeWorkspace !== "history"}>{historySection}</div>
<div hidden={activeWorkspace !== "messages"}>{messagesPlaceholder}</div>
```

Before switching away from `operations`, call `window.confirm` only when charge editing, natural-language staging, payment, refund, handoff cancellation, after-sales, or return-advance input is open.

- [ ] **Step 5: Move the existing history dialog content inline**

Reuse the current `RepairHistoryDialog` body in the history workspace and add the existing audit trail beneath it. The “查看整单历史” action changes the active query tab to `history`; it no longer opens a second overlay.

- [ ] **Step 6: Run unit tests and typecheck**

Run: `pnpm --dir apps/web test:unit && pnpm --dir apps/web typecheck`

Expected: all existing tests and the new tab tests pass.

- [ ] **Step 7: Commit the workspace shell**

```bash
git add apps/web/src/components/orders/formal-business-order-detail.tsx apps/web/src/components/orders/formal-business-order-tabs.tsx apps/web/tests/unit/formal-business-order-tabs.spec.ts
git commit -m 'feat: organize business order detail into workspaces'
```

### Task 3: Add the customer-copy database and snapshot contract

**Files:**
- Create: `drizzle/0024_business_order_customer_copy.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/business-order-document.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/modules/business-order/business-order-document-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-document-service.ts`

**Interfaces:**
- Produces: `CustomerCopyRenderSnapshot`, document kind `customer_copy`, and `BusinessOrderDocumentService.generateCustomerCopy()`.

- [ ] **Step 1: Write failing customer-copy service tests**

Seed a Business Order with one customer-visible note and one internal note, generate the customer copy, then assert:

```ts
expect(document.kind).toBe("customer_copy");
expect(document.documentNo).toMatch(/^CUS-[0-9]{8}-[0-9]{4}$/);
expect(document.snapshot.charges.notes.map((note) => note.kind)).not.toContain("internal");
expect(document.snapshot.charges.items).toHaveLength(3);
```

- [ ] **Step 2: Run the test and verify the missing method failure**

Run: `pnpm vitest run src/modules/business-order/business-order-document-service.integration.test.ts`

Expected: FAIL because `generateCustomerCopy` is missing.

- [ ] **Step 3: Extend the schema and migration**

Add `customer_copy` to the enum and snapshot union. Recreate the two kind-dependent check constraints so `customer_copy` accepts `CUS-YYYYMMDD-NNNN` and has no repair round, while the existing office and mechanic rules remain unchanged.

```sql
alter type business_order_document_kind add value if not exists 'customer_copy';
alter table business_order_document_snapshots drop constraint business_order_document_snapshots_no_kind;
alter table business_order_document_snapshots add constraint business_order_document_snapshots_no_kind check (
  (kind = 'customer_copy' and document_no ~ '^CUS-[0-9]{8}-[0-9]{4}$')
  or (kind = 'office_archive' and document_no ~ '^OFF-[0-9]{8}-[0-9]{4}$')
  or (kind = 'mechanic_work' and document_no ~ '^MEC-[0-9]{8}-[0-9]{4}$')
);
alter table business_order_document_snapshots drop constraint business_order_document_snapshots_source_shape;
alter table business_order_document_snapshots add constraint business_order_document_snapshots_source_shape check (
  (kind in ('customer_copy', 'office_archive') and repair_round_id is null and repair_round_no is null)
  or (kind = 'mechanic_work' and repair_round_id is not null and repair_round_no >= 1)
);
```

- [ ] **Step 4: Implement the immutable customer snapshot**

`generateCustomerCopy` uses current charges and ledger, filters `internal` notes before building the snapshot, sets customer-facing bilingual acceptance text, and allocates the `CUS-` prefix. It uses the same reader/writer, transaction, audit, and retry behavior as the existing generators.

- [ ] **Step 5: Run service and migration verification**

Run: `pnpm vitest run src/modules/business-order/business-order-document-service.integration.test.ts && pnpm typecheck && pnpm test`

Expected: PASS with existing office/mechanic snapshot tests unchanged.

- [ ] **Step 6: Commit the document domain change**

```bash
git add drizzle src/db/schema src/modules/business-order
git commit -m 'feat: add immutable business order customer copy'
```

### Task 4: Expose, render, and operate all three copies

**Files:**
- Modify: `src/app/api/business-orders/[businessOrderId]/documents/route.test.ts`
- Modify: `src/app/api/business-orders/[businessOrderId]/documents/route.ts`
- Modify: `apps/web/src/app/api/formal/business-orders/[businessOrderId]/documents/route.ts`
- Modify: `apps/web/src/lib/api/formal-business-orders.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-print.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Create: `apps/web/tests/unit/formal-business-order-documents.spec.ts`

**Interfaces:**
- Consumes: `generateCustomerCopy()` from Task 3.
- Produces: customer-copy API support, client type support, renderer, and three-copy controls.

- [ ] **Step 1: Write failing route and renderer tests**

Assert POST `{ "kind": "customer_copy" }` invokes `generateCustomerCopy` and returns 201. Render a customer snapshot and assert customer name, charges, totals, and approval are visible while a sentinel internal note is absent.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run 'src/app/api/business-orders/[businessOrderId]/documents/route.test.ts' && pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-business-order-documents.spec.ts`

Expected: FAIL because the route schema and renderer do not recognize `customer_copy`.

- [ ] **Step 3: Extend route and client contracts**

Use `z.enum(["customer_copy", "office_archive", "mechanic_work"])`; dispatch each kind explicitly. Extend `FormalBusinessOrderDocument`, its snapshot union, `formalDocumentKindLabel`, and `generateFormalDocument` with the same literal union.

- [ ] **Step 4: Add the customer print renderer**

Render the customer Business Order facts, itemized charges, customer-visible notes, totals and bilingual acceptance/signature area from the stored snapshot. Never fetch current order data inside the print component.

- [ ] **Step 5: Build the three-copy documents workspace**

Show three cards in the order 客户联、维修工联、办公室留底联, each with its own generate button and concise content contract. Keep the complete historical generated-document list and every existing “打开 / 补打” link.

- [ ] **Step 6: Verify contracts**

Run: `pnpm test && pnpm typecheck && pnpm --dir apps/web test:unit && pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the three-copy UI**

```bash
git add src/app/api apps/web/src/app/api apps/web/src/lib/api apps/web/src/components/orders apps/web/tests/unit
git commit -m 'feat: add three-copy business order workspace'
```

### Task 5: Complete automated and browser regression for the layout

**Files:**
- Modify: `apps/web/tests/e2e/formal-business-order.spec.ts`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/verification/business-order-workspaces/`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: evidence that every original action remains reachable and all three copies work.

- [ ] **Step 1: Add the action-reachability E2E assertions**

For an editable synthetic order, visit each tab and assert every `FORMAL_BUSINESS_ORDER_ACTIONS` marker assigned to that tab is visible when its state/permission prerequisite is seeded. Use separate seeded states for assignment, repair, review, handoff, payment/refund, and documents.

- [ ] **Step 2: Run the complete automated gate**

Run: `pnpm test && pnpm typecheck && pnpm --dir apps/web test:unit && pnpm --dir apps/web typecheck && pnpm --dir apps/web build && git diff --check`

Expected: every command exits 0.

- [ ] **Step 3: Run real-browser acceptance**

At desktop and narrow viewport, verify title facts, progress placement, URL tab restoration, charge editing, repair actions, payment/refund forms, all historical evidence, three document generators, generated previews and supplemental print links. Repeat the read-only view with the owner role.

- [ ] **Step 4: Record the safe result**

Store screenshots and command logs only under the external verification path. Leave the candidate running for user review only when all gates pass; otherwise stop only candidate-owned processes and leave the existing runtime unchanged.
