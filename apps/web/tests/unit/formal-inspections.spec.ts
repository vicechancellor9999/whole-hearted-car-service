import { expect, test } from "@playwright/test";
import { fetchFormalInspectionReports } from "../../src/lib/api/formal-inspections";

test("formal inspections read the formal API rather than the Mock client", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await fetchFormalInspectionReports({ sourceBusinessOrderId: 12 });
    expect(requested).toContain("/api/formal/inspection-reports");
    expect(requested).toContain("sourceBusinessOrderId=12");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
