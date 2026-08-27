# Whole Hearted 3210 Single Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the current 3210 PC interface, formal authentication, all currently connected formal APIs, PostgreSQL, attachments, and target calculations through one Next.js 16 application.

**Architecture:** Upgrade `apps/web` in place so the accepted 3210 interface remains the application shell. Import the repository's formal server code through `@formal/*`, replace network forwarding routes with direct same-process handlers, and validate a production candidate on port 3220 against an isolated restored database.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript 5.9.3, PostgreSQL 18, Drizzle ORM, pnpm 11, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-3210-canonical-single-app-design.md`

## Global Constraints

- The accepted UI source is `apps/web`; preserve its routes, layout, menus, styles, print surfaces, and interaction order.
- All generated workspaces, caches, restored data, screenshots, and reports stay under `/Volumes/公司文件`.
- Do not modify `/Volumes/公司文件/Whole Hearted Car Service 安全备份/2026-08-27_045158_EST_3210当前完整版本`.
- Develop on an isolated Git worktree and branch; leave the current 3210, 3211, database on 5432, and current uploads running.
- The candidate uses port 3220, an isolated PostgreSQL port, and an isolated upload directory.
- Use `@/*` for `apps/web/src/*` and `@formal/*` for root `src/*`; formal server modules must never enter client bundles.
- `/api/formal/*` remains the UI compatibility namespace but performs no localhost HTTP forwarding.
- Use the existing `wh_session` cookie, formal permissions, database sessions, and audit behavior.
- Apply TDD to new behavior: observe the relevant test fail before implementation, then pass.
- Do not cut over port 3210 until the candidate passes automated and browser acceptance and the user reviews it.

---

### Task 1: Create and verify the isolated implementation workspace

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime/`
- Create ignored runtime config: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime/.env.local`
- Restore externally inside worktree: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime/.runtime/postgresql/`
- Restore externally inside worktree: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime/.runtime/uploads/`

**Interfaces:**
- Consumes: Git commit containing this plan and the frozen backup archive.
- Produces: isolated branch `codex/3210-single-runtime`, isolated database endpoint, and a clean test baseline.

- [ ] **Step 1: Verify the external volume and source branch**

```bash
test -w /Volumes/公司文件
test -z "$(git status --porcelain)"
git rev-parse --verify HEAD
git worktree list --porcelain
```

Expected: external volume writable, current source clean, and no existing candidate worktree at the target path.

- [ ] **Step 2: Create the worktree without touching the current checkout**

```bash
mkdir -p '/Volumes/公司文件/Whole Hearted Car Service 单体候选'
git worktree add '/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime' -b codex/3210-single-runtime
```

Expected: new worktree on the named branch under the external volume.

- [ ] **Step 3: Restore an isolated runtime copy**

Extract only `.runtime/postgresql` and `.runtime/uploads` from the frozen `runtime-data.tar.gz` into the candidate worktree. Copy the current ignored root `.env.local` to the candidate worktree without printing it, then change only the database port, `APP_ORIGIN`, and upload path for the candidate.

Expected environment properties:

```text
DATABASE_URL host = 127.0.0.1
DATABASE_URL port = 55433
APP_ORIGIN = http://127.0.0.1:3220
UPLOAD_ROOT = /Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime/.runtime/uploads
```

- [ ] **Step 4: Verify the baseline before implementation**

```bash
pnpm test
pnpm typecheck
pnpm --dir apps/web test:unit
pnpm --dir apps/web typecheck
```

Expected: existing root and 3210 test suites pass. If a baseline failure appears, record it before attributing any later failure to this plan.

### Task 2: Upgrade the accepted application to Next.js 16

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/package.json`
- Delete after workspace lock is verified: `apps/web/package-lock.json`
- Delete after workspace lock is verified: `apps/web/pnpm-lock.yaml`
- Rename: `apps/web/next.config.mjs` → `apps/web/next.config.ts`
- Rename: `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts`
- Modify mechanically for asynchronous request APIs: `apps/web/src/app/**/*.tsx`
- Modify mechanically for asynchronous route parameters: `apps/web/src/app/api/**/*.ts`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/AGENTS.md`

**Interfaces:**
- Consumes: the existing Next.js 14 App Router UI.
- Produces: the same routes and rendered UI compiled by Next.js 16.3.2 and React 19.2.8 from the root pnpm lock.

- [ ] **Step 1: Record the pre-upgrade behavior**

Run the current 3210 unit suite, typecheck, and production build and retain their exit codes in the external candidate verification directory.

- [ ] **Step 2: Apply the documented framework migration**

Use the installed Next.js 16 upgrade guidance. Align `next`, `react`, `react-dom`, TypeScript, React types, ESLint, and Playwright with root versions; add `apps/web` to the root workspace; migrate `middleware` to `proxy`; convert synchronous request APIs and dynamic `params`/`searchParams` to promises.

The target Proxy signature is:

```ts
export function proxy(request: NextRequest) {
  if (request.cookies.has("wh_session")) return NextResponse.next();
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}
```

- [ ] **Step 3: Configure the monorepo tracing root**

`apps/web/next.config.ts` must set `output: "standalone"`, `outputFileTracingRoot` to the repository root, and `turbopack.root` to the repository root so formal modules outside `apps/web` resolve and ship with the build.

- [ ] **Step 4: Install once from the root lock and verify**

```bash
pnpm install
pnpm --dir apps/web typecheck
pnpm --dir apps/web test:unit
pnpm --dir apps/web build
```

Expected: typecheck, existing UI tests, and Next.js 16 production build pass without a framework error.

- [ ] **Step 5: Commit the framework migration**

```bash
git add -- pnpm-workspace.yaml package.json pnpm-lock.yaml apps/web
git diff --cached --check
git commit -m 'build: upgrade 3210 app to Next.js 16'
```

### Task 3: Make formal server modules importable by the 3210 application

**Files:**
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `apps/web/tsconfig.json`
- Modify mechanically: `src/db/**/*.ts`
- Modify mechanically: `src/lib/**/*.ts`
- Modify mechanically: `src/modules/**/*.ts`
- Modify mechanically: `src/app/api/**/*.ts`

**Interfaces:**
- Produces: `@formal/*` resolving to root `src/*` in root tests and the 3210 application.
- Preserves: root UI's existing `@/*` imports and all formal service APIs.

- [ ] **Step 1: Add the alias in both TypeScript projects and Vitest**

Root TypeScript and Vitest:

```ts
"paths": {
  "@/*": ["./src/*"],
  "@formal/*": ["./src/*"]
}
```

3210 TypeScript:

```ts
"paths": {
  "@/*": ["./src/*"],
  "@formal/*": ["../../src/*"]
}
```

- [ ] **Step 2: Mechanically change server-internal aliases**

Within `src/db`, `src/lib`, `src/modules`, and `src/app/api`, change imports beginning `@/db`, `@/lib`, `@/modules`, or `@/app/api` to the corresponding `@formal/...` import. Do not change root page/component imports outside this server boundary.

- [ ] **Step 3: Verify the formal service boundary**

```bash
pnpm test
pnpm typecheck
pnpm --dir apps/web typecheck
```

Expected: all formal tests pass and the 3210 compiler resolves the shared server source.

- [ ] **Step 4: Commit the server import boundary**

```bash
git add -- tsconfig.json vitest.config.ts apps/web/tsconfig.json src
git diff --cached --check
git commit -m 'refactor: expose formal server modules to the unified app'
```

### Task 4: Replace HTTP forwarding with same-process Route Handlers

**Files:**
- Modify: `apps/web/src/app/api/formal/**/*.ts`
- Delete: `apps/web/src/lib/api/formal-backend-proxy.ts`
- Modify: `apps/web/src/app/api/ai/vehicle-document/settings/route.ts`
- Test: `apps/web/tests/unit/formal-auth-route.spec.ts`

**Interfaces:**
- Consumes: root formal handlers under `@formal/app/api/**`.
- Produces: the existing `/api/formal/*` URL and response contracts without network forwarding.

- [ ] **Step 1: Write the failing login adapter test**

Test the real 3210 login adapter with an injected formal handler. A successful formal response with `set-cookie` must become a 303 redirect to `/`; an invalid-credentials response must become a 303 redirect to `/login?error=invalid_credentials`; no global `fetch` is supplied.

```ts
expect(response.status).toBe(303);
expect(response.headers.get("location")).toBe("http://127.0.0.1:3220/");
expect(response.headers.get("set-cookie")).toContain("wh_session=");
```

- [ ] **Step 2: Run the test and confirm the network implementation fails it**

```bash
pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-auth-route.spec.ts
```

Expected: FAIL because the current route owns a localhost fetch and has no injectable direct handler.

- [ ] **Step 3: Implement direct authentication adapters**

Call `@formal/app/api/auth/login/route` in process, then preserve the 3210 redirect behavior and returned Cookie. Do the same for logout and session. Export the adapter factory used by the test; production `POST`/`GET` supplies the formal handler.

- [ ] **Step 4: Re-export or directly call every formal business handler**

For compatible routes, use direct exports such as:

```ts
export { GET } from "@formal/app/api/dashboard/route";
```

For route-name differences or UI response adaptation, call the formal handler directly and preserve the UI contract. Cover authentication, dashboard, customers, vehicles, customer-vehicles, business orders, rounds, charges, finance, payments, refunds, documents, receipts, inspection reports, master data, parking, performance, revenue, and vehicle attachments.

- [ ] **Step 5: Use the formal session reader in AI settings**

Replace its localhost session fetch with `currentSession()` from `@formal/modules/auth/current-session`, then enforce `super_admin` from the returned formal account.

- [ ] **Step 6: Verify unit and type contracts**

```bash
pnpm --dir apps/web test:unit
pnpm --dir apps/web typecheck
pnpm test
```

Expected: direct authentication test and all existing root/UI tests pass.

- [ ] **Step 7: Commit the single-process API boundary**

```bash
git add -- apps/web/src/app/api apps/web/src/lib/api/formal-backend-proxy.ts apps/web/tests/unit/formal-auth-route.spec.ts
git diff --cached --check
git commit -m 'feat: run formal APIs inside the 3210 application'
```

### Task 5: Calculate and explain monthly performance targets

**Files:**
- Create: `src/modules/performance/performance-target.ts`
- Test: `src/modules/performance/performance-target.test.ts`
- Modify: `src/modules/performance/performance-service.ts`
- Modify: `src/modules/performance/performance-service.integration.test.ts`
- Modify: `src/modules/dashboard/dashboard-service.ts`
- Modify: `src/modules/dashboard/dashboard-service.test.ts`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/api/formal-performance.ts`
- Modify: `apps/web/src/components/dashboard/team-performance.tsx`
- Modify: `apps/web/src/components/performance/performance-workspace.tsx`
- Test: `apps/web/tests/unit/formal-dashboard.spec.ts`
- Test: `apps/web/tests/unit/formal-performance.spec.ts`
- Test: `apps/web/tests/unit/team-performance.spec.ts`

**Interfaces:**
- Produces: configured target amounts and completion rates, or exact `targetMissingReasons: string[]`.
- Formula: `salary CNY / commission rate * CNY-to-JMD rate` summed by team.

- [ ] **Step 1: Write failing pure calculation tests**

Cover literal hand-calculated cases:

```ts
expect(calculatePerformanceTargets({
  commissionRate: 0.25,
  cnyToJmdRate: 22,
  members: [{ teamId: 7, teamName: "维修一组", memberId: 3, memberName: "张三", salaryCnyMinor: 200_000 }],
})).toMatchObject({
  targetStatus: "configured",
  targetPerformanceMinor: 17_600_000,
});
```

Also cover missing parameter version, missing salary, zero target, and two-team summation. Expected values must be literals derived by hand.

- [ ] **Step 2: Run the pure test and observe the missing-module failure**

```bash
pnpm vitest run src/modules/performance/performance-target.test.ts
```

Expected: FAIL because `performance-target.ts` does not exist.

- [ ] **Step 3: Implement the minimal target calculator**

Return configured amounts only when the parameter version and every included member salary exist. Otherwise return `not_configured`, null amount/rate, and stable Chinese missing reasons.

- [ ] **Step 4: Write failing service integration tests**

Seed a parameter version, salary version, and team assignment, then assert PerformanceService and DashboardService return the hand-calculated target and rate. Seed a member without salary and assert the named missing reason.

- [ ] **Step 5: Query effective monthly versions and integrate the calculator**

Select the latest payroll parameter, salary, and team assignment versions effective on or before the requested month. Include members whose employment dates overlap the month. Map the calculator result into both dashboard and performance DTOs.

- [ ] **Step 6: Update the 3210 displays**

Configured state shows actual amount, target amount, completion rate, and progress. Missing state shows the first concrete reason and exposes the remaining reasons accessibly; do not display a generic action label.

- [ ] **Step 7: Run red-to-green verification**

```bash
pnpm vitest run src/modules/performance/performance-target.test.ts src/modules/dashboard/dashboard-service.test.ts src/modules/performance/performance-service.integration.test.ts
pnpm --dir apps/web test:unit
pnpm test
pnpm typecheck
pnpm --dir apps/web typecheck
```

Expected: new calculation, service, and UI tests pass with all existing tests.

- [ ] **Step 8: Commit target calculation**

```bash
git add -- src/modules/performance src/modules/dashboard apps/web/src/lib apps/web/src/components apps/web/tests
git diff --cached --check
git commit -m 'fix: calculate monthly performance targets'
```

### Task 6: Build and run the isolated production candidate

**Files:**
- Create: `scripts/dev-unified.ts`
- Test: `scripts/dev-unified.test.ts`
- Modify: `scripts/local-postgres.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Produces: one command that starts the isolated PostgreSQL and one Next.js candidate on 3220; production scripts point at the 3210 application.

- [ ] **Step 1: Write the failing runtime configuration test**

Assert the runtime resolves its database directory, uploads, Web app directory, port, and `APP_ORIGIN` from explicit candidate environment input, and rejects paths outside `/Volumes/公司文件`.

- [ ] **Step 2: Run the test and observe failure**

```bash
pnpm vitest run scripts/dev-unified.test.ts
```

Expected: FAIL because the unified runtime configuration does not exist.

- [ ] **Step 3: Implement the unified runtime**

Start the candidate embedded PostgreSQL on 55433, apply existing migrations, then spawn `next start` from `apps/web` on 3220. On SIGINT/SIGTERM, stop only the owned Next child and owned candidate PostgreSQL. Root `dev`, `build`, and `start` scripts target the unified app; retain the old backend-only launcher under the explicit script name `dev:legacy-backend` for rollback diagnostics.

- [ ] **Step 4: Remove obsolete environment switches from examples**

Document formal database/session/upload variables and application origin for the one app. Remove `FORMAL_BACKEND_ORIGIN` and public formal-backend toggles from the unified runtime examples.

- [ ] **Step 5: Verify production build and start**

```bash
pnpm build
pnpm run start:candidate
```

Expected: candidate PostgreSQL listens only on its isolated port, one Next.js server listens on 3220, and no candidate process listens on 3211.

- [ ] **Step 6: Commit runtime integration**

```bash
git add -- scripts package.json .env.example apps/web/.env.example
git diff --cached --check
git commit -m 'feat: add unified Whole Hearted runtime'
```

### Task 7: Perform full automated and browser acceptance

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/verification/**`
- Do not commit screenshots, traces, logs, restored databases, credentials, or browser state.

**Interfaces:**
- Consumes: production candidate on 3220 and current reference on 3210.
- Produces: reproducible pass/fail evidence and a candidate left running only if every gate passes.

- [ ] **Step 1: Run the complete automated gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --dir apps/web typecheck
pnpm --dir apps/web test:unit
pnpm build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Prove 3211 is not a candidate dependency**

Start the candidate with `FORMAL_BACKEND_ORIGIN` set to an unreachable address. Log in and request dashboard, performance, parking, customers, vehicles, business orders, inspection reports, payments, revenue, session, and one attachment route from 3220.

Expected: authenticated requests succeed from the isolated database and no request attempts the unreachable address.

- [ ] **Step 3: Verify a reversible write in the isolated database**

Use an existing permitted update flow on an isolated record, reload it, verify persistence, then restore the record through the same formal API. Capture before/after/restored payload hashes without recording credentials.

- [ ] **Step 4: Run Browser validation**

The flow under test is: 3220 login → dashboard renders formal data and target diagnosis → performance renders team facts → one formal detail flow opens and responds without runtime errors.

Check page URL/title, meaningful DOM, framework overlay, console errors/warnings, screenshot evidence, and at least one interaction. Compare 3210 and 3220 at the same desktop viewport; also open one mobile viewport for gross layout regressions.

- [ ] **Step 5: Measure production latency**

Measure at least five warm requests each for dashboard, performance, parking, and a rendered dashboard navigation. Report median and slowest time. Compare with the previously observed two-app development measurements without treating different build modes as an exact benchmark.

- [ ] **Step 6: Verify listener identity and candidate isolation**

```bash
lsof -nP -iTCP:3220 -sTCP:LISTEN
lsof -nP -iTCP:55433 -sTCP:LISTEN
git status --short --branch
```

Expected: one candidate Next listener on 3220, one isolated PostgreSQL listener, no uncommitted source changes, and current 3210/3211 listeners unchanged.

- [ ] **Step 7: Leave a safe handoff**

If every gate passes, leave 3220 running for user review and do not replace 3210. If any gate fails, stop candidate-owned processes, leave 3210/3211 untouched, and report the exact failing gate with evidence.
