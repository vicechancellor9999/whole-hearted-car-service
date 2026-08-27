import { describe, expect, it, vi } from "vitest";
import { createVehicleDetailApiHandler } from "@/app/api/vehicles/[vehicleNo]/route";

const vehicle = {
  id: 21,
  vehicleNo: "VEH-202608-0001",
  plateDisplay: "4321 AB",
  normalizedPlate: "4321AB",
  vin: "1HGCM82633A004352",
  engineNumber: null,
  make: "Nissan",
  makeZh: "日产",
  model: "X-Trail",
  modelZh: "奇骏",
  modelYear: 2020,
  color: "White",
  bodyType: "SUV",
  fuelType: "汽油",
  engineCc: 1997,
  seating: 5,
  usage: null,
  specialNotes: null,
  currentOwner: { type: "person" as const, id: 11 },
  hasOpenDispute: false,
  openDisputeId: null,
  isActive: true,
  version: 4,
};

describe("/api/vehicles/[vehicleNo]", () => {
  it("reads one formal vehicle by vehicle number", async () => {
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle: vi.fn(),
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001"),
      { vehicleNo: "VEH-202608-0001" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ record: vehicle });
  });

  it("updates vehicle profile fields with optimistic version and audit context", async () => {
    const updateVehicle = vi.fn(async () => ({ ...vehicle, color: "Black", version: 5 }));
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle,
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({
          plate: "4321 AB",
          vin: "1HGCM82633A004352",
          make: "Nissan",
          model: "X-Trail",
          modelYear: 2020,
          color: "Black",
          isActive: true,
          version: 4,
        }),
      }),
      { vehicleNo: "VEH-202608-0001" },
    );
    expect(response.status).toBe(200);
    expect(updateVehicle).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 21,
      color: "Black",
      makeZh: "日产",
      modelZh: "奇骏",
      modelYear: 2020,
      bodyType: "SUV",
      fuelType: "汽油",
      engineCc: 1997,
      seating: 5,
      version: 4,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });

  it("changes the current customer through the audited owner-history service", async () => {
    const updateVehicle = vi.fn();
    const updateVehicleWithOwner = vi.fn(async () => ({
      ...vehicle,
      currentOwner: { type: "company" as const, id: 22 },
      version: 6,
    }));
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle,
      updateVehicleWithOwner,
      resolveOwner: vi.fn(async () => ({ type: "company" as const, id: 22 })),
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({
          make: "Nissan",
          model: "X-Trail",
          ownerCustomerNo: "COMP-202608-0001",
          ownerChangeReason: "修改车辆当前客户",
          isActive: true,
          version: 4,
        }),
      }),
      { vehicleNo: "VEH-202608-0001" },
    );
    expect(response.status).toBe(200);
    expect(updateVehicle).not.toHaveBeenCalled();
    expect(updateVehicleWithOwner).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 21,
      ownerType: "company",
      ownerId: 22,
      reason: "修改车辆当前客户",
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });

  it("rejects an unknown current customer before changing any vehicle fields", async () => {
    const updateVehicle = vi.fn();
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle,
      resolveOwner: vi.fn(async () => null),
      updateVehicleWithOwner: vi.fn(),
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({
          make: "Nissan",
          model: "X-Trail",
          ownerCustomerNo: "CUST-UNKNOWN",
          isActive: true,
          version: 4,
        }),
      }),
      { vehicleNo: "VEH-202608-0001" },
    );
    expect(response.status).toBe(400);
    expect(updateVehicle).not.toHaveBeenCalled();
  });

  it("rejects invalid numeric vehicle fields instead of silently clearing them", async () => {
    const updateVehicle = vi.fn();
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle,
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({
          make: "Nissan",
          model: "X-Trail",
          seating: 5.5,
          isActive: true,
          version: 4,
        }),
      }),
      { vehicleNo: "VEH-202608-0001" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "座位数必须是 1 至 200 的整数" });
    expect(updateVehicle).not.toHaveBeenCalled();
  });

  it("rejects non-text optional fields instead of treating them as a clear request", async () => {
    const updateVehicle = vi.fn();
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle,
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({ color: 123, isActive: true, version: 4 }),
      }),
      { vehicleNo: "VEH-202608-0001" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "可选文本字段必须是字符串或 null" });
    expect(updateVehicle).not.toHaveBeenCalled();
  });

  it("rejects a non-text current customer number before writing vehicle fields", async () => {
    const updateVehicle = vi.fn();
    const handler = createVehicleDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findVehicle: vi.fn(async () => vehicle),
      updateVehicle,
      resolveOwner: vi.fn(),
      updateVehicleWithOwner: vi.fn(),
    });
    const response = await handler(
      new Request("http://local/api/vehicles/VEH-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({ ownerCustomerNo: 22, isActive: true, version: 4 }),
      }),
      { vehicleNo: "VEH-202608-0001" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "可选文本字段必须是字符串或 null" });
    expect(updateVehicle).not.toHaveBeenCalled();
  });
});
