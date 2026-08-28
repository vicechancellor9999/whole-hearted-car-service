import {
  formalBusinessOrderStatusLabel,
  formatFormalMoney,
} from "@/lib/api/formal-business-orders";
import type { FormalMasterData } from "@/lib/api/formal-master-data";

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
  "business_order.after_sales_round_started": "开始下一轮售后维修",
  "business_order.after_sales_round_cancelled": "撤销误建售后维修轮次",
  "business_order.charge_version_replaced": "修改收费项目和备注",
  "business_order.charges_replaced": "修改收费项目和备注",
  "business_order.document_generated": "生成正式打印文件",
  "business_order.document_reprinted": "补打正式打印文件",
  "business_order.document_revision_created": "保存打印单据修订",
  "business_order.voided": "删除 Business Order",
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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  bank_transfer: "银行转账",
  card: "银行卡",
};

const ORIGINAL_DOCUMENT_LABELS: Record<string, string> = {
  returned: "原客户单据已交回",
  unavailable: "原客户单据无法交回",
  not_required: "无需交回原客户单据",
};

const EVIDENCE_LABELS: Record<string, string> = {
  customer_signature: "客户签字的退款签收单",
  refund_proof: "退款凭证",
};

const ATTACHMENT_CATEGORY_LABELS: Record<string, string> = {
  customer_signature: "客户签字",
  service_photo: "服务照片",
  financial_evidence: "财务凭证",
  other: "其他",
};

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

function auditValue(field: string, value: unknown, masterData: FormalMasterData): string {
  if (value === null || value === undefined || value === "") return "空";
  if ((field === "teamId" || field === "assignedTeamId") && typeof value === "number") {
    return masterData.teams.find((team) => team.id === value)?.name ?? `维修班组 #${value}`;
  }
  if (field === "status" && typeof value === "string") {
    return formalBusinessOrderStatusLabel(value as Parameters<typeof formalBusinessOrderStatusLabel>[0]);
  }
  if (field === "paymentMethodCode" && typeof value === "string") {
    return PAYMENT_METHOD_LABELS[value] ?? "其他方式";
  }
  if (field === "originalDocumentStatus" && typeof value === "string") {
    return ORIGINAL_DOCUMENT_LABELS[value] ?? "原客户单据状态已记录";
  }
  if (field === "evidenceKinds" && Array.isArray(value)) {
    const labels = value.map((item) => EVIDENCE_LABELS[String(item)]).filter(Boolean);
    return labels.length > 0 ? labels.join("、") : "退款签收资料已记录";
  }
  if (field === "category") return ATTACHMENT_CATEGORY_LABELS[String(value)] ?? "其他附件";
  if (field === "mediaType") return mediaTypeLabel(value);
  if (field === "sizeBytes" && typeof value === "number") return formatBytes(value);
  if (field.endsWith("Minor") && typeof value === "number") return formatFormalMoney(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return "相关资料已保存";
  return String(value);
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function unknownEventLabel(eventType: string): string {
  const readable = eventType.split(".").at(-1)?.replaceAll("_", " ").trim();
  return `记录业务事件：${readable || eventType}`;
}

export function businessOrderAuditSummary(
  eventType: string,
  after: Record<string, unknown> | null,
  masterData: FormalMasterData,
): string {
  const values = after ?? {};
  const amount = typeof values.amountMinor === "number" ? formatFormalMoney(values.amountMinor) : null;
  const method = typeof values.paymentMethodCode === "string"
    ? auditValue("paymentMethodCode", values.paymentMethodCode, masterData)
    : null;
  const balance = typeof values.balanceAfterMinor === "number"
    ? formatFormalMoney(values.balanceAfterMinor)
    : null;

  if (eventType === "payment.recorded" || eventType === "business_order.payment_recorded") {
    const receiptNo = typeof values.receiptNo === "string" ? values.receiptNo : null;
    return [
      `登记收款${amount ? ` ${amount}` : ""}${method ? `（${method}）` : ""}`,
      receiptNo ? `生成 Receipt ${receiptNo}` : null,
      balance ? `未结余额变为 ${balance}` : null,
    ].filter(Boolean).join("；");
  }
  if (eventType === "refund.created" || eventType === "business_order.refund_recorded") {
    return [
      `登记退款${amount ? ` ${amount}` : ""}${method ? `（${method}）` : ""}`,
      balance ? `未结余额变为 ${balance}` : null,
    ].filter(Boolean).join("；");
  }
  if (eventType === "refund.proof_attached") return "上传退款凭证";
  if (eventType === "refund.signed_acknowledgement_attached") return "上传客户签字的退款签收单";
  if (eventType === "business_order.attachment_uploaded") {
    const category = ATTACHMENT_CATEGORY_LABELS[String(values.category)] ?? "其他";
    const format = mediaTypeLabel(values.mediaType);
    const size = typeof values.sizeBytes === "number" ? formatBytes(values.sizeBytes) : "未知大小";
    return `上传${category}附件（${format}，${size}）`;
  }
  if (eventType === "business_order.attachment_linked_to_message") {
    return `将 ${countArray(values.attachmentIds)} 份附件加入业务单留言`;
  }
  if (eventType === "business_order.message_created") {
    const mentions = countArray(values.mentionedAccountIds);
    return `发布业务单留言${mentions > 0 ? `，并 @ ${mentions} 人` : ""}`;
  }
  if (eventType === "business_order.message_edited") {
    const mentions = countArray(values.mentionedAccountIds);
    return `编辑业务单留言${mentions > 0 ? `，并 @ ${mentions} 人` : ""}`;
  }
  if (eventType === "business_order.round_assigned") {
    const round = typeof values.roundNo === "number" ? `第 ${values.roundNo} 轮维修` : "维修任务";
    const team = auditValue("assignedTeamId", values.assignedTeamId, masterData);
    return `${round}派给${team}`;
  }
  return EVENT_LABELS[eventType] ?? unknownEventLabel(eventType);
}

export function businessOrderAuditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  masterData: FormalMasterData,
): AuditPresentationChange[] {
  const keys = Array.from(new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])).filter((key) => key !== "businessOrderId" && Boolean(FIELD_LABELS[key]));
  return keys
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => ({
      key,
      label: FIELD_LABELS[key],
      before: auditValue(key, before?.[key], masterData),
      after: auditValue(key, after?.[key], masterData),
      hasBefore: Boolean(before && Object.prototype.hasOwnProperty.call(before, key)),
      hasAfter: Boolean(after && Object.prototype.hasOwnProperty.call(after, key)),
    }));
}
