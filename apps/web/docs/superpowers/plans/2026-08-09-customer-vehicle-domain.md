# Customer Vehicle Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the customer and vehicle domain, persistent Mock store, permission boundary, save workflows, and API contracts that the parallel WorkBuddy UI can consume.

**Architecture:** Domain types and selectors live under `src/lib/customers`; a storage-backed Mock store owns seed data, validation, preview tokens, revision checks, audit history, and fault injection. `src/lib/api/client.ts` only dispatches typed routes and derives access from the existing session. WorkBuddy owns all customer UI files.

**Tech Stack:** TypeScript 5.5, Next.js 14 Mock request layer, Playwright test runner used for unit contracts.

## Global Constraints

- Work only in `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/customer-vehicle-management` on `feat/customer-vehicle-management`.
- Never edit `src/app/customers/page.tsx` or `src/components/customers/**`.
- Never reuse or stop port 3002; integration QA uses an isolated port.
- The relationship model stores history and permits multiple active relationships until the user confirms the single-current-customer rule.
- Every production behavior starts with a failing test.

---

### Task 1: Read model, seed, permissions, and selectors

**Files:**
- Create: `src/lib/customers/types.ts`
- Create: `src/lib/customers/selectors.ts`
- Create: `src/lib/api/mock-customers.ts`
- Test: `tests/unit/customers-store.spec.ts`

**Interfaces:**
- Produces: `CustomerVehicleWorkspaceResponse`, `CustomerRecord`, `VehicleRecord`, `VehicleCustomerRelationship`, `createMockCustomerVehicleStore()`, `searchCustomers()`, `searchVehicles()`.

- [ ] Write RED tests for deterministic summaries, referential integrity, multi-active relationship tolerance, search, full-read permission, and denied-read non-disclosure.
- [ ] Run `npm run test:unit -- tests/unit/customers-store.spec.ts` and verify missing-module/behavior failures.
- [ ] Implement the minimum types, seed, selectors, read permission checks, and cloned read responses.
- [ ] Re-run the focused test to GREEN and run `npm run typecheck`.
- [ ] Commit the independently working read domain.

### Task 2: Customer preview, create, update, audit, and persistence

**Files:**
- Modify: `src/lib/customers/types.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `tests/unit/customers-store.spec.ts`

**Interfaces:**
- Produces: `previewCustomer()`, `createCustomer()`, `updateCustomer()`, `CustomerSavePreview`, `SaveCustomerInput`, optimistic `expectedRevision` updates.

- [ ] Write RED tests proving contact validation, literal duplicate candidates, mandatory duplicate confirmation, exact-input preview token, stale revision rejection, audit creation, atomic persistence failure, reload persistence, and single-use preview token.
- [ ] Run the focused test and verify each new case fails for the named missing behavior.
- [ ] Implement minimal customer normalization, preview registry, atomic state commit, and audit entries.
- [ ] Re-run focused tests to GREEN, then typecheck.
- [ ] Commit the customer save flow.

### Task 3: Vehicle uniqueness, relationship history, and save flow

**Files:**
- Modify: `src/lib/customers/types.ts`
- Modify: `src/lib/api/mock-customers.ts`
- Modify: `tests/unit/customers-store.spec.ts`

**Interfaces:**
- Produces: `previewVehicle()`, `createVehicle()`, `updateVehicle()`, relationship arrays with `startedAt` and nullable `endedAt`.

- [ ] Write RED tests for non-empty plate normalization/uniqueness, plate-less draft tolerance, multiple active relationships, historical relationship preservation, unknown-customer rejection, stale revision, atomic persistence, and audit output.
- [ ] Run the focused test and verify failures come from missing vehicle behavior.
- [ ] Implement minimal validation and save methods without enforcing an active-relationship maximum.
- [ ] Re-run focused tests to GREEN, then typecheck.
- [ ] Commit the vehicle save flow.

### Task 4: Typed Mock API routes and failure contracts

**Files:**
- Create: `tests/unit/customers-api.spec.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/api/mock-customers.ts`

**Interfaces:**
- Produces: `api.customers.workspace/detail/preview/create/update` and `api.vehicles.detail/preview/create/update`.

- [ ] Write RED API tests for allowed/denied/malformed sessions, every path/body identity check, read delay, one-shot failure/retry, and no PII in errors.
- [ ] Run `npm run test:unit -- tests/unit/customers-api.spec.ts` and verify missing-route failures.
- [ ] Add only the customer imports, route dispatch, session capability mapping, and typed public methods to `client.ts`.
- [ ] Re-run customer API/store tests, full unit tests, typecheck, collaboration tests, and `git diff --check`.
- [ ] Commit the domain/API delivery and send the exact contract to the source task for WorkBuddy integration.

### Task 5: Joint integration after WorkBuddy commit

**Files:**
- Modify only after cherry-pick/review: WorkBuddy-owned UI files plus dedicated `tests/e2e/customer-vehicle.spec.ts`.

**Interfaces:**
- Consumes: typed API from Task 4 and WorkBuddy's pure UI commit.

- [ ] Review WorkBuddy's commit for ownership and UI contract compliance.
- [ ] Integrate the commit without accepting unrelated files.
- [ ] Replace local demo handlers with typed API reads/saves and preserve loading/error state.
- [ ] Run E2E on an isolated port, desktop and 430px dark visual QA, full regression, build, and commit.
