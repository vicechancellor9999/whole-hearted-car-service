import { describe, expect, it } from "vitest";
import { createPersonalCustomerSchema } from "@formal/modules/customer-vehicle/customer-vehicle-schemas";

describe("customer vehicle schemas", () => {
  it("allows a personal customer identity to be completed later", () => {
    expect(createPersonalCustomerSchema.parse({ fullName: "No Number" })).toMatchObject({
      fullName: "No Number",
      phone: null,
      whatsapp: null,
      trn: null,
    });
  });

  it("normalizes a supplied WhatsApp number like a customer phone", () => {
    expect(createPersonalCustomerSchema.parse({
      fullName: "WhatsApp Customer",
      whatsapp: "+1 (876) 555-0199",
    }).whatsapp).toBe("+18765550199");
  });
});
