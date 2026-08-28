# Business Order Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted Business Order messages, employee mentions, unread state, edit history, and an in-app mention inbox to the approved communication workspace.

**Architecture:** Add a focused collaboration domain beside Business Order, with its own tables, service and permission checks. The Business Order page loads messages only when the messages tab is active; global mention discovery uses a small `/mentions` page and unread badge backed by the same formal APIs.

**Tech Stack:** Next.js App Router, React, TypeScript, PostgreSQL, Drizzle ORM, Vitest, Playwright unit tests.

**Spec:** `docs/superpowers/specs/2026-08-28-business-order-four-workspaces-design.md`

## Global Constraints

- Collaboration permission is separate from charging, payment, refund, repair-state, and master-data permissions.
- Only active internal accounts with read access to a Business Order may publish messages on it.
- A message body is trimmed plain text, 1-4,000 characters.
- Only active accounts may be mentioned.
- Authors may edit their own messages with version protection; every prior body is retained.
- Messages are retained and not silently deleted.
- Mention unread/read state is stored in PostgreSQL.
- Author identity comes from the server session, never the request body.

---

### Task 1: Add the collaboration schema and permission

**Files:**
- Create: `src/db/schema/business-order-message.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0025_business_order_messages.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/modules/permissions/permissions.ts`
- Modify: `src/modules/permissions/permissions.test.ts`

**Interfaces:**
- Produces: tables `business_order_messages`, `business_order_message_mentions`, `business_order_message_revisions`; permission `business_order.collaborate`.

- [ ] **Step 1: Write the failing permission test**

```ts
expect(hasPermission("super_admin", "business_order.collaborate")).toBe(true);
expect(hasPermission("front_desk", "business_order.collaborate")).toBe(true);
expect(hasPermission("owner", "business_order.collaborate")).toBe(true);
expect(hasPermission("mechanic", "business_order.collaborate")).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run src/modules/permissions/permissions.test.ts`

Expected: FAIL because the permission literal is missing.

- [ ] **Step 3: Add permission and tables**

Messages store `business_order_id`, author account and display/role snapshots, `body`, `version`, `created_at`, `edited_at`. Mentions have a unique `(message_id, mentioned_account_id)` key and `read_at`. Revisions have a unique `(message_id, version)` key and store the replaced body and editor. Add positive-version and trimmed-body constraints and indexes for order timeline and unread account lookup.

- [ ] **Step 4: Run permission, schema and type verification**

Run: `pnpm vitest run src/modules/permissions/permissions.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit schema and permission**

```bash
git add src/db/schema src/modules/permissions drizzle
git commit -m 'feat: add business order collaboration schema'
```

### Task 2: Implement the collaboration service with transactions

**Files:**
- Create: `src/modules/business-order/business-order-collaboration-service.ts`
- Create: `src/modules/business-order/business-order-collaboration-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-runtime.ts`

**Interfaces:**
- Produces: `listMessages`, `createMessage`, `editMessage`, `markMentionsRead`, `listMyMentions`, and `listMentionableAccounts`.

- [ ] **Step 1: Write failing integration tests**

Cover these literal outcomes:

```ts
expect(created.authorAccountId).toBe(frontDesk.id);
expect(created.mentions.map((item) => item.accountId)).toEqual([owner.id]);
expect((await service.listMyMentions({ accountId: owner.id })).items[0].readAt).toBeNull();
expect((await service.markMentionsRead({ businessOrderId, accountId: owner.id })).updated).toBe(1);
```

Also assert inactive mention rejection, blank/4,001-character rejection, duplicate mention collapse, foreign-author edit rejection, Business Order read-scope rejection, revision preservation, and stale version conflict.

- [ ] **Step 2: Run the integration test and verify missing module failure**

Run: `pnpm vitest run src/modules/business-order/business-order-collaboration-service.integration.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement readers and access checks**

Reuse the existing Business Order reader/data-scope contract before every operation. `listMentionableAccounts` returns only `{ id, displayName, role }` for active accounts. List messages by `(created_at desc, id desc)` stable cursor and return author snapshot, edit marker and mention display names.

- [ ] **Step 4: Implement transactional create/edit/read operations**

Create inserts the message, deduplicated mentions and audit event in one transaction. Edit locks the message, verifies author and expected version, inserts the replaced body into revisions, updates body/version/edited time, replaces mention rows, and appends audit. Mark-read updates only rows for the current account and selected Business Order.

- [ ] **Step 5: Run collaboration and full service tests**

Run: `pnpm vitest run src/modules/business-order/business-order-collaboration-service.integration.test.ts && pnpm test && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the collaboration service**

```bash
git add src/modules/business-order
git commit -m 'feat: implement business order collaboration service'
```

### Task 3: Add formal collaboration APIs and compatibility routes

**Files:**
- Create: `src/app/api/business-orders/[businessOrderId]/messages/route.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/messages/route.test.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/messages/[messageId]/route.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/messages/[messageId]/route.test.ts`
- Create: `src/app/api/business-orders/[businessOrderId]/messages/read/route.ts`
- Create: `src/app/api/me/mentions/route.ts`
- Create: `src/app/api/me/mentionable-accounts/route.ts`
- Create matching compatibility routes under: `apps/web/src/app/api/formal/`

**Interfaces:**
- Consumes: collaboration service from Task 2.
- Produces: the five API contracts specified by the design plus mentionable accounts.

- [ ] **Step 1: Write failing route tests**

Assert 401 without session, 400 for invalid IDs/body, 403 for access denial, 409 for version conflict, 201 for create, 200 for edit/read/list, and that actor account ID always comes from `readSession()`.

- [ ] **Step 2: Run focused route tests and verify failure**

Run: `pnpm vitest run 'src/app/api/business-orders/**/messages/**/*.test.ts' 'src/app/api/me/*.test.ts'`

Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement root formal routes**

Use Zod bodies:

```ts
const createSchema = z.object({ body: z.string().trim().min(1).max(4000), mentionedAccountIds: z.array(z.number().int().positive()).max(50).default([]) });
const editSchema = createSchema.extend({ expectedVersion: z.number().int().positive() });
```

Read the session before parsing Business Order/message IDs, call the service, and use the existing stable Business Order error envelope.

- [ ] **Step 4: Add `/api/formal` compatibility handlers**

After the single-runtime plan, re-export the corresponding root handlers:

```ts
export { GET, POST } from "@formal/app/api/business-orders/[businessOrderId]/messages/route";
```

Use the same direct export for the message edit, read, mentions and mentionable-account routes. If this task is executed before the alias migration, use the existing compatibility wrapper with these exact target paths and body modes, then replace it during the single-runtime task:

```ts
return forwardFormalBackend(request, `/api/business-orders/${encodeURIComponent(businessOrderId)}/messages`, request.method === "GET" ? "none" : "json");
```

- [ ] **Step 5: Run route and type verification**

Run: `pnpm test && pnpm typecheck && pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the APIs**

```bash
git add src/app/api apps/web/src/app/api/formal
git commit -m 'feat: expose business order collaboration APIs'
```

### Task 4: Build the messages workspace

**Files:**
- Create: `apps/web/src/lib/api/formal-business-order-collaboration.ts`
- Create: `apps/web/src/components/orders/formal-business-order-messages.tsx`
- Create: `apps/web/tests/unit/formal-business-order-messages.spec.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`
- Modify: `apps/web/src/components/orders/formal-business-order-tabs.tsx`

**Interfaces:**
- Consumes: Task 3 APIs.
- Produces: lazy-loaded message timeline, composer, mention picker, edit form, read state and unread tab badge.

- [ ] **Step 1: Write failing component tests**

Render two messages and assert author/time/body; choose an employee in the mention picker, submit and assert the request body contains the selected ID; edit the current user's message and assert `expectedVersion`; verify foreign messages have no edit action and edited messages display “已编辑”.

- [ ] **Step 2: Run the component test and verify failure**

Run: `pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-business-order-messages.spec.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement typed API functions**

Export `fetchFormalBusinessOrderMessages`, `createFormalBusinessOrderMessage`, `editFormalBusinessOrderMessage`, `markFormalBusinessOrderMentionsRead`, and `fetchFormalMentionableAccounts`. Reuse the existing no-store JSON/error wrapper and notify formal data changes after writes.

- [ ] **Step 4: Implement the communication workspace**

Fetch only while the tab is active. Render an accessible timeline, plain-text body with preserved line breaks, `@` multi-select suggestions, 4,000-character counter, submit in-flight guard, retry errors, author-only inline edit, cursor “加载更多”, and highlighted deep-linked message. After messages render, mark current-account mentions in this Business Order read and refresh the unread badge.

- [ ] **Step 5: Integrate capabilities and unread badge**

Extend the detail DTO with `canCollaborate`, current account ID, and unread mention count. Pass them to the tab and message components without changing `canWrite`, `canRecordPayment`, or `canRefund` guards.

- [ ] **Step 6: Run UI verification**

Run: `pnpm --dir apps/web test:unit && pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the messages workspace**

```bash
git add apps/web/src/lib/api apps/web/src/components/orders apps/web/tests/unit
git commit -m 'feat: add business order communication workspace'
```

### Task 5: Add the in-app mention inbox

**Files:**
- Create: `apps/web/src/app/mentions/page.tsx`
- Create: `apps/web/src/components/collaboration/formal-mention-inbox.tsx`
- Create: `apps/web/tests/unit/formal-mention-inbox.spec.ts`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/lib/api/formal-business-order-collaboration.ts`

**Interfaces:**
- Produces: `/mentions` and a shell badge linking to each `?tab=messages&message=<id>` target.

- [ ] **Step 1: Write the failing inbox test**

Render one unread and one read mention; assert the unread indicator, Business Order number, sender and timestamp. Click the unread item and assert the target is `/orders/business/7?tab=messages&message=41`.

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-mention-inbox.spec.ts`

Expected: FAIL because the inbox does not exist.

- [ ] **Step 3: Implement inbox and shell entry**

Fetch `/api/formal/me/mentions` with stable cursor. Show unread count in the app shell, a dedicated “我的提及” route, accessible empty/error/loading states, and deep links to the Business Order message.

- [ ] **Step 4: Run unit and type verification**

Run: `pnpm --dir apps/web test:unit && pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit mention discovery**

```bash
git add apps/web/src/app/mentions apps/web/src/components/collaboration apps/web/src/components/layout apps/web/src/lib/api apps/web/tests/unit
git commit -m 'feat: add internal mention inbox'
```

### Task 6: Verify persistence, roles and no privilege escalation

**Files:**
- Create externally: `/Volumes/公司文件/Whole Hearted Car Service 单体候选/verification/business-order-collaboration/`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: automated and browser evidence for collaboration behavior.

- [ ] **Step 1: Run the complete automated gate**

Run: `pnpm test && pnpm typecheck && pnpm --dir apps/web test:unit && pnpm --dir apps/web typecheck && pnpm --dir apps/web build && git diff --check`

Expected: every command exits 0.

- [ ] **Step 2: Verify the real workflow in browsers**

Using synthetic accounts, post from front desk, mention owner, reload and verify persistence, sign in as owner, open “我的提及”, follow the deep link, mark read, edit the owner's own reply, and verify the edited marker. Confirm owner cannot edit charges, record payments/refunds or change repair state.

- [ ] **Step 3: Verify mechanic data scope**

With a mechanic account, call the collaboration API for one assigned-team Business Order and one unrelated Business Order. Expect success for the assigned order and 403 for the unrelated order; verify no PC dashboard permission is granted.

- [ ] **Step 4: Verify restart persistence and conflict handling**

Restart only the candidate app/database, reload the messages, then edit the same message from two sessions. Confirm the stale session receives 409 and its draft remains available.

- [ ] **Step 5: Record the safe result**

Save logs and screenshots only under the external verification path. Leave the accepted candidate running for user review only when all checks pass.
