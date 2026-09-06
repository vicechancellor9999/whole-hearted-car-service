import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/components/orders/formal-business-order-detail.tsx"),
  "utf8",
);

const tabsSource = readFileSync(
  resolve(process.cwd(), "src/components/orders/formal-business-order-tabs.tsx"),
  "utf8",
);

const problemSource = readFileSync(
  resolve(process.cwd(), "src/components/orders/formal-business-order-problem-description.tsx"),
  "utf8",
);

test("detail keeps the compact workspace order requested by the front desk", () => {
  const header = source.indexOf("<header");
  const tabs = source.indexOf("<FormalBusinessOrderTabs");
  const operations = source.indexOf('id="business-order-operations-workspace"');
  const problem = source.indexOf("<FormalBusinessOrderProblemDescription", operations);
  const charges = source.indexOf('english ? "Charges" : "收费项目"', operations);

  expect(header).toBeGreaterThan(-1);
  expect(tabs).toBeGreaterThan(header);
  expect(operations).toBeGreaterThan(tabs);
  expect(problem).toBeGreaterThan(operations);
  expect(charges).toBeGreaterThan(problem);
  expect(source.slice(header, tabs)).not.toContain("<FormalBusinessOrderProblemDescription");
});

test("first workspace is named Business Order details", () => {
  expect(tabsSource).toContain('labelZh: "业务单明细"');
  expect(tabsSource).toContain('labelEn: "Business Order details"');
  expect(tabsSource).not.toContain('labelZh: "收费 · 收款 · 维修班组"');
});

test("empty problem description collapses to the edit action", () => {
  expect(problemSource).toContain('data-testid="business-order-problem-empty"');
  expect(problemSource).not.toContain("创建业务单时未填写问题描述。");
  expect(problemSource).not.toContain("说明为何建单，以及当前要处理的问题和范围。");
});

test("charge display delegates to the responsive labelled charge component", () => {
  expect(source).toContain("const ChargeSection = BusinessChargeSection");
  const chargeSource = readFileSync(resolve(process.cwd(), "src/components/orders/business-charge-section.tsx"), "utf8");
  expect(chargeSource).toContain("formal-charge-row");
  expect(chargeSource).toContain("<dt>");
});

test("paper return, payment and refund choices do not use native dropdowns", () => {
  expect(source).toContain("ChoiceCards");
  expect(source).toContain('name="actualStaffMemberId"');
  expect(source).toContain('name="paymentMethodItemId"');
  expect(source).toContain('name="originalDocumentStatus"');
  expect(source).not.toContain('<select name="actualStaffMemberId"');
  expect(source).not.toContain('<select name="paymentMethodItemId"');
  expect(source).not.toContain('<select name="originalDocumentStatus"');
});

test("paper return mechanic and source file are explicitly optional", () => {
  expect(source).toContain("实际维修工（可选）");
  expect(source).toContain("纸质回单照片 / PDF（可选）");
});
