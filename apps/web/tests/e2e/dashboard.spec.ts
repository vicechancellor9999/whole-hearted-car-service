import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { usePerformanceIdentity } from "./helpers/performance-session";

const EXPECTED_LOGO_SHA256 =
  "a7355b53835f779fe95ef0c3bbc2cb9fdd8a5af2ac8025befc7c1918e93a2d69";

const EXPECTED_DESTINATIONS: Record<string, string> = {
  today_revenue: "/payments?period=today",
  accounts_receivable: "/payments",
  vehicles_today: "/orders/business",
  vehicles_stuck: "/orders/business",
  completed_labor: "/orders/business",
  prepaid_incomplete: "/payments",
  internal_tasks: "/parking",
  risk_alerts: "/payments",
};

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

async function openDashboard(page: Page) {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("Whole Hearted 综合管理系统");
  await expect(page.getByRole("heading", { name: "经营概览" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
}

test("经营概览只展示当前业务记录，不展示固定数字或虚构班组", async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByTestId("dashboard-header")).toContainText(
    "当前 Business Order、逐笔收款、逐笔退款与停车记录",
  );
  await expect(page.getByTestId("dashboard-header")).not.toContainText("固定演示数据");
  await expect(page.getByTestId("team-card")).toHaveCount(0);
  await expect(page.getByTestId("team-empty-state")).toContainText("尚未创建维修班组");
  await expect(page.getByTestId("dashboard-period-card")).toHaveCount(0);
  await expect(page.getByTestId("team-empty-add-team")).toHaveAttribute("href", "/dictionaries#teams");
  await expect(page.getByTestId("team-empty-add-employee")).toHaveAttribute("href", "/employees");
  await expect(page.getByTestId("identity-footer")).toContainText("超级管理员");
  await expect(page.getByTestId("identity-footer")).not.toContainText("LiJian");

  const expectedTitles = [
    ["today_revenue", "今日营业收入"],
    ["accounts_receivable", "应收账款"],
    ["vehicles_today", "接车数量"],
    ["vehicles_stuck", "在厂车辆滞留预警"],
    ["completed_labor", "完工工时产值与绩效"],
    ["prepaid_incomplete", "预收未完工订单"],
    ["internal_tasks", "内部协同事项"],
    ["risk_alerts", "运营风险提醒"],
  ] as const;
  for (const [id, title] of expectedTitles) {
    await expect(page.locator(`[data-metric-id="${id}"]`)).toContainText(title);
  }
  await expect(page.getByTestId("dashboard-content")).not.toContainText("574,555");
  await expect(page.getByTestId("dashboard-content")).not.toContainText("1,235,875");
});

test("经营概览的班组和员工入口进入真实可操作页面", async ({ page }) => {
  await openDashboard(page);
  await page.getByTestId("team-empty-add-team").click();
  await expect(page).toHaveURL(/\/dictionaries#teams$/);
  await expect(page.getByRole("button", { name: "添加班组" })).toBeVisible();

  await page.goto("/");
  await page.getByTestId("team-empty-add-employee").click();
  await expect(page).toHaveURL(/\/employees$/);
  await expect(page.getByRole("heading", { name: "员工管理" })).toBeVisible();
  await expect(page.getByTestId("employee-add-open")).toBeVisible();
});

test("新增一笔 BO 收款后经营概览立即按真实记录重算", async ({ page }) => {
  test.setTimeout(90_000);
  await openDashboard(page);
  const netCard = page.locator('[data-testid="metric-card-link"][data-metric-id="today_revenue"]');
  const balanceCard = page.locator('[data-testid="metric-card-link"][data-metric-id="accounts_receivable"]');
  await expect(netCard).toBeVisible({ timeout: 45_000 });
  const amount = (text: string | null) => Number((text?.match(/JMD\s+([\d,]+)/)?.[1] ?? "0").replaceAll(",", ""));
  const beforeNet = amount(await netCard.getByTestId("metric-card-value").textContent());
  const beforeBalance = amount(await balanceCard.getByTestId("metric-card-value").textContent());

  await page.goto("/orders/business/demo-v2-provisional");
  await expect(page.getByTestId("quick-action-pay-open")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("quick-action-pay-open").click();
  await page.getByTestId("quick-money-amount").fill("1000");
  await page.getByTestId("quick-money-note").fill("经营概览实时重算验证");
  await page.getByTestId("quick-money-confirm").click();
  await expect(page.getByTestId("quick-detail-notice")).toContainText("独立收款");

  await page.goto("/");
  await expect(netCard).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => amount(await netCard.getByTestId("metric-card-value").textContent())).toBe(beforeNet + 1_000);
  await expect.poll(async () => amount(await balanceCard.getByTestId("metric-card-value").textContent())).toBe(beforeBalance - 1_000);
});

test("dashboard matches the approved information architecture and brand", async ({
  page,
  request,
}) => {
  await openDashboard(page);

  const teamCards = page.getByTestId("team-card");
  await expect(teamCards).toHaveCount(0);
  await expect(page.getByTestId("team-empty-state")).toContainText("尚未创建维修班组");
  await expect(page.getByTestId("top-metric-card")).toHaveCount(4);
  await expect(page.getByTestId("bottom-metric-card")).toHaveCount(4);
  await expect(page.getByRole("img", { name: "Whole Hearted" })).toBeVisible();
  await expect(page.getByTestId("brand-name")).toContainText(
    "Whole Hearted Car Service Limited",
  );
  await expect(page.getByTestId("identity-footer")).toContainText("超级管理员");
  await expect(page.getByTestId("identity-footer")).not.toContainText("LiJian");
  await expect(page.getByTestId("dashboard-header")).toContainText("新增或修改记录后立即重算");
  await expect(page.getByTestId("team-performance")).toContainText("尚未创建维修班组");
  await expect(page.getByTestId("team-performance-summary"))
    .toContainText("JMD 0 / JMD 0");
  await expect(page.getByTestId("team-performance-rate")).toHaveText("0%");
  await expect(
    page.locator('[data-testid="metric-card-link"][data-metric-id="accounts_receivable"]'),
  ).toContainText("当前有效 BO 的未结余额");

  const logo = await request.get("/logo-icon.png");
  expect(logo.ok()).toBe(true);
  expect(createHash("sha256").update(await logo.body()).digest("hex")).toBe(
    EXPECTED_LOGO_SHA256,
  );
});

test("desktop geometry follows the reference card rows", async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByTestId("sidebar")).toHaveCount(1);
  await expect(page.getByTestId("dashboard-content")).toHaveCount(1);
  await expect(page.getByTestId("dashboard-header")).toHaveCount(1);
  await expect(page.getByTestId("team-card")).toHaveCount(0);
  await expect(page.getByTestId("team-empty-state")).toHaveCount(1);
  await expect(page.getByTestId("bottom-metric-card")).toHaveCount(4);

  const sidebar = await page.getByTestId("sidebar").boundingBox();
  const content = await page.getByTestId("dashboard-content").boundingBox();
  const header = await page.getByTestId("dashboard-header").boundingBox();
  const team = await page.getByTestId("team-performance").boundingBox();
  expect(sidebar).not.toBeNull();
  expect(content).not.toBeNull();
  expect(header).not.toBeNull();
  expect(team).not.toBeNull();
  expect(Math.abs(sidebar!.width - 220)).toBeLessThanOrEqual(2);
  expect(content!.width).toBeLessThanOrEqual(1324);
  expect(header!.y).toBeLessThanOrEqual(24);
  expect(header!.height).toBeGreaterThanOrEqual(90);
  expect(team!.y).toBeGreaterThan(header!.y + header!.height);
  expect(team!.height).toBeGreaterThanOrEqual(130);

  const teamSpacing = await page.getByTestId("team-performance").evaluate((section) => {
    const headerBox = section.firstElementChild?.getBoundingClientRect();
    const cardBox = section
      .querySelector('[data-testid="team-empty-state"]')
      ?.getBoundingClientRect();
    return {
      gap: headerBox && cardBox ? cardBox.top - headerBox.bottom : -1,
    };
  });
  expect(teamSpacing.gap).toBeGreaterThanOrEqual(11);
  expect(teamSpacing.gap).toBeLessThanOrEqual(13);

  for (const testId of ["bottom-metric-card"]) {
    const boxes = await page.getByTestId(testId).evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThanOrEqual(1);
  }

  const box = async (id: string) => {
    const value = await page
      .locator(`[data-testid="metric-card-link"][data-metric-id="${id}"]`)
      .boundingBox();
    expect(value, `${id} should be visible`).not.toBeNull();
    return value!;
  };
  const revenue = await box("today_revenue");
  const receivable = await box("accounts_receivable");
  const vehicles = await box("vehicles_today");
  const stuck = await box("vehicles_stuck");
  const firstBottom = await page.getByTestId("bottom-metric-card").first().boundingBox();
  const firstTeam = await page.getByTestId("team-empty-state").boundingBox();
  expect(firstBottom).not.toBeNull();
  expect(firstTeam).not.toBeNull();

  expect(Math.abs(revenue.y - receivable.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(revenue.height - receivable.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(vehicles.y - revenue.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(vehicles.x - stuck.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(vehicles.width - stuck.width)).toBeLessThanOrEqual(1);
  expect(stuck.y).toBeGreaterThan(vehicles.y);
  expect(
    Math.abs(stuck.y + stuck.height - (revenue.y + revenue.height)),
  ).toBeLessThanOrEqual(2);
  expect(revenue.y).toBeGreaterThanOrEqual(339);
  expect(revenue.y).toBeLessThanOrEqual(347);
  expect(revenue.height).toBeGreaterThanOrEqual(245);
  expect(revenue.height).toBeLessThanOrEqual(260);
  expect(firstBottom!.y).toBeGreaterThanOrEqual(600);
  expect(firstBottom!.y).toBeLessThanOrEqual(616);
  expect(firstBottom!.height).toBeGreaterThanOrEqual(195);
  expect(firstBottom!.height).toBeLessThanOrEqual(204);
  expect(firstTeam!.y).toBeGreaterThanOrEqual(221);
  expect(firstTeam!.y).toBeLessThanOrEqual(225);
  expect(firstTeam!.height).toBeGreaterThanOrEqual(90);
  expect(firstTeam!.height).toBeLessThanOrEqual(96);
});

test("empty team state is visible and stays legible in dark mode", async ({ page }) => {
  await openDashboard(page);
  const emptyState = page.getByTestId("team-empty-state");
  await expect(emptyState).toContainText("超级管理员新增班组和员工");

  await page.evaluate(() => localStorage.setItem("wh_theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(emptyState).toBeVisible();
  expect(await emptyState.evaluate((node) => getComputedStyle(node).color)).not.toBe("rgba(0, 0, 0, 0)");
});

test("clock advances and appearance toggle persists dark theme", async ({ page }) => {
  await openDashboard(page);
  await page.evaluate(() => localStorage.setItem("wh_theme", "light"));
  await page.reload();
  await expect(page.getByTestId("dashboard-content")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  const clock = page.getByTestId("live-clock");
  await expect(clock).toBeVisible();
  const first = await clock.textContent();
  await expect.poll(() => clock.textContent(), { timeout: 3_000 }).not.toBe(first);

  const revenueCard = page.locator(
    '[data-testid="metric-card-link"][data-metric-id="today_revenue"]',
  );
  const activeNav = page.getByRole("link", { name: "经营概览", exact: true });
  const activeNavIcon = activeNav.locator("svg");
  const lightBackground = await revenueCard.evaluate(
    (node) => getComputedStyle(node).backgroundImage,
  );
  const dashboardHeader = page.getByTestId("dashboard-header");
  const teamPerformance = page.getByTestId("team-performance");
  const lightHeaderBackground = await dashboardHeader.evaluate(
    (node) => getComputedStyle(node).backgroundImage,
  );
  const lightTeamBackground = await teamPerformance.evaluate(
    (node) => getComputedStyle(node).backgroundImage,
  );
  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("wh_theme"))).toBe("dark");
  await expect
    .poll(() => revenueCard.evaluate((node) => getComputedStyle(node).backgroundImage))
    .not.toBe(lightBackground);
  expect(
    await revenueCard.evaluate((node) => getComputedStyle(node).backgroundImage),
  ).not.toContain("rgb(255, 255, 255)");
  await expect
    .poll(() => dashboardHeader.evaluate((node) => getComputedStyle(node).backgroundImage))
    .not.toBe(lightHeaderBackground);
  await expect
    .poll(() => teamPerformance.evaluate((node) => getComputedStyle(node).backgroundImage))
    .not.toBe(lightTeamBackground);
  expect(
    await dashboardHeader.evaluate((node) => getComputedStyle(node).backgroundImage),
  ).not.toContain("rgb(255, 255, 255)");
  expect(
    await teamPerformance.evaluate((node) => getComputedStyle(node).backgroundImage),
  ).not.toContain("rgb(255, 255, 255)");
  expect(
    await revenueCard
      .getByTestId("metric-card-subtitle")
      .evaluate((node) => getComputedStyle(node).color),
  ).toBe("rgb(148, 163, 184)");
  expect(
    await revenueCard
      .getByTestId("metric-card-icon")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toContain("255, 255, 255");
  expect(
    await revenueCard
      .getByTestId("metric-card-arrow")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toContain("255, 255, 255");
  await expect
    .poll(() => activeNav.evaluate((node) => getComputedStyle(node).color))
    .toBe("rgb(144, 181, 216)");
  await expect
    .poll(() => activeNavIcon.evaluate((node) => getComputedStyle(node).color))
    .toBe("rgb(144, 181, 216)");
  await expect
    .poll(() => page
      .getByText("综合管理系统", { exact: true })
      .evaluate((node) => getComputedStyle(node).color))
    .toBe("rgb(148, 163, 184)");
  await expect
    .poll(() => page
      .getByText("Mock 数据模式", { exact: true })
      .evaluate((node) => getComputedStyle(node).color))
    .toBe("rgb(148, 163, 184)");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("live money and BO cards preserve a readable information order", async ({ page }) => {
  await openDashboard(page);

  const revenue = page.locator(
    '[data-testid="metric-card-link"][data-metric-id="today_revenue"]',
  );
  const yPositions = await revenue.evaluate((card) =>
    [
      "metric-card-value",
      "metric-card-subtitle",
      "metric-card-breakdown",
      "metric-card-footer",
    ].map((testId) => {
      const node = card.querySelector(`[data-testid="${testId}"]`);
      return node?.getBoundingClientRect().top ?? -1;
    }),
  );
  expect(yPositions.every((value) => value >= 0)).toBe(true);
  expect(yPositions).toEqual([...yPositions].sort((a, b) => a - b));
  await expect(revenue.getByTestId("metric-card-breakdown")).toContainText("今日收款");
  await expect(revenue.getByTestId("metric-card-breakdown")).toContainText("今日现金退款");
  await expect(revenue.getByTestId("metric-card-footer")).toContainText("收款记录");
  await expect(revenue.getByTestId("metric-card-footer")).toContainText("退款记录");
  const horizontalLayout = await revenue.evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const breakdownItems = card.querySelectorAll(
      '[data-testid="metric-card-breakdown-item"]',
    );
    const footerItem = card.querySelector('[data-testid="metric-card-footer-item"]');
    const firstBreakdown = breakdownItems[0]?.getBoundingClientRect();
    const lastBreakdown = breakdownItems[breakdownItems.length - 1]?.getBoundingClientRect();
    const footerBox = footerItem?.getBoundingClientRect();
    const arrowBox = card
      .querySelector('[data-testid="metric-card-arrow"]')
      ?.getBoundingClientRect();
    return {
      contentLeft: cardBox.left + 20,
      contentRight: cardBox.right - 20,
      breakdownLeft: firstBreakdown?.left ?? -1,
      breakdownRight: lastBreakdown?.right ?? -1,
      breakdownTop: lastBreakdown?.top ?? -1,
      breakdownBottom: lastBreakdown?.bottom ?? -1,
      footerLeft: footerBox?.left ?? -1,
      footerRight: footerBox?.right ?? -1,
      arrowLeft: arrowBox?.left ?? -1,
      arrowRight: arrowBox?.right ?? -1,
      arrowTop: arrowBox?.top ?? -1,
      arrowBottom: arrowBox?.bottom ?? -1,
    };
  });
  expect(Math.abs(horizontalLayout.breakdownLeft - horizontalLayout.contentLeft)).toBeLessThanOrEqual(4);
  expect(horizontalLayout.breakdownRight).toBeGreaterThanOrEqual(horizontalLayout.contentRight - 64);
  expect(Math.abs(horizontalLayout.footerLeft - horizontalLayout.contentLeft)).toBeLessThanOrEqual(4);
  expect(horizontalLayout.footerRight).toBeLessThanOrEqual(horizontalLayout.contentRight + 4);
  expect(horizontalLayout.footerRight).toBeGreaterThan(horizontalLayout.footerLeft);
  const breakdownOverlapsArrow =
    horizontalLayout.breakdownLeft < horizontalLayout.arrowRight &&
    horizontalLayout.breakdownRight > horizontalLayout.arrowLeft &&
    horizontalLayout.breakdownTop < horizontalLayout.arrowBottom &&
    horizontalLayout.breakdownBottom > horizontalLayout.arrowTop;
  expect(breakdownOverlapsArrow).toBe(false);
  const labor = page.locator(
    '[data-testid="metric-card-link"][data-metric-id="completed_labor"]',
  );
  await expect(labor).toContainText("完工工时产值与绩效");
  await expect(labor).toContainText("全部有效 BO");
});

test("all eight metric cards expose working keyboard-reachable destinations", async ({
  page,
  request,
}) => {
  await openDashboard(page);

  const cards = page.getByTestId("metric-card-link");
  await expect(cards).toHaveCount(8);
  const destinations = await cards.evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((node) => [
        node.getAttribute("data-metric-id"),
        node.getAttribute("href"),
      ]),
    ),
  );
  expect(destinations).toEqual(EXPECTED_DESTINATIONS);

  for (const href of new Set(Object.values(EXPECTED_DESTINATIONS))) {
    const response = await request.get(href);
    expect(response.ok(), `${href} should resolve`).toBe(true);
  }

  await page
    .locator('[data-testid="metric-card-link"][data-metric-id="today_revenue"]')
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/payments\?period=today$/);
});

test("430px viewport has no horizontal document overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await openDashboard(page);
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
  const cards = page.getByTestId("metric-card-link");
  await expect(cards).toHaveCount(8);
  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width, height: box.height };
    }),
  );
  expect(boxes.every((box) => box.left >= 0 && box.right <= 430)).toBe(true);
  expect(boxes.every((box) => box.width >= 380 && box.height >= 100)).toBe(true);
  const revenueOverlap = await page
    .locator('[data-testid="metric-card-link"][data-metric-id="today_revenue"]')
    .evaluate((card) => {
      const breakdownItems = card.querySelectorAll(
        '[data-testid="metric-card-breakdown-item"]',
      );
      const item = breakdownItems[breakdownItems.length - 1]?.getBoundingClientRect();
      const arrow = card
        .querySelector('[data-testid="metric-card-arrow"]')
        ?.getBoundingClientRect();
      if (!item || !arrow) return true;
      return (
        item.left < arrow.right &&
        item.right > arrow.left &&
        item.top < arrow.bottom &&
        item.bottom > arrow.top
      );
    });
  expect(revenueOverlap).toBe(false);
  const teamCopy = await page.getByTestId("team-performance-copy").boundingBox();
  const teamSummary = await page.getByTestId("team-performance-summary").boundingBox();
  expect(teamCopy).not.toBeNull();
  expect(teamSummary).not.toBeNull();
  expect(teamCopy!.width).toBeGreaterThanOrEqual(360);
  expect(teamSummary!.y).toBeGreaterThanOrEqual(teamCopy!.y + teamCopy!.height);
  expect(
    await page
      .getByTestId("team-performance-rate")
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeGreaterThanOrEqual(18);
});
