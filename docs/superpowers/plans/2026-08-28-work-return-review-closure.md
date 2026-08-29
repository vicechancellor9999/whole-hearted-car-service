# Business Order Work Return Review Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete formal intake, electronic work-return, paper work-return, front-desk review and atomic formal-handoff workflow.

**Architecture:** Extend the existing append-only repair-round domain rather than creating a parallel order model. Store work-return snapshots and file links in PostgreSQL, expose narrow same-process Route Handlers, add a dedicated mechanic-safe mobile surface, and make both the formal workbench and Business Order detail consume the same formal review projection.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, PostgreSQL 18, Drizzle schema/migrations, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-work-return-review-closure-design.md`

## Global Constraints

- All generated files, backups, build caches and screenshots remain under `/Volumes/公司文件`.
- Candidate work uses the existing linked worktree and PostgreSQL port 55433; do not modify the protected 3210 runtime or backup archives.
- PostgreSQL remains authoritative; localStorage is limited to interface preferences.
- Every mutation rechecks server-side session, role, team scope, state, version and attachment ownership.
- Electronic and paper submissions append new facts; they do not overwrite earlier returns, approvals or rejections.
- User-facing additions must be complete in Chinese and English and use existing semantic theme tokens.

---

### Task 1: Protect candidate data and define the work-return projection

**Files:**
- Create: `drizzle/0038_work_return_review_closure.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/repair-round.ts`
- Test: `src/db/schema/repair-round.integration.test.ts`

**Interfaces:**
- Produces: append-only work-return source, exception summary, item-result snapshot and work-return attachment links.

- [ ] Create and verify a timestamped candidate PostgreSQL and uploads backup under `/Volumes/公司文件/Whole Hearted Car Service 单体候选/backups/` before applying migration 0038.
- [ ] Write a failing schema integration test proving a work return stores `submission_source`, structured item results, exception summary and linked files while rejecting mutation or cross-order links.
- [ ] Run `pnpm vitest run src/db/schema/repair-round.integration.test.ts` and confirm failure because migration 0038 is absent.
- [ ] Add schema and forward-only migration with checks, foreign keys, indexes and append-only guards.
- [ ] Re-run the schema test and confirm it passes.

### Task 2: Implement latest-return read and atomic electronic/paper workflows

**Files:**
- Modify: `src/modules/business-order/repair-round-service.ts`
- Test: `src/modules/business-order/repair-round-service.integration.test.ts`

**Interfaces:**
- Produces: `CurrentRepairRound.latestWorkReturn`, `acceptWithIntake`, enriched `submitWorkReturn`, `approveAndFormallyHandOff`, and `recordPaperWorkReturnAndFormallyHandOff`.

- [ ] Add failing integration tests for mandatory intake mileage/photo, completed-item validation, electronic pending-review, atomic electronic approval/handoff, atomic paper return/handoff, rollback, rejection/resubmission, and stale approval not authorizing the latest return.
- [ ] Run the targeted integration test and confirm each new test fails for the missing behavior.
- [ ] Implement one transactional intake action that records acceptance, mileage and the selected protected photo.
- [ ] Implement immutable electronic return snapshots and attachment links, requiring the assigned mechanic and the latest round version.
- [ ] Implement electronic approval and formal handoff as one transaction, including the performance value.
- [ ] Implement paper return recording for front desk/super admin that creates submission, approval and formal-handoff facts in one transaction.
- [ ] Change the current-round projection so `approvedWorkReturnId` is populated only when it equals the latest return; return the latest return contents and review result.
- [ ] Re-run the targeted integration test and confirm it passes.

### Task 3: Expose secure formal routes and status filtering

**Files:**
- Modify: `src/app/api/business-orders/[businessOrderId]/rounds/route.ts`
- Modify: `src/app/api/business-orders/[businessOrderId]/rounds/route.test.ts`
- Modify: `src/modules/business-order/business-order-service.ts`
- Modify: `src/app/api/business-orders/route.ts`
- Modify: `src/app/api/business-orders/route.test.ts`
- Create: `src/app/api/mechanic/work-orders/route.ts`
- Create: `src/app/api/mechanic/work-orders/[businessOrderId]/route.ts`
- Create: route tests beside both mechanic routes.

**Interfaces:**
- Produces: formal status-filtered review queue and mechanic-safe list/detail/action contracts without financial or customer-contact fields.

- [ ] Add failing route tests for intake, electronic submission, combined electronic approval/handoff, combined paper return/handoff, status filter and mechanic data minimization.
- [ ] Run the route tests and confirm expected failures.
- [ ] Extend the existing rounds handler with validated action bodies and attachment IDs.
- [ ] Add `status=return_pending_review` to the formal list service and route.
- [ ] Add mechanic-safe endpoints that return only vehicle, round, work items, work notes, intake, rejection and submission fields allowed for the assigned team.
- [ ] Re-run route tests and confirm they pass.

### Task 4: Build the mechanic mobile intake and return surface

**Files:**
- Modify: `apps/web/src/app/api/formal/auth/login/route.ts`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/components/layout/identity-switcher.tsx`
- Create: `apps/web/src/app/mechanic/page.tsx`
- Create: `apps/web/src/app/mechanic/orders/[id]/page.tsx`
- Create: `apps/web/src/components/mechanic/formal-mechanic-workspace.tsx`
- Create: `apps/web/src/lib/api/formal-mechanic-work-orders.ts`
- Test: `apps/web/tests/unit/formal-mechanic-workspace.spec.ts`

**Interfaces:**
- Consumes: mechanic-safe formal endpoints and Business Order attachment upload.
- Produces: 430px-ready assigned-work list, intake modal and electronic return modal.

- [ ] Add failing Playwright component tests for mechanic login redirect, required mileage/photo, return item checklist, photos, summary, exception, rejection display and resubmission.
- [ ] Run the focused Web test and confirm failure because the formal mechanic surface is absent.
- [ ] Route mechanic login to `/mechanic` and render it without the PC sidebar.
- [ ] Implement the assigned-work list and detail with no prices, payer contact, financial data or management actions.
- [ ] Implement camera/file/drag/paste intake photo, atomic intake action and electronic return submission.
- [ ] Re-run the focused Web test at desktop and 430px and confirm it passes.

### Task 5: Build the front-desk review queue and Business Order review dialogs

**Files:**
- Modify: `apps/web/src/lib/api/formal-business-orders.ts`
- Modify: `apps/web/src/components/workbench/workbench-workspace.tsx`
- Modify: `apps/web/src/components/orders/formal-business-orders-workspace.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Create: `apps/web/src/components/orders/formal-work-return-dialogs.tsx`
- Test: `apps/web/tests/unit/formal-business-orders.spec.ts`
- Test: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`
- Create: `apps/web/tests/unit/formal-work-return-review.spec.ts`

**Interfaces:**
- Consumes: enriched round workspace, formal status filter and attachment upload.
- Produces: formal workbench queue, review-and-handoff dialog, rejection dialog and paper-return-and-handoff dialog.

- [ ] Add failing tests proving the workbench uses formal pending-review orders, the detail shows one unambiguous next action, and electronic and paper flows submit the combined formal-handoff actions.
- [ ] Run focused tests and confirm the intended failures.
- [ ] Replace the mock reminder source for Business Order review with the formal filtered queue and link each entry directly to its review dialog.
- [ ] Replace inline mileage and review controls with compact action buttons and accessible dialogs.
- [ ] Implement full return review contents, mandatory rejection reason, performance input, paper upload and atomic formal handoff.
- [ ] Re-run focused tests and confirm they pass.

### Task 6: Finish compact finance history and visual integration

**Files:**
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/tests/unit/formal-business-order-tabs.spec.ts`

**Interfaces:**
- Produces: collapsed payment history and compact responsive operations sidebar.

- [ ] Add a failing test proving payment history is collapsed by default, expands accessibly and uses non-wrapping reference/amount groups.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the compact disclosure and align action hierarchy with the existing semantic theme.
- [ ] Re-run the focused test and confirm it passes in Chinese, English, light and dark fixtures.

### Task 7: Verify the complete candidate and record continuation evidence

**Files:**
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`

**Interfaces:**
- Produces: reproducible verification evidence and a safe continuation point.

- [ ] Apply migration 0038 only to candidate PostgreSQL 55433 after verified backup.
- [ ] Run targeted backend and Web tests, then full `pnpm test`, `pnpm --dir apps/web test:unit`, root/Web type checks, lint, `git diff --check` and production build.
- [ ] Restart only candidate 3220 from the final production build.
- [ ] Use the in-app browser to verify front-desk electronic review/handoff, paper return/handoff, mechanic 430px intake/return, rejection/resubmission, workbench queue, language, both themes and console state.
- [ ] Update the continuation entry with migration, backup, tests, browser evidence and remaining limitations; do not claim unperformed acceptance.
