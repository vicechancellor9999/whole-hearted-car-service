import { expect, test } from "@playwright/test";
import { localOriginRedirects } from "../../src/lib/http/canonical-local-origin";

test("local runtime aliases redirect to one cookie origin before route handling", () => {
  expect(localOriginRedirects()).toEqual([
    {
      source: "/:path*",
      has: [{ type: "header", key: "host", value: "localhost:3220" }],
      destination: "http://127.0.0.1:3220/:path*",
      permanent: false,
    },
    {
      source: "/:path*",
      has: [{ type: "header", key: "host", value: "localhost:3210" }],
      destination: "http://127.0.0.1:3210/:path*",
      permanent: false,
    },
  ]);
});
