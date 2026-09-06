import { describe, expect, it } from "vitest";
import { calculateCharges } from "./business-order-calculation";
import { chargeItemSchema } from "./business-order-schemas";

describe("charge pricing status", () => {
  it("retains pending rows without adding invented amounts and distinguishes explicit free rows", () => {
    const item = { kind: "part", nameZh: "清洗剂", unitItemId: 1, quantity: "2", itemDiscount: "0" };
    const result = calculateCharges({
      laborDiscount: "0", partDiscount: "0", otherDiscount: "0", wholeOrderDiscount: "0",
      items: [
        chargeItemSchema.parse({ ...item, unitPrice: "", pendingQuote: true }),
        chargeItemSchema.parse({ ...item, unitPrice: "0", pendingQuote: false }),
        chargeItemSchema.parse({ ...item, unitPrice: "800" }),
      ],
    });
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ pendingQuote: true, unitPriceMinor: 0, subtotalMinor: 0, quantity: "2" });
    expect(result.items[1]).toMatchObject({ pendingQuote: false, unitPriceMinor: 0, subtotalMinor: 0 });
    expect(result.items[2]).toMatchObject({ pendingQuote: false, unitPriceMinor: 80000, subtotalMinor: 160000 });
    expect(result.totals).toMatchObject({ grossMinor: 160000, totalDueMinor: 160000 });
  });
});
