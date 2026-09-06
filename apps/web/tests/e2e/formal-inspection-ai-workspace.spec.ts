import { expect, test } from "@playwright/test";

const mechanicReturn = [
  "1 Clean the throttle body first, then carry out further inspection — Labor: 15,000 JMD(先清洗节气门,再进一步检查)",
  "2 Cleaning agent ×1 bottle — 800 JMD(清洗剂1瓶)",
].join("\n");

const detail = {
  report: {
    id: 1,
    reportNo: "IR-20260829-0001",
    vehicleId: 1,
    sourceBusinessOrderId: null,
    sourceRepairRoundId: null,
    correctionOfReportId: null,
    correctionReason: null,
    inspectionTeamId: 1,
    summaryZh: mechanicReturn,
    summaryEn: null,
    specialCaseNotesZh: null,
    actualInspectorStaffMemberId: null,
    paperPhotoFileId: null,
    status: "draft",
    createdAt: "2026-08-29T16:18:00.000Z",
    submittedAt: null,
    version: 1,
    findings: [],
  },
  vehicle: { id: 1, plate: "4321 AB", description: "Nissan X-Trail" },
  customer: { name: "David Blake", phone: "+18765550102", whatsapp: null, email: null },
  inspectorName: null,
  teamName: "车间一组",
  sourceBusinessOrder: null,
  communications: [],
  workspace: {
    versionNo: 0,
    source: "original",
    changeReason: "Original return",
    createdAt: "2026-08-29T16:18:00.000Z",
    createdBy: 1,
    organized: {
      summaryZh: mechanicReturn,
      summaryEn: null,
      specialCaseNotesZh: null,
      specialCaseNotesEn: null,
      findings: [],
    },
    quotation: { status: "pending", noteZh: "报价待补", noteEn: "Price pending", lines: [] },
  },
};

test("AI result becomes the primary bilingual report and extracts explicit quote lines", async ({ context, page }, testInfo) => {
  await context.addCookies([{ name: "wh_session", value: "visual-qa", url: "http://127.0.0.1:3220" }]);
  await page.route("**/api/formal/auth/session", (route) => route.fulfill({
    json: {
      account: {
        id: 1,
        displayName: "Visual QA",
        role: "super_admin",
        delegatedPermissions: [],
        uiLanguage: "zh",
      },
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  }));
  await page.route("**/api/formal/inspection-reports/1", (route) => route.fulfill({ json: detail }));
  await page.route("**/api/ai/chat", (route) => route.fulfill({
    json: {
      content: JSON.stringify({
        organized: {
          summaryZh: "先清洗节气门，再进行进一步检查；需要使用一瓶清洗剂。",
          summaryEn: null,
          specialCaseNotesZh: null,
          specialCaseNotesEn: null,
          findings: [],
        },
        quotation: { status: "pending", noteZh: null, noteEn: null, lines: [] },
      }),
    },
  }));

  await page.goto("/orders/inspections/1");
  await expect(page.getByTestId("inspection-primary-workspace")).toBeVisible();
  await expect(page.getByTestId("inspection-ai-rail")).toBeVisible();
  await page.getByRole("button", { name: "AI 整理并翻译" }).click();
  await expect(page.getByText("AI 草稿已进入主工作区")).toBeVisible();
  await expect(page.getByTestId("inspection-primary-workspace")).toContainText("Clean the throttle body");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("工时");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("配件");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("节气门清洗工时");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("先清洗节气门，再进一步检查");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("清洗剂");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("1 bottle");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("JMD 15,000.00");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("JMD 800.00");
  await expect(page.getByTestId("inspection-quote-table")).toContainText("JMD 15,800.00");
  await page.getByTestId("inspection-quote-table").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("inspection-ai-quotation.png"), fullPage: true });
  await page.getByRole("button", { name: "编辑报告" }).click();
  await expect(page.getByLabel("中文项目描述").first()).toHaveValue("先清洗节气门，再进一步检查");
  await expect(page.getByRole("group", { name: "报价项目 1 分类" })).toContainText("工时");
  await expect(page.getByRole("group", { name: "报价项目 1 分类" })).toContainText("配件");
  await expect(page.getByRole("group", { name: "报价项目 1 分类" })).toContainText("其他 / 待确认");
  await page.screenshot({ path: testInfo.outputPath("inspection-ai-editor.png"), fullPage: true });
});

test("quotation shows and edits item discounts plus the whole-order discount", async ({ context, page }) => {
  const discountedDetail = {
    ...detail,
    workspace: {
      ...detail.workspace,
      quotation: {
        status: "entered",
        noteZh: null,
        noteEn: null,
        wholeOrderDiscountMinor: 50_000,
        lines: [
          {
            kind: "labor",
            nameZh: "发动机诊断工时",
            nameEn: "Engine diagnosis labor",
            descriptionZh: "读取故障码并检查发动机运行",
            descriptionEn: "Read fault codes and inspect engine operation",
            quantity: "2",
            unitPriceMinor: 1_000_000,
            itemDiscountMinor: 10_000,
            subtotalMinor: 1_990_000,
          },
          {
            kind: "part",
            nameZh: "机油滤清器",
            nameEn: "Engine oil filter",
            descriptionZh: "更换适配车型的机油滤清器",
            descriptionEn: "Replace the correct engine oil filter",
            quantity: "1",
            unitPriceMinor: 550_000,
            itemDiscountMinor: 70_000,
            subtotalMinor: 480_000,
          },
        ],
      },
    },
  };

  await context.addCookies([{ name: "wh_session", value: "visual-qa", url: "http://127.0.0.1:3220" }]);
  await page.route("**/api/formal/auth/session", (route) => route.fulfill({
    json: { account: { id: 1, displayName: "Visual QA", role: "super_admin", delegatedPermissions: [], uiLanguage: "zh" }, expiresAt: "2099-01-01T00:00:00.000Z" },
  }));
  await page.route("**/api/formal/inspection-reports/1", (route) => route.fulfill({ json: discountedDetail }));

  await page.goto("/orders/inspections/1");
  const quote = page.getByTestId("inspection-quote-table");
  await expect(quote).toContainText("单位");
  await expect(quote).toContainText("含税单价");
  await expect(quote).toContainText("本项折扣");
  await expect(quote).toContainText("整单优惠");
  await expect(quote).toContainText("折后报价");
  await expect(quote).toContainText("JMD 24,200.00");

  await page.getByRole("button", { name: "编辑报告" }).click();
  await expect(page.getByLabel("本项折扣 JMD").first()).toHaveValue("100");
  await expect(page.getByLabel("本项折扣 JMD").nth(1)).toHaveValue("700");
  await expect(page.getByLabel("整单优惠 JMD")).toHaveValue("500");
  await expect(page.getByTestId("inspection-quotation-editor")).toContainText("JMD 24,200.00");

  await page.getByRole("button", { name: "完成编辑" }).click();
  await page.getByRole("tab", { name: "正式报告" }).click();
  const printSheet = page.locator("#inspection-report-print-sheet");
  for (const label of ["单位", "数量", "含税单价", "本项折扣", "小计", "整单优惠", "折后报价"]) {
    await expect(printSheet).toContainText(label);
  }
  await expect(printSheet).toContainText("JMD 24,200.00");
});
