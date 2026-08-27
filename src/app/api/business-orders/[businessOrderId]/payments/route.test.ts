import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderPaymentApiHandler } from "@/app/api/business-orders/[businessOrderId]/payments/route";

describe("POST /api/business-orders/:id/payments", () => {
  it("records one payment and returns its unique Receipt", async () => {
    const recordPayment = vi.fn(async () => ({
      payment: { id: 1, paymentNo: "PAY-20260824-0001" },
      receipt: { id: 2, receiptNo: "RCT-20260824-0001" },
    }));
    const handler = createBusinessOrderPaymentApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      recordPayment,
    });
    const response = await handler(new Request("http://local/api/business-orders/12/payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: "3000", paymentMethodItemId: 3, note: "首笔收款" }),
    }), { params: Promise.resolve({ businessOrderId: "12" }) });
    expect(response.status).toBe(201);
    expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      amount: "3000",
      paymentMethodItemId: 3,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
    expect(await response.json()).toMatchObject({ receipt: { receiptNo: "RCT-20260824-0001" } });
  });
});
