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

test("窄屏显示汉堡按钮，打开抽屉导航并可键盘关闭", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections");

  // 窄屏：侧边栏隐藏但汉堡可唤出
  await expect(page.getByTestId("mobile-nav-open")).toBeVisible();
  await expect(page.getByTestId("sidebar")).toBeHidden();

  await page.getByTestId("mobile-nav-open").click();
  const drawer = page.getByTestId("mobile-nav-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "经营概览" })).toBeVisible();
  await expect(drawer.getByText("工单管理")).toBeVisible();

  // Escape 关闭并把焦点还给汉堡按钮
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("mobile-nav-open")).toBeFocused();
});

test("窄屏抽屉内点链接导航后抽屉自动关闭", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/workbench");
  await page.getByTestId("mobile-nav-open").click();
  const drawer = page.getByTestId("mobile-nav-drawer");
  await drawer.getByRole("button", { name: "工单管理" }).click();
  await drawer.getByRole("link", { name: "业务单" }).click();

  await expect(page).toHaveURL(/\/orders\/business/);
  await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "业务单" })).toBeVisible();
});

test("桌面端侧边栏常显，汉堡按钮不可见", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("mobile-nav-open")).toBeHidden();
  await expect(page.getByTestId("mobile-topbar")).toBeHidden();
});
