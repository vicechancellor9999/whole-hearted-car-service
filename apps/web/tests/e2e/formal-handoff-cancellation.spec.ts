import { expect, test, type Page } from "@playwright/test";
import { usePerformanceIdentity } from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

const activeHandoff = {
  id: 88,
  handoffNo: 1,
  performanceMinor: 150_000,
  jamaicaMonth: "2026-08-01",
  handedOffAt: "2026-08-27T14:00:00.000Z",
  cancelledAt: null,
};

function businessOrderDetail(canWrite: boolean, cancelled = false) {
  return {
    order: {
      id: 7,
      orderNo: "BO-000007",
      vehicleId: 12,
      payer: {
        type: "person",
        displayName: "测试客户",
        phone: "8765550100",
        trn: null,
        contactName: null,
      },
      vehicle: { plate: "1234 AB", description: "Toyota Vitz", vin: null },
      status: cancelled ? "return_pending_review" : "formally_handed_off",
      currentChargeVersionNo: 1,
      createdAt: "2026-08-26T12:00:00.000Z",
      voided: false,
      voidReason: null,
      version: cancelled ? 5 : 4,
    },
    charges: {
      id: 30,
      businessOrderId: 7,
      versionNo: 1,
      reason: "初始收费",
      totals: {
        grossMinor: 150_000,
        lineDiscountMinor: 0,
        laborDiscountMinor: 0,
        partDiscountMinor: 0,
        otherDiscountMinor: 0,
        categoryDiscountMinor: 0,
        wholeOrderDiscountMinor: 0,
        totalDueMinor: 150_000,
        includedGctMinor: 19_565,
      },
      items: [],
      notes: [],
      businessOrderVersion: cancelled ? 5 : 4,
    },
    ledger: {
      businessOrderId: 7,
      currentDueMinor: 150_000,
      totalPaidMinor: 0,
      totalRefundedMinor: 0,
      balanceMinor: 150_000,
      transactions: [],
    },
    refunds: [],
    documents: [],
    paymentMethods: [],
    chargeUnits: [],
    capabilities: { canWrite, canRecordPayment: false, canRefund: false },
  };
}

function repairRoundWorkspace(cancelled = false) {
  const current = {
    id: 21,
    businessOrderId: 7,
    roundNo: 1,
    source: "initial",
    afterSalesIssue: null,
    status: cancelled ? "return_pending_review" : "formally_handed_off",
    assignedTeamId: 3,
    intakeMileageKm: 123_456,
    intakePhotoFileIds: [],
    latestWorkReturnId: 31,
    approvedWorkReturnId: 31,
    version: cancelled ? 6 : 5,
  };

  return {
    current,
    auditTrail: [],
    history: [{
      ...current,
      createdAt: "2026-08-26T12:00:00.000Z",
      createdBy: 2,
      updatedAt: "2026-08-27T14:00:00.000Z",
      events: [],
      formalHandoffs: [{
        ...activeHandoff,
        cancelledAt: cancelled ? "2026-08-27T15:00:00.000Z" : null,
      }],
    }],
    result: cancelled ? { formalHandoffId: 88, cancelled: true } : undefined,
  };
}

async function installFormalFixtures(
  page: Page,
  options: {
    canWrite?: boolean;
    cancellation?: "success" | "failure";
    waitForCancellation?: Promise<void>;
    onCancellationStarted?: () => void;
  } = {},
) {
  let cancelled = false;
  let detailReads = 0;
  let roundReads = 0;
  let cancellationWrites = 0;
  let cancellationBody: unknown = null;

  await page.route("**/api/formal/business-orders/7/rounds", async (route) => {
    if (route.request().method() === "POST") {
      const requestBody = route.request().postDataJSON() as { action?: unknown };
      if (requestBody.action !== "cancel_formal_handoff") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "unexpected round action in cancellation fixture" }),
        });
        return;
      }
      cancellationWrites += 1;
      cancellationBody = requestBody;
      options.onCancellationStarted?.();
      await options.waitForCancellation;
      if (options.cancellation === "failure") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "不在同一 Jamaica 月份" }),
        });
        return;
      }
      cancelled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(repairRoundWorkspace(true)),
      });
      return;
    }

    roundReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(repairRoundWorkspace(cancelled)),
    });
  });
  await page.route("**/api/formal/business-orders/7", async (route) => {
    detailReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(businessOrderDetail(options.canWrite ?? true, cancelled)),
    });
  });
  await page.route("**/api/formal/master-data", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      dictionaries: [],
      teams: [{ id: 3, teamNo: "TEAM-003", name: "A 组", isActive: true, version: 1 }],
      staff: [],
      payrollParameters: [],
    }),
  }));
  await page.route("**/api/formal/inspection-reports*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], page: 1, pageSize: 20, pageCount: 0, total: 0 }),
  }));

  return {
    detailReads: () => detailReads,
    roundReads: () => roundReads,
    cancellationWrites: () => cancellationWrites,
    cancellationBody: () => cancellationBody,
  };
}

test("只读账号看不到取消交单和售后回厂写入口", async ({ page }) => {
  await installFormalFixtures(page, { canWrite: false });
  await page.goto("/orders/business/7");

  await expect(page.getByRole("heading", { name: "本轮维修已经正式交单" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消本次正式交单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "售后回厂" })).toHaveCount(0);
});

test("取消交单失败后保留已输入原因和打开的表单", async ({ page }) => {
  const requests = await installFormalFixtures(page, { cancellation: "failure" });
  await page.goto("/orders/business/7");

  const trigger = page.getByRole("button", { name: "取消本次正式交单" });
  await trigger.click();
  const form = page.getByRole("form", { name: "同月取消正式交单" });
  const reason = form.getByRole("textbox", { name: "取消原因" });
  const submit = form.getByRole("button", { name: "确认取消正式交单" });

  await reason.fill("   ");
  await expect(submit).toBeDisabled();
  await reason.fill("  绩效值需重新核对  ");
  await submit.click();

  await expect(page.locator('p[role="alert"]')).toContainText("不在同一 Jamaica 月份");
  await expect(form).toBeVisible();
  await expect(reason).toHaveValue("  绩效值需重新核对  ");
  expect(requests.cancellationWrites()).toBe(1);
  expect(requests.cancellationBody()).toEqual({
    action: "cancel_formal_handoff",
    formalHandoffId: 88,
    reason: "绩效值需重新核对",
  });
});

test("轮次 fixture 拒绝非取消交单 action 且不误计取消请求", async ({ page }) => {
  const requests = await installFormalFixtures(page);
  await page.goto("/orders/business/7");

  const response = await page.evaluate(async () => {
    const result = await fetch("/api/formal/business-orders/7/rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start_after_sales" }),
    });
    return { status: result.status, body: await result.json() as unknown };
  });

  expect(response).toEqual({
    status: 400,
    body: { error: "unexpected round action in cancellation fixture" },
  });
  expect(requests.cancellationWrites()).toBe(0);
});

test("取消交单成功时阻止重复提交、关闭表单并刷新正式详情", async ({ page }) => {
  let releaseCancellation!: () => void;
  let markCancellationStarted!: () => void;
  const waitForCancellation = new Promise<void>((resolve) => { releaseCancellation = resolve; });
  const cancellationStarted = new Promise<void>((resolve) => { markCancellationStarted = resolve; });
  const requests = await installFormalFixtures(page, {
    cancellation: "success",
    waitForCancellation,
    onCancellationStarted: markCancellationStarted,
  });
  await page.goto("/orders/business/7");

  const currentRoundSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "第 1 轮维修", exact: true }),
  });
  await expect(currentRoundSection).toHaveCount(1);
  await expect(currentRoundSection.getByText("已交单", { exact: true })).toBeVisible();
  await expect(currentRoundSection.getByText("回单待审核", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "取消本次正式交单" }).click();
  const form = page.getByRole("form", { name: "同月取消正式交单" });
  await form.getByRole("textbox", { name: "取消原因" }).fill("绩效值需重新核对");
  const submit = form.locator('button[type="submit"]');
  await expect(submit).toHaveText("确认取消正式交单");
  await submit.click();
  await cancellationStarted;

  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText("正在取消…");
  await form.evaluate((node) => node.dispatchEvent(new Event("submit", {
    bubbles: true,
    cancelable: true,
  })));
  expect(requests.cancellationWrites()).toBe(1);

  releaseCancellation();
  await expect(page.getByRole("status")).toContainText("原交单事实仍保留");
  await expect(form).toHaveCount(0);
  await expect.poll(requests.detailReads).toBeGreaterThan(1);
  await expect.poll(requests.roundReads).toBeGreaterThan(1);
  await expect(currentRoundSection.getByText("回单待审核", { exact: true })).toBeVisible();
  await expect(currentRoundSection.getByText("已交单", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "本轮维修已经正式交单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "取消本次正式交单" })).toHaveCount(0);
  expect(requests.cancellationWrites()).toBe(1);
});
