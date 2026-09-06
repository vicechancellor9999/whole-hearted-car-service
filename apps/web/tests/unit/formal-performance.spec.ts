import { expect, test } from "@playwright/test";
import { fetchFormalPerformance } from "../../src/lib/api/formal-performance";

test("performance bypasses the Mock dispatcher and reads the formal monthly projection", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({
      month: "2026-08",
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      completionRate: null,
      targetMissingReasons: ["缺少 2026-08 绩效参数"],
      teams: [],
      handoffs: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await fetchFormalPerformance("2026-08");
    expect(requested).toBe("/api/formal/performance?month=2026-08");
    expect(result.targetMissingReasons).toEqual(["缺少 2026-08 绩效参数"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performance month navigation preserves the selected team", async () => {
  const performanceApi = await import("../../src/lib/api/formal-performance") as unknown as {
    performanceMonthHref?: (month: string, teamId: number | null) => string;
  };

  expect(typeof performanceApi.performanceMonthHref).toBe("function");
  expect(performanceApi.performanceMonthHref?.("2026-08", 4))
    .toBe("/performance?month=2026-08&team=4");
  expect(performanceApi.performanceMonthHref?.("2026-08", null))
    .toBe("/performance?month=2026-08");
});
