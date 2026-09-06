import { describe, expect, it } from "vitest";
import {
  classifyBusinessOrderText,
  withReworkCategory,
} from "@formal/modules/business-order/business-order-category";

describe("classifyBusinessOrderText", () => {
  it("supports multiple service categories from one natural description", () => {
    expect(classifyBusinessOrderText("检查发动机异响，做机油保养并更换漏水的水泵"))
      .toEqual(["maintenance", "repair", "inspection"]);
  });

  it("does not invent a category for an empty description", () => {
    expect(classifyBusinessOrderText("  ")).toEqual([]);
  });

  it("does not classify a negated repair request", () => {
    expect(classifyBusinessOrderText("客户说不要更换水泵，只做清洁")).toEqual([]);
  });

  it("uses English word boundaries instead of matching arbitrary substrings", () => {
    expect(classifyBusinessOrderText("contest entry only")).toEqual([]);
  });

  it("adds rework from the second repair round onward", () => {
    expect(withReworkCategory(["repair"], 1)).toEqual(["repair"]);
    expect(withReworkCategory(["repair"], 2)).toEqual(["repair", "rework"]);
  });
});
