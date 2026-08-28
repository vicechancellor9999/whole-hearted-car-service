import { expect, test } from "@playwright/test";
import {
  fetchFormalBusinessOrderAttachments,
  uploadFormalBusinessOrderAttachment,
} from "../../src/lib/api/formal-business-order-attachments";

test("业务单附件适配器读取列表并使用 multipart 上传", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify(init?.method === "POST" ? { id: 8 } : { items: [] }), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await fetchFormalBusinessOrderAttachments(7);
    await uploadFormalBusinessOrderAttachment(7, {
      file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
      category: "service_photo",
      caption: "完工照片",
    });
    expect(String(requests[0]?.input)).toBe("/api/formal/business-orders/7/attachments");
    expect(String(requests[1]?.input)).toBe("/api/formal/business-orders/7/attachments");
    expect(requests[1]?.init?.method).toBe("POST");
    expect(requests[1]?.init?.body).toBeInstanceOf(FormData);
    expect((requests[1]?.init?.body as FormData).get("category")).toBe("service_photo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
