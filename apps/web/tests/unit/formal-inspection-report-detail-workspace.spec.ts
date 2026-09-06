import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const detail = readFileSync(
  resolve(process.cwd(), "src/components/orders/formal-inspection-report-detail.tsx"),
  "utf8",
);
const inspectionPresentation = readFileSync(
  resolve(process.cwd(), "src/lib/inspection/formal-inspection-ai.ts"),
  "utf8",
);
const settings = readFileSync(resolve(process.cwd(), "src/app/settings/page.tsx"), "utf8");

test("formal inspection detail is a five-workspace report rather than one summary card", () => {
  for (const workspace of ["inspection", "report", "followup", "attachments", "history"]) {
    expect(detail).toContain(`inspection-report-${workspace}-workspace`);
  }
  expect(detail).toContain("检查与报价");
  expect(detail).toContain("正式报告");
  expect(detail).toContain("客户跟进");
  expect(detail).toContain("业务附件");
  expect(detail).toContain("历史记录");
  expect(detail).not.toContain("数据层尚未启用");
});

test("inspection and quotation workspace makes the AI result the primary bilingual work draft", () => {
  expect(detail).toContain("维修工原始回单");
  expect(detail).toContain("AI 整理并翻译");
  expect(detail).toContain("告诉 AI 怎么改");
  expect(detail).toContain("报价待补");
  expect(detail).toContain('data-testid="inspection-primary-workspace"');
  expect(detail).toContain('data-testid="inspection-quote-table"');
  expect(detail).toContain('data-testid="inspection-ai-rail"');
  expect(detail).toContain("AI 草稿已进入主工作区");
  expect(detail).toContain("保存 AI 草稿");
});

test("inspection quotation uses the same financial columns and discount summary as Business Order charges", () => {
  for (const label of ["单位", "数量", "含税单价", "本项折扣", "小计"]) {
    expect(detail).toContain(label);
  }
  for (const label of ["工时合计", "配件合计", "其他费用合计", "整单优惠", "折后报价"]) {
    expect(detail).toContain(label);
  }
  expect(detail).toContain('aria-label={english ? "Item discount JMD" : "本项折扣 JMD"}');
  expect(detail).toContain('aria-label={english ? "Whole-order discount JMD" : "整单优惠 JMD"}');
});

test("formal report status is presented as a four-stage customer flow", () => {
  expect(detail).toContain("inspectionFollowupStageLabel");
  expect(inspectionPresentation).toContain("整理确认");
  expect(inspectionPresentation).toContain("待发送");
  expect(inspectionPresentation).toContain("待回复");
  expect(inspectionPresentation).toContain("已闭环");
  expect(detail).toContain("更正跟进状态");
  expect(detail).toContain("更正只追加记录，不删除旧历史");
});

test("formal report is an isolated, true A4 print surface with bilingual content selection", () => {
  expect(detail).toContain('id="inspection-report-print-sheet"');
  expect(detail).toContain("size: A4");
  expect(detail).toContain("width: 210mm");
  expect(detail).toContain("min-height: 297mm");
  expect(detail).toContain('summaryEn ?? "English translation pending"');
  expect(detail).toContain('findingEn ?? "English translation pending"');
  expect(detail).toContain("中文版");
  expect(detail).toContain("English");
  expect(detail).toContain("中英对照版");
  expect(detail).toContain('type ReportLanguage = "zh" | "en" | "bilingual"');
  expect(detail).toContain("英文检查结论");
  expect(detail).toContain("英文问题描述");
  expect(detail).toContain("英文处理建议");
  expect(detail).toContain("英文重要备注");
});

test("header gives vehicle and customer information first-class visual weight", () => {
  expect(detail).toContain('data-testid="inspection-report-vehicle"');
  expect(detail).toContain('data-testid="inspection-report-customer"');
  expect(detail).toContain("text-lg font-bold");
});

test("SMS uses the formal provider route and never opens a local sms deep link", () => {
  expect(detail).toContain("sendFormalInspectionSms");
  expect(detail).not.toContain("`sms:${target}");
  expect(detail).toContain("短信由系统接口直接发送");
});

test("follow-up corrections and replies are distinct append-only history facts", () => {
  expect(detail).toContain('eventKind: "status_correction"');
  expect(detail).toContain('eventKind: "reply"');
  expect(detail).toContain("更正跟进状态");
  expect(detail).toContain("客户通知未送达");
});

test("attachments workspace only advertises actions that actually work", () => {
  expect(detail).toContain("打开已归档文件");
  expect(detail).toContain("查看来源业务单附件");
  expect(detail).not.toContain("补充附件将归档");
});

test("settings explains the current SMS and WhatsApp service boundaries", () => {
  expect(settings).toContain("检查报告短信通过服务器端接口发送");
  expect(settings).toContain("WhatsApp 继续由前台打开会话并发送");
});
