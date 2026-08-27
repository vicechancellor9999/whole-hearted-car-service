import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("从 Business Order 新建检查结果时预选车辆并只保存可选来源关联", () => {
  const workspace = source("src/components/orders/inspection-reports-workspace.tsx");
  const dialog = source("src/components/orders/ir-create-dialog.tsx");
  const api = source("src/lib/api/mock-inspection-reports.ts");

  expect(workspace).toMatch(/searchParams\.get\("create"\)/);
  expect(workspace).toMatch(/sourceBusinessOrderId/);
  expect(workspace).toMatch(/initialVehiclePlate/);
  expect(dialog).toMatch(/initialVehiclePlate/);
  expect(dialog).toMatch(/sourceBusinessOrderId/);
  expect(api).toMatch(/sourceBusinessOrderId\?: string/);
  expect(api).toMatch(/sourceBusinessOrderId: input\.sourceBusinessOrderId/);
});
