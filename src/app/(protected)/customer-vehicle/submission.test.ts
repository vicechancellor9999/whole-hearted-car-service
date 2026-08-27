import { describe, expect, it, vi } from "vitest";
import {
  executeCustomerVehicleSubmission,
  parseCustomerVehicleSubmission,
  type CustomerVehicleSubmissionService,
} from "@/app/(protected)/customer-vehicle/submission";

describe("customer and vehicle submissions", () => {
  it("parses a personal customer without inventing a TRN", () => {
    const form = new FormData();
    form.set("operation", "create_person");
    form.set("fullName", "艾丽西亚·贝内特");
    form.set("phone", "+1 876 555 0101");
    form.set("trn", "");
    expect(parseCustomerVehicleSubmission(form)).toEqual({
      operation: "create_person",
      fullName: "艾丽西亚·贝内特",
      phone: "+1 876 555 0101",
      whatsapp: "",
      email: "",
      address: "",
      trn: "",
    });
  });

  it("parses a vehicle owner and optional model year", () => {
    const form = new FormData();
    form.set("operation", "create_vehicle");
    form.set("plate", "4321 AB");
    form.set("vin", "");
    form.set("engineNumber", "MR20DE123456");
    form.set("make", "Nissan");
    form.set("makeZh", "日产");
    form.set("model", "X-Trail");
    form.set("modelZh", "奇骏");
    form.set("modelYear", "2021");
    form.set("color", "Silver");
    form.set("bodyType", "SUV");
    form.set("fuelType", "PETROL");
    form.set("engineCc", "1997");
    form.set("seating", "5");
    form.set("usage", "个人用车");
    form.set("specialNotes", "核对备胎");
    form.set("ownerType", "company");
    form.set("ownerId", "9");
    expect(parseCustomerVehicleSubmission(form)).toMatchObject({
      operation: "create_vehicle",
      engineNumber: "MR20DE123456",
      makeZh: "日产",
      modelZh: "奇骏",
      modelYear: 2021,
      bodyType: "SUV",
      fuelType: "PETROL",
      engineCc: 1997,
      seating: 5,
      usage: "个人用车",
      specialNotes: "核对备胎",
      ownerType: "company",
      ownerId: 9,
    });
  });

  it("forwards every formal vehicle profile field to the service", async () => {
    const createVehicle = vi.fn(async () => undefined);
    const service = { createVehicle } as unknown as CustomerVehicleSubmissionService;
    const context = { actorAccountId: 2, requestId: "req-vehicle" };
    const form = new FormData();
    Object.entries({
      operation: "create_vehicle",
      plate: "4321 AB",
      vin: "JN1BJ0RR9HM123456",
      engineNumber: "MR20DE123456",
      make: "Nissan",
      makeZh: "日产",
      model: "X-Trail",
      modelZh: "奇骏",
      modelYear: "2021",
      color: "Silver",
      bodyType: "SUV",
      fuelType: "PETROL",
      engineCc: "1997",
      seating: "5",
      usage: "个人用车",
      specialNotes: "核对备胎",
      ownerRef: "person:7",
    }).forEach(([key, value]) => form.set(key, value));

    await executeCustomerVehicleSubmission(
      parseCustomerVehicleSubmission(form),
      service,
      context,
    );

    expect(createVehicle).toHaveBeenCalledWith(expect.objectContaining({
      engineNumber: "MR20DE123456",
      makeZh: "日产",
      modelZh: "奇骏",
      bodyType: "SUV",
      fuelType: "PETROL",
      engineCc: 1997,
      seating: 5,
      usage: "个人用车",
      specialNotes: "核对备胎",
      ownerType: "person",
      ownerId: 7,
      context,
    }));
  });

  it("routes a dispute operation to the service without adding a workflow", async () => {
    const calls: unknown[] = [];
    const service = {
      openVehicleDispute: async (input: unknown) => calls.push(input),
    } as unknown as CustomerVehicleSubmissionService;
    const context = { actorAccountId: 2, requestId: "req-dispute" };
    await expect(
      executeCustomerVehicleSubmission(
        { operation: "open_dispute", vehicleId: 7, note: "客户提出异响争议" },
        service,
        context,
      ),
    ).resolves.toEqual({ message: "客户争议已记录", destination: "/vehicles" });
    expect(calls).toEqual([{ vehicleId: 7, note: "客户提出异响争议", context }]);
  });
});
