import { describe, expect, it, vi } from "vitest";
import { createRefundSignedAcknowledgementApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/refunds/[refundId]/signed-acknowledgement/route";

describe("POST /api/business-orders/:businessOrderId/refunds/:refundId/signed-acknowledgement", () => {
  it("uploads a signed paper acknowledgement after the refund was recorded", async () => {
    const appendRefundSignedAcknowledgement = vi.fn(async () => ({
      id: 31,
      refundNo: "RFD-20260824-0001",
    }));
    const storeUpload = vi.fn(async () => ({
      storageKey: "refund-files/2026/08/signed.pdf",
      originalName: "signed.pdf",
      mediaType: "application/pdf" as const,
      sizeBytes: 4,
      sha256Hex: "a".repeat(64),
    }));
    const handler = createRefundSignedAcknowledgementApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      appendRefundSignedAcknowledgement,
      storeUpload,
      removeUpload: vi.fn(),
    });
    const form = new FormData();
    form.set("signedAcknowledgement", new File(["test"], "signed.pdf", { type: "application/pdf" }));

    const response = await handler(new Request("http://local/api/business-orders/12/refunds/31/signed-acknowledgement", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ businessOrderId: "12", refundId: "31" }) });

    expect(response.status).toBe(200);
    expect(appendRefundSignedAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      refundId: 31,
      signedAcknowledgement: expect.objectContaining({ originalName: "signed.pdf" }),
    }));
  });
});
