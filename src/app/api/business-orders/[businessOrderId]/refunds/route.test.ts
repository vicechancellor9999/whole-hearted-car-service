import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderRefundApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/refunds/route";

describe("POST /api/business-orders/:id/refunds", () => {
  it("creates a non-cash refund before any payment proof exists", async () => {
    const recordRefund = vi.fn(async (_input: unknown) => ({ id: 5, refundNo: "RFD-20260824-0001", evidence: [] }));
    const handler = createBusinessOrderRefundApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      recordRefund,
    });
    const form = new FormData();
    form.set("amount", "5000");
    form.set("paymentMethodItemId", "4");
    form.set("reason", "银行退款");
    form.set("originalDocumentStatus", "returned");
    const response = await handler(new Request("http://local/api/business-orders/12/refunds", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ businessOrderId: "12" }) });
    expect(response.status).toBe(201);
    expect(recordRefund).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      amount: "5000",
    }));
    expect(recordRefund.mock.calls[0]?.[0]).not.toHaveProperty("customerSignature");
    expect(recordRefund.mock.calls[0]?.[0]).not.toHaveProperty("proof");
  });
});
