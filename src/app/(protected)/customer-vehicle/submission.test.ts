import { describe, expect, it } from "vitest";
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
    form.set("make", "Nissan");
    form.set("model", "X-Trail");
    form.set("modelYear", "2021");
    form.set("color", "Silver");
    form.set("ownerType", "company");
    form.set("ownerId", "9");
    expect(parseCustomerVehicleSubmission(form)).toMatchObject({
      operation: "create_vehicle",
      modelYear: 2021,
      ownerType: "company",
      ownerId: 9,
    });
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
