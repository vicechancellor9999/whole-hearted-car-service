import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchFormalPaymentWorkspace } from "../../src/lib/api/formal-payments";

test("payments bypasses the QuickOrder Mock dispatcher and reads the formal finance workspace", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await fetchFormalPaymentWorkspace();
    expect(requested).toBe("/api/formal/payments");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payments workspace does not source its ledger from QuickOrder Mock APIs", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/payments/payments-workspace.tsx"), "utf8");

  expect(source).toContain("fetchFormalPaymentWorkspace");
  expect(source).toContain("FORMAL_DATA_CHANGED_EVENT");
  expect(source).not.toContain("api.quickOrders");
  expect(source).not.toContain("api.quickOrderFinancials");
});
