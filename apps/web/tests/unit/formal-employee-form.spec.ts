import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("员工手机号可空且演示数据提供维修工岗位", () => {
  const employeePage = source("src/app/employees/page.tsx");
  const resetScript = source("../../scripts/reset-formal-demo-data.ts");

  expect(employeePage).toMatch(/手机号（选填）/);
  expect(employeePage).not.toMatch(/data-testid="employee-phone" required/);
  expect(resetScript).toMatch(/category:\s*"staff_position"/);
  expect(resetScript).toMatch(/labelZh:\s*"维修工"/);
});

test("员工岗位为空时提供明确的基础字典入口并能返回", () => {
  const employeePage = source("src/app/employees/page.tsx");
  expect(employeePage).toMatch(/先新增员工岗位/);
  expect(employeePage).toMatch(/returnTo=/);
});
