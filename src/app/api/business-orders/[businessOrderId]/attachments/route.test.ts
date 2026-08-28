import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderAttachmentsApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/attachments/route";

describe("/api/business-orders/:businessOrderId/attachments", () => {
  it("lists authorized attachments", async () => {
    const listAttachments = vi.fn(async () => ({ items: [{ id: 7 }] }));
    const handler = createBusinessOrderAttachmentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listAttachments,
      registerAttachment: vi.fn(),
      storeUpload: vi.fn(),
      removeUpload: vi.fn(),
    });
    const response = await handler(new Request("http://local", { method: "GET" }), {
      params: Promise.resolve({ businessOrderId: "12" }),
    });
    expect(response.status).toBe(200);
    expect(listAttachments).toHaveBeenCalledWith({ businessOrderId: 12, viewerAccountId: 9 });
  });

  it("stores multipart bytes and registers only formal metadata", async () => {
    const stored = {
      storageKey: "business-order-files/2026/08/photo.jpg",
      originalName: "photo.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 5,
      sha256Hex: "a".repeat(64),
    };
    const registerAttachment = vi.fn(async () => ({ id: 7, category: "service_photo" }));
    const handler = createBusinessOrderAttachmentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listAttachments: vi.fn(),
      registerAttachment,
      storeUpload: vi.fn(async () => stored),
      removeUpload: vi.fn(),
    });
    const form = new FormData();
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
    form.set("category", "service_photo");
    form.set("caption", "完工照片");
    const response = await handler(new Request("http://local", { method: "POST", body: form }), {
      params: Promise.resolve({ businessOrderId: "12" }),
    });
    expect(response.status).toBe(201);
    expect(registerAttachment).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      category: "service_photo",
      caption: "完工照片",
      stored,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });

  it("removes stored bytes when database registration fails", async () => {
    const removeUpload = vi.fn(async () => undefined);
    const handler = createBusinessOrderAttachmentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listAttachments: vi.fn(),
      registerAttachment: vi.fn(async () => { throw new Error("database rejected"); }),
      storeUpload: vi.fn(async () => ({
        storageKey: "business-order-files/2026/08/photo.jpg",
        originalName: "photo.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 5,
        sha256Hex: "a".repeat(64),
      })),
      removeUpload,
    });
    const form = new FormData();
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
    form.set("category", "service_photo");
    const response = await handler(new Request("http://local", { method: "POST", body: form }), {
      params: Promise.resolve({ businessOrderId: "12" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(removeUpload).toHaveBeenCalledWith("business-order-files/2026/08/photo.jpg");
  });
});
