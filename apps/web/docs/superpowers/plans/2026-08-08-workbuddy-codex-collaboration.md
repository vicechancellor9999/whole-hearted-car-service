# WorkBuddy 与 Codex 协作开发实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The storage migration and live WorkBuddy restart are sequential and must not be parallelized. Dashboard file work may run in parallel only after the shared Git handshake passes.

**Goal:** 将 WorkBuddy 当前项目安全迁移到外置卷共享 Git 仓库，证明 WorkBuddy 与 Codex 可以通过独立工作区协作，再共同完成并验收仪表盘复原。

**Architecture:** `main` 是唯一集成分支，`agent/workbuddy` 与 `agent/codex` 是共享同一 Git 对象库的独立工作区。Codex 通过 WorkBuddy 当前对话分配限定文件任务，审查提交后合并；产品代码只有通过自动化检查和同视口设计 QA 才进入完成状态。

**Tech Stack:** Next.js 14.2.5、React 18.3.1、TypeScript 5.5.4、Tailwind CSS 3.4.7、Node 内置测试、Playwright 浏览器测试、Git worktree、macOS HFS+ 外置卷。

## Global Constraints

- 所有项目、工作区、依赖、构建缓存、快照和测试截图必须位于 `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发`。
- `/Volumes/公司文件` 未挂载或不可写时立即停止，不回退到 Macintosh HD。
- WorkBuddy 原路径迁移后只能保留为指向外置卷的软链接。
- 原始 WorkBuddy 数据在两个外置卷副本和校验均通过前不得移除。
- 双方不得同时修改同一文件；每个 WorkBuddy 任务必须包含基线提交和文件所有权清单。
- 不配置 Git 远程，不上传代码、图片、HTML 或业务数据。
- 新行为先建立能够正确失败的测试，再写最小实现。
- `ready`、端口监听或构建成功不能替代真实浏览器验收。

---

### Task 1: 冻结 WorkBuddy 写入并建立完整外置卷快照

**Files:**
- Create: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/workbuddy-before-collaboration-2026-08-08/`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/source-project.sha256`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/snapshot-project.sha256`

**Interfaces:**
- Consumes: 当前 WorkBuddy 会话 `6f0fccc2-d4b8-40e4-a4fc-e4073a074000` 与本机工作区 `/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53`。
- Produces: 可回退的完整快照，以及源/快照一致性证据。

- [ ] **Step 1: 通过 WorkBuddy 当前对话发送冻结指令**

发送以下内容并等待 WorkBuddy 回复已停止写文件：

```text
用户已批准 WorkBuddy 与 Codex 协作。现在进入安全迁移阶段：请立即停止修改任何项目文件，不要启动新的子任务，也不要提交新的改动。只回复“已冻结写入”，并保持当前任务空闲，等待 Codex 完成外置卷迁移。
```

- [ ] **Step 2: 记录当前进程和监听器证据**

Run:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
ps -axo pid=,ppid=,command= | rg 'next dev --port 3000|next-server|WorkBuddy.app'
```

Expected: 只记录进程、端口和命令路径；不得输出环境变量或认证令牌。

- [ ] **Step 3: 正常停止开发服务并退出 WorkBuddy**

先向 `next dev` 父进程发送 `TERM`，确认 3000 端口释放；随后通过 Computer Use 正常退出 WorkBuddy，并确认没有 WorkBuddy 主进程继续持有旧工作区。

Expected:

```text
PORT_3000_LISTENER=NONE
WORKBUDDY_MAIN_PROCESS=NONE
```

- [ ] **Step 4: 复制完整工作区快照**

Run:

```bash
mkdir -p '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots'
rsync -a '/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53/' '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/workbuddy-before-collaboration-2026-08-08/'
```

Expected: `.workbuddy/`、`whole-hearted/`、`.env.local`、`node_modules/` 与 `.next/` 都存在于快照；不打印 `.env.local` 内容。

- [ ] **Step 5: 生成并比较源/快照哈希**

对 `.workbuddy` 和 `whole-hearted` 中除 `.next`、`node_modules` 外的所有普通文件按相对路径排序并计算 SHA-256。源与快照清单必须逐行一致。

Run:

```bash
diff -u '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/source-project.sha256' '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/snapshot-project.sha256'
```

Expected: exit code `0`，无差异输出。

---

### Task 2: 创建外置卷工作区并先用测试约束启动脚本

**Files:**
- Modify: `package.json`
- Modify: `start-dev.sh`
- Create: `tests/collaboration/start-dev.test.mjs`
- Create outside repository: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/codex/`
- Create outside repository: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/workbuddy/whole-hearted/`
- Create outside repository: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/runtime/node_modules`

**Interfaces:**
- Consumes: clean `main` at the implementation-plan commit and the verified Task 1 snapshot.
- Produces: `agent/codex` and `agent/workbuddy` worktrees plus a reviewed, location-independent start command merged into `main`.

- [ ] **Step 1: 先创建隔离的 Codex 工作区**

The existing `agent/codex` pointer contains no unique commit and is an ancestor of `main`. Move it to the approved plan commit and create the external worktree:

```bash
git branch -f agent/codex main
git worktree add '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/codex' agent/codex
```

Expected: `git worktree list` shows `main` and `codex`; implementation edits happen only in `codex`.

- [ ] **Step 2: 写入启动脚本的失败测试**

Create `tests/collaboration/start-dev.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../start-dev.sh", import.meta.url), "utf8");

test("start-dev resolves the project from the script directory", () => {
  assert.match(source, /BASH_SOURCE\[0\]/);
  assert.match(source, /cd "\$SCRIPT_DIR"/);
  assert.doesNotMatch(source, /\/Users\/lijianfu\/WorkBuddy/);
});

test("start-dev accepts an isolated port with a 3000 default", () => {
  assert.match(source, /PORT="\$\{PORT:-3000\}"/);
  assert.match(source, /--port "\$PORT"/);
});
```

Add to `package.json`:

```json
"test:collaboration": "node --test tests/collaboration/*.test.mjs"
```

- [ ] **Step 3: 运行测试并确认正确失败**

Run: `npm run test:collaboration`

Expected: FAIL because the current script hard-codes `/Users/lijianfu/WorkBuddy/...` and has no configurable `PORT`.

- [ ] **Step 4: 写入最小启动脚本实现**

Replace `start-dev.sh` with:

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PORT="${PORT:-3000}"

cd "$SCRIPT_DIR"
exec npm run dev -- --port "$PORT"
```

- [ ] **Step 5: 验证测试通过、提交并合入 main**

Run:

```bash
npm run test:collaboration
git add package.json start-dev.sh tests/collaboration/start-dev.test.mjs
git commit -m 'chore: make collaboration runtime portable'
git -C '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main' merge --no-ff agent/codex -m 'merge: accept portable collaboration runtime'
```

Expected: all collaboration tests PASS and working tree is clean.

- [ ] **Step 6: 创建 WorkBuddy 工作区**

Run from `main`:

```bash
mkdir -p '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/workbuddy'
git worktree add -b agent/workbuddy '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/workbuddy/whole-hearted' main
```

Expected: `git worktree list` shows three external-volume worktrees; `main` and `agent/workbuddy` include the portable runtime merge, and `agent/codex` contains the same runtime implementation commit.

- [ ] **Step 7: 外置依赖与环境文件**

Copy the verified snapshot `node_modules` once to `runtime/node_modules`; create ignored `node_modules` symlinks in all three worktrees. Copy `.env.local` from the verified snapshot to each worktree without printing its contents. Set project-specific npm cache:

```bash
export npm_config_cache='/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/.cache/npm'
```

Expected: each worktree resolves `next`, `react`, and `typescript`; all resolved paths begin with `/Volumes/公司文件`.

---

### Task 3: 替换原入口并完成双代理 Git 握手

**Files:**
- Create: `docs/collaboration/workbuddy-handshake.md` on `agent/workbuddy`
- Create: `docs/collaboration/codex-handshake.md` on `agent/codex`
- Replace path: `/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53` with a symlink to `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/workbuddy`

**Interfaces:**
- Consumes: verified snapshot and both clean worktrees.
- Produces: original WorkBuddy entry path backed by external storage, plus one mergeable commit from each agent.

- [ ] **Step 1: 将原工作区移入外置卷保存区并建立软链接**

Move the explicit original workspace to a unique external archive path, then create the compatibility link:

```bash
mv '/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53' '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/snapshots/original-workspace-moved-2026-08-08'
ln -s '/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/workbuddy' '/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53'
```

Expected: `test -L` passes; `pwd -P` from the legacy project path resolves to the external WorkBuddy worktree; the moved archive remains recoverable.

- [ ] **Step 2: 重新打开 WorkBuddy 并验证原任务恢复**

Use Computer Use to reopen `com.workbuddy.workbuddy`. Confirm the task title `按照片复原仪表盘并使用指定logo`, the prior conversation, and the artifact panel are present.

- [ ] **Step 3: 让 WorkBuddy 创建握手提交**

Send this exact bounded task:

```text
共享协作环境已建立。请只在当前项目创建 docs/collaboration/workbuddy-handshake.md，写入：当前绝对工作目录、当前分支 agent/workbuddy、当前基线提交哈希，以及一句“WorkBuddy 已进入外置卷共享 Git 仓库”。不要修改其他文件。运行 git status 和 npm run test:collaboration，然后提交为 docs: record WorkBuddy collaboration handshake。回复提交哈希、文件清单和测试结果。
```

Expected: one commit on `agent/workbuddy`, exactly one new Markdown file, collaboration tests PASS.

- [ ] **Step 4: Codex 创建独立握手提交**

On `agent/codex`, create `docs/collaboration/codex-handshake.md` with absolute worktree path, branch, base commit, and the statement `Codex 已进入外置卷共享 Git 仓库`; commit:

```bash
git add docs/collaboration/codex-handshake.md
git commit -m 'docs: record Codex collaboration handshake'
```

- [ ] **Step 5: 集成两个握手提交**

Run on `main`:

```bash
git merge --no-ff agent/workbuddy -m 'merge: accept WorkBuddy handshake'
git merge --no-ff agent/codex -m 'merge: accept Codex handshake'
git log --graph --oneline --decorate -8
```

Expected: both handshake commits are ancestors of `main`; all worktrees are clean after rebasing/synchronizing their task branches to the new `main`.

---

### Task 4: 建立仪表盘浏览器验收测试并观察 RED

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: external-volume runtime and the current WorkBuddy dashboard baseline.
- Produces: tests for the exact four-team/four-bottom-card structure, equal row heights, live clock, theme control, logo, and card navigation.

- [ ] **Step 1: 安装固定浏览器测试依赖到外置卷**

Run on `agent/codex` with the project npm cache exported:

```bash
npm install --save-dev @playwright/test
```

Add scripts:

```json
"test:e2e": "playwright test",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 2: 写入仪表盘失败测试**

Create `tests/e2e/dashboard.spec.ts` with these assertions:

```ts
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1920, height: 841 } });

test("dashboard matches the approved information architecture", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("team-card")).toHaveCount(4);
  await expect(page.getByTestId("top-metric-card")).toHaveCount(4);
  await expect(page.getByTestId("bottom-metric-card")).toHaveCount(4);
  await expect(page.getByRole("img", { name: "Whole Hearted" })).toBeVisible();
  await expect(page.getByText("Whole Hearted Car Service Limited")).toBeVisible();
});

test("cards in each visual row have equal heights", async ({ page }) => {
  await page.goto("/");
  for (const testId of ["team-card", "bottom-metric-card"]) {
    const boxes = await page.getByTestId(testId).evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
    );
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThanOrEqual(1);
  }
});

test("clock advances and appearance toggle changes theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_theme", "light"));
  await page.goto("/");
  const clock = page.getByTestId("live-clock");
  const first = await clock.textContent();
  await expect.poll(() => clock.textContent(), { timeout: 2500 }).not.toBe(first);
  await page.getByRole("button", { name: /深色模式|浅色模式/ }).click();
  await expect(page.locator("html")).toHaveAttribute("class", /dark/);
});

test("every metric card has a keyboard reachable destination", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByTestId("metric-card-link");
  await expect(cards).toHaveCount(8);
  const destinations = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href")),
  );
  expect(destinations.every((href) => href?.startsWith("/"))).toBe(true);
});
```

- [ ] **Step 3: 运行测试并确认当前实现正确失败**

Run:

```bash
npm run test:e2e -- tests/e2e/dashboard.spec.ts
```

Expected failures: current DOM has no required test IDs or navigation links; current layout exposes five bottom cards rather than the approved four-card row.

- [ ] **Step 4: 提交 RED 测试基线**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e/dashboard.spec.ts
git commit -m 'test: define dashboard visual contract'
```

---

### Task 5: WorkBuddy 负责品牌、标题、班组和侧栏文件

**Files:**
- Modify: `src/components/dashboard/dashboard-header.tsx`
- Modify: `src/components/dashboard/team-performance.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/ui/logo.tsx`
- Do not modify any other file.

**Interfaces:**
- Consumes: Task 4 RED tests, `references/dashboard-reference-1920x841.jpg`, `references/brand-logo-wh-512.png`, and the latest `main` commit hash.
- Produces: four equal-height team cards, verified logo/name, live-clock selector, and sidebar footer layout on `agent/workbuddy`.

- [ ] **Step 1: 同步 WorkBuddy 分支并发送限定任务包**

Codex sends the exact base hash, four owned files, reference paths, and these required DOM contracts:

```text
team card: data-testid="team-card"
live clock: data-testid="live-clock"
brand image accessible name: Whole Hearted
```

The message must explicitly prohibit edits to `page.tsx`, `metric-card.tsx`, `globals.css`, data files, tests, package files, and configuration.

- [ ] **Step 2: 等待 WorkBuddy 返回提交并审查范围**

Run:

```bash
git diff --name-only main...agent/workbuddy
git show --stat --oneline agent/workbuddy
```

Expected: only the four owned files changed.

- [ ] **Step 3: 运行相关测试和构建检查**

Run from WorkBuddy worktree:

```bash
npm run test:collaboration
npm run typecheck
```

Expected: both commands PASS; retain the E2E RED failures owned by Task 6 until integration.

---

### Task 6: Codex 负责指标卡结构、信息和导航

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/metric-card.tsx`
- Modify: `src/lib/api/mock-data.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Consumes: Task 4 RED tests and the visual/content reference hierarchy.
- Produces: two large cards plus a two-card right stack, a four-card bottom row, eight semantic links, complete card content, and equal row geometry on `agent/codex`.

- [ ] **Step 1: Confirm RED before implementation**

Run: `npm run test:e2e -- tests/e2e/dashboard.spec.ts`

Expected: the four contract tests fail for the previously recorded reasons.

- [ ] **Step 2: Add explicit navigation data**

Add to `DashboardMetricCard`:

```ts
href: string;
```

Set destinations in mock data:

```text
today_revenue -> /payments
accounts_receivable -> /payments
vehicles_today -> /workbench
vehicles_stuck -> /workbench
completed_labor -> /performance
prepaid_incomplete -> /orders
internal_tasks -> /tasks
risk_alerts -> /tasks
```

- [ ] **Step 3: Implement the approved metric layout**

In `page.tsx`, render:

```text
top row: revenue (5/12) + receivable (4/12) + right stack (3/12)
right stack: vehicles_today + vehicles_stuck
bottom row: completed_labor + prepaid_incomplete + internal_tasks + risk_alerts
```

Add `data-testid="top-metric-card"` to all four visible top-row cards, `data-testid="bottom-metric-card"` to all four bottom cards, and `data-testid="metric-card-link"` to the eight semantic links.

- [ ] **Step 4: Make the card component a real link**

Replace the silent `<button onClick={() => card.onClick?.()}>` behavior with a Next.js `<Link href={card.href}>`, preserving hover/focus states and adding a visible `focus-visible` ring.

- [ ] **Step 5: Run GREEN checks and commit**

Run:

```bash
npm run test:e2e -- tests/e2e/dashboard.spec.ts
npm run typecheck
npm run lint
git add src/app/page.tsx src/components/dashboard/metric-card.tsx src/lib/api/mock-data.ts src/lib/types.ts
git commit -m 'fix: restore dashboard card structure and navigation'
```

Expected: tests not dependent on WorkBuddy-owned selectors may pass; after Task 5 merge all four contract tests must pass.

---

### Task 7: 合并双方提交并通过完整工程检查

**Files:**
- Update through merges: `main`
- Create: `design-qa.md`
- Create outside repository: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/`

**Interfaces:**
- Consumes: reviewed WorkBuddy and Codex task commits.
- Produces: integrated dashboard and blocking design-QA result.

- [ ] **Step 1: 合并 WorkBuddy 与 Codex 提交**

Run on `main`:

```bash
git merge --no-ff agent/workbuddy -m 'merge: integrate WorkBuddy dashboard refinements'
git merge --no-ff agent/codex -m 'merge: integrate Codex dashboard structure'
```

Expected: no conflict because ownership sets are disjoint. A conflict is a protocol failure; stop and inspect rather than auto-resolving.

- [ ] **Step 2: 运行完整自动化检查**

Run:

```bash
npm run test:collaboration
npm run test:e2e -- tests/e2e/dashboard.spec.ts
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit `0`; no unhandled console error appears in E2E output.

- [ ] **Step 3: 运行同视口设计 QA**

Start `main` on port `3002`, capture at `1920 × 841`, and compare it with `references/dashboard-reference-1920x841.jpg`. Write `design-qa.md` using the Product Design design-QA format.

Required result:

```text
final result: passed
```

Fix all P0/P1/P2 findings using new failing tests where behavior changes; repeat capture and comparison. Do not loop on P3 polish.

- [ ] **Step 4: 检查 430px 窄屏与核心交互**

At a 430px viewport verify no horizontal overflow, theme toggle, clock advance, identity footer, all eight card links, and back navigation. Save evidence under the external `qa/` directory.

- [ ] **Step 5: 提交设计 QA 结果**

```bash
git add design-qa.md
git commit -m 'test: pass dashboard design QA'
```

---

### Task 8: 最终协作状态验证与交付

**Files:**
- No new product files expected.

**Interfaces:**
- Consumes: clean, tested `main` and running external-volume preview.
- Produces: evidence that the two-agent workflow and dashboard are genuinely operational.

- [ ] **Step 1: Verify shared repository topology**

Run:

```bash
git worktree list
git branch --merged main
git status --short --branch
readlink '/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53'
```

Expected: three external worktrees, both agent branches merged, clean `main`, and the legacy WorkBuddy path pointing to the external WorkBuddy directory.

- [ ] **Step 2: Verify WorkBuddy UI and live preview**

Confirm WorkBuddy can open the same task, reports `agent/workbuddy`, and its preview uses the external worktree. Confirm the integration preview is still running from `main`, not from the old archived workspace.

- [ ] **Step 3: Report exact evidence**

Report the final `main` commit, external path, WorkBuddy handshake commit, Codex handshake commit, test/build results, design-QA result, and preview URL. Distinguish completed verification from any remaining P3 polish.
