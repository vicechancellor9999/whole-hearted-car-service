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

test("车辆档案显示实时统计并可直接筛选当前车辆", async ({ page }) => {
  await page.goto("/vehicles");
  await expect(page.getByTestId("vehicle-summary-cards")).toBeVisible();
  for (const id of ["all", "on_site", "off_site", "incomplete", "open_tasks", "unbound"]) {
    await expect(page.getByTestId(`vehicle-summary-${id}`)).toBeVisible();
  }

  const allCount = Number((await page.getByTestId("vehicle-summary-all").locator("p").first().innerText()).replace(/,/g, ""));
  const onSiteCount = Number((await page.getByTestId("vehicle-summary-on_site").locator("p").first().innerText()).replace(/,/g, ""));
  const offSiteCount = Number((await page.getByTestId("vehicle-summary-off_site").locator("p").first().innerText()).replace(/,/g, ""));
  expect(allCount).toBeGreaterThan(0);
  expect(onSiteCount + offSiteCount).toBe(allCount);

  await page.getByTestId("vehicle-summary-on_site").click();
  await expect(page.getByTestId("vehicle-summary-on_site")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="vehicle-status-off_site-"]:visible')).toHaveCount(0);

  await page.setViewportSize({ width: 430, height: 932 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
});
