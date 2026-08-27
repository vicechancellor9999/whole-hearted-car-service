import { describe, expect, it, vi } from "vitest";
import { createRefundProofApiHandler } from "@/app/api/business-orders/[businessOrderId]/refunds/[refundId]/proof/route";

describe("POST /api/business-orders/:id/refunds/:refundId/proof", () => {
  it("stores and appends the actual non-cash refund proof after refund creation", async () => {
    const stored = {
      storageKey: "refund-files/2026/08/proof.pdf",
      originalName: "proof.pdf",
      mediaType: "application/pdf",
      sizeBytes: 100,
      sha256Hex: "a".repeat(64),
    };
    const appendRefundProof = vi.fn(async () => ({ id: 5, refundNo: "RFD-20260824-0001" }));
    const handler = createRefundProofApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      appendRefundProof,
      storeUpload: vi.fn(async () => stored),
      removeUpload: vi.fn(),
    });
    const form = new FormData();
    form.set("proof", new File(["proof"], "proof.pdf", { type: "application/pdf" }));
    const response = await handler(new Request("http://local/proof", { method: "POST", body: form }), {
      params: Promise.resolve({ businessOrderId: "12", refundId: "5" }),
    });
    expect(response.status).toBe(200);
    expect(appendRefundProof).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      refundId: 5,
      proof: stored,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });
});
