import { expect, test } from "@playwright/test";
import {
  assertNoPerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

const CLEAN_ORDER_IDS = [
  "demo-v2-provisional",
  "demo-v2-partial",
  "demo-v2-refunds",
  "demo-v2-parking",
  "demo-v2-parking-unclaimed",
] as const;

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("业务单页只展示五张新结构演示单并可进入详情", async ({ page }) => {
  await page.goto("/orders/business");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "业务单" })).toBeVisible();
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(0);

  const rows = page.getByTestId("business-order-row");
  await expect(rows).toHaveCount(CLEAN_ORDER_IDS.length);
  for (const orderId of CLEAN_ORDER_IDS) {
    await expect(page.locator(`[data-testid="business-order-row"][data-order-id="${orderId}"]`)).toBeVisible();
  }

  const first = page.locator('[data-testid="business-order-row"][data-order-id="demo-v2-provisional"]');
  await expect(first).toContainText("KGN-WH-2026072000001");
  await expect(first).toContainText("未开票");
  await first.click();
  await expect(page).toHaveURL(/\/orders\/business\/demo-v2-provisional$/);
  await expect(page.getByTestId("quick-detail-no")).toContainText("KGN-WH-2026072000001");
});

test("新建工单仍可选择车辆、带出客户并保存业务内容", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  await page.goto("/orders/business");
  await page.getByTestId("business-orders-create").click();
  await page.getByTestId("quick-create-vehicle-search").fill("7012 AB");
  await page.getByTestId("quick-create-vehicle-option-VEH-UAT-001").click();
  await expect(page.getByTestId("quick-create-customer")).toContainText("Alicia Bennett");
  await page.getByTestId("quick-create-raw").fill("更换刹车片 工时25000");
  await page.getByTestId("quick-create-parse").click();
  await page.getByTestId("quick-create-note-zh").fill("客户要求下午取车");
  await page.getByTestId("quick-create-note-en").fill("Customer requests afternoon pickup");
  await page.getByTestId("quick-create-submit").click();
  await expect(page).toHaveURL(/\/orders\/business\/qbo-\d+$/);
  await expect(page.getByTestId("quick-detail-notes")).toContainText("下午取车");
});

test("正式 Invoice 与未开票业务单保持各自财务来源", async ({ page }) => {
  await page.goto("/orders/business/demo-v2-refunds");
  await expect(page.getByTestId("quick-fin-source")).toContainText("正式发票");
  await expect(page.getByTestId("quick-fin-source")).toContainText("V1");
  await expect(page.getByTestId("quick-statement-history")).toContainText("退款");
  const discountedLine = page.getByTestId("quick-item-demo-v2-refunds-labor");
  await expect(discountedLine.getByTestId("quick-item-original-unit-price")).toHaveText("JMD 10,000");
  await expect(discountedLine.getByTestId("quick-item-line-discount")).toHaveText("−JMD 4,000");
  await expect(discountedLine.getByTestId("quick-item-unit-discount")).toHaveCount(0);
  await expect(discountedLine.getByTestId("quick-item-final-unit-price")).toHaveCount(0);
  await expect(discountedLine.getByTestId("quick-item-final-line-total")).toHaveText("JMD 16,000");
  await expect(page.getByTestId("quick-detail-gross-total")).toHaveText("JMD 25,000");
  await expect(page.getByTestId("quick-detail-discount-total")).toHaveText("−JMD 4,000");
  await expect(page.getByTestId("quick-detail-labor-discount-total")).toHaveText("−JMD 4,000");
  await expect(page.getByTestId("quick-detail-parts-discount-total")).toHaveText("−JMD 0");
  await expect(page.getByTestId("quick-detail-grand-total")).toHaveText("JMD 21,000");

  await page.goto("/orders/business/demo-v2-provisional");
  await expect(page.getByTestId("quick-fin-source")).toContainText("未开票");
  await expect(page.getByTestId("quick-action-pay-open")).toBeVisible();
  await expect(page.getByTestId("quick-action-refund-open")).toBeVisible();
});

test("超级管理员可在绩效板块派单并直接记录或修改接车里程", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wh_teams_v2", JSON.stringify([
      { id: "t1", name: "自建维修班组", engineering: false, builtin: false },
    ]));
  });
  await page.goto("/orders/business/demo-v2-provisional");

  await page.getByTestId("quick-perf-assign-open").click();
  await expect(page.getByTestId("quick-assign-dialog")).toBeVisible();
  await page.getByTestId("quick-assign-team-t1").click();
  await page.getByTestId("quick-assign-confirm").click();
  await expect(page.getByTestId("quick-perf-team")).toHaveText("自建维修班组");

  await page.getByTestId("quick-action-mileage-open").click();
  await page.getByTestId("quick-money-amount").fill("12345");
  await page.getByTestId("quick-money-confirm").click();
  await expect(page.getByTestId("quick-detail-mileage")).toContainText("12,345 km");
  await expect(page.getByTestId("quick-detail-mileage")).toContainText("记录人 超级管理员");

  await page.getByTestId("quick-action-mileage-open").click();
  await page.getByTestId("quick-money-amount").fill("12346");
  await page.getByTestId("quick-money-confirm").click();
  await expect(page.getByTestId("quick-detail-mileage")).toContainText("12,346 km");
});

test("430px 业务单页面仅表格容器滚动，页面根部不横溢", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/business");
  await expect(page.getByTestId("business-order-row")).toHaveCount(CLEAN_ORDER_IDS.length);
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
});

test("收费项目只读和编辑视图都不依赖横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 1368, height: 874 });
  await page.goto("/orders/business/demo-v2-refunds");
  const readonlyOverflow = await page.getByTestId("quick-shared-charge-lines").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(readonlyOverflow.scrollWidth).toBeLessThanOrEqual(readonlyOverflow.clientWidth + 1);
  const statusOverflow = await page.getByTestId("status-arrow-chain").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(statusOverflow.scrollWidth).toBeLessThanOrEqual(statusOverflow.clientWidth + 1);

  await page.goto("/orders/business/demo-v2-provisional");
  await expect(page.getByTestId("quick-shared-edit-demo-v2-provisional-labor-translation"))
    .toContainText("Engine diagnosis labor");
  await expect(page.getByTestId("quick-status-actions")).toContainText("派单");
  await expect(page.getByTestId("quick-status-actions")).toContainText("直接调整状态");
  await expect(page.getByTestId("quick-status-actions")).toContainText("作废本单");
  await expect(page.getByTestId("status-arrow-chain").locator('[data-shape="square"]')).toHaveCount(6);
  const editorOverflow = await page.getByTestId("quick-shared-charge-editor").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(editorOverflow.scrollWidth).toBeLessThanOrEqual(editorOverflow.clientWidth + 1);
});
