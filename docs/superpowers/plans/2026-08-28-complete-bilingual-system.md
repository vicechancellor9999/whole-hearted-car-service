# Complete Bilingual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete Chinese and English employee experience across every reachable Whole Hearted workflow without changing formal business facts.

**Architecture:** Replace the current Chinese-string lookup with typed message keys, locale-aware formatting, account-persisted language preference, domain-code presentation adapters, and explicit original-content boundaries. Migrate reachable surfaces by domain and enforce completeness with catalog parity plus rendered English no-Han audits.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript 5.9, PostgreSQL/Drizzle, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-complete-bilingual-system-design.md`

## Global Constraints

- Preserve the 3210 interface structure and all existing business behavior.
- Work only in the existing isolated candidate worktree and candidate PostgreSQL on port 55433.
- Preserve user-entered source facts and mark them explicitly; never silently translate or overwrite them.
- English UI must never fall back to Chinese system copy.
- Follow TDD: each behavior test must fail for the expected missing behavior before production code changes.
- Read relevant Next.js 16 documentation before changing App Router, cookies, Route Handlers, or client/server boundaries.

---

### Task 1: Typed i18n core and completeness contract

**Files:**
- Create: `apps/web/src/lib/i18n/messages/zh.ts`
- Create: `apps/web/src/lib/i18n/messages/en.ts`
- Create: `apps/web/src/lib/i18n/catalog.ts`
- Create: `apps/web/src/lib/i18n/format.ts`
- Modify: `apps/web/src/lib/i18n/language.tsx`
- Test: `apps/web/tests/unit/i18n-catalog.spec.ts`

**Interfaces:**
- Produces: `MessageKey`, `MessageVariables`, `translate(key, language, variables)`, `useI18n()`, `formatDate`, `formatNumber`, and `formatMoney`.
- Guarantees: catalogs have identical keys; missing keys and variables fail tests; root `lang` follows `zh-CN` or `en-JM`.

- [ ] Write catalog parity, interpolation, missing-key, locale-format and root-language tests.
- [ ] Run the focused test and confirm failures are caused by the absent typed catalog and APIs.
- [ ] Implement the minimal typed catalog, formatter and Provider APIs.
- [ ] Migrate existing account-settings and shell messages to stable keys.
- [ ] Run focused tests and existing language/theme tests.
- [ ] Commit the i18n core.

### Task 2: Persist formal account language (completed)

**Files:**
- Create: `drizzle/0037_staff_account_ui_language.sql`
- Modify: `src/db/schema/accounts.ts`
- Modify: `src/modules/auth/auth-service.ts`
- Modify: `src/modules/auth/session-repository.ts`
- Create: `src/app/api/auth/preferences/route.ts`
- Create: `apps/web/src/app/api/formal/auth/preferences/route.ts`
- Modify: `apps/web/src/components/layout/identity-switcher.tsx`
- Modify: `apps/web/src/components/layout/account-settings-popover.tsx`
- Test: `src/modules/auth/account-language-preference.integration.test.ts`
- Test: `apps/web/tests/unit/account-language-preference.spec.ts`

**Interfaces:**
- Session payload adds `account.uiLanguage: "zh" | "en"`.
- `PATCH /api/formal/auth/preferences` accepts exactly `{ uiLanguage }` and returns the saved preference.

- [ ] Write failing database, session and API tests for default, update, authorization, invalid input and persistence.
- [ ] Run them and verify expected failures.
- [ ] Add migration, Drizzle field, repository mapping, service update, audit and Route Handler.
- [ ] Make the Provider reconcile cached language with the authenticated account and save formal changes.
- [ ] Run focused backend and Web tests.
- [ ] Apply migration only to candidate PostgreSQL after a verified runtime backup.
- [ ] Commit account-language persistence.

### Task 3: Shared chrome, authentication and overview

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/components/layout/mobile-nav.tsx`
- Modify: `apps/web/src/components/layout/page-header.tsx`
- Modify: `apps/web/src/components/layout/live-clock.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/pc-not-available/page.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/dashboard/*.tsx`
- Modify: `apps/web/src/components/workbench/workbench-workspace.tsx`
- Test: `apps/web/tests/e2e/language-shell-and-dashboard.spec.ts`

**Interfaces:**
- Consumes: `useI18n()` and stable domain label helpers.
- Produces: fully localized shared chrome and first post-login workflows.

- [ ] Write failing English rendered-copy tests for login, shell, dashboard and workbench.
- [ ] Confirm each fails on current Chinese system copy.
- [ ] Add message keys and migrate components without changing layout or business calculations.
- [ ] Mark customer and employee names as source facts, not system copy.
- [ ] Run focused tests and visual route checks in both languages.
- [ ] Commit the shared bilingual experience.

### Task 4: Performance, revenue, employees, dictionaries and settings

**Files:**
- Modify: `apps/web/src/components/performance/*.tsx`
- Modify: `apps/web/src/components/revenue/*.tsx`
- Modify: `apps/web/src/app/employees/page.tsx`
- Modify: `apps/web/src/app/dictionaries/page.tsx`
- Modify: `apps/web/src/app/settings/page.tsx`
- Modify: `apps/web/src/components/settings/*.tsx`
- Test: `apps/web/tests/e2e/language-administration.spec.ts`

**Interfaces:**
- Produces bilingual performance status, target diagnostics, charts, staff forms, master data and AI settings.

- [ ] Write failing English route and dialog tests covering loading, empty, success, validation and error states.
- [ ] Confirm failures identify untranslated system copy.
- [ ] Migrate each surface and add domain status translators.
- [ ] Display business dictionary English values or `Translation required`; never Chinese fallback.
- [ ] Run focused tests and inspect representative desktop and mobile screens.
- [ ] Commit administration localization.

### Task 5: Customers and vehicles

**Files:**
- Modify: `apps/web/src/components/customers/*.tsx`
- Modify: `apps/web/src/app/customers/**/*.tsx`
- Modify: `apps/web/src/app/vehicles/**/*.tsx`
- Test: `apps/web/tests/e2e/language-customers-vehicles.spec.ts`

**Interfaces:**
- Produces bilingual directory, creation, license recognition, verification, evidence, archive, vehicle and deletion flows.
- Marks source customer/company/address/file content with `data-user-content` and language metadata.

- [ ] Write failing English tests for list, detail, create, edit, upload, drag/paste, verification, deletion and all error states.
- [ ] Confirm current mixed-language failures.
- [ ] Migrate all active formal customer and vehicle components to stable keys.
- [ ] Add original-content presentation boundaries without changing stored values.
- [ ] Run focused customer/vehicle unit and E2E tests.
- [ ] Commit customer and vehicle localization.

### Task 6: Business Orders, inspections, payments and parking

**Files:**
- Modify: `apps/web/src/components/orders/*.tsx`
- Modify: `apps/web/src/components/payments/*.tsx`
- Modify: `apps/web/src/components/parking/*.tsx`
- Modify: `apps/web/src/app/orders/**/*.tsx`
- Modify: `apps/web/src/app/payments/page.tsx`
- Modify: `apps/web/src/app/parking/**/*.tsx`
- Test: `apps/web/tests/e2e/language-business-workflows.spec.ts`

**Interfaces:**
- Produces fully bilingual Business Order lists/detail tabs, charge editing, repair rounds, attachments, comments, inspections, payment/refund/release and parking UI.
- Preserves separate Chinese/English frozen document selection.

- [ ] Write failing English tests for all four Business Order tabs and each mutation dialog.
- [ ] Write failing English tests for inspection, payment/refund/release and parking paths.
- [ ] Confirm failures are untranslated system copy rather than fixture business content.
- [ ] Migrate active formal components, status adapters, validation and toast copy.
- [ ] Mark comments, notes and uploaded filenames as source content and expose non-destructive translation availability.
- [ ] Run focused tests including existing PDF, finance, collaboration and deletion suites.
- [ ] Commit core workflow localization.

### Task 7: Remaining reachable pages and coded API errors

**Files:**
- Modify: `apps/web/src/components/ui/page-placeholder.tsx`
- Modify: `apps/web/src/app/attachments/page.tsx`
- Modify: `apps/web/src/app/company/**/*.tsx`
- Modify: `apps/web/src/app/mentions/page.tsx`
- Modify: `apps/web/src/app/notifications/page.tsx`
- Modify: `apps/web/src/app/procurement/**/*.tsx`
- Modify: `apps/web/src/app/quotes/page.tsx`
- Modify: `apps/web/src/app/tasks/page.tsx`
- Modify: `apps/web/src/lib/api/*.ts`
- Modify: affected `src/app/api/**/*.ts` handlers
- Test: `apps/web/tests/e2e/language-remaining-routes.spec.ts`
- Test: `apps/web/tests/unit/localized-api-errors.spec.ts`

**Interfaces:**
- Produces localized placeholders and `localizeApiError(code, variables, language)` for stable formal error contracts.

- [ ] Write failing tests for all remaining route headings/actions and representative 400/401/403/404/409/500 errors.
- [ ] Confirm failures expose Chinese fallback or raw server copy.
- [ ] Migrate remaining surfaces and map stable API error codes to localized messages.
- [ ] Keep unknown server text out of user-facing English errors.
- [ ] Run focused tests.
- [ ] Commit remaining routes and error localization.

### Task 8: No-leak audit, full regression and candidate acceptance

**Files:**
- Create: `apps/web/tests/e2e/helpers/assert-no-system-han.ts`
- Create: `apps/web/tests/e2e/english-ui-audit.spec.ts`
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`
- Modify: `docs/acceptance/FORMAL_SYSTEM_END_TO_END_ACCEPTANCE.md`

**Interfaces:**
- `assertNoSystemHan(page)` inspects visible text and accessible attributes, excluding only explicit source-content nodes.

- [ ] Write the audit against every reachable route and confirm it fails before the remaining gaps are fixed.
- [ ] Fix every reported system-owned Chinese leak through message keys, not DOM rewriting.
- [ ] Run catalog parity, English route audit, language persistence, theme, PDF, collaboration and deletion suites.
- [ ] Run full Web unit tests, full formal backend tests with controlled workers, root/Web typecheck, lint, production build and `git diff --check`.
- [ ] Restart candidate 3220 from the verified production build and verify `/login`, authenticated English paths, console state and account persistence.
- [ ] Update continuation and acceptance evidence with exact commands and results.
- [ ] Commit the verified bilingual system.
