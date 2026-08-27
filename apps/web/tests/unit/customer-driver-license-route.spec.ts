import { expect, test } from "@playwright/test";
import { createCustomerDriverLicenseRecognitionHandler } from "../../src/app/api/formal/customer-driver-license/recognize/route";

function request(file?: File): Request {
  const form = new FormData();
  if (file) form.set("image", file);
  form.set("rotation", "0");
  form.set("crop", "null");
  return new Request("http://localhost/api/formal/customer-driver-license/recognize", {
    method: "POST",
    body: form,
  });
}

test("customer driver license route requires a formal writer before reading the image", async () => {
  let recognized = false;
  const unauthorized = createCustomerDriverLicenseRecognitionHandler({
    readSession: async () => null,
    recognize: async () => {
      recognized = true;
      throw new Error("must not run");
    },
  });
  expect((await unauthorized(request())).status).toBe(401);
  expect(recognized).toBe(false);

  const owner = createCustomerDriverLicenseRecognitionHandler({
    readSession: async () => ({ account: { role: "owner" } }),
    recognize: async () => {
      recognized = true;
      throw new Error("must not run");
    },
  });
  expect((await owner(request())).status).toBe(403);
  expect(recognized).toBe(false);
});

test("customer driver license route rejects unsupported images with a stable response", async () => {
  const handler = createCustomerDriverLicenseRecognitionHandler({
    readSession: async () => ({ account: { role: "front_desk" } }),
    recognize: async () => {
      throw new Error("must not run");
    },
  });
  const response = await handler(request(new File(["not-an-image"], "license.gif", { type: "image/gif" })));
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "仅支持有效的 JPEG 或 PNG 驾驶证图片" });
});

test("customer driver license route returns only safe DTO and sanitizes provider failures", async () => {
  const good = createCustomerDriverLicenseRecognitionHandler({
    readSession: async () => ({ account: { role: "super_admin" } }),
    recognize: async () => ({
      fields: { name: "ALICIA", birthDate: null, sex: "F", address: null },
      status: { name: "extracted", birthDate: "manual_required", sex: "extracted", address: "manual_required" },
    }),
  });
  const image = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "license.jpg", { type: "image/jpeg" });
  const response = await good(request(image));
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain("provider");

  const failed = createCustomerDriverLicenseRecognitionHandler({
    readSession: async () => ({ account: { role: "front_desk" } }),
    recognize: async () => {
      throw new DOMException("OpenAI sk-private raw OCR timeout payload", "TimeoutError");
    },
  });
  const failedResponse = await failed(request(image));
  expect(failedResponse.status).toBe(502);
  await expect(failedResponse.json()).resolves.toEqual({
    error: "证件识别暂时不可用，已保留当前图片和输入",
  });
});
