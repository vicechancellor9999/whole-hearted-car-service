import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";

test("revenue bypasses the Mock dispatcher and reads the formal period endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      asOfDate: "2026-08-24",
      timeZone: "America/Jamaica",
      range: "year",
      summary: { netPaidJmd: 0 },
      rows: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await api.revenue.detail("year");
    expect(result.range).toBe("year");
    expect(calls).toEqual(["/api/formal/revenue?range=year"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
