import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formalGroupedChargeDiscounts } from "../../src/lib/api/formal-business-orders";

const detail = () => readFileSync(resolve(process.cwd(), "src/components/orders/formal-business-order-detail.tsx"), "utf8");
const component = (name: string) => readFileSync(resolve(process.cwd(), `src/components/${name}`), "utf8");

test("派单用维修班组按钮选择，不使用下拉菜单", () => {
  const source = detail();
  expect(source).toMatch(/type="radio"/);
  expect(source).toMatch(/name="teamId"/);
  expect(source).not.toMatch(/<select name="teamId"/);
});

test("收费项目有显式编辑入口并保存新版本", () => {
  const source = detail();
  expect(source).toMatch(/编辑收费项目/);
  expect(source).toMatch(/保存收费项目/);
  expect(source).toMatch(/replaceFormalChargeVersion/);
  expect(source).toMatch(/自然语言录入/);
  expect(source).toMatch(/naturalLanguageOpen/);
});

test("收费汇总不重复显示清单中已有的本项折扣", () => {
  const source = detail();
  const summaryStart = source.indexOf('<div className="mt-4 grid gap-2 border-t border-line pt-3');
  const summaryEnd = source.indexOf('{charges.notes.length', summaryStart);
  const summary = source.slice(summaryStart, summaryEnd);

  expect(summaryStart).toBeGreaterThan(-1);
  expect(summaryEnd).toBeGreaterThan(summaryStart);
  expect(summary).not.toContain("<span>本项折扣");
});

test("收费汇总按工时、配件和其他费用归集每行本项折扣", () => {
  expect(formalGroupedChargeDiscounts({
    items: [
      { kind: "labor", itemDiscountMinor: 100_000 },
      { kind: "part", itemDiscountMinor: 50_000 },
      { kind: "other", itemDiscountMinor: 25_000 },
    ],
    totals: {
      laborDiscountMinor: 0,
      partDiscountMinor: 10_000,
      otherDiscountMinor: 0,
    },
  })).toEqual({
    laborDiscountMinor: 100_000,
    partDiscountMinor: 60_000,
    otherDiscountMinor: 25_000,
  });
});

test("日常收费编辑只保留每行本项折扣并清零旧整单折扣", () => {
  const source = detail();
  expect(source).not.toContain('name="laborDiscount"');
  expect(source).not.toContain('name="partDiscount"');
  expect(source).not.toContain('name="otherDiscount"');
  expect(source).not.toContain('name="wholeOrderDiscount"');
  expect(source).not.toContain('<span>整单折扣');
  expect(source).toContain('wholeOrderDiscount: "0"');
  expect(source).toContain('laborDiscount: "0"');
  expect(source).toContain('partDiscount: "0"');
  expect(source).toContain('otherDiscount: "0"');
});

test("金额输入聚焦时直接选中旧值避免零前缀", () => {
  const source = detail();
  expect(source).toContain('aria-label={english ? "Item discount" : "本项折扣"}');
  expect(source).toContain('onFocus={(event) => event.currentTarget.select()}');
});

test("备注可随收费版本编辑且自然语言会同步整理备注", () => {
  const source = detail();
  expect(source).toMatch(/ChargeDraftNote/);
  expect(source).toMatch(/aiParseFormalChargeEntry/);
  expect(source).toMatch(/客户反馈/);
  expect(source).toMatch(/施工说明/);
  expect(source).toMatch(/责任说明 \/ 提前告知/);
  expect(source).toMatch(/notes: chargeNoteDraft/);
});

test("收费行和备注都能逐项翻译且保存反馈留在表单位置", () => {
  const source = detail();
  expect(source).toMatch(/translateChargeDraftItem/);
  expect(source).toMatch(/translateChargeNoteDraft/);
  expect(source).toMatch(/Translate charge item/);
  expect(source).toMatch(/翻译收费项目/);
  expect(source).toMatch(/Translate note/);
  expect(source).toMatch(/翻译备注/);
  expect(source).toMatch(/chargeActionError/);
  expect(source).toMatch(/chargeActionNotice/);
});

test("费用承担方和有效联系方式压缩到顶部且不保留独立客户卡片", () => {
  const source = detail();
  expect(source).not.toContain(">客户与车辆</h2>");
  expect(source).toMatch(/费用承担/);
  expect(source).not.toContain('order.payer.contactName ?? "—"');
  expect(source).not.toContain('order.payer.phone ?? "未填写"');
  expect(source).not.toContain('order.payer.trn ?? "未填写"');
});

test("正式交单前可撤回当前维修轮次再重新派单", () => {
  const source = detail();
  expect(source).toMatch(/withdraw_assignment/);
  expect(source).toMatch(/撤回派单/);
});

test("收款和退款通过可关闭的浮窗填写", () => {
  const source = detail();
  expect(source).toMatch(/登记收款/);
  expect(source).toMatch(/生成退款/);
  expect(source).toMatch(/paymentFormOpen/);
  expect(source).toMatch(/refundFormOpen/);
  expect(source).toMatch(/ActionDialog/);
  expect(component("shared/action-dialog.tsx")).toMatch(/role="dialog"/);
});

test("收费编辑与保存占用同一个标题操作位置", () => {
  const source = detail();
  expect(source).toMatch(/type=\{chargeEditing \? "submit" : "button"\}/);
  expect(source).toMatch(/Save charges/);
  expect(source).toMatch(/保存收费项目/);
  expect(source).toMatch(/Edit charges/);
  expect(source).toMatch(/编辑收费项目/);
  expect(source).toMatch(/取消编辑/);
  expect(source).toMatch(/新增工时/);
  expect(source).toMatch(/新增配件/);
  expect(source).toMatch(/新增其他费用/);
  expect(source).toMatch(/新增备注/);
});

test("单据工作区直接提供真实 A4 PDF 预览、下载、系统打印和业务附件中心", () => {
  const source = detail();
  expect(source).toMatch(/FormalBusinessOrderDocumentsWorkspace/);
  const workspace = component("orders/formal-business-order-documents-workspace.tsx");
  expect(workspace).toMatch(/正式 A4 单据/);
  expect(workspace).toMatch(/下载 PDF/);
  expect(workspace).toMatch(/PdfCanvasPreview/);
  expect(workspace).not.toMatch(/<iframe/);
  expect(workspace).not.toMatch(/编辑文字/);
  expect(workspace).not.toMatch(/保存新版本/);
  expect(workspace).not.toMatch(/business-document-a4-editor/);
  expect(workspace).toMatch(/系统打印/);
  expect(workspace).toMatch(/业务附件/);
  expect(workspace).toMatch(/中文/);
  expect(workspace).toMatch(/English/);
  expect(workspace).toMatch(/language: documentLanguage/);
});

test("历史工作区默认使用简洁时间线并可展开字段明细", () => {
  const source = detail();
  expect(source).toMatch(/FormalBusinessOrderHistoryTimeline/);
  expect(component("orders/formal-business-order-history-timeline.tsx")).toMatch(/查看修改明细/);
});

test("退款先落账再打印纸质签收单并可选回传签字件", () => {
  const source = detail();
  expect(source).not.toContain("SignaturePad");
  expect(source).not.toContain("formal-refund-signature");
  expect(source).not.toContain("现金退款必须由客户");
  expect(source).toMatch(/打印退款签收单/);
  expect(source).toMatch(/上传签字后的退款签收单/);
  expect(source).toMatch(/appendFormalRefundSignedAcknowledgement/);
});

test("维修中同时提供独立检查结果入口和纸质回单入口", () => {
  const source = detail();
  expect(source).toMatch(/新建检查结果/);
  expect(source).toMatch(/收到纸质回单/);
  expect(source).toMatch(/sourceBusinessOrderId/);
  expect(source).toMatch(/inspectionCreateOpen/);
  expect(source).toMatch(/paperReturnOpen/);
  expect(source).toMatch(/相关检查结果/);
  expect(source).not.toMatch(/orders\/inspections\?create=1/);
});

test("纸质回单表单默认不占用详情页，只在点击入口后显示并直接正式交单", () => {
  const source = detail();
  expect(source).toMatch(/paperReturnOpen/);
  expect(source).toMatch(/确认纸质回单并正式交单/);
  expect(source).toContain('name="actualStaffMemberId"');
  expect(source).toMatch(/action: "record_paper_return_and_formal_handoff"/);
  expect(source).toMatch(/一次确认完成正式交单/);
});

test("误触开始的空白售后轮次可以撤销回上一轮已交单状态", () => {
  const source = detail();
  expect(source).toMatch(/cancel_after_sales/);
  expect(source).toMatch(/撤销本轮/);
  expect(source).toMatch(/尚未产生任何实际记录/);
  expect(source).toMatch(/repairRoundVersion: rounds\.current\.version/);
});

test("交单后显示完成事实并把售后入口收成按钮", () => {
  const source = detail();
  expect(source).toMatch(/本轮维修已经正式交单/);
  expect(source).toMatch(/维修班组/);
  expect(source).toMatch(/本轮绩效/);
  expect(source).toMatch(/交单时间/);
  expect(source).toMatch(/售后回厂/);
  expect(source).toMatch(/afterSalesOpen/);
});

test("Business Order 详情提供可关闭的整单维修历史", () => {
  const source = detail();
  expect(source).toMatch(/查看整单历史/);
  expect(source).toMatch(/Business Order 全部维修历史/);
  expect(source).toMatch(/historyOpen/);
  expect(source).toMatch(/setHistoryOpen\(false\)/);
});

test("整单历史只展示中文业务流水，不泄漏内部事件名、字段名或 JSON", () => {
  const source = detail();
  expect(source).toMatch(/auditTrail/);
  expect(source).toMatch(/操作人/);
  expect(source).toMatch(/维修工提交维修回单，等待前台审核/);
  expect(source).toMatch(/前台审核通过并正式交单/);
  expect(source).toMatch(/登记收款/);
  expect(source).toMatch(/登记退款/);
  expect(source).not.toContain("ROUND_EVENT_LABELS[event.eventType] ?? event.eventType");
  expect(source).not.toContain("AUDIT_EVENT_LABELS[event.eventType] ?? event.eventType");
  expect(source).not.toContain("AUDIT_FIELD_LABELS[key] ?? key");
  expect(source).not.toContain("JSON.stringify(value)");
});

test("余额为零时明确显示财务已结清", () => {
  const source = detail();
  expect(source).toMatch(/isFinanciallySettled/);
  expect(source).toMatch(/财务已结清/);
});

test("每笔 Receipt 提供中文和英文打印入口", () => {
  const source = detail();
  expect(source).toContain("?copy=zh");
  expect(source).toContain("?copy=en");
  expect(source).toMatch(/中文 Receipt/);
  expect(source).toMatch(/English Receipt/);
});
