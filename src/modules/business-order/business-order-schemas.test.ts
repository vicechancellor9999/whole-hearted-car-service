import { describe, expect, it } from "vitest";
import { chargeItemSchema } from "@formal/modules/business-order/business-order-schemas";

const baseItem = {
  kind: "labor" as const,
  nameZh: "精细工时",
  unitItemId: 1,
  unitPrice: "1000",
  itemDiscount: "0",
};

describe("Business Order input schemas", () => {
  it("accepts whole quantities and normalizes redundant database decimal zeros", () => {
    expect(chargeItemSchema.parse({ ...baseItem, quantity: "2" }).quantity).toBe("2");
    expect(chargeItemSchema.parse({ ...baseItem, quantity: "2.000" }).quantity).toBe("2");
  });

  it("rejects zero and more than three decimal places", () => {
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "0" })).toThrow();
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "1.0001" })).toThrow();
  });

  it.each(["0.010", "1.250", "2.5", "-1", "1e2"])("rejects non-whole quantity %s without rounding it", (quantity) => {
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity })).toThrow(/正整数/);
  });

  it("accepts an explicitly pending price without inventing a free price", () => {
    const item = chargeItemSchema.parse({ ...baseItem, quantity: "1", unitPrice: "", pendingQuote: true });
    expect(item).toMatchObject({ pendingQuote: true, unitPrice: "" });
    expect(chargeItemSchema.parse({ ...baseItem, quantity: "1", unitPrice: "0", pendingQuote: false }))
      .toMatchObject({ pendingQuote: false, unitPrice: "0" });
    expect(chargeItemSchema.parse({ ...baseItem, quantity: "1", unitPrice: "0" }).pendingQuote).toBe(false);
  });

  it("requires a known price or an explicit pending marker and rejects conflicting amounts", () => {
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "1", unitPrice: "" })).toThrow();
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "1", pendingQuote: true })).toThrow(/待报价/);
    expect(() => chargeItemSchema.parse({ ...baseItem, quantity: "1", unitPrice: "0", itemDiscount: "1", pendingQuote: true })).toThrow(/待报价/);
  });
});
