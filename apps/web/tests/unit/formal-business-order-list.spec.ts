import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fetchFormalBusinessOrders,
  formalBusinessOrderCategoryLabel,
} from "../../src/lib/api/formal-business-orders";

test("business-order category labels are concise Chinese operations terms", () => {
  expect(["maintenance", "repair", "inspection", "rework"].map((category) =>
    formalBusinessOrderCategoryLabel(category as "maintenance" | "repair" | "inspection" | "rework")
  )).toEqual(["保养", "维修", "检查", "返修"]);
});

test("business-order list sends the selected category to the formal API", async () => {
  const previousFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, pageCount: 1, total: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await fetchFormalBusinessOrders({ category: "rework", page: 1 });
    expect(requested).toContain("category=rework");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("business-order workspace keeps the added facts in one compact operational row", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/orders/formal-business-orders-workspace.tsx"),
    "utf8",
  );
  expect(source).toContain("分类 / 维修内容");
  expect(source).toContain("formatFormalMoney(order.totalDueMinor)");
  expect(source).toContain("order.assignedTeam?.name");
  expect(source).toContain('aria-label="按业务分类筛选"');
  expect(source).toContain('role="group"');
});
