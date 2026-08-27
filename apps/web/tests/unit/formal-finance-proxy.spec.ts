import { expect, test } from "@playwright/test";
import { forwardFormalBackend } from "../../src/lib/api/formal-backend-proxy";

test("正式财务代理保留会话并把 JSON 请求转给 3211", async () => {
  const captured: { value: { url: string; init: RequestInit } | null } = { value: null };
  const response = await forwardFormalBackend(
    new Request("http://127.0.0.1:3210/api/formal/business-orders/12/payments", {
      method: "POST",
      headers: {
        cookie: "wh_session=session-token",
        "content-type": "application/json",
        "x-request-id": "req-1",
      },
      body: JSON.stringify({ amount: "3000", paymentMethodItemId: 2 }),
    }),
    "/api/business-orders/12/payments",
    "json",
    async (input, init) => {
      captured.value = { url: String(input), init: init ?? {} };
      return new Response(JSON.stringify({ receipt: { receiptNo: "RCT-20260824-0001" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  );

  expect(response.status).toBe(201);
  expect(captured.value?.url).toBe("http://127.0.0.1:3211/api/business-orders/12/payments");
  expect(new Headers(captured.value?.init.headers).get("cookie")).toBe("wh_session=session-token");
  expect(new Headers(captured.value?.init.headers).get("x-request-id")).toBe("req-1");
  expect(captured.value?.init.body).toBe(JSON.stringify({ amount: "3000", paymentMethodItemId: 2 }));
});

test("正式财务代理在退款生成后转发实际凭证表单", async () => {
  const forwardedBody: { value: FormData | null } = { value: null };
  const formData = new FormData();
  formData.set("proof", new File(["proof"], "proof.pdf", { type: "application/pdf" }));
  const response = await forwardFormalBackend(
    new Request("http://127.0.0.1:3210/api/formal/business-orders/12/refunds/5/proof", {
      method: "POST",
      body: formData,
    }),
    "/api/business-orders/12/refunds/5/proof",
    "form",
    async (_input, init) => {
      forwardedBody.value = init?.body as FormData;
      return new Response(JSON.stringify({ refundNo: "RFD-20260824-0001" }), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  expect(response.status).toBe(200);
  expect(forwardedBody.value?.get("proof")).toBeInstanceOf(File);
});

test("正式 Business Order 列表代理保留查询条件", async () => {
  const captured: { value: string | null } = { value: null };
  const response = await forwardFormalBackend(
    new Request("http://127.0.0.1:3210/api/formal/business-orders?search=4321%20AB&page=2"),
    "/api/business-orders?search=4321%20AB&page=2",
    "none",
    async (input) => {
      captured.value = String(input);
      return Response.json({ items: [], page: 2, total: 0 });
    },
  );

  expect(response.status).toBe(200);
  expect(captured.value).toBe("http://127.0.0.1:3211/api/business-orders?search=4321%20AB&page=2");
});
