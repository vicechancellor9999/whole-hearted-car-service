import { expect, test } from "@playwright/test";
import { assertNoPerformanceRuntimeErrors, usePerformanceIdentity } from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("wh_performance_clean_seeded") === "1") return;
    localStorage.removeItem("wh_teams_v2");
    localStorage.removeItem("wh_employees_v1");
    sessionStorage.setItem("wh_performance_clean_seeded", "1");
  });
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("没有实际班组时绩效页为空并提供新增入口", async ({ page }) => {
  await page.goto("/performance");
  await expect(page.getByTestId("performance-empty")).toBeVisible();
  await expect(page.getByTestId("performance-add-team")).toBeVisible();
  await expect(page.getByTestId("performance-add-employee")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/车间一组|王林|历史平均|5,152,000/);
});

test("超级管理员新增班组和员工后绩效页只显示实际资料与 BO 汇总", async ({ page }) => {
  await page.goto("/dictionaries#teams");
  await page.getByTestId("settings-team-add-input").fill("实际维修一组");
  await page.getByTestId("settings-team-add").click();

  await page.goto("/employees");
  await page.getByTestId("employee-add-open").click();
  await page.getByTestId("employee-name").fill("实际员工甲");
  await page.getByTestId("employee-name-en").fill("Actual Mechanic A");
  await page.getByTestId("employee-role").selectOption("mechanic");
  await page.getByTestId("employee-team").selectOption({ label: "实际维修一组" });
  await page.getByTestId("employee-save").click();

  await page.goto("/performance");
  await expect(page.getByTestId("performance-team-name")).toHaveText("实际维修一组");
  await expect(page.getByTestId("performance-member-count")).toHaveText("1 人");
  await expect(page.getByTestId("performance-member-list")).toContainText("实际员工甲");
  await expect(page.getByTestId("performance-counted-value")).toHaveText("JMD 0");
  await expect(page.getByTestId("performance-pending-value")).toHaveText("JMD 0");
});

test("430px 绩效页没有页面级横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/performance");
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
});
