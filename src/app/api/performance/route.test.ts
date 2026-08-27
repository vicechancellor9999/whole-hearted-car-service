import { describe, expect, it, vi } from "vitest";
import { createPerformanceApiHandler } from "@formal/app/api/performance/route";

describe("GET /api/performance", () => {
  it("passes the requested month and authenticated account to the formal performance service", async () => {
    const detail = {
      month: "2026-08",
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      completionRate: null,
      teams: [],
      handoffs: [],
    };
    const getMonthlyPerformance = vi.fn(async () => detail);
    const handler = createPerformanceApiHandler({
      readSession: async () => ({ account: { id: 7 } }),
      getMonthlyPerformance,
    });

    const response = await handler(new Request("http://localhost/api/performance?month=2026-08"));

    expect(response.status).toBe(200);
    expect(getMonthlyPerformance).toHaveBeenCalledWith({ viewerAccountId: 7, month: "2026-08" });
    expect(await response.json()).toEqual(detail);
  });

  it("does not read formal facts for an invalid month", async () => {
    const getMonthlyPerformance = vi.fn();
    const handler = createPerformanceApiHandler({
      readSession: async () => ({ account: { id: 7 } }),
      getMonthlyPerformance,
    });

    const response = await handler(new Request("http://localhost/api/performance?month=2026-13"));

    expect(response.status).toBe(400);
    expect(getMonthlyPerformance).not.toHaveBeenCalled();
  });
});
