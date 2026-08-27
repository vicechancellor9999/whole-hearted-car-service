# Team Card Spacing and Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 12px desktop gap above the four team cards and give them the same base shadow and small hover lift as the KPI cards without compressing the cards.

**Architecture:** Keep the change inside the existing `TeamPerformanceSection` presentation component. Protect layout and interaction behavior with browser-level assertions against real rendered geometry and computed styles, then refresh the existing design-QA evidence.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, Playwright, system Chrome.

## Global Constraints

- At `lg` widths, the header-to-team-card gap is `12px`.
- The existing desktop team-card height and internal content spacing remain unchanged.
- Mobile top padding and responsive columns remain unchanged.
- Team cards use `shadow-card`, lift `2px` on hover, highlight the border, and use `shadow-card-hover` over `200ms`.
- Current links, copy, data, colors, progress bars, dark surfaces, and routes remain unchanged.
- All generated screenshots and growing QA evidence remain under `/Volumes/公司文件`.

---

### Task 1: Protect and implement team-card spacing and hover behavior

**Files:**
- Modify: `tests/e2e/dashboard.spec.ts`
- Modify: `src/components/dashboard/team-performance.tsx`

**Interfaces:**
- Consumes: existing `TeamPerformanceSection`, `[data-testid="team-performance"]`, and `[data-testid="team-card"]` rendered DOM contracts.
- Produces: a `12px` desktop header-to-card gap and the existing KPI-card hover/shadow interaction on all four team-card links.

- [ ] **Step 1: Write the failing desktop gap and hover assertions**

Add a rendered gap measurement to `desktop geometry follows the reference card rows`:

```ts
const teamSpacing = await page.getByTestId("team-performance").evaluate((section) => {
  const headerBox = section.firstElementChild?.getBoundingClientRect();
  const cardBox = section
    .querySelector('[data-testid="team-card"]')
    ?.getBoundingClientRect();
  return {
    gap: headerBox && cardBox ? cardBox.top - headerBox.bottom : -1,
  };
});
expect(teamSpacing.gap).toBeGreaterThanOrEqual(11);
expect(teamSpacing.gap).toBeLessThanOrEqual(13);
```

Update the desktop geometry windows by `12px` while retaining existing card-height assertions:

```ts
expect(team!.height).toBeGreaterThanOrEqual(190);
expect(team!.height).toBeLessThanOrEqual(197);
expect(revenue.y).toBeGreaterThanOrEqual(339);
expect(revenue.y).toBeLessThanOrEqual(347);
expect(firstBottom!.y).toBeGreaterThanOrEqual(606);
expect(firstBottom!.y).toBeLessThanOrEqual(616);
expect(firstTeam!.y).toBeGreaterThanOrEqual(221);
expect(firstTeam!.y).toBeLessThanOrEqual(225);
```

Add a dedicated test that records the first team card's initial rectangle and shadow, hovers it, then polls for both an upward movement and a changed shadow:

```ts
test("team cards use the shared shadow and hover lift", async ({ page }) => {
  await openDashboard(page);
  const card = page.getByTestId("team-card").first();
  const initial = await card.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    shadow: getComputedStyle(node).boxShadow,
  }));
  expect(initial.shadow).not.toBe("none");

  await card.hover();
  await expect
    .poll(async () => {
      const hovered = await card.evaluate((node) => ({
        top: node.getBoundingClientRect().top,
        shadow: getComputedStyle(node).boxShadow,
      }));
      return (
        hovered.top <= initial.top - 1.5 &&
        hovered.shadow !== initial.shadow
      );
    })
    .toBe(true);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3004 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep "desktop geometry|team cards use"
```

Expected: the gap assertion reports approximately `0px`, the old geometry windows fail, and/or the hover card does not move because the production classes are not present.

- [ ] **Step 3: Implement the minimal component change**

Change the desktop grid from `lg:h-[107px] ... lg:pt-0` to:

```tsx
className="grid grid-cols-1 gap-2.5 p-2.5 sm:grid-cols-2 lg:h-[119px] lg:grid-cols-4 lg:px-3 lg:pb-3.5 lg:pt-3"
```

Change the team-card link surface and interaction classes to:

```tsx
className="flex flex-col justify-between rounded-lg border border-blue-100 bg-white p-2.5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:bg-blue-50/50 hover:shadow-card-hover dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50 lg:p-3"
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same focused Playwright command. Expected: both tests pass, the measured desktop gap is `11-13px`, the card moves upward by at least `1.5px`, and the hover shadow differs from the base shadow.

- [ ] **Step 5: Run the full automated verification**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3004 npm run test:e2e -- tests/e2e/dashboard.spec.ts
npm run test:collaboration
npm run typecheck
npm run lint
npm run build
```

Expected: all E2E and collaboration tests pass, typecheck/build exit `0`, and lint has no errors. The existing supplied-logo `<img>` optimization warning may remain.

- [ ] **Step 6: Commit the implementation**

```bash
git add tests/e2e/dashboard.spec.ts src/components/dashboard/team-performance.tsx
git commit -m "fix: add team card spacing and hover lift"
```

---

### Task 2: Refresh visual evidence and final QA

**Files:**
- Modify: `design-qa.md`
- Generate outside the repository: `../qa/integrated-pass7*.png`, `../qa/pass7-source-left-implementation-right.png`, and focused team-section comparisons.

**Interfaces:**
- Consumes: Task 1 rendered dashboard at `http://127.0.0.1:3004`, the user-marked screenshot, and the existing reference image.
- Produces: updated Pass 7 evidence and a `design-qa.md` result that is `passed` only when no P0/P1/P2 remains.

- [ ] **Step 1: Capture the changed states**

Use the existing external capture helper with `CAPTURE_PREFIX=integrated-pass7` and `CAPTURE_THEME=light`, then repeat with `CAPTURE_THEME=dark`. Capture `1920 × 841` desktop and `430 × 932` mobile at `deviceScaleFactor: 1` and require `consoleIssues=[]`.

- [ ] **Step 2: Build same-size comparison evidence**

Place the reference/user-marked section and the new implementation section together at matching dimensions. Inspect the 12px gap, unchanged card heights, dark/light shadow surfaces, downstream fit, mobile overflow, clipping, and card hover state.

- [ ] **Step 3: Run independent P0-P2 review**

Ask one code reviewer and one visual reviewer to inspect the current commit and Pass 7 evidence. Fix any P0/P1/P2 before proceeding; record P3-only differences without blocking.

- [ ] **Step 4: Update and verify the QA record**

Update `design-qa.md` to point to Pass 7 evidence, document the new spacing and hover interaction, and set exactly:

```text
final result: passed
```

only after the independent reviews pass. Then run `git diff --check` and verify `git status --short` contains only the intended QA record.

- [ ] **Step 5: Commit QA and confirm the preview**

```bash
git add design-qa.md
git commit -m "test: record team card spacing QA"
```

Keep the main preview running on port `3002`, verify HTTP `200`, verify the listener's working directory is the external-volume `main` worktree, and confirm the worktree is clean.
