import { describe, expect, it, vi } from "vitest";
import { createRevenueApiHandler } from "@formal/app/api/revenue/route";
import { RevenueReadDeniedError } from "@formal/modules/revenue/revenue-service";

describe("GET /api/revenue", () => {
  it("returns a formal period projection", async () => {
    const detail = { range: "month", summary: { netPaidJmd: 3200 }, rows: [] };
    const getDetail = vi.fn(async () => detail);
    const handler = createRevenueApiHandler({
      readSession: async () => ({ account: { id: 7 } }),
      getDetail,
    });
    const response = await handler(new Request("http://localhost/api/revenue?range=month"));
    expect(response.status).toBe(200);
    expect(getDetail).toHaveBeenCalledWith({ viewerAccountId: 7, range: "month" });
    expect(await response.json()).toEqual(detail);
  });

  it("rejects an invalid range before reading revenue", async () => {
    const getDetail = vi.fn();
    const handler = createRevenueApiHandler({
      readSession: async () => ({ account: { id: 7 } }),
      getDetail,
    });
    const response = await handler(new Request("http://localhost/api/revenue?range=quarter"));
    expect(response.status).toBe(400);
    expect(getDetail).not.toHaveBeenCalled();
  });

  it("keeps access-denied errors public but hides unexpected backend failures", async () => {
    const denied = createRevenueApiHandler({
      readSession: async () => ({ account: { id: 7 } }),
      getDetail: vi.fn(async () => { throw new RevenueReadDeniedError(); }),
    });
    const deniedResponse = await denied(new Request("http://localhost/api/revenue?range=day"));
    expect(deniedResponse.status).toBe(403);
    expect(await deniedResponse.json()).toEqual({ error: "当前账号不能查看经营收款分析" });

    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = createRevenueApiHandler({
      readSession: async () => ({ account: { id: 7 } }),
      getDetail: vi.fn(async () => { throw new Error("relation secret_table does not exist"); }),
    });
    const failedResponse = await failed(new Request("http://localhost/api/revenue?range=day"));
    expect(failedResponse.status).toBe(500);
    expect(await failedResponse.json()).toEqual({ error: "经营收款分析读取失败" });
    expect(report).toHaveBeenCalledOnce();
    report.mockRestore();
  });
});
