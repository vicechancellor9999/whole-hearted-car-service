import {
  formalBusinessOrderStatusLabel,
  formatFormalMoney,
} from "@/lib/api/formal-business-orders";
import type { FormalMasterData } from "@/lib/api/formal-master-data";
import type { UiLanguage } from "@/lib/i18n/catalog";

export type AuditPresentationChange = {
  key: string;
  label: string;
  before: string;
  after: string;
  hasBefore: boolean;
  hasAfter: boolean;
};

const EVENT_LABELS: Record<string, string> = {
  "business_order.created": "创建 Business Order",
  "business_order.assignment_withdrawn": "撤回维修班组派单",
  "business_order.round_accepted": "维修工接单",
  "business_order.intake_mileage_recorded": "记录接车里程",
  "business_order.work_return_submitted": "提交维修回单",
  "business_order.work_return_approved": "审核通过维修回单",
  "business_order.work_return_rejected": "退回维修回单",
  "business_order.formally_handed_off": "正式交单",
  "business_order.formal_handoff_cancelled": "取消本次正式交单",
  "business_order.performance_draft_set": "设置维修轮次绩效草稿",
  "business_order.performance_adjusted": "调整维修轮次绩效",
  "business_order.after_sales_round_started": "开始下一轮售后维修",
  "business_order.after_sales_round_cancelled": "删除售后维修轮次",
  "business_order.invalid_after_sales_round_deleted": "删除售后维修轮次",
  "business_order.charge_version_replaced": "修改收费项目和备注",
  "business_order.charges_replaced": "修改收费项目和备注",
  "business_order.document_generated": "生成正式打印文件",
  "business_order.document_reprinted": "补打正式打印文件",
  "business_order.document_revision_created": "保存打印单据修订",
  "business_order.voided": "删除 Business Order",
  "inspection_report.created": "创建检查报告",
  "inspection_report.submitted": "提交检查报告",
  "inspection_report.correction_created": "创建检查报告更正版",
  "inspection_report.workspace_version_appended": "保存检查报告新版本",
  "inspection_report.customer_reply_recorded": "登记客户回复",
  "inspection_report.followup_status_corrected": "更正客户跟进状态",
  "inspection_report.customer_notification_initiated": "登记向客户发送检查报告",
};

const EVENT_LABELS_EN: Record<string, string> = {
  "business_order.created": "Created Business Order",
  "business_order.assignment_withdrawn": "Withdrew repair-team assignment",
  "business_order.round_accepted": "Mechanic accepted the repair round",
  "business_order.intake_mileage_recorded": "Recorded intake mileage",
  "business_order.work_return_submitted": "Submitted work return",
  "business_order.work_return_approved": "Approved work return",
  "business_order.work_return_rejected": "Returned work return to repair team",
  "business_order.formally_handed_off": "Formally handed off repair round",
  "business_order.formal_handoff_cancelled": "Cancelled this formal handoff",
  "business_order.performance_draft_set": "Set repair-round performance draft",
  "business_order.performance_adjusted": "Adjusted repair-round performance",
  "business_order.after_sales_round_started": "Started the next after-sales repair round",
  "business_order.after_sales_round_cancelled": "Deleted an after-sales repair round",
  "business_order.invalid_after_sales_round_deleted": "Deleted an after-sales repair round",
  "business_order.charge_version_replaced": "Updated charges and notes",
  "business_order.charges_replaced": "Updated charges and notes",
  "business_order.document_generated": "Generated a formal print document",
  "business_order.document_reprinted": "Reprinted a formal print document",
  "business_order.document_revision_created": "Saved a print-document revision",
  "business_order.voided": "Deleted Business Order",
  "inspection_report.created": "Created inspection report",
  "inspection_report.submitted": "Submitted inspection report",
  "inspection_report.correction_created": "Created a corrected inspection report",
  "inspection_report.workspace_version_appended": "Saved a new inspection-report version",
  "inspection_report.customer_reply_recorded": "Recorded customer reply",
  "inspection_report.followup_status_corrected": "Corrected customer follow-up status",
  "inspection_report.customer_notification_initiated": "Recorded inspection report sent to customer",
};

const FIELD_LABELS: Record<string, string> = {
  status: "状态",
  roundNo: "维修轮次",
  teamId: "维修班组",
  assignedTeamId: "维修班组",
  workReturnId: "维修回单",
  actualStaffMemberId: "实际维修工",
  odometerKm: "接车里程",
  performanceMinor: "绩效值",
  performanceDraftMinor: "绩效草稿值",
  repairRoundNo: "维修轮次",
  amountMinor: "金额",
  balanceAfterMinor: "操作后未结余额",
  chargeVersionNo: "收费版本",
  documentNo: "打印文件编号",
  revisionNo: "打印修订",
  paymentNo: "收款编号",
  refundNo: "退款编号",
  receiptNo: "Receipt 编号",
  paymentMethodCode: "收退款方式",
  originalDocumentStatus: "原客户单据",
  evidenceKinds: "退款签收资料",
  category: "附件类别",
  mediaType: "文件类型",
  sizeBytes: "文件大小",
  issue: "售后问题",
  reason: "原因",
  note: "备注",
};

const FIELD_LABELS_EN: Record<string, string> = {
  status: "Status", roundNo: "Repair round", teamId: "Repair team", assignedTeamId: "Repair team",
  workReturnId: "Work return", actualStaffMemberId: "Actual mechanic", odometerKm: "Intake mileage",
  performanceMinor: "Performance value", performanceDraftMinor: "Performance draft value", repairRoundNo: "Repair round", amountMinor: "Amount", balanceAfterMinor: "Outstanding balance after action",
  chargeVersionNo: "Charge version", documentNo: "Print document number", revisionNo: "Print revision",
  paymentNo: "Payment number", refundNo: "Refund number", receiptNo: "Receipt number",
  paymentMethodCode: "Payment or refund method", originalDocumentStatus: "Original customer document",
  evidenceKinds: "Refund acknowledgement evidence", category: "Attachment category", mediaType: "File type",
  sizeBytes: "File size", issue: "After-sales issue", reason: "Reason", note: "Note",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  bank_transfer: "银行转账",
  card: "银行卡",
};
const PAYMENT_METHOD_LABELS_EN: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", card: "Card" };

const ORIGINAL_DOCUMENT_LABELS: Record<string, string> = {
  returned: "原客户单据已交回",
  unavailable: "原客户单据无法交回",
  not_required: "无需交回原客户单据",
};
const ORIGINAL_DOCUMENT_LABELS_EN: Record<string, string> = {
  returned: "Original customer document returned",
  unavailable: "Original customer document unavailable",
  not_required: "Original customer document not required",
};

const EVIDENCE_LABELS: Record<string, string> = {
  customer_signature: "客户签字的退款签收单",
  refund_proof: "退款凭证",
};
const EVIDENCE_LABELS_EN: Record<string, string> = {
  customer_signature: "Customer-signed refund acknowledgement",
  refund_proof: "Refund proof",
};

const ATTACHMENT_CATEGORY_LABELS: Record<string, string> = {
  customer_signature: "客户签字",
  service_photo: "服务照片",
  financial_evidence: "财务凭证",
  other: "其他",
};
const ATTACHMENT_CATEGORY_LABELS_EN: Record<string, string> = {
  customer_signature: "Customer signature",
  service_photo: "Service photo",
  financial_evidence: "Financial evidence",
  other: "Other",
};

const DELETION_REASON_LABELS = {
  duplicate: "重复记录",
  input_error: "录入错误",
  test_data: "测试数据",
  other: "其他原因",
} as const;
const DELETION_REASON_LABELS_EN = {
  duplicate: "Duplicate record",
  input_error: "Input error",
  test_data: "Test data",
  other: "Other reason",
} as const;

export function businessOrderAuditReason(reason: string | null, language: UiLanguage = "zh"): string | null {
  const value = reason?.trim();
  if (!value) return null;
  const structured = value.match(/^(duplicate|input_error|test_data|other)(?::\s*(.+))?$/s);
  if (!structured) return value;
  const code = structured[1] as keyof typeof DELETION_REASON_LABELS;
  const label = (language === "en" ? DELETION_REASON_LABELS_EN : DELETION_REASON_LABELS)[code];
  const note = structured[2]?.trim();
  return note ? `${label}${language === "en" ? ": " : "："}${note}` : label;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "未知大小";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  const megabytes = value / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}

function mediaTypeLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "未知格式";
  const subtype = value.split("/").at(-1)?.split("+")[0] ?? value;
  const normalized = subtype.toLowerCase();
  if (normalized === "jpeg") return "JPG";
  return normalized.toUpperCase();
}

function auditValue(field: string, value: unknown, masterData: FormalMasterData, language: UiLanguage): string {
  const english = language === "en";
  if (value === null || value === undefined || value === "") return english ? "Empty" : "空";
  if ((field === "teamId" || field === "assignedTeamId") && typeof value === "number") {
    return masterData.teams.find((team) => team.id === value)?.name
      ?? (english ? `Repair team #${value}` : `维修班组 #${value}`);
  }
  if (field === "status" && typeof value === "string") {
    return formalBusinessOrderStatusLabel(value as Parameters<typeof formalBusinessOrderStatusLabel>[0], language);
  }
  if (field === "repairRoundNo" && typeof value === "number") {
    return english ? `Repair round ${value}` : `第 ${value} 轮`;
  }
  if (field === "paymentMethodCode" && typeof value === "string") {
    return (english ? PAYMENT_METHOD_LABELS_EN : PAYMENT_METHOD_LABELS)[value] ?? (english ? "Other method" : "其他方式");
  }
  if (field === "originalDocumentStatus" && typeof value === "string") {
    return (english ? ORIGINAL_DOCUMENT_LABELS_EN : ORIGINAL_DOCUMENT_LABELS)[value] ?? (english ? "Original customer document status recorded" : "原客户单据状态已记录");
  }
  if (field === "evidenceKinds" && Array.isArray(value)) {
    const labels = value.map((item) => (english ? EVIDENCE_LABELS_EN : EVIDENCE_LABELS)[String(item)]).filter(Boolean);
    return labels.length > 0 ? labels.join(english ? ", " : "、") : (english ? "Refund acknowledgement evidence recorded" : "退款签收资料已记录");
  }
  if (field === "category") return (english ? ATTACHMENT_CATEGORY_LABELS_EN : ATTACHMENT_CATEGORY_LABELS)[String(value)] ?? (english ? "Other attachment" : "其他附件");
  if (field === "mediaType") return mediaTypeLabel(value);
  if (field === "sizeBytes" && typeof value === "number") return formatBytes(value);
  if (field.endsWith("Minor") && typeof value === "number") return formatFormalMoney(value);
  if (typeof value === "boolean") return value ? (english ? "Yes" : "是") : (english ? "No" : "否");
  if (typeof value === "object") return english ? "Related information saved" : "相关资料已保存";
  return String(value);
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function unknownEventLabel(_eventType: string, language: UiLanguage): string {
  return language === "en" ? "Other business record" : "其他业务记录";
}

export function businessOrderAuditSummary(
  eventType: string,
  after: Record<string, unknown> | null,
  masterData: FormalMasterData,
  language: UiLanguage = "zh",
): string {
  const english = language === "en";
  const values = after ?? {};
  const amount = typeof values.amountMinor === "number" ? formatFormalMoney(values.amountMinor) : null;
  const method = typeof values.paymentMethodCode === "string"
    ? auditValue("paymentMethodCode", values.paymentMethodCode, masterData, language)
    : null;
  const balance = typeof values.balanceAfterMinor === "number"
    ? formatFormalMoney(values.balanceAfterMinor)
    : null;

  if (eventType === "payment.recorded" || eventType === "business_order.payment_recorded") {
    const receiptNo = typeof values.receiptNo === "string" ? values.receiptNo : null;
    if (english) return [
      `Recorded payment${amount ? ` ${amount}` : ""}${method ? ` (${method})` : ""}`,
      receiptNo ? `generated Receipt ${receiptNo}` : null,
      balance ? `outstanding balance is now ${balance}` : null,
    ].filter(Boolean).join("; ");
    return [
      `登记收款${amount ? ` ${amount}` : ""}${method ? `（${method}）` : ""}`,
      receiptNo ? `生成 Receipt ${receiptNo}` : null,
      balance ? `未结余额变为 ${balance}` : null,
    ].filter(Boolean).join("；");
  }
  if (eventType === "refund.created" || eventType === "business_order.refund_recorded") {
    if (english) return [
      `Recorded refund${amount ? ` ${amount}` : ""}${method ? ` (${method})` : ""}`,
      balance ? `outstanding balance is now ${balance}` : null,
    ].filter(Boolean).join("; ");
    return [
      `登记退款${amount ? ` ${amount}` : ""}${method ? `（${method}）` : ""}`,
      balance ? `未结余额变为 ${balance}` : null,
    ].filter(Boolean).join("；");
  }
  if (eventType === "refund.proof_attached") return english ? "Uploaded refund proof" : "上传退款凭证";
  if (eventType === "refund.signed_acknowledgement_attached") return english ? "Uploaded the customer-signed refund acknowledgement" : "上传客户签字的退款签收单";
  if (eventType === "business_order.attachment_uploaded") {
    const category = (english ? ATTACHMENT_CATEGORY_LABELS_EN : ATTACHMENT_CATEGORY_LABELS)[String(values.category)] ?? (english ? "other" : "其他");
    const format = mediaTypeLabel(values.mediaType);
    const size = typeof values.sizeBytes === "number" ? formatBytes(values.sizeBytes) : "未知大小";
    return english ? `Uploaded ${category.toLowerCase()} attachment (${format}, ${size})` : `上传${category}附件（${format}，${size}）`;
  }
  if (eventType === "business_order.document_generated") {
    return typeof values.documentNo === "string"
      ? `${english ? "Generated formal print document" : "生成正式打印文件"} ${values.documentNo}`
      : (english ? "Generated a formal print document" : "生成正式打印文件");
  }
  if (eventType === "business_order.document_revision_created") {
    const documentNo = typeof values.documentNo === "string" ? ` ${values.documentNo}` : "";
    const revision = typeof values.revisionNo === "number" ? ` R${values.revisionNo}` : "";
    return `${english ? "Saved print-document revision" : "保存打印单据修订"}${documentNo}${revision}`;
  }
  if (eventType === "inspection_report.created" || eventType === "inspection_report.submitted") {
    const reportNo = typeof values.reportNo === "string" ? ` ${values.reportNo}` : "";
    const label = (english ? EVENT_LABELS_EN : EVENT_LABELS)[eventType];
    return `${label}${reportNo}`;
  }
  if (eventType === "inspection_report.workspace_version_appended") {
    const versionNo = typeof values.versionNo === "number" ? values.versionNo : null;
    if (versionNo === null) return english ? "Saved a new inspection-report version" : "保存检查报告新版本";
    return english ? `Saved inspection report version ${versionNo}` : `保存检查报告第 ${versionNo} 版`;
  }
  if (eventType === "business_order.attachment_linked_to_message") {
    return english ? `Added ${countArray(values.attachmentIds)} attachments to a Business Order comment` : `将 ${countArray(values.attachmentIds)} 份附件加入业务单留言`;
  }
  if (eventType === "business_order.message_created") {
    const mentions = countArray(values.mentionedAccountIds);
    return english ? `Posted a Business Order comment${mentions > 0 ? ` and mentioned ${mentions} people` : ""}` : `发布业务单留言${mentions > 0 ? `，并 @ ${mentions} 人` : ""}`;
  }
  if (eventType === "business_order.message_edited") {
    const mentions = countArray(values.mentionedAccountIds);
    return english ? `Edited a Business Order comment${mentions > 0 ? ` and mentioned ${mentions} people` : ""}` : `编辑业务单留言${mentions > 0 ? `，并 @ ${mentions} 人` : ""}`;
  }
  if (eventType === "business_order.round_assigned") {
    const round = typeof values.roundNo === "number" ? (english ? `Repair round ${values.roundNo}` : `第 ${values.roundNo} 轮维修`) : (english ? "Repair task" : "维修任务");
    const teamId = values.teamId ?? values.assignedTeamId;
    if (teamId === null || teamId === undefined || teamId === "") {
      return english
        ? `${round} was assigned; repair team was not recorded`
        : `${round}已派单，未登记维修班组`;
    }
    const team = auditValue("teamId", teamId, masterData, language);
    return english ? `${round} assigned to ${team}` : `${round}派给${team}`;
  }
  if (eventType === "business_order.round_paper_acceptance_recorded") {
    const round = typeof values.roundNo === "number" ? values.roundNo : null;
    return english
      ? `Front desk recorded paper acceptance${round === null ? "" : ` for repair round ${round}`}`
      : `前台登记${round === null ? "" : `第 ${round} 轮维修`}纸质接单`;
  }
  if (eventType === "business_order.paper_work_return_recorded_and_approved") {
    const round = typeof values.roundNo === "number" ? values.roundNo : null;
    return english
      ? `Front desk recorded and approved a paper work return${round === null ? "" : ` for repair round ${round}`}`
      : `前台登记并审核通过${round === null ? "" : `第 ${round} 轮维修`}纸质回单`;
  }
  if (eventType === "business_order.round_assignment_withdrawn") {
    const round = typeof values.roundNo === "number" ? values.roundNo : null;
    return english
      ? `Withdrew the repair-team assignment${round === null ? "" : ` for repair round ${round}`}`
      : `撤回${round === null ? "" : `第 ${round} 轮维修`}班组派单`;
  }
  if (eventType === "business_order.intake_photo_linked") {
    const round = typeof values.roundNo === "number" ? values.roundNo : null;
    return english
      ? `Archived an intake-mileage photo${round === null ? "" : ` for repair round ${round}`}`
      : `归档${round === null ? "" : `第 ${round} 轮维修`}接车里程照片`;
  }
  if (eventType === "business_order.problem_description_appended") {
    const version = typeof values.versionNo === "number" ? values.versionNo : null;
    return english
      ? `Updated the overall Business Order problem description${version === null ? "" : ` (V${version})`}`
      : `更新整张 Business Order 问题描述${version === null ? "" : `（V${version}）`}`;
  }
  if (eventType === "repair_round.problem_description_appended") {
    const version = typeof values.versionNo === "number" ? values.versionNo : null;
    return english
      ? `Updated a repair-round problem description${version === null ? "" : ` (V${version})`}`
      : `更新维修轮次问题描述${version === null ? "" : `（V${version}）`}`;
  }
  if (eventType === "business_order.performance_draft_set") {
    const round = typeof values.repairRoundNo === "number"
      ? (english ? `repair round ${values.repairRoundNo}` : `第 ${values.repairRoundNo} 轮维修`)
      : (english ? "the repair round" : "本轮维修");
    return english ? `Set performance draft for ${round}` : `设置${round}绩效草稿`;
  }
  if (eventType === "business_order.performance_adjusted") {
    const round = typeof values.repairRoundNo === "number"
      ? (english ? `repair round ${values.repairRoundNo}` : `第 ${values.repairRoundNo} 轮维修`)
      : (english ? "the repair round" : "本轮维修");
    return english ? `Adjusted performance for ${round}` : `调整${round}绩效`;
  }
  if (eventType === "business_order.invalid_after_sales_round_deleted") {
    const deletedRound = typeof values.cancelledRoundNo === "number"
      ? values.cancelledRoundNo
      : null;
    const restoredRound = typeof values.previousRoundNo === "number"
      ? values.previousRoundNo
      : null;
    if (english) {
      return deletedRound && restoredRound
        ? `Deleted repair round ${deletedRound} and restored repair round ${restoredRound}`
        : "Deleted an after-sales repair round";
    }
    return deletedRound && restoredRound
      ? `删除第 ${deletedRound} 轮维修，恢复到第 ${restoredRound} 轮`
      : "删除售后维修轮次";
  }
  return (english ? EVENT_LABELS_EN : EVENT_LABELS)[eventType] ?? unknownEventLabel(eventType, language);
}

export function businessOrderAuditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  masterData: FormalMasterData,
  language: UiLanguage = "zh",
): AuditPresentationChange[] {
  const fieldLabels = language === "en" ? FIELD_LABELS_EN : FIELD_LABELS;
  const keys = Array.from(new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])).filter((key) => key !== "businessOrderId" && Boolean(FIELD_LABELS[key]));
  return keys
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => ({
      key,
      label: fieldLabels[key],
      before: auditValue(key, before?.[key], masterData, language),
      after: auditValue(key, after?.[key], masterData, language),
      hasBefore: Boolean(before && Object.prototype.hasOwnProperty.call(before, key)),
      hasAfter: Boolean(after && Object.prototype.hasOwnProperty.call(after, key)),
    }));
}
