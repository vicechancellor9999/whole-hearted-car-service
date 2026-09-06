import { expect, test, type Page } from "@playwright/test";
import { usePerformanceIdentity } from "./helpers/performance-session";
import type { FormalChargeSnapshot, FormalChargeUnit } from "../../src/lib/api/formal-business-orders";

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
      items: [] as FormalChargeSnapshot["items"],
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
    chargeUnits: [] as FormalChargeUnit[],
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

test("缺少问题描述上下文的旧详情负载显示问题描述标题和修改入口", async ({ page }) => {
  await installFormalFixtures(page);
  await page.goto("/orders/business/7");

  await expect(page.getByTestId("business-order-problem-context")).toBeVisible();
  await expect(page.getByTestId("business-order-problem-empty")).toContainText("问题描述");
  await expect(page.getByTestId("business-order-problem-empty").getByRole("button", { name: "修改问题描述" })).toBeVisible();
  await expect(page.getByTestId("business-order-problem-context")).not.toContainText("创建业务单时未填写问题描述");
});

test("编辑和输入回车不保存，明确点击保存才创建一个收费版本", async ({ page }) => {
  let chargeWrites = 0;
  await installFormalFixtures(page);
  const detailWithCharges = businessOrderDetail(true);
  detailWithCharges.charges.items = [{
    id: 41,
    kind: "labor",
    nameZh: "检查工时",
    nameEn: "Inspection labor",
    descriptionZh: null,
    descriptionEn: null,
    unitItemId: 1,
    quantity: "1.000",
    unitPriceMinor: 150_000,
    itemDiscountMinor: 0,
    subtotalMinor: 150_000,
    sortOrder: 1,
  }];
  detailWithCharges.chargeUnits = [{ id: 1, code: "hour", labelZh: "工时", labelEn: "Hour" }];
  await page.route("**/api/formal/business-orders/7", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(detailWithCharges),
  }));
  await page.route("**/api/formal/business-orders/7/charges", (route) => {
    chargeWrites += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(businessOrderDetail(true).charges),
    });
  });
  await page.goto("/orders/business/7");

  await page.getByRole("button", { name: "编辑收费项目" }).click();

  await expect(page.getByRole("button", { name: "保存收费项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消编辑" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(chargeWrites).toBe(0);

  const itemNameInput = page.getByRole("textbox", { name: "项目名称", exact: true }).first();
  const composingEnterPrevented = await itemNameInput.evaluate((input) => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(composingEnterPrevented).toBe(false);

  await itemNameInput.press("Enter");
  await page.waitForTimeout(150);
  expect(chargeWrites).toBe(0);
  await expect(page.getByRole("button", { name: "保存收费项目" })).toBeVisible();

  await page.getByRole("button", { name: "保存收费项目" }).click();
  await expect.poll(() => chargeWrites).toBe(1);
  await expect(page.getByRole("status")).toContainText("收费项目已保存为新版本");
});

test("收费行删空后在修改原因按回车也不会绕过禁用的保存按钮", async ({ page }) => {
  let chargeWrites = 0;
  await installFormalFixtures(page);
  const detailWithCharges = businessOrderDetail(true);
  detailWithCharges.charges.items = [{
    id: 41,
    kind: "labor",
    nameZh: "检查工时",
    nameEn: "Inspection labor",
    descriptionZh: null,
    descriptionEn: null,
    unitItemId: 1,
    quantity: "1.000",
    unitPriceMinor: 150_000,
    itemDiscountMinor: 0,
    subtotalMinor: 150_000,
    sortOrder: 1,
  }];
  detailWithCharges.chargeUnits = [{ id: 1, code: "hour", labelZh: "工时", labelEn: "Hour" }];
  await page.route("**/api/formal/business-orders/7", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(detailWithCharges),
  }));
  await page.route("**/api/formal/business-orders/7/charges", (route) => {
    chargeWrites += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(businessOrderDetail(true).charges),
    });
  });
  await page.goto("/orders/business/7");

  await page.getByRole("button", { name: "编辑收费项目" }).click();
  const chargeForm = page.locator("#charge-edit-form");
  await chargeForm.getByRole("button", { name: "删", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "保存收费项目" })).toBeDisabled();

  await chargeForm.getByRole("textbox", { name: "修改原因" }).press("Enter");
  await page.waitForTimeout(150);

  expect(chargeWrites).toBe(0);
  await expect(page.getByRole("button", { name: "保存收费项目" })).toBeDisabled();
});

test("收费编辑的单位和金额字段与项目名称首行顶部对齐", async ({ page }) => {
  await installFormalFixtures(page);
  const detailWithCharges = businessOrderDetail(true);
  detailWithCharges.charges.items = [{
    id: 41,
    kind: "labor",
    nameZh: "检查工时",
    nameEn: "Inspection labor",
    descriptionZh: "检查车辆",
    descriptionEn: "Inspect vehicle",
    unitItemId: 1,
    quantity: "1.000",
    unitPriceMinor: 150_000,
    itemDiscountMinor: 0,
    subtotalMinor: 150_000,
    sortOrder: 1,
  }];
  detailWithCharges.chargeUnits = [{ id: 1, code: "hour", labelZh: "工时", labelEn: "Hour" }];
  await page.route("**/api/formal/business-orders/7", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(detailWithCharges),
  }));
  await page.goto("/orders/business/7");
  await page.getByRole("button", { name: "编辑收费项目" }).click();

  const labelTops = await page.locator("#charge-edit-form").evaluate((form) => {
    const labelTop = (selector: string) => {
      const field = form.querySelector<HTMLElement>(selector);
      const label = field?.closest("label");
      if (!label) throw new Error(`Missing label for ${selector}`);
      return label.getBoundingClientRect().top;
    };
    return {
      item: labelTop('input[aria-label="项目名称"]'),
      unit: labelTop('select[aria-label="单位"]'),
      quantity: labelTop('input[aria-label="数量"]'),
      unitPrice: labelTop('input[aria-label="含税单价"]'),
      itemDiscount: labelTop('input[aria-label="本项折扣"]'),
    };
  });

  expect(labelTops.unit).toBeCloseTo(labelTops.item, 0);
  expect(labelTops.quantity).toBeCloseTo(labelTops.item, 0);
  expect(labelTops.unitPrice).toBeCloseTo(labelTops.item, 0);
  expect(labelTops.itemDiscount).toBeCloseTo(labelTops.item, 0);
});

test("只有本轮问题时仍可修改整单问题并查看版本历史", async ({ page }) => {
  await installFormalFixtures(page);
  await page.route("**/api/formal/business-orders/7", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ...businessOrderDetail(true),
      problemDescriptions: {
        original: {
          contentZh: null,
          contentEn: null,
          sourceType: "creation",
          sourceReferenceId: null,
          confirmedBy: 2,
          confirmedByName: "测试管理员",
          confirmedAt: "2026-08-26T12:00:00.000Z",
        },
        current: null,
        businessOrderHistory: [],
        currentRound: {
          id: 93,
          versionNo: 1,
          contentZh: "本轮检查发动机异响",
          contentEn: "Inspect engine noise this round",
          sourceType: "manual",
          sourceReferenceId: null,
          changeReason: "补充返修范围",
          createdBy: 2,
          createdByName: "测试管理员",
          createdAt: "2026-08-27T12:00:00.000Z",
          repairRoundId: 21,
          roundNo: 1,
        },
        currentRoundHistory: [],
      },
    }),
  }));
  await page.goto("/orders/business/7");

  await expect(page.getByTestId("repair-round-current-problem")).toContainText("本轮检查发动机异响");
  await expect(page.getByRole("button", { name: "修改整单问题描述" })).toBeVisible();
  await page.getByRole("button", { name: "查看问题历史" }).click();
  await expect(page.getByRole("heading", { name: "原始内容与版本历史" })).toBeVisible();
});

test("English Business Order localizes all four workspaces and action cards", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_language_v1", "en"));
  await installFormalFixtures(page);
  await page.route("**/api/formal/business-orders/7/attachments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.route("**/api/formal/business-orders/7/messages", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], page: 1, pageSize: 50, pageCount: 0, total: 0 }),
  }));
  await page.route("**/api/formal/me/mentionable-accounts", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([]),
  }));
  await page.route("**/api/formal/business-orders/7/messages/read", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  }));

  await page.goto("/orders/business/7?tab=operations");
  await expect(page.getByRole("tab", { name: "Business Order details" })).toBeVisible();
  await expect(page.locator("#business-order-operations-workspace")).not.toContainText(/[\p{Script=Han}]/u);
  await expect(page.locator("#business-order-repair-workspace")).not.toContainText(/[\p{Script=Han}]/u);
  await expect(page.locator("#business-order-finance-workspace")).not.toContainText(/[\p{Script=Han}]/u);

  await page.getByRole("tab", { name: "Documents · Preview · Print" }).click();
  await expect(page.locator("#business-order-documents-workspace")).toContainText("Documents, preview and print");
  await expect(page.locator("#business-order-documents-workspace")).not.toContainText(/[\p{Script=Han}]/u);

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#business-order-history-workspace")).toContainText("No history to display");
  await expect(page.locator("#business-order-history-workspace")).not.toContainText(/[\p{Script=Han}]/u);

  await page.getByRole("tab", { name: "Comments" }).click();
  await expect(page.locator("#business-order-messages-workspace")).toContainText("Comments");
  await expect(page.locator("#business-order-messages-workspace")).not.toContainText(/[\p{Script=Han}]/u);
});

test("业务单右栏的四个金额卡片在桌面窄栏内不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1792, height: 1000 });
  await installFormalFixtures(page);
  await page.route("**/api/formal/business-orders/7", (route) => {
    const detail = businessOrderDetail(true);
    detail.ledger = {
      ...detail.ledger,
      currentDueMinor: 5_920_000,
      totalPaidMinor: 2_470_000,
      totalRefundedMinor: 1_000_000,
      balanceMinor: 4_450_000,
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail),
    });
  });
  await page.goto("/orders/business/7?tab=operations");

  const summary = page.locator("#business-order-finance-workspace > div.mt-3.grid");
  const cards = summary.locator(":scope > span");
  await expect(cards).toHaveCount(4);
  const overflow = await summary.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  const cardWidths = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(cardWidths.every((width) => width >= 180)).toBe(true);
});

test("三联文件列表和预览区始终伸展到桌面工作区底部", async ({ page }) => {
  await page.setViewportSize({ width: 1625, height: 1000 });
  await installFormalFixtures(page);
  await page.goto("/orders/business/7?tab=documents");

  for (const height of [1000, 1200]) {
    await page.setViewportSize({ width: 1625, height });
    const bounds = await page.locator("#business-order-documents-workspace").evaluate((panel) => {
      const browser = panel.querySelector<HTMLElement>(":scope > div > section > div.mt-3.grid");
      if (!browser) throw new Error("Missing document browser");
      return {
        panelBottom: panel.getBoundingClientRect().bottom,
        browserBottom: browser.getBoundingClientRect().bottom,
        panelPaddingBottom: Number.parseFloat(getComputedStyle(panel).paddingBottom),
      };
    });

    expect(Math.abs(bounds.panelBottom - bounds.panelPaddingBottom - bounds.browserBottom)).toBeLessThanOrEqual(1);
  }
});

test("业务附件使用紧凑横向卡片避免图片撑高列表", async ({ page }) => {
  await page.setViewportSize({ width: 1625, height: 1000 });
  await installFormalFixtures(page);
  await page.route("**/api/formal/business-orders/7/attachments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: [1, 2].map((id) => ({
        id,
        businessOrderId: 7,
        fileId: 100 + id,
        category: "customer_signature",
        caption: null,
        messageId: null,
        originalName: `${id}-very-long-customer-signature-file-name.png`,
        mediaType: "image/png",
        sizeBytes: 10_240,
        uploaderAccountId: 2,
        uploaderDisplayName: "测试管理员",
        linkedAt: "2026-08-28T11:00:00.000Z",
      })),
    }),
  }));
  await page.goto("/orders/business/7?tab=attachments");

  const cards = page.locator('#business-order-attachments-workspace a[href*="/attachments/"]');
  await expect(cards).toHaveCount(2);
  const measurements = await cards.evaluateAll((nodes) => nodes.map((node) => ({
    cardWidth: node.getBoundingClientRect().width,
    cardHeight: node.getBoundingClientRect().height,
    imageHeight: node.querySelector("img")?.getBoundingClientRect().height ?? 0,
    descriptionWidth: node.lastElementChild?.getBoundingClientRect().width ?? 0,
  })));

  expect(measurements.every(({ cardWidth, cardHeight, imageHeight, descriptionWidth }) => (
    cardWidth <= 282
    && cardHeight <= 100
    && imageHeight <= 100
    && descriptionWidth <= 168
  ))).toBe(true);
});

test("业务附件可调用标准摄像头或高拍仪并安全关闭取景", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          sessionStorage.setItem("business-order-camera-constraints", JSON.stringify(constraints));
          return new MediaStream();
        },
      },
    });
  });
  await installFormalFixtures(page);
  await page.route("**/api/formal/business-orders/7/attachments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.goto("/orders/business/7?tab=attachments");

  await page.getByTestId("business-order-camera-open").click();
  await expect(page.getByTestId("business-order-camera-preview")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("business-order-camera-constraints") ?? "null"))).toEqual({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    },
  });
  await page.getByTestId("business-order-camera-close").click();
  await expect(page.getByTestId("business-order-camera-preview")).toHaveCount(0);
  await expect(page.getByTestId("business-order-camera-open")).toBeVisible();
});

test("业务单详情在舒适暗色下使用渐进式应用层级", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme", "dark");
    localStorage.setItem("wh_theme_source", "user");
  });
  await installFormalFixtures(page);
  await page.goto("/orders/business/7?tab=operations");

  await expect(page.locator("html")).toHaveClass(/dark/);
  const surfaces = await page.evaluate(() => {
    const read = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`missing ${selector}`);
      const style = getComputedStyle(node);
      return { backgroundColor: style.backgroundColor, color: style.color, colorScheme: style.colorScheme };
    };
    return {
      page: read('[data-testid="formal-business-order-detail"]'),
      title: read('[data-testid="formal-business-order-detail"] h1'),
      tabs: read('nav[aria-label="Business Order 工作区"]'),
      operations: read("#business-order-operations-workspace"),
      repair: read("#business-order-repair-workspace"),
      finance: read("#business-order-finance-workspace"),
    };
  });

  expect(surfaces.page.backgroundColor).toBe("rgb(43, 48, 55)");
  expect(surfaces.page.colorScheme).toBe("dark");
  expect(surfaces.title.color).toBe("rgb(245, 247, 250)");
  expect(surfaces.tabs.backgroundColor).toBe("rgb(58, 66, 76)");
  expect(surfaces.operations.backgroundColor).toBe("rgb(58, 66, 76)");
  expect(surfaces.repair.backgroundColor).toBe("rgb(58, 66, 76)");
  expect(surfaces.finance.backgroundColor).toBe("rgb(58, 66, 76)");
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

  await expect(
    page.getByRole("alert").filter({ hasText: "不在同一 Jamaica 月份" }),
  ).toBeVisible();
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
