import { expect, test } from "@playwright/test";
import {
  normalizeFormalPlate,
  selectFormalVehicleByPlate,
} from "@/lib/customers/formal-customer-vehicle-adapter";

test.describe("formal Business Order vehicle lookup", () => {
  const vehicles = [{
    id: 7,
    vehicleNo: "VEH-202608-0007",
    plateDisplay: "4321 AB",
    normalizedPlate: "4321AB",
    vin: null,
    engineNumber: null,
    make: "Nissan",
    makeZh: "日产",
    model: "X-Trail",
    modelZh: "奇骏",
    modelYear: 2022,
    color: "White",
    bodyType: "SUV",
    fuelType: "汽油",
    engineCc: 1997,
    seating: 5,
    usage: null,
    specialNotes: null,
    currentOwner: { type: "person" as const, id: 1 },
    hasOpenDispute: false,
    openDisputeId: null,
    isActive: true,
    version: 1,
  }];

  test("normalizes spaces and punctuation before matching the unique plate", () => {
    expect(normalizeFormalPlate(" 4321-ab ")).toBe("4321AB");
    expect(selectFormalVehicleByPlate(vehicles, "4321-ab")?.id).toBe(7);
  });

  test("returns no vehicle when the plate has no formal record", () => {
    expect(selectFormalVehicleByPlate(vehicles, "9999 ZZ")).toBeNull();
  });
});
