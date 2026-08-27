import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";

test("经营收款分析只读取正式今日、本周、本月、本年数据", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const range = new URL(String(input), "http://localhost").searchParams.get("range") ?? "week";
    return new Response(JSON.stringify({
      asOfDate: "2026-08-24",
      timeZone: "America/Jamaica",
      range,
      summary: {
        total: 0,
        labor: 0,
        parts: 0,
        paymentCount: 0,
        refundCount: 0,
        grossPaidJmd: 0,
        cashRefundedJmd: 0,
        netPaidJmd: 0,
        previousMonthOperatingAverage: 0,
        comparison: { direction: "steady", percent: 0 },
        methods: [],
      },
      rows: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    for (const range of ["day", "week", "month", "year"] as const) {
      await expect(api.revenue.detail(range)).resolves.toMatchObject({ range });
    }
    expect(calls).toEqual([
      "/api/formal/revenue?range=day",
      "/api/formal/revenue?range=week",
      "/api/formal/revenue?range=month",
      "/api/formal/revenue?range=year",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("正式经营收款读取失败时保留后端错误", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "经营收款暂时不可用" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  try {
    await expect(api.revenue.detail("week")).rejects.toThrow(/经营收款暂时不可用/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
