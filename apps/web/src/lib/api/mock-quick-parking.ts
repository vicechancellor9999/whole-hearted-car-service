/**
 * 快速停车案件 store（2026-08-17，新 BO 口径）。
 * 独立 localStorage 存储（wh_quick_parking_v1），不改 linked-operations 状态机。
 *
 * 规则（规范 §9）：
 * - 取车通知（pickupNotice）完成后才开始记时：notificationDate = 本车最早 pickupNotice.notifiedAt 的 Jamaica 日期
 * - D+1 宽限；D+2 起 JMD 2,500/自然日；取车日不计费；门店每天营业
 * - 减免：累计 ≤ JMD 50,000 前台处理；> 50,000 需管理员现场签名（留痕）
 * - 办理取车（§5.4）：付清放行；有余额必须挂账（客户有挂账资格 + 客户签账）——无资格硬拦
 */
import { validateParkingWaiver } from "../parking/calculations";
import type { ParkingWaiverPreview } from "../parking/types";
import { parkingLocalCalendarDate, parkingBillableDays } from "./mock-parking-followup";
import { businessDateInJamaica, formatInvoiceNo } from "../orders/document-number";
import { calculateInvoiceTotals } from "../billing/calculations";
import { isSharedChargeInvoice, type Invoice, type InvoicePaymentFact, type LegacyInvoice } from "../billing/types";
import { getMockLinkedOperationsStore, LinkedApiDomainError } from "./mock-orders";

const STORAGE_KEY = "wh_quick_parking_v1";
const DAILY_RATE_JMD = 2_500;

function retiredQuickParkingOperation(): never {
  throw new LinkedApiDomainError(
    "wh_quick_parking_v1 operational API 已退休；请使用 canonical parking contract",
    410,
  );
}

export interface QuickParkingPayment {
  readonly id: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly receivedBy: string;
  readonly receivedAt: string;
  readonly note?: string;
  /** 对应停车费发票号（收款即开票）。 */
  readonly invoiceNo: string;
}

export interface QuickCreditSignFact {
  readonly id: string;
  readonly signerName: string;
  readonly balanceAtSignJmd: number;
  readonly language: "zh" | "en" | "bilingual";
  readonly signatureHash: string;
  readonly signedAt: string;
  readonly by: string;
}

export interface QuickParkingCase {
  readonly id: string;
  readonly vehicleId: string;
  readonly customerId: string;
  readonly orderIds: ReadonlyArray<string>;
  /** 记时起点 D（Jamaica 日期 YYYY-MM-DD）。 */
  readonly notificationDate: string;
  readonly pickupDate: string | null;
  readonly pickupBy: string | null;
  readonly pickupVia: "paid" | "credit" | null;
  readonly dailyRateJmd: number;
  readonly originalChargeableDays: number;
  readonly waiverHistory: ReadonlyArray<ParkingWaiverPreview>;
  readonly creditSigns: ReadonlyArray<QuickCreditSignFact>;
  /** 停车费收款记录（每笔收款同时生成/更新停车费 Invoice）。 */
  readonly payments: ReadonlyArray<QuickParkingPayment>;
  readonly revision: number;
}

interface QuickParkingPreviewToken {
  readonly id: string;
  readonly caseId: string;
  readonly sourceRevision: number;
  readonly waiveDays: number;
  readonly reason: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

interface StoredState {
  readonly revision: number;
  readonly cases: QuickParkingCase[];
  readonly previews: QuickParkingPreviewToken[];
}

function emptyState(): StoredState {
  return { revision: 1, cases: [], previews: [] };
}

function loadState(): StoredState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as StoredState;
    if (!Array.isArray(parsed.cases) || !Array.isArray(parsed.previews)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

function saveState(state: StoredState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createOpaqueToken(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("安全随机预览令牌生成器不可用");
  return "qwp_" + globalThis.crypto.randomUUID().replaceAll("-", "");
}

// ---------------------------------------------------------------------------
// 案件派生：从快速工单的 pickupNotice 事实同步案件（按车归并）
// ---------------------------------------------------------------------------

export interface QuickOrderParkingSource {
  readonly id: string;
  readonly vehicleId: string;
  readonly customerId: string;
  readonly status: string;
  readonly pickupNotice: { readonly notifiedAt: string } | null;
}

function deriveNotification(casesForVehicle: QuickOrderParkingSource[]): { notificationDate: string; orderIds: string[] } | null {
  const noticed = casesForVehicle.filter((order) => order.status === "submitted" && order.pickupNotice);
  if (noticed.length === 0) return null;
  const earliest = noticed.map((order) => order.pickupNotice!.notifiedAt).sort()[0];
  return { notificationDate: parkingLocalCalendarDate(0, Date.parse(earliest)), orderIds: noticed.map((order) => order.id) };
}

/** 计费天数：D+1 宽限、D+2 起计费；取车日不计费（elapsed−2，与 parkingBillableDays 同口径）。 */
function billableDaysAt(notificationDate: string, pickupDate: string | null, nowMs: number): number {
  return pickupDate
    ? parkingBillableDays(notificationDate, Date.parse(pickupDate + "T12:00:00-05:00"))
    : parkingBillableDays(notificationDate, nowMs);
}

/** 同步并返回案件列表（有 pickupNotice 的车才建案；已取车案件保留历史）。 */
export function syncQuickParkingCases(orders: ReadonlyArray<QuickOrderParkingSource>): QuickParkingCase[] {
  void orders;
  return retiredQuickParkingOperation();
}

export interface QuickParkingListDto {
  readonly caseId: string;
  readonly vehicleId: string;
  readonly customerId: string;
  readonly orderIds: ReadonlyArray<string>;
  readonly notificationDate: string;
  readonly pickupDate: string | null;
  readonly pickupBy: string | null;
  readonly pickupVia: "paid" | "credit" | null;
  readonly dailyRateJmd: number;
  readonly originalChargeableDays: number;
  readonly originalAmountJmd: number;
  readonly finalChargeableDays: number;
  readonly finalAmountJmd: number;
  readonly revision: number;
  readonly waiverHistory: ReadonlyArray<ParkingWaiverPreview>;
  readonly creditSigns: ReadonlyArray<QuickCreditSignFact>;
  readonly payments: ReadonlyArray<QuickParkingPayment>;
  readonly paidJmd: number;
  readonly balanceJmd: number;
}

function latestWaiver(caseRecord: QuickParkingCase): ParkingWaiverPreview | undefined {
  return caseRecord.waiverHistory[caseRecord.waiverHistory.length - 1];
}

function toDto(caseRecord: QuickParkingCase): QuickParkingListDto {
  const last = latestWaiver(caseRecord);
  return {
    caseId: caseRecord.id,
    vehicleId: caseRecord.vehicleId,
    customerId: caseRecord.customerId,
    orderIds: caseRecord.orderIds,
    notificationDate: caseRecord.notificationDate,
    pickupDate: caseRecord.pickupDate,
    pickupBy: caseRecord.pickupBy,
    pickupVia: caseRecord.pickupVia,
    dailyRateJmd: caseRecord.dailyRateJmd,
    originalChargeableDays: caseRecord.originalChargeableDays,
    originalAmountJmd: caseRecord.originalChargeableDays * caseRecord.dailyRateJmd,
    finalChargeableDays: last?.finalChargeableDays ?? caseRecord.originalChargeableDays,
    finalAmountJmd: last?.finalAmountJmd ?? caseRecord.originalChargeableDays * caseRecord.dailyRateJmd,
    revision: caseRecord.revision,
    waiverHistory: [...caseRecord.waiverHistory],
    creditSigns: [...caseRecord.creditSigns],
    payments: [...caseRecord.payments],
    paidJmd: caseRecord.payments.reduce((sum, payment) => sum + payment.amountJmd, 0),
    balanceJmd: (last?.finalAmountJmd ?? caseRecord.originalChargeableDays * caseRecord.dailyRateJmd)
      - caseRecord.payments.reduce((sum, payment) => sum + payment.amountJmd, 0),
  };
}

export function listQuickParkingCases(orders: ReadonlyArray<QuickOrderParkingSource>): QuickParkingListDto[] {
  void orders;
  return retiredQuickParkingOperation();
}

// ---------------------------------------------------------------------------
// 减免：预览 → 确认（累计 > 50,000 需管理员现场签名）
// ---------------------------------------------------------------------------

export interface PreviewQuickWaiverInput {
  readonly caseId: string;
  readonly waiveDays: number;
  readonly reason: string;
}

export interface QuickWaiverPreviewDto extends ParkingWaiverPreview {
  readonly sourceRevision: number;
  readonly previewToken: string;
  readonly expiresAt: string;
}

export function previewQuickWaiver(input: PreviewQuickWaiverInput): QuickWaiverPreviewDto {
  void input;
  return retiredQuickParkingOperation();
}

export interface ApplyQuickWaiverInput {
  readonly caseId: string;
  readonly previewToken: string;
  readonly expectedRevision: number;
  readonly waiveDays: number;
  readonly reason: string;
  readonly administratorId?: string;
  readonly administratorSignature?: { readonly hash: string; readonly dataUrl: string };
}

export function applyQuickWaiver(input: ApplyQuickWaiverInput, actorName: string): ParkingWaiverPreview {
  void input;
  void actorName;
  return retiredQuickParkingOperation();
}

// ---------------------------------------------------------------------------
// 办理取车（§5.4 + 8/17 硬规则）：付清放行；有余额必须挂账（资格+客户签账）
// ---------------------------------------------------------------------------

export interface RecordQuickPickupInput {
  readonly caseId: string;
  /** 本车已交单订单的未结余额合计（工作区计算后传入）。 */
  readonly outstandingBalanceJmd: number;
  /** 客户当前是否有挂账资格（来自客户档案 store）。 */
  readonly creditEligible: boolean;
  /** 挂账取车时客户的签账事实（无余额时为 null）。 */
  readonly creditSign?: { readonly signerName: string; readonly language: "zh" | "en" | "bilingual"; readonly signatureHash: string };
}

export function recordQuickPickup(input: RecordQuickPickupInput, actorName: string): QuickParkingCase {
  void input;
  void actorName;
  return retiredQuickParkingOperation();
}

// ---------------------------------------------------------------------------
// 停车费收款 + 发票（2026-08-18 老板反馈）：收款即开票，Invoice 计入收付款口径
// ---------------------------------------------------------------------------

const PARKING_INVOICE_ID_PREFIX = "parking-inv-";

export function parkingInvoiceIdFor(caseId: string): string {
  return PARKING_INVOICE_ID_PREFIX + caseId;
}

/** 在 linked-operations 状态机里确保停车费 Invoice 存在且金额与当前案件一致（含减免）。 */
function ensureParkingInvoiceLinked(caseRecord: QuickParkingCase): Promise<LegacyInvoice> {
  const store = getMockLinkedOperationsStore();
  return store.mutate((state) => {
    const invoiceId = parkingInvoiceIdFor(caseRecord.id);
    const existing = state.invoices.find((item) => item.id === invoiceId) ?? null;
    if (existing && isSharedChargeInvoice(existing)) throw new Error("停车费 legacy Invoice ID 与 shared Invoice 冲突");
    const last = latestWaiver(caseRecord);
    const waivedAmount = last?.cumulativeWaivedAmountJmd ?? 0;
    const now = new Date(store.nowMs()).toISOString();
    const lines = [{
      id: invoiceId + "-line-1",
      category: "other_service" as const,
      code: "parking_overtime" as const,
      descriptionZh: `停车超时费（${caseRecord.originalChargeableDays} 天 × JMD ${caseRecord.dailyRateJmd.toLocaleString("en-US")}）`,
      descriptionEn: `Overtime parking (${caseRecord.originalChargeableDays} days × JMD ${caseRecord.dailyRateJmd.toLocaleString("en-US")})`,
      quantity: caseRecord.originalChargeableDays,
      unitPriceJmd: caseRecord.dailyRateJmd,
      sourceId: caseRecord.id,
    }];
    const adjustments = waivedAmount > 0 ? [{
      id: invoiceId + "-adj-1",
      kind: "waiver" as const,
      amountJmd: -waivedAmount,
    }] : [];
    const totals = calculateInvoiceTotals({ lines, adjustments });
    const version = {
      id: invoiceId + "-v1",
      version: 1,
      lines,
      adjustments,
      totals,
      issuedAt: now,
    };
    const fileHash = `sha256-parking-${invoiceId}-v1`;
    if (existing) {
      const mutable = existing as { -readonly [K in keyof LegacyInvoice]: LegacyInvoice[K] };
      mutable.versions = [version];
      (state.invoiceFileHashes as Record<string, string>)[version.id] = fileHash;
      state.revision += 1;
      return mutable as LegacyInvoice;
    }
    const invoice: LegacyInvoice = {
      id: invoiceId,
      invoiceNo: formatInvoiceNo({
        branchCode: "KGN",
        brandCode: "WH",
        businessDate: businessDateInJamaica(now),
        sequence: 39_000 + state.invoices.length + 1,
      }),
      businessOrderId: caseRecord.orderIds[0] ?? "",
      versions: [version],
      settlementArrangement: "normal",
    };
    (state.invoices as Invoice[]).push(invoice);
    (state.invoiceFileHashes as Record<string, string>)[version.id] = fileHash;
    state.revision += 1;
    return invoice;
  }, { action: "parking.invoice.write" });
}

export interface RecordQuickParkingPaymentInput {
  readonly caseId: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly note?: string;
}

export async function recordQuickParkingPayment(
  input: RecordQuickParkingPaymentInput,
  actorName: string,
): Promise<QuickParkingListDto> {
  void input;
  void actorName;
  return retiredQuickParkingOperation();
}

/** 取发票数据（invoice 页面用）：案件 + 发票 + 收款明细 + 客户/车辆。 */
export interface QuickParkingInvoiceBundle {
  readonly caseDto: QuickParkingListDto;
  readonly invoice: LegacyInvoice;
  readonly payments: ReadonlyArray<InvoicePaymentFact>;
  readonly customer: { id: string; nameZh: string; nameEn?: string; phone: string } | null;
  readonly vehicle: { id: string; plate: string; modelZh?: string; modelEn?: string } | null;
}

export function getQuickParkingInvoiceBundle(caseId: string): QuickParkingInvoiceBundle {
  void caseId;
  return retiredQuickParkingOperation();
}
