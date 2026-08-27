import { describe, expect, it } from "vitest";
import { createBusinessOrderDocumentApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/documents/[documentId]/route";

describe("GET /api/business-orders/:businessOrderId/documents/:documentId", () => {
  it("returns only a document belonging to the route Business Order", async () => {
    const handler = createBusinessOrderDocumentApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getDocument: async () => ({ id: 31, businessOrderId: 12, documentNo: "OFF-20260824-0001" }),
    });
    const response = await handler({
      params: Promise.resolve({ businessOrderId: "12", documentId: "31" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ documentNo: "OFF-20260824-0001" });
  });
});
