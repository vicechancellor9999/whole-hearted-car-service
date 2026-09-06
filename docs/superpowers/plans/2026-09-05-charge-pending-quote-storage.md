# Pending quote storage Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the existing candidate checkout. The user authorized autonomous execution; do not pause for routine plan approval.

**Goal:** Preserve the distinction between an unpriced charge and an explicitly free charge through formal charge storage and versioning.

**Architecture:** Add an explicit `pendingQuote` boolean alongside the existing integer-minor-unit amounts. Pending rows keep zero accounting contribution but are not presented as free; legacy rows default to false without reclassifying historical records. UI, AI and documents must consume the marker before production activation.

**Tech Stack:** TypeScript, Zod, PostgreSQL/Drizzle, PGlite, Vitest.

**Spec:** `apps/web/docs/authoritative-spec-merged-2026-08-23.md`, non-blocking missing-material rules and pending-price quotation rows; user's repeated distinction between quote, project, labor and parts.

## Global Constraints

- Work only in candidate `3210-single-runtime`; preserve the dirty worktree.
- No real business records, payments or performance amounts are edited.
- A pending price must not require deletion of the item or block saving the business order.
- Historical zero-price rows must not be guessed as pending.
- No production migration/restart until the UI and document consumers also distinguish pending from free. SQL remains unregistered in the journal during this storage checkpoint.

## Task 1: Schema and isolated calculation contract

Files: `src/modules/business-order/business-order-schemas.ts`, `business-order-schemas.test.ts`, `business-order-calculation.ts`, new `business-order-calculation.test.ts`.

Interface: `ChargeItemInput.pendingQuote?: boolean`; known charges still require `unitPrice`; pending charges accept blank/zero price with zero item discount. A pending nonzero amount is rejected as contradictory rather than discarded.

- [x] Add red tests: missing/false marker preserves known zero, true + blank accepted, true + nonzero rejected, known blank rejected.
- [x] Add red calculation tests: pending item retained, contributes zero; explicit free remains false; priced row remains unchanged.
- [x] Implement boolean parsing and blank handling only when explicitly pending. Normalize pending row arithmetic to zero; retain `pendingQuote` in calculated result.
- [x] Run `pnpm exec vitest run src/modules/business-order/business-order-schemas.test.ts src/modules/business-order/business-order-calculation.test.ts`.

## Task 2: Append-only storage and recovery

Files: `drizzle/0051_business_order_pending_quotes.sql`, `src/db/schema/business-order.ts`, `src/modules/business-order/business-order-service.ts`, `business-order-service.integration.test.ts`.

Interface: `BusinessOrderChargeSnapshot.items[].pendingQuote: boolean`; existing clients may omit it on input and receive false for historical records.

- [x] Add SQL migration with `pending_quote boolean not null default false` and a check requiring zero unit price/discount/subtotal when pending. Do not update historical rows or disable append-only triggers.
- [x] Add red PGlite service test: save priced + pending + free rows, read same marker, replace pending with real price in a new version, inspect original version still pending; verify audit event exists.
- [x] Add red SQL check test rejecting pending nonzero amount; verify default false on legacy rows.
- [x] Write/read marker in service INSERT and SELECT; update Drizzle schema.
- [x] Run service integration suite in in-memory PGlite; no connection to 55433.

Storage-related expansion completed: document/receipt/handoff snapshots retain the marker. Handoff JSON validation was updated in migration 0051; known rows retain the old JSON shape (no new false key), pending rows require true. Historical handoff corrections continue to preserve their frozen snapshot. Added migration conservation and pending handoff tests; no performance calculation rule changed.

## Next activation gate

Before registering migration or restarting 3220, complete a separate consumer checkpoint: formal API types, charge editor and version comparison, AI marker parsing and local fallback, read-only charge sections and totals, document snapshots/content/PDF, handoff snapshot. Verify pending labels in both languages, no false final total, existing two-copy printing, and three viewport sizes. New document versions retain the marker; old generated documents remain unchanged.

## Verification and handoff

- [x] Run scope ESLint, component regression suite, and build (build only; no restart at this storage checkpoint).
- [x] Record commands, results and remaining activation gate in continuation and QA progress.
- [x] No broad commit of the dirty worktree.

Checkpoint 05:20: 88 integration/schema/calculation tests pass with maxWorkers=2; separate legacy migration conservation test passes; 80 frontend component tests pass. Scope lint/diff and independent NEXT_DIST_DIR production build pass. Heavy concurrent build/test caused one 5s document test timeout; rerunning without build contention passed without weakening test timeouts. Consumer activation gate remains OPEN: no real migration or restart performed.

## Consumer checkpoint and activation — 05:47

- [x] Explicit pending/free API, editor, save payload, version comparison and readonly rendering.
- [x] AI missing/zero/explicit flag contract; local fallback handles 800, 12.50, 5000 bottles, model year 2017, free labor versus unpriced parts, ambiguous totals.
- [x] List pending count and partial totals; pending prices suppress misleading fully-settled status without changing ledger amounts.
- [x] PDF content and renderer plus Chinese/English receipt HTML preserve pending prices. Both office/customer copies generated together; English contains no Chinese defaults. QA fixtures rendered to four PNG pages and inspected.
- [x] 120 backend tests, 86 component tests, 25 pure unit tests; scope lint/diff; independent and final default production builds pass.
- [x] Journal0051 registered and migrated on55433. Read-only before/after hashes of24 business tables match; zero historical rows reclassified.
- [x] Restart managed3220, PID65581. Desktop/tablet/phone pending toggle and undo, phone footer and existing two-copy preview verified. Unsaved tests discarded; no real business facts submitted.

Gate CLOSED / activated. Detailed screenshots, fixtures, hashes and limitations recorded in external QA progress.md. The broader autonomous core-path goal remains active.
