# Repair Team Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super administrator drag or keyboard-move repair teams into a persistent global order used everywhere teams are listed.

**Architecture:** Add `sort_order` as the authoritative database field, expose one transactional reorder action that accepts the complete active-team ID sequence, and render accessible reorder controls in the dictionary page. All consumers keep using the existing master-data response, so the saved order propagates globally.

**Tech Stack:** PostgreSQL 18, Drizzle ORM 0.45, Next.js 16 route handlers, React 19, Vitest.

**Spec:** User-approved browser annotation on `/dictionaries` dated 2026-08-28: current alphabetical order is incorrect and the user may directly reorder the list.

## Global Constraints

- Existing teams receive deterministic initial order by numeric `id`.
- New teams append after the current maximum order.
- Reorder input is the complete, unique active-team ID set; partial, duplicate or stale sets return 409.
- Reordering is one transaction and writes one `repair_team.reordered` audit event.
- Dragging is not the only input: every row also has keyboard-operable move-up and move-down buttons.

---

### Task 1: Persisted Sort Order

**Files:**
- Create: `drizzle/0034_repair_team_sort_order.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/master-data.ts`
- Modify: `src/db/schema/master-data.integration.test.ts`

**Interfaces:**
- Produces: `repair_teams.sort_order integer not null`

- [ ] **Step 1: Add a failing schema test**

Assert that `information_schema.columns` reports `sort_order`, that existing rows backfill in `id` order, and that the check constraint rejects negative values.

- [ ] **Step 2: Run the schema test and verify failure**

Run: `pnpm exec vitest run src/db/schema/master-data.integration.test.ts`

Expected: FAIL because `sort_order` is absent.

- [ ] **Step 3: Add the migration and Drizzle field**

Migration sequence: add nullable column; fill `row_number() over (order by id) - 1`; set default `0`, `not null`; add `repair_teams_sort_nonnegative`; replace the active index with `(is_active, sort_order, id)`.

- [ ] **Step 4: Run the schema test**

Run: `pnpm exec vitest run src/db/schema/master-data.integration.test.ts`

Expected: PASS.

### Task 2: Transactional Reorder Service and API

**Files:**
- Modify: `src/modules/master-data/master-data-service.ts`
- Modify: `src/modules/master-data/master-data-service.integration.test.ts`
- Modify: `src/app/api/master-data/route.ts`
- Modify: `src/app/api/master-data/route.test.ts`

**Interfaces:**
- Produces: `reorderRepairTeams(input: { orderedTeamIds: number[]; context: MasterDataActionContext }): Promise<ManagedRepairTeam[]>`
- API action: `{ action: "reorder_teams", orderedTeamIds: number[] }`

- [ ] **Step 1: Add failing service tests**

Test successful reorder, stale/partial ID rejection, duplicate rejection, non-admin rejection, list order, and next-team append order.

- [ ] **Step 2: Run focused service tests and verify failure**

Run: `pnpm exec vitest run src/modules/master-data/master-data-service.integration.test.ts`

- [ ] **Step 3: Implement the service**

Lock `repair_teams` in `share row exclusive` mode, read active IDs ordered by `sort_order,id`, require exact set equality, update each ID to its zero-based position, write one audit event whose `before.teamIds` and `after.teamIds` contain only IDs, then return active teams in new order.

- [ ] **Step 4: Add API dispatch and tests**

Parse only numeric array entries; call `reorderRepairTeams`; preserve service status mapping. Run `pnpm exec vitest run src/app/api/master-data/route.test.ts` and expect PASS.

### Task 3: Accessible Dictionary Reordering

**Files:**
- Modify: `apps/web/src/lib/api/formal-master-data.ts`
- Modify: `apps/web/src/app/dictionaries/page.tsx`
- Modify: `apps/web/tests/unit/formal-master-data.spec.ts`
- Create: `apps/web/tests/unit/repair-team-ordering.spec.ts`

**Interfaces:**
- Produces: `reorderFormalRepairTeams(orderedTeamIds: number[]): Promise<FormalRepairTeam[]>`

- [ ] **Step 1: Add failing client and pure reorder tests**

Assert exact POST body and pure `moveTeam(teams, fromIndex, toIndex)` boundary behavior.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --dir apps/web exec vitest run tests/unit/formal-master-data.spec.ts tests/unit/repair-team-ordering.spec.ts`

- [ ] **Step 3: Implement row interactions**

Add a visible grip, `draggable`, drag-over destination handling, “上移” and “下移” icon buttons with `aria-label`, a `保存排序` button enabled only when order changed, and rollback plus an error notice if the server rejects the save.

- [ ] **Step 4: Run focused tests, typecheck and commit**

Run: `pnpm --dir apps/web exec vitest run tests/unit/formal-master-data.spec.ts tests/unit/repair-team-ordering.spec.ts && pnpm typecheck`

```bash
git add drizzle/0034_repair_team_sort_order.sql drizzle/meta/_journal.json src/db/schema/master-data.ts src/modules/master-data src/app/api/master-data apps/web/src/lib/api/formal-master-data.ts apps/web/src/app/dictionaries/page.tsx apps/web/tests/unit
git commit -m "feat: persist repair team ordering"
```

