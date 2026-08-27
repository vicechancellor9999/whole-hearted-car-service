import { expect, test } from "@playwright/test";
import { createFormalRepairTeam, fetchFormalMasterData } from "../../src/lib/api/formal-master-data";

test("formal master data reads and creates teams through the backend proxy", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ id: 2, teamNo: "TEAM-002", name: "钣金喷漆", isActive: true, version: 1 }), { status: 201 });
    }
    return new Response(JSON.stringify({ dictionaries: [], teams: [], staff: [], payrollParameters: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await expect(fetchFormalMasterData()).resolves.toMatchObject({ teams: [] });
    await expect(createFormalRepairTeam("钣金喷漆")).resolves.toMatchObject({ name: "钣金喷漆" });
    expect(calls).toEqual([
      { url: "/api/formal/master-data", method: "GET" },
      { url: "/api/formal/master-data", method: "POST" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
