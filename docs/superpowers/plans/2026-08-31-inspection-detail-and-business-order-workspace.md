# Inspection Detail And Business Order Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first complete formal Inspection Report detail workspace and make the Business Order detail a compact desktop workspace with direct-choice controls.

**Architecture:** Extend the existing formal PostgreSQL inspection-report domain with append-only draft and quotation facts, expose authenticated mutation routes, and render the report through focused tab components. Keep the Business Order domain unchanged while replacing native select controls with reusable radio-card controls and containing scrolling inside the active workspace on desktop.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, PostgreSQL, Drizzle migrations, Vitest, Playwright component/unit tests.

**Spec:** `docs/superpowers/specs/2026-08-31-inspection-report-and-problem-description-design.md`

## Global Constraints

- PostgreSQL and the formal service remain the only business truth source.
- AI output is a proposal until a human applies it; original report text is never overwritten.
- Quotations may be empty and use explicit `pending`, `entered`, or `not_quoted` status.
- All generated files, backups, and growing caches remain under `/Volumes/公司文件`.
- Existing uncommitted user changes are preserved and are not staged with this delivery.
- Desktop detail pages contain scrolling inside the active workspace; narrow screens retain natural document scrolling.

---

### Task 1: Formal inspection draft and quotation facts

**Files:**
- Create: `drizzle/0042_inspection_report_detail_workspace.sql`
- Modify: `src/db/schema/inspection-report.ts`
- Modify: `src/modules/inspection-report/inspection-report-service.ts`
- Test: `src/db/schema/inspection-report-detail.integration.test.ts`
- Test: `src/modules/inspection-report/inspection-report-service.integration.test.ts`

**Interfaces:**
- Produces `InspectionReportDetailRecord` with original submission, current organized draft, quotation status and lines.
- Produces `updateInspectionReportDraft(...)` with optimistic `expectedVersion` and append-only versions.

- [ ] Write integration tests proving the original submission stays unchanged after a draft/quotation update, an empty quotation remains valid, and stale versions are rejected.
- [ ] Run the focused backend tests and confirm they fail because the new tables and service method do not exist.
- [ ] Add the migration, Drizzle declarations, mapping queries, validation and transactional append-only update.
- [ ] Run the focused backend tests and confirm they pass.
- [ ] Commit only Task 1 files.

### Task 2: Authenticated detail and AI organization APIs

**Files:**
- Modify: `src/app/api/inspection-reports/[inspectionReportId]/route.ts`
- Create: `apps/web/src/app/api/formal/inspection-reports/[inspectionReportId]/organize/route.ts`
- Modify: `apps/web/src/lib/api/formal-inspections.ts`
- Test: `src/app/api/inspection-reports/[inspectionReportId]/route.test.ts`
- Test: `apps/web/tests/unit/formal-inspection-detail-api.spec.ts`

**Interfaces:**
- `PATCH /api/formal/inspection-reports/:id` accepts the exact draft and quotation version selected by the user.
- `POST /api/formal/inspection-reports/:id/organize` uses the existing AI service route/fallback settings and returns a structured proposal without writing it.

- [ ] Write API tests for authenticated read, optimistic draft save, malformed quotation rejection, AI proposal response and AI failure that preserves the report.
- [ ] Run the focused API tests and confirm expected failures.
- [ ] Implement route handlers, closed input parsing and typed client methods.
- [ ] Run the focused API tests and confirm they pass.
- [ ] Commit only Task 2 files.

### Task 3: Formal Inspection Report detail workspace

**Files:**
- Rewrite: `apps/web/src/components/orders/formal-inspection-report-detail.tsx`
- Create: `apps/web/src/components/orders/formal-inspection-report-tabs.tsx`
- Create: `apps/web/src/components/orders/formal-inspection-ai-assistant.tsx`
- Create: `apps/web/src/components/orders/formal-inspection-quote-editor.tsx`
- Test: `apps/web/tests/unit/formal-inspection-report-detail.spec.tsx`

**Interfaces:**
- Six stable tabs: inspection/quotation, formal report, customer follow-up, attachments, history and comments.
- The default workspace shows original evidence, human-editable organized content, findings and optional quotation together.
- AI proposals show before/after content and require an explicit Apply action before `PATCH` persists a new version.

- [ ] Write rendered-component tests for all six tabs, optional quotation, original-text preservation, AI proposal/apply behavior and customer-contact history.
- [ ] Run the component tests and confirm expected failures against the old single-card detail.
- [ ] Implement the fixed header, status strip, six workspaces, draft editor, quotation editor and AI assistant drawer using real formal API data.
- [ ] Run the component tests and confirm they pass.
- [ ] Commit only Task 3 files.

### Task 4: Compact Business Order workspace and direct-choice controls

**Files:**
- Create: `apps/web/src/components/shared/choice-cards.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-problem-description.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-tabs.tsx`
- Test: `apps/web/tests/unit/formal-business-order-actions-ui.spec.ts`
- Test: `apps/web/tests/unit/formal-business-order-compact-workspace.spec.tsx`

**Interfaces:**
- `ChoiceCards` renders keyboard-accessible radio buttons and mirrors the chosen value to a named form field.
- Desktop Business Order detail consumes the available shell height and scrolls only inside active content panes.

- [ ] Write tests proving mechanic, payment method, refund method and original-document state use radio cards and both paper-return fields are optional.
- [ ] Write a layout test proving the desktop shell and operation columns use `min-h-0`, `overflow-hidden` and internal `overflow-y-auto` containment.
- [ ] Run the focused tests and confirm they fail against the current dropdown and page-scroll implementation.
- [ ] Implement compact no-wrap charge rows, fixed-height desktop shell, internal scrolling and direct-choice forms.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit only Task 4 files.

### Task 5: Migration, regression and candidate restart

**Files:**
- Modify: `docs/CONTINUATION_ENTRYPOINT.md` only if no unrelated user edits overlap; otherwise create a separate delivery note.
- Create: `docs/implementation/2026-08-31-inspection-detail-and-business-order-workspace.md`

**Interfaces:**
- Candidate runtime remains available at `http://127.0.0.1:3220` with PostgreSQL on `55433`.

- [ ] Back up the candidate database under `/Volumes/公司文件` before applying migration 0042.
- [ ] Run focused backend and web tests, then repository and web typechecks.
- [ ] Run the production build and confirm it completes without new warnings or errors.
- [ ] Apply migration 0042, restart the candidate runtime and verify health plus both detail APIs with authenticated browser/session evidence where available.
- [ ] Record exact commands, outcomes, remaining acceptance boundaries and rollback location in the delivery note.
- [ ] Commit verification and delivery-note files without staging unrelated changes.

### Task 6: Inspection detail correction pass

**Files:**
- Create: `apps/web/src/lib/inspection/formal-inspection-ai.ts`
- Modify: `apps/web/src/lib/api/formal-inspections.ts`
- Modify: `apps/web/src/components/orders/formal-inspection-report-detail.tsx`
- Create: `src/modules/inspection-report/sms-gateway.ts`
- Create: `src/app/api/inspection-reports/[inspectionReportId]/sms/route.ts`
- Create: `apps/web/src/app/api/formal/inspection-reports/[inspectionReportId]/sms/route.ts`
- Test: `apps/web/tests/unit/formal-inspection-ai-quotation.spec.ts`
- Test: `apps/web/tests/unit/formal-inspection-report-detail-workspace.spec.ts`

**Interfaces:**
- `reconcileExplicitInspectionQuotation(aiQuotation, originalText)` accepts only prices explicitly present in the source and supplies deterministic lines when the AI omitted them.
- `deriveInspectionFollowupStage(workspaceVersion, communications)` derives the visible state from the latest append-only communication fact.
- `sendFormalInspectionSms(...)` calls an authenticated server route; the route records a communication only after the configured provider accepts the message.

- [x] Write failing tests for visible AI quotation lines, explicit-price reconciliation, three report-language variants, enlarged customer/vehicle identity, append-only status correction and removal of the `sms:` deep link.
- [x] Run the focused web unit tests and confirm they fail for the missing behavior.
- [x] Implement quotation reconciliation, status correction controls, the three report variants, enlarged header identity and the formal SMS route boundary.
- [x] Run the focused unit tests, web typecheck and backend tests.
- [x] Verify the five corrected behaviors in the live `3220` browser and record the provider-configuration boundary without claiming an unconfigured SMS was sent.
