import { expect, test } from "@playwright/test";
import { recognizeFormalCustomerLicense } from "../../src/lib/customers/formal-customer-license-client";

test("formal customer license client sends exact multipart and validates safe response", async () => {
  const captured: { request?: Request } = {};
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "license.jpg", {
    type: "image/jpeg",
  });
  const controller = new AbortController();
  const result = await recognizeFormalCustomerLicense({
    file,
    transform: { rotation: 90, crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } },
    signal: controller.signal,
  }, async (input, init) => {
    captured.request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      fields: { name: "ALICIA", birthDate: "1990-06-15", sex: "F", address: "12 Ocean Road" },
      status: { name: "extracted", birthDate: "extracted", sex: "extracted", address: "extracted" },
    });
  });
  expect(captured.request?.url).toBe("http://localhost/api/formal/customer-driver-license/recognize");
  const form = await captured.request?.formData();
  expect([...form!.keys()].sort()).toEqual(["crop", "image", "rotation"]);
  expect(form?.get("rotation")).toBe("90");
  expect(JSON.parse(String(form?.get("crop")))).toEqual({ x: 0.1, y: 0.2, width: 0.8, height: 0.6 });
  expect(result.fields.name).toBe("ALICIA");
});

test("formal customer license client maps permission, provider, and cancellation errors", async () => {
  const input = {
    file: new File(["x"], "license.jpg", { type: "image/jpeg" }),
    transform: { rotation: 0 as const, crop: { x: 0, y: 0, width: 1, height: 1 } },
    signal: new AbortController().signal,
  };
  await expect(recognizeFormalCustomerLicense(input, async () =>
    Response.json({ error: "forbidden raw" }, { status: 403 })))
    .rejects.toThrow("当前账号没有客户证件写入权限");
  await expect(recognizeFormalCustomerLicense(input, async () =>
    Response.json({ error: "provider raw" }, { status: 502 })))
    .rejects.toThrow("证件识别暂时不可用，已保留当前图片和输入");

  const aborted = new AbortController();
  aborted.abort();
  await expect(recognizeFormalCustomerLicense({ ...input, signal: aborted.signal }, async () => {
    throw new DOMException("aborted", "AbortError");
  })).rejects.toMatchObject({ name: "AbortError" });
});
