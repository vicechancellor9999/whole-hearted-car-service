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

test("navigation hides unfinished modules and the central dictionary creates real teams", async ({ page }) => {
  await page.goto("/");
  for (const href of [
    "/quotes",
    "/procurement/local",
    "/procurement/international",
    "/notifications",
    "/company/employees",
    "/company/accounting",
    "/company/training",
  ]) {
    await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);
  }

  await page.goto("/dictionaries#teams");
  await page.evaluate(() => {
    localStorage.removeItem("wh_teams_v2");
    localStorage.removeItem("wh_employees_v1");
  });
  await page.reload();
  await page.getByTestId("settings-team-add-input").fill("验收维修组");
  await page.getByTestId("settings-team-add").click();
  await expect(page.getByTestId("settings-team-name-t1")).toHaveValue("验收维修组");
  await page.getByTestId("settings-team-name-t1").fill("验收维修一组");
  await page.getByTestId("settings-team-rename-t1").click();
  await expect(page.getByTestId("settings-team-name-t1")).toHaveValue("验收维修一组");
});

test("retired operations entry redirects to the editable Business Order workspace", async ({ page }) => {
  await page.goto("/orders/operations");
  await expect(page).toHaveURL(/\/orders\/business$/);
  await expect(page.getByRole("heading", { level: 1, name: "业务单" })).toBeVisible();
  await expect(page.getByTestId("business-order-row")).toHaveCount(5); // clean v2 demo
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(0);

  await page.goto("/orders/inspections");
  await expect(page.getByRole("heading", { level: 1, name: "检查结果" })).toBeVisible();
  await expect(page.getByTestId("inspection-report-row").first()).toBeVisible(); // 180 条 IR（300 单的 60%）
  await expect(page.getByTestId("business-order-row")).toHaveCount(0);
});

test("retired operations page does not expose fixed demo teams or workload", async ({ page }) => {
  await page.goto("/orders/operations");
  await expect(page).toHaveURL(/\/orders\/business$/);
  await expect(page.getByText(/车间一组|车间二组|钣金喷漆|工程机械/)).toHaveCount(0);
  await expect(page.getByTestId("team-workload-panel")).toHaveCount(0);
});
