import { describe, expect, it, vi } from "vitest";
import { createReceiptApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/receipts/[receiptId]/route";

describe("GET /api/business-orders/:businessOrderId/receipts/:receiptId", () => {
  it("returns the immutable Receipt snapshot for the matching Business Order", async () => {
    const getReceipt = vi.fn(async () => ({
      id: 8,
      receiptNo: "RCT-20260824-0001",
      businessOrderId: 12,
      snapshot: { version: 1 },
    }));
    const handler = createReceiptApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getReceipt,
    });
    const response = await handler({
      params: Promise.resolve({ businessOrderId: "12", receiptId: "8" }),
    });
    expect(response.status).toBe(200);
    expect(getReceipt).toHaveBeenCalledWith({ receiptId: 8, viewerAccountId: 9 });
    expect(await response.json()).toMatchObject({
      id: 8,
      receiptNo: "RCT-20260824-0001",
      businessOrderId: 12,
    });
  });

  it("does not expose a Receipt through the wrong Business Order", async () => {
    const handler = createReceiptApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getReceipt: async () => ({ id: 8, businessOrderId: 99 }),
    });
    const response = await handler({
      params: Promise.resolve({ businessOrderId: "12", receiptId: "8" }),
    });
    expect(response.status).toBe(404);
  });
});
