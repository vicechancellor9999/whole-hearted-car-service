import { expect, test, type Page } from "@playwright/test";
import {
  assertNoPerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

type RevenueReadScenario = {
  delayMs?: { revenueRead?: number };
  failNext?: { revenueRead?: string };
};

async function installRevenueScenario(page: Page, scenario: RevenueReadScenario) {
  await page.addInitScript((value) => {
    (window as typeof window & { __WH_REVENUE_TEST_SCENARIO__?: RevenueReadScenario })
      .__WH_REVENUE_TEST_SCENARIO__ = value;
  }, scenario);
}

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("营业收入使用独立经营概览路由且旧 payments 地址自动迁移", async ({ page }) => {
  await page.goto("/payments");
  await expect(page.getByRole("heading", { name: "收付款与交车" })).toBeVisible();
  await expect(page.getByTestId("revenue-page")).toHaveCount(0);

  await page.goto("/payments?view=revenue&range=day");
  await expect(page).toHaveURL(/\/revenue\?range=day$/);
  await expect(page.getByTestId("revenue-page")).toBeVisible();
  await expect(page.getByTestId("revenue-heading")).toHaveText("营业收入统计");
  await expect(page.getByTestId("page-header")).toContainText("经营分析 · 收退款实绩");
  await expect(page.getByRole("link", { name: "返回经营概览" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "经营概览", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "收付款与交车", exact: true }))
    .not.toHaveAttribute("aria-current", "page");

  const ranges = page.getByTestId("revenue-range-tabs");
  await expect(ranges.getByRole("button")).toHaveCount(5);
  await expect(ranges).toContainText("今日");
  await expect(ranges).toContainText("本周");
  await expect(ranges).toContainText("本月");
  await expect(ranges).toContainText("今年");
  await expect(ranges).toContainText("历年累计");
  await expect(page.getByTestId("revenue-range-day")).toHaveAttribute("aria-pressed", "true");
});

test("营业收入规范化缺省、非法和旧版周期地址", async ({ page }) => {
  await page.goto("/revenue");
  await expect(page).toHaveURL(/\/revenue\?range=day$/);

  await page.goto("/revenue?range=quarter");
  await expect(page).toHaveURL(/\/revenue\?range=day$/);

  await page.goto("/payments?view=revenue&range=week");
  await expect(page).toHaveURL(/\/revenue\?range=week$/);
  await expect(page.getByTestId("revenue-range-week")).toHaveAttribute("aria-pressed", "true");
});

test("今日视图保持仪表盘金额并显示工时配件构成", async ({ page }) => {
  await page.goto("/revenue?range=day");

  await expect(page.getByTestId("revenue-summary-total")).toContainText("JMD 32,500");
  await expect(page.getByTestId("revenue-summary-labor")).toContainText("JMD 32,500");
  await expect(page.getByTestId("revenue-summary-parts")).toContainText("JMD 0");
  await expect(page.getByTestId("revenue-card-payments")).toContainText("刷卡");
  await expect(page.getByTestId("revenue-card-payments")).toContainText("JMD 32,500");
  await expect(page.getByTestId("revenue-daily-average-comparison"))
    .toContainText("较上月营业日均");
  await expect(page.getByTestId("revenue-daily-average-comparison"))
    .toContainText("JMD 125,885");
  await expect(page.getByTestId("revenue-daily-average-comparison")).toContainText("低 74.2%");
  expect(await page.getByTestId("revenue-daily-average-comparison").locator("b")
    .evaluate((node) => getComputedStyle(node).color)).toBe("rgb(190, 18, 60)");

  const chart = page.getByTestId("revenue-chart");
  await expect(chart).toHaveAttribute("data-view", "composition");
  await expect(chart.getByTestId("revenue-composition-labor")).toContainText("100%");
  await expect(chart.getByTestId("revenue-composition-parts")).toContainText("0%");
  await expect(page.getByTestId("revenue-history-table")).toContainText("期间");
  await expect(page.getByTestId("revenue-history-table")).toContainText("营业收入总额");
  await expect(page.getByTestId("revenue-history-table")).toContainText("工时收入");
  await expect(page.getByTestId("revenue-history-table")).toContainText("配件收入");
  await expect(page.getByText(/逐笔流水|编辑收入|新增收款/)).toHaveCount(0);
});

test("周期按钮同步 URL、三线趋势和期间明细", async ({ page }) => {
  await page.goto("/revenue?range=day");
  await page.getByTestId("revenue-range-week").click();

  await expect(page).toHaveURL(/\/revenue\?range=week$/);
  await expect(page.getByTestId("revenue-range-week")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("revenue-chart")).toHaveAttribute("data-view", "trend");
  await expect(page.getByTestId("revenue-chart-legend")).toContainText("营业收入");
  await expect(page.getByTestId("revenue-chart-legend")).toContainText("工时收入");
  await expect(page.getByTestId("revenue-chart-legend")).toContainText("配件收入");
  await expect(page.getByTestId("revenue-daily-average-comparison")).toHaveCount(0);
  await expect(page.locator('[data-testid="revenue-chart"] .recharts-line-curve')).toHaveCount(3);
  expect(await page.getByTestId("revenue-history-row").count()).toBeGreaterThan(1);

  await page.getByTestId("revenue-range-year").click();
  await expect(page).toHaveURL(/range=year$/);
  await expect(page.getByTestId("revenue-card-payments")).toContainText("现金");
  await expect(page.getByTestId("revenue-card-payments")).toContainText("刷卡");
  await expect(page.getByTestId("revenue-card-payments")).toContainText("银行转账");
});

test("查看构成支持键盘打开和关闭", async ({ page }) => {
  await page.goto("/revenue?range=day");
  const trigger = page.getByTestId("revenue-breakdown-trigger").first();

  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("revenue-inline-detail")).toBeVisible();
  await expect(page.getByTestId("revenue-inline-detail")).toContainText("JMD 32,500");

  const close = page.getByTestId("revenue-inline-detail-close");
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("revenue-inline-detail")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("加载中分别显示汇总、图表和明细骨架", async ({ page }) => {
  await installRevenueScenario(page, { delayMs: { revenueRead: 2_000 } });
  await page.goto("/revenue?range=day");

  await expect(page.getByTestId("revenue-summary-skeleton")).toBeVisible();
  await expect(page.getByTestId("revenue-chart-skeleton")).toBeVisible();
  await expect(page.getByTestId("revenue-table-skeleton")).toBeVisible();
  await expect(page.getByTestId("revenue-heading")).toHaveText("营业收入统计");
});

test("读取失败不显示虚假金额并可重试", async ({ page }) => {
  await installRevenueScenario(page, {
    failNext: { revenueRead: "演示收入读取失败" },
  });
  await page.goto("/revenue?range=day");

  await expect(page.getByTestId("revenue-load-error")).toContainText("演示收入读取失败");
  await expect(page.getByTestId("revenue-summary-total")).toHaveCount(0);
  await page.getByTestId("revenue-retry").click();
  await expect(page.getByTestId("revenue-summary-total")).toContainText("JMD 32,500");
});

test("430px 深色模式页面和明细表都不出现横向滚动条", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.addInitScript(() => localStorage.setItem("wh_theme", "dark"));
  await page.goto("/revenue?range=week");

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("revenue-page")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  const tableScroll = page.getByTestId("revenue-table-scroll");
  await expect(tableScroll).toBeVisible();
  expect(await tableScroll.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
    await tableScroll.evaluate((node) => node.clientWidth),
  );
});
