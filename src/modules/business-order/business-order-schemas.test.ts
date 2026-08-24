import { describe, expect, it } from "vitest";
import { chargeItemSchema } from "@/modules/business-order/business-order-schemas";

const baseItem = {
  kind: "labor" as const,
  nameZh: "精细工时",
  unitItemId: 1,
  unitPrice: "1000",
  itemDiscount: "0",
};

describe("Business Order input schemas", () => {
  it("accepts a positive quantity with up to three decimal places", () => {
    expect(chargeItemSchema.parse({ ...baseItem, quantity: "0.010" }).quantity)
      .toBe("0.010");
    expect(chargeItemSchema.parse({ ...baseItem, quantity: "1.250" }).quantity)
      .toBe("1.250");
  });

  it("rejects zero and more than three decimal places", () => {
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "0" })).toThrow();
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "1.0001" })).toThrow();
  });
});
