import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderChargesApiHandler } from "@/app/api/business-orders/[businessOrderId]/charges/route";

describe("POST /api/business-orders/:id/charges", () => {
  it("replaces the editable charge draft with a new immutable version", async () => {
    const replaceCharges = vi.fn(async () => ({ versionNo: 3 }));
    const handler = createBusinessOrderChargesApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      replaceCharges,
    });
    const response = await handler(new Request("http://local/api/business-orders/12/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedBusinessOrderVersion: 2,
        reason: "前台核对后更新收费",
        laborDiscount: "0",
        partDiscount: "0",
        otherDiscount: "0",
        wholeOrderDiscount: "0",
        items: [{
          kind: "labor", nameZh: "检测工时", nameEn: "Diagnostic labor",
          descriptionZh: "读取故障码", descriptionEn: "Read fault codes",
          unitItemId: 1, quantity: "1", unitPrice: "9000", itemDiscount: "0",
        }],
        notes: [],
      }),
    }), { params: Promise.resolve({ businessOrderId: "12" }) });

    expect(response.status).toBe(201);
    expect(replaceCharges).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      expectedBusinessOrderVersion: 2,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
    expect(await response.json()).toMatchObject({ versionNo: 3 });
  });
});
