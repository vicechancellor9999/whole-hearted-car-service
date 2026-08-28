import { expect, test } from "@playwright/test";
import { usePerformanceIdentity } from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
  await page.addInitScript(() => {
    localStorage.setItem("wh_language_v1", "zh");
    localStorage.setItem("wh_theme_mode", "light");
  });
});

test("账号区集中提供语言、主题和退出入口，页面标题不再重复显示", async ({ page }) => {
  await page.goto("/customers");

  await expect(page.getByTestId("account-settings-panel")).toHaveCount(0);
  await expect(page.getByTestId("page-header").getByTestId("language-toggle")).toHaveCount(0);
  await expect(page.getByTestId("page-header").getByRole("button", { name: /主题：/ })).toHaveCount(0);

  const trigger = page.getByTestId("account-settings-trigger");
  await expect(trigger).toContainText("超级管理员");
  await trigger.click();

  const panel = page.getByTestId("account-settings-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(panel.getByRole("heading", { name: "账号设置" })).toBeVisible();
  await expect(panel.getByRole("radiogroup", { name: "界面语言" })).toBeVisible();
  await expect(panel.getByRole("radiogroup", { name: "外观模式" })).toBeVisible();

  await panel.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_language_v1"))).toBe("en");

  await panel.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme_mode"))).toBe("dark");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("侧栏折叠后仍可从头像打开账号设置", async ({ page }) => {
  await page.goto("/customers");
  await page.getByTestId("sidebar-collapse").click();

  const trigger = page.getByTestId("account-settings-trigger");
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("account-settings-panel")).toBeVisible();
});

test("手机侧栏内的账号区可以打开设置浮窗", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers");
  await page.getByTestId("mobile-nav-open").click();

  await page.getByTestId("account-settings-trigger-drawer").click();
  const panel = page.getByTestId("account-settings-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("position", "fixed");
});
