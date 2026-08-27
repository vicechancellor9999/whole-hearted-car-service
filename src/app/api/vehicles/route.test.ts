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
