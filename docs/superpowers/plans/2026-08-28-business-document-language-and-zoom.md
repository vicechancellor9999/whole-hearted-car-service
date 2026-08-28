# Business Order Document Language and Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and serve pure-English customer and office PDFs and provide fit-width PDF preview zoom controls.

**Architecture:** Extend each immutable document revision with an optional English file reference and hash. Render both languages from one snapshot before the revision transaction, then expose the selected artifact through the existing authenticated file route. Keep zoom state in the shared client preview component and derive fit scale from its measured viewport.

**Tech Stack:** PostgreSQL/Drizzle, pdf-lib, Next.js Route Handlers, React, PDF.js, Vitest, Playwright unit tests.

**Spec:** `docs/superpowers/specs/2026-08-28-business-document-language-and-zoom-design.md`

## Global Constraints

- Customer and office revisions require both `zh` and `en` files; mechanic revisions only require `zh`.
- English generation fails before persistence when a customer-visible translated field is missing.
- Preview, download, and print always consume the selected persisted file bytes.
- Zoom range is 50%–200%, step 10%, with fit-width as the default.

---

### Task 1: Persist English revision artifacts

**Files:**
- Create: `drizzle/0036_business_order_document_english_files.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/business-order-document.ts`
- Modify: `src/modules/business-order/business-order-document-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-document-service.ts`
- Modify: `src/modules/business-order/business-order-document-storage.ts`

**Interfaces:**
- Produces: nullable `englishFileId` and `englishContentSha256` on `BusinessOrderDocumentRevisionRecord`.

- [ ] Write integration assertions that customer/office revisions save two files and mechanic revisions save one.
- [ ] Run the focused integration test and confirm the new assertions fail.
- [ ] Add migration, schema columns, dual-file storage and transaction cleanup.
- [ ] Run the focused integration test and confirm it passes.

### Task 2: Render pure-English A4 PDFs

**Files:**
- Modify: `src/modules/business-order/business-order-document-pdf.test.ts`
- Modify: `src/modules/business-order/business-order-document-pdf.ts`

**Interfaces:**
- Produces: `renderBusinessOrderDocumentPdf({ language: "zh" | "en", ... })`.

- [ ] Add a failing PDF test for language metadata, English title and missing-translation validation.
- [ ] Implement language-specific labels and content selection without changing A4 geometry.
- [ ] Render both customer-facing languages in `createRevision` and keep mechanic Chinese-only.
- [ ] Run renderer and service tests.

### Task 3: Serve and select language artifacts

**Files:**
- Modify: `src/app/api/business-orders/[businessOrderId]/documents/[documentId]/revisions/[revisionId]/file/route.ts`
- Modify: `apps/web/src/lib/api/formal-business-orders.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-documents-workspace.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`
- Modify: `apps/web/tests/unit/formal-print-consumer.spec.ts`

**Interfaces:**
- Consumes: revision English file metadata.
- Produces: `formalDocumentRevisionFileUrl(..., { language, download })`.

- [ ] Add failing UI and route-contract assertions for `中文 / English` and language-aware URLs.
- [ ] Validate `language` in the route and read the selected persisted file.
- [ ] Add the language switch for customer and office documents and route preview/download/print through it.
- [ ] Run focused Web tests and type checks.

### Task 4: Add fit-width preview controls

**Files:**
- Modify: `apps/web/src/components/orders/pdf-canvas-preview.tsx`
- Modify: `apps/web/tests/unit/formal-print-consumer.spec.ts`

**Interfaces:**
- Produces: fit-width, 50%–200% zoom controls and internal overflow.

- [ ] Add failing assertions for fit-width default, zoom limits and controls.
- [ ] Measure the preview viewport with `ResizeObserver`, derive fit scale, and preserve device-pixel rendering.
- [ ] Run focused tests and verify build output.

### Task 5: Backfill and verify

**Files:**
- Modify: `scripts/backfill-business-order-document-revisions.ts`
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`

**Interfaces:**
- Consumes: latest renderer version and dual-file revision creation.
- Produces: current-language artifacts for all existing printable documents.

- [x] Back up candidate runtime data and apply migration 0036.
- [x] Backfill latest revisions for the three existing documents.
- [x] Use `pdfinfo`, PDF.js text extraction and rendered PNGs to verify page size, page count, English-only text and visual layout.
- [x] Run focused and full backend/Web tests, type checks, production build and `git diff --check`.
- [x] Restart 3220 and confirm `/login` returns 200.
- [x] Commit the verified implementation branch.
- [ ] Push or integrate the verified branch after the repository completion choice.
