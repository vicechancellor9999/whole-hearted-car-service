import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { appendFormalProblemDescription } from "@/lib/api/formal-business-orders";

test("problem description append keeps Business Order and repair-round saves explicit", async () => {
  const requests: Array<{ url: string; body?: BodyInit | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body });
    return new Response(JSON.stringify({ current: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await appendFormalProblemDescription(12, {
    scope: "repair_round",
    repairRoundId: 4,
    expectedVersion: 2,
    contentZh: "  本轮检查异响  ",
    contentEn: "",
    reason: "  补充本轮范围  ",
  });

  expect(requests[0]?.url).toContain("/api/formal/business-orders/12/problem-descriptions");
  expect(JSON.parse(String(requests[0]?.body))).toEqual({
    scope: "repair_round",
    repairRoundId: 4,
    expectedVersion: 2,
    contentZh: "本轮检查异响",
    contentEn: null,
    reason: "补充本轮范围",
    sourceType: "manual",
  });
});

test("detail component presents current context, distinct round context and history without exposing edits to read-only users", async () => {
  const source = await readFile(path.join(
    process.cwd(),
    "src/components/orders/formal-business-order-problem-description.tsx",
  ), "utf8");

  expect(source).toContain('data-testid="business-order-problem-context"');
  expect(source).toContain('data-testid="business-order-current-problem"');
  expect(source).toContain('data-testid="repair-round-current-problem"');
  expect(source).toContain("descriptionsDiffer");
  expect(source).toContain("businessOrderHistory");
  expect(source).toContain("currentRoundHistory");
  expect(source).toContain("canWrite");
  expect(source).toContain('scope === "business_order"');
  expect(source).toContain('scope === "repair_round"');
  expect(source).toContain("Problem description");
  expect(source).toContain("Original description");
});
