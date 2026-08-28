import { expect, test } from "@playwright/test";
import { assertNoPerformanceRuntimeErrors, usePerformanceIdentity } from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("login can switch to a complete English surface before authentication", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-language-toggle").click();

  const login = page.getByRole("region", { name: "Sign in" });
  await expect(login.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(login.getByLabel("Username")).toBeVisible();
  await expect(login.getByLabel("Password")).toBeVisible();
  await expect(login.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(login).not.toContainText(/[\p{Script=Han}]/u);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("English dashboard contains no untranslated system copy", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_language_v1", "en"));
  const cards = [
    ["today_revenue", "JMD ", ""],
    ["accounts_receivable", "JMD ", ""],
    ["vehicles_today", "", "单"],
    ["vehicles_stuck", "", "单"],
    ["completed_labor", "", "单"],
    ["prepaid_incomplete", "", "单"],
    ["internal_tasks", "", "单"],
    ["risk_alerts", "", "项"],
  ].map(([id, valuePrefix, valueSuffix]) => ({
    id,
    href: "/",
    title: "后端中文标题",
    subtitle: "后端中文说明",
    value: 0,
    valuePrefix,
    valueSuffix,
    size: "small",
  }));
  await page.route("**/api/formal/dashboard", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      header: {
        breadcrumb: "门店经营",
        title: "经营概览",
        subtitle: "说明",
        dateLabel: "",
        dateTime: "",
        targetStatus: "not_configured",
        targetCompletionRate: null,
        targetCompletedAmount: 0,
        targetTotalAmount: null,
        targetMissingReasons: ["缺少 2026-08 绩效参数"],
      },
      teamPerformance: {
        title: "维修班组与绩效",
        dateRange: "2026年08月",
        hint: "说明",
        actionText: "查看绩效",
        teams: [],
      },
      periods: [],
      topCards: cards.slice(0, 4),
      bottomCards: cards.slice(4),
    }),
  }));
  await page.goto("/");

  const dashboard = page.getByTestId("dashboard-content");
  await expect(dashboard.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(dashboard).toContainText("Today's operating revenue");
  await expect(dashboard).toContainText("Repair teams and performance");
  await expect(dashboard).not.toContainText(/[\p{Script=Han}]/u);
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

test("English performance workspace contains no Chinese system copy or untranslated team label", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_language_v1", "en"));
  await page.route("**/api/formal/performance?month=*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      month: "2026-08",
      totalPerformanceMinor: 19_900_00,
      cancelledHandoffCount: 0,
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      completionRate: null,
      targetMissingReasons: ["缺少 2026-08 绩效参数"],
      teams: [{
        teamId: 1,
        teamName: "车间一组",
        handoffCount: 1,
        cancelledHandoffCount: 0,
        performanceMinor: 19_900_00,
        targetStatus: "not_configured",
        targetPerformanceMinor: null,
        completionRate: null,
        targetMissingReasons: ["缺少 2026-08 绩效参数"],
      }],
      handoffs: [{
        id: 1,
        businessOrderId: 1,
        orderNo: "KGN-WH-2026082500001",
        repairRoundNo: 1,
        teamId: 1,
        teamName: "车间一组",
        performanceMinor: 19_900_00,
        handedOffAt: "2026-08-28T13:00:00.000Z",
        plateDisplay: "4321 AB",
      }],
    }),
  }));

  await page.goto("/performance");
  const workspace = page.getByTestId("performance-page");
  await expect(workspace.getByRole("heading", { level: 1, name: "Performance" })).toBeVisible();
  await expect(workspace).toContainText("Formal handoff performance this month");
  await expect(workspace).toContainText("Team 1 · Translation required");
  await expect(workspace).not.toContainText(/[\p{Script=Han}]/u);
});
