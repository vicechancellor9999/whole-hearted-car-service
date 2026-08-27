import { expect, test } from "@playwright/test";
import {
  formalVehicleIsActive,
  parseFormalOptionalInteger,
} from "../../src/lib/customers/formal-vehicle-write";

test("正式车辆数字字段只接受范围内整数", () => {
  expect(parseFormalOptionalInteger(null, "排量 CC", 1, 30_000)).toBeNull();
  expect(parseFormalOptionalInteger("", "排量 CC", 1, 30_000)).toBeNull();
  expect(parseFormalOptionalInteger(" 1997 ", "排量 CC", 1, 30_000)).toBe(1997);
  expect(parseFormalOptionalInteger("5", "座位数", 1, 200)).toBe(5);
  expect(() => parseFormalOptionalInteger("5.5", "座位数", 1, 200)).toThrow("座位数必须是 1 至 200 的整数");
  expect(() => parseFormalOptionalInteger("abc", "排量 CC", 1, 30_000)).toThrow("排量 CC 必须是 1 至 30000 的整数");
  expect(() => parseFormalOptionalInteger("0", "排量 CC", 1, 30_000)).toThrow("排量 CC 必须是 1 至 30000 的整数");
});

test("正式车辆编辑保留后端停用状态", () => {
  expect(formalVehicleIsActive(false)).toBe(false);
  expect(formalVehicleIsActive(true)).toBe(true);
  expect(() => formalVehicleIsActive(undefined)).toThrow("正式车辆启用状态缺失，请刷新后重试");
});
