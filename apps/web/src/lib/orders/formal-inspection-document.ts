import type { FormalInspectionQuotation, FormalInspectionReportDetail } from "../api/formal-inspections";
import { calculateInspectionQuotationLineSubtotalMinor, summarizeInspectionQuotation, inspectionVehicleDescriptionForReport, inspectionTeamNameForReport } from "../inspection/formal-inspection-ai";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "../company-identity";

export type InspectionDocumentLanguage = "zh" | "en" | "bilingual";
type Kind = FormalInspectionQuotation["lines"][number]["kind"];
export const quotationStatusLabel = { pending: ["报价待补", "Price pending"], entered: ["已报价", "Quoted"], not_quoted: ["本次不报价", "No quote"] } as const;
export function inspectionMoney(minor: number | null, english = false): string {
  return minor === null ? (english ? "Pending" : "待补") : `JMD ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function quotationDisplayStatus(quotation: FormalInspectionQuotation, kind?: Kind) {
  if (quotation.status === "not_quoted") return "not_quoted";
  const lines = kind ? quotation.lines.filter((line) => line.kind === kind) : quotation.lines;
  return quotation.status === "entered" && quotation.lines.length > 0 && lines.every((line) => (line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line)) !== null) ? "entered" : "pending";
}
export function quotationAmount(quotation: FormalInspectionQuotation, amount: number, english: boolean, kind?: Kind) {
  const status = quotationDisplayStatus(quotation, kind);
  return status === "entered" ? inspectionMoney(amount) : quotationStatusLabel[status][english ? 1 : 0];
}
export function quotationUnit(kind: Kind, english: boolean) {
  return kind === "labor" ? "JOB" : kind === "part" ? (english ? "Piece" : "件") : (english ? "Item" : "项");
}

/** One qualified money boundary shared by the screen and downloadable document. */
export function buildFormalInspectionDocument(detail: FormalInspectionReportDetail, language: InspectionDocumentLanguage) {
  const english = language === "en";
  const tr = (zh: string, en: string) => language === "bilingual" ? `${zh} / ${en}` : english ? en : zh;
  const copy = (zh: string | null | undefined, en: string | null | undefined) => {
    if (language === "zh") return zh?.trim() || "待补";
    if (english) return en?.trim() || "English translation pending";
    return `${zh?.trim() || "待补"}\n${en?.trim() || "English translation pending"}`;
  };
  const q = detail.workspace.quotation;
  const summary = summarizeInspectionQuotation(q);
  const organized = detail.workspace.organized;
  const team = inspectionTeamNameForReport(detail.teamName, language);
  return {
    language, company: WHOLE_HEARTED_COMPANY_IDENTITY, reportNo: detail.report.reportNo,
    title: tr("车辆检查报告与报价", "INSPECTION REPORT & QUOTATION"),
    identity: [
      [tr("车辆", "Vehicle"), `${detail.vehicle.plate} · ${inspectionVehicleDescriptionForReport(detail.vehicle, language)}`],
      [tr("客户", "Customer"), detail.customer.name || "—"],
      [tr("检查班组", "Inspection team"), [team.value, team.fallbackNote].filter(Boolean).join("\n")],
      [tr("日期", "Date"), new Intl.DateTimeFormat(english ? "en-GB" : "zh-CN", { timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(detail.workspace.createdAt))],
    ],
    conclusionTitle: tr("检查结论", "Inspection conclusion"), conclusion: copy(organized.summaryZh, organized.summaryEn),
    findingsTitle: tr("发现的问题与处理建议", "Findings and recommendations"),
    findings: organized.findings.map((finding, index) => `${index + 1}. ${copy(finding.findingZh, finding.findingEn)}\n${tr("处理建议", "Recommendation")}: ${copy(finding.recommendationZh, finding.recommendationEn)}`),
    quotationTitle: tr("报价", "Quotation"),
    note: q.noteZh || q.noteEn ? copy(q.noteZh, q.noteEn) : "",
    columns: [tr("项目名称", "Item"), tr("描述", "Description"), tr("单位", "Unit"), tr("数量", "Qty"), tr("含税单价", "Tax-inclusive price"), tr("本项折扣", "Item discount"), tr("小计", "Subtotal")],
    groups: (["labor", "part", "other"] as const).map((kind) => {
      const lines = q.lines.filter((line) => line.kind === kind);
      const label = kind === "labor" ? tr("工时", "Labor") : kind === "part" ? tr("配件 / 材料", "Parts / materials") : lines.some((line) => line.nameZh === "待确认项目") ? tr("分类待确认", "Classification pending") : tr("其他费用", "Other charges");
      return { kind, label, totalLabel: tr("分类合计", "Category total"), total: quotationAmount(q, summary.groups[kind].subtotalMinor, english, kind), rows: lines.map((line) => [
        copy(line.nameZh, line.nameEn), line.descriptionZh || line.descriptionEn ? copy(line.descriptionZh, line.descriptionEn) : "—",
        quotationUnit(line.kind, english), line.quantity, inspectionMoney(line.unitPriceMinor, english),
        (line.itemDiscountMinor ? "-" : "") + inspectionMoney(line.itemDiscountMinor ?? 0),
        inspectionMoney(line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line), english),
      ]) };
    }).filter((group) => group.rows.length > 0),
    totals: [[tr("原报价", "Original quote"), quotationAmount(q, summary.grossMinor, english)], [tr("本项折扣合计", "Item discounts"), `-${inspectionMoney(summary.itemDiscountMinor)}`], [tr("整单优惠", "Whole-order discount"), `-${inspectionMoney(summary.wholeOrderDiscountMinor)}`]],
    totalLabel: tr("折后报价", "Discounted quote"), total: quotationAmount(q, summary.totalDueMinor, english),
    notesTitle: tr("重要备注与责任界限", "Important notes and limitations"), notes: organized.specialCaseNotesZh || organized.specialCaseNotesEn ? copy(organized.specialCaseNotesZh, organized.specialCaseNotesEn) : "",
    signatures: [tr("客户确认", "Customer acknowledgement"), tr("前台 / 日期", "Front desk / Date")],
  };
}
export type FormalInspectionDocument = ReturnType<typeof buildFormalInspectionDocument>;
