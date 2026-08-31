import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createFormalBusinessOrder } from "../../src/lib/api/formal-business-orders";

test("formal Business Order creation sends a normalized optional problem description", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ id: 8 }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await createFormalBusinessOrder({
      vehicleId: 7,
      companyContactId: null,
      problemDescriptionZh: "  发动机故障灯偶发点亮  ",
    });
    await createFormalBusinessOrder({
      vehicleId: 9,
      problemDescriptionZh: "   ",
      problemDescriptionEn: "",
    });
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      vehicleId: 7,
      companyContactId: null,
      problemDescriptionZh: "发动机故障灯偶发点亮",
      problemDescriptionEn: null,
    });
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      vehicleId: 9,
      problemDescriptionZh: null,
      problemDescriptionEn: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the high-frequency create panel keeps a visible optional multiline problem field", () => {
  const source = readFileSync(resolve(
    process.cwd(),
    "src/components/orders/formal-business-orders-workspace.tsx",
  ), "utf8");
  expect(source).toContain('data-testid="business-order-problem-description"');
  expect(source).toContain("problemDescriptionZh");
  expect(source).toContain("<textarea");
  expect(source).toContain('t("businessOrder.create.problemDescription")');
  expect(source).toContain('t("businessOrder.create.problemDescriptionOptional")');
  expect(source).toMatch(/problemDescriptionZh(?:\s*[:,}]|\s*$)/m);
});
