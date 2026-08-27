import { describe, expect, it } from "vitest";
import { createMechanicSchema } from "@/modules/master-data/master-data-schemas";

const baseMechanic = {
  fullName: "宗威生",
  positionItemId: 1,
  teamId: 1,
  hiredOn: "2026-08-25",
  effectiveMonth: "2026-08",
  baseSalaryCnyMinor: 2_000_000,
  username: "1she",
  password: "Temp123!",
};

describe("createMechanicSchema", () => {
  it("accepts a blank optional phone and stores it as null", () => {
    expect(createMechanicSchema.parse({ ...baseMechanic, phone: "" }).phone).toBeNull();
  });

  it("normalizes a supplied phone", () => {
    expect(createMechanicSchema.parse({ ...baseMechanic, phone: "+1 876 555 0102" }).phone)
      .toBe("+18765550102");
  });
});
