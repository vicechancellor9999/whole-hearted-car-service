import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createFormalBusinessOrderMessage,
  editFormalBusinessOrderMessage,
} from "../../src/lib/api/formal-business-order-collaboration";

test("留言发布和编辑通过正式 API 传递提及与版本", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify({ id: 8, body: "请确认", mentions: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await createFormalBusinessOrderMessage(7, { body: "请确认", mentionedAccountIds: [2] });
    await editFormalBusinessOrderMessage(7, 8, { body: "请最终确认", mentionedAccountIds: [2], expectedVersion: 3 });
    expect(String(requests[0]?.input)).toBe("/api/formal/business-orders/7/messages");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ body: "请确认", mentionedAccountIds: [2] });
    expect(String(requests[1]?.input)).toBe("/api/formal/business-orders/7/messages/8");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ body: "请最终确认", mentionedAccountIds: [2], expectedVersion: 3 });
  } finally { globalThis.fetch = originalFetch; }
});

test("沟通工作区提供发布、提及、作者编辑和已编辑标记", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/orders/formal-business-order-messages.tsx"), "utf8");
  expect(source).toMatch(/发布留言/);
  expect(source).toMatch(/mentionedIds/);
  expect(source).toMatch(/authorAccountId === currentAccountId/);
  expect(source).toMatch(/已编辑/);
  expect(source).toMatch(/markFormalBusinessOrderMentionsRead/);
});

test("我的提及深链到对应业务单留言", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/collaboration/formal-mention-inbox.tsx"), "utf8");
  expect(source).toMatch(/tab=messages&message=\$\{item\.messageId\}/);
  expect(source).toMatch(/未读/);
});
