import { describe, expect, it, vi } from "vitest";
import { createBusinessOrdersApiHandler } from "@formal/app/api/business-orders/route";

describe("GET /api/business-orders", () => {
  it("requires a formal session", async () => {
    const handler = createBusinessOrdersApiHandler({
      readSession: async () => null,
      listBusinessOrders: vi.fn(),
      createBusinessOrder: vi.fn(),
    });
    expect((await handler(new Request("http://localhost/api/business-orders"))).status).toBe(401);
  });

  it("returns a paginated formal Business Order list", async () => {
    const listBusinessOrders = vi.fn(async () => ({
      items: [{ id: 12, orderNo: "KGN-WH-2026082400001" }],
      page: 2,
      pageSize: 20,
      pageCount: 3,
      total: 45,
    }));
    const handler = createBusinessOrdersApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listBusinessOrders,
      createBusinessOrder: vi.fn(),
    });
    const response = await handler(new Request(
      "http://localhost/api/business-orders?search=4321%20AB&status=return_pending_review&page=2&pageSize=20",
    ));
    expect(response.status).toBe(200);
    expect(listBusinessOrders).toHaveBeenCalledWith({
      viewerAccountId: 9,
      search: "4321 AB",
      status: "return_pending_review",
      page: 2,
      pageSize: 20,
    });
    expect(await response.json()).toMatchObject({ total: 45, page: 2 });
  });

  it("creates a formal Business Order from an existing vehicle", async () => {
    const createBusinessOrder = vi.fn(async () => ({ id: 22, orderNo: "KGN-WH-2026082400001" }));
    const handler = createBusinessOrdersApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listBusinessOrders: vi.fn(),
      createBusinessOrder,
    });
    const response = await handler(new Request("http://localhost/api/business-orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-create-order" },
      body: JSON.stringify({ vehicleId: 31 }),
    }));
    expect(response.status).toBe(201);
    expect(createBusinessOrder).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 31,
      context: expect.objectContaining({ actorAccountId: 9, requestId: "req-create-order" }),
    }));
  });
});
