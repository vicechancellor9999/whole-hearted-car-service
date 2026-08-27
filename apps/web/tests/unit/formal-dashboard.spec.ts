import { expect, test } from "@playwright/test";
import { fetchFormalDashboard } from "../../src/lib/api/formal-dashboard";

test("dashboard bypasses the Mock dispatcher and reads the formal summary", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ topCards: [], bottomCards: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await fetchFormalDashboard();
    expect(requested).toBe("/api/formal/dashboard");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
