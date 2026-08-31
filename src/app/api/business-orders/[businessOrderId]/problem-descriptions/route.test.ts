import { describe, expect, it, vi } from "vitest";
import { BusinessOrderConflictError } from "@formal/modules/business-order/business-order-service";
import { createBusinessOrderProblemDescriptionsApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/problem-descriptions/route";

describe("POST /api/business-orders/:id/problem-descriptions", () => {
  it("requires a formal session and a valid Business Order id", async () => {
    const noSession = createBusinessOrderProblemDescriptionsApiHandler({
      readSession: async () => null,
      appendProblemDescriptionVersion: vi.fn(),
      getProblemDescriptionContext: vi.fn(),
    });
    expect((await noSession(
      new Request("http://localhost/api/business-orders/12/problem-descriptions", {
        method: "POST",
      }),
      { params: Promise.resolve({ businessOrderId: "12" }) },
    )).status).toBe(401);

    const invalidId = createBusinessOrderProblemDescriptionsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      appendProblemDescriptionVersion: vi.fn(),
      getProblemDescriptionContext: vi.fn(),
    });
    expect((await invalidId(
      new Request("http://localhost/api/business-orders/no/problem-descriptions", {
        method: "POST",
      }),
      { params: Promise.resolve({ businessOrderId: "no" }) },
    )).status).toBe(400);
  });

  it("appends one scoped version with the authenticated action context", async () => {
    const appendProblemDescriptionVersion = vi.fn(async () => ({
      current: { versionNo: 2, contentZh: "发动机异响并伴随抖动" },
    }));
    const handler = createBusinessOrderProblemDescriptionsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      appendProblemDescriptionVersion,
      getProblemDescriptionContext: vi.fn(),
    });
    const response = await handler(
      new Request("http://localhost/api/business-orders/12/problem-descriptions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-problem-v2",
        },
        body: JSON.stringify({
          scope: "business_order",
          expectedVersion: 1,
          contentZh: " 发动机异响并伴随抖动 ",
          contentEn: null,
          reason: " 补充客户描述 ",
          sourceType: "manual",
        }),
      }),
      { params: Promise.resolve({ businessOrderId: "12" }) },
    );
    expect(response.status).toBe(200);
    expect(appendProblemDescriptionVersion).toHaveBeenCalledWith({
      businessOrderId: 12,
      repairRoundId: null,
      scope: "business_order",
      expectedVersion: 1,
      contentZh: " 发动机异响并伴随抖动 ",
      contentEn: null,
      reason: " 补充客户描述 ",
      sourceType: "manual",
      sourceReferenceId: null,
      context: expect.objectContaining({
        actorAccountId: 9,
        requestId: "req-problem-v2",
      }),
    });
  });

  it("returns the latest context with a version conflict", async () => {
    const current = {
      original: { contentZh: "发动机异响" },
      current: { versionNo: 3, contentZh: "最新问题描述" },
      currentRound: null,
    };
    const handler = createBusinessOrderProblemDescriptionsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      appendProblemDescriptionVersion: vi.fn(async () => {
        throw new BusinessOrderConflictError();
      }),
      getProblemDescriptionContext: vi.fn(async () => current),
    });
    const response = await handler(
      new Request("http://localhost/api/business-orders/12/problem-descriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "business_order",
          expectedVersion: 1,
          contentZh: "过期内容",
          reason: "测试冲突",
          sourceType: "manual",
        }),
      }),
      { params: Promise.resolve({ businessOrderId: "12" }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
      current,
    });
  });
});
