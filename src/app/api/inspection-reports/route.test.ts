import { describe, expect, it, vi } from "vitest";
import { createInspectionReportsApiHandler } from "@/app/api/inspection-reports/route";

describe("GET /api/inspection-reports", () => {
  it("requires a formal session", async () => {
    const handler = createInspectionReportsApiHandler({
      readSession: async () => null,
      list: vi.fn(),
    });

    expect((await handler(new Request("http://localhost/api/inspection-reports"))).status).toBe(401);
  });

  it("lists standalone reports and optionally narrows them by their source Business Order", async () => {
    const list = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 }));
    const handler = createInspectionReportsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      list,
    });

    const response = await handler(new Request("http://localhost/api/inspection-reports?page=2&sourceBusinessOrderId=12"));

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ viewerAccountId: 9, page: 2, sourceBusinessOrderId: 12 });
  });
});
