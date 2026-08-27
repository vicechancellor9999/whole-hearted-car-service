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

test("完整经营概览抬头只出现在经营概览首页", async ({ page }) => {
  await page.goto("/");

  const overviewHeader = page.getByTestId("dashboard-header");
  await expect(overviewHeader).toHaveCount(1);
  await expect(overviewHeader.getByRole("heading", { level: 1, name: "经营概览" })).toBeVisible();
  await expect(overviewHeader.getByText("门店经营 · 实时数据", { exact: true })).toBeVisible();
  await expect(page.getByTestId("page-header")).toHaveCount(0);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByTestId("live-clock")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /切换到(深色|浅色)模式/ })).toHaveCount(1);

  await page.goto("/workbench");

  // 工作台不使用通用 PageHeader，用欢迎区
  await expect(page.getByTestId("dashboard-header")).toHaveCount(0);
  await expect(page.getByTestId("page-header")).toHaveCount(0);
  await expect(page.getByTestId("workbench-welcome")).toBeVisible();
  await expect(page.getByTestId("workbench-quick-actions")).toBeVisible();
  await expect(page.getByTestId("workbench-reminders")).toBeVisible();
  await expect(page.getByText("门店经营 · 实时数据", { exact: true })).toHaveCount(0);
  await expect(page.locator("main")).toHaveCount(1);
});

test("功能模块各自拥有唯一抬头、时钟和主题按钮", async ({ page }) => {
  const modules = [
    {
      path: "/revenue?range=day",
      title: "营业收入统计",
      descriptionPattern: /收退款记录/,
    },
    {
      path: "/performance",
      title: "绩效管理",
      descriptionPattern: /实际班组、员工和 Business Order 绩效值实时汇总/,
    },
    {
      path: "/payments",
      title: "收付款与交车",
      descriptionPattern: /应收、已收、余额/,
    },
    {
      path: "/customers",
      title: "客户档案",
      descriptionPattern: /挂账资格/,
    },
    {
      path: "/vehicles",
      title: "车辆档案",
      descriptionPattern: /照片档案.*车辆任务/,
    },
    {
      path: "/parking",
      title: "停车费",
      descriptionPattern: /停车费|账单快照/,
    },
  ];

  for (const module of modules) {
    await page.goto(module.path);

    const header = page.getByTestId("page-header");
    await expect(page.getByTestId("dashboard-header")).toHaveCount(0);
    await expect(header).toHaveCount(1);
    await expect(header.getByRole("heading", { level: 1, name: module.title, exact: true })).toBeVisible();
    await expect(header.getByTestId("page-header-description")).toContainText(module.descriptionPattern);
    await expect(header.getByTestId("page-header-description")).not.toContainText("汇总收入、应收、接车、绩效、协同与风险指标");
    await expect(header.getByTestId("live-clock")).toBeVisible();
    await expect(header.getByRole("button", { name: /切换到(深色|浅色)模式/ })).toHaveCount(1);
    await expect(page.getByTestId("live-clock")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /切换到(深色|浅色)模式/ })).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main").getByRole("heading", { name: module.title, exact: true })).toHaveCount(1);
  }
});

test("工作台欢迎区时钟走时，430px 不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/workbench");

  // 工作台欢迎区有实时时钟
  const welcome = page.getByTestId("workbench-welcome");
  await expect(welcome).toBeVisible();
  // 时间在欢迎区右侧的 text-right 容器里
  const clockText = welcome.locator(".text-right p").first();
  await expect(clockText).not.toContainText("—");
  const firstClock = await clockText.textContent();
  await expect.poll(() => clockText.textContent()).not.toBe(firstClock);

  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

});

test("模块时钟持续走时，主题跨页面和刷新保持且手机端不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/payments");

  const clock = page.getByTestId("page-header").getByTestId("live-clock");
  await expect(clock).not.toContainText("—");
  const firstClock = await clock.textContent();
  await expect.poll(() => clock.textContent()).not.toBe(firstClock);

  const ordersOverflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(ordersOverflow.html).toBeLessThanOrEqual(1);
  expect(ordersOverflow.body).toBeLessThanOrEqual(1);

  const headerBounds = await page.getByTestId("page-header").boundingBox();
  const titleBounds = await page.getByTestId("page-header")
    .getByRole("heading", { level: 1, name: "收付款与交车" })
    .boundingBox();
  const clockBounds = await clock.boundingBox();
  const toggleBounds = await page.getByTestId("page-header")
    .getByRole("button", { name: "切换到深色模式" })
    .boundingBox();
  expect(headerBounds).not.toBeNull();
  expect(titleBounds).not.toBeNull();
  expect(clockBounds).not.toBeNull();
  expect(toggleBounds).not.toBeNull();
  expect(titleBounds!.x).toBeGreaterThanOrEqual(headerBounds!.x - 1);
  expect(titleBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y - 1);
  expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(headerBounds!.x + headerBounds!.width + 1);
  expect(titleBounds!.y + titleBounds!.height).toBeLessThanOrEqual(headerBounds!.y + headerBounds!.height + 1);
  expect(clockBounds!.x).toBeGreaterThanOrEqual(headerBounds!.x - 1);
  expect(clockBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y - 1);
  expect(clockBounds!.x + clockBounds!.width).toBeLessThanOrEqual(headerBounds!.x + headerBounds!.width + 1);
  expect(clockBounds!.y + clockBounds!.height).toBeLessThanOrEqual(headerBounds!.y + headerBounds!.height + 1);
  expect(toggleBounds!.x).toBeGreaterThanOrEqual(headerBounds!.x - 1);
  expect(toggleBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y - 1);
  expect(toggleBounds!.x + toggleBounds!.width).toBeLessThanOrEqual(headerBounds!.x + headerBounds!.width + 1);
  expect(toggleBounds!.y + toggleBounds!.height).toBeLessThanOrEqual(headerBounds!.y + headerBounds!.height + 1);

  await page.getByTestId("page-header")
    .getByRole("button", { name: "切换到深色模式" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.goto("/customers");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toBeVisible();
  await expect(page.getByTestId("onboarding-footer")).toBeVisible();
  const onboardingOverflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(onboardingOverflow.html).toBeLessThanOrEqual(1);
  expect(onboardingOverflow.body).toBeLessThanOrEqual(1);
});
