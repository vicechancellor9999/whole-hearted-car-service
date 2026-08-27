# Single Application M0 Baseline Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current dirty but verified Whole Hearted working tree into a recoverable, secret-safe, reviewable Git baseline before any single-application UI migration begins.

**Architecture:** M0 runs in the current checkout because the uncommitted working tree is the source of truth and cannot yet be recreated in a new worktree. It first captures source and stopped-runtime snapshots on `/Volumes/公司文件`, then corrects document authority labels, verifies both current applications, and records the formal root implementation and isolated PC visual source in separate commits. M0 changes no production route, database schema, UI, or business behavior.

**Tech Stack:** Git, zsh, bsdtar, SHA-256, Next.js 16 root application, isolated Next.js 14 PC visual source, PostgreSQL 18 physical snapshot, pnpm, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-single-application-consolidation-design.md`

## Global Constraints

- All new workspaces, archives, manifests, backups, images, downloads, and growing caches must remain under `/Volumes/公司文件`.
- The root Next.js 16 application is the only future production runtime; `apps/web` is an isolated visual and interaction source only.
- Preserve the current 3210 PC appearance, menu, print layout, and interaction behavior.
- Do not move, delete, overwrite, clean, reset, or stash the current working tree before a verified snapshot exists.
- Do not copy `.env`, `.env.local`, database credentials, session pepper, API keys, `.runtime`, `node_modules`, `.next`, test results, or build caches into the source archive or Git.
- Do not regenerate, reorder, or replace the existing Drizzle migration chain through `0023`.
- Tests must not query or write the current PostgreSQL database; use existing PGlite or isolated fixtures.
- Candidate business rules and acceptance material remain unapproved until the user confirms them.
- `apps/web` may be committed as an isolated reference source, but must remain excluded from the root workspace, TypeScript paths, CI, build, and deployment.
- Stop services only after resolving and validating exact listener and parent PIDs under this workspace. Never use `pkill`, `killall`, wildcards, or port-wide forced termination.
- Every commit must stage only named paths and pass `git diff --cached --check` plus a staged-path guard.

---

### Task 1: Capture the pre-M0 source and Git recovery snapshot

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/README.md`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/source-files.z`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/ignored-files.z`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/git-status.porcelain.z`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/git-status.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/formal-source-working-tree.tgz`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/formal-repository-history.bundle`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/SHA256SUMS`

**Interfaces:**
- Consumes: branch `codex/formal-foundation` at design commit `a042306` plus all tracked and non-ignored untracked source files.
- Produces: immutable source/Git evidence used by Tasks 2–6 for recovery and staged-file comparison.

- [ ] **Step 1: Verify exact workspace identity and refuse pre-existing staged state**

```bash
mount | rg '^/dev/.* on /Volumes/公司文件 '
test -w '/Volumes/公司文件/Whole Hearted Car Service 正式系统'
test "$(git branch --show-current)" = 'codex/formal-foundation'
test "$(git rev-parse --short=7 HEAD)" = 'a042306'
test -z "$(git diff --cached --name-only)"
```

Expected: mounted/writable external workspace, exact branch/HEAD, no staged paths.

- [ ] **Step 2: Create an exact non-overwriting external snapshot directory**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
test ! -e "$m0_snapshot_root"
mkdir -p "$m0_snapshot_root/repository" "$m0_snapshot_root/runtime" "$m0_snapshot_root/verification"
```

Expected: target exists only on `/Volumes/公司文件` and no earlier archive was overwritten.

- [ ] **Step 3: Record null-safe status, source, and ignored-file manifests**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
git status --porcelain=v1 --untracked-files=all -z > "$m0_snapshot_root/repository/git-status.porcelain.z"
git status --short --untracked-files=all > "$m0_snapshot_root/repository/git-status.txt"
git ls-files --cached --others --exclude-standard -z > "$m0_snapshot_root/repository/source-files.z"
git ls-files --others --ignored --exclude-standard -z > "$m0_snapshot_root/repository/ignored-files.z"
```

Expected: text status records 60 modified paths and 651 untracked files, including this untracked M0 plan.

- [ ] **Step 4: Prove protected paths are absent and examples remain present**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
if tr '\0' '\n' < "$m0_snapshot_root/repository/source-files.z" | rg '(^|/)(\.env($|\.)|node_modules/|\.next/|\.runtime/|test-results/|playwright-results/)|\.tsbuildinfo$'; then exit 1; fi
tr '\0' '\n' < "$m0_snapshot_root/repository/source-files.z" | rg '^\.env\.example$'
tr '\0' '\n' < "$m0_snapshot_root/repository/source-files.z" | rg '^apps/web/\.env\.example$'
```

Expected: protected-path scan is empty; both `.env.example` files are listed.

- [ ] **Step 5: Archive exactly the source list and committed history**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
tar --null -T "$m0_snapshot_root/repository/source-files.z" -czf "$m0_snapshot_root/repository/formal-source-working-tree.tgz"
git bundle create "$m0_snapshot_root/repository/formal-repository-history.bundle" --all
tar -tzf "$m0_snapshot_root/repository/formal-source-working-tree.tgz" >/dev/null
git bundle verify "$m0_snapshot_root/repository/formal-repository-history.bundle"
```

Expected: both validations exit 0.

- [ ] **Step 6: Hash and verify repository artifacts**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
cd "$m0_snapshot_root/repository"
shasum -a 256 formal-source-working-tree.tgz formal-repository-history.bundle git-status.porcelain.z source-files.z ignored-files.z > SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

Expected: every listed artifact reports `OK`.

### Task 2: Capture a stopped-runtime PostgreSQL and upload snapshot

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/runtime/processes-before-stop.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/runtime/formal-postgresql-and-uploads.tgz`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/runtime/SHA256SUMS`

**Interfaces:**
- Consumes: Task 1 snapshot directory and workspace-local `.runtime`.
- Produces: clean stopped physical snapshot plus restarted 3210/3211 evidence without exposing `.env.local`.

- [ ] **Step 1: Resolve listeners and ancestry without stopping anything**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
lsof -nP -iTCP:3210 -sTCP:LISTEN
lsof -nP -iTCP:3211 -sTCP:LISTEN
ps -axo pid=,ppid=,pgid=,stat=,command= | rg 'next-server|next dev|scripts/dev-local|postgres .*Whole Hearted Car Service 正式系统' | tee "$m0_snapshot_root/runtime/processes-before-stop.txt"
```

Expected: one Next 14 listener on 3210, one Next 16 listener on 3211, and one PostgreSQL process whose `-D` path is this workspace `.runtime/postgresql`.

- [ ] **Step 2: Gracefully stop only the two validated persistent exec sessions**

Use the existing Codex exec session handles for root `dev:local` and `apps/web` development commands and send Ctrl-C once to each. Do not send OS-wide signals.

Expected: both commands exit; `scripts/dev-local.ts` invokes its registered shutdown handler and PostgreSQL reports a clean shutdown.

- [ ] **Step 3: Verify every runtime listener is gone before copying**

```bash
test -z "$(lsof -nP -iTCP:3210 -sTCP:LISTEN -t 2>/dev/null)"
test -z "$(lsof -nP -iTCP:3211 -sTCP:LISTEN -t 2>/dev/null)"
test -z "$(lsof -nP -iTCP:5432 -sTCP:LISTEN -t 2>/dev/null)"
if [ -f .runtime/postgresql/postmaster.pid ]; then exit 1; fi
test -f .runtime/postgresql/PG_VERSION
```

Expected: no listeners, no `postmaster.pid`, existing `PG_VERSION` remains.

- [ ] **Step 4: Archive only stopped PostgreSQL and uploads and verify SHA-256**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
tar -czf "$m0_snapshot_root/runtime/formal-postgresql-and-uploads.tgz" .runtime/postgresql .runtime/uploads
tar -tzf "$m0_snapshot_root/runtime/formal-postgresql-and-uploads.tgz" | rg '^\.runtime/postgresql/PG_VERSION$'
cd "$m0_snapshot_root/runtime"
shasum -a 256 formal-postgresql-and-uploads.tgz > SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

Expected: `PG_VERSION` is present and checksum reports `OK`.

- [ ] **Step 5: Restart both temporary applications and verify identities**

Start `pnpm run dev:local` and `pnpm run dev:web` in separate persistent exec sessions. Then run:

```bash
curl -fsS http://127.0.0.1:3211/api/health/live
curl -fsS http://127.0.0.1:3211/api/health/ready
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3210/login | rg '^200$'
lsof -nP -iTCP:3210 -sTCP:LISTEN
lsof -nP -iTCP:3211 -sTCP:LISTEN
```

Expected: root returns alive/ready, web login returns 200, exactly one listener exists on each temporary port.

### Task 3: Produce the ownership and authority report

**Files:**
- Create: `docs/architecture/2026-08-27-m0-working-tree-ownership.md`
- Modify: `docs/architecture/FORMAL_SYSTEM_BUSINESS_BASELINE.md`
- Modify: `docs/CONTINUATION_ENTRYPOINT.md`
- Modify: `docs/acceptance/FORMAL_SYSTEM_END_TO_END_ACCEPTANCE.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 manifests, Task 2 snapshot evidence, approved rescue design, and approved single-application design.
- Produces: explicit disposition for every dirty-tree group and truthful authority labels for candidate business material.

- [ ] **Step 1: Write the ownership report with observed counts and fixed dispositions**

Create `docs/architecture/2026-08-27-m0-working-tree-ownership.md` with:

```markdown
# M0 Working Tree Ownership and Baseline Record

Status: engineering ownership record; not a business-rule approval
Branch at capture: `codex/formal-foundation`
Design commit at capture: `a042306`
Observed working tree: 60 modified paths and 651 untracked files

| Group | Observed files | Disposition |
|---|---:|---|
| Root formal source, schema, migrations, scripts, tests, configs | 109 untracked files plus 60 modified paths | Verify and commit as the formal baseline |
| `apps/web` PC visual source | 540 untracked files | Verify and commit separately as isolated non-production reference |
| `apps/qa/playwright-results` | 1 generated file | Keep on disk if useful, ignore from Git, never treat as acceptance evidence |
| Root `eng.traineddata` | 1 unreferenced binary | Preserve in the external source snapshot, ignore from Git, do not deploy |
| `.runtime` PostgreSQL/uploads | ignored runtime | Preserve only in the stopped-runtime archive, never commit |
| `.env.local` files | ignored credentials | Keep local, never copy to source archive or Git |

The files `docs/architecture/FORMAL_SYSTEM_BUSINESS_BASELINE.md` and
`docs/acceptance/FORMAL_SYSTEM_END_TO_END_ACCEPTANCE.md` are candidate business
and acceptance material. Recording them in Git preserves provenance; it does
not approve their business rules.
```

- [ ] **Step 2: Remove false authority claims from the candidate business baseline**

Change the title to `# Whole Hearted 正式系统候选业务基线（未批准）`, add an immediately visible candidate status, and replace claims that the file is the highest authority with:

```markdown
本文件中的经营规则尚未由用户逐项确认，不得作为最终业务合同、数据库约束或验收判定依据。发生冲突时，以用户明确发言、已批准设计和已批准分模块规格为准；本文件只提供候选条款。
```

Do not rewrite or silently approve the candidate rule body in M0.

- [ ] **Step 3: Correct continuation and acceptance references**

Update `docs/CONTINUATION_ENTRYPOINT.md` so the approved rescue design and single-application design are read first, while the candidate baseline and E2E checklist are marked unapproved. Change the acceptance title to `# Whole Hearted 正式系统端到端候选验收清单（未批准）` and state that its rules are candidates, not final authority.

- [ ] **Step 4: Ignore only the classified generated and orphan paths**

Append to `.gitignore`:

```gitignore
apps/qa/playwright-results/
eng.traineddata
```

Do not ignore `apps/web`, formal source, tests, migrations, or candidate documents.

- [ ] **Step 5: Verify truthful authority labels and ignore behavior**

```bash
rg -n '候选业务基线（未批准）|不得作为最终业务合同' docs/architecture/FORMAL_SYSTEM_BUSINESS_BASELINE.md
rg -n '候选验收清单（未批准）' docs/acceptance/FORMAL_SYSTEM_END_TO_END_ACCEPTANCE.md
rg -n 'single-application-consolidation-design|候选.*未批准' docs/CONTINUATION_ENTRYPOINT.md
git check-ignore -v apps/qa/playwright-results/.last-run.json eng.traineddata
if git status --short --untracked-files=all | rg '^\?\? (eng\.traineddata|apps/qa/playwright-results/)'; then exit 1; fi
```

Expected: authority markers are present; both classified files are ignored and absent from untracked source candidates.

### Task 4: Scan the source baseline for credentials and unsafe links

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/security-scan.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/symlinks.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/repository/source-files-after-authority-fix.z`

**Interfaces:**
- Consumes: source tree after Task 3 corrections, excluding ignored credentials and caches.
- Produces: a no-secret and no-external-symlink gate before any `git add`.

- [ ] **Step 1: Scan non-ignored source for high-confidence credential formats**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
rg -n --hidden \
  -g '!**/.git/**' -g '!**/node_modules/**' -g '!**/.next/**' -g '!**/.runtime/**' \
  '(sk-[A-Za-z0-9_-]{40,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{40,})' \
  . > "$m0_snapshot_root/repository/security-scan.txt" || true
test ! -s "$m0_snapshot_root/repository/security-scan.txt"
```

Expected: empty scan file. A hit stops M0 for credential remediation before staging.

- [ ] **Step 2: Record and validate every source symlink**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
find . -path './.git' -prune -o -path './node_modules' -prune -o -path './apps/web/node_modules' -prune -o -path './.next' -prune -o -path './apps/web/.next' -prune -o -path './.runtime' -prune -o -path './apps/web/.runtime' -prune -o -path './apps/web/test-results' -prune -o -type l -print -exec readlink {} \; > "$m0_snapshot_root/repository/symlinks.txt"
```

Review every path/target pair. Expected: no staged source symlink resolves outside `/Volumes/公司文件`; any credential symlink blocks staging.

- [ ] **Step 3: Rebuild the source list and re-run protected-path exclusions**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
git ls-files --cached --others --exclude-standard -z > "$m0_snapshot_root/repository/source-files-after-authority-fix.z"
if tr '\0' '\n' < "$m0_snapshot_root/repository/source-files-after-authority-fix.z" | rg '(^|/)(\.env($|\.)|node_modules/|\.next/|\.runtime/|test-results/|playwright-results/)|\.tsbuildinfo$|^eng\.traineddata$'; then exit 1; fi
```

Expected: protected and regenerable paths remain absent.

### Task 5: Verify the formal root and PC visual baselines

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/verification/root-test.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/verification/root-typecheck.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/verification/web-unit.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/verification/web-typecheck.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/verification/formal-handoff-e2e.txt`
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/verification/diff-check.txt`

**Interfaces:**
- Consumes: unchanged runtime behavior plus Task 3 documentation-only corrections.
- Produces: fresh pass/fail evidence tied to the exact pre-consolidation baseline.

- [ ] **Step 1: Run root tests and typecheck with captured exit status**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
set -o pipefail
pnpm test 2>&1 | tee "$m0_snapshot_root/verification/root-test.txt"
pnpm typecheck 2>&1 | tee "$m0_snapshot_root/verification/root-typecheck.txt"
```

Expected: 318 root tests pass; TypeScript exits 0.

- [ ] **Step 2: Run PC visual-source unit tests and typecheck**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
set -o pipefail
pnpm --dir apps/web test:unit 2>&1 | tee "$m0_snapshot_root/verification/web-unit.txt"
pnpm --dir apps/web typecheck 2>&1 | tee "$m0_snapshot_root/verification/web-typecheck.txt"
```

Expected: 960 PC unit/browser-component tests pass; TypeScript exits 0.

- [ ] **Step 3: Run only the formal handoff cancellation E2E contract**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
set -o pipefail
pnpm --dir apps/web exec playwright test tests/e2e/formal-handoff-cancellation.spec.ts 2>&1 | tee "$m0_snapshot_root/verification/formal-handoff-e2e.txt"
```

Expected: exactly 4 tests pass. Do not use a wrapper that expands the argument into the full legacy Mock E2E suite.

- [ ] **Step 4: Verify patch formatting**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
git diff --check 2>&1 | tee "$m0_snapshot_root/verification/diff-check.txt"
test ! -s "$m0_snapshot_root/verification/diff-check.txt"
```

Expected: no whitespace errors.

### Task 6: Record formal root and isolated PC source in separate commits

**Files:**
- Commit set A: `.env.example`, `.gitignore`, `docs/**`, `drizzle/**`, `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/**`, `src/**`, `tsconfig.json`, `vitest.config.ts`
- Commit set B: `apps/web/**` excluding ignored credentials, caches, build info, and results
- Update externally: `/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0/README.md`

**Interfaces:**
- Consumes: Tasks 1–5 snapshots, authority corrections, security gates, and passing verification.
- Produces: two checkpoint commits, a clean non-ignored worktree, and recovery README bound to the final M0 SHA.

- [ ] **Step 1: Stage only the formal root baseline**

```bash
git add -- .env.example .gitignore docs drizzle eslint.config.mjs package.json pnpm-lock.yaml pnpm-workspace.yaml scripts src tsconfig.json vitest.config.ts
if git diff --cached --name-only | rg '^apps/web/'; then exit 1; fi
if git diff --cached --name-only | rg '(^|/)(\.env($|\.)|node_modules/|\.next/|\.runtime/|test-results/|playwright-results/)|\.tsbuildinfo$|^eng\.traineddata$'; then exit 1; fi
git diff --cached --check
```

Expected: formal source, documents, migrations, configs and tests only.

- [ ] **Step 2: Commit the validated formal root baseline**

```bash
git commit -m 'chore: checkpoint validated formal baseline'
```

Expected: commit succeeds; `apps/web` remains the only large non-ignored source group.

- [ ] **Step 3: Stage only the isolated PC visual source**

```bash
git add -- apps/web
test -n "$(git diff --cached --name-only)"
if git diff --cached --name-only | rg -v '^apps/web/'; then exit 1; fi
if git diff --cached --name-only | rg '(^|/)(\.env($|\.)|node_modules/|\.next/|\.runtime/|test-results/|playwright-results/)|\.tsbuildinfo$'; then exit 1; fi
git diff --cached --check
```

Expected: every staged path begins with `apps/web/`; local credentials and caches are absent.

- [ ] **Step 4: Commit the isolated PC visual baseline**

```bash
git commit -m 'chore: preserve isolated PC visual baseline'
```

Expected: PC source is versioned separately and remains excluded by root workspace/build configs.

- [ ] **Step 5: Verify clean baseline without deleting ignored local data**

```bash
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git check-ignore -q .runtime/postgresql/PG_VERSION
git check-ignore -q apps/web/.env.local
git check-ignore -q apps/web/node_modules
git check-ignore -q apps/web/.next
git check-ignore -q apps/qa/playwright-results/.last-run.json
git check-ignore -q eng.traineddata
```

Expected: clean non-ignored worktree; ignored runtime, credentials, caches and preserved orphan file still exist.

- [ ] **Step 6: Resolve exact checkpoint IDs and write the external recovery README**

Resolve full commit IDs first:

```bash
formal_checkpoint_sha="$(git rev-parse HEAD~1)"
pc_visual_checkpoint_sha="$(git rev-parse HEAD)"
test "${#formal_checkpoint_sha}" -eq 40
test "${#pc_visual_checkpoint_sha}" -eq 40
printf '%s\n%s\n' "$formal_checkpoint_sha" "$pc_visual_checkpoint_sha"
```

Use `apply_patch` to create the external README. It must embed those exact 40-character values, identify source capture design commit `a042306`, branch `codex/formal-foundation`, source exclusions, clean-stop condition, unapproved candidate-document status, and recovery-only purpose. Append exact repository and runtime `SHA256SUMS` contents without copying secret values. Reject abbreviated SHAs or descriptive placeholder text.

- [ ] **Step 7: Reverify archive checksums and final Git identity**

```bash
m0_snapshot_root='/Volumes/公司文件/Whole Hearted Car Service 救援档案/2026-08-27_a042306_单应用合并M0'
(cd "$m0_snapshot_root/repository" && shasum -a 256 -c SHA256SUMS)
(cd "$m0_snapshot_root/runtime" && shasum -a 256 -c SHA256SUMS)
git log -3 --oneline --decorate
git status --short --untracked-files=all
```

Expected: every checksum reports `OK`; log shows design plus two checkpoint commits; status is empty.

## M0 Completion Gate

M0 is complete only when all six tasks pass and these facts are simultaneously true:

1. Source and stopped-runtime archives exist only under `/Volumes/公司文件` and pass SHA-256 verification.
2. No credential, runtime database, upload file, cache, result, or TypeScript build info is staged or committed.
3. Candidate business and acceptance documents are visibly marked unapproved.
4. Root tests/typecheck, PC unit tests/typecheck, and four formal handoff E2E tests pass from the captured source state.
5. Formal root source and isolated PC visual source are separate commits.
6. The non-ignored working tree is clean without deleting ignored local data.
7. M1 compatibility-probe work has not started.
