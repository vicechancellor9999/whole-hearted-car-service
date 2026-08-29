import { describe, expect, it, vi } from "vitest";
import { createVehicleApiHandler } from "@formal/app/api/vehicles/route";

describe("POST /api/vehicles", () => {
  it("resolves the formal customer number and creates the vehicle", async () => {
    const createVehicle = vi.fn(async () => ({ id: 3, vehicleNo: "VEH-202608-0001" }));
    const handler = createVehicleApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      resolveOwner: vi.fn(async () => ({ type: "person" as const, id: 1 })),
      createVehicle,
    });
    const response = await handler(new Request("http://local/api/vehicles", {
      method: "POST",
      body: JSON.stringify({
        plate: "4321 AB",
        vin: "1HGCM82633A004352",
        make: "Nissan",
        model: "X-Trail",
        modelYear: 2020,
        color: "White",
        ownerCustomerNo: "CUST-202608-0001",
      }),
    }));

    expect(response.status).toBe(201);
    expect(createVehicle).toHaveBeenCalledWith(expect.objectContaining({
      plate: "4321 AB",
      ownerType: "person",
      ownerId: 1,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });

  it("rejects a vehicle without a current customer", async () => {
    const handler = createVehicleApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      resolveOwner: vi.fn(async () => null),
      createVehicle: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/vehicles", {
      method: "POST",
      body: JSON.stringify({ plate: "4321 AB", make: "Nissan", model: "X-Trail" }),
    }));
    expect(response.status).toBe(400);
  });

  it("rejects invalid numeric vehicle fields instead of silently clearing them", async () => {
    const createVehicle = vi.fn();
    const handler = createVehicleApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      resolveOwner: vi.fn(async () => ({ type: "person" as const, id: 1 })),
      createVehicle,
    });
    const response = await handler(new Request("http://local/api/vehicles", {
      method: "POST",
      body: JSON.stringify({
        make: "Nissan",
        model: "X-Trail",
        ownerCustomerNo: "CUST-202608-0001",
        engineCc: "not-a-number",
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "排量 CC 必须是 1 至 30000 的整数" });
    expect(createVehicle).not.toHaveBeenCalled();
  });
});

describe("GET /api/vehicles", () => {
  it("requires a formal session before searching", async () => {
    const handler = createVehicleApiHandler({
      readSession: async () => null,
      resolveOwner: vi.fn(),
      createVehicle: vi.fn(),
      listVehicles: vi.fn(),
    });

    expect((await handler(new Request("http://local/api/vehicles?search=4321"))).status).toBe(401);
  });

  it("searches only active vehicles and limits the lightweight result", async () => {
    const listVehicles = vi.fn(async () => ({
      items: [{ id: 3, plateDisplay: "4321 AB", isActive: true }],
      page: 1,
      pageSize: 8,
      pageCount: 1,
      total: 1,
    }));
    const handler = createVehicleApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      resolveOwner: vi.fn(),
      createVehicle: vi.fn(),
      listVehicles,
    });

    const response = await handler(new Request("http://local/api/vehicles?search=4321-ab&pageSize=50"));

    expect(response.status).toBe(200);
    expect(listVehicles).toHaveBeenCalledWith({
      viewerAccountId: 9,
      search: "4321-ab",
      activeOnly: true,
      page: 1,
      pageSize: 8,
    });
    await expect(response.json()).resolves.toMatchObject({ total: 1, items: [{ id: 3 }] });
  });
});
