import { expect, test } from "@playwright/test";
import { assertNoPerformanceRuntimeErrors, usePerformanceIdentity } from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("全局语言切换：导航与页面抬头中英切换并持久化（#17）", async ({ page }) => {
  await page.route("**/api/formal/me/mentions", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], unreadCount: 0 }),
  }));
  await page.addInitScript(() => {
    const raw = localStorage.getItem("wh_session");
    if (!raw) return;
    const session = JSON.parse(raw) as Record<string, unknown>;
    session.formal = {
      accountId: 1,
      role: "super_admin",
      delegatedPermissions: [],
    };
    localStorage.setItem("wh_session", JSON.stringify(session));
  });
  await page.goto("/customers");
  await page.getByTestId("account-settings-trigger").click();
  await expect(page.getByTestId("account-language-options")).toBeVisible();
  // 默认中文
  await expect(page.getByRole("heading", { level: 1, name: "客户档案" })).toBeVisible();
  await expect(page.getByTestId("sidebar")).toContainText("工单管理");

  // 切到 English
  await page.getByTestId("account-language-options").getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect(page.getByTestId("sidebar")).toContainText("Order Management");
  await expect(page.getByTestId("sidebar")).toContainText("Payments & Release");
  await expect(page.getByTestId("sidebar")).toContainText("Parking Fees");

  // 刷新后保持 English
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();

  // 切回中文
  await page.getByTestId("account-settings-trigger").click();
  await page.getByTestId("account-language-options").getByRole("radio", { name: "中文" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "客户档案" })).toBeVisible();
  await expect(page.getByTestId("sidebar")).toContainText("收付款与交车");
});
