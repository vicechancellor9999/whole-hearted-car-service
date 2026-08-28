import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderAttachmentFileApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/attachments/[attachmentId]/route";

describe("GET /api/business-orders/:businessOrderId/attachments/:attachmentId", () => {
  it("returns protected bytes with inline filename headers", async () => {
    const getAttachmentFile = vi.fn(async () => ({
      storageKey: "business-order-files/2026/08/photo.jpg",
      originalName: "客户签字.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 5,
    }));
    const handler = createBusinessOrderAttachmentFileApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getAttachmentFile,
      resolvePath: (storageKey) => `/uploads/${storageKey}`,
      readBytes: vi.fn(async () => Buffer.from("photo")),
    });
    const response = await handler(new Request("http://local"), {
      params: Promise.resolve({ businessOrderId: "12", attachmentId: "7" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(getAttachmentFile).toHaveBeenCalledWith({ businessOrderId: 12, attachmentId: 7, viewerAccountId: 9 });
  });
});
