import { expect, test, type Page } from "@playwright/test";
import {
  assertNoPerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function installMutationUuidCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const captured: string[] = [];
    let sequence = 0;
    Object.defineProperty(window, "__IR_MUTATION_UUIDS__", { value: captured, configurable: true });
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => {
        sequence += 1;
        const value = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
        captured.push(value);
        return value;
      },
    });
  });
}

async function resetMutationUuidCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__?.splice(0);
  });
}

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("列表只显示五个客户沟通筛选并支持整行键盘进入详情", async ({ page }) => {
  await page.goto("/orders/inspections");
  await expect(page.getByRole("heading", { level: 1, name: "检查结果" })).toBeVisible();
  await expect(page.getByTestId("ir-bucket-not_notified")).toContainText("尚未通知客户");
  await expect(page.getByTestId("ir-bucket-awaiting_reply")).toContainText("已通知、等待回复");
  await expect(page.getByTestId("ir-bucket-closed")).toContainText("已闭环");
  await expect(page.getByTestId("ir-bucket-interested")).toContainText("有意向客户");
  await expect(page.getByTestId("ir-bucket-not_interested")).toContainText("没意向客户");
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(3);
  const filterButtons = page.getByTestId("ir-bucket-chips").getByRole("button");
  await expect(filterButtons).toHaveCount(5);
  expect(await filterButtons.allTextContents()).toEqual([
    "尚未通知客户 3",
    "已通知、等待回复 0",
    "已闭环 0",
    "有意向客户 0",
    "没意向客户 0",
  ]);
  expect(await filterButtons.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height).every((height) => height >= 44))).toBe(true);
  await expect(page.getByTestId("ir-bucket-awaiting_creation")).toHaveCount(0);
  await expect(page.getByTestId("ir-bucket-awaiting_finalization")).toHaveCount(0);
  await expect(page.getByTestId("ir-bucket-awaiting_send")).toHaveCount(0);
  await expect(page.getByTestId("business-order-row")).toHaveCount(0);
  await expect(page.getByTestId("invoice-row")).toHaveCount(0);
  await expect(page.getByTestId("ir-bucket-not_notified")).toContainText("3");
  const detailLink = page.getByTestId("ir-detail-link-inspection-report-demo-01");
  await expect(detailLink).toBeVisible();
  const row = page.getByTestId("inspection-report-row").filter({ has: detailLink });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/orders\/inspections\/inspection-report-demo-01$/, { timeout: 10_000 });
  await expect(page.getByTestId("ir-detail-page")).toBeVisible({ timeout: 10_000 });
});

test("列表读完 401+ 份后再计算五桶和搜索，后页迟到不跨身份追加", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await page.evaluate(() => {
    const key = "wh_linked_operations_state_v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "null");
    const sourceReport = state.inspectionReports.find((item: { id: string }) => item.id === "inspection-report-demo-01");
    const sourceItem = state.inspectionItems.find((item: { id: string }) => item.id === sourceReport.itemIds[0]);
    const sourceQuotation = state.currentQuotations.find((item: { id: string }) => item.id === sourceReport.quotationId);
    const sourceLines = sourceQuotation.lineIds.map((id: string) => state.quotedChargeLines.find((item: { id: string }) => item.id === id));
    const sourceDocument = state.operationsDocuments.find((item: { id: string }) => item.id === sourceReport.id);
    const sourceAssignment = state.operationsAssignments.find((item: { documentId: string }) => item.documentId === sourceReport.id);
    for (let index = 1; index <= 401; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const reportId = `inspection-report-task7-page-${suffix}`;
      const itemId = `${reportId}-item-1`;
      const quotationId = `${reportId}-quotation`;
      const lineIds = sourceLines.map((_line: unknown, lineIndex: number) => `${quotationId}-line-${lineIndex + 1}`);
      state.inspectionReports.push({
        ...structuredClone(sourceReport),
        id: reportId,
        inspectionReportNo: index === 401 ? "TASK7-PAGINATION-SENTINEL-401" : `TASK7-PAGE-${suffix}`,
        submissionId: `${reportId}-submission`,
        inspectorId: index === 401 ? "task7-last-inspector" : sourceReport.inspectorId,
        inspectorName: index === 401 ? "Task7 Last Page Inspector" : sourceReport.inspectorName,
        inspectorTeamId: index === 401 ? "t2" : "t1",
        photoIds: [],
        itemIds: [itemId],
        quotationId,
      });
      state.inspectionItems.push({ ...structuredClone(sourceItem), id: itemId, inspectionReportId: reportId });
      state.currentQuotations.push({
        ...structuredClone(sourceQuotation),
        id: quotationId,
        quotationNo: `TASK7-QT-${suffix}`,
        inspectionReportId: reportId,
        lineIds,
        generationCounter: 0,
        lastGeneratedAt: null,
        generatedFromRevision: null,
        activeGeneratedBundle: null,
      });
      sourceLines.forEach((line: Record<string, unknown>, lineIndex: number) => state.quotedChargeLines.push({
        ...structuredClone(line),
        id: lineIds[lineIndex],
        sourceId: itemId,
      }));
      state.operationsDocuments.push({ ...structuredClone(sourceDocument), id: reportId });
      state.operationsAssignments.push({
        ...structuredClone(sourceAssignment),
        id: `assignment-${reportId}`,
        documentId: reportId,
        firstAssignedTeamId: index === 401 ? "t2" : "t1",
        teamId: index === 401 ? "t2" : "t1",
        sourceInspection: {
          ...structuredClone(sourceAssignment.sourceInspection),
          submissionId: `${reportId}-submission`,
          inspectionReportNo: index === 401 ? "TASK7-PAGINATION-SENTINEL-401" : `TASK7-PAGE-${suffix}`,
          inspectorId: index === 401 ? "task7-last-inspector" : sourceReport.inspectorId,
          inspectorName: index === 401 ? "Task7 Last Page Inspector" : sourceReport.inspectorName,
          inspectorTeamId: index === 401 ? "t2" : "t1",
        },
      });
    }
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await page.goto("/orders/inspections/inspection-report-task7-page-401");
  await expect(page.getByTestId("ir-detail-page")).toContainText("TASK7-PAGINATION-SENTINEL-401");
  await page.getByRole("radio", { name: "有意向" }).check();
  await page.getByTestId("ir-response-note").fill("末页唯一闭环 sentinel");
  await page.getByTestId("ir-response-save").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("客户回复已追加");

  await page.getByTestId("ir-detail-back").click();
  await expect(page.getByTestId("inspection-reports-count")).toContainText("404 份检查结果", { timeout: 10_000 });
  await expect(page.getByTestId("ir-bucket-not_notified")).toContainText("403");
  await expect(page.getByTestId("ir-bucket-closed")).toContainText("1");
  await expect(page.getByTestId("ir-bucket-interested")).toContainText("1");
  await page.getByTestId("ir-bucket-interested").click();
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(1);
  await expect(page.getByTestId("inspection-report-row")).toContainText("TASK7-PAGINATION-SENTINEL-401");
  await page.getByTestId("inspection-reports-search").fill("PAGINATION-SENTINEL-401");
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(1);
  await expect(page.getByTestId("inspection-report-row")).toContainText("Task7 Last Page Inspector");

  await page.addInitScript(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      delayMs: { byAction: { "inspection.list.read:2": 1_200 } },
    };
  });
  await page.reload();
  await expect(page.getByTestId("inspection-reports-loading")).toBeVisible();
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: { id: "emp-004", name: "张伟", role: "parts" },
      token: "offline-emp-004",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/orders/inspections?identity=parts");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText(/无权访问该业务资源/)).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1_300);
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(0);
  await expect(page.getByText("TASK7-PAGINATION-SENTINEL-401", { exact: false })).toHaveCount(0);
});

test("详情恢复包含报告、客户和车辆身份的英雄区", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  const hero = page.getByTestId("ir-detail-hero");
  await expect(hero).toContainText("Inspection Report");
  await expect(hero).toContainText("KGN-WH-IR-2026080919422");
  await expect(hero).toContainText("8765 JZ");
  await expect(hero).toContainText("丰田海狮");
  await expect(hero).toContainText("陈美玲");
  await expect(hero).toContainText("KGN-WH-QT-2026080919422");
  await expect(hero).toContainText("客户文件：尚未生成");
  await expect(hero).toContainText("事实 V1");
  // 与业务单英雄区共用浅色系统语义，不能在整页浅色界面里插入一块近黑主题。
  await expect(hero).toHaveClass(/from-primary-50/);
  await expect(hero).toHaveClass(/to-blue-50/);
  expect(await hero.evaluate((node) => getComputedStyle(node).color)).not.toBe("rgb(255, 255, 255)");
});

test("详情状态是恰好三个方块，430px 整页不横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const chain = page.getByTestId("status-arrow-chain");
  await expect(chain).toBeVisible();
  await expect(page.getByTestId("fishbone-status")).toHaveCount(0);
  const squares = chain.locator('[data-shape="square"]');
  await expect(squares).toHaveCount(3);
  await expect(chain.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(chain.locator('[aria-current="step"]')).toContainText("尚未通知客户");
  await expect(chain).toContainText("尚未通知客户");
  await expect(chain).toContainText("已通知，等待回复");
  await expect(chain).toContainText("客户已回复，闭环");
  await expect(chain).toContainText("尚无成功正式通知");
  await expect(chain).not.toContainText("维修工提交");
  await expect(chain).not.toContainText("AI 整理");
  const geometry = await squares.evaluateAll((nodes) => nodes.map((node) => ({
    height: node.getBoundingClientRect().height,
    borderRadius: getComputedStyle(node).borderRadius,
  })));
  expect(geometry.every((item) => item.height >= 48)).toBe(true);
  expect(geometry.every((item) => item.borderRadius !== "0px")).toBe(true);
  expect(await chain.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("详情显示发送客户与回应两个追加式模块", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("inspection-communications")).toBeVisible();
  await expect(page.getByTestId("ir-notification-panel")).toBeVisible();
  await expect(page.getByTestId("ir-response-panel")).toBeVisible();
  await expect(page.getByText("通知客户", { exact: true })).toBeVisible();
  await expect(page.getByText("客户回复", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ir-current-response")).toContainText("当前结论：待记录");
  await expect(page.getByTestId("ir-response-panel")).toContainText("本次要记录的分类");
});

test("通知草稿、WhatsApp 两步确认与控件尺寸遵守当前客户文件意图", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.defineProperty(window, "__IR_WHATSAPP_URLS__", { value: opened, configurable: true });
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.goto("/orders/inspections/inspection-report-demo-02");
  await expect(page.getByTestId("ir-notification-send")).toBeDisabled();
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("V1", { timeout: 10_000 });

  const message = page.getByTestId("ir-notification-message");
  await expect(message).toContainText("日产奇骏");
  await expect(message).toContainText("请回复");
  await expect(message).toContainText("Whole Hearted Car Service");
  await expect(message).not.toContainText("24 小时");
  await expect(page.getByTestId("ir-response-panel")).toContainText("由前台手工记录");

  await page.getByTestId("ir-notification-channel").selectOption("email");
  await page.getByTestId("ir-notification-language").selectOption("en");
  const deliveryFacts = page.getByTestId("ir-notification-delivery-facts");
  await expect(deliveryFacts).toContainText("模拟邮件");
  await expect(deliveryFacts).toContainText("附件");
  await expect(deliveryFacts).toContainText("KGN-WH-IR-2026080919423-EN.pdf");
  await expect(deliveryFacts).toContainText("bulk2@synthetic.example");
  await page.getByTestId("ir-notification-channel").selectOption("sms");
  await page.getByTestId("ir-notification-language").selectOption("zh");
  await expect(deliveryFacts).toContainText("演示链接");
  await expect(deliveryFacts).toContainText("https://demo.wholehearted.example/");
  const disclosedDemoUrl = (await deliveryFacts.textContent())?.match(/https:\/\/[^。\s]+/u)?.[0];
  expect(disclosedDemoUrl).toBeTruthy();
  expect(new URL(disclosedDemoUrl!).hostname).not.toMatch(/localhost|127\.0\.0\.1/);

  await message.fill("客户自定义通知，不得被同报告刷新覆盖。\n请回复。\nWhole Hearted Car Service Ltd.");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("V2", { timeout: 10_000 });
  await expect(message).toHaveValue("客户自定义通知，不得被同报告刷新覆盖。\n请回复。\nWhole Hearted Car Service Ltd.");
  await page.getByTestId("ir-notification-channel").selectOption("email");
  await page.getByTestId("ir-notification-language").selectOption("bilingual");
  await expect(deliveryFacts).toContainText("V2");
  await expect(deliveryFacts).toContainText("KGN-WH-IR-2026080919423-BI.pdf");

  await page.getByTestId("ir-notification-channel").selectOption("whatsapp");
  await page.getByTestId("ir-whatsapp-open").click();
  await expect(page.getByTestId("ir-whatsapp-confirm")).toBeEnabled();
  const firstUrl = await page.evaluate(() => (window as typeof window & { __IR_WHATSAPP_URLS__: string[] }).__IR_WHATSAPP_URLS__.at(-1));
  const firstWhatsAppText = new URL(firstUrl!).searchParams.get("text") ?? "";
  expect(firstWhatsAppText).toContain("演示链接：https://demo.wholehearted.example/inspection-reports/inspection-report-demo-02/bilingual");
  expect(firstWhatsAppText).not.toMatch(/localhost|127\.0\.0\.1/);
  await message.fill("编辑后的 WhatsApp 文案\nhttps://demo.wholehearted.example/inspection-reports/inspection-report-demo-02/bilingual");
  await expect(page.getByTestId("ir-whatsapp-confirm")).toBeDisabled();
  await page.getByTestId("ir-whatsapp-open").click();
  await expect(page.getByTestId("ir-whatsapp-confirm")).toBeEnabled();
  const editedUrl = await page.evaluate(() => (window as typeof window & { __IR_WHATSAPP_URLS__: string[] }).__IR_WHATSAPP_URLS__.at(-1));
  const editedWhatsAppText = new URL(editedUrl!).searchParams.get("text") ?? "";
  expect(editedWhatsAppText).toContain("编辑后的 WhatsApp 文案");
  expect(editedWhatsAppText).toContain("演示链接 / Demo report link：https://demo.wholehearted.example/inspection-reports/inspection-report-demo-02/bilingual");
  expect(editedWhatsAppText.match(/https:\/\/demo\.wholehearted\.example\/inspection-reports\/inspection-report-demo-02\/bilingual/gu)).toHaveLength(1);
  for (const testId of ["ir-whatsapp-open", "ir-whatsapp-confirm"]) {
    const height = await page.getByTestId(testId).evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  }

  const quotationNote = page.getByTestId("quotation-note-zh");
  const savedQuotationNote = await quotationNote.inputValue();
  await quotationNote.fill(`${savedQuotationNote}\n尚未保存的报价修改`);
  const disabledReason = page.getByTestId("ir-notification-disabled-reason");
  await expect(disabledReason).toContainText("Quotation 有尚未保存的修改");
  await expect(page.getByTestId("ir-whatsapp-open")).toBeDisabled();
  await expect(page.getByTestId("ir-whatsapp-confirm")).toBeDisabled();
  await expect(page.getByTestId("ir-whatsapp-confirm")).toHaveAttribute("aria-describedby", "ir-notification-disabled-reason");
  await page.getByTestId("ir-notification-channel").selectOption("sms");
  await expect(page.getByTestId("ir-notification-send")).toBeDisabled();
  await expect(page.getByTestId("ir-notification-send")).toHaveAttribute("aria-describedby", "ir-notification-disabled-reason");
  await page.getByTestId("ir-notification-channel").selectOption("email");
  await expect(page.getByTestId("ir-notification-send")).toBeDisabled();
  await quotationNote.fill(savedQuotationNote);
  await expect(disabledReason).toHaveCount(0);
  await expect(page.getByTestId("ir-notification-send")).toBeEnabled();

  const responseSaveHeight = await page.getByTestId("ir-response-save").evaluate((node) => node.getBoundingClientRect().height);
  expect(responseSaveHeight).toBeGreaterThanOrEqual(44);
});

test("Email provider 失败与 SMS response-loss 都保留同一意图并且只追加一条事件", async ({ page }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await resetMutationUuidCapture(page);

  await page.getByTestId("ir-notification-channel").selectOption("email");
  await expect(page.getByTestId("ir-notification-target")).toContainText("bulk1@synthetic.example");
  const message = page.getByTestId("ir-notification-message");
  await message.fill("已核对 Email 通知草稿");
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.notification.provider": "Mock Email provider failed" } },
    };
  });
  const beforeEmail = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return { revision: state.revision, events: state.communicationEvents.length, receipts: state.mutationReceipts.length };
  });
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText(/失败|failed|provider/iu);
  await expect(message).toHaveValue("已核对 Email 通知草稿");
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return { revision: state.revision, events: state.communicationEvents.length, receipts: state.mutationReceipts.length };
  })).toEqual(beforeEmail);
  const emailIntent = await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])]);
  expect(emailIntent).toHaveLength(1);
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("Mock 邮件 provider 已接受并记录");
  expect(await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])])).toEqual(emailIntent);
  const emailHistory = page.getByTestId("ir-notification-history");
  await expect(emailHistory).toContainText("模拟邮件（mock_email）");
  await expect(emailHistory).toContainText("已接受（accepted）");
  await expect(emailHistory).toContainText("KGN-WH-IR-2026080919422-ZH.pdf");

  await resetMutationUuidCapture(page);
  await page.getByTestId("ir-notification-channel").selectOption("sms");
  await message.fill("SMS response-loss 同意图重试");
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.notification.send.response": "response lost after notification commit" } },
    };
  });
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText(/失败|response|lost/iu);
  await expect(message).toHaveValue("SMS response-loss 同意图重试");
  const smsIntent = await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])]);
  expect(smsIntent).toHaveLength(1);
  const committed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return {
      events: state.communicationEvents.filter((event: { message: string }) => event.message.includes("SMS response-loss 同意图重试")).length,
      receipts: state.mutationReceipts.filter((receipt: { mutationId: string }) => receipt.mutationId.includes((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__?.[0] ?? "missing")).length,
    };
  });
  expect(committed).toEqual({ events: 1, receipts: 1 });
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("已确认此前通知记录");
  expect(await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])])).toEqual(smsIntent);
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return state.communicationEvents.filter((event: { message: string }) => event.message.includes("SMS response-loss 同意图重试")).length;
  })).toBe(1);
});

test("stale 通知用同一 mutation intent 刷新摘要并保留输入待核对", async ({ page, context }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("V1", { timeout: 10_000 });
  const message = page.getByTestId("ir-notification-message");
  await message.fill("保留这份已核对通知内容");

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-01");
  await concurrent.getByRole("radio", { name: "有意向" }).check();
  await concurrent.getByTestId("ir-response-note").fill("并发客户回复");
  await concurrent.getByTestId("ir-response-save").click();
  await expect(concurrent.getByTestId("ir-communications-status")).toContainText("客户回复已追加");
  await concurrent.close();

  await resetMutationUuidCapture(page);
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.detail.read": "stale 后详情刷新演示失败" } },
    };
  });
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-stale-review")).toBeVisible();
  await expect(page.getByTestId("ir-communications-status")).toContainText("详情刷新失败");
  await expect(message).toHaveValue("保留这份已核对通知内容");
  const mutationIdsAfterStale = await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])]);
  expect(mutationIdsAfterStale).toHaveLength(1);
  await expect(page.getByTestId("ir-notification-send")).toBeDisabled();
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return state.communicationEvents.filter((event: { message: string }) => event.message.includes("保留这份")).length;
  })).toBe(0);
  await page.getByTestId("ir-stale-refresh").click();
  await expect(page.getByTestId("ir-stale-review-confirm")).toBeVisible();
  await page.getByTestId("ir-stale-review-confirm").click();
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText(/Mock 短信 provider 已接受并记录|已确认此前通知记录/);
  const mutationIdsAfterRetry = await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])]);
  expect(mutationIdsAfterRetry).toEqual(mutationIdsAfterStale);
});

test("stale 客户回复在详情刷新失败时仍显示服务端当前结论并以同意图重试", async ({ page, context }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-02");
  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-02");
  await concurrent.getByRole("radio", { name: "没意向" }).check();
  await concurrent.getByTestId("ir-response-note").fill("服务端最新结论 sentinel");
  await concurrent.getByTestId("ir-response-save").click();
  await expect(concurrent.getByTestId("ir-communications-status")).toContainText("客户回复已追加");
  const serverEventId = await concurrent.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return state.responseEvents.at(-1).id as string;
  });
  await concurrent.close();

  await page.getByRole("radio", { name: "有意向" }).check();
  const note = page.getByTestId("ir-response-note");
  await note.fill("主页保留的本次回复意图");
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.detail.read": "response stale 后刷新失败" } },
    };
  });
  await page.getByTestId("ir-response-save").click();
  const staleSummary = page.getByTestId("ir-response-stale-summary");
  await expect(staleSummary).toContainText("当前结论：没意向");
  await expect(staleSummary).toContainText(serverEventId);
  await expect(staleSummary).toContainText("服务端最新结论 sentinel");
  await expect(note).toHaveValue("主页保留的本次回复意图");
  await expect(page.getByTestId("ir-response-history")).not.toContainText(serverEventId);
  await expect(page.getByTestId("ir-response-save")).toBeDisabled();
  const intentIds = await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])]);
  expect(intentIds).toHaveLength(1);
  await page.getByTestId("ir-response-stale-review-confirm").click();
  await page.getByTestId("ir-response-save").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("客户回复已追加");
  expect(await page.evaluate(() => [...((window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [])])).toEqual(intentIds);
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return state.responseEvents.filter((event: { reportId: string }) => event.reportId === "inspection-report-demo-02").length;
  })).toBe(2);
});

test("正式通知与客户改口追加历史并驱动三态和五筛选，旧 followup key 不写", async ({ page }) => {
  test.slow(); // 真实穿越 IR、工作台、列表和车辆档案多个客户端路由。
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open;
  });
  await page.goto("/orders/inspections/inspection-report-demo-03");
  const legacyBefore = await page.evaluate(() => localStorage.getItem("wh_ir_followup_v1"));
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("V1", { timeout: 10_000 });
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("Mock 短信 provider 已接受并记录");
  await expect(page.getByTestId("status-arrow-chain").locator('[aria-current="step"]')).toContainText("已通知，等待回复");
  await expect(page.getByTestId("status-arrow-chain")).toContainText(/短信.*Jamaica/);
  await page.goto("/workbench");
  await expect(page.getByRole("link", { name: /尚未通知客户\s*2/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /已通知、等待回复\s*1/ })).toBeVisible();
  await page.goto("/orders/inspections/inspection-report-demo-03");

  await page.getByTestId("ir-notification-channel").selectOption("email");
  await page.getByTestId("ir-notification-subject").fill("车辆档案二次 Email");
  await page.getByTestId("ir-notification-message").fill("第二次 Email 通知，请回复。");
  await expect(page.getByTestId("ir-notification-delivery-facts")).toContainText("KGN-WH-IR-2026080919424-ZH.pdf");
  await page.getByTestId("ir-notification-send").click();
  await expect(page.getByTestId("ir-notification-history").locator("div.rounded-lg")).toHaveCount(2);
  await expect(page.getByTestId("ir-notification-history")).toContainText("https://demo.wholehearted.example/inspection-reports/inspection-report-demo-03/zh");

  await page.getByRole("radio", { name: "有意向" }).check();
  await page.getByTestId("ir-response-note").fill("客户计划安排后续维修");
  await page.getByTestId("ir-response-save").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("客户回复已追加");
  await expect(page.getByTestId("status-arrow-chain").locator('[aria-current="step"]')).toContainText("客户已回复，闭环");

  await page.getByRole("radio", { name: "没意向" }).check();
  await page.getByTestId("ir-response-note").fill("客户后来决定暂不维修");
  await page.getByTestId("ir-response-save").click();
  await expect(page.getByTestId("ir-response-history").locator("div.rounded-lg")).toHaveCount(2);
  await expect(page.getByTestId("ir-response-history")).toContainText("修订 ir-response-");

  const canonical = await page.evaluate(() => JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null"));
  const events = canonical.communicationEvents.filter((candidate: { reportId: string }) => candidate.reportId === "inspection-report-demo-03");
  expect(events.map((event: { channel: string }) => event.channel)).toEqual(["sms", "email"]);
  expect(events[0]).toMatchObject({ channel: "sms", language: "zh", providerResult: "accepted" });
  for (const event of events) {
    expect(event).not.toHaveProperty("bundleId");
    expect(event).not.toHaveProperty("generation");
    expect(event).not.toHaveProperty("attachmentId");
  }
  const responses = canonical.responseEvents.filter((candidate: { reportId: string }) => candidate.reportId === "inspection-report-demo-03");
  const detailNotificationIds = await page.getByTestId("ir-notification-history").locator("[data-event-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-event-id")));
  expect(detailNotificationIds).toEqual(events.map((event: { id: string }) => event.id).reverse());
  const detailResponseIds = await page.getByTestId("ir-response-history").locator("[data-event-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-event-id")));
  expect(detailResponseIds).toEqual(responses.map((event: { id: string }) => event.id).reverse());
  expect(await page.evaluate(() => localStorage.getItem("wh_ir_followup_v1"))).toBe(legacyBefore);

  const vehicleId = canonical.inspectionReports.find((candidate: { id: string }) => candidate.id === "inspection-report-demo-03").vehicleId;
  await page.goto(`/vehicles/${encodeURIComponent(vehicleId)}`);
  const archive = page.getByTestId("vehicle-section-inspection-report-history");
  await expect(archive).toBeVisible();
  await expect(archive).toContainText("KGN-WH-IR-2026080919424");
  await expect(archive).toContainText("前悬挂过减速带有异响");
  await expect(archive).toContainText("V1");
  await expect(archive).toContainText("短信");
  await expect(archive).toContainText("Email");
  await expect(archive).toContainText("车辆档案二次 Email");
  await expect(archive).toContainText("模拟邮件（mock_email）");
  await expect(archive).toContainText("已接受（accepted）");
  await expect(archive).toContainText("KGN-WH-IR-2026080919424-ZH.pdf");
  await expect(archive).toContainText("https://demo.wholehearted.example/inspection-reports/inspection-report-demo-03/zh");
  const archivedDemoUrls = await archive.locator('a[href^="https://demo.wholehearted.example/"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
  expect(archivedDemoUrls.length).toBeGreaterThan(0);
  expect(archivedDemoUrls.every((url) => !/localhost|127\.0\.0\.1/u.test(new URL(url).hostname))).toBe(true);
  await expect(archive).toContainText("没意向");
  const archivedNotificationIds = await archive.getByTestId("vehicle-ir-notification-history-inspection-report-demo-03").locator("[data-event-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-event-id")));
  expect(archivedNotificationIds).toEqual(events.map((event: { id: string }) => event.id));
  const archivedResponseIds = await archive.getByTestId("vehicle-ir-response-history-inspection-report-demo-03").locator("[data-event-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-event-id")));
  expect(archivedResponseIds).toEqual(responses.map((event: { id: string }) => event.id));
  await expect(archive).toContainText("客户计划安排后续维修");
  await expect(archive).toContainText("客户后来决定暂不维修");
  await expect(archive).toContainText(`修订 ${responses[0].id}`);
  await expect(archive).toContainText("现场照片 0");
  await expect(page.getByTestId("vehicle-section-photos")).not.toContainText("KGN-WH-IR-2026080919424");

  await page.goto("/workbench");
  await expect(page.getByRole("link", { name: /尚未通知客户\s*2/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /已通知、等待回复\s*0/ })).toBeVisible();

  await page.goto("/orders/inspections");
  await expect(page.getByTestId("ir-bucket-closed")).toContainText("1");
  await expect(page.getByTestId("ir-bucket-interested")).toContainText("0");
  await expect(page.getByTestId("ir-bucket-not_interested")).toContainText("1");
  await page.getByTestId("ir-bucket-not_interested").click();
  await expect(page.getByTestId("inspection-report-row")).toHaveCount(1);
  await expect(page.getByTestId("inspection-report-row")).toContainText("KGN-WH-IR-2026080919424");

  await page.goto("/orders/inspections/inspection-report-demo-03");
  await page.evaluate(() => {
    localStorage.setItem("wh_session", JSON.stringify({ identity: { id: "emp-002", name: "李美玲", role: "finance" }, token: "offline-emp-002", expiresAt: "2099-01-01T00:00:00.000Z" }));
    history.pushState({}, "", `${location.pathname}?identity=finance`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("ir-current-response")).toContainText("当前结论：没意向");
  await expect(page.getByTestId("ir-response-save")).toHaveCount(0);
});

test("工作台展示 IR 提醒卡片并跳转检查结果页", async ({ page }) => {
  await page.goto("/workbench");
  await expect(page.getByTestId("workbench-reminders")).toBeVisible();
  const irSection = page.getByTestId("workbench-reminders").getByText("检查结果").locator("..");
  await expect(irSection.getByText("尚未通知客户")).toBeVisible();
  await expect(irSection.getByText("已通知、等待回复")).toBeVisible();
  await expect(irSection.getByText("新建待审核报价")).toHaveCount(0);
  await expect(irSection.getByText("报价完成待发送")).toHaveCount(0);
  await expect(irSection.getByText("已发送待客户回复")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /尚未通知客户\s*3/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /已通知、等待回复\s*0/ })).toBeVisible();
});

test("只读身份可看列表但无操作入口，430px 无根横溢", async ({ page }) => {
  await usePerformanceIdentity(page, "finance");
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections");
  await expect(page.getByTestId("inspection-report-row").first()).toBeVisible();
  await expect(page.getByTestId("ir-create-open")).toHaveCount(0);
  await expect(page.locator('[data-testid^="ir-send-"]')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("财务可读同一当前 PDF 和沟通历史但所有 IR 写控件均不渲染", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await page.getByTestId("quotation-note-zh").fill("使 V1 过期但保留同一附件字节。");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("过期");
  const canonicalBundle = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return state.currentQuotations.find((quotation: { inspectionReportId: string }) => quotation.inspectionReportId === "inspection-report-demo-01").activeGeneratedBundle;
  });
  const english = canonicalBundle.attachments.find((attachment: { language: string }) => attachment.language === "en");
  await page.evaluate(() => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: { id: "emp-002", name: "李美玲", role: "finance" },
      token: "offline-emp-002",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", `${location.pathname}?identity=finance`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("ir-finance-readonly")).toBeVisible();
  await expect(page.getByTestId("inspection-communications")).toBeVisible();
  await expect(page.getByTestId("ir-communications-readonly")).toBeVisible();
  await expect(page.getByTestId("ir-detail-page")).toContainText("KGN-WH-QT-2026080919422");
  await expect(page.getByTestId("ir-detail-page")).toContainText("客户文件：V1");
  await expect(page.getByTestId("ir-pdf-section")).toBeVisible();
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("过期");
  await expect(page.getByTestId("ir-pdf-preview")).toBeEnabled();
  await expect(page.getByTestId("ir-pdf-download")).toBeEnabled();
  await page.getByTestId("ir-pdf-language").selectOption("en");
  await page.getByTestId("ir-pdf-preview").click();
  const active = page.getByTestId("ir-pdf-active-attachment");
  await expect(active).toHaveAttribute("data-attachment-id", english.id);
  await expect(active).toHaveAttribute("data-byte-length", String(english.byteLength));
  await expect(page.getByTestId("ir-pdf-canvas")).toBeVisible();
  for (const testId of [
    "ir-draft-input", "ir-photo-save", "quotation-save", "quotation-create-bo",
    "ir-pdf-generate", "ir-notification-send", "ir-whatsapp-confirm", "ir-response-save",
  ]) await expect(page.getByTestId(testId)).toHaveCount(0);
});

test("详情页只保留原文处理、独立照片、报价与客户文件，不再显示检查项目编辑区", async ({ page }) => {
  await page.goto("/orders/inspections");
  await page.locator('[data-testid="inspection-report-row"]').first().click();
  await expect(page).toHaveURL(/\/orders\/inspections\/inspection-report-demo-01$/);
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  // 维修工原文在「前台代录」输入框里（可改后重新拆分），不再单独展示
  await expect(page.getByTestId("ir-draft-raw")).toHaveValue(/检查原始记录/);
  await expect(page.getByTestId("inspection-approved-result")).toHaveCount(0);
  await expect(page.getByTestId("ir-inline-editor")).toHaveCount(0);
  await expect(page.getByTestId("inspection-quotation")).toBeVisible();
  await expect(page.getByTestId("ir-photo-section")).toBeVisible();
  await expect(page.getByTestId("ir-photo-thumb-0")).toHaveCount(0);
  await expect(page.getByTestId("ir-bo-section")).toHaveCount(0);
  await expect(page.getByTestId("ir-bo-open")).toHaveCount(0);
  await expect(page.getByTestId("quotation-create-bo")).toBeVisible();
  await expect(page.getByTestId("quotation-edit")).toBeVisible();
  await expect(page.getByTestId("ir-pdf-section")).toBeVisible();
  await expect(page.getByTestId("inspection-communications")).toBeVisible();
});

test("报价单：一份检查结果一份报价无版本，项目对齐业务单收费项，任何状态都能改（AI 拆错随时改）", async ({ page }) => {
  // demo-01 已发布：不锁定，AI 拆错也能直接改
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("quotation-edit")).toBeVisible();
  await expect(page.getByTestId("inspection-quotation").locator('[data-testid$="-desc"]').first()).toHaveValue("拆解发动机");
  await expect(page.getByTestId("inspection-quotation")).toContainText("待报价");
  await expect(page.getByTestId("inspection-quotation")).toContainText("另行出具检查报告与报价");
  await expect(page.getByTestId("quotation-group-labor").locator('[data-testid$="-desc"]')).toHaveValue("拆解发动机");
  await expect(page.getByTestId("quotation-group-parts").locator('[data-testid$="-desc"]')).toHaveValue("发动机拆解需更换件");
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue(/当前阶段/);
  await page.getByTestId("quotation-note-zh").fill("总备注：客户已知拆解后可能另行报价。");
  await page.getByTestId("quotation-note-en").fill("Overall note: Further costs may be quoted after teardown.");
  await page.getByTestId("inspection-quotation").getByLabel("单价").first().fill("210000");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await expect(page.getByTestId("inspection-quotation")).toContainText("210,000");
  await page.reload();
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue("总备注：客户已知拆解后可能另行报价。");
  await expect(page.getByTestId("quotation-note-en")).toHaveValue("Overall note: Further costs may be quoted after teardown.");

  // demo-02 已审核：直接内联编辑，没有 V1/V2 修订概念
  await page.goto("/orders/inspections/inspection-report-demo-02");
  await expect(page.getByTestId("quotation-edit")).toBeVisible();
  await expect(page.getByTestId("quotation-revise")).toHaveCount(0);
  await expect(page.getByTestId("quotation-version-2")).toHaveCount(0);
  const price = page.getByTestId("inspection-quotation").getByLabel("单价").first();
  await price.fill("35000");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await expect(page.getByTestId("inspection-quotation")).toContainText("35,000");
  await expect(page.getByTestId("quotation-version-2")).toHaveCount(0);
});

test("新建检查结果：选车→自然语言回交→AI 整理→生成详情（创建入口）", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  await page.goto("/orders/inspections");
  await page.getByTestId("ir-create-open").click();
  const dialog = page.getByTestId("ir-create-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("ir-create-vehicle-search").fill("7012 AB");
  await page.getByTestId("ir-create-vehicle-option-VEH-UAT-001").click();
  await expect(page.getByTestId("ir-create-vehicle")).toContainText("7012 AB");
  await page.getByTestId("ir-create-raw").fill("发动机异响 需要检查 工时15000\n前刹车片磨损到极限 配件待报价");
  await page.getByTestId("ir-create-parse").click();
  await expect(page.getByTestId("ir-create-items")).toBeVisible();
  await expect(page.getByTestId("ir-create-labor-total")).toContainText("15,000");
  await expect(page.getByTestId("ir-create-items")).toContainText("配件清单 · 另报");
  await page.getByTestId("ir-create-submit").click();
  await expect(page).toHaveURL(/\/orders\/inspections\/inspection-report-new-\d+$/);
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await expect(page.getByTestId("ir-detail-page")).toContainText("发动机异响");
  await expect(page.getByTestId("inspection-quotation")).toContainText("15,000");
  // 报价项目名称在输入框里（内联可编辑），按输入值断言
  const quoteDesc = page.getByTestId("inspection-quotation").locator('[data-testid$="-desc"]');
  await expect(quoteDesc.nth(0)).toHaveValue(/发动机异响/);
  await expect(quoteDesc.nth(1)).toHaveValue(/前刹车片磨损到极限/);
});

test("正式文件：普通脏 Quotation 先保存再生成 V1，三语预览下载打印共用当前附件并可重载", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    const captured: Array<{ size: number; type: string }> = [];
    const printCalls: string[] = [];
    Object.defineProperty(window, "__IR_OBJECT_URLS__", { value: captured, configurable: true });
    Object.defineProperty(window, "__IR_PRINT_CALLS__", { value: printCalls, configurable: true });
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) captured.push({ size: object.size, type: object.type });
      return original(object);
    };
    const originalOpen = window.open;
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      if (String(url).startsWith("blob:") && target === "_blank") {
        const listeners: Record<"load" | "error", Set<() => void>> = { load: new Set(), error: new Set() };
        const printWindow = {
          opener: null,
          focus() { printCalls.push("focus"); },
          print() { printCalls.push("print"); },
          close() { printCalls.push("close"); },
          addEventListener(type: "load" | "error", listener: () => void) {
            listeners[type].add(listener);
            if (type === "load") window.setTimeout(() => listener(), 0);
          },
          removeEventListener(type: "load" | "error", listener: () => void) {
            listeners[type].delete(listener);
          },
        };
        printCalls.push("open");
        return printWindow as unknown as Window;
      }
      return originalOpen.call(window, url, target, features);
    }) as typeof window.open;
  });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await page.getByTestId("quotation-note-zh").fill("客户已知情：生成前先保存本次修改。");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("ir-a4-v1");
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("当前");
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue("客户已知情：生成前先保存本次修改。");
  await expect(page.getByTestId("ir-pdf-language")).toHaveValue("zh");
  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  await page.getByTestId("ir-pdf-preview").click();
  await expect(page.getByTestId("ir-pdf-preview-dialog")).toBeVisible();
  expect(downloadCount).toBe(0);
  const canvas = page.getByTestId("ir-pdf-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("width", /\d+/);
  await expect(canvas).toHaveAttribute("height", /\d+/);
  await expect(page.getByTestId("ir-pdf-thumbnail-1")).toBeVisible();
  await page.getByTestId("ir-pdf-zoom-in").click();
  await page.getByTestId("ir-pdf-fit").click();
  await page.getByTestId("ir-pdf-preview-language").selectOption("en");
  const active = page.getByTestId("ir-pdf-active-attachment");
  await expect(active).toHaveAttribute("data-language", "en");
  await expect(active).toContainText("ir-a4-v1");
  const attachmentId = await active.getAttribute("data-attachment-id");
  const byteLength = Number(await active.getAttribute("data-byte-length"));
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("ir-pdf-preview-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^KGN-WH-IR-.*-EN\.pdf$/);
  expect(await download.path()).toBeTruthy();
  await page.getByTestId("ir-pdf-preview-print").click();
  await expect.poll(async () => page.evaluate(() => (
    (window as typeof window & { __IR_OBJECT_URLS__?: Array<{ size: number }> }).__IR_OBJECT_URLS__?.length ?? 0
  ))).toBeGreaterThanOrEqual(2);
  const objectUrls = await page.evaluate(() => (
    (window as typeof window & { __IR_OBJECT_URLS__?: Array<{ size: number; type: string }> }).__IR_OBJECT_URLS__ ?? []
  ));
  expect(objectUrls.slice(-2)).toEqual([
    { size: byteLength, type: "application/pdf" },
    { size: byteLength, type: "application/pdf" },
  ]);
  await expect.poll(async () => page.evaluate(() => (
    (window as typeof window & { __IR_PRINT_CALLS__?: string[] }).__IR_PRINT_CALLS__ ?? []
  ))).toEqual(["open", "focus", "print", "close"]);
  await expect(page.getByTestId("ir-pdf-print-status")).toContainText("已调用 English 文件的浏览器打印对话框");
  await expect(active).toHaveAttribute("data-attachment-id", attachmentId!);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ir-pdf-preview-dialog")).toHaveCount(0);
  await expect(page.getByTestId("ir-pdf-preview")).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1");
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue("客户已知情：生成前先保存本次修改。");
  await expect(page.getByTestId("ir-pdf-preview")).toBeEnabled();
});

test("正式文件：多页预览的上一页、下一页与真缩略图会切换同一份 PDF 页码", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const longNote = Array.from({ length: 220 }, (_, index) => `分页验证备注 ${index + 1}：客户已知情。`).join("");
  await page.getByTestId("quotation-note-zh").fill(longNote);
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 20_000 });
  await page.getByTestId("ir-pdf-preview").click();
  await expect(page.getByTestId("ir-pdf-preview-dialog")).toBeVisible();
  const pager = page.getByTestId("pdf-preview-pager");
  await expect(pager).toContainText(/^1 \/ \d+$/, { timeout: 15_000 });
  const pageCount = Number((await pager.textContent())?.split("/")[1]?.trim());
  expect(pageCount).toBeGreaterThan(1);
  await expect(page.getByTestId("ir-pdf-thumbnail-2")).toBeVisible();
  await expect(page.getByTestId("ir-pdf-canvas")).toHaveAttribute("data-page", "1");

  await page.getByTestId("pdf-preview-next").click();
  await expect(pager).toContainText(`2 / ${pageCount}`);
  await expect(page.getByTestId("ir-pdf-canvas")).toHaveAttribute("data-page", "2");
  await expect(page.getByTestId("ir-pdf-thumbnail-2")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("pdf-preview-prev").click();
  await expect(pager).toContainText(`1 / ${pageCount}`);
  await expect(page.getByTestId("ir-pdf-canvas")).toHaveAttribute("data-page", "1");

  await page.getByTestId("ir-pdf-thumbnail-2").click();
  await expect(pager).toContainText(`2 / ${pageCount}`);
  await expect(page.getByTestId("ir-pdf-canvas")).toHaveAttribute("data-page", "2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("正式文件：高优惠脏 Quotation 只签字一次就保存并继续生成 V1", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await labor.locator('[data-testid$="-unit-discount"]').fill("40001");
  await page.getByTestId("ir-pdf-generate").click();
  const signature = page.getByTestId("quotation-signature-dialog");
  await expect(signature).toBeVisible();
  const pad = page.getByTestId("quotation-discount-signature");
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 25, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 125, box!.y + 75, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-signature-confirm").click();
  await expect(signature).toHaveCount(0);
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await expect(page.getByTestId("quotation-signature-dialog")).toHaveCount(0);
  await expect(labor.locator('[data-testid$="-unit-discount"]')).toHaveValue("40001");
});

test("Quotation 明确清空总备注后 reload 与正式 PDF 都保持空，不回填 seed 默认条款", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("quotation-note-zh").fill("");
  await page.getByTestId("quotation-note-en").fill("");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");

  await page.reload();
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue("");
  await expect(page.getByTestId("quotation-note-en")).toHaveValue("");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await page.getByTestId("ir-pdf-language").selectOption("bilingual");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("ir-pdf-download").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const { readFile } = await import("node:fs/promises");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(path!)) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    pages.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "));
  }
  const text = pages.join(" ");
  expect(text).not.toContain("本报价仅涵盖当前阶段");
  expect(text).not.toContain("This quotation covers the current stage only");
});

test("正式文件：普通脏 Quotation 以原 mutation 经历 409 rebase 与 503 response-loss 后 exact replay", async ({ page, context }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await page.getByTestId("quotation-note-zh").fill("并发 rebase 后仍应保存的普通草稿。");
  await labor.locator('[data-testid$="-bo"]').check();

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-02");
  await concurrent.getByTestId("quotation-note-zh").fill("只推进全局 revision，不改 demo-01 Quotation。");
  await concurrent.getByTestId("quotation-save").click();
  await expect(concurrent.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await concurrent.close();

  await resetMutationUuidCapture(page);
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.quotation.update.response": "Quotation rebase 响应丢失" } },
    };
  });
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("Quotation rebase 响应丢失");
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue("并发 rebase 后仍应保存的普通草稿。");
  await expect(labor.locator('[data-testid$="-bo"]')).toBeChecked();
  const responseLost = await page.evaluate(() => {
    const uuids = (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [];
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string; mutationId: string }>;
    };
    return {
      uuids,
      quotationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.quotation.update" && uuids.some((uuid) => receipt.mutationId === `quotation-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
      generationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.files.generate" && uuids.some((uuid) => receipt.mutationId === `inspection-files-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
    };
  });
  expect(responseLost.uuids).toHaveLength(1);
  expect(responseLost.quotationReceiptIds).toEqual([`quotation-${responseLost.uuids[0]}`]);
  expect(responseLost.generationReceiptIds).toHaveLength(0);

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  const replayed = await page.evaluate(() => {
    const uuids = (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [];
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string; mutationId: string }>;
      generationEvents?: Array<{ reportId: string }>;
    };
    return {
      uuids,
      quotationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.quotation.update" && uuids.some((uuid) => receipt.mutationId === `quotation-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
      generationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.files.generate" && uuids.some((uuid) => receipt.mutationId === `inspection-files-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
      generationEvents: state.generationEvents?.filter((event) => event.reportId === "inspection-report-demo-01").length ?? 0,
    };
  });
  expect(replayed.uuids).toHaveLength(2);
  expect(replayed.quotationReceiptIds).toEqual([`quotation-${replayed.uuids[0]}`]);
  expect(replayed.generationReceiptIds).toEqual([`inspection-files-${replayed.uuids[1]}`]);
  expect(replayed.generationEvents).toBe(1);
});

test("正式文件：高优惠签名以原 mutation 经历 409 与 503 后只消费一次并 exact replay", async ({ page, context }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await labor.locator('[data-testid$="-unit-discount"]').fill("40001");

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-02");
  await concurrent.getByTestId("quotation-note-zh").fill("高优惠签名前推进无关全局 revision。");
  await concurrent.getByTestId("quotation-save").click();
  await expect(concurrent.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await concurrent.close();

  await resetMutationUuidCapture(page);
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.quotation.update.response": "高优惠 Quotation rebase 响应丢失" } },
    };
  });

  await page.getByTestId("ir-pdf-generate").click();
  const signature = page.getByTestId("quotation-signature-dialog");
  await expect(signature).toBeVisible();
  const pad = page.getByTestId("quotation-discount-signature");
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 25, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 125, box!.y + 75, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-signature-confirm").click();

  await expect(signature).toBeVisible();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("高优惠 Quotation rebase 响应丢失");
  const responseLost = await page.evaluate(() => {
    const uuids = (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [];
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string; mutationId: string }>;
      discountSignatureEvents?: Array<{ mutationId: string }>;
    };
    return {
      uuids,
      quotationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.quotation.update" && uuids.some((uuid) => receipt.mutationId === `quotation-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
      signatureMutationIds: state.discountSignatureEvents?.filter((event) => uuids.some((uuid) => event.mutationId === `quotation-${uuid}`)).map((event) => event.mutationId) ?? [],
    };
  });
  expect(responseLost.uuids).toHaveLength(1);
  expect(responseLost.quotationReceiptIds).toEqual([`quotation-${responseLost.uuids[0]}`]);
  expect(responseLost.signatureMutationIds).toEqual([`quotation-${responseLost.uuids[0]}`]);

  await page.getByTestId("quotation-signature-confirm").click();
  await expect(signature).toHaveCount(0);
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await expect(labor.locator('[data-testid$="-unit-discount"]')).toHaveValue("40001");
  const replayed = await page.evaluate(() => {
    const uuids = (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [];
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string; mutationId: string }>;
      discountSignatureEvents?: Array<{ mutationId: string }>;
      generationEvents?: Array<{ reportId: string }>;
    };
    return {
      uuids,
      quotationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.quotation.update" && uuids.some((uuid) => receipt.mutationId === `quotation-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
      generationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.files.generate" && uuids.some((uuid) => receipt.mutationId === `inspection-files-${uuid}`)).map((receipt) => receipt.mutationId) ?? [],
      signatureMutationIds: state.discountSignatureEvents?.filter((event) => uuids.some((uuid) => event.mutationId === `quotation-${uuid}`)).map((event) => event.mutationId) ?? [],
      generationEvents: state.generationEvents?.filter((event) => event.reportId === "inspection-report-demo-01").length ?? 0,
    };
  });
  expect(replayed.uuids).toHaveLength(2);
  expect(replayed.quotationReceiptIds).toEqual([`quotation-${replayed.uuids[0]}`]);
  expect(replayed.signatureMutationIds).toEqual([`quotation-${replayed.uuids[0]}`]);
  expect(replayed.generationReceiptIds).toEqual([`inspection-files-${replayed.uuids[1]}`]);
  expect(replayed.generationEvents).toBe(1);
});

test("正式文件：clean generate 以原 mutation 经历 409 rebase 与 503 后 exact replay", async ({ page, context }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-01");

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-02");
  await concurrent.getByTestId("quotation-note-zh").fill("clean generate 前推进无关全局 revision。");
  await concurrent.getByTestId("quotation-save").click();
  await expect(concurrent.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await concurrent.close();

  await resetMutationUuidCapture(page);
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.files.generate.response": "clean generation rebase 响应丢失" } },
    };
  });

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("clean generation rebase 响应丢失", { timeout: 15_000 });
  const responseLost = await page.evaluate(() => {
    const uuids = (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [];
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string; mutationId: string }>;
      generationEvents?: Array<{ reportId: string; generation: number }>;
    };
    return {
      uuids,
      generationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.files.generate").map((receipt) => receipt.mutationId) ?? [],
      generationEvents: state.generationEvents?.filter((event) => event.reportId === "inspection-report-demo-01") ?? [],
    };
  });
  expect(responseLost.uuids).toHaveLength(2);
  expect(responseLost.generationReceiptIds).toEqual([`inspection-files-${responseLost.uuids[1]}`]);
  expect(responseLost.generationEvents).toHaveLength(1);
  expect(responseLost.generationEvents[0]?.generation).toBe(1);

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("当前");
  const replayed = await page.evaluate(() => {
    const uuids = (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__ ?? [];
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string; mutationId: string }>;
      generationEvents?: Array<{ reportId: string; generation: number }>;
    };
    return {
      uuids,
      generationReceiptIds: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.files.generate").map((receipt) => receipt.mutationId) ?? [],
      generationEvents: state.generationEvents?.filter((event) => event.reportId === "inspection-report-demo-01") ?? [],
    };
  });
  expect(replayed.uuids.length).toBeGreaterThanOrEqual(2);
  expect(replayed.generationReceiptIds).toEqual(responseLost.generationReceiptIds);
  expect(replayed.generationEvents).toHaveLength(1);
  expect(replayed.generationEvents[0]?.generation).toBe(1);
});

test("正式文件：clean generate 发现并发 Quotation 内容已变时不 hydrate 覆盖本页", async ({ page, context }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const localValue = await page.getByTestId("quotation-note-zh").inputValue();

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-01");
  await concurrent.getByTestId("quotation-note-zh").fill("clean generation 期间并发提交的新内容。");
  await concurrent.getByTestId("quotation-save").click();
  await expect(concurrent.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await concurrent.close();

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("Quotation 已被其他窗口修改，请核对");
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue(localValue);
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("尚未生成");
});

test("正式文件：409 时发现 Quotation contentRevision 已改变则保留本页草稿并提示核对", async ({ page, context }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const localDraft = "本页尚未保存，不能被并发内容覆盖。";
  await page.getByTestId("quotation-note-zh").fill(localDraft);

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-01");
  await concurrent.getByTestId("quotation-note-zh").fill("另一个窗口已经提交的 Quotation 内容。");
  await concurrent.getByTestId("quotation-save").click();
  await expect(concurrent.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await concurrent.close();

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("Quotation 已被其他窗口修改，请核对");
  await expect(page.getByTestId("quotation-note-zh")).toHaveValue(localDraft);
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("尚未生成");
});

test("正式文件：503 response-loss 保留原 generation mutation 并 exact replay 为同一 V1", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.files.generate.response": "正式文件响应丢失" } },
    };
  });

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("正式文件响应丢失", { timeout: 15_000 });
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  const lifecycle = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      generationEvents?: Array<{ reportId: string; generation: number }>;
      mutationReceipts?: Array<{ operation: string }>;
    };
    return {
      events: state.generationEvents?.filter((event) => event.reportId === "inspection-report-demo-01") ?? [],
      receipts: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.files.generate") ?? [],
    };
  });
  expect(lifecycle.events).toHaveLength(1);
  expect(lifecycle.events[0]?.generation).toBe(1);
  expect(lifecycle.receipts).toHaveLength(1);
});

test("正式文件：V1 过期仍可预览，V2 失败保留 V1 且原意图重试成功", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1", { timeout: 15_000 });
  const v1Id = await page.getByTestId("ir-pdf-section").getAttribute("data-active-bundle-id");

  await page.getByTestId("quotation-note-zh").fill("生成 V1 后修改，待生成 V2。");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("过期");
  await page.getByTestId("ir-pdf-preview").click();
  await expect(page.getByTestId("ir-pdf-preview-dialog")).toBeVisible();
  await expect(page.getByTestId("ir-pdf-active-attachment")).toHaveAttribute("data-attachment-id", /generate/);
  await page.getByTestId("ir-pdf-preview-close").click();

  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.files.generate.write": "V2 写入故障" } },
    };
  });
  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-status")).toContainText("V2 写入故障");
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V1");
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("过期");
  await expect(page.getByTestId("ir-pdf-section")).toHaveAttribute("data-active-bundle-id", v1Id!);

  await page.getByTestId("ir-pdf-generate").click();
  await expect(page.getByTestId("ir-pdf-generation")).toContainText("V2", { timeout: 15_000 });
  await expect(page.getByTestId("ir-pdf-stale")).toContainText("当前");
  await expect(page.getByTestId("ir-pdf-section")).not.toHaveAttribute("data-active-bundle-id", v1Id!);
});

test("现场照片重复 occurrence 以稳定 ID 保存，并在独立车辆档案分组复用同一 Blob", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await expect(page.getByTestId("ir-inline-editor")).toHaveCount(0);
  const photos = page.getByTestId("ir-photo-section");
  await expect(photos).toBeVisible();
  const sameBytes = Buffer.from(PNG_1PX, "base64");
  await page.getByTestId("ir-photo-input").setInputFiles([
    { name: "shop-photo.png", mimeType: "text/plain", buffer: sameBytes },
    { name: "shop-photo-copy.jpg", mimeType: "image/jpeg", buffer: sameBytes },
  ]);
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  await expect(page.getByTestId("ir-photo-thumb-1")).toBeVisible();
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（2 张）");
  const canonical = await page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports?: Array<{ id: string; vehicleId: string; photoIds: string[] }>;
      reportAttachments?: Array<{ id: string; sha256?: string; originalName?: string }>;
      reportAttachmentAuditEvents?: Array<{ attachmentId: string; action: string; recordedAt: string }>;
    };
    const report = state.inspectionReports?.find((candidate) => candidate.id === "inspection-report-demo-03");
    const ids = report?.photoIds ?? [];
    const request = indexedDB.open("wh_ir_report_photos_v1", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("photos", "readonly");
    const rowsRequest = transaction.objectStore("photos").getAll();
    const rows = await new Promise<Array<{ id: string; sha256: string; blob: Blob }>>((resolve, reject) => {
      rowsRequest.onsuccess = () => resolve(rowsRequest.result);
      rowsRequest.onerror = () => reject(rowsRequest.error);
    });
    database.close();
    const selected = rows.filter((row) => ids.includes(row.id));
    return {
      serialized: localStorage.getItem("wh_linked_operations_state_v1") ?? "",
      vehicleId: report?.vehicleId ?? "",
      ids,
      metadata: state.reportAttachments?.filter((attachment) => ids.includes(attachment.id)) ?? [],
      rows: selected.map((row) => ({ id: row.id, sha256: row.sha256, byteLength: row.blob.size })),
      audits: state.reportAttachmentAuditEvents?.filter((event) => ids.includes(event.attachmentId)) ?? [],
      totalRows: rows.length,
    };
  });
  expect(canonical.ids).toHaveLength(2);
  expect(new Set(canonical.ids).size).toBe(2);
  expect(canonical.metadata.map((photo) => photo.originalName)).toEqual(["shop-photo.png", "shop-photo-copy.jpg"]);
  expect(new Set(canonical.metadata.map((photo) => photo.sha256)).size).toBe(1);
  expect(canonical.rows.map((row) => row.id)).toEqual(canonical.ids);
  expect(canonical.rows.every((row) => row.byteLength === sameBytes.length)).toBe(true);
  expect(canonical.audits).toHaveLength(2);
  expect(new Set(canonical.audits.map((event) => event.recordedAt)).size).toBe(1);
  expect(canonical.serialized).not.toContain("data:image");
  expect(canonical.serialized).not.toContain(PNG_1PX.slice(0, 24));
  await page.reload();
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  await expect(page.getByTestId("ir-photo-thumb-1")).toBeVisible();

  await page.goto(`/vehicles/${canonical.vehicleId}`);
  const linkedArchive = page.getByTestId("vehicle-section-inspection-report-photos");
  await expect(linkedArchive).toBeVisible();
  const group = page.getByTestId("vehicle-ir-photo-group-inspection-report-demo-03");
  await expect(group).toContainText("KGN-WH-IR-2026080919424");
  await expect(group.locator("figure")).toHaveCount(2);
  await expect(page.getByTestId(`vehicle-ir-photo-${canonical.ids[0]}`)).toBeVisible();
  await expect(page.getByTestId(`vehicle-ir-photo-${canonical.ids[1]}`)).toBeVisible();
  const rowsAfterVehicleRead = await page.evaluate(async () => {
    const request = indexedDB.open("wh_ir_report_photos_v1", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("photos", "readonly");
    const countRequest = transaction.objectStore("photos").count();
    const count = await new Promise<number>((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
    database.close();
    return count;
  });
  expect(rowsAfterVehicleRead).toBe(canonical.totalRows);
});

test("IR 同路由身份切换立即清空旧详情与照片 URL，旧授权数据不再回显", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(window, "__IR_IDENTITY_URL_LIFECYCLE__", { value: { created, revoked }, configurable: true });
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = originalCreate(object);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      originalRevoke(url);
    };
  });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("ir-photo-input").setInputFiles({
    name: "identity-current-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  const oldPhotoUrls = await page.evaluate(() => (window as typeof window & {
    __IR_IDENTITY_URL_LIFECYCLE__: { created: string[] };
  }).__IR_IDENTITY_URL_LIFECYCLE__.created.slice());
  expect(oldPhotoUrls.length).toBeGreaterThan(0);

  await page.evaluate(() => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: {
        id: "emp-004",
        name: "张伟",
        role: "parts",
      },
      token: "offline-emp-004",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", `${location.pathname}?identity=parts`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page.getByTestId("ir-detail-page")).toHaveCount(0);
  await expect(page.getByTestId("ir-photo-section")).toHaveCount(0);
  await expect(page.getByText(/无权访问该业务资源/)).toBeVisible();
  expect(await page.evaluate((urls) => {
    const revoked = (window as typeof window & {
      __IR_IDENTITY_URL_LIFECYCLE__: { revoked: string[] };
    }).__IR_IDENTITY_URL_LIFECYCLE__.revoked;
    return urls.every((url) => revoked.includes(url));
  }, oldPhotoUrls)).toBe(true);
});

test("IR 身份切换后丢弃迟到的旧授权 detail 响应", async ({ page }) => {
  await page.goto("/orders/inspections");
  await expect(page.getByTestId("ir-detail-link-inspection-report-demo-01")).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
        delayMs: { byAction: { "inspection.detail.read": 700 } },
      };
  });
  await page.getByTestId("ir-detail-link-inspection-report-demo-01").click();
  await expect(page.getByTestId("ir-detail-loading")).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem("wh_session");
    history.pushState({}, "", `${location.pathname}?identity=anonymous`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(850);
  await expect(page.getByTestId("ir-detail-page")).toHaveCount(0);
  await expect(page.getByTestId("ir-photo-section")).toHaveCount(0);
  await expect(page.getByText(/无权访问该业务资源/)).toBeVisible();
});

test("IR 客户端路由切换立即卸载旧报告草稿并丢弃迟到详情", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("ir-detail-page")).toContainText("KGN-WH-IR-2026080919422");
  await page.getByTestId("ir-notification-message").fill("IR-A 未发送私有草稿 sentinel");
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      delayMs: { byAction: { "inspection.detail.read:inspection-report-demo-02": 900 } },
    };
  });
  await page.getByTestId("ir-detail-back").click();
  await page.getByTestId("ir-detail-link-inspection-report-demo-02").click();
  await expect(page).toHaveURL(/inspection-report-demo-02$/);
  await expect(page.getByTestId("ir-detail-loading")).toBeVisible();
  await expect(page.getByText("IR-A 未发送私有草稿 sentinel", { exact: true })).toHaveCount(0);
  await expect(page.getByText("KGN-WH-IR-2026080919422", { exact: false })).toHaveCount(0);
  await expect(page.getByTestId("ir-detail-page")).toContainText("KGN-WH-IR-2026080919423", { timeout: 5_000 });
  await expect(page.getByTestId("ir-notification-message")).not.toHaveValue(/IR-A/);

});

test("现场照片 mixed invalid、quota 与 canonical 故障都保留本地意图并以同 mutation 重试", async ({ page }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await resetMutationUuidCapture(page);
  await page.evaluate(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(window, "__IR_PHOTO_URL_LIFECYCLE__", { value: { created, revoked }, configurable: true });
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = originalCreate(object);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      originalRevoke(url);
    };
  });
  const valid = Buffer.from(PNG_1PX, "base64");
  await page.getByTestId("ir-photo-input").setInputFiles([
    { name: "valid-before.png", mimeType: "image/png", buffer: valid },
    { name: "invalid-disguised.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
    { name: "valid-after.png", mimeType: "image/png", buffer: valid },
  ]);
  await expect(page.getByTestId("ir-photo-status")).toContainText(/无效|格式|截断/);
  await expect(page.locator('[data-testid^="ir-photo-thumb-"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __IR_PHOTO_URL_LIFECYCLE__: { created: string[] } }).__IR_PHOTO_URL_LIFECYCLE__.created)).toEqual([]);

  await page.getByTestId("ir-photo-input").setInputFiles({ name: "retry-intent.png", mimeType: "image/png", buffer: valid });
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => ({ usage: 100, quota: 100 }) },
    });
  });
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片保存失败");
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as { inspectionReports?: Array<{ id: string; photoIds: string[] }> };
    return state.inspectionReports?.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [];
  })).toEqual([]);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => ({ usage: 0, quota: 100_000_000 }) },
    });
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.photos.write": "canonical photo write failed" } },
    };
  });
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片保存失败");
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports?: Array<{ id: string; photoIds: string[] }>;
      reportAttachmentAuditEvents?: unknown[];
      mutationReceipts?: Array<{ operation: string }>;
    };
    return {
      ids: state.inspectionReports?.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [],
      audits: state.reportAttachmentAuditEvents?.length ?? 0,
      receipts: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.photos.update").length ?? 0,
    };
  })).toEqual({ ids: [], audits: 0, receipts: 0 });

  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");
  expect(await page.evaluate(() => (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__)).toHaveLength(1);
});

test("现场照片 response-loss 精确 replay 一份 Blob/audit/receipt，确认成功后才清本地预览", async ({ page }) => {
  await installMutationUuidCapture(page);
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await resetMutationUuidCapture(page);
  await page.getByTestId("ir-photo-input").setInputFiles({
    name: "response-loss.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.photos.write.response": "photo response lost" } },
    };
  });
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片保存失败");
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  const committed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports: Array<{ id: string; photoIds: string[] }>;
      reportAttachmentAuditEvents: Array<{ attachmentId: string }>;
      mutationReceipts: Array<{ operation: string; result: { auditEventIds?: string[] } }>;
    };
    const ids = state.inspectionReports.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [];
    const receipts = state.mutationReceipts.filter((receipt) => receipt.operation === "inspection.photos.update");
    return {
      ids,
      audits: state.reportAttachmentAuditEvents.filter((event) => ids.includes(event.attachmentId)).length,
      receipts: receipts.length,
      resultAuditIds: receipts[0]?.result.auditEventIds ?? [],
    };
  });
  expect(committed.ids).toHaveLength(1);
  expect(committed.audits).toBe(1);
  expect(committed.receipts).toBe(1);
  expect(committed.resultAuditIds).toHaveLength(1);

  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");
  expect(await page.evaluate(() => (window as typeof window & { __IR_MUTATION_UUIDS__?: string[] }).__IR_MUTATION_UUIDS__)).toHaveLength(1);
  const replayed = await page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports: Array<{ id: string; photoIds: string[] }>;
      reportAttachmentAuditEvents: Array<{ attachmentId: string }>;
      mutationReceipts: Array<{ operation: string }>;
    };
    const ids = state.inspectionReports.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [];
    const request = indexedDB.open("wh_ir_report_photos_v1", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction("photos", "readonly");
    const getAll = tx.objectStore("photos").getAll();
    const rows = await new Promise<Array<{ id: string }>>((resolve, reject) => {
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    return {
      ids,
      rows: rows.filter((row) => ids.includes(row.id)).length,
      audits: state.reportAttachmentAuditEvents.filter((event) => ids.includes(event.attachmentId)).length,
      receipts: state.mutationReceipts.filter((receipt) => receipt.operation === "inspection.photos.update").length,
    };
  });
  expect(replayed).toEqual({ ids: committed.ids, rows: 1, audits: 1, receipts: 1 });
});

test("现场照片两窗口同 revision 仅一胜，409 刷新保留 loser File 并合并 remote addition", async ({ page, context }) => {
  const other = await context.newPage();
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await other.goto("/orders/inspections/inspection-report-demo-03");
  await expect(other.getByTestId("ir-detail-page")).toBeVisible();
  const bytes = Buffer.from(PNG_1PX, "base64");
  await page.getByTestId("ir-photo-input").setInputFiles({ name: "winner.png", mimeType: "image/png", buffer: bytes });
  await other.getByTestId("ir-photo-input").setInputFiles({ name: "loser.png", mimeType: "image/png", buffer: bytes });
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");

  await other.getByTestId("ir-photo-save").click();
  await expect(other.getByTestId("ir-photo-status")).toContainText("版本已变化");
  await expect(other.locator('[data-testid^="ir-photo-thumb-"]')).toHaveCount(2);
  await other.getByTestId("ir-photo-save").click();
  await expect(other.getByTestId("ir-photo-status")).toContainText("照片已保存（2 张）");
  const finalState = await other.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports: Array<{ id: string; photoIds: string[] }>;
      reportAttachments: Array<{ id: string; originalName?: string }>;
    };
    const ids = state.inspectionReports.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [];
    return state.reportAttachments.filter((attachment) => ids.includes(attachment.id)).map((attachment) => attachment.originalName);
  });
  expect(finalState).toEqual(["winner.png", "loser.png"]);
  await other.close();
});

test("现场照片延迟 inspect/save 在组件卸载后不回显旧状态，并回收旧 scope object URL", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await page.evaluate(() => {
    const lifecycle = { created: [] as string[], revoked: [] as string[] };
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = originalCreate(object);
      lifecycle.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      lifecycle.revoked.push(url);
      originalRevoke(url);
    };
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let releaseDigest!: () => void;
    const gate = new Promise<void>((resolve) => { releaseDigest = resolve; });
    Object.defineProperty(crypto.subtle, "digest", {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto["digest"]>) => {
        await gate;
        return originalDigest(...args);
      },
    });
    Object.assign(window, {
      __IR_SCOPE_LIFECYCLE__: lifecycle,
      __IR_RELEASE_DIGEST__: releaseDigest,
      __IR_RESTORE_DIGEST__: () => Object.defineProperty(crypto.subtle, "digest", { configurable: true, value: originalDigest }),
    });
  });
  await page.getByTestId("ir-photo-input").setInputFiles({
    name: "delayed-inspect.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await expect(page.getByTestId("ir-photo-status")).toContainText("正在验证照片");
  await page.getByRole("link", { name: "返回检查结果列表" }).click();
  await expect(page).toHaveURL(/\/orders\/inspections$/);
  await page.evaluate(() => {
    const scope = window as typeof window & { __IR_RELEASE_DIGEST__: () => void; __IR_RESTORE_DIGEST__: () => void };
    scope.__IR_RELEASE_DIGEST__();
    scope.__IR_RESTORE_DIGEST__();
  });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as typeof window & {
    __IR_SCOPE_LIFECYCLE__: { created: string[] };
  }).__IR_SCOPE_LIFECYCLE__.created)).toEqual([]);

  await page.getByTestId("ir-detail-link-inspection-report-demo-03").click();
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  await page.getByTestId("ir-photo-input").setInputFiles({
    name: "delayed-save.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  const localUrl = await page.evaluate(() => (window as typeof window & {
    __IR_SCOPE_LIFECYCLE__: { created: string[] };
  }).__IR_SCOPE_LIFECYCLE__.created.at(-1)!);
  await page.evaluate(() => {
    let releaseQuota!: () => void;
    const gate = new Promise<void>((resolve) => { releaseQuota = resolve; });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => { await gate; return { usage: 0, quota: 100_000_000 }; } },
    });
    Object.assign(window, { __IR_RELEASE_QUOTA__: releaseQuota });
  });
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("正在保存照片");
  await page.getByRole("link", { name: "返回检查结果列表" }).click();
  await expect(page).toHaveURL(/\/orders\/inspections$/);
  await page.evaluate(() => (window as typeof window & { __IR_RELEASE_QUOTA__: () => void }).__IR_RELEASE_QUOTA__());
  await page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports?: Array<{ id: string; photoIds: string[] }>;
    };
    return state.inspectionReports?.find((report) => report.id === "inspection-report-demo-03")?.photoIds.length === 1;
  });
  expect(await page.evaluate((url) => (window as typeof window & {
    __IR_SCOPE_LIFECYCLE__: { revoked: string[] };
  }).__IR_SCOPE_LIFECYCLE__.revoked.includes(url), localUrl)).toBe(true);

  await page.getByTestId("ir-detail-link-inspection-report-demo-03").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");
  await expect(page.getByTestId("ir-photo-save")).toBeDisabled();
});

test("现场照片未保存移除不写 canonical，确认删除后 IR/车辆视图消失且 tombstone/audit 保留", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const bytes = Buffer.from(PNG_1PX, "base64");
  await page.getByTestId("ir-photo-input").setInputFiles([
    { name: "remove-local.png", mimeType: "image/png", buffer: bytes },
    { name: "keep-then-delete.png", mimeType: "image/png", buffer: bytes },
  ]);
  await expect(page.locator('[data-testid^="ir-photo-thumb-"]')).toHaveCount(2);
  await page.getByRole("button", { name: "删除待上传现场照片 1" }).click();
  await expect(page.locator('[data-testid^="ir-photo-thumb-"]')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports: Array<{ id: string; photoIds: string[] }>;
    };
    return state.inspectionReports.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [];
  })).toEqual([]);

  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");
  const identity = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports: Array<{ id: string; vehicleId: string; photoIds: string[] }>;
    };
    const report = state.inspectionReports.find((candidate) => candidate.id === "inspection-report-demo-03")!;
    return { id: report.photoIds[0], vehicleId: report.vehicleId };
  });
  const original = page.getByRole("link", { name: "打开原图：现场照片 1" });
  await expect(original).toBeVisible();
  await original.focus();
  await expect(original).toBeFocused();

  await page.goto(`/vehicles/${identity.vehicleId}`);
  await expect(page.getByTestId(`vehicle-ir-photo-${identity.id}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-photo-thumb-0")).toBeVisible();
  await page.getByRole("button", { name: "删除现场照片 1" }).click();
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      inspectionReports: Array<{ id: string; photoIds: string[] }>;
    };
    return state.inspectionReports.find((report) => report.id === "inspection-report-demo-03")?.photoIds ?? [];
  })).toEqual([identity.id]);
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("现场照片已清空");
  const deleted = await page.evaluate(async (id) => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      reportAttachments: Array<{ id: string; lifecycle: string; activeSequence: number | null }>;
      reportAttachmentAuditEvents: Array<{ attachmentId: string; action: string }>;
    };
    const request = indexedDB.open("wh_ir_report_photos_v1", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction("photos", "readonly");
    const get = tx.objectStore("photos").get(id);
    const row = await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return {
      attachment: state.reportAttachments.find((attachment) => attachment.id === id),
      audits: state.reportAttachmentAuditEvents.filter((event) => event.attachmentId === id).map((event) => event.action),
      blobExists: row !== undefined,
    };
  }, identity.id);
  expect(deleted).toEqual({
    attachment: expect.objectContaining({ id: identity.id, lifecycle: "deleted", activeSequence: null }),
    audits: ["uploaded", "deleted"],
    blobExists: false,
  });
  await page.goto(`/vehicles/${identity.vehicleId}`);
  await expect(page.getByTestId(`vehicle-ir-photo-${identity.id}`)).toHaveCount(0);
  await expect(page.getByTestId("vehicle-ir-photo-group-inspection-report-demo-03")).toHaveCount(0);
});

test("报价空白建立后逐项填加；项目结构对齐业务单收费项", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await page.getByTestId("ir-detail-page").waitFor();
  await expect(page.getByTestId("quotation-create")).toBeVisible();
  await page.getByTestId("quotation-create").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("已建立报价（空白项目）");
  await page.getByTestId("quotation-add-row").click();
  const row = page.locator('[data-testid^="quotation-edit-row-"]').first();
  await row.locator('[data-testid$="-desc"]').fill("更换前减震器");
  await row.locator('[data-testid$="-desc-en"]').fill("Replace front shock absorbers");
  await row.locator('[data-testid$="-remark"]').fill("异响来自前悬挂，具体以拆检为准");
  await row.locator('[aria-label="单价"]').fill("45000");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await expect(page.getByTestId("inspection-quotation")).toContainText("45,000");
  await expect(page.getByTestId("quotation-version-2")).toHaveCount(0);
});

test("前台代录：自然语言→AI 拆分→组织语言→直接落入报价（AI 关闭走本地规则）", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  await page.goto("/orders/inspections/inspection-report-demo-03");
  await expect(page.getByTestId("ir-draft-input")).toBeVisible();
  await page.getByTestId("ir-draft-raw").fill("水泵漏水 需要更换水泵 工时12000\n空调不制冷 需要检查 工时5000");
  await page.getByTestId("ir-draft-parse").click();
  await expect(page.getByTestId("ir-draft-preview")).toBeVisible();
  await expect(page.getByTestId("ir-draft-preview")).toContainText("更换水泵");
  await expect(page.getByTestId("ir-draft-preview")).toContainText("17,000");
  await expect(page.getByTestId("ir-draft-preview")).toContainText("纯文字");
  await page.getByTestId("ir-draft-save").click();
  await expect(page.getByTestId("ir-draft-status")).toContainText("已保存");
  await expect(page.getByTestId("ir-draft-raw")).toHaveValue(/水泵漏水/);
  await expect(page.getByTestId("inspection-quotation").locator('[data-testid$="-desc"]').first()).toHaveValue(/更换水泵/);
  await expect(page.getByTestId("ir-inline-editor")).toHaveCount(0);
});

test("创建业务单：Quotation 行内默认不勾选，直接保存当前选择并创建独立 BO", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("ir-bo-section")).toHaveCount(0);
  await expect(page.getByTestId("ir-bo-open")).toHaveCount(0);
  await expect(page.getByTestId("ir-bo-dialog")).toHaveCount(0);
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  const parts = page.getByTestId("quotation-group-parts").locator('[data-testid^="quotation-unit-row-"]').first();
  await expect(labor.locator('[data-testid$="-bo"]')).not.toBeChecked();
  await expect(parts.locator('[data-testid$="-bo"]')).not.toBeChecked();
  await expect(page.getByTestId("quotation-create-bo")).toBeDisabled();
  await labor.locator('[data-testid$="-desc"]').fill("拆解发动机（客户已确认）");
  await labor.locator('[data-testid$="-bo"]').check();
  await parts.locator('[data-testid$="-bo"]').check();
  await page.getByTestId("quotation-add-other").click();
  const fixed = page.getByTestId("quotation-group-other_service").locator('[data-testid^="quotation-other-row-"]').last();
  await fixed.locator('[data-testid$="-desc"]').fill("拖车费");
  await fixed.locator('[data-testid$="-desc-en"]').fill("");
  await fixed.locator('[data-testid$="-code"]').selectOption("towing");
  await fixed.locator('[data-testid$="-amount"]').fill("7500");
  await fixed.locator('[data-testid$="-bo"]').check();
  await page.getByTestId("quotation-create-bo").click();
  await expect(page.getByTestId("ir-bo-dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/orders\/business\/qbo-\d+$/, { timeout: 10_000 });
  await expect(page.getByTestId("quick-inline-items")).toHaveCount(0);
  const sharedLines = page.getByTestId("quick-shared-charge-lines");
  await expect(sharedLines).toContainText("拆解发动机（客户已确认）");
  await expect(sharedLines).toContainText("发动机拆解需更换件");
  await expect(sharedLines).toContainText("待报价");
  await expect(sharedLines).toContainText("拖车费");
  await expect(sharedLines).toContainText("7,500");
  await expect(page.getByTestId("quick-detail-notes")).toContainText("来自检查结果：KGN-WH-IR-2026080919422");
  await expect(page.locator("body")).not.toContainText("NaN");

  await page.getByTestId("quick-print-office").click();
  const printSheet = page.getByTestId("quick-print-sheet-office");
  await expect(printSheet).toContainText("拆解发动机（客户已确认）");
  await expect(printSheet).toContainText("发动机拆解需更换件");
  await expect(printSheet).toContainText("拖车费");
  await expect(printSheet).not.toContainText("NaN");

  await page.goBack();
  await page.goBack();
  await expect(page.getByTestId("quotation-bo-link")).toHaveCount(0);
  await expect(page.getByTestId("quotation-create-bo")).toBeDisabled();
});

test("创建业务单两次写入：430px 两份空白签字，BO 失败保留选择并用原意图重试", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "quickOrders.createFromInspection.write": "业务单写入故障" } },
    };
  });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await labor.locator('[data-testid$="-unit-discount"]').fill("40001");
  await labor.locator('[data-testid$="-bo"]').check();
  await page.getByTestId("quotation-create-bo").click();

  const quotationSheet = page.getByTestId("quotation-signature-dialog");
  await expect(quotationSheet).toBeVisible();
  await expect(page.getByTestId("quotation-bo-signature-dialog")).toHaveCount(0);
  expect((await quotationSheet.boundingBox())?.width).toBe(430);
  expect((await quotationSheet.locator(":scope > div").boundingBox())?.height).toBeGreaterThanOrEqual(932);
  await expect(page.getByTestId("quotation-signature-confirm")).toBeDisabled();
  let pad = page.getByTestId("quotation-discount-signature");
  let box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 20, box!.y + 24);
  await page.mouse.down();
  await page.mouse.move(box!.x + 100, box!.y + 68, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-signature-confirm").click();

  const boSheet = page.getByTestId("quotation-bo-signature-dialog");
  await expect(quotationSheet).toHaveCount(0);
  await expect(boSheet).toBeVisible();
  expect((await boSheet.boundingBox())?.width).toBe(430);
  expect((await boSheet.locator(":scope > div").boundingBox())?.height).toBeGreaterThanOrEqual(932);
  await expect(page.getByTestId("quotation-bo-signature-confirm")).toBeDisabled();
  pad = page.getByTestId("quotation-bo-discount-signature");
  box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 38, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 128, box!.y + 78, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-bo-signature-confirm").click();

  await expect(boSheet).toBeVisible();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("业务单写入故障");
  await expect(page.getByTestId("quotation-group-labor").locator('[data-testid$="-bo"]').first()).toBeChecked();
  const afterFailure = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts?: Array<{ operation: string }>;
      quickOrders?: unknown[];
      discountSignatureEvents?: unknown[];
    };
    return {
      quotationReceipts: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.quotation.update").length ?? 0,
      quickReceipts: state.mutationReceipts?.filter((receipt) => receipt.operation === "quickOrders.createFromInspection").length ?? 0,
      quickCount: state.quickOrders?.length ?? 0,
      signatureCount: state.discountSignatureEvents?.length ?? 0,
    };
  });
  expect(afterFailure.quotationReceipts).toBe(1);
  expect(afterFailure.quickReceipts).toBe(0);
  expect(afterFailure.signatureCount).toBe(1);

  await page.getByTestId("quotation-bo-signature-confirm").click();
  await expect(boSheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/orders\/business\/qbo-\d+$/);
  const afterRetry = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      mutationReceipts: Array<{ operation: string }>;
      quickOrders: unknown[];
      discountSignatureEvents: unknown[];
    };
    return {
      quotationReceipts: state.mutationReceipts.filter((receipt) => receipt.operation === "inspection.quotation.update").length,
      quickReceipts: state.mutationReceipts.filter((receipt) => receipt.operation === "quickOrders.createFromInspection").length,
      quickCount: state.quickOrders.length,
      signatureCount: state.discountSignatureEvents.length,
    };
  });
  expect(afterRetry.quotationReceipts).toBe(1);
  expect(afterRetry.quickReceipts).toBe(1);
  expect(afterRetry.quickCount).toBe(afterFailure.quickCount + 1);
  expect(afterRetry.signatureCount).toBe(2);
  await page.goBack();
  await expect(page.getByTestId("quotation-group-labor").locator('[data-testid$="-bo"]').first()).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("创建业务单的前置 Quotation 写入失败时不调用 BO，并保留行内编辑与选择供重试", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.quotation.update.write": "Quotation 前置写入故障" } },
    };
  });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await labor.locator('[data-testid$="-desc"]').fill("前置失败仍保留的工时");
  await labor.locator('[data-testid$="-bo"]').check();
  await page.getByTestId("quotation-create-bo").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("Quotation 前置写入故障");
  await expect(labor.locator('[data-testid$="-desc"]')).toHaveValue("前置失败仍保留的工时");
  await expect(labor.locator('[data-testid$="-bo"]')).toBeChecked();
  const failed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as { mutationReceipts?: Array<{ operation: string }>; quickOrders?: Array<{ chargeContract?: string }> };
    return {
      quotationReceipts: state.mutationReceipts?.filter((receipt) => receipt.operation === "inspection.quotation.update").length ?? 0,
      quickReceipts: state.mutationReceipts?.filter((receipt) => receipt.operation === "quickOrders.createFromInspection").length ?? 0,
      sharedQuickCount: state.quickOrders?.filter((order) => order.chargeContract === "shared_v1").length ?? 0,
    };
  });
  expect(failed.quotationReceipts).toBe(0);
  expect(failed.quickReceipts).toBe(0);
  expect(failed.sharedQuickCount).toBe(5);

  await page.getByTestId("quotation-create-bo").click();
  await expect(page).toHaveURL(/\/orders\/business\/qbo-\d+$/);
  const retried = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as { mutationReceipts: Array<{ operation: string }>; quickOrders: Array<{ chargeContract?: string }> };
    return {
      quotationReceipts: state.mutationReceipts.filter((receipt) => receipt.operation === "inspection.quotation.update").length,
      quickReceipts: state.mutationReceipts.filter((receipt) => receipt.operation === "quickOrders.createFromInspection").length,
      sharedQuickCount: state.quickOrders.filter((order) => order.chargeContract === "shared_v1").length,
    };
  });
  expect(retried.quotationReceipts).toBe(1);
  expect(retried.quickReceipts).toBe(1);
  expect(retried.sharedQuickCount).toBe(failed.sharedQuickCount + 1);
});

test("创建业务单响应丢失后原意图重放只产生一单并自动打开", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "quickOrders.createFromInspection.response": "业务单响应丢失" } },
    };
  });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await labor.locator('[data-testid$="-bo"]').check();
  await page.getByTestId("quotation-create-bo").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("业务单响应丢失");
  await expect(labor.locator('[data-testid$="-bo"]')).toBeChecked();
  const committed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      quickOrders: Array<{ id: string }>;
      mutationReceipts: Array<{ operation: string; result?: { id?: string } }>;
    };
    const receipts = state.mutationReceipts.filter((receipt) => receipt.operation === "quickOrders.createFromInspection");
    const createdId = receipts[0]?.result?.id;
    return {
      count: state.quickOrders.length,
      receipts: receipts.length,
      createdId,
      matches: state.quickOrders.filter((order) => order.id === createdId).length,
    };
  });
  expect(committed.receipts).toBe(1);
  expect(committed.matches).toBe(1);
  await page.getByTestId("quotation-create-bo").click();
  await expect(page).toHaveURL(/\/orders\/business\/qbo-\d+$/);
  const after = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "{}") as {
      quickOrders: unknown[];
      mutationReceipts: Array<{ operation: string }>;
    };
    return {
      count: state.quickOrders.length,
      receipts: state.mutationReceipts.filter((receipt) => receipt.operation === "quickOrders.createFromInspection").length,
    };
  });
  expect(after.count).toBe(committed.count);
  expect(after.receipts).toBe(1);
  await page.goBack();
  await expect(page.getByTestId("quotation-create-bo")).toBeDisabled();
});

test("并发 Quotation 删除已选 ID 并插入新行后刷新只按稳定 ID 恢复选择", async ({ page, context }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const originalLabor = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  const selectedId = (await originalLabor.getAttribute("data-testid"))!.replace("quotation-unit-row-", "");
  await originalLabor.locator('[data-testid$="-bo"]').check();

  const concurrent = await context.newPage();
  await concurrent.goto("/orders/inspections/inspection-report-demo-01");
  const concurrentOriginal = concurrent.getByTestId(`quotation-unit-row-${selectedId}`);
  await concurrentOriginal.getByTestId(`quotation-${selectedId}-delete`).click();
  await concurrent.getByTestId("quotation-add-row").click();
  const replacement = concurrent.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').last();
  await replacement.locator('[data-testid$="-desc"]').fill("并发插入的替代工时");
  await replacement.locator('[data-testid$="-unit-price"]').fill("1000");
  await concurrent.getByTestId("quotation-save").click();
  await expect(concurrent.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await concurrent.close();

  await page.getByTestId("quotation-create-bo").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("已刷新，请核对勾选");
  await expect(page.getByTestId(`quotation-unit-row-${selectedId}`)).toHaveCount(0);
  await expect(page.getByTestId("quotation-create-bo")).toBeDisabled();
  await expect(page.getByTestId("quotation-group-labor").locator('[data-testid$="-bo"]')).not.toBeChecked();
  await expect(page.getByTestId("quotation-group-labor").locator('[data-testid$="-desc"]').last()).toHaveValue("并发插入的替代工时");
});

test("业务单侧从报价单导入：报价项目照搬进收费项（入口激活）", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  // 先按正确管道建一份带报价的检查结果（本车 7012 AB）
  await page.goto("/orders/inspections");
  await page.getByTestId("ir-create-open").click();
  await page.getByTestId("ir-create-vehicle-search").fill("7012 AB");
  await page.getByTestId("ir-create-vehicle-option-VEH-UAT-001").click();
  await page.getByTestId("ir-create-raw").fill("更换正时皮带 工时65000\n原厂刹车片 配件待报价");
  await page.getByTestId("ir-create-parse").click();
  await page.getByTestId("ir-create-submit").click();
  await expect(page).toHaveURL(/\/orders\/inspections\/inspection-report-new-\d+$/);

  // 新建工单 → 选同一辆车 → 从报价单导入
  await page.goto("/orders/business");
  await page.getByTestId("business-orders-create").click();
  await page.getByTestId("quick-create-vehicle-search").fill("7012 AB");
  await page.getByTestId("quick-create-vehicle-option-VEH-UAT-001").click();
  await page.getByTestId("quick-create-import-quote").click();
  await expect(page.getByTestId("quote-import-dialog")).toBeVisible();
  await page.locator('[data-testid^="quote-import-inspection-report-"]').first().click();
  await expect(page.getByTestId("quote-import-dialog")).toHaveCount(0);
  // 报价项目照搬进收费项（名称在输入框里，按输入值断言）
  const itemZh = page.getByTestId("quick-create-items").locator('[data-testid$="-zh"]');
  await expect(itemZh.nth(0)).toHaveValue(/更换正时皮带/);
  await expect(itemZh.nth(1)).toHaveValue(/原厂刹车片/);
});

test("Quotation 三个独立编辑器：行内翻译、任意人工优惠、固定其他费用与 BO 勾选对账", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor");
  const parts = page.getByTestId("quotation-group-parts");
  const other = page.getByTestId("quotation-group-other_service");
  await expect(labor).toBeVisible();
  await expect(parts).toBeVisible();
  await expect(other).toBeVisible();

  const laborRow = labor.locator('[data-testid^="quotation-unit-row-"]').first();
  await expect(laborRow.locator('[data-testid^="quotation-translation-"]')).toBeVisible();
  await expect(laborRow.getByRole("button", { name: "翻译当前行" })).toBeVisible();
  await laborRow.locator('[data-testid$="-unit-discount"]').fill("1251");
  await expect(laborRow.locator('[data-testid$="-final-unit"]')).toContainText("198,749");

  const partsRow = parts.locator('[data-testid^="quotation-unit-row-"]').first();
  await expect(partsRow.locator('[data-testid$="-pending"]')).toBeChecked();
  await expect(partsRow.locator('[data-testid^="quotation-translation-"]')).toBeVisible();

  await page.getByTestId("quotation-add-other").click();
  const otherRow = other.locator('[data-testid^="quotation-other-row-"]').last();
  await otherRow.locator('[data-testid$="-desc"]').fill("拖车费");
  await otherRow.locator('[data-testid$="-code"]').selectOption("towing");
  await otherRow.locator('[data-testid$="-amount"]').fill("7500");
  await expect(otherRow.getByLabel("数量")).toHaveCount(0);
  await expect(otherRow.getByLabel("单位")).toHaveCount(0);
  await expect(otherRow.locator('[data-testid$="-unit-discount"]')).toHaveCount(0);
  await expect(otherRow.locator('[data-testid$="-pending"]')).toHaveCount(0);
  const boCheck = otherRow.locator('[data-testid$="-bo"]');
  await expect(boCheck).not.toBeChecked();
  await boCheck.check();

  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await expect(other.locator('[data-testid^="quotation-other-row-"]').last().locator('[data-testid$="-bo"]')).toBeChecked();
  await expect(page.getByTestId("quotation-total-other")).toContainText("7,500");
});

test("Quotation 优惠均摊预览显示目标、实际与尾差，取消不改行，应用只写 JMD 50 网格", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const laborRow = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  const discount = laborRow.locator('[data-testid$="-unit-discount"]');
  await expect(discount).toHaveValue("0");

  await page.getByTestId("quotation-allocation-open").click();
  await page.getByTestId("quotation-allocation-target").fill("125");
  await page.getByTestId("quotation-allocation-preview").click();
  await expect(page.getByTestId("quotation-allocation-target-result")).toContainText("125");
  await expect(page.getByTestId("quotation-allocation-applied")).toContainText("100");
  await expect(page.getByTestId("quotation-allocation-remainder")).toContainText("25");
  await page.getByTestId("quotation-allocation-cancel").click();
  await expect(discount).toHaveValue("0");

  await page.getByTestId("quotation-allocation-open").click();
  await page.getByTestId("quotation-allocation-target").fill("125");
  await page.getByTestId("quotation-allocation-preview").click();
  await page.getByTestId("quotation-allocation-apply").click();
  await expect(discount).toHaveValue("100");
  await expect(laborRow.locator('[data-testid$="-final-unit"]')).toContainText("199,900");
});

test("Quotation 优惠均摊可逐行退出且展示完整 proposal，未参与行保留人工优惠", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const laborRow = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  const partsRow = page.getByTestId("quotation-group-parts").locator('[data-testid^="quotation-unit-row-"]').first();
  await laborRow.locator('[data-testid$="-unit-discount"]').fill("50");
  await partsRow.locator('[data-testid$="-pending"]').uncheck();
  await partsRow.locator('[data-testid$="-unit-price"]').fill("8000");
  await partsRow.locator('[data-testid$="-unit-discount"]').fill("100");

  await page.getByTestId("quotation-allocation-open").click();
  const dialog = page.getByTestId("quotation-allocation-dialog");
  const cards = dialog.locator('[data-testid^="quotation-allocation-card-"]');
  await expect(cards).toHaveCount(2);
  const laborCard = cards.filter({ hasText: "拆解发动机" });
  await expect(laborCard.getByRole("checkbox", { name: "参与均摊" })).toBeChecked();
  await laborCard.getByRole("checkbox", { name: "参与均摊" }).uncheck();
  await page.getByTestId("quotation-allocation-target").fill("500");
  await page.getByTestId("quotation-allocation-preview").click();
  await expect(dialog.getByTestId("quotation-allocation-before")).toContainText("150");
  await expect(dialog.getByTestId("quotation-allocation-after")).toBeVisible();
  await expect(laborCard).toContainText("原价");
  await expect(laborCard).toContainText("拟优惠");
  await expect(laborCard).toContainText("优惠后单价");
  await expect(laborCard).toContainText("优惠后小计");
  await page.getByTestId("quotation-allocation-apply").click();
  await expect(laborRow.locator('[data-testid$="-unit-discount"]')).toHaveValue("50");
});

test("Quotation 小数输入原样保留并就近报错，阻止保存或均摊应用", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const laborRow = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  const price = laborRow.locator('[data-testid$="-unit-price"]');
  await price.fill("123.5");
  await expect(price).toHaveValue("123.5");
  await expect(laborRow.getByRole("alert")).toContainText("整数");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("整数");
  await price.fill("123");
  const quantity = laborRow.getByLabel("数量");
  await quantity.fill("1.5");
  await expect(quantity).toHaveValue("1.5");
  await expect(laborRow.getByRole("alert")).toContainText("数量必须填写完整整数");
  await quantity.fill("1");

  await page.getByTestId("quotation-add-other").click();
  const fixedRow = page.getByTestId("quotation-group-other_service").locator('[data-testid^="quotation-other-row-"]').last();
  await fixedRow.locator('[data-testid$="-desc"]').fill("小数拖车费");
  const fixedAmount = fixedRow.locator('[data-testid$="-amount"]');
  await fixedAmount.fill("7.5");
  await expect(fixedAmount).toHaveValue("7.5");
  await expect(fixedRow.getByRole("alert")).toContainText("固定总额必须填写完整整数");

  await page.getByTestId("quotation-allocation-open").click();
  const target = page.getByTestId("quotation-allocation-target");
  await target.fill("12.5");
  await expect(target).toHaveValue("12.5");
  await page.getByTestId("quotation-allocation-preview").click();
  await expect(page.getByTestId("quotation-allocation-dialog").getByRole("alert")).toContainText("整数");
  await expect(page.getByTestId("quotation-allocation-apply")).toBeDisabled();
});

test("二次自然语言整理只更新检查事实，保留人工报价翻译、优惠、固定费用和稳定 ID", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" }));
  });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const laborGroup = page.getByTestId("quotation-group-labor");
  const laborRow = laborGroup.locator('[data-testid^="quotation-unit-row-"]').first();
  const laborTestId = await laborRow.getAttribute("data-testid");
  await laborRow.locator('[data-testid$="-desc-en"]').fill("Manual engine diagnosis");
  await laborRow.locator('[data-testid$="-unit-discount"]').fill("1250");
  await page.getByTestId("quotation-add-other").click();
  const fixedRow = page.getByTestId("quotation-group-other_service").locator('[data-testid^="quotation-other-row-"]').last();
  await fixedRow.locator('[data-testid$="-desc"]').fill("人工拖车费");
  await fixedRow.locator('[data-testid$="-amount"]').fill("7500");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  const savedFixedTestId = await page.getByTestId("quotation-group-other_service").locator('[data-testid^="quotation-other-row-"]').last().getAttribute("data-testid");

  await page.getByTestId("ir-draft-raw").fill("二次检查发动机，诊断工时 15000\n外派服务 6000");
  await page.getByTestId("ir-draft-parse").click();
  await expect(page.getByTestId("ir-draft-preview")).toBeVisible();
  await page.getByTestId("ir-draft-save").click();
  await expect(page.getByTestId("ir-draft-status")).toContainText("保留人工报价");
  const laborAfter = laborGroup.locator(`[data-testid="${laborTestId}"]`);
  await expect(laborAfter.locator('[data-testid$="-desc-en"]')).toHaveValue("Manual engine diagnosis");
  await expect(laborAfter.locator('[data-testid$="-unit-discount"]')).toHaveValue("1250");
  await expect(page.getByTestId("quotation-group-other_service").locator(`[data-testid="${savedFixedTestId}"]`).locator('[data-testid$="-amount"]')).toHaveValue("7500");
  const laborDescriptions = page.getByTestId("quotation-group-labor").locator('[data-testid$="-desc"]');
  await expect(laborDescriptions).toHaveCount(2);
  await expect(laborDescriptions.last()).toHaveValue(/二次检查发动机/);
  await expect(page.getByTestId("quotation-group-labor").locator('[data-testid$="-unit-price"]').last()).toHaveValue("15000");
  const fixedDescriptions = page.getByTestId("quotation-group-other_service").locator('[data-testid$="-desc"]');
  await expect(fixedDescriptions).toHaveCount(2);
  await expect(fixedDescriptions.last()).toHaveValue(/外派服务/);
  await expect(page.getByTestId("quotation-group-other_service").locator('[data-testid$="-amount"]').last()).toHaveValue("6000");
});

test("AI 预览后人工报价已保存，draft save 从最新 Quotation 合并而不回滚", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await page.getByTestId("ir-draft-raw").fill("新增诊断工时 10000");
  await page.getByTestId("ir-draft-parse").click();
  await expect(page.getByTestId("ir-draft-preview")).toBeVisible();

  const labor = page.getByTestId("quotation-group-labor");
  await labor.locator('[data-testid$="-desc"]').first().fill("预览后人工修改");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
  await expect(labor.locator('[data-testid$="-desc"]').first()).toHaveValue("预览后人工修改");

  await page.getByTestId("ir-draft-save").click();
  await expect(page.getByTestId("ir-draft-status")).toContainText("已保存");
  await expect(labor.locator('[data-testid$="-desc"]').first()).toHaveValue("预览后人工修改");
  await expect(labor.locator('[data-testid$="-unit-price"]')).toHaveCount(2);
  await expect(labor.locator('[data-testid$="-unit-price"]').last()).toHaveValue("10000");
});

test("AI 整理进行中修改原文会丢弃旧响应，不能重建过期预览", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ content: JSON.stringify({ items: [{
          findingZh: "旧原文检查",
          findingEn: "Old inspection",
          recommendationZh: "旧原文工时",
          recommendationEn: "Old labor",
          pricingMode: "unit",
          category: "labor",
          quantity: 1,
          amountJmd: 10_000,
          pendingQuote: false,
        }] }) }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ content: JSON.stringify({ zh: "旧报告", en: "Old report" }) }),
    });
  });
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e", model: "deepseek-chat" })));
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const raw = page.getByTestId("ir-draft-raw");
  await raw.fill("旧原文工时 10000");
  await page.getByTestId("ir-draft-parse").click();
  await expect.poll(() => requestCount).toBe(1);
  await raw.fill("新原文工时 20000");
  await expect(page.getByTestId("ir-draft-parse")).toContainText("AI 拆分");
  await expect(raw).toHaveValue("新原文工时 20000");
  await expect(page.getByTestId("ir-draft-preview")).toHaveCount(0);
  await expect(page.getByTestId("ir-draft-save")).toHaveCount(0);
});

test("客户回复推进 revision 不清空 Quotation、BO 勾选、照片意图或进行中 AI 预览", async ({ page }) => {
  let releaseAi!: () => void;
  const aiGate = new Promise<void>((resolve) => { releaseAi = resolve; });
  let aiRequests = 0;
  await page.route("**/api/ai/chat", async (route) => {
    aiRequests += 1;
    if (aiRequests === 1) {
      await aiGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ content: JSON.stringify({ items: [{
          findingZh: "通信刷新后仍有的 AI 预览",
          findingEn: "AI preview survives communication refresh",
          recommendationZh: "建议检查",
          recommendationEn: "Inspect",
          pricingMode: "unit",
          category: "labor",
          quantity: 1,
          amountJmd: 12_000,
          pendingQuote: false,
        }] }) }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ content: JSON.stringify({ zh: "通信刷新后仍有的 AI 报告", en: "AI report survives communication refresh" }) }),
    });
  });
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e", model: "deepseek-chat" })));
  await page.goto("/orders/inspections/inspection-report-demo-01");
  await expect(page.getByTestId("ir-detail-page")).toBeVisible();
  const canonicalBefore = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return {
      quotation: state.currentQuotations.find((item: { inspectionReportId: string }) => item.inspectionReportId === "inspection-report-demo-01"),
      photoIds: state.inspectionReports.find((item: { id: string }) => item.id === "inspection-report-demo-01").photoIds,
    };
  });
  const laborDescription = page.getByTestId("quotation-group-labor").locator('[data-testid$="-desc"]').first();
  const quotationNote = page.getByTestId("quotation-note-zh");
  const boCheckbox = page.getByTestId("quotation-group-labor").locator('[data-testid$="-bo"]').first();
  await laborDescription.fill("未保存工时 sentinel");
  await quotationNote.fill("未保存报价备注 sentinel");
  await boCheckbox.check();
  await page.getByTestId("ir-photo-input").setInputFiles({
    name: "unsaved-during-response.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await expect(page.locator('img[alt^="待上传现场照片"]')).toHaveCount(1);
  await page.getByTestId("ir-draft-raw").fill("通信刷新期间 AI 原文 sentinel");
  await page.getByTestId("ir-draft-parse").click();
  await expect.poll(() => aiRequests).toBe(1);

  await page.getByRole("radio", { name: "有意向" }).check();
  await page.getByTestId("ir-response-note").fill("推进全局 revision 但不清本地草稿");
  await page.getByTestId("ir-response-save").click();
  await expect(page.getByTestId("ir-communications-status")).toContainText("客户回复已追加");
  await expect(laborDescription).toHaveValue("未保存工时 sentinel");
  await expect(quotationNote).toHaveValue("未保存报价备注 sentinel");
  await expect(boCheckbox).toBeChecked();
  await expect(page.locator('img[alt^="待上传现场照片"]')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("wh_linked_operations_state_v1") ?? "null");
    return {
      quotation: state.currentQuotations.find((item: { inspectionReportId: string }) => item.inspectionReportId === "inspection-report-demo-01"),
      photoIds: state.inspectionReports.find((item: { id: string }) => item.id === "inspection-report-demo-01").photoIds,
    };
  })).toEqual(canonicalBefore);

  releaseAi();
  await expect(page.getByTestId("ir-draft-preview")).toContainText("通信刷新后仍有的 AI 预览", { timeout: 5_000 });
  await expect(page.getByTestId("ir-draft-raw")).toHaveValue("通信刷新期间 AI 原文 sentinel");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存", { timeout: 10_000 });
  await expect(page.locator('img[alt^="待上传现场照片"]')).toHaveCount(1);
  await page.getByTestId("ir-photo-save").click();
  await expect(page.getByTestId("ir-photo-status")).toContainText("照片已保存（1 张）");
});

test("已签高优惠后 AI 追加明确收费可收集新笔迹并原子落地", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const labor = page.getByTestId("quotation-group-labor");
  await labor.locator('[data-testid$="-unit-discount"]').first().fill("50000");
  await page.getByTestId("quotation-save").click();
  let pad = page.getByTestId("quotation-discount-signature");
  let box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 20, box!.y + 24);
  await page.mouse.down();
  await page.mouse.move(box!.x + 110, box!.y + 72, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-signature-confirm").click();
  await expect(page.getByTestId("quotation-signature-dialog")).toHaveCount(0);
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");

  await page.getByTestId("ir-draft-raw").fill("新工时 10000");
  await page.getByTestId("ir-draft-parse").click();
  await page.getByTestId("ir-draft-save").click();
  await expect(page.getByTestId("quotation-signature-dialog")).toBeVisible();
  pad = page.getByTestId("quotation-discount-signature");
  box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 28, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 118, box!.y + 78, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-signature-confirm").click();
  await expect(page.getByTestId("quotation-signature-dialog")).toHaveCount(0);
  await expect(page.getByTestId("ir-draft-status")).toContainText("已保存");
  await expect(labor.locator('[data-testid$="-unit-price"]')).toHaveCount(2);
  await expect(labor.locator('[data-testid$="-unit-price"]').last()).toHaveValue("10000");
});

test("AI 明确 fixed_total 其他费用可单独预览并创建，不伪装成配件待报价", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_ai_settings_v1", JSON.stringify({ provider: "off", apiKey: "", model: "deepseek-chat" })));
  await page.goto("/orders/inspections");
  await page.getByTestId("ir-create-open").click();
  await page.getByTestId("ir-create-vehicle-search").fill("7012 AB");
  await page.getByTestId("ir-create-vehicle-option-VEH-UAT-001").click();
  await page.getByTestId("ir-create-raw").fill("拖车费 7500");
  await page.getByTestId("ir-create-parse").click();
  const preview = page.getByTestId("ir-create-items");
  await expect(preview).toContainText("其他费用");
  await expect(preview).toContainText("7,500");
  await expect(preview).not.toContainText("配件清单 · 另报");
  await page.getByTestId("ir-create-submit").click();
  await expect(page).toHaveURL(/\/orders\/inspections\/inspection-report-new-\d+$/);
  const fixed = page.getByTestId("quotation-group-other_service").locator('[data-testid^="quotation-other-row-"]');
  await expect(fixed).toHaveCount(1);
  await expect(fixed.locator('[data-testid$="-amount"]')).toHaveValue("7500");
});

test("Quotation 优惠门槛等号不签字，工时与配件同时严格超线只出现一个签字板", async ({ page }) => {
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const laborRow = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await laborRow.locator('[data-testid$="-unit-discount"]').fill("40000");
  await page.getByTestId("quotation-save").click();
  await expect(page.getByTestId("quotation-signature-dialog")).toHaveCount(0);
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");

  const partsRow = page.getByTestId("quotation-group-parts").locator('[data-testid^="quotation-unit-row-"]').first();
  await laborRow.locator('[data-testid$="-unit-discount"]').fill("40001");
  await partsRow.locator('[data-testid$="-pending"]').uncheck();
  await partsRow.locator('[data-testid$="-unit-price"]').fill("8000");
  await partsRow.locator('[data-testid$="-unit-discount"]').fill("1001");
  await page.getByTestId("quotation-save").click();
  const signature = page.getByTestId("quotation-signature-dialog");
  await expect(signature).toBeVisible();
  await expect(signature.getByTestId("quotation-discount-signature")).toHaveCount(1);
  await page.getByTestId("quotation-signature-cancel").click();
  await expect(signature).toHaveCount(0);
  await expect(laborRow.locator('[data-testid$="-unit-discount"]')).toHaveValue("40001");
  await expect(partsRow.locator('[data-testid$="-unit-discount"]')).toHaveValue("1001");
});

test("Quotation 签字写入失败保留编辑和原始笔迹，同一意图重试成功", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      failNext: { byAction: { "inspection.quotation.update.write": "报价写入故障" } },
    };
  });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  const laborRow = page.getByTestId("quotation-group-labor").locator('[data-testid^="quotation-unit-row-"]').first();
  await laborRow.locator('[data-testid$="-unit-discount"]').fill("40001");
  await page.getByTestId("quotation-save").click();
  const pad = page.getByTestId("quotation-discount-signature");
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 20, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 100, box!.y + 70, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId("quotation-signature-confirm").click();
  await expect(page.getByTestId("quotation-signature-dialog")).toBeVisible();
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价写入故障");
  await expect(laborRow.locator('[data-testid$="-unit-discount"]')).toHaveValue("40001");
  await page.getByTestId("quotation-signature-confirm").click();
  await expect(page.getByTestId("quotation-signature-dialog")).toHaveCount(0);
  await expect(page.getByTestId("inspection-quotation").getByRole("status")).toContainText("报价已保存");
});

test("Quotation 其他费用与优惠弹层在 430px 内局部滚动且根页面不横溢", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/orders/inspections/inspection-report-demo-01");
  for (const group of ["labor", "parts", "other_service"] as const) {
    const scroll = page.getByTestId(`quotation-group-scroll-${group}`);
    await expect(scroll).toBeVisible();
    expect(await scroll.evaluate((node) => node.scrollWidth >= node.clientWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.getByTestId("quotation-allocation-open").click();
  const dialog = page.getByTestId("quotation-allocation-dialog");
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.width).toBe(430);
  const cards = dialog.locator('[data-testid^="quotation-allocation-card-"]');
  await expect(cards.first()).toBeVisible();
  const cardBoxes = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(new Set(cardBoxes.map((box) => Math.round(box.x))).size).toBe(1);
});
