import { describe, expect, it, vi } from "vitest";
import { createDashboardApiHandler } from "@/app/api/dashboard/route";
import { DashboardReadDeniedError } from "@/modules/dashboard/dashboard-service";

describe("GET /api/dashboard", () => {
  it("returns only the formal dashboard projection", async () => {
    const summary = {
      header: { title: "经营概览" },
      teamPerformance: { teams: [] },
      periods: [],
      topCards: [{ id: "accounts_receivable", value: 0 }],
      bottomCards: [],
    };
    const getSummary = vi.fn(async () => summary);
    const handler = createDashboardApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getSummary,
    });
    const response = await handler();
    expect(response.status).toBe(200);
    expect(getSummary).toHaveBeenCalledWith({ viewerAccountId: 9 });
    expect(await response.json()).toEqual(summary);
  });

  it("rejects an anonymous dashboard read", async () => {
    const handler = createDashboardApiHandler({
      readSession: async () => null,
      getSummary: vi.fn(),
    });
    expect((await handler()).status).toBe(401);
  });

  it("keeps access-denied errors public but hides unexpected backend failures", async () => {
    const denied = createDashboardApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getSummary: vi.fn(async () => { throw new DashboardReadDeniedError(); }),
    });
    const deniedResponse = await denied();
    expect(deniedResponse.status).toBe(403);
    expect(await deniedResponse.json()).toEqual({ error: "当前账号不能查看经营概览" });

    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = createDashboardApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getSummary: vi.fn(async () => { throw new Error("postgres://secret@db/schema failure"); }),
    });
    const failedResponse = await failed();
    expect(failedResponse.status).toBe(500);
    expect(await failedResponse.json()).toEqual({ error: "经营概览读取失败" });
    expect(report).toHaveBeenCalledOnce();
    report.mockRestore();
  });
});
