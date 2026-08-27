# Formal Demo Data Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disconnected bulk Mock dataset with a small editable and calculable formal PostgreSQL demo baseline.

**Architecture:** Extend the formal vehicle aggregate and APIs first, adapt the 3210 UI to those formal records, then reset and seed only coherent business facts through formal services. Browser Mock storage is cleared after the formal build is live.

**Tech Stack:** Next.js, React, TypeScript, PostgreSQL, Drizzle migrations, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-formal-demo-data-reset-design.md`

## Global Constraints

- Persistent project files remain under `/Volumes/公司文件`.
- Preserve the only super administrator account and credentials.
- Do not preserve or migrate old Mock business facts.
- Do not create a repair team, mechanic account, handoff, performance, receivable, payment, refund, or parking fact in the baseline.
- All vehicle fields visible in the editor must persist through formal APIs.

---

### Task 1: Extend the formal vehicle aggregate

**Files:**
- Modify: `src/db/schema/customer-vehicle.ts`
- Create: `drizzle/0016_vehicle_profile_fields.sql`
- Modify: `src/modules/customer-vehicle/customer-vehicle-schemas.ts`
- Modify: `src/modules/customer-vehicle/customer-vehicle-service.ts`
- Test: `src/modules/customer-vehicle/customer-vehicle-service.integration.test.ts`

**Interfaces:**
- Produces: `VehicleRecord` fields `engineNumber`, `makeZh`, `modelZh`, `bodyType`, `fuelType`, `engineCc`, `seating`, `usage`, `specialNotes`.

- [ ] Add a failing integration test that creates, reads and updates every formal vehicle profile field.
- [ ] Run the targeted integration test and confirm the new fields are missing.
- [ ] Add nullable PostgreSQL columns and matching Drizzle schema fields; do not add variant, powertrain or manually editable presence status.
- [ ] Extend Zod create/update schemas, service SQL, row mapping and audit payloads.
- [ ] Generate/apply migration 0016 and run the targeted integration test.

### Task 2: Make formal vehicle APIs and UI fully editable

**Files:**
- Modify: `src/app/api/vehicles/route.ts`
- Modify: `src/app/api/vehicles/[vehicleNo]/route.ts`
- Modify: `apps/web/src/app/api/formal/vehicles/route.ts`
- Modify: `apps/web/src/app/api/formal/vehicles/[vehicleNo]/route.ts`
- Modify: `apps/web/src/lib/customers/formal-customer-vehicle-adapter.ts`
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/components/customers/form-dialogs.tsx`
- Modify: `apps/web/src/components/customers/vehicle-detail-page.tsx`
- Test: matching API, unit and browser tests.

**Interfaces:**
- Consumes: extended `VehicleRecord` from Task 1.
- Produces: formal create/read/update round-trip for every visible vehicle field.

- [ ] Add failing API and adapter tests for rich vehicle fields and PATCH persistence.
- [ ] Route formal vehicle create, detail and update requests through 3210 proxies.
- [ ] Remove version/configuration and powertrain from detail rendering; show year alone, fuel with displacement, seats alone, and Chinese enums.
- [ ] Run API, adapter and UI tests.

### Task 3: Switch customer and vehicle pages to formal data

**Files:**
- Create: `apps/web/.env.production.local`
- Modify: `apps/web/src/lib/api/client.ts`
- Test: `apps/web/tests/unit/formal-customer-vehicle-adapter.spec.ts`

**Interfaces:**
- Produces: 3210 customer/vehicle workspaces whose source of truth is PostgreSQL on 3211.

- [ ] Enable `NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE=true` for the production preview.
- [ ] Prohibit silent fallback to Mock when formal reads or writes fail.
- [ ] Test customer and vehicle create/update adapters.

### Task 4: Reset and seed a coherent formal demo baseline

**Files:**
- Create: `scripts/reset-formal-demo-data.ts`
- Modify: `package.json`
- Test: `scripts/reset-formal-demo-data.test.ts`

**Interfaces:**
- Produces: `pnpm demo:reset` with a dry-run summary and an explicit `--apply` mutation mode.

- [ ] Add a failing test for allowed tables, preserved staff accounts and deterministic seed totals.
- [ ] Implement dependency-ordered deletion limited to business/demo tables.
- [ ] Seed one individual customer/vehicle, one company/contact/vehicle, charge units and one draft Business Order through formal services.
- [ ] Re-read all seeded rows and assert foreign keys, totals and zero prohibited facts.
- [ ] Run dry-run, inspect exact scope, then run `pnpm demo:reset -- --apply`.

### Task 5: Clear browser Mock residue and acceptance-test 3210

**Files:**
- Modify only browser storage for `http://localhost:3210` during verification.

**Interfaces:**
- Consumes: formal build and seeded database from Tasks 1-4.
- Produces: visible, editable, refresh-persistent demo workflow.

- [ ] Build the backend and web app, restart only listeners on 3211 and 3210.
- [ ] Clear this project's Mock localStorage/IndexedDB keys without clearing unrelated browser/site data.
- [ ] Verify customer list/detail/edit, vehicle list/detail/edit and draft Business Order charge calculation.
- [ ] Verify dashboard receivable, performance, payments, refunds and parking values remain zero.
- [ ] Capture final URLs, console status, listener PIDs and test outputs.
