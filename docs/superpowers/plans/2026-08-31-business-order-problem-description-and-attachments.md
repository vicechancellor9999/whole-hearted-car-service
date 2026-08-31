# Business Order Problem Description and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable original and versioned current/repair-round problem descriptions to formal Business Orders, expose them in creation/detail/list/print flows, and move Business Order attachments into a dedicated fifth workspace tab.

**Architecture:** PostgreSQL remains the only business truth source. New append-only description tables reference the existing Business Order and repair-round records, while current version numbers live on their owners for deterministic reads and optimistic concurrency. Existing Business Order document snapshots freeze the exact description content and version identifiers used at generation time; the attachment service and storage remain unchanged and only their UI workspace moves.

**Tech Stack:** PostgreSQL 18, Drizzle ORM 0.45, TypeScript 5.9, Next.js 16.3 App Router, React 19, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-31-inspection-report-and-problem-description-design.md`

## Global Constraints

- Work only in `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime` on the existing isolated branch; preserve all pre-existing dirty and untracked files.
- PostgreSQL is the only business truth source; localStorage may not store descriptions, versions, permissions, attachments, or document facts.
- The original Business Order problem description is written once at creation, including an explicit empty value, and is never updated.
- Business Order current descriptions and repair-round descriptions are append-only independent version streams.
- Empty descriptions remain valid; charges, notes, repair status, receipts, refunds, handoff, and performance behavior do not change.
- Existing `customer_concern` notes remain intact and are not migrated automatically.
- Existing document snapshots remain readable; newly generated documents freeze exact description version identifiers and content.
- All new UI copy, validation, errors, ARIA labels, placeholders, and notices support Chinese and English.
- Every production behavior follows RED → GREEN → REFACTOR and ships with an automated test that was observed failing first.
- Each commit stages only files belonging to its task; the existing inspection choice-card, PDF-density, print-test, and continuation-note changes remain untouched.

---

### Task 1: Append-only problem-description schema and migration

**Files:**
- Create: `src/db/schema/business-order-problem-description.ts`
- Modify: `src/db/schema/business-order.ts`
- Modify: `src/db/schema/repair-round.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/business-order-problem-description.integration.test.ts`
- Create: `drizzle/0040_business_order_problem_descriptions.sql`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `businessOrderProblemOriginals`, `businessOrderProblemVersions`, `repairRoundProblemVersions` Drizzle tables.
- Produces: `business_orders.current_problem_description_version_no` and `repair_rounds.current_problem_description_version_no`, both non-negative integers defaulting to `0`.
- Produces: source codes `manual`, `creation`, `customer_concern`, `inspection_report`, `ai_suggestion`, and `migration` with optional numeric source references.

- [ ] **Step 1: Write the failing schema integration test**

Add cases that create a Business Order, persist one explicit-empty original row, append BO versions `1` and `2`, append repair-round version `1`, reject duplicate version numbers, reject negative current pointers, and reject updates/deletes of original/version rows through database triggers.

```ts
expect(await database.query(
  `select content_zh, source_type from business_order_problem_originals where business_order_id = $1`,
  [orderId],
)).toEqual([{ content_zh: null, source_type: "creation" }]);
await expect(database.query(
  `update business_order_problem_originals set content_zh = 'changed' where business_order_id = $1`,
  [orderId],
)).rejects.toThrow();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- src/db/schema/business-order-problem-description.integration.test.ts`

Expected: FAIL because the three description tables and owner current-version columns do not exist.

- [ ] **Step 3: Add schema and forward migration**

Define each version row with `contentZh`, `contentEn`, `sourceType`, `sourceReferenceId`, `changeReason`, `createdBy`, and `createdAt`. Enforce `(owner_id, version_no)` uniqueness, positive version numbers, at least one non-empty language for version rows, and paired source-reference rules. Add immutable update/delete triggers using the repository's existing append-only guard pattern. Migration inserts one `creation` original row with null content for every existing active or voided Business Order and leaves both current pointers at `0`.

```ts
export type ProblemDescriptionSource =
  | "creation" | "manual" | "customer_concern"
  | "inspection_report" | "ai_suggestion" | "migration";
```

- [ ] **Step 4: Run schema verification and regression tests**

Run: `pnpm test -- src/db/schema/business-order-problem-description.integration.test.ts src/db/schema/business-order.integration.test.ts src/db/schema/repair-round.integration.test.ts`

Expected: PASS with immutable originals/versions and all existing schema tests green.

- [ ] **Step 5: Commit the schema task**

```bash
git add src/db/schema/business-order-problem-description.ts src/db/schema/business-order.ts src/db/schema/repair-round.ts src/db/schema/index.ts src/db/schema/business-order-problem-description.integration.test.ts drizzle/0040_business_order_problem_descriptions.sql drizzle/meta/_journal.json
git commit -m "feat: add versioned order problem descriptions"
```

### Task 2: Business Order service, API, audit, and migration-safe reads

**Files:**
- Modify: `src/modules/business-order/business-order-schemas.ts`
- Modify: `src/modules/business-order/business-order-service.ts`
- Modify: `src/modules/business-order/business-order-service.integration.test.ts`
- Modify: `src/app/api/business-orders/route.ts`
- Modify: `src/app/api/business-orders/route.test.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/problem-descriptions/route.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/problem-descriptions/route.test.ts`
- Create: `apps/web/src/app/api/formal/business-orders/[businessOrderId]/problem-descriptions/route.ts`
- Modify: `src/app/api/business-orders/[businessOrderId]/route.ts`
- Modify: `src/app/api/business-orders/[businessOrderId]/route.test.ts`

**Interfaces:**
- `createBusinessOrder(input)` accepts `problemDescriptionZh?: string | null` and `problemDescriptionEn?: string | null`.
- `getProblemDescriptionContext({ businessOrderId, viewerAccountId })` returns `{ original, current, currentRound }` snapshots with version/source/person/time metadata.
- `appendProblemDescriptionVersion(input)` accepts scope, optional repair-round ID, expected owner version, content, reason, source, and context; it returns the new context.
- `POST /api/formal/business-orders/:id/problem-descriptions` is the authenticated same-origin append endpoint.

- [ ] **Step 1: Write failing service tests for creation and independent streams**

Test explicit-empty creation, non-empty creation producing BO version `1` and first-round version `1`, later BO edits not modifying the first round, later round edits not changing the BO stream, 409 conflict behavior, and audit summaries containing identifiers/version numbers without copying full customer text.

```ts
const created = await service.createBusinessOrder({
  vehicleId,
  problemDescriptionZh: "发动机故障灯偶发点亮",
  context,
});
const descriptions = await service.getProblemDescriptionContext({
  businessOrderId: created.id,
  viewerAccountId: frontDeskId,
});
expect(descriptions.current?.contentZh).toBe("发动机故障灯偶发点亮");
expect(descriptions.currentRound?.sourceType).toBe("creation");
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `pnpm test -- src/modules/business-order/business-order-service.integration.test.ts`

Expected: FAIL because create/read/append description behavior is missing.

- [ ] **Step 3: Implement service transactions and safe projection**

Within Business Order creation, insert the original row in the same transaction; when content is non-empty, insert BO version `1`, create the first repair round, insert its inherited version `1`, and set both current pointers. Add append methods that lock the owner, verify optimistic version, insert exactly one new version, advance only that owner's pointer/version, and write structured audit metadata.

- [ ] **Step 4: Write route tests and verify RED**

Test POST creation forwards trimmed optional description values, GET detail includes the full context, append requires a session, rejects malformed scope/round ownership, returns 409 with current context, and maps owner/read-only permissions to 403.

Run: `pnpm test -- src/app/api/business-orders/route.test.ts src/app/api/business-orders/[businessOrderId]/route.test.ts src/app/api/business-orders/[businessOrderId]/problem-descriptions/route.test.ts`

Expected: FAIL because the request and response contracts are not wired.

- [ ] **Step 5: Implement route handlers and direct formal re-export**

Parse request bodies with Zod, pass the existing action context/idempotency/request ID, and return stable safe errors. Extend detail assembly with `problemDescriptions` without changing charges, ledger, documents, or capability calculations.

- [ ] **Step 6: Run task verification**

Run: `pnpm test -- src/modules/business-order/business-order-schemas.test.ts src/modules/business-order/business-order-service.integration.test.ts src/app/api/business-orders/route.test.ts src/app/api/business-orders/[businessOrderId]/route.test.ts src/app/api/business-orders/[businessOrderId]/problem-descriptions/route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the service/API task**

```bash
git add src/modules/business-order/business-order-schemas.ts src/modules/business-order/business-order-service.ts src/modules/business-order/business-order-schemas.test.ts src/modules/business-order/business-order-service.integration.test.ts src/app/api/business-orders/route.ts src/app/api/business-orders/route.test.ts src/app/api/business-orders/[businessOrderId]/route.ts src/app/api/business-orders/[businessOrderId]/route.test.ts src/app/api/business-orders/[businessOrderId]/problem-descriptions/route.ts src/app/api/business-orders/[businessOrderId]/problem-descriptions/route.test.ts apps/web/src/app/api/formal/business-orders/[businessOrderId]/problem-descriptions/route.ts
git commit -m "feat: expose order problem description history"
```

### Task 3: High-frequency creation and formal client contract

**Files:**
- Modify: `apps/web/src/lib/api/formal-business-orders.ts`
- Modify: `apps/web/src/components/orders/formal-business-orders-workspace.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-create.spec.ts`
- Create: `apps/web/tests/unit/formal-business-order-problem-description.spec.ts`
- Modify: `apps/web/src/lib/i18n/messages/zh.ts`
- Modify: `apps/web/src/lib/i18n/messages/en.ts`

**Interfaces:**
- `createFormalBusinessOrder` accepts optional `problemDescriptionZh` and `problemDescriptionEn`.
- The create dialog keeps vehicle selection and problem-description input when the server returns a validation/conflict error.

- [ ] **Step 1: Write failing UI/client tests**

Assert the request contains the optional description, empty input sends `null`, the create panel exposes a multiline “问题描述 / Problem description” field after vehicle/payer context, and creation remains enabled when it is empty.

- [ ] **Step 2: Run unit tests and verify RED**

Run: `pnpm --dir apps/web test:unit -- tests/unit/formal-business-order-create.spec.ts tests/unit/formal-business-order-problem-description.spec.ts`

Expected: FAIL because the client payload and input are absent.

- [ ] **Step 3: Implement the optional creation field**

Add a compact multiline input with paste support and bilingual copy. Keep the value in component state until success; send normalized null for whitespace-only input. Do not combine it with charge notes.

- [ ] **Step 4: Run task verification**

Run: `pnpm --dir apps/web test:unit -- tests/unit/formal-business-order-create.spec.ts tests/unit/formal-business-order-problem-description.spec.ts tests/unit/i18n-catalog.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the creation UI task**

```bash
git add apps/web/src/lib/api/formal-business-orders.ts apps/web/src/components/orders/formal-business-orders-workspace.tsx apps/web/tests/unit/formal-business-order-create.spec.ts apps/web/tests/unit/formal-business-order-problem-description.spec.ts apps/web/src/lib/i18n/messages/zh.ts apps/web/src/lib/i18n/messages/en.ts
git commit -m "feat: capture order problem descriptions"
```

### Task 4: Detail presentation and independent editing

**Files:**
- Create: `apps/web/src/components/orders/formal-business-order-problem-description.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/src/lib/api/formal-business-orders.ts`
- Create: `apps/web/tests/unit/formal-business-order-problem-description-ui.spec.ts`

**Interfaces:**
- `FormalBusinessOrderProblemDescription` receives current/original/round snapshots, `canWrite`, and an async refresh callback.
- Editing opens a focused dialog and appends either a BO-level or current-round version; the two actions are never combined implicitly.

- [ ] **Step 1: Write failing presentation tests**

Cover current description prominence, distinct round description only when content/version differs, one-line empty state, original/history drawer, bilingual labels, read-only owner behavior, and separate BO/round save actions.

- [ ] **Step 2: Run unit tests and verify RED**

Run: `pnpm --dir apps/web test:unit -- tests/unit/formal-business-order-problem-description-ui.spec.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the detail component and append client**

Render the context below the order header and above workflow tabs so the reason for the job is visible without scrolling through charges. Use the shared dialog and semantic theme tokens; preserve unsaved input on 409 and offer refresh/retry.

- [ ] **Step 4: Run task verification**

Run: `pnpm --dir apps/web test:unit -- tests/unit/formal-business-order-problem-description-ui.spec.ts tests/unit/formal-business-order-actions-ui.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the detail task**

```bash
git add apps/web/src/components/orders/formal-business-order-problem-description.tsx apps/web/src/components/orders/formal-business-order-detail.tsx apps/web/src/lib/api/formal-business-orders.ts apps/web/tests/unit/formal-business-order-problem-description-ui.spec.ts
git commit -m "feat: show versioned order problem descriptions"
```

### Task 5: Fifth attachment workspace tab

**Files:**
- Create: `apps/web/src/components/orders/formal-business-order-attachments-workspace.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-documents-workspace.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-tabs.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-tabs.spec.ts`
- Modify: `apps/web/tests/unit/formal-business-order-attachments.spec.ts`

**Interfaces:**
- `FormalBusinessOrderWorkspace` adds `attachments` and builds `?tab=attachments`.
- Documents workspace retains only formal document generation, revisions, PDF preview, download, and system print.
- Attachments workspace owns category, caption, choose/drop/paste upload, list, authenticated open, count, and errors.

- [ ] **Step 1: Write failing tab and workspace tests**

Assert five tabs, invalid tabs returning operations, attachments URL preservation, documents markup excluding attachment controls, and attachment workspace retaining choose/drop/paste/category/caption behavior.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --dir apps/web test:unit -- tests/unit/formal-business-order-tabs.spec.ts tests/unit/formal-business-order-attachments.spec.ts`

Expected: FAIL because attachments are still embedded in documents and the fifth tab is absent.

- [ ] **Step 3: Extract and wire the attachment workspace**

Move existing attachment state/handlers/markup without changing the formal attachment API or storage. Add the fifth tab, render its tabpanel, preserve message deep-link behavior, and keep documents free of attachment network calls.

- [ ] **Step 4: Run task verification**

Run: `pnpm --dir apps/web test:unit -- tests/unit/formal-business-order-tabs.spec.ts tests/unit/formal-business-order-attachments.spec.ts tests/unit/formal-print-consumer.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the workspace task**

```bash
git add apps/web/src/components/orders/formal-business-order-attachments-workspace.tsx apps/web/src/components/orders/formal-business-order-documents-workspace.tsx apps/web/src/components/orders/formal-business-order-tabs.tsx apps/web/src/components/orders/formal-business-order-detail.tsx apps/web/tests/unit/formal-business-order-tabs.spec.ts apps/web/tests/unit/formal-business-order-attachments.spec.ts
git commit -m "feat: separate business order attachments workspace"
```

### Task 6: Freeze descriptions into newly generated Business Order documents

**Files:**
- Modify: `src/db/schema/business-order-document.ts`
- Modify: `src/modules/business-order/business-order-document-service.ts`
- Modify: `src/modules/business-order/business-order-document-content.ts`
- Modify: `src/modules/business-order/business-order-document-pdf.ts`
- Modify: `src/modules/business-order/business-order-document-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-document-pdf.test.ts`
- Modify: `apps/web/tests/unit/business-order-document-content.spec.ts`

**Interfaces:**
- New render snapshots use `version: 2` and include immutable `problemDescription` identifiers/content while `version: 1` snapshots stay readable.
- Customer/office documents use the BO original description and add the round description only when different.
- Mechanic documents use the round description as primary and include original BO context when different.

- [ ] **Step 1: Write failing snapshot and PDF tests**

Create literal version-2 fixtures and assert correct customer/office/mechanic field selection, no duplicate identical descriptions, snapshot immutability after later edits, and continued rendering of version-1 fixtures.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- src/modules/business-order/business-order-document-service.integration.test.ts src/modules/business-order/business-order-document-pdf.test.ts`

Expected: FAIL because generated snapshots do not freeze problem-description versions.

- [ ] **Step 3: Implement backward-compatible snapshots and rendering**

Extend the snapshot union rather than mutating version `1`. Generate version `2` from the same transactionally consistent read used for charges/rounds; add editable document fields for the frozen text and render the corresponding A4 section without reading live descriptions later.

- [ ] **Step 4: Run backend and web consumer tests**

Run: `pnpm test -- src/modules/business-order/business-order-document-service.integration.test.ts src/modules/business-order/business-order-document-pdf.test.ts`

Run: `pnpm --dir apps/web test:unit -- tests/unit/business-order-document-content.spec.ts tests/unit/formal-print-consumer.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the document task**

```bash
git add src/db/schema/business-order-document.ts src/modules/business-order/business-order-document-service.ts src/modules/business-order/business-order-document-content.ts src/modules/business-order/business-order-document-pdf.ts src/modules/business-order/business-order-document-service.integration.test.ts src/modules/business-order/business-order-document-pdf.test.ts apps/web/tests/unit/business-order-document-content.spec.ts
git commit -m "feat: freeze problem descriptions in order documents"
```

### Task 7: Deletion graph, full regression, migration, and browser acceptance

**Files:**
- Modify: `src/modules/record-deletion/record-deletion-service.ts`
- Modify: `src/modules/record-deletion/record-deletion-types.ts`
- Modify: `src/modules/record-deletion/record-deletion-service.integration.test.ts`
- Modify: `src/modules/record-deletion/record-deletion-execute.integration.test.ts`
- Modify: `drizzle/0040_business_order_problem_descriptions.sql`
- Create: `apps/web/tests/e2e/business-order-problem-description.spec.ts`
- Modify only after merging the pre-existing edits: `docs/CONTINUATION_ENTRYPOINT.md`

**Interfaces:**
- Record deletion preview counts all three new description tables and authorizes/deletes them in dependency order only when the existing Business Order deletion policy permits the primary deletion.
- The candidate database migration preserves all pre-existing BO/round/document/attachment counts and hashes.

- [ ] **Step 1: Write failing deletion tests**

Assert preview counts original/BO-version/round-version rows, execution deletes authorized rows in reverse dependency order, unrelated descriptions are untouched, and established blockers still reject deletion.

- [ ] **Step 2: Run deletion tests and verify RED**

Run: `pnpm test -- src/modules/record-deletion/record-deletion-service.integration.test.ts src/modules/record-deletion/record-deletion-execute.integration.test.ts`

Expected: FAIL because the new tables are absent from the deletion graph/authorization whitelist.

- [ ] **Step 3: Extend deletion graph and migration whitelist**

Add exact table/row identifiers and deletion order for round versions, BO versions, then original snapshot. Preserve all existing blocker logic and audit behavior.

- [ ] **Step 4: Back up and migrate the candidate runtime**

Create a timestamped backup under `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime/backups/`, record SHA-256, table counts, row counts, and stored-file hashes, stop candidate writes, apply migration `0040`, then verify pre/post counts plus one original description row per existing Business Order.

- [ ] **Step 5: Run complete automated verification**

Run: `pnpm test`

Run: `pnpm --dir apps/web test:unit`

Run: `pnpm typecheck`

Run: `pnpm typecheck:web`

Run: `pnpm lint`

Run: `pnpm build`

Run: `git diff --check`

Expected: all commands exit `0`; only the repository's previously documented warning may remain.

- [ ] **Step 6: Run production-browser acceptance**

Start the candidate with `pnpm start:candidate`. In Chinese and English, soft-light and comfortable-dark themes, desktop and 430px viewport, verify: create with empty/non-empty description; list summary; prominent detail context; independent BO/round edits; refresh/relogin/restart persistence; five tabs; attachments upload/drop/paste/open; documents no longer showing attachments; old and new PDFs preview/download/print; no horizontal overflow or console errors.

- [ ] **Step 7: Update handoff and commit acceptance evidence**

Carefully merge a new dated section into the already modified `docs/CONTINUATION_ENTRYPOINT.md`, retaining its pre-existing inspection-choice and PDF-density notes byte-for-byte. Record commits, migration/backup hashes, commands, counts, browser URLs, screenshots, and any remaining blockers.

```bash
git add src/modules/record-deletion/record-deletion-service.ts src/modules/record-deletion/record-deletion-types.ts src/modules/record-deletion/record-deletion-service.integration.test.ts src/modules/record-deletion/record-deletion-execute.integration.test.ts drizzle/0040_business_order_problem_descriptions.sql apps/web/tests/e2e/business-order-problem-description.spec.ts docs/CONTINUATION_ENTRYPOINT.md
git commit -m "test: verify order problem description delivery"
```

## Self-review

- Spec coverage: this plan implements specification phase 1, including BO original/current/round descriptions, creation, detail/list context, formal document freezing, the fifth attachments tab, audit, deletion, migration, bilingual UI, themes, responsive acceptance, backup, and rollback evidence.
- Deferred by design to the next independent plan: the expanded Inspection Report schema, AI runs/dialogue, report quotes, report A4 files, follow-up cycles, and BO adoption transactions. This slice provides the versioned BO description targets those subsystems will consume.
- Completeness scan: every task names concrete files, behavior, failure expectation, implementation boundary, verification command, and commit scope.
- Type consistency: create/read/append contracts use the same optional bilingual content, source codes, version identifiers, optimistic owner version, and `problemDescriptions` detail projection across service, route, client, and UI tasks.
