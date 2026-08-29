# Inspection Intake Team and Vehicle Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a formal inspection intake that searches vehicles by plate in real time, creates missing vehicles without losing the form, and stores the submitting team with an optional mechanic and special-case notes.

**Architecture:** Add immutable inspection-team and special-note facts to PostgreSQL while making the actual inspector nullable. Expose a lightweight authenticated active-vehicle search, reuse the existing formal vehicle form for missing vehicles, and keep the inspection dialog as a focused client component. Existing inspection findings remain readable, while the new intake stores one report-level result without duplicating it into a finding.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript 5.9, PostgreSQL/Drizzle, Vitest/PGlite, Playwright

**Spec:** `docs/superpowers/specs/2026-08-29-inspection-intake-team-vehicle-search-design.md`

## Global Constraints

- Work only in `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime` on the existing isolated candidate worktree.
- Keep PostgreSQL as the only formal business source; localStorage remains limited to interface preferences.
- Preserve all unrelated dirty and untracked work, including `apps/web/.next-e2e/`.
- Create and verify a candidate PostgreSQL/uploads backup under `/Volumes/公司文件/Whole Hearted Car Service 单体候选/backups/` before applying migration 0039.
- Apply migration only to candidate PostgreSQL port 55433.
- Follow test-first red-green-refactor for every production behavior.
- Do not change the protected 3210 runtime.

---

### Task 1: Formal inspection team and optional inspector facts

**Files:**
- Create: `drizzle/0039_inspection_team_intake.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/inspection-report.ts`
- Modify: `src/modules/inspection-report/inspection-report-service.ts`
- Modify: `src/modules/inspection-report/inspection-report-service.integration.test.ts`

**Interfaces:**
- Consumes: existing `repair_teams`, `staff_members`, `repair_rounds`, and immutable inspection-report guards.
- Produces: `InspectionReportRecord.inspectionTeamId`, `InspectionReportRecord.specialCaseNotesZh`, and `InspectionReportListItem.teamName`.

- [ ] **Step 1: Add failing integration tests**

Add tests proving that front desk can create and submit a report with `inspectionTeamId` and no inspector, that a selected inspector must belong to the team, that a mechanic can read an inspector-less report assigned to their team, and that a report may contain no finding rows when `summaryZh` contains the single inspection result.

- [ ] **Step 2: Run the focused service test and verify RED**

Run: `pnpm vitest run src/modules/inspection-report/inspection-report-service.integration.test.ts --maxWorkers=1`

Expected: failures because migration 0039 and the new input/record fields do not exist.

- [ ] **Step 3: Add migration and schema mapping**

Migration 0039 must add `inspection_team_id bigint`, `special_case_notes_zh text`, backfill the team with `coalesce(repair_round.repair_team_id, inspector.current_team_id)`, abort if any report remains without a team, make the team non-null with a restrictive foreign key, make the inspector nullable, update the submission check, and replace immutable update guards so the new fields cannot be overwritten. Submission no longer requires a finding row.

- [ ] **Step 4: Implement service validation and permissions**

Require a positive active `inspectionTeamId`; normalize optional inspector and special notes; validate inspector/team membership; make front desk/admin writers unrestricted by team; require a mechanic actor's current team to match and any selected inspector to be self. Change mechanic list/detail filters to `report.inspection_team_id` and return the team name.

- [ ] **Step 5: Run the focused service test and verify GREEN**

Run: `pnpm vitest run src/modules/inspection-report/inspection-report-service.integration.test.ts --maxWorkers=1`

Expected: all inspection-report service tests pass.

### Task 2: Formal vehicle search and inspection API contracts

**Files:**
- Modify: `src/modules/customer-vehicle/customer-vehicle-service.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-service.integration.test.ts`
- Modify: `src/app/api/vehicles/route.ts`
- Modify: `src/app/api/vehicles/route.test.ts`
- Modify: `apps/web/src/app/api/formal/vehicles/route.ts`
- Modify: `src/app/api/inspection-reports/route.ts`
- Modify: `src/app/api/inspection-reports/route.test.ts`
- Modify: `apps/web/src/lib/customers/formal-customer-vehicle-adapter.ts`
- Modify: `apps/web/src/lib/api/formal-inspections.ts`
- Modify: `apps/web/tests/unit/formal-inspections.spec.ts`

**Interfaces:**
- Consumes: `CustomerVehicleService.listVehicles` and `InspectionReportService.createInspectionReport`.
- Produces: `fetchFormalVehicleSearch(search, signal?)` and the new formal inspection creation payload.

- [ ] **Step 1: Add failing route and client tests**

Test that unauthenticated vehicle search returns 401, normalized partial plate search requests only active vehicles with a maximum page size of 8, and inspection POST accepts team plus nullable inspector and special notes while rejecting a missing team.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run src/app/api/vehicles/route.test.ts src/app/api/inspection-reports/route.test.ts --maxWorkers=1`

Run: `pnpm --dir apps/web test:unit -- --grep "formal inspections"`

Expected: failures because GET vehicle search and the new inspection contract are absent.

- [ ] **Step 3: Implement active vehicle search**

Extend `listVehicles` with optional `activeOnly`; apply it to both count and item SQL. Add authenticated GET handling on `/api/vehicles` using `search`, page 1, and a clamped page size no greater than 8. Re-export GET from the formal route and add a typed client helper using `AbortSignal` and `cache: "no-store"`.

- [ ] **Step 4: Implement inspection POST contract**

Require `vehicleId`, `inspectionTeamId`, and `summaryZh`; accept nullable `actualInspectorStaffMemberId`, optional `specialCaseNotesZh`, optional source Business Order, and an optional findings array for compatibility. Forward normalized values to the formal service.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 2 focused root and Web commands again and require all tests to pass.

### Task 3: Searchable inspection dialog and missing-vehicle creation

**Files:**
- Create: `apps/web/src/lib/orders/formal-inspection-intake.ts`
- Create: `apps/web/tests/unit/formal-inspection-intake.spec.ts`
- Modify: `apps/web/src/components/orders/formal-inspection-create-dialog.tsx`
- Modify: `apps/web/src/components/customers/form-dialogs.tsx`
- Modify: `apps/web/src/components/orders/formal-inspection-report-detail.tsx`
- Modify: `apps/web/src/components/orders/formal-inspection-reports-workspace.tsx`

**Interfaces:**
- Consumes: `fetchFormalVehicleSearch`, `fetchFormalMasterData`, `VehicleFormDialog`, and `createFormalInspectionReport`.
- Produces: a selected formal vehicle, required team, optional team-filtered inspector, one inspection result, and optional special-case notes.

- [ ] **Step 1: Add failing pure behavior tests**

Test plate query normalization, empty-query suppression, team-filtered active mechanic candidates, and clearing a selected inspector when the selected team changes.

- [ ] **Step 2: Run the intake unit test and verify RED**

Run: `pnpm --dir apps/web test:unit -- --grep "formal inspection intake"`

Expected: failure because the intake helper does not exist.

- [ ] **Step 3: Implement pure intake helpers**

Export deterministic helpers for normalized plate query and team-filtered staff. Keep network and React state out of this module.

- [ ] **Step 4: Replace the vehicle select with an accessible search combobox**

Debounce non-empty plate input by 250 ms, cancel stale searches with `AbortController`, display loading/error/empty/result states, and preserve the selected vehicle until the user edits the query. Empty input must never fetch or render the full vehicle directory.

- [ ] **Step 5: Reuse formal vehicle creation**

Add optional `initialPlate` to `VehicleFormDialog`. Lazily load/adapt the formal customer workspace only when “新建车辆” is chosen. After `onSaved`, use the returned formal vehicle id to select it, close the nested form, and keep the existing inspection form state.

- [ ] **Step 6: Implement team, optional mechanic, result, and special note controls**

Render active team choices; filter active staff by selected team; clear an invalid inspector on team changes. Submit `inspectionTeamId`, nullable inspector, `summaryZh`, `specialCaseNotesZh`, and an empty findings array. Disable submit only when vehicle, team, or result is missing or a request is busy.

- [ ] **Step 7: Update list/detail presentation**

Show the submitting team as the primary inspection attribution and the mechanic as optional. Label `summaryZh` “检查结果”; show `specialCaseNotesZh` separately; keep legacy finding/recommendation sections when historical data contains them.

- [ ] **Step 8: Run focused Web tests and verify GREEN**

Run: `pnpm --dir apps/web test:unit -- --grep "formal inspection"`

Expected: all focused formal inspection tests pass.

### Task 4: Legacy formal page compatibility

**Files:**
- Modify: `src/app/(protected)/inspection-reports/page.tsx`
- Modify: `src/app/(protected)/inspection-reports/actions.ts`
- Modify: `src/app/(protected)/business-orders/pages.test.tsx`

**Interfaces:**
- Consumes: the new inspection service input contract.
- Produces: a compiling server-rendered fallback page with required team, optional inspector, one result, and special notes.

- [ ] **Step 1: Add or update failing page/action assertions**

Assert that the fallback form supplies `inspectionTeamId`, does not require the inspector, and sends one `summaryZh` result plus `specialCaseNotesZh`.

- [ ] **Step 2: Run the focused page test and verify RED**

Run: `pnpm vitest run 'src/app/(protected)/business-orders/pages.test.tsx' --maxWorkers=1`

- [ ] **Step 3: Update the fallback page and action**

Load active repair teams, filter optional mechanics by the chosen team where possible, and pass the new service contract without creating duplicate findings.

- [ ] **Step 4: Run the focused page test and verify GREEN**

Run the Task 4 focused command again and require it to pass.

### Task 5: Data protection, migration, and full acceptance

**Files:**
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`
- Create: `apps/web/docs/screenshots/formal-inspection-intake-20260829.png`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: migrated candidate data, automated evidence, browser evidence, and a restart-safe handoff.

- [ ] **Step 1: Create and verify a cold candidate backup**

Stop only the candidate runtime, archive `.runtime/postgresql` and `.runtime/uploads` under a timestamped directory in `/Volumes/公司文件/Whole Hearted Car Service 单体候选/backups/`, write `SHA256SUMS`, and run `shasum -a 256 -c SHA256SUMS` before migration.

- [ ] **Step 2: Apply migration 0039 to port 55433**

Start the candidate runtime from this worktree so Drizzle applies migration 0039. Query the migration table and verify inspection report counts, non-null team counts, nullable inspector behavior, and unchanged historical finding counts.

- [ ] **Step 3: Run automated verification**

Run focused service/route/Web tests, root `pnpm typecheck`, `pnpm --dir apps/web typecheck`, modified-scope ESLint, `pnpm build`, and `git diff --check`.

- [ ] **Step 4: Run browser acceptance on 3220**

In the actual authenticated candidate page, verify partial plate search, matched selection, no-result new vehicle entry with prefilled plate, automatic return after creation, required team, optional team-filtered mechanic, one result field, special notes, successful creation, refresh persistence, detail attribution, responsive layout, and no related console errors.

- [ ] **Step 5: Update the continuation handoff**

Record the confirmed behavior, backup path and checksums, migration number, commands and counts, browser evidence, and any remaining limitation in `docs/CONTINUATION_ENTRYPOINT.md`.

- [ ] **Step 6: Create a scoped Git checkpoint**

Stage only files belonging to this feature, inspect the staged diff, commit with `feat: refine formal inspection intake`, and leave unrelated existing changes untouched.
