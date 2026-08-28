# Whole Hearted Balanced Dual Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver system-wide `system | light | dark` theme modes with the approved balanced neutral palette and consistent semantic surface layering.

**Architecture:** A pure theme contract resolves and migrates the user's mode, while the client provider applies the resolved theme and listens to system changes. CSS and Tailwind expose role-based tokens; shared components and product pages consume those roles so the same component hierarchy works in both palettes. Formal documents retain their own printable document palette.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript 5.9, Tailwind CSS 3.4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-28-balanced-dual-theme-design.md`

## Global Constraints

- Theme modes are exactly `system | light | dark`; the default is `system`.
- The accepted visual direction is the paired A palette in the spec.
- Application structure, business behavior, APIs, permissions, data, and formal business rules stay unchanged.
- Normal text contrast is at least `4.5:1`; large text and essential UI boundaries are at least `3:1`.
- Formal print artifacts use a white-paper document palette in every application theme.
- Persistent generated files remain under `/Volumes/公司文件`.

---

### Task 1: Theme mode contract and migration

**Files:**
- Create: `apps/web/src/components/theme/theme-contract.ts`
- Create: `apps/web/tests/unit/theme-contract.spec.ts`

**Interfaces:**
- Produces: `ThemeMode`, `ResolvedTheme`, `THEME_MODE_STORAGE_KEY`, `THEME_STORAGE_KEY`, `resolveTheme(mode, prefersDark)`, and `readThemeMode(storage)`.
- Consumes: browser-compatible `Pick<Storage, "getItem" | "setItem" | "removeItem">`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { expect, test } from "@playwright/test";
import {
  readThemeMode,
  resolveTheme,
  type ThemeMode,
} from "../../src/components/theme/theme-contract";

test("system mode resolves from the operating-system preference", () => {
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("system", true)).toBe("dark");
});

test("explicit modes ignore the operating-system preference", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("legacy explicit dark migrates to dark mode", () => {
  const values = new Map([["wh_theme", "dark"], ["wh_theme_source", "user"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  expect(readThemeMode(storage)).toBe<ThemeMode>("dark");
  expect(values.get("wh_theme_mode")).toBe("dark");
});

test("new origins use system mode", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  expect(readThemeMode(storage)).toBe<ThemeMode>("system");
  expect(values.get("wh_theme_mode")).toBe("system");
});
```

- [ ] **Step 2: Run the focused unit test and confirm RED**

Run: `cd apps/web && npm run test:unit -- tests/unit/theme-contract.spec.ts`

Expected: FAIL because `theme-contract.ts` does not exist.

- [ ] **Step 3: Implement the pure contract**

```ts
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "wh_theme_mode";
export const THEME_STORAGE_KEY = "wh_theme";
const LEGACY_THEME_SOURCE_KEY = "wh_theme_source";

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function readThemeMode(storage: ThemeStorage): ThemeMode {
  const storedMode = storage.getItem(THEME_MODE_STORAGE_KEY);
  if (storedMode === "system" || storedMode === "light" || storedMode === "dark") return storedMode;
  const legacyTheme = storage.getItem(THEME_STORAGE_KEY);
  const legacySource = storage.getItem(LEGACY_THEME_SOURCE_KEY);
  const migrated: ThemeMode = legacySource === "user" && (legacyTheme === "light" || legacyTheme === "dark")
    ? legacyTheme
    : "system";
  storage.setItem(THEME_MODE_STORAGE_KEY, migrated);
  storage.removeItem(LEGACY_THEME_SOURCE_KEY);
  return migrated;
}
```

- [ ] **Step 4: Run contract tests and typecheck**

Run: `cd apps/web && npm run test:unit -- tests/unit/theme-contract.spec.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the theme contract**

```bash
git add apps/web/src/components/theme/theme-contract.ts apps/web/tests/unit/theme-contract.spec.ts
git commit -m "feat: define system theme modes"
```

### Task 2: Provider, first paint, and three-mode control

**Files:**
- Modify: `apps/web/src/components/theme/theme-provider.tsx`
- Modify: `apps/web/src/components/theme/theme-toggle.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/tests/e2e/theme-and-print-legibility.spec.ts`

**Interfaces:**
- Consumes: Task 1's `ThemeMode`, `ResolvedTheme`, keys, `readThemeMode`, and `resolveTheme`.
- Produces: `useTheme(): { mode, theme, setMode }` and a three-option accessible theme menu.

- [ ] **Step 1: Replace the old E2E expectations with the approved mode behavior**

Add tests that clear theme storage, emulate dark OS preference, and expect `wh_theme_mode=system` with a dark resolved theme. Add explicit light and dark mode persistence tests and a `matchMedia` change test for system mode.

```ts
test("new origins follow the operating-system theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme_mode"))).toBe("system");
});

test("explicit light remains light on a dark operating system", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_theme_mode", "light"));
  await page.goto("/login");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
```

- [ ] **Step 2: Run focused E2E and confirm RED**

Run: `cd apps/web && npm run test:e2e -- tests/e2e/theme-and-print-legibility.spec.ts`

Expected: FAIL because the provider still defaults new origins to light and exposes only a toggle.

- [ ] **Step 3: Implement provider resolution and listeners**

Use `window.matchMedia("(prefers-color-scheme: dark)")`, subscribe to its `change` event only while mode is `system`, update both the root `dark` class and `color-scheme`, persist `wh_theme`, and dispatch `wh:theme-change`. Storage events update the mode and resolved theme across tabs.

- [ ] **Step 4: Implement first-paint resolution in `layout.tsx`**

The inline script must read `wh_theme_mode`, migrate the two legacy keys using Task 1's exact rules expressed in browser-safe JavaScript, resolve system preference, set `document.documentElement.classList`, set `style.colorScheme`, and persist `wh_theme` before React hydrates.

- [ ] **Step 5: Replace the binary toggle with a three-mode accessible menu**

The button label reports the active mode. Its menu uses `role="menu"`; each of `跟随系统`, `柔和亮色`, and `舒适暗色` is a `menuitemradio` with `aria-checked`. Escape closes the menu and restores focus.

- [ ] **Step 6: Run focused E2E, unit tests, and typecheck**

Run: `cd apps/web && npm run test:e2e -- tests/e2e/theme-and-print-legibility.spec.ts && npm run test:unit -- tests/unit/theme-contract.spec.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the theme behavior**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/components/theme/theme-provider.tsx apps/web/src/components/theme/theme-toggle.tsx apps/web/tests/e2e/theme-and-print-legibility.spec.ts
git commit -m "feat: add three-mode theme control"
```

### Task 3: Balanced semantic token foundation

**Files:**
- Create: `apps/web/src/app/theme-tokens.css`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`
- Create: `apps/web/tests/unit/theme-token-contract.spec.ts`

**Interfaces:**
- Produces CSS roles: `--wh-background`, `--wh-shell`, `--wh-layer-1`, `--wh-layer-2`, `--wh-layer-3`, `--wh-border-subtle`, `--wh-border-strong`, `--wh-text-primary`, `--wh-text-secondary`, `--wh-text-tertiary`, `--wh-accent`, interaction roles, and semantic state roles.
- Produces Tailwind aliases: `bg-page`, `bg-shell`, `bg-card`, `bg-layer-2`, `bg-layer-3`, `text-ink`, `text-ink-soft`, `text-ink-faint`, `border-line`, and state aliases.

- [ ] **Step 1: Write token source tests**

Read `theme-tokens.css` and assert every light/dark value from spec sections 4.1 and 4.2 is present. Read `tailwind.config.ts` and assert the semantic aliases reference CSS variables rather than fixed slate values.

- [ ] **Step 2: Run focused unit test and confirm RED**

Run: `cd apps/web && npm run test:unit -- tests/unit/theme-token-contract.spec.ts`

Expected: FAIL because `theme-tokens.css` is absent.

- [ ] **Step 3: Create the token stylesheet and import it before utilities**

Define the approved light values under `:root` and dark values under `.dark`. Define hover/active/selected values using explicit approved neutral and accent roles. Keep status roles in the same file. Preserve the existing print-document variables under `.formal-print-page`.

- [ ] **Step 4: Map Tailwind semantic colors**

```ts
colors: {
  page: "var(--wh-background)",
  shell: "var(--wh-shell)",
  card: "var(--wh-layer-1)",
  "layer-2": "var(--wh-layer-2)",
  "layer-3": "var(--wh-layer-3)",
  line: "var(--wh-border-subtle)",
  ink: {
    DEFAULT: "var(--wh-text-primary)",
    soft: "var(--wh-text-secondary)",
    faint: "var(--wh-text-tertiary)",
  },
}
```

- [ ] **Step 5: Remove global utility remapping from `globals.css`**

Delete selectors that reinterpret `.bg-white`, `.bg-gray-*`, `.border-gray-*`, or hover utilities under `.dark`. Keep only element defaults, scrollbar, skeleton, reduced motion, chart integration, and the formal document palette.

- [ ] **Step 6: Run token tests, typecheck, and production build**

Run: `cd apps/web && npm run test:unit -- tests/unit/theme-token-contract.spec.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit the token foundation**

```bash
git add apps/web/src/app/theme-tokens.css apps/web/src/app/globals.css apps/web/tailwind.config.ts apps/web/tests/unit/theme-token-contract.spec.ts
git commit -m "feat: add balanced semantic theme tokens"
```

### Task 4: Shared shell and reusable components

**Files:**
- Modify: `apps/web/src/components/layout/*.tsx`
- Modify: `apps/web/src/components/ui/*.tsx`
- Modify: `apps/web/src/components/shared/*.tsx`
- Create: `apps/web/tests/unit/semantic-theme-usage.spec.ts`

**Interfaces:**
- Consumes: Task 3 semantic Tailwind aliases.
- Produces: theme-consistent shell, navigation, header, dialog, card, badge, form, signature, skeleton, and deletion UI.

- [ ] **Step 1: Write a semantic usage guard**

The test scans the shared directories and fails on application-surface classes matching `dark:(bg|text|border|divide|from|via|to)-(slate|gray)-`, `bg-white` outside `.formal-print-page`, or inline neutral hex colors. It reports file and class so each violation is actionable.

- [ ] **Step 2: Run the guard and confirm RED**

Run: `cd apps/web && npm run test:unit -- tests/unit/semantic-theme-usage.spec.ts`

Expected: FAIL with existing shared-component direct palette usage.

- [ ] **Step 3: Migrate the application shell**

Use `bg-shell` for desktop/mobile navigation, `bg-page` for the main canvas, `bg-card` for elevated shell panels, `bg-layer-2` for active/hover regions, and semantic text/border roles. Keep Whole Hearted blue for active navigation and focus.

- [ ] **Step 4: Migrate reusable components**

Map dialogs and cards to `bg-card`; nested headers and fields to `bg-layer-2`; hover and selected surfaces to layer/accent roles; text and borders to semantic roles. Use status roles for badges and destructive actions.

- [ ] **Step 5: Run the guard, existing shared tests, and typecheck**

Run: `cd apps/web && npm run test:unit -- tests/unit/semantic-theme-usage.spec.ts tests/unit/record-delete-ui.spec.ts tests/unit/dialog-accessibility.spec.ts && npm run typecheck`

If either named legacy test file is not present, use `rg --files tests/unit | rg 'record-delete|dialog'` and run the matching existing tests. Expected: PASS.

- [ ] **Step 6: Commit shared component migration**

```bash
git add apps/web/src/components/layout apps/web/src/components/ui apps/web/src/components/shared apps/web/tests/unit/semantic-theme-usage.spec.ts
git commit -m "refactor: apply semantic theme to shared ui"
```

### Task 5: Business Order and formal document surfaces

**Files:**
- Modify: `apps/web/src/components/orders/formal-business-order-*.tsx`
- Modify: `apps/web/src/components/orders/formal-print-*.tsx`
- Modify: `apps/web/tests/e2e/formal-handoff-cancellation.spec.ts`
- Modify: `apps/web/tests/e2e/theme-and-print-legibility.spec.ts`

**Interfaces:**
- Consumes: Task 3 tokens and Task 4 shared components.
- Produces: four Business Order workspaces that follow the resolved application theme and formal documents that use the print palette.

- [ ] **Step 1: Replace the Business Order color assertions**

For explicit dark mode, assert page background `rgb(39, 44, 51)`, card background `rgb(50, 56, 65)`, nested surface `rgb(58, 65, 75)`, primary text `rgb(238, 242, 246)`, and a visible subtle border. Repeat key hierarchy assertions in explicit light mode using the approved light values.

- [ ] **Step 2: Run Business Order theme E2E and confirm RED**

Run: `cd apps/web && npm run test:e2e -- tests/e2e/formal-handoff-cancellation.spec.ts -g 'theme|主题|浅色|深色'`

Expected: FAIL while the Business Order detail uses its own color scope.

- [ ] **Step 3: Apply semantic layers across all four workspaces**

Use `bg-page` at the detail root, `bg-card` for the header and workspace panels, `bg-layer-2` for table headers/nested blocks, `bg-layer-3` for selected neutral states, semantic borders/text, and state roles for finance/status cards. Dialogs inherit shared component tokens.

- [ ] **Step 4: Preserve the formal document palette**

Keep `.formal-print-page` as white paper with dark ink in both resolved themes. Embedded previews use the document palette only inside the paper boundary; the preview toolbar uses the application theme.

- [ ] **Step 5: Run Business Order, print, finance, history, and messages tests**

Run: `cd apps/web && npm run test:e2e -- tests/e2e/theme-and-print-legibility.spec.ts tests/e2e/formal-handoff-cancellation.spec.ts && npm run test:unit -- tests/unit/formal-business-order-actions-ui.spec.ts tests/unit/formal-business-order-tabs.spec.ts tests/unit/formal-print-consumer.spec.ts tests/unit/formal-business-order-messages.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit Business Order theming**

```bash
git add apps/web/src/components/orders apps/web/tests/e2e/theme-and-print-legibility.spec.ts apps/web/tests/e2e/formal-handoff-cancellation.spec.ts
git commit -m "refactor: theme business order workspaces"
```

### Task 6: Core product page migration

**Files:**
- Modify: `apps/web/src/app/**/*.tsx`
- Modify: `apps/web/src/components/{dashboard,workbench,customers,vehicles,employees,performance,payments,parking,revenue,settings}/**/*.tsx`
- Modify: `apps/web/tests/unit/semantic-theme-usage.spec.ts`
- Create: `apps/web/tests/e2e/balanced-theme-pages.spec.ts`

**Interfaces:**
- Consumes: shared semantic tokens and components from Tasks 3–4.
- Produces: consistent theme hierarchy on core business pages.

- [ ] **Step 1: Extend the semantic guard to all application source**

Allow raw colors only inside formal document renderers, logos/assets, and chart series whose categorical identity is documented. Fail on application-surface direct dark neutral utilities and fixed white card backgrounds.

- [ ] **Step 2: Run the guard and confirm RED**

Run: `cd apps/web && npm run test:unit -- tests/unit/semantic-theme-usage.spec.ts`

Expected: FAIL and enumerate remaining product-page violations.

- [ ] **Step 3: Migrate pages by business area**

Apply the same mapping in this order: workbench/dashboard; customers/vehicles; employees/performance; payments/revenue/parking; dictionaries/settings; remaining application routes. Preserve categorical chart colors and status meaning while moving their containers, labels, borders, hover, selected, disabled, and form states to semantic roles.

- [ ] **Step 4: Add representative page E2E**

For `/`, `/workbench`, `/customers`, `/vehicles`, `/employees`, `/performance`, `/payments`, `/revenue`, `/parking`, and `/settings`, mock existing APIs where required, visit in both explicit modes, and assert the page canvas, first primary surface, main text, and border roles match the approved palette. Assert no visible element uses `rgb(15, 23, 42)` as the main canvas or a pure white full-page background.

- [ ] **Step 5: Run semantic guard, representative E2E, and full Web unit suite**

Run: `cd apps/web && npm run test:unit -- tests/unit/semantic-theme-usage.spec.ts && npm run test:e2e -- tests/e2e/balanced-theme-pages.spec.ts && npm run test:unit`

Expected: PASS.

- [ ] **Step 6: Commit core page migration**

```bash
git add apps/web/src/app apps/web/src/components apps/web/tests/unit/semantic-theme-usage.spec.ts apps/web/tests/e2e/balanced-theme-pages.spec.ts
git commit -m "refactor: apply balanced theme across product pages"
```

### Task 7: Final verification, runtime replacement, and continuation docs

**Files:**
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`
- Modify: `docs/superpowers/plans/2026-08-28-balanced-dual-theme.md` (mark completed checkboxes)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified 3220 runtime and durable handoff.

- [ ] **Step 1: Run final static and automated verification**

Run:

```bash
cd apps/web
npm run test:unit
npm run test:e2e -- tests/e2e/theme-and-print-legibility.spec.ts tests/e2e/formal-handoff-cancellation.spec.ts tests/e2e/balanced-theme-pages.spec.ts
npm run typecheck
npx eslint src/app src/components tests/unit/theme-contract.spec.ts tests/unit/theme-token-contract.spec.ts tests/unit/semantic-theme-usage.spec.ts tests/e2e/theme-and-print-legibility.spec.ts tests/e2e/formal-handoff-cancellation.spec.ts tests/e2e/balanced-theme-pages.spec.ts
npm run build
```

Expected: all commands PASS. If repository-wide legacy lint outside the touched scope fails, record the exact pre-existing files separately and keep the touched-file lint gate green.

- [ ] **Step 2: Replace candidate runtime safely**

Stop the existing `pnpm start:candidate` session, start it again from `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime`, verify PostgreSQL on `55433`, verify the listener on `3220` has `apps/web` as its cwd, and confirm `/login` returns HTTP 200.

- [ ] **Step 3: Perform browser visual acceptance**

At 1700×1114 and 430px inspect explicit light, explicit dark, and system modes on the representative routes from Task 6 plus Business Order operations/documents/history/messages. Check hierarchy, contrast, hover/focus, menus, dialogs, statuses, print paper, horizontal overflow, and console errors.

- [ ] **Step 4: Update continuation documentation**

Record the three theme modes, storage keys, token stylesheet, semantic class rules, verification commands, runtime URL, and commit sequence in `docs/CONTINUATION_ENTRYPOINT.md`.

- [ ] **Step 5: Commit and push the completed delivery**

```bash
git add docs/CONTINUATION_ENTRYPOINT.md docs/superpowers/plans/2026-08-28-balanced-dual-theme.md
git commit -m "docs: record balanced theme delivery"
git push origin codex/ai-service-wip-20260827
```

- [ ] **Step 6: Report acceptance evidence**

Report the live URL, final commit, automated test counts, build result, browser viewports checked, and any remaining repository-level issue that is outside this theme delivery.
