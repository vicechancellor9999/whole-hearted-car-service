import { expect, test } from "@playwright/test";
import { assertNoPerformanceRuntimeErrors, usePerformanceIdentity } from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("Payments 使用正式财务汇总显示独立收款与退款后的金额", async ({ page }) => {
  test.setTimeout(40_000);
  await page.goto("/payments");
  await expect(page.getByRole("button", { name: /超级管理员/ })).toBeVisible();

  const partial = page.getByTestId("payment-row-demo-v2-partial");
  await expect(partial).toBeVisible({ timeout: 20_000 });
  await expect(partial).toContainText("JMD 17,500");
  await expect(partial).toContainText("JMD 7,500", { timeout: 20_000 });
  await expect(partial).toContainText("JMD 10,000");
  await expect(partial).toContainText("未付清");

  const refunded = page.getByTestId("payment-row-demo-v2-refunds");
  await expect(refunded).toBeVisible();
  await expect(refunded).toContainText("JMD 21,000");
  await expect(refunded).toContainText("JMD 16,000");
  await expect(refunded).toContainText("JMD 5,000");
  await expect(refunded).toContainText("未付清");

  const ledgerRows = page.locator('[data-testid^="payments-ledger-row-"]');
  await expect(ledgerRows).toHaveCount(8);
  await expect(page.getByTestId("payments-ledger")).toContainText("独立收款记录");
  await expect(ledgerRows.filter({ hasText: /KGN-WH-2026072000003.*独立收款 JMD 8,000/ })).toHaveCount(1);
  await expect(ledgerRows.filter({ hasText: /KGN-WH-2026072000003.*独立收款 JMD 13,000/ })).toHaveCount(1);
  await expect(ledgerRows.filter({ hasText: /KGN-WH-2026072000003.*实际退还现金 JMD 5,000/ })).toHaveCount(1);
  await expect(page.getByTestId("payments-ledger")).not.toContainText("应收冲减 JMD 0");
  await expect(page.getByTestId("payments-ledger")).toContainText("停车费更正退款");
  await expect(page.getByTestId("payments-ledger")).toContainText("实际退还现金 JMD 2,500");
});

test("收付款工作区汇总新 BO 应收/已收/余额，支持搜索与付款状态筛选", async ({ page }) => {
  await page.goto("/payments");
  await expect(page.getByRole("heading", { level: 1, name: "收付款台账" })).toBeVisible();
  await expect(page.getByTestId("payments-summary-receivable")).toBeVisible();
  await expect(page.getByTestId("payments-summary-paid")).toBeVisible();
  await expect(page.getByTestId("payments-summary-balance")).toBeVisible();
  await expect(page.getByTestId("payments-summary-debt-customers")).toBeVisible();

  const rows = page.locator('[data-testid^="payment-row-"]');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  await expect(rows).toHaveCount(5);

  // 付款状态筛选
  await page.getByLabel("付款状态").selectOption("partially_paid");
  await expect(page.getByTestId("payments-count")).toContainText("张业务单");
  await expect(page.locator('[data-testid^="payment-row-"]').first()).toContainText("未付清");
  const filteredCount = await page.locator('[data-testid^="payment-row-"]').count();
  expect(filteredCount).toBeLessThan(5);
  await page.getByLabel("付款状态").selectOption("");

  // 搜索车牌
  await page.getByTestId("payments-search").fill("7012 AB");
  await expect(page.getByTestId("payment-row-demo-v2-partial")).toBeVisible();
  await expect(page.locator('[data-testid^="payment-row-"]')).toHaveCount(5);
  await page.getByRole("button", { name: "清除筛选" }).first().click();
  await expect(page.locator('[data-testid^="payment-row-"]')).toHaveCount(5);
});

test("BO 内直接办理收退款，台账只从全局进入对应 BO，不形成往返跳转", async ({ page }) => {
  await page.goto("/orders/business/demo-v2-parking-unclaimed");
  await expect(page.getByTestId("quick-completion-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("quick-completion-payments")).toHaveCount(0);
  await expect(page.getByTestId("quick-completion-pay")).toBeVisible();
  await expect(page.getByTestId("quick-completion-refund")).toBeVisible();
  await expect(page.getByTestId("quick-completion-pickup")).toBeVisible();

  await page.getByTestId("quick-completion-pay").click();
  await expect(page.getByRole("dialog", { name: "收款" })).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/business\/demo-v2-parking-unclaimed$/);
  await page.getByRole("dialog", { name: "收款" }).getByRole("button", { name: "取消" }).click();

  await page.getByTestId("quick-completion-pickup").click();
  await expect(page.getByTestId("quick-detail-notice")).toContainText("实际取车");
  await expect(page.getByTestId("quick-completion-card")).not.toContainText("尚未确认实际取车");

  await page.goto("/payments");
  const row = page.getByTestId("payment-row-demo-v2-parking-unclaimed");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "收款" }).click();
  await expect(page).toHaveURL(/\/orders\/business\/demo-v2-parking-unclaimed$/);
  await expect(page.getByRole("dialog", { name: "收款" })).toBeVisible();
});

test("新 BO 可直接收款并先记录现金退款再打印纸质签收单", async ({ page }) => {
  test.setTimeout(50_000);
  await page.goto("/orders/business/demo-v2-provisional");
  await expect(page.getByTestId("quick-action-pay-open")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("quick-shared-charge-editor")).toBeVisible();
  await expect(page.getByTestId("quick-fin-source")).not.toContainText("旧版");

  await page.getByTestId("quick-action-pay-open").click();
  await page.getByTestId("quick-money-amount").fill("3000");
  await page.getByTestId("quick-money-note").fill("新 BO 第一笔收款");
  await page.getByTestId("quick-money-confirm").click();
  await expect(page.getByTestId("quick-detail-notice")).toContainText("独立收款");
  await expect(page.getByTestId("quick-fin-paid")).toContainText("3,000");
  await expect(page.getByTestId("quick-fin-balance")).toContainText("24,500");

  await page.getByTestId("quick-action-refund-open").click();
  await page.getByTestId("quick-cash-refund-amount").fill("5000");
  await page.getByTestId("quick-cash-refund-reason").fill("客户确认收到现金退款");
  await page.getByTestId("quick-refund-original-document").selectOption("returned");
  await page.getByTestId("quick-cash-refund-confirm").click();
  await expect(page.getByTestId("quick-detail-notice")).toContainText("退款说明与签收单");
  await expect(page.getByTestId("quick-fin-receivable")).toContainText("27,500");
  await expect(page.getByTestId("quick-fin-paid")).toContainText("3,000");
  await expect(page.getByTestId("quick-fin-refunded")).toContainText("5,000");
  await expect(page.getByTestId("quick-fin-balance")).toContainText("29,500");
  await expect(page.getByTestId("quick-payment-records").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("quick-payment-records")).toContainText("上传签字后的纸质退款签收单（可选）");
  await expect(page.getByTestId("quick-payment-records")).toContainText("退款说明与签收单");
  await expect(page.getByTestId("quick-payment-records")).toContainText("退款 · cash");
  await expect(page.getByTestId("quick-payment-records")).not.toContainText("应收冲减");

  await page.goto("/payments?period=today");
  await expect(page.getByTestId("payments-today-net")).toContainText("−JMD 2,000");
  await expect(page.getByTestId("payments-today-count")).toContainText("2 笔");
  await expect(page.getByTestId("payments-ledger")).toContainText("独立收款 JMD 3,000");
  await expect(page.getByTestId("payments-ledger")).toContainText("实际退款 JMD 5,000");
  await expect(page.getByTestId("payments-today-sensitive")).toContainText("客户确认收到现金退款");

  for (const range of ["week", "month", "year"] as const) {
    await page.goto(`/revenue?range=${range}`);
    await expect(page.getByTestId("revenue-summary-total")).toContainText("JMD -2,000");
    await expect(page.getByTestId("revenue-summary-records")).toContainText("2");
  }
});

test("财务身份可查看收付款工作区", async ({ page }) => {
  await usePerformanceIdentity(page, "finance");
  await page.goto("/payments");
  await expect(page.getByTestId("payments-summary-receivable")).toBeVisible();
  await expect(page.locator('[data-testid^="payment-row-"]').first()).toBeVisible({ timeout: 20_000 });
});

test("430px 移动端无页面根横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/payments");
  await expect(page.getByTestId("payments-summary-receivable")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
