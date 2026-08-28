# Editable A4 Business Order Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the embedded application-page imitation with revisioned, editable, true-A4 Business Order documents whose preview, download and system print all use the same stored PDF bytes.

**Architecture:** Immutable business snapshots remain the source facts. A new append-only revision layer stores validated text overrides and a protected `stored_files` PDF reference; a shared pure content model feeds both the A4 editor and a server-side pdf-lib renderer. The workspace fetches stored PDF bytes into the existing canvas preview and uses the same bytes for download and system print.

**Tech Stack:** PostgreSQL 18, Drizzle ORM 0.45, Next.js 16.3 route handlers, React 19.2, pdf-lib, @pdf-lib/fontkit, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-editable-a4-business-order-documents-design.md`

## Global Constraints

- Paper is exactly `210mm × 297mm` with 10 mm printable margins.
- `business_order_document_snapshots` remains immutable.
- Revisions are append-only and concurrency-controlled by `expectedLatestRevisionNo`.
- All submitted values are plain text; one field is at most 4,000 characters and all overrides at most 100,000 characters.
- Every PDF is `application/pdf`, begins `%PDF-`, uses A4 MediaBox, and is stored under `UPLOAD_ROOT`.
- Preview, inline open, attachment download and system print read the same `file_id` bytes.
- Existing documents are backfilled explicitly before switching the runtime; GET requests never write.
- Existing `.next-e2e` output is excluded from commits.

---

### Task 1: Revision Schema and Protected File Relation

**Files:**
- Create: `drizzle/0035_business_order_document_revisions.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/business-order-document.ts`
- Modify: `src/db/schema/business-order-document.integration.test.ts`
- Modify: `src/db/schema/record-deletion.ts`

**Interfaces:**
- Produces: `businessOrderDocumentRevisions`
- Produces unique key `(document_snapshot_id, revision_no)` and `file_id -> stored_files(id)`.

- [ ] **Step 1: Write failing schema tests**

Test revision numbering, append-only update/delete rejection, JSON object validation, PDF file FK, and record-deletion table allowlist membership.

- [ ] **Step 2: Run the schema tests and verify failure**

Run: `pnpm exec vitest run src/db/schema/business-order-document.integration.test.ts`

- [ ] **Step 3: Add migration and Drizzle schema**

Create the table with `revision_no >= 1`, `renderer_version` nonempty, 64-character lowercase SHA-256, JSON object check, generated/creator timestamps, indexes by snapshot/revision and file, plus the existing append-only trigger function.

- [ ] **Step 4: Run schema tests**

Run: `pnpm exec vitest run src/db/schema/business-order-document.integration.test.ts`

Expected: PASS.

### Task 2: Stable Editable Content Model

**Files:**
- Create: `apps/web/src/lib/orders/business-order-document-content.ts`
- Create: `apps/web/tests/unit/business-order-document-content.spec.ts`

**Interfaces:**
- Produces: `buildBusinessOrderDocumentContent(snapshot): BusinessOrderDocumentContent`
- Produces: `editableTextFields(content): EditableTextField[]`
- Produces: `applyDocumentOverrides(content, overrides): BusinessOrderDocumentContent`
- Produces: `validateDocumentOverrides(snapshot, input): Record<string, string>`

- [ ] **Step 1: Write failing tests for all three document kinds**

Assert stable keys such as `header.title`, `facts.payer.value`, `charges.items.0.nameZh`, `notes.0.contentZh`, and `footer.left`; reject unknown keys, non-string values, control characters, more than 4,000 characters per field, and more than 100,000 total characters.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --dir apps/web exec vitest run tests/unit/business-order-document-content.spec.ts`

- [ ] **Step 3: Implement immutable content construction and validation**

Use explicit builders per union kind rather than arbitrary object-path traversal. Preserve values as strings and clone before applying overrides.

- [ ] **Step 4: Run and verify PASS**

Run: `pnpm --dir apps/web exec vitest run tests/unit/business-order-document-content.spec.ts`

### Task 3: Deterministic A4 PDF Renderer

**Files:**
- Create: `apps/web/src/lib/orders/business-order-document-pdf.ts`
- Create: `apps/web/tests/unit/business-order-document-pdf.spec.ts`
- Reuse: `apps/web/src/lib/orders/pdf-shared.ts`
- Reuse: `apps/web/public/fonts/NotoSansSC-Regular-wh.ttf`

**Interfaces:**
- Produces: `renderBusinessOrderDocumentPdf(input): Promise<Uint8Array>`
- Input includes `documentNo`, `revisionNo`, `kind`, frozen `snapshot`, validated `fieldOverrides`, `generatedAt`.

- [ ] **Step 1: Write failing PDF tests**

For all three kinds assert `%PDF-`, A4 page dimensions `595.28 × 841.89` points within 0.1, embedded font, page count, required content, mechanic-work privacy boundary, and deterministic SHA-256 for identical input.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --dir apps/web exec vitest run tests/unit/business-order-document-pdf.spec.ts`

- [ ] **Step 3: Implement renderer**

Use `pdf-lib` plus `@pdf-lib/fontkit`; reserve 28.35 points for each 10 mm margin; paginate before section and table-row overflow; draw page number after content; never read live business state.

- [ ] **Step 4: Run and verify PASS**

Run: `pnpm --dir apps/web exec vitest run tests/unit/business-order-document-pdf.spec.ts`

### Task 4: Atomic PDF Storage and Revision Service

**Files:**
- Create: `src/modules/business-order/business-order-document-storage.ts`
- Create: `src/modules/business-order/business-order-document-revision-service.ts`
- Create: `src/modules/business-order/business-order-document-revision-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-document-service.ts`

**Interfaces:**
- Produces: `stageBusinessOrderDocumentPdf(bytes, fileName): Promise<StagedDocumentPdf>`
- Produces: `createRevision({ businessOrderId, documentId, expectedLatestRevisionNo, fieldOverrides, context }): Promise<DocumentRevisionDetail>`
- Produces: `getRevisionFile({ businessOrderId, documentId, revisionId, viewerAccountId }): Promise<StoredDocumentPdf>`

- [ ] **Step 1: Write failing service tests**

Cover first revision, next revision, 409 concurrency conflict, invalid keys, auth, audit payload, stored-file metadata, PDF hash equality, database failure cleanup, and document/order/revision ownership checks.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run src/modules/business-order/business-order-document-revision-service.integration.test.ts`

- [ ] **Step 3: Implement storage staging**

Write to a temporary sibling path, fsync/close, rename to the final document directory, calculate SHA-256 from final bytes, and expose a cleanup function. Do not accept browser paths or hashes.

- [ ] **Step 4: Implement transaction and audit**

Lock the snapshot’s revision rows, compare the latest number, validate overrides, render/stage PDF, insert `stored_files`, insert revision, write `business_order.document_revision_created`, commit, then retain the file; on any failure remove the staged/final orphan.

- [ ] **Step 5: Make new document generation create revision 1**

The document-generation transaction must create the immutable snapshot and initial PDF revision as one user-visible action. Return `latestRevisionNo: 1`.

- [ ] **Step 6: Run service tests and commit**

Run: `pnpm exec vitest run src/modules/business-order/business-order-document-service.integration.test.ts src/modules/business-order/business-order-document-revision-service.integration.test.ts`

### Task 5: Revision and File APIs

**Files:**
- Modify: `src/app/api/business-orders/[businessOrderId]/documents/[documentId]/route.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/documents/[documentId]/revisions/route.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/documents/[documentId]/revisions/[revisionId]/file/route.ts`
- Create matching `route.test.ts` files.
- Create web proxy re-export routes under `apps/web/src/app/api/formal/business-orders/...`.

**Interfaces:**
- GET detail returns `{ document, revisions, latestRevisionNo }`.
- POST revisions accepts `{ expectedLatestRevisionNo, fieldOverrides }`.
- GET file returns inline by default and attachment for `?download=1`.

- [ ] **Step 1: Write failing route tests**

Assert 401, 400, 404, 409, PDF `Content-Type`, `Cache-Control: private, no-store`, safe RFC 5987 filename and exact inline/attachment disposition.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run 'src/app/api/business-orders/[businessOrderId]/documents/[documentId]/route.test.ts' 'src/app/api/business-orders/[businessOrderId]/documents/[documentId]/revisions/route.test.ts' 'src/app/api/business-orders/[businessOrderId]/documents/[documentId]/revisions/[revisionId]/file/route.test.ts'`

- [ ] **Step 3: Implement handlers and web proxies**

Use the current session actor only; parse positive integer path IDs; never return storage keys; read exact stored bytes and verify `%PDF-` before responding.

- [ ] **Step 4: Run and verify PASS**

Run the same command and expect all route tests PASS.

### Task 6: Explicit Existing-Document Backfill

**Files:**
- Create: `scripts/backfill-business-order-document-revisions.ts`
- Create: `scripts/backfill-business-order-document-revisions.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces command: `pnpm documents:backfill-revisions`

- [ ] **Step 1: Write failing idempotency tests**

Seed all three document kinds; assert one revision/file per snapshot, a second run adds zero rows/files, and a failure resumes from remaining IDs.

- [ ] **Step 2: Implement bounded batch backfill**

Read snapshot IDs without revision 1 in ascending batches of 50, generate from frozen snapshots, use the original generator as revision creator, and print final counts by kind plus hash-verification counts.

- [ ] **Step 3: Run tests and commit**

Run: `pnpm exec vitest run scripts/backfill-business-order-document-revisions.test.ts`

### Task 7: A4 Text Editor

**Files:**
- Create: `apps/web/src/components/orders/business-order-document-a4-editor.tsx`
- Create: `apps/web/src/components/orders/business-order-document-a4-editor.test.tsx`

**Interfaces:**
- Props: `content`, `overrides`, `onOverridesChange`, `onSave`, `onCancel`, `busy`.

- [ ] **Step 1: Write failing component tests**

Assert A4 dimensions, all visible text nodes editable, page markers, change propagation, cancel, disabled save, and `beforeunload` protection when dirty.

- [ ] **Step 2: Implement editor and CSS print geometry**

Render pages with CSS width/height in mm and a responsive transform wrapper. Use text inputs/textareas selected by content node kind; keep labels, table structure, logo and signature lines fixed.

- [ ] **Step 3: Run component tests**

Run: `pnpm --dir apps/web exec vitest run src/components/orders/business-order-document-a4-editor.test.tsx`

### Task 8: Real PDF Workspace

**Files:**
- Modify: `apps/web/src/lib/api/formal-business-orders.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-documents-workspace.tsx`
- Reuse: `apps/web/src/components/orders/pdf-canvas-preview.tsx`
- Reuse: `apps/web/src/lib/orders/ir-pdf-print.ts`
- Create: `apps/web/tests/unit/formal-business-order-document-revisions.spec.ts`

**Interfaces:**
- Produces client functions for document detail, create revision, fetch PDF bytes, download and print.

- [ ] **Step 1: Write failing client/workspace tests**

Assert there is no iframe or `/print?embed=1`; selected revision fetches PDF bytes; preview receives those bytes; download creates an attachment; print uses `printPdfBytes`; edit/save creates and selects the next revision; failed save preserves inputs.

- [ ] **Step 2: Implement revision state and PDF controls**

List revision number/actor/Jamaica time, fetch bytes with abort protection, validate PDF signature, show loading/error states, and keep business attachments below the document workspace unchanged.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --dir apps/web exec vitest run tests/unit/formal-business-order-document-revisions.spec.ts`

### Task 9: Deletion, Backup and Deployment Verification

**Files:**
- Modify: `src/modules/record-deletion/record-deletion-service.ts`
- Modify: `src/modules/record-deletion/record-deletion-execute.integration.test.ts`
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`

**Interfaces:**
- Business Order deletion preview counts revisions and PDF files; execution queues exact physical PDF keys for cleanup.

- [ ] **Step 1: Add failing deletion tests**

Assert preview counts, relational deletion order, stored-file deletion, physical cleanup tasks, and continued blocking for real business facts.

- [ ] **Step 2: Implement revision/file deletion integration and run tests**

Run: `pnpm exec vitest run src/modules/record-deletion/record-deletion-execute.integration.test.ts`

- [ ] **Step 3: Back up candidate data before migration**

Create timestamped PostgreSQL dump and `UPLOAD_ROOT` archive under `/Volumes/公司文件/Whole Hearted Car Service 单体候选/backups/`; write `SHA256SUMS` and verify with `shasum -a 256 -c SHA256SUMS`.

- [ ] **Step 4: Verify migration and backfill on candidate**

Run: `pnpm db:migrate && pnpm documents:backfill-revisions`; query snapshot/revision/file counts and three-kind distributions; rerun backfill and require zero additions.

- [ ] **Step 5: Run full verification**

Run: `pnpm test && pnpm typecheck && pnpm build`.

Expected: all tests PASS, typecheck exits 0, production build exits 0.

- [ ] **Step 6: Restart 3220 and verify runtime contracts**

Start with `pnpm start:candidate`; verify health, document detail, revision file `%PDF-`, `Content-Type`, inline/attachment headers, and runtime persistence after restart. Record any unavailable interactive browser acceptance honestly.

- [ ] **Step 7: Update handoff, commit and push**

```bash
git add drizzle src apps/web scripts package.json docs/CONTINUATION_ENTRYPOINT.md
git commit -m "feat: deliver editable A4 business documents"
git push origin codex/ai-service-wip-20260827
```

