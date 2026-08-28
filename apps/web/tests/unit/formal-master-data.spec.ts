import { expect, test } from "@playwright/test";
import {
  createFormalRepairTeam,
  fetchFormalMasterData,
  reorderFormalRepairTeams,
  setFormalPayrollParameters,
  setFormalTeamCommissionRate,
} from "../../src/lib/api/formal-master-data";

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

test("formal master data posts the complete repair-team order", async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  try {
    await reorderFormalRepairTeams([3, 1, 2]);
    expect(body).toEqual({ action: "reorder_teams", orderedTeamIds: [3, 1, 2] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("formal master data saves whole-shop and team commission parameter versions", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }) as typeof fetch;
  try {
    await setFormalPayrollParameters({
      effectiveMonth: "2026-08",
      commissionRate: "0.250000",
      cnyToJmdRate: "22.000000",
    });
    await setFormalTeamCommissionRate({
      teamId: 8,
      effectiveMonth: "2026-09",
      commissionRate: null,
    });
    expect(bodies).toEqual([{
      action: "set_payroll_parameters",
      effectiveMonth: "2026-08",
      commissionRate: "0.250000",
      cnyToJmdRate: "22.000000",
    }, {
      action: "set_team_commission_rate",
      teamId: 8,
      effectiveMonth: "2026-09",
      commissionRate: null,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
