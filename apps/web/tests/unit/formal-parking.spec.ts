import { expect, test } from "@playwright/test";
import { fetchFormalParking } from "../../src/lib/api/formal-parking";

test("parking reads the formal vehicle-presence projection instead of Mock parking", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await fetchFormalParking();
    expect(requested).toBe("/api/formal/parking");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
