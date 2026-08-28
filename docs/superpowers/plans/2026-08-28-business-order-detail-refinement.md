# Business Order Detail Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a compact Business Order detail workspace with modal finance entry, canonical print preview, a durable attachment center, photo comments, and a concise expandable history timeline.

**Architecture:** Keep `apps/web` as the only UI and call formal PostgreSQL services through same-process `/api/formal/*` route handlers. Store file bytes under `UPLOAD_ROOT`, metadata in `stored_files` plus a new `business_order_attachments` relation, and expose attachments through authorization-checked routes. Reuse the canonical HTML print sheet inside the workspace so preview and system print use one renderer.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript 5.9, PostgreSQL/Drizzle, Vitest, Playwright unit tests, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-28-business-order-detail-refinement-design.md`

## Global Constraints

- Preserve all current Business Order capabilities, permissions, audit behavior and immutable payment/refund/document facts.
- PostgreSQL and `UPLOAD_ROOT` remain the only formal persistence sources.
- Accepted uploads are JPG, PNG, WebP and PDF with a 25 MB per-file limit.
- Storage keys never cross the server/client boundary.
- Use the existing candidate worktree and port 3220; do not modify the stable 3210 runtime.
- Add no general frontend state library and no new upload or PDF dependency.

---

### Task 1: Lock the approved UI contract with failing tests

**Files:**
- Modify: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`
- Modify: `apps/web/tests/unit/formal-business-order-messages.spec.ts`

**Interfaces:**
- Consumes: existing rendered component source and current Playwright unit harness.
- Produces: assertions for modal finance dialogs, same-position save control, explicit add labels, print preview, concise history, comment-feed semantics and photo selection.

- [ ] Add assertions for `role="dialog"`, `登记收款`, `登记退款`, `保存收费项目`, `新增工时`, `新增配件`, `新增其他费用`, `新增备注`, `单据预览`, and `业务附件`.
- [ ] Add message assertions for a photo input accepting `image/jpeg,image/png,image/webp`, attachment thumbnails and comment-feed article markup.
- [ ] Run `pnpm --dir apps/web test:unit --grep "formal business order"` and verify the new assertions fail because the controls are absent.
- [ ] Record the expected failures before changing production components.

### Task 2: Add formal Business Order attachment persistence

**Files:**
- Create: `drizzle/0032_business_order_attachments.sql`
- Create: `src/db/schema/business-order-attachment.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/modules/business-order/business-order-attachment-storage.ts`
- Create: `src/modules/business-order/business-order-attachment-storage.test.ts`
- Create: `src/modules/business-order/business-order-attachment-service.ts`
- Create: `src/modules/business-order/business-order-attachment-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-runtime.ts`

**Interfaces:**
- Produces: `BusinessOrderAttachmentService.listAttachments`, `registerAttachment`, `getAttachmentFile`, and `linkAttachmentsToMessage`.
- Produces: `storeBusinessOrderUpload`, `removeStoredBusinessOrderUpload`, and `storedBusinessOrderUploadPath`.

- [ ] Write storage tests proving media-type validation, 25 MB enforcement, safe storage paths and byte/hash fidelity.
- [ ] Run the storage test and verify failure because the module is missing.
- [ ] Implement storage under `business-order-files/YYYY/MM/<uuid>.<ext>` and make the storage test pass.
- [ ] Write integration tests proving authorized upload metadata, unauthorized denial, list ordering, protected file resolution, message linking and audit event creation.
- [ ] Run the integration test and verify failure because the schema/service are missing.
- [ ] Add the Drizzle table and SQL migration with `business_order_id`, `file_id`, `category`, `caption`, optional `message_id`, `linked_by`, and `linked_at`.
- [ ] Implement the service transaction boundaries and make the integration test pass.

### Task 3: Expose formal attachment routes and client adapter

**Files:**
- Create: `apps/web/src/app/api/formal/business-orders/[businessOrderId]/attachments/route.ts`
- Create: `apps/web/src/app/api/formal/business-orders/[businessOrderId]/attachments/[attachmentId]/route.ts`
- Create: `apps/web/src/lib/api/formal-business-order-attachments.ts`
- Create: `apps/web/tests/unit/formal-business-order-attachments.spec.ts`

**Interfaces:**
- Consumes: attachment service methods from Task 2.
- Produces: `fetchFormalBusinessOrderAttachments`, `uploadFormalBusinessOrderAttachment`, and protected file URLs.

- [ ] Write route/adapter tests for GET list, multipart POST, invalid files, access denial and protected download headers.
- [ ] Run the tests and verify failure because the routes and adapter are missing.
- [ ] Implement same-process route handlers with awaited dynamic params, session/context resolution and filesystem cleanup after failed registration.
- [ ] Implement the browser adapter and make the tests pass.

### Task 4: Link comment photos to the attachment center

**Files:**
- Modify: `src/modules/business-order/business-order-collaboration-service.ts`
- Modify: `src/modules/business-order/business-order-collaboration-service.integration.test.ts`
- Modify: `apps/web/src/lib/api/formal-business-order-collaboration.ts`
- Modify: `apps/web/src/app/api/formal/business-orders/[businessOrderId]/messages/route.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-messages.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-messages.spec.ts`

**Interfaces:**
- Consumes: `linkAttachmentsToMessage` and attachment list records.
- Produces: `FormalBusinessOrderMessage.attachments` and `createFormalBusinessOrderMessage(..., { attachmentIds })`.

- [ ] Extend integration tests so message creation links only attachments from the same order and same uploader, and message reads include attachment metadata.
- [ ] Run the integration test and verify the expected missing-field/link failure.
- [ ] Extend collaboration mapping and create-message transaction to link attachment IDs.
- [ ] Extend the client adapter and message route JSON contract.
- [ ] Replace the current composer card with a compact comment composer supporting photo selection, preview, removal and upload-before-publish.
- [ ] Render messages as comment articles with author identity, timestamp, text, mentions and an image grid.
- [ ] Run collaboration and message UI tests until green.

### Task 5: Build the document preview and attachment workspace

**Files:**
- Create: `apps/web/src/components/orders/formal-business-order-documents-workspace.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-print.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`

**Interfaces:**
- Consumes: current document generation functions and Task 3 attachment adapter.
- Produces: selected document preview state, iframe URL with `embed=1`, system-print link, upload drop/paste area and attachment gallery.

- [ ] Add failing UI assertions for automatic latest-document selection, iframe title, print/new-window controls and attachment categories.
- [ ] Add an `embedded` display option to the print component that hides only its toolbar.
- [ ] Implement the document workspace with a preview pane, version list, generation controls, direct upload, drag/drop, paste, image preview and PDF/file links.
- [ ] Replace the inline document section in the detail component with the new focused component.
- [ ] Run the focused Web tests until green.

### Task 6: Tighten finance and charge editing interactions

**Files:**
- Create: `apps/web/src/components/shared/action-dialog.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`

**Interfaces:**
- Produces: an accessible action dialog with `open`, `title`, `onClose`, `children`, Escape handling and focus return.

- [ ] Write a failing test for accessible dialog markup and same-position charge save/cancel controls.
- [ ] Implement the reusable dialog and render existing payment/refund forms inside it without changing submit payloads.
- [ ] Change the charge header action to `编辑收费项目` or `保存收费项目` in one location and remove the duplicate footer save button.
- [ ] Rename category add controls and compress the finance summary/list styling.
- [ ] Run the focused Web tests until green.

### Task 7: Replace the expanded audit cards with a concise timeline

**Files:**
- Create: `apps/web/src/components/orders/formal-business-order-history-timeline.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`

**Interfaces:**
- Consumes: repair-round events and audit-event field renderers already loaded by the detail page.
- Produces: one chronological list with expandable `details` elements for field changes.

- [ ] Add a failing assertion for timeline list semantics and collapsed detail labels.
- [ ] Extract history normalization into a typed view model and sort descending by occurrence time.
- [ ] Render one compact row per event and put old/new fields inside `details`.
- [ ] Verify all existing event facts remain represented and run focused tests.

### Task 8: Preserve record deletion and file cleanup behavior

**Files:**
- Modify: `src/modules/record-deletion/record-deletion-service.ts`
- Modify: `src/modules/record-deletion/record-deletion-file-cleanup.ts`
- Modify: `src/modules/record-deletion/record-deletion-policy.test.ts`

**Interfaces:**
- Consumes: `business_order_attachments` and business-order storage removal.
- Produces: dependency counts and cleanup candidates that include Business Order attachment files.

- [ ] Add a failing deletion-policy/service test with Business Order attachments.
- [ ] Include attachment rows in preview counts, collect file IDs before deletion, remove relations in the authorized transaction and delete orphaned bytes after commit.
- [ ] Run focused deletion tests until green.

### Task 9: Migrate, verify and visually accept

**Files:**
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: an operational 3220 candidate and durable continuation evidence.

- [ ] Restart the candidate and verify migration 0032 applies to port 55433 without partial schema state.
- [ ] Run focused attachment, collaboration, deletion and Web UI tests.
- [ ] Run `pnpm test`, `pnpm --dir apps/web test:unit`, root/Web typecheck, `pnpm build`, `git diff --check` and inspect exit codes.
- [ ] Verify the 3220 desktop and 430px flows: finance dialogs, charge editing, document preview, system print invocation, attachment upload/readback, comment photo, history expansion and reload persistence.
- [ ] Check URL/title, framework overlay, console errors and representative screenshots.
- [ ] Update the continuation entrypoint with actual commands, counts, runtime state and remaining browser risks.
