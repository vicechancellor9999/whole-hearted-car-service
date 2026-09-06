// @vitest-environment node
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";

it("serves the PDF rendering library without redirecting it to login", () => {
  const response = proxy(new NextRequest("http://localhost/pdf.worker.min.mjs"));
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it.each(["/orders/business/1", "/api/formal/business-orders/1/documents/2/revisions/23/file", "/pdf.worker.min.mjs/private"])("still requires login for %s", (path) => {
  const response = proxy(new NextRequest(`http://localhost${path}`));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://localhost/login");
});
