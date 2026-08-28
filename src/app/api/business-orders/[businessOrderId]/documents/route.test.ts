import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderDocumentsApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/documents/route";

describe("/api/business-orders/:businessOrderId/documents", () => {
  it("lists immutable print snapshots", async () => {
    const listDocuments = vi.fn(async () => ([{
      id: 31,
      documentNo: "OFF-20260824-0001",
      businessOrderId: 12,
      kind: "office_archive",
    }]));
    const handler = createBusinessOrderDocumentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listDocuments,
      generateCustomerCopy: vi.fn(),
      generateOfficeArchive: vi.fn(),
      generateMechanicWorkCopy: vi.fn(),
    });
    const response = await handler(new Request("http://local", { method: "GET" }), {
      params: Promise.resolve({ businessOrderId: "12" }),
    });
    expect(response.status).toBe(200);
    expect(listDocuments).toHaveBeenCalledWith({ businessOrderId: 12, viewerAccountId: 9 });
  });

  it("generates the selected document kind with the signed-in actor", async () => {
    const generateMechanicWorkCopy = vi.fn(async () => ({
      id: 32,
      documentNo: "MEC-20260824-0001",
      businessOrderId: 12,
      kind: "mechanic_work",
    }));
    const handler = createBusinessOrderDocumentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listDocuments: vi.fn(),
      generateCustomerCopy: vi.fn(),
      generateOfficeArchive: vi.fn(),
      generateMechanicWorkCopy,
    });
    const response = await handler(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-print" },
      body: JSON.stringify({ kind: "mechanic_work" }),
    }), { params: Promise.resolve({ businessOrderId: "12" }) });
    expect(response.status).toBe(201);
    expect(generateMechanicWorkCopy).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      context: expect.objectContaining({ actorAccountId: 9, requestId: "req-print" }),
    }));
  });

  it("generates a customer copy through the same immutable document endpoint", async () => {
    const generateCustomerCopy = vi.fn(async () => ({
      id: 33,
      documentNo: "CUS-20260824-0001",
      businessOrderId: 12,
      kind: "customer_copy",
    }));
    const handler = createBusinessOrderDocumentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listDocuments: vi.fn(),
      generateCustomerCopy,
      generateOfficeArchive: vi.fn(),
      generateMechanicWorkCopy: vi.fn(),
    });
    const response = await handler(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-customer-copy" },
      body: JSON.stringify({ kind: "customer_copy" }),
    }), { params: Promise.resolve({ businessOrderId: "12" }) });
    expect(response.status).toBe(201);
    expect(generateCustomerCopy).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 12,
      context: expect.objectContaining({ actorAccountId: 9, requestId: "req-customer-copy" }),
    }));
  });
});
