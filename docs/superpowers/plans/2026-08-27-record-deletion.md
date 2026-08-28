# Whole Hearted Record Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe permanent deletion for eligible customer, vehicle, Business Order, and draft inspection records, available to front-desk and super-admin accounts.

**Architecture:** A formal-backend deletion service builds and revalidates an explicit dependency graph under database locks. A reusable Web dialog consumes preview and execute APIs, while PostgreSQL receipts provide idempotency, audit events preserve non-PII evidence, and an outbox removes orphaned files after commit.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Drizzle schema/SQL migrations, PostgreSQL/PGlite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-record-deletion-design.md`

## Global Constraints

- UI actions are named `删除`, `删除客户档案`, `删除车辆档案`, `删除业务单`, `删除检查单`, and `确认删除`.
- `record.delete` is allowed for `super_admin` and `front_desk`; no second approval is required.
- Eligibility is computed and enforced by the formal backend, never by browser-only logic.
- Existing foreign keys remain `onDelete: restrict`; deletion uses an explicit reverse dependency order.
- A selected primary record is never added silently; all primary records appear in the preview and are explicitly selected.
- The operation is all-or-nothing and revalidates under locks before mutation.
- Audit payloads contain no names, phones, TRNs, plates, VINs, addresses, documents, images, or complete prior rows.
- The first release has no arbitrary bulk-delete selection.
- Before changing Next.js route handlers or client components, read `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`.
- Stage and commit only task-owned files because the worktree contains preserved changes from the preceding AI-service feature.

---

### Task 1: Permission and shared deletion contracts

**Files:**
- Modify: `src/modules/permissions/permissions.ts`
- Modify: `src/modules/permissions/permissions.test.ts`
- Create: `src/modules/record-deletion/record-deletion-types.ts`
- Test: `src/modules/record-deletion/record-deletion-types.test.ts`

**Interfaces:**
- Produces: `Permission` member `record.delete`.
- Produces: `RecordKind`, `RecordReference`, `DeletionReasonCode`, `DeletionBlocker`, `RecordDeletionPreview`, `RecordDeletionExecuteInput`, and `RecordDeletionResult`.
- Produces: `parseDeletionPreviewInput(value)` and `parseDeletionExecuteInput(value)` with normalized public record numbers and bounded text.

- [ ] **Step 1: Write failing permission and parser tests**

```ts
expect(hasPermission("super_admin", "record.delete")).toBe(true);
expect(hasPermission("front_desk", "record.delete")).toBe(true);
expect(hasPermission("owner", "record.delete")).toBe(false);
expect(hasPermission("mechanic", "record.delete")).toBe(false);

expect(parseDeletionExecuteInput({
  root: { kind: "vehicle", recordNo: " VEH-202608-0004 " },
  selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
  reasonCode: "test_data",
  reasonNote: null,
  confirmationRecordNo: "VEH-202608-0004",
  previewFingerprint: "a".repeat(64),
  requestId: "delete-123",
}).root.recordNo).toBe("VEH-202608-0004");
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run src/modules/permissions/permissions.test.ts src/modules/record-deletion/record-deletion-types.test.ts`  
Expected: FAIL because `record.delete` and parser exports do not exist.

- [ ] **Step 3: Add the explicit permission and contracts**

```ts
export type RecordKind =
  | "personal_customer" | "company_customer" | "vehicle"
  | "business_order" | "inspection_report";
export type DeletionReasonCode = "duplicate" | "input_error" | "test_data" | "other";
export type RecordReference = { kind: RecordKind; recordNo: string; version: number };
export type DeletionBlocker = {
  code: string;
  label: string;
  linkedRecord: Pick<RecordReference, "kind" | "recordNo"> | null;
};
```

Use Zod to reject duplicate selected records, require `reasonNote` for `other`, cap notes at 1,000 characters, require a 64-character lowercase hex fingerprint, and require exact confirmation after NFKC trim.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm exec vitest run src/modules/permissions/permissions.test.ts src/modules/record-deletion/record-deletion-types.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit task-owned files**

```bash
git add src/modules/permissions/permissions.ts src/modules/permissions/permissions.test.ts src/modules/record-deletion/record-deletion-types.ts src/modules/record-deletion/record-deletion-types.test.ts
git commit -m "feat: define record deletion permission and contracts"
```

### Task 2: Idempotency receipt and file-cleanup outbox

**Files:**
- Create: `src/db/schema/record-deletion.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0027_record_deletion_runtime.sql`
- Create: `src/db/schema/record-deletion.integration.test.ts`

**Interfaces:**
- Produces table `record_deletion_receipts(request_id, actor_account_id, payload_hash, root_kind, root_record_no, reason_code, result, created_at)`.
- Produces table `record_deletion_file_tasks(id, storage_key, state, attempt_count, last_error_code, created_at, completed_at)`.
- Both tables reference staff accounts with `on delete restrict`; storage keys are unique among incomplete tasks.

- [ ] **Step 1: Write a failing migration integration test**

```ts
await database.exec(migrationSql);
await database.query(`insert into record_deletion_receipts
  (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
   reason_code, result) values ('req-1', $1, $2, 'vehicle',
   'VEH-202608-0004', 'test_data', '{}'::jsonb)`, [accountId, "a".repeat(64)]);
await expect(database.query(`insert into record_deletion_receipts
  (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
   reason_code, result) values ('req-1', $1, $2, 'vehicle',
   'VEH-202608-0004', 'test_data', '{}'::jsonb)`, [accountId, "a".repeat(64)]))
  .rejects.toThrow();
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `pnpm exec vitest run src/db/schema/record-deletion.integration.test.ts`  
Expected: FAIL because migration/table exports do not exist.

- [ ] **Step 3: Add schema and SQL migration**

```sql
create table record_deletion_receipts (
  request_id text primary key,
  actor_account_id bigint not null references staff_accounts(id) on delete restrict,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  root_kind text not null,
  root_record_no text not null,
  reason_code text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
```

Add checked values for record kinds, reason codes, outbox states (`pending`, `failed`, `completed`), nonnegative attempt counts, and complete timestamps.

- [ ] **Step 4: Run schema tests and migration smoke test**

Run: `pnpm exec vitest run src/db/schema/record-deletion.integration.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit task-owned files**

```bash
git add src/db/schema/record-deletion.ts src/db/schema/index.ts drizzle/0027_record_deletion_runtime.sql src/db/schema/record-deletion.integration.test.ts
git commit -m "feat: persist record deletion receipts and file tasks"
```

### Task 3: Pure dependency policy

**Files:**
- Create: `src/modules/record-deletion/record-deletion-policy.ts`
- Test: `src/modules/record-deletion/record-deletion-policy.test.ts`

**Interfaces:**
- Consumes: contracts from Task 1.
- Produces: `DeletionFacts` with explicit counts/flags for all schema references.
- Produces: `evaluateDeletionGraph(root, selectedRecords, facts): RecordDeletionPreview`.
- Produces stable `previewFingerprint` from sorted record references, versions, blockers, and dependent counts.

- [ ] **Step 1: Write failing table-driven policy tests**

```ts
it.each([
  ["vehicle business order", vehicleFacts({ businessOrderCount: 1 }), "HAS_BUSINESS_ORDER"],
  ["submitted inspection", inspectionFacts({ status: "submitted" }), "INSPECTION_SUBMITTED"],
  ["paid order", orderFacts({ paymentCount: 1 }), "HAS_PAYMENT"],
  ["assigned order", orderFacts({ status: "assigned" }), "ORDER_PROGRESS_STARTED"],
])("blocks %s", (_name, facts, code) => {
  expect(evaluateDeletionGraph(facts.root, [facts.root], facts).blockers)
    .toContainEqual(expect.objectContaining({ code }));
});
```

Also test eligible customer plus explicitly selected eligible vehicle, rejected silent expansion, a draft inspection linked to a selected order, stable sorting, and fingerprint changes when any version/count changes.

- [ ] **Step 2: Run policy tests and verify RED**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-policy.test.ts`  
Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement explicit policy maps**

```ts
const blockersByKind: Record<RecordKind, (facts: RecordFacts) => DeletionBlocker[]> = {
  personal_customer: customerBlockers,
  company_customer: customerBlockers,
  vehicle: vehicleBlockers,
  business_order: businessOrderBlockers,
  inspection_report: inspectionBlockers,
};
```

Treat selected eligible linked primary records as part of the graph, but block every unselected primary reference. A Business Order may contain its initial charge versions/notes and exactly one untouched initial repair round. A draft inspection may contain findings and one unshared paper file. Do not infer test status from names.

- [ ] **Step 4: Run policy tests and verify GREEN**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-policy.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit task-owned files**

```bash
git add src/modules/record-deletion/record-deletion-policy.ts src/modules/record-deletion/record-deletion-policy.test.ts
git commit -m "feat: evaluate record deletion eligibility"
```

### Task 4: Database-backed preview service

**Files:**
- Create: `src/modules/record-deletion/record-deletion-service.ts`
- Create: `src/modules/record-deletion/record-deletion-errors.ts`
- Create: `src/modules/record-deletion/record-deletion-runtime.ts`
- Test: `src/modules/record-deletion/record-deletion-service.integration.test.ts`

**Interfaces:**
- Consumes: `evaluateDeletionGraph` from Task 3 and `AuthSqlDatabase`.
- Produces: `RecordDeletionService.preview(input: { root: RecordReferenceInput; selectedRecords?: RecordReferenceInput[]; actorAccountId: number }): Promise<RecordDeletionPreview>`.
- Produces errors with codes/status: `RECORD_DELETE_DENIED/403`, `RECORD_NOT_FOUND/404`, `RECORD_DELETE_BLOCKED/409`, `DELETION_PREVIEW_STALE/409`, `DELETION_REQUEST_CONFLICT/409`.

- [ ] **Step 1: Write failing PGlite preview tests**

```ts
await expect(service.preview({
  root: { kind: "vehicle", recordNo: eligibleVehicleNo },
  actorAccountId: frontDeskId,
})).resolves.toMatchObject({ eligible: true, rootRecord: { recordNo: eligibleVehicleNo } });

await expect(service.preview({
  root: { kind: "vehicle", recordNo: vehicleWithOrderNo },
  actorAccountId: frontDeskId,
})).resolves.toMatchObject({
  eligible: false,
  blockers: [expect.objectContaining({ code: "HAS_BUSINESS_ORDER" })],
});
```

Cover personal/company customers, contacts, license files, vehicles, disputes, orders, rounds/events, inspections/corrections/communications, payments/refunds/receipts, documents, handoffs, pickup notices, and owner denial.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-service.integration.test.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement batched reference queries**

```ts
export class RecordDeletionService {
  constructor(private readonly database: AuthSqlDatabase) {}
  async preview(input: PreviewDeletionInput): Promise<RecordDeletionPreview> {
    await requireRecordDeletePermission(this.database, input.actorAccountId);
    const graph = await loadDeletionFacts(this.database, input.root, input.selectedRecords ?? []);
    return evaluateDeletionGraph(graph.root, graph.selectedRecords, graph);
  }
}
```

Resolve public numbers to internal IDs once, query counts in bounded batches, and return public record numbers only. Never return customer PII in blocker payloads.

- [ ] **Step 4: Run integration tests and typecheck**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-service.integration.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit task-owned files**

```bash
git add src/modules/record-deletion/record-deletion-service.ts src/modules/record-deletion/record-deletion-errors.ts src/modules/record-deletion/record-deletion-runtime.ts src/modules/record-deletion/record-deletion-service.integration.test.ts
git commit -m "feat: preview record deletion dependencies"
```

### Task 5: Transactional execute and file cleanup

**Files:**
- Modify: `src/modules/record-deletion/record-deletion-service.ts`
- Create: `src/modules/record-deletion/record-deletion-file-cleanup.ts`
- Test: `src/modules/record-deletion/record-deletion-execute.integration.test.ts`
- Test: `src/modules/record-deletion/record-deletion-file-cleanup.test.ts`

**Interfaces:**
- Produces: `RecordDeletionService.execute(input: RecordDeletionExecuteInput & ActionContext): Promise<RecordDeletionResult>`.
- Produces: `processRecordDeletionFileTasks(database, options?): Promise<{ completed: number; failed: number }>`.

- [ ] **Step 1: Write failing execute and idempotency tests**

```ts
const first = await service.execute(executeInput);
const replay = await service.execute(executeInput);
expect(replay).toEqual(first);
expect(await rowCount("vehicles", vehicleId)).toBe(0);
expect(await auditPayload(requestId)).not.toMatch(/name|phone|trn|plate|vin|address/i);

await service.preview(input);
await addBlockingBusinessOrder(vehicleId);
await expect(service.execute(executeInput)).rejects.toMatchObject({
  code: "DELETION_PREVIEW_STALE", status: 409,
});
```

Test reverse-order deletion, all-or-nothing rollback, payload-hash conflict, unique phone/TRN/plate/VIN release, shared-file retention, file-task retry, and duplicate-click replay.

- [ ] **Step 2: Run execute tests and verify RED**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-execute.integration.test.ts src/modules/record-deletion/record-deletion-file-cleanup.test.ts`  
Expected: FAIL because execute/cleanup functions do not exist.

- [ ] **Step 3: Implement locked revalidation and explicit reverse deletes**

```ts
return this.database.transaction(async (tx) => {
  const prior = await findReceiptForUpdate(tx, input.requestId);
  if (prior) return replayOrConflict(prior, stablePayloadHash(input));
  const lockedFacts = await loadDeletionFacts(tx, input.root, input.selectedRecords, { lock: true });
  const preview = evaluateDeletionGraph(lockedFacts.root, lockedFacts.selectedRecords, lockedFacts);
  assertExecutablePreview(input, preview);
  const result = await deleteGraphInReverseOrder(tx, lockedFacts, input);
  await insertDeletionAudit(tx, input, result);
  await insertReceipt(tx, input, result);
  return result;
});
```

Delete only known dependent rows. Insert file outbox rows before deleting `stored_files`. After commit, trigger `processRecordDeletionFileTasks` using Next `after()` at the route layer; the processor must also be callable directly in tests and retry pending/failed tasks safely.

- [ ] **Step 4: Run execute tests and verify GREEN**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-execute.integration.test.ts src/modules/record-deletion/record-deletion-file-cleanup.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit task-owned files**

```bash
git add src/modules/record-deletion/record-deletion-service.ts src/modules/record-deletion/record-deletion-file-cleanup.ts src/modules/record-deletion/record-deletion-execute.integration.test.ts src/modules/record-deletion/record-deletion-file-cleanup.test.ts
git commit -m "feat: execute record deletion atomically"
```

### Task 6: Formal APIs and Web proxy boundary

**Files:**
- Create: `src/app/api/record-deletions/preview/route.ts`
- Create: `src/app/api/record-deletions/preview/route.test.ts`
- Create: `src/app/api/record-deletions/execute/route.ts`
- Create: `src/app/api/record-deletions/execute/route.test.ts`
- Create: `apps/web/src/app/api/formal/record-deletions/preview/route.ts`
- Create: `apps/web/src/app/api/formal/record-deletions/execute/route.ts`

**Interfaces:**
- Consumes: service/runtime from Tasks 4-5.
- Produces JSON endpoints from the spec with sanitized `{ error, code, blockers?, requestId }` failures.

- [ ] **Step 1: Read repository-local Next.js route and `after()` documentation**

Run: `sed -n '1,260p' apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md && sed -n '1,260p' apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`  
Expected: route handlers and `after()` behavior are understood from the installed Next.js version.

- [ ] **Step 2: Write failing route tests**

```ts
expect((await previewHandler(authorizedRequest)).status).toBe(200);
expect((await previewHandler(ownerRequest)).status).toBe(403);
expect((await executeHandler(staleRequest)).status).toBe(409);
expect(await executeResponse.json()).toMatchObject({
  deletedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
});
```

- [ ] **Step 3: Run route tests and verify RED**

Run: `pnpm exec vitest run src/app/api/record-deletions/preview/route.test.ts src/app/api/record-deletions/execute/route.test.ts`  
Expected: FAIL because routes do not exist.

- [ ] **Step 4: Implement injectable handlers and thin Web exports**

```ts
export { POST } from "@formal/app/api/record-deletions/preview/route";
```

The execute route schedules bounded outbox draining with installed Next.js `after()`, closes runtime resources in the deferred callback, and never includes stack traces or database details in responses.

- [ ] **Step 5: Run route tests and typechecks**

Run: `pnpm exec vitest run src/app/api/record-deletions/preview/route.test.ts src/app/api/record-deletions/execute/route.test.ts && pnpm typecheck && pnpm typecheck:web`  
Expected: PASS.

- [ ] **Step 6: Commit task-owned files**

```bash
git add src/app/api/record-deletions apps/web/src/app/api/formal/record-deletions
git commit -m "feat: expose formal record deletion APIs"
```

### Task 7: Reusable deletion client and dialog

**Files:**
- Create: `apps/web/src/lib/api/formal-record-deletions.ts`
- Create: `apps/web/src/components/shared/record-delete-dialog.tsx`
- Test: `apps/web/tests/unit/formal-record-deletions.spec.ts`
- Test: `apps/web/tests/unit/record-delete-dialog.spec.tsx`

**Interfaces:**
- Produces: `previewFormalRecordDeletion`, `executeFormalRecordDeletion`.
- Produces: `<RecordDeleteButton record={{ kind, recordNo, version }} title="删除车辆档案" returnTo="/vehicles" />`.
- The component reads `/api/formal/auth/session` and renders only for `super_admin` or `front_desk`.

- [ ] **Step 1: Read installed Next.js client/server guidance**

Run: `sed -n '1,260p' apps/web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`  
Expected: client component boundaries match the installed version.

- [ ] **Step 2: Write failing client and dialog tests**

```tsx
render(<RecordDeleteButton
  record={{ kind: "vehicle", recordNo: "VEH-202608-0004", version: 1 }}
  title="删除车辆档案"
  returnTo="/vehicles"
/>);
await user.click(await screen.findByRole("button", { name: "删除" }));
expect(await screen.findByRole("dialog", { name: "删除车辆档案" })).toBeVisible();
expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();
```

Cover blocked preview, linked-primary checkboxes, reason choices, required note for `其他`, exact record-number confirmation, busy state, stale preview refresh, and success redirect.

- [ ] **Step 3: Run Web unit tests and verify RED**

Run: `pnpm --dir apps/web exec vitest run tests/unit/formal-record-deletions.spec.ts tests/unit/record-delete-dialog.spec.tsx`  
Expected: FAIL because client/component modules do not exist.

- [ ] **Step 4: Implement the accessible two-step dialog**

```tsx
<button type="button" onClick={openPreview}>删除</button>
<div role="dialog" aria-modal="true" aria-label={title}>
  {preview.eligible ? <DeletionConfirmationForm /> : <DeletionBlockerList />}
</div>
```

Use semantic labels, focus restoration, Escape/backdrop close when idle, `role="alert"` for failures, and no customer PII in the preview UI. The button must remain hidden until the formal session role is known and allowed.

- [ ] **Step 5: Run Web unit tests and typecheck**

Run: `pnpm --dir apps/web exec vitest run tests/unit/formal-record-deletions.spec.ts tests/unit/record-delete-dialog.spec.tsx && pnpm typecheck:web`  
Expected: PASS.

- [ ] **Step 6: Commit task-owned files**

```bash
git add apps/web/src/lib/api/formal-record-deletions.ts apps/web/src/components/shared/record-delete-dialog.tsx apps/web/tests/unit/formal-record-deletions.spec.ts apps/web/tests/unit/record-delete-dialog.spec.tsx
git commit -m "feat: add record deletion confirmation dialog"
```

### Task 8: Add delete entry points to four detail views

**Files:**
- Modify: `apps/web/src/components/customers/customer-detail-page.tsx`
- Modify: `apps/web/src/components/customers/vehicle-detail-page.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/src/components/orders/formal-inspection-report-detail.tsx`
- Test: `apps/web/tests/unit/record-deletion-entry-points.spec.tsx`

**Interfaces:**
- Consumes: `RecordDeleteButton` from Task 7.
- Produces one `删除` entry per formal detail view with correct kind, public number, version, title, and return route.

- [ ] **Step 1: Write failing entry-point tests**

```tsx
expect(renderedCustomer).toContain('title="删除客户档案"');
expect(renderedVehicle).toContain('title="删除车辆档案"');
expect(renderedOrder).toContain('title="删除业务单"');
expect(renderedInspection).toContain('title="删除检查单"');
```

- [ ] **Step 2: Run entry-point test and verify RED**

Run: `pnpm --dir apps/web exec vitest run tests/unit/record-deletion-entry-points.spec.tsx`  
Expected: FAIL because detail views have no delete entry.

- [ ] **Step 3: Wire the shared control into each header action area**

```tsx
<RecordDeleteButton
  record={{ kind: "business_order", recordNo: order.orderNo, version: order.version }}
  title="删除业务单"
  returnTo="/orders/business"
/>
```

Customer and vehicle entry points render only in formal API mode. Keep existing edit/status actions and use a compact secondary destructive style, with the confirmation dialog carrying the primary danger emphasis.

- [ ] **Step 4: Run entry-point and existing focused component tests**

Run: `pnpm --dir apps/web exec vitest run tests/unit/record-deletion-entry-points.spec.tsx tests/unit/formal-business-order-actions-ui.spec.ts tests/unit/formal-inspections.spec.ts tests/unit/formal-customer-vehicle-consumer.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit task-owned files**

```bash
git add apps/web/src/components/customers/customer-detail-page.tsx apps/web/src/components/customers/vehicle-detail-page.tsx apps/web/src/components/orders/formal-business-order-detail.tsx apps/web/src/components/orders/formal-inspection-report-detail.tsx apps/web/tests/unit/record-deletion-entry-points.spec.tsx
git commit -m "feat: add delete actions to formal record details"
```

### Task 9: End-to-end acceptance and full verification

**Files:**
- Create: `apps/web/tests/e2e/record-deletion.spec.ts`
- Create: `docs/acceptance/record-deletion.md`

**Interfaces:**
- Produces repeatable browser acceptance for allowed, blocked, replayed, and responsive flows.

- [ ] **Step 1: Write failing E2E scenarios against isolated data**

```ts
test("front desk deletes an eligible vehicle and refresh keeps it absent", async ({ page }) => {
  await loginAsFrontDesk(page);
  const vehicleNo = await createEligibleVehicle(page);
  await page.goto(`/vehicles/${vehicleNo}`);
  await page.getByRole("button", { name: "删除" }).click();
  await page.getByLabel("删除原因").selectOption("test_data");
  await page.getByLabel("输入档案编号确认").fill(vehicleNo);
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/vehicles/);
  await page.reload();
  await expect(page.getByText(vehicleNo)).toHaveCount(0);
});
```

Add customer-plus-vehicle selection, blocked order, draft inspection success, submitted inspection block, owner hidden action, duplicate submit, mobile 390×844, and no horizontal overflow.

- [ ] **Step 2: Run E2E and verify RED before final UI fixes**

Run: `pnpm --dir apps/web exec playwright test tests/e2e/record-deletion.spec.ts`  
Expected: At least one scenario fails before final fixture/UI adjustments.

- [ ] **Step 3: Make only acceptance-driven fixes and write the checklist**

Document exact URLs, roles, fixture numbers, expected blocker codes, refresh/re-login persistence, released unique identifiers, audit query, and file-task status query in `docs/acceptance/record-deletion.md`.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm exec vitest run src/modules/record-deletion src/app/api/record-deletions src/modules/permissions/permissions.test.ts
pnpm --dir apps/web exec vitest run tests/unit/formal-record-deletions.spec.ts tests/unit/record-delete-dialog.spec.tsx tests/unit/record-deletion-entry-points.spec.tsx
pnpm --dir apps/web exec playwright test tests/e2e/record-deletion.spec.ts
pnpm test
pnpm test:web:unit
pnpm test:web:collaboration
pnpm typecheck
pnpm typecheck:web
pnpm build
git diff --check
```

Expected: all commands pass. If repository-wide lint still reports the documented pre-existing baseline, run ESLint on task-owned source files and report both results without treating baseline debt as task success.

- [ ] **Step 5: Inspect the actual 3220 candidate only after production rebuild/restart**

Verify listener identity, `/login` HTTP 200, authenticated detail pages, delete preview, blocked flow, successful deletion of newly created disposable records, refresh persistence, and mobile layout. Do not operate on pre-existing user records.

- [ ] **Step 6: Commit task-owned acceptance files**

```bash
git add apps/web/tests/e2e/record-deletion.spec.ts docs/acceptance/record-deletion.md
git commit -m "test: verify formal record deletion flows"
```

## Completion Gate

- Every checkbox above is complete.
- The four detail views use the exact accepted UI names.
- Front desk and super admin both pass API and browser acceptance.
- Blocked records remain unchanged after direct API attempts.
- Idempotency, stale previews, transaction rollback, unique identifier release, audit redaction, and file retry all have automated evidence.
- Candidate service and isolated database are healthy after a fresh production build.
- No production/3210/3211 data was read for mutation or deleted during implementation.
