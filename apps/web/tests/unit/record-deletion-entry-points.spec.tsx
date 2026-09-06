import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("formal detail views expose the shared delete action with the correct title", () => {
  const customer = source("src/components/customers/customer-detail-page.tsx");
  const vehicle = source("src/components/customers/vehicle-detail-page.tsx");
  const order = source("src/components/orders/formal-business-order-detail.tsx");
  const inspection = source("src/components/orders/formal-inspection-report-detail.tsx");

  expect(customer).toContain("RecordDeleteButton");
  expect(customer).toContain('title="删除客户档案"');
  expect(customer).toContain('returnTo="/customers"');
  expect(vehicle).toContain('title="删除车辆档案"');
  expect(vehicle).toContain('returnTo="/vehicles"');
  expect(order).toContain('title={english ? "Delete Business Order" : "删除业务单"}');
  expect(order).toContain('returnTo="/orders/business"');
  expect(inspection).toContain('title={english ? "Delete Inspection Report" : "删除检查结果"}');
  expect(inspection).toContain('returnTo="/orders/inspections"');
});

test("customer and vehicle delete actions stay inside formal API mode", () => {
  const customer = source("src/components/customers/customer-detail-page.tsx");
  const vehicle = source("src/components/customers/vehicle-detail-page.tsx");
  expect(customer).toContain("isFormalCustomerVehicleApiEnabled ? <RecordDeleteButton");
  expect(vehicle).toContain("isFormalCustomerVehicleApiEnabled ? <RecordDeleteButton");
});
