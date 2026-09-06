import { expect, test, type Page } from "@playwright/test";
import type { FormalChargeSnapshot } from "../../src/lib/api/formal-business-orders";
import { usePerformanceIdentity } from "./helpers/performance-session";

type RepairRoundState = "in_repair" | "return_pending_review" | "formally_handed_off";

type HandoffFixture = {
  id: number;
  handoffNo: number;
  performanceMinor: number;
  jamaicaMonth: string;
  handedOffAt: string;
  cancelledAt: string | null;
  performanceAdjustmentAllowed: boolean;
  performanceAdjustmentUnavailableReason: "cancelled" | "closed_month" | null;
};

const laborSubtotalMinor = 150_000;

function detail({
  chargeCount = 1,
  partSubtotalMinor = 0,
  otherSubtotalMinor = 0,
  otherDiscountMinor = 0,
  wholeOrderDiscountMinor = 0,
  transactions = Array.from({ length: 24 }, (_, index) => ({
  type: "payment",
  id: index + 1,
  referenceNo: `RCT-${String(index + 1).padStart(4, "0")}`,
  amountMinor: 10_000,
  methodCode: "cash",
  methodLabelZh: "现金",
  methodLabelEn: "Cash",
  occurredAt: "2026-08-31T12:00:00.000Z",
  note: "维修历史记录",
  receiptId: null,
  })),
}: {
  chargeCount?: number;
  partSubtotalMinor?: number;
  otherSubtotalMinor?: number;
  otherDiscountMinor?: number;
  wholeOrderDiscountMinor?: number;
  transactions?: Array<Record<string, unknown>>;
} = {}) {
  const chargeItems: FormalChargeSnapshot["items"] = Array.from({ length: chargeCount }, (_, index) => ({
    id: index + 9, kind: "labor" as const, nameZh: `整单工时 ${index + 1}`, nameEn: `Order labor ${index + 1}`,
    descriptionZh: null, descriptionEn: null, unitItemId: 1, quantity: "1", unitPriceMinor: laborSubtotalMinor,
    itemDiscountMinor: 0, subtotalMinor: laborSubtotalMinor, sortOrder: index + 1,
  }));
  if (partSubtotalMinor > 0) {
    chargeItems.push({
      id: chargeCount + 9, kind: "part", nameZh: "测试配件", nameEn: "Test part",
      descriptionZh: null, descriptionEn: null, unitItemId: 1, quantity: "1", unitPriceMinor: partSubtotalMinor,
      itemDiscountMinor: 0, subtotalMinor: partSubtotalMinor, sortOrder: chargeCount + 1,
    });
  }
  if (otherSubtotalMinor > 0) {
    chargeItems.push({
      id: chargeCount + 10, kind: "other", nameZh: "测试其他费用", nameEn: "Test other charge",
      descriptionZh: null, descriptionEn: null, unitItemId: 1, quantity: "1", unitPriceMinor: otherSubtotalMinor,
      itemDiscountMinor: 0, subtotalMinor: otherSubtotalMinor, sortOrder: chargeCount + 2,
    });
  }
  const grossMinor = chargeCount * laborSubtotalMinor + partSubtotalMinor + otherSubtotalMinor;
  const totalDueMinor = grossMinor - otherDiscountMinor - wholeOrderDiscountMinor;
  return {
    order: {
      id: 7, orderNo: "BO-000007", vehicleId: 12,
      payer: { type: "person", displayName: "测试客户", phone: "8765550100", trn: null, contactName: null },
      vehicle: { plate: "1234 AB", description: "Toyota Vitz", vin: null },
      status: "return_pending_review", currentChargeVersionNo: 1,
      createdAt: "2026-08-26T12:00:00.000Z", voided: false, voidReason: null, version: 4,
    },
    charges: {
      id: 30, businessOrderId: 7, versionNo: 1, reason: "初始收费",
      totals: { grossMinor, lineDiscountMinor: 0, laborDiscountMinor: 0, partDiscountMinor: 0, otherDiscountMinor, categoryDiscountMinor: otherDiscountMinor, wholeOrderDiscountMinor, totalDueMinor, includedGctMinor: Math.round(totalDueMinor * 15 / 115) },
      items: chargeItems,
      notes: [], businessOrderVersion: 4,
    },
    ledger: { businessOrderId: 7, currentDueMinor: totalDueMinor, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: totalDueMinor, transactions },
    problemDescriptions: {
      original: { contentZh: null, contentEn: null, confirmedByName: "前台", confirmedAt: "2026-08-26T12:00:00.000Z" },
      current: null, businessOrderHistory: [], currentRound: null, currentRoundHistory: [],
    },
    refunds: [], documents: [], paymentMethods: [], chargeUnits: [{ id: 1, labelZh: "项", labelEn: "Item" }],
    capabilities: { canWrite: true, canRecordPayment: false, canRefund: false },
  };
}

function workspace(
  state: RepairRoundState,
  performanceDraftMinor: number | null,
  version = 7,
  approved = false,
  auditCount = 0,
  historyState: { previousVersion: number; previousHandoffs: HandoffFixture[] } = {
    previousVersion: 6,
    previousHandoffs: [{
      id: 41,
      handoffNo: 1,
      performanceMinor: 5_440_000,
      jamaicaMonth: "2026-08",
      handedOffAt: "2026-08-28T12:00:00.000Z",
      cancelledAt: null,
      performanceAdjustmentAllowed: true,
      performanceAdjustmentUnavailableReason: null,
    }],
  },
) {
  const latestWorkReturn = {
    id: 31, submissionNo: 1, submissionSource: "electronic", workSummary: "已完成维修", exceptionSummary: null,
    itemResults: [], actualStaffMemberId: null, actualStaffName: null, submittedBy: 1, submittedByName: "前台",
    submittedAt: "2026-08-31T12:00:00.000Z", attachments: [], review: null,
  };
  const current = {
    id: 21, businessOrderId: 7, roundNo: 2, source: "after_sales", afterSalesIssue: "异响复发",
    performanceDraftMinor, status: state, assignedTeamId: 3, intakeMileageKm: 123_456, intakePhotoFileIds: [],
    latestWorkReturnId: state === "return_pending_review" ? 31 : null,
    approvedWorkReturnId: approved ? 31 : null,
    latestWorkReturn: state === "return_pending_review" ? latestWorkReturn : null,
    version,
  };
  const previous = {
    id: 20, businessOrderId: 7, roundNo: 1, source: "initial", afterSalesIssue: null,
    performanceDraftMinor: 5_440_000, status: "formally_handed_off" as const, assignedTeamId: 3,
    intakeMileageKm: 120_000, intakePhotoFileIds: [], latestWorkReturnId: 30,
    approvedWorkReturnId: 30, latestWorkReturn: null,
    createdAt: "2026-08-26T12:00:00.000Z", createdBy: 2,
    updatedAt: "2026-08-28T12:00:00.000Z", events: [],
    version: historyState.previousVersion,
    formalHandoffs: historyState.previousHandoffs,
  };
  return {
    current,
    auditTrail: Array.from({ length: auditCount }, (_, index) => ({
      id: index + 1, occurredAt: "2026-08-31T12:00:00.000Z", actorAccountId: 1,
      actorDisplayName: "前台", actorUsername: "frontdesk", eventType: "business_order.updated",
      objectType: "business_order", objectId: "7", reason: `历史记录 ${index + 1}`, before: null, after: null,
    })),
    history: [previous, {
      ...current,
      createdAt: "2026-08-30T12:00:00.000Z",
      createdBy: 2,
      updatedAt: "2026-08-31T12:00:00.000Z",
      events: [],
      formalHandoffs: state === "formally_handed_off" ? [{
        id: 42,
        handoffNo: 1,
        performanceMinor: performanceDraftMinor ?? 5_440_000,
        jamaicaMonth: "2026-08",
        handedOffAt: "2026-08-31T12:00:00.000Z",
        cancelledAt: null,
        performanceAdjustmentAllowed: true,
        performanceAdjustmentUnavailableReason: null,
      }] : [],
    }],
  };
}

async function installFixture(page: Page, options: { chargeCount?: number; partSubtotalMinor?: number; otherSubtotalMinor?: number; otherDiscountMinor?: number; wholeOrderDiscountMinor?: number; auditCount?: number; previousAdjustmentAllowed?: boolean; adjustmentFailure?: string } = {}) {
  let state: RepairRoundState = "in_repair";
  let draft: number | null = null;
  let version = 7;
  let previousVersion = 6;
  let approved = false;
  let lastWrite: unknown = null;
  let previousHandoffs: HandoffFixture[] = [{
    id: 41,
    handoffNo: 1,
    performanceMinor: 5_440_000,
    jamaicaMonth: "2026-08",
    handedOffAt: "2026-08-28T12:00:00.000Z",
    cancelledAt: null,
    performanceAdjustmentAllowed: options.previousAdjustmentAllowed !== false,
    performanceAdjustmentUnavailableReason: options.previousAdjustmentAllowed === false ? "closed_month" : null,
  }];

  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));

  await page.route("**/api/formal/business-orders/7/rounds", async (route) => {
    if (route.request().method() === "POST") {
      lastWrite = route.request().postDataJSON();
      const body = lastWrite as { action?: string; performanceValue?: string };
      if (body.action !== "set_performance_draft" && body.action !== "adjust_formal_handoff_performance") {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "unexpected action" }) });
        return;
      }
      if (body.action === "adjust_formal_handoff_performance" && options.adjustmentFailure) {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: options.adjustmentFailure }) });
        return;
      }
      const nextPerformanceMinor = Math.round(Number(body.performanceValue) * 100);
      const formalHandoffId = Number((lastWrite as { formalHandoffId?: number }).formalHandoffId);
      if (body.action === "adjust_formal_handoff_performance" && formalHandoffId === 41) {
        previousHandoffs = [
          { ...previousHandoffs[0], cancelledAt: "2026-08-31T13:00:00.000Z", performanceAdjustmentAllowed: false, performanceAdjustmentUnavailableReason: "cancelled" },
          {
            id: 43,
            handoffNo: 3,
            performanceMinor: nextPerformanceMinor,
            jamaicaMonth: "2026-08",
            handedOffAt: "2026-08-31T13:00:00.000Z",
            cancelledAt: null,
            performanceAdjustmentAllowed: true,
            performanceAdjustmentUnavailableReason: null,
          },
        ];
        previousVersion += 2;
      } else {
        draft = nextPerformanceMinor;
        version += 1;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...workspace(state, draft, version, approved, options.auditCount, { previousVersion, previousHandoffs }), result: { performanceDraftMinor: nextPerformanceMinor } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace(state, draft, version, approved, options.auditCount, { previousVersion, previousHandoffs })) });
  });
  await page.route("**/api/formal/business-orders/7", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail({ chargeCount: options.chargeCount, partSubtotalMinor: options.partSubtotalMinor, otherSubtotalMinor: options.otherSubtotalMinor, otherDiscountMinor: options.otherDiscountMinor, wholeOrderDiscountMinor: options.wholeOrderDiscountMinor })) }));
  await page.route("**/api/formal/master-data", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dictionaries: [], teams: [{ id: 3, teamNo: "TEAM-003", name: "A 组", isActive: true, version: 1 }], staff: [], payrollParameters: [] }) }));
  await page.route("**/api/formal/inspection-reports*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], page: 1, pageSize: 20, pageCount: 0, total: 0 }) }));

  return {
    setRound(next: { state: RepairRoundState; draft: number | null; approved?: boolean }) { state = next.state; draft = next.draft; approved = next.approved ?? false; },
    lastWrite: () => lastWrite,
  };
}

test.beforeEach(async ({ page }) => { await usePerformanceIdentity(page, "superadmin"); });

test("charges summary renders reconcilable category totals and a whole-order discount", async ({ page }) => {
  await installFixture(page, { chargeCount: 2, partSubtotalMinor: 480_000, otherSubtotalMinor: 200_000, otherDiscountMinor: 20_000, wholeOrderDiscountMinor: 100_000 });
  await page.goto("/orders/business/7?tab=operations");

  await expect(page.getByTestId("business-order-labor-total")).toHaveText("JMD 3,000.00");
  await expect(page.getByTestId("business-order-part-total")).toHaveText("JMD 4,800.00");
  await expect(page.getByTestId("business-order-other-total")).toHaveText("JMD 1,800.00");
  await expect(page.getByTestId("business-order-whole-order-discount")).toHaveText("整单优惠 −JMD 1,000.00");
  await expect(page.locator("#business-order-operations-workspace").getByText("JMD 8,600.00", { exact: true })).toBeVisible();
});

test("after-sales rounds use their own zero performance default in every pre-handoff path", async ({ page }) => {
  const fixture = await installFixture(page);
  await page.goto("/orders/business/7?tab=operations");
  await expect(page.getByTestId("repair-round-performance")).toHaveText("JMD 0.00");
  await page.getByRole("button", { name: "收到纸质回单" }).click();
  await expect(page.getByRole("dialog").locator('input[name="performanceValue"]')).toHaveValue("0");
  await expect(page.getByRole("dialog").locator('input[name="performanceValue"]')).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: /关闭确认纸质回单并正式交单/ }).click();

  fixture.setRound({ state: "return_pending_review", draft: 0 });
  await page.reload();
  await expect(page.getByTestId("repair-round-performance")).toHaveText("JMD 0.00");
  await page.getByRole("button", { name: "审核并正式交单" }).click();
  await expect(page.getByRole("dialog").locator('input[name="performanceValue"]')).toHaveValue("0");
  await expect(page.getByRole("dialog").locator('input[name="performanceValue"]')).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: /关闭审核维修工回单/ }).click();

  fixture.setRound({ state: "return_pending_review", draft: 0, approved: true });
  await page.reload();
  await page.getByRole("button", { name: "完成旧回单交单" }).click();
  await expect(page.getByRole("dialog").locator('input[name="performanceValue"]')).toHaveValue("0");
  await expect(page.getByRole("dialog").locator('input[name="performanceValue"]')).toHaveAttribute("readonly", "");
});

test("editing a current round performance posts its version and refreshes the displayed draft", async ({ page }) => {
  const fixture = await installFixture(page);
  await page.goto("/orders/business/7?tab=operations");
  await page.getByRole("button", { name: "修改绩效值" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="performanceValue"]').fill("-12.34");
  await dialog.getByRole("button", { name: "保存绩效值" }).click();
  expect(fixture.lastWrite()).toEqual({ action: "set_performance_draft", repairRoundId: 21, repairRoundVersion: 7, performanceValue: "-12.34" });
  await expect(page.getByTestId("repair-round-performance")).toHaveText("−JMD 12.34");
});

test("an active handed-off round keeps a visible audited performance adjustment path", async ({ page }) => {
  const fixture = await installFixture(page);
  fixture.setRound({ state: "formally_handed_off", draft: 5_440_000 });
  await page.goto("/orders/business/7?tab=operations");

  await expect(page.getByText("JMD 54,400.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "调整绩效值" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[name="performanceValue"]')).toHaveValue("54400");
  await dialog.locator('input[name="performanceValue"]').fill("50000");
  await dialog.locator('textarea[name="reason"]').fill("第二轮绩效录入错误");
  await dialog.getByRole("button", { name: "确认调整绩效" }).click();

  expect(fixture.lastWrite()).toEqual({
    action: "adjust_formal_handoff_performance",
    formalHandoffId: 42,
    repairRoundVersion: 7,
    performanceValue: "50000",
    reason: "第二轮绩效录入错误",
  });
});

test("a previous handed-off repair round has its own performance adjustment path", async ({ page }) => {
  const fixture = await installFixture(page);
  fixture.setRound({ state: "in_repair", draft: 0 });
  await page.goto("/orders/business/7?tab=operations");

  await page.getByRole("button", { name: "查看整单历史" }).click();
  const historyDialog = page.getByRole("dialog", { name: "Business Order 全部维修历史" });
  const previousRound = historyDialog.locator("article").filter({ hasText: "第 1 轮维修" });
  await previousRound.getByRole("button", { name: "调整第 1 轮绩效值" }).click();

  const editDialog = page.getByRole("dialog", { name: "调整第 1 轮已交单绩效" });
  await expect(editDialog.locator('input[name="performanceValue"]')).toHaveValue("54400");
  await editDialog.locator('input[name="performanceValue"]').fill("51000");
  await editDialog.locator('textarea[name="reason"]').fill("修正第一轮绩效");
  await editDialog.getByRole("button", { name: "确认调整绩效" }).click();

  expect(fixture.lastWrite()).toEqual({
    action: "adjust_formal_handoff_performance",
    formalHandoffId: 41,
    repairRoundVersion: 6,
    performanceValue: "51000",
    reason: "修正第一轮绩效",
  });
  await expect(editDialog).toBeHidden();
  await expect(page.getByTestId("repair-round-performance")).toHaveText("JMD 0.00");

  await page.getByRole("button", { name: "查看整单历史" }).click();
  const refreshedHistory = page.getByRole("dialog", { name: "Business Order 全部维修历史" });
  await expect(refreshedHistory.locator("article").filter({ hasText: "第 1 轮维修" })).toContainText("JMD 51,000.00");
  await expect(refreshedHistory.locator("article").filter({ hasText: "第 2 轮维修" })).toContainText("尚未交单");
});

test("a closed-month handoff explains why performance can no longer be adjusted", async ({ page }) => {
  await installFixture(page, { previousAdjustmentAllowed: false });
  await page.goto("/orders/business/7?tab=operations");
  await page.getByRole("button", { name: "查看整单历史" }).click();

  const previousRound = page.getByRole("dialog", { name: "Business Order 全部维修历史" }).locator("article").filter({ hasText: "第 1 轮维修" });
  await expect(previousRound.getByText("已过当前牙买加月份，绩效已结账，不能再调整")).toBeVisible();
  await expect(previousRound.getByRole("button", { name: "调整第 1 轮绩效值" })).toHaveCount(0);
});

test("a rejected performance adjustment stays open and shows the server reason inside the dialog", async ({ page }) => {
  await installFixture(page, { adjustmentFailure: "该交单不在当前牙买加自然月，不能调整绩效" });
  await page.goto("/orders/business/7?tab=operations");
  await page.getByRole("button", { name: "查看整单历史" }).click();
  await page.getByRole("dialog", { name: "Business Order 全部维修历史" }).locator("article").filter({ hasText: "第 1 轮维修" }).getByRole("button", { name: "调整第 1 轮绩效值" }).click();

  const dialog = page.getByRole("dialog", { name: "调整第 1 轮已交单绩效" });
  await dialog.locator('textarea[name="reason"]').fill("更正历史轮绩效");
  await dialog.getByRole("button", { name: "确认调整绩效" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText("该交单不在当前牙买加自然月，不能调整绩效");
});

test("desktop operations keeps repair and expandable finance together in one scrolling right rail", async ({ page }) => {
  const fixture = await installFixture(page);
  fixture.setRound({ state: "return_pending_review", draft: 0 });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/orders/business/7?tab=operations");
  await page.getByRole("button", { name: "收付款历史" }).click();
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-testid="business-order-right-rail"]');
    const repair = document.querySelector<HTMLElement>("#business-order-repair-workspace");
    const finance = document.querySelector<HTMLElement>("#business-order-finance-workspace");
    if (!rail || !repair || !finance) throw new Error("operations rail is missing");
    const repairBox = repair.getBoundingClientRect();
    const financeBox = finance.getBoundingClientRect();
    return {
      documentFitsViewport: document.documentElement.scrollHeight <= window.innerHeight,
      overlap: repairBox.bottom > financeBox.top,
      verticalGap: financeBox.top - repairBox.bottom,
      railCanScroll: rail.scrollHeight > rail.clientHeight,
      repairOverflow: getComputedStyle(repair).overflowY,
      financeOverflow: getComputedStyle(finance).overflowY,
    };
  });
  expect(geometry).toEqual({
    documentFitsViewport: true,
    overlap: false,
    verticalGap: expect.closeTo(12, 1),
    railCanScroll: true,
    repairOverflow: "visible",
    financeOverflow: "visible",
  });
});

test("compact desktop keeps the Business Order shell fixed and all workspaces on one tab row", async ({ page }) => {
  const fixture = await installFixture(page, { chargeCount: 60, auditCount: 80 });
  fixture.setRound({ state: "return_pending_review", draft: 0 });
  await page.setViewportSize({ width: 931, height: 698 });
  await page.goto("/orders/business/7?tab=operations");
  await page.getByRole("button", { name: "收付款历史" }).click();

  const geometry = await page.evaluate(() => {
    const shellMain = document.querySelector<HTMLElement>('[data-testid="app-shell"] main');
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
    const workspaceGrid = document.querySelector<HTMLElement>("#business-order-operations-workspace")?.parentElement;
    const charges = document.querySelector<HTMLElement>("#business-order-operations-workspace");
    const rail = document.querySelector<HTMLElement>('[data-testid="business-order-right-rail"]');
    if (!shellMain || !tablist || !workspaceGrid || !charges || !rail) throw new Error("compact workspace is missing");
    const mainBox = shellMain.getBoundingClientRect();
    const tablistBox = tablist.getBoundingClientRect();
    const gridBox = workspaceGrid.getBoundingClientRect();
    const chargesBox = charges.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    return {
      shellFits: shellMain.scrollHeight <= shellMain.clientHeight + 1,
      tabRows: new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().top))).size,
      tabsFitHorizontally: tablist.scrollWidth <= tablist.clientWidth + 1
        && tabs.every((tab) => tab.getBoundingClientRect().right <= tablistBox.right + 1),
      panesShareRow: Math.abs(chargesBox.top - railBox.top) <= 1 && chargesBox.right <= railBox.left + 1,
      gridVisibleAndFitsMain: gridBox.top >= mainBox.top - 1 && gridBox.bottom <= mainBox.bottom + 1,
      chargesVisibleAndFitsGrid: chargesBox.top >= gridBox.top - 1 && chargesBox.bottom <= gridBox.bottom + 1,
      railVisibleAndFitsGrid: railBox.top >= gridBox.top - 1 && railBox.bottom <= gridBox.bottom + 1,
      chargesOverflow: getComputedStyle(charges).overflowY,
      railOverflow: getComputedStyle(rail).overflowY,
      chargesCanScroll: charges.scrollHeight > charges.clientHeight,
      railCanScroll: rail.scrollHeight > rail.clientHeight,
    };
  });

  expect(geometry).toEqual({
    shellFits: true,
    tabRows: 1,
    tabsFitHorizontally: true,
    panesShareRow: true,
    gridVisibleAndFitsMain: true,
    chargesVisibleAndFitsGrid: true,
    railVisibleAndFitsGrid: true,
    chargesOverflow: "auto",
    railOverflow: "auto",
    chargesCanScroll: true,
    railCanScroll: true,
  });

  const railReachedBottom = await page.locator('[data-testid="business-order-right-rail"]').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return Math.abs(node.scrollTop + node.clientHeight - node.scrollHeight) <= 1;
  });
  expect(railReachedBottom).toBe(true);

  await page.locator('[data-testid="app-shell"] main').evaluate((node) => { node.scrollTop = 300; });
  await page.getByRole("tab", { name: "历史记录" }).click();
  await expect(page.locator("#business-order-history-workspace")).toBeVisible();
  await expect.poll(() => page.locator('[data-testid="app-shell"] main').evaluate((node) => node.scrollTop)).toBe(0);
});

test("long charges and a long history remain reachable through their own desktop scroll panes", async ({ page }) => {
  const fixture = await installFixture(page, { chargeCount: 60, auditCount: 80 });
  fixture.setRound({ state: "return_pending_review", draft: 0 });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/orders/business/7?tab=operations");
  await page.getByRole("button", { name: "收付款历史" }).click();
  const operationsGeometry = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("#business-order-operations-workspace")?.parentElement;
    const charges = document.querySelector<HTMLElement>("#business-order-operations-workspace");
    const rail = document.querySelector<HTMLElement>('[data-testid="business-order-right-rail"]');
    if (!grid || !charges || !rail) throw new Error("operations panes are missing");
    return {
      chargesCanScroll: charges.scrollHeight > charges.clientHeight,
      chargesBottomFitsGrid: charges.getBoundingClientRect().bottom <= grid.getBoundingClientRect().bottom + 1,
      chargesBottomFitsViewport: charges.getBoundingClientRect().bottom <= window.innerHeight + 1,
      railCanScroll: rail.scrollHeight > rail.clientHeight,
    };
  });
  expect(operationsGeometry).toEqual({ chargesCanScroll: true, chargesBottomFitsGrid: true, chargesBottomFitsViewport: true, railCanScroll: true });

  await page.getByRole("tab", { name: "历史" }).click();
  await expect(page.locator("#business-order-history-workspace")).toBeVisible();
  await expect(page.locator("#business-order-history-workspace li")).toHaveCount(80);
  const historyGeometry = await page.locator("#business-order-history-workspace").evaluate((node) => ({
    canScroll: node.scrollHeight > node.clientHeight,
    bottomFitsViewport: node.getBoundingClientRect().bottom <= window.innerHeight + 1,
  }));
  expect(historyGeometry).toEqual({ canScroll: true, bottomFitsViewport: true });
});
