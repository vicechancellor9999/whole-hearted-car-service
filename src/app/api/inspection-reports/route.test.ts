import { describe, expect, it, vi } from "vitest";
import { createInspectionReportsApiHandler } from "@formal/app/api/inspection-reports/route";

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
    expect(await response.json()).toMatchObject({ currentAccountId: 9, items: [] });
    expect(list).toHaveBeenCalledWith({ viewerAccountId: 9, page: 2, sourceBusinessOrderId: 12 });
  });
});

describe("POST /api/inspection-reports", () => {
  it("creates a team-owned report with an optional mechanic and special notes", async () => {
    const create = vi.fn(async () => ({ id: 41, reportNo: "IR-20260829-0001" }));
    const handler = createInspectionReportsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      list: vi.fn(),
      create,
    });
    const response = await handler(new Request("http://localhost/api/inspection-reports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-ir-api" },
      body: JSON.stringify({
        vehicleId: 3,
        inspectionTeamId: 7,
        actualInspectorStaffMemberId: null,
        summaryZh: "检查结果",
        specialCaseNotesZh: "特殊情况备注",
      }),
    }));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 3,
      inspectionTeamId: 7,
      actualInspectorStaffMemberId: null,
      summaryZh: "检查结果",
      specialCaseNotesZh: "特殊情况备注",
      findings: [],
      context: expect.objectContaining({ actorAccountId: 9, requestId: "req-ir-api" }),
    }));
  });

  it("rejects an inspection report without a submitting team", async () => {
    const create = vi.fn();
    const handler = createInspectionReportsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      list: vi.fn(),
      create,
    });
    const response = await handler(new Request("http://localhost/api/inspection-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId: 3, summaryZh: "检查结果" }),
    }));

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
