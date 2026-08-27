import { expect, test } from "@playwright/test";
import { vehicleYearInputValue, vehicleYearLabel } from "../../src/lib/customers/vehicle-year";

test("缺失车辆年份不渲染成 0，也不会回填成可保存值", () => {
  expect(vehicleYearLabel(0)).toBeNull();
  expect(vehicleYearInputValue(0)).toBe("");
  expect(vehicleYearLabel(Number.NaN)).toBeNull();
  expect(vehicleYearInputValue(Number.NaN)).toBe("");
});

test("有效车辆年份保持原值", () => {
  expect(vehicleYearLabel(2021)).toBe("2021");
  expect(vehicleYearInputValue(2021)).toBe("2021");
});
