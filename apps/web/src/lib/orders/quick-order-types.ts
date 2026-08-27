/**
 * 快速工单（Quick BO）——2026-08-16 老板定的建单与状态模型。
 *
 * 与血统型 BusinessOrder（检查报告→报价→业务单）并行：
 * 前台大白话 → AI 拆单（双语收费项目）→ 人工可改 → 确认生成。
 *
 * 主状态链（老板口述）：
 *   待派单 → 已派单（等维修工接车）→ 维修中（等回单）→ 回单待审核 → 已交单
 *   停滞：介于接单和交单之间，维修工/前台都能标、都能恢复，全留痕。
 * 交单：前台核对绩效值（可改，记操作人）+ 施工班组（交单前随时可改派）；
 *       交单时间决定绩效归属月份。
 * 财务状态独立：未付款/未付清/已付清，由收退款事实推导。
 * 取车不占 BO 状态，归停车费/交车模块。
 * 预计工期（8/18 老板）：多久提醒、多久算停滞，由派单时前台/接单时维修工按单反馈；
 *   维修中超过本单预计工期 → 超时提醒（不是固定天数一刀切）。
 */
import { businessDateInJamaica } from "./document-number";
import {
  calculateQuotedChargeTotals,
  type FixedTotalChargeLine,
  type UnitPricedChargeLine,
} from "../billing/quoted-charges";

export type QuickBoStatus =
  | "pending_assign" // 待派单
  | "assigned" // 已派单（等维修工接车接单）
  | "in_repair" // 维修中（等回单）
  | "stalled" // 停滞（接单后交单前，遇到困难挂起）
  | "returned" // 回单待审核
  | "submitted"; // 已交单

export const QUICK_BO_STATUS_LABELS: Record<QuickBoStatus, string> = {
  pending_assign: "待派单",
  assigned: "已派单",
  in_repair: "维修中",
  stalled: "停滞",
  returned: "回单待审核",
  submitted: "已交单",
};

export const QUICK_BO_MAIN_FLOW: readonly QuickBoStatus[] = [
  "pending_assign",
  "assigned",
  "in_repair",
  "returned",
  "submitted",
] as const;

export type QuickItemCategory = "labor" | "parts";

export const QUICK_ITEM_CATEGORY_LABELS: Record<QuickItemCategory, string> = {
  labor: "工时",
  parts: "配件",
};

export interface QuickOrderItem {
  readonly id: string;
  /** 中文描述（前台原文/人工修改）。 */
  readonly descZh: string;
  /** 英文翻译（AI 翻译，人可改）——客户大多是英语母语。 */
  readonly descEn: string;
  /** 项目备注（8/18 老板：每行收费项目的补充说明，选填）。 */
  readonly remarkZh?: string;
  /** 项目备注的英文翻译（备注有内容时自动翻译，人可改）。 */
  readonly remarkEn?: string;
  readonly category: QuickItemCategory;
  /** 单位（8/18 老板要求）：工时→“工时/小时”，配件→个/套/瓶/罐/桶/条/只等。 */
  readonly unit: string;
  /** 单位的英文翻译（8/18 老板：翻译结果贴在单位下面，数量/金额不翻译）。 */
  readonly unitEn?: string;
  /** 单价（JMD，最终价含 15% GCT，不再另算）。 */
  readonly unitPriceJmd: number;
  readonly quantity: number;
  /** 配件待报价：数量已知价格待定，不阻塞建单。 */
  readonly pendingQuote: boolean;
}

/** New-write Quick BO contract; parking remains an Invoice-only projection. */
export type QuickOrderChargeLine = UnitPricedChargeLine | FixedTotalChargeLine;

export const QUICK_ORDER_SHARED_CHARGE_CONTRACT = "shared_v1" as const;

/** Explicit compatibility adapter for persisted pre-shared-contract Quick BO items. */
export function adaptLegacyQuickOrderItemToChargeLine(item: QuickOrderItem): UnitPricedChargeLine {
  return {
    id: item.id,
    descZh: item.descZh,
    descEn: item.descEn,
    remarkZh: item.remarkZh ?? "",
    remarkEn: item.remarkEn ?? "",
    category: item.category,
    pricingMode: "unit",
    unit: item.unit,
    unitEn: item.unitEn ?? "",
    unitPriceJmd: item.unitPriceJmd,
    unitDiscountJmd: 0,
    quantity: item.quantity,
    pendingQuote: item.pendingQuote,
  };
}

export interface QuickPaymentReceiptChargeLine {
  readonly id: string;
  readonly category: "labor" | "parts" | "other_service";
  readonly descZh: string;
  readonly descEn: string;
  readonly remarkZh: string;
  readonly remarkEn: string;
  readonly unit: string | null;
  readonly unitEn: string | null;
  readonly quantity: number | null;
  readonly unitPriceJmd: number | null;
  readonly discountJmd: number;
  readonly lineTotalJmd: number;
  readonly pendingQuote: boolean;
}

export interface QuickPaymentReceiptHistoryEntry {
  readonly paymentId: string;
  readonly receiptNo: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly receivedBy: string;
  readonly receivedAt: string;
  readonly note: string | null;
}

/**
 * 客户 Receipt 的冻结快照。Receipt 在收款提交时一次生成，之后 Business Order
 * 的收费项目、备注或客户档案发生变化，都不得改写这份快照。
 */
export interface QuickPaymentReceiptSnapshot {
  readonly contract: "quick_payment_receipt_v1";
  readonly receiptNo: string;
  readonly paymentId: string;
  readonly businessOrderId: string;
  readonly businessOrderNo: string;
  readonly customer: Readonly<{
    id: string;
    nameZh: string;
    nameEn: string;
    phone: string;
  }>;
  readonly vehicle: Readonly<{
    id: string;
    plate: string;
    modelZh: string;
    modelEn: string;
  }>;
  readonly issuedAt: string;
  readonly issuedBy: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly note: string | null;
  readonly businessNoteZh: string | null;
  readonly businessNoteEn: string | null;
  readonly chargeLines: ReadonlyArray<QuickPaymentReceiptChargeLine>;
  readonly grossJmd: number;
  readonly discountJmd: number;
  readonly receivableJmd: number;
  readonly gctIncludedJmd: number;
  readonly paidToDateJmd: number;
  readonly refundedToDateJmd: number;
  readonly balanceAfterJmd: number;
  readonly paymentHistory: ReadonlyArray<QuickPaymentReceiptHistoryEntry>;
}

export interface QuickPayment {
  readonly id: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly receivedBy: string;
  readonly receivedAt: string;
  readonly note?: string;
  readonly receipt: QuickPaymentReceiptSnapshot;
}

export type QuickRefundMethod = string;

export interface QuickRefundSignature {
  readonly signerName: string;
  readonly photoDataUrl: string;
  readonly photoFileName: string;
  readonly signedBy: string;
  readonly signedAt: string;
}

export type QuickRefundOriginalDocumentStatus = "returned" | "unavailable" | "not_issued";

export interface QuickRefundEvidence {
  readonly fileName: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  readonly dataUrl: string;
}

export interface QuickRefundDocumentSnapshot {
  readonly contract: "quick_refund_document_v1";
  readonly refundId: string;
  readonly receiptNo: string;
  readonly businessOrderId: string;
  readonly businessOrderNo: string;
  readonly customer: Readonly<{
    id: string;
    nameZh: string;
    nameEn: string;
    phone: string;
  }>;
  readonly vehicle: Readonly<{
    id: string;
    plate: string;
    modelZh: string;
    modelEn: string;
  }>;
  readonly amountJmd: number;
  readonly method: string;
  readonly reason: string;
  readonly originalDocumentStatus: QuickRefundOriginalDocumentStatus;
  readonly originalDocumentNote: string | null;
  readonly proof: QuickRefundEvidence | null;
  readonly proofAttachedBy: string | null;
  readonly proofAttachedAt: string | null;
  readonly signature: QuickRefundSignature | null;
  readonly refundedBy: string;
  readonly refundedAt: string;
  readonly receivableJmd: number;
  readonly paidToDateJmd: number;
  readonly refundedToDateJmd: number;
  readonly balanceAfterJmd: number;
}

/** 退款是与收费项目、原收款和绩效无关的追加财务事实。 */
export interface QuickRefund {
  readonly contract: "quick_refund_v2";
  readonly id: string;
  readonly amountJmd: number;
  readonly category: null;
  readonly receiptNo: string;
  readonly method: QuickRefundMethod;
  readonly refundedBy: string;
  readonly refundedAt: string;
  readonly reason: string;
  readonly note: string;
  readonly originalDocumentStatus: QuickRefundOriginalDocumentStatus;
  readonly originalDocumentNote: string | null;
  readonly proof: QuickRefundEvidence | null;
  readonly proofAttachedBy: string | null;
  readonly proofAttachedAt: string | null;
  /** 退款落账后可选归档客户手写签字的纸质签收单。 */
  readonly signature: QuickRefundSignature | null;
  readonly document: QuickRefundDocumentSnapshot;
}

export interface QuickBoStatusEvent {
  readonly id: string;
  readonly from: QuickBoStatus | null; // null = 新建
  readonly to: QuickBoStatus;
  readonly by: string;
  readonly byRole: "frontdesk" | "mechanic" | "system";
  readonly at: string;
  /** 回退/直接调整/停滞必须填原因。 */
  readonly reason?: string;
  /** 售后回厂后仍在同一 Business Order 内追加维修轮次。 */
  readonly roundNumber?: number;
  /** 每次交单独立冻结当次班组与绩效；旧事件可缺省。 */
  readonly teamId?: string | null;
  readonly performanceValueJmd?: number;
  /** 当月取消交单时保留审计事实，但该次交单不再参与绩效。 */
  readonly cancelledAt?: string;
}

export interface QuickPerformanceAdjust {
  readonly id: string;
  readonly beforeJmd: number;
  readonly afterJmd: number;
  readonly by: string;
  readonly at: string;
}

/** 内容修订留痕（收费项目/自然语言/备注，谁、何时）。 */
export interface QuickEditFact {
  readonly id: string;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
}

/** 单种：普通 / 售后（无绩效值要求）/ 对冲（扣回原单绩效）。 */
export type QuickOrderKind = "normal" | "aftersales" | "hedge";

export const QUICK_ORDER_KIND_LABELS: Record<QuickOrderKind, string> = {
  normal: "普通工单",
  aftersales: "售后工单",
  hedge: "对冲工单",
};

/** 取车通知渠道记录（§9.1：短信/WhatsApp/Email 人工执行，至少一项）。 */
export interface QuickPickupChannelRecord {
  readonly id: string;
  readonly kind: "sms" | "whatsapp" | "email";
  /** 实际发送的语言版本（前台自选）。 */
  readonly language: "zh" | "en";
  /** 实际发出的文案（前台可自由编辑，可不用 AI 稿）。 */
  readonly text: string;
  readonly sentBy: string;
  readonly sentAt: string;
}

/** 取车通知事实：前台完成至少一个渠道后开始记时（§9.1）。 */
export interface QuickPickupNotice {
  /** 记时起点 D（通知动作完成的时刻）。 */
  readonly notifiedAt: string;
  readonly notifiedBy: string;
  readonly channels: ReadonlyArray<QuickPickupChannelRecord>;
}

export interface QuickOrder {
  readonly id: string;
  readonly businessOrderNo: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly createdAt: string;
  readonly createdBy: string;
  /** 前台大白话原文留底。 */
  readonly rawInput: string;
  /** 前台备注：中文留档（打印客户联用英文版）。 */
  readonly noteZh: string | null;
  readonly noteEn: string | null;
  /** 内容修订留痕。 */
  readonly editHistory: ReadonlyArray<QuickEditFact>;
  readonly orderKind: QuickOrderKind;
  /** 售后/对冲单关联的原工单（普通单为 null）。 */
  readonly linkedOrderId: string | null;
  /**
   * Legacy Quick BOs persist unit-only rows in `items`. New shared-charge BOs
   * keep this array empty and persist their one canonical copy in
   * `chargeLines`, so fixed totals never acquire synthetic unit fields at rest.
   */
  readonly items: ReadonlyArray<QuickOrderItem>;
  readonly chargeContract?: typeof QUICK_ORDER_SHARED_CHARGE_CONTRACT;
  readonly chargeLines?: ReadonlyArray<QuickOrderChargeLine>;
  readonly status: QuickBoStatus;
  readonly statusHistory: ReadonlyArray<QuickBoStatusEvent>;
  readonly teamId: string | null;
  readonly mechanicName: string | null;
  readonly assignedAt: string | null;
  readonly acceptedAt: string | null;
  readonly returnedAt: string | null;
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  /** 入场里程：维修工接车接单时记录（每单开始前）。 */
  readonly startMileageKm: number | null;
  readonly startMileageRecordedAt: string | null;
  readonly startMileageRecordedBy: string | null;
  /** 停滞原因（停滞中时有值）。 */
  readonly stallReason: string | null;
  /** 绩效值（JMD）；默认=工时合计（打折前），交单时前台可改，记操作人。 */
  readonly performanceValueJmd: number;
  readonly performanceAdjusts: ReadonlyArray<QuickPerformanceAdjust>;
  /** 整单工时优惠（8/18 老板：打折分工时/配件两个口径；只减应收，不影响默认绩效）。 */
  readonly laborDiscountJmd: number;
  /** 整单配件优惠（同口径）。 */
  readonly partsDiscountJmd: number;
  readonly payments: ReadonlyArray<QuickPayment>;
  readonly refunds: ReadonlyArray<QuickRefund>;
  /** Invoice 客户签字（8/18 老板流程）：办公室联打印 → 客户签字 → 拍照回传保存。 */
  readonly invoiceSignature: {
    readonly signerName: string;
    readonly photoDataUrl: string;
    readonly photoFileName: string;
    readonly signedBy: string;
    readonly signedAt: string;
  } | null;
  /** 取车通知：交单后此车无其他可执行 BO 时提醒前台发信；null=未通知。 */
  readonly pickupNotice: QuickPickupNotice | null;
  /** 最终完结三件事之一：已取车（2026-08-18 老板：交单+取车+付完全款=最终完结）。 */
  readonly pickedUpAt: string | null;
  readonly pickedUpBy: string | null;
  /** 最终完结三件事之一：已付完全款。 */
  readonly paidInFullAt: string | null;
  readonly paidInFullBy: string | null;
  /** 废除（2026-08-18 老板）：不用删除；废除后本单所有数据无效、不参与任何计算；可恢复。 */
  readonly voidedAt: string | null;
  readonly voidedBy: string | null;
  readonly voidReason: string | null;
  /** 预计工期（天）：派单时前台反馈、接单时维修工可调整（8/18 老板）；null=还没反馈。 */
  readonly etaDays: number | null;
}

export type SharedChargeQuickOrder = QuickOrder & {
  readonly chargeContract: typeof QUICK_ORDER_SHARED_CHARGE_CONTRACT;
  readonly chargeLines: ReadonlyArray<QuickOrderChargeLine>;
  readonly items: readonly [];
};

export function isSharedChargeQuickOrder(order: Pick<QuickOrder, "chargeContract" | "chargeLines">): order is SharedChargeQuickOrder {
  return order.chargeContract === QUICK_ORDER_SHARED_CHARGE_CONTRACT && Array.isArray(order.chargeLines);
}

/** Canonical read boundary: shared writes stay shared; legacy rows adapt once. */
export function quickOrderCanonicalChargeLines(
  order: Pick<QuickOrder, "chargeContract" | "chargeLines" | "items">,
): ReadonlyArray<QuickOrderChargeLine> {
  if (isSharedChargeQuickOrder(order)) return order.chargeLines;
  return order.items.map(adaptLegacyQuickOrderItemToChargeLine);
}

// ---------------------------------------------------------------------------
// 推导
// ---------------------------------------------------------------------------

export function quickOrderTotals(order: {
  items: ReadonlyArray<Pick<QuickOrderItem, "category" | "unitPriceJmd" | "quantity" | "pendingQuote">>;
  chargeContract?: QuickOrder["chargeContract"];
  chargeLines?: QuickOrder["chargeLines"];
}) {
  if (order.chargeContract === QUICK_ORDER_SHARED_CHARGE_CONTRACT && Array.isArray(order.chargeLines)) {
    const totals = calculateQuotedChargeTotals(order.chargeLines);
    return {
      laborJmd: totals.laborNetJmd,
      partsJmd: totals.partsNetJmd,
      otherServiceJmd: totals.otherFeeTotalJmd,
      totalJmd: totals.grandTotalJmd,
    };
  }
  const lines = order.items.map((item, index) => adaptLegacyQuickOrderItemToChargeLine({
    id: (item as { id?: string }).id ?? `legacy-quick-item-${index}`,
    descZh: (item as { descZh?: string }).descZh ?? "历史收费项目",
    descEn: (item as { descEn?: string }).descEn ?? "Legacy charge item",
    unit: (item as { unit?: string }).unit ?? "项",
    ...item,
  }));
  const totals = calculateQuotedChargeTotals(lines);
  // 毛额口径；历史整单工时/配件优惠仍由 quickOrderFinance 显式扣除。
  return { laborJmd: totals.laborGrossJmd, partsJmd: totals.partsGrossJmd, otherServiceJmd: 0, totalJmd: totals.grandTotalJmd };
}

/** New-write totals use shared line discounts and never read legacy category-level discounts. */
export function quickOrderChargeTotals(lines: ReadonlyArray<QuickOrderChargeLine>) {
  const totals = calculateQuotedChargeTotals(lines);
  return {
    laborJmd: totals.laborNetJmd,
    partsJmd: totals.partsNetJmd,
    otherServiceJmd: totals.otherFeeTotalJmd,
    totalJmd: totals.grandTotalJmd,
  };
}

export type QuickPaymentStatus = "unpaid" | "partially_paid" | "paid";

export const QUICK_PAYMENT_STATUS_LABELS: Record<QuickPaymentStatus, string> = {
  unpaid: "未付款",
  partially_paid: "未付清",
  paid: "已付清",
};

export function legacyQuickOrderFinance(order: Pick<QuickOrder, "items" | "payments" | "refunds" | "laborDiscountJmd" | "partsDiscountJmd">) {
  const gross = quickOrderTotals(order);
  const laborDiscountJmd = order.laborDiscountJmd ?? 0;
  const partsDiscountJmd = order.partsDiscountJmd ?? 0;
  const discountJmd = laborDiscountJmd + partsDiscountJmd;
  const receivableJmd = Math.max(0, gross.totalJmd - discountJmd);
  const paidJmd = order.payments.reduce((sum, p) => sum + p.amountJmd, 0);
  const refundedJmd = order.refunds.reduce((sum, r) => sum + r.amountJmd, 0);
  const balanceJmd = receivableJmd - paidJmd + refundedJmd;
  const status: QuickPaymentStatus = balanceJmd <= 0 && receivableJmd > 0 ? "paid" : paidJmd > refundedJmd ? "partially_paid" : "unpaid";
  return { receivableJmd, paidJmd, refundedJmd, balanceJmd, status, laborDiscountJmd, partsDiscountJmd, discountJmd };
}

/** Source-compatible legacy entry point retained until schema v8 migrates persisted Quick BOs. */
export function quickOrderFinance(
  order: Pick<QuickOrder, "items" | "payments" | "refunds" | "laborDiscountJmd" | "partsDiscountJmd">
    & Partial<Pick<QuickOrder, "chargeContract" | "chargeLines">>,
) {
  if (isSharedChargeQuickOrder(order)) {
    const totals = calculateQuotedChargeTotals(order.chargeLines);
    const receivableJmd = totals.grandTotalJmd;
    const paidJmd = order.payments.reduce((sum, payment) => sum + payment.amountJmd, 0);
    const refundedJmd = order.refunds.reduce((sum, refund) => sum + refund.amountJmd, 0);
    const balanceJmd = receivableJmd - paidJmd + refundedJmd;
    const status: QuickPaymentStatus = balanceJmd <= 0 && receivableJmd > 0
      ? "paid"
      : paidJmd > refundedJmd
        ? "partially_paid"
        : "unpaid";
    return {
      receivableJmd,
      paidJmd,
      refundedJmd,
      balanceJmd,
      status,
      laborDiscountJmd: totals.laborDiscountJmd,
      partsDiscountJmd: totals.partsDiscountJmd,
      discountJmd: totals.totalDiscountJmd,
    };
  }
  return legacyQuickOrderFinance(order);
}

/** 主链上的位置（停滞视为在维修中旁路）。 */
export function quickBoFlowIndex(status: QuickBoStatus): number {
  if (status === "stalled") return QUICK_BO_MAIN_FLOW.indexOf("in_repair");
  return QUICK_BO_MAIN_FLOW.indexOf(status);
}

/** 最终完结 = 已交单 + 已取车 + 付完全款（2026-08-18 老板：以这三件事为最终完结）。 */
export function isQuickOrderCompleted(
  order: Pick<QuickOrder, "status" | "pickedUpAt" | "paidInFullAt">,
): boolean {
  return order.status === "submitted" && order.pickedUpAt !== null && order.paidInFullAt !== null;
}

/** 是否已废除（废除=全部数据无效、不参与计算；可恢复）。 */
export function isQuickOrderVoided(order: Pick<QuickOrder, "voidedAt">): boolean {
  return order.voidedAt !== null;
}

/** 箭头流程链的步骤：主链五段 + 最终「已完结」段（8/18 老板：交单、取车、付完全款）。 */
export const QUICK_BO_CHAIN_STEPS: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
  ...QUICK_BO_MAIN_FLOW.map((status) => ({ key: status, label: QUICK_BO_STATUS_LABELS[status] })),
  { key: "completed", label: "已完结" },
];

/** 箭头流程链上的当前段：已完结压最后一段；否则按主链状态。 */
export function quickBoChainIndex(
  order: Pick<QuickOrder, "status" | "pickedUpAt" | "paidInFullAt">,
): number {
  if (isQuickOrderCompleted(order)) return QUICK_BO_CHAIN_STEPS.length - 1;
  return quickBoFlowIndex(order.status);
}

/**
 * 预计工期建议值（天，8/18 老板）：派单时预填、可改。
 * 1 天起步；每 3 个收费项目 +1 天；有待报价配件 +1 天；合计金额每 10 万 +1 天；封顶 30 天。
 */
export function suggestEtaDays(
  items: ReadonlyArray<Pick<QuickOrderItem, "pendingQuote" | "unitPriceJmd" | "quantity">>,
): number {
  const pricedTotal = items
    .filter((item) => !item.pendingQuote)
    .reduce((sum, item) => sum + item.unitPriceJmd * item.quantity, 0);
  const pendingCount = items.filter((item) => item.pendingQuote).length;
  const days = 1
    + Math.floor(items.length / 3)
    + (pendingCount > 0 ? 1 : 0)
    + Math.floor(pricedTotal / 100_000);
  return Math.min(30, days);
}

/** ETA boundary for both persisted legacy items and canonical shared charge lines. */
export function suggestQuickOrderEtaDays(
  order: Pick<QuickOrder, "chargeContract" | "chargeLines" | "items">,
): number {
  const lines = quickOrderCanonicalChargeLines(order);
  const pricedTotal = lines.reduce((sum, line) => {
    if (line.pricingMode === "fixed_total") return sum + line.amountJmd;
    return line.pendingQuote ? sum : sum + line.quantity * (line.unitPriceJmd - line.unitDiscountJmd);
  }, 0);
  const pendingCount = lines.filter((line) => line.pricingMode === "unit" && line.pendingQuote).length;
  const days = 1
    + Math.floor(lines.length / 3)
    + (pendingCount > 0 ? 1 : 0)
    + Math.floor(pricedTotal / 100_000);
  return Math.min(30, days);
}

/** 维修已进行天数（按 Jamaica 业务日差；未接车为 0）。 */
export function quickOrderRepairElapsedDays(
  order: Pick<QuickOrder, "acceptedAt">,
  now: Date | string = new Date(),
): number {
  if (order.acceptedAt === null) return 0;
  const toUtcDay = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
  const start = toUtcDay(businessDateInJamaica(order.acceptedAt));
  const today = toUtcDay(businessDateInJamaica(now));
  return Math.max(0, Math.round((today - start) / 86_400_000));
}

/** 维修中超时天数 = 已修天数 − 预计工期；未超时为 0（8/18 老板：按单反馈的工期算超时）。 */
export function quickOrderRepairOverdueDays(
  order: Pick<QuickOrder, "status" | "acceptedAt" | "etaDays">,
  now: Date | string = new Date(),
): number {
  if (order.status !== "in_repair" || order.etaDays === null) return 0;
  return Math.max(0, quickOrderRepairElapsedDays(order, now) - order.etaDays);
}
