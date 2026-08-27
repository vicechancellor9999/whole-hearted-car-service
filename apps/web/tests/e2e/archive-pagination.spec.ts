import { expect, test } from "@playwright/test";
import {
  assertNoPerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("客户档案单屏分页，翻页与搜索后页码正确重置", async ({ page }) => {
  await page.goto("/customers");
  await expect(page.locator('[data-testid^="customer-row-"]')).toHaveCount(8);
  await expect(page.getByTestId("customer-pagination")).toContainText("显示 1–8 条，共 300 条");
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight)).toBe(true);
  await page.getByTestId("customer-page-next").click();
  await expect(page.getByTestId("customer-page-2")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("customer-pagination")).toContainText("显示 9–16 条");
  await page.getByTestId("search-input-customers").fill("alicia.bennett@synthetic.example");
  await expect(page.getByTestId("customer-page-1")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toBeVisible();
  await expect(page.getByTestId("customer-pagination")).toContainText("共 1 条");
});

test("车辆档案单屏分页，翻页并利用中间信息列", async ({ page }) => {
  await page.goto("/vehicles");
  await expect(page.locator('[data-testid^="vehicle-row-"]')).toHaveCount(8);
  await expect(page.getByTestId("vehicle-pagination")).toContainText("显示 1–8 条，共 324 条");
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight)).toBe(true);
  const firstRow = page.getByTestId("vehicle-row-VEH-UAT-001");
  await expect(firstRow.getByTestId("vehicle-mileage-VEH-UAT-001")).toBeVisible();
  await expect(firstRow).toContainText(/照片|附件/);
  await expect(firstRow).toContainText(/待办/);
  await page.getByTestId("vehicle-page-next").click();
  await expect(page.getByTestId("vehicle-page-2")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("vehicle-pagination")).toContainText("显示 9–16 条");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("高屏客户与车辆档案增加每页行数但保持紧凑行高", async ({ page }) => {
  await page.setViewportSize({ width: 1932, height: 1354 });

  await page.goto("/customers");
  const customerRows = page.locator('[data-testid^="customer-row-"]');
  await expect(customerRows).toHaveCount(16);
  expect(await customerRows.first().evaluate((row) => row.getBoundingClientRect().height)).toBeLessThanOrEqual(60);
  await expect(page.getByTestId("customer-pagination")).toContainText("显示 1–16 条");

  await page.goto("/vehicles");
  const vehicleRows = page.locator('[data-testid^="vehicle-row-"]');
  await expect(vehicleRows).toHaveCount(16);
  expect(await vehicleRows.first().evaluate((row) => row.getBoundingClientRect().height)).toBeLessThanOrEqual(60);
  const lastVehicleBottom = await vehicleRows.last().evaluate((row) => row.getBoundingClientRect().bottom);
  const paginationTop = await page.getByTestId("vehicle-pagination").evaluate((node) => node.getBoundingClientRect().top);
  expect(lastVehicleBottom).toBeLessThanOrEqual(paginationTop);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );
});
