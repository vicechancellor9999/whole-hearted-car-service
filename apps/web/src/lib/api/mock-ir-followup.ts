import type { InspectionReportStatus } from "../orders/inspection-report";
import { getMockLinkedOperationsStore } from "./mock-orders";

/**
 * Inspection Report 跟进闭环存储（规格 2026-08-10 修订）：
 * IR 的责任到客户回复为止；转不转 Business Order 是建单侧的事。
 * 闭环五桶：待创建（纸质单）→ 待整理定稿 → 待发送客户 → 待客户回复 → 已闭环。
 * 超期未回复持续催收，账龄 2 天黄、4 天红，不闭环不下榜。
 */

export type IrIntakeChannel = "mechanic_app" | "paper_frontdesk";
export type IrReplyDecision = "accepted_all" | "accepted_partial" | "postponed" | "declined";
export type IrContactChannel = "whatsapp" | "sms" | "email" | "link" | "phone" | "in_person";

export const IR_CONTACT_CHANNEL_LABELS: Record<IrContactChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "短信",
  email: "Email",
  link: "免登录链接",
  phone: "电话",
  in_person: "当面",
};

export const IR_REPLY_DECISION_LABELS: Record<IrReplyDecision, string> = {
  accepted_all: "全部采纳",
  accepted_partial: "部分采纳",
  postponed: "暂缓",
  declined: "不修",
};

export interface IrFollowUpEvent {
  id: string;
  channel: IrContactChannel;
  note: string;
  actorName: string;
  recordedAt: string;
}

export interface IrCustomerReply {
  decision: IrReplyDecision;
  channel: IrContactChannel;
  note: string;
  repliedAt: string;
}

export interface IrFollowUpOverlay {
  reportId: string;
  intakeChannel: IrIntakeChannel;
  sentToCustomerAt?: string;
  sentChannel?: IrContactChannel;
  customerReply?: IrCustomerReply;
  followUps: IrFollowUpEvent[];
}

export interface IrPaperSlip {
  id: string;
  plate: string;
  customerName: string;
  customerPhone: string;
  inspectorName: string;
  receivedAt: string;
  summaryZh: string;
  created: boolean;
}

/** 纸质录入产生的草稿 IR：详情/审核下一轮正式接入主状态机。 */
export interface IrDraftReport {
  id: string;
  reportNo: string;
  plate: string;
  customerName: string;
  customerPhone: string;
  inspectorName: string;
  summaryZh: string;
  createdAt: string;
}

export type IrFollowUpBucket =
  | "awaiting_creation"
  | "awaiting_finalization"
  | "awaiting_send"
  | "awaiting_reply"
  | "closed";

export const IR_BUCKET_LABELS: Record<IrFollowUpBucket, string> = {
  awaiting_creation: "待创建",
  awaiting_finalization: "待整理定稿",
  awaiting_send: "待发送客户",
  awaiting_reply: "待客户回复",
  closed: "已闭环",
};

const FINALIZATION_STATUSES: ReadonlyArray<InspectionReportStatus> = [
  "mechanic_submitted",
  "ai_structured",
  "awaiting_frontdesk",
  "returned_for_revision",
];

export function bucketForReport(
  status: InspectionReportStatus,
  overlay: IrFollowUpOverlay | undefined,
): IrFollowUpBucket {
  if (overlay?.customerReply) return "closed";
  if (overlay?.sentToCustomerAt) return "awaiting_reply";
  if (FINALIZATION_STATUSES.includes(status)) return "awaiting_finalization";
  return "awaiting_send";
}

/** 待回复账龄（自然日，牙买加业务日历不按周末豁免）。 */
export function replyAgingDays(sentToCustomerAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(sentToCustomerAt)) / 86_400_000));
}

export type IrAgingLevel = "fresh" | "warn" | "overdue";

export function agingLevel(days: number): IrAgingLevel {
  if (days >= 4) return "overdue";
  if (days >= 2) return "warn";
  return "fresh";
}

interface IrFollowUpState {
  revision: number;
  slips: IrPaperSlip[];
  overlays: IrFollowUpOverlay[];
  drafts: IrDraftReport[];
  reportSequence: number;
}

const STORAGE_KEY = "wh_ir_followup_v1";
const DAY_MS = 86_400_000;

function seedSlips(nowMs: number): IrPaperSlip[] {
  // 2026-08-20 老板：旧的手写单据假演示数据（9184 KT 杜振邦 等）不符合新模型，已清空。
  // 前台代录走检查结果详情页的自然语言输入管道，不在这里造演示数据。
  return [];
}

function seedState(nowMs: number): IrFollowUpState {
  return { revision: 1, slips: seedSlips(nowMs), overlays: [], drafts: [], reportSequence: 1 };
}

function loadState(): IrFollowUpState {
  if (typeof window === "undefined") return seedState(Date.now());
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState(Date.now());
    const parsed = JSON.parse(raw) as IrFollowUpState;
    if (!Array.isArray(parsed.slips) || !Array.isArray(parsed.overlays) || !Array.isArray(parsed.drafts)) {
      return seedState(Date.now());
    }
    return parsed;
  } catch {
    return seedState(Date.now());
  }
}

function saveState(state: IrFollowUpState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mutate<T>(fn: (state: IrFollowUpState) => T): T {
  const state = loadState();
  const result = fn(state);
  state.revision += 1;
  saveState(state);
  return result;
}

export class IrFollowUpDomainError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IrFollowUpDomainError";
  }
}

function throwLegacyFollowupRetired(): never {
  throw new IrFollowUpDomainError("旧检查结果跟进写入已由 canonical linked operations 接管", 410);
}

function overlayFor(state: IrFollowUpState, reportId: string, intake: IrIntakeChannel): IrFollowUpOverlay {
  let overlay = state.overlays.find((item) => item.reportId === reportId);
  if (!overlay) {
    overlay = { reportId, intakeChannel: intake, followUps: [] };
    state.overlays.push(overlay);
  }
  return overlay;
}

export interface IrFollowUpSnapshot {
  revision: number;
  slips: IrPaperSlip[];
  overlays: IrFollowUpOverlay[];
  drafts: IrDraftReport[];
}

export function readIrFollowUpSnapshot(): IrFollowUpSnapshot {
  const state = loadState();
  return {
    revision: state.revision,
    slips: state.slips.map((slip) => ({ ...slip })),
    overlays: state.overlays.map((overlay) => ({ ...overlay, followUps: [...overlay.followUps] })),
    drafts: state.drafts.map((draft) => ({ ...draft })),
  };
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new IrFollowUpDomainError(`${label}不能为空`, 400);
  return value.trim();
}

const CONTACT_CHANNELS: ReadonlyArray<IrContactChannel> = ["whatsapp", "sms", "email", "link", "phone", "in_person"];

function requireChannel(value: string): IrContactChannel {
  if (!(CONTACT_CHANNELS as string[]).includes(value)) throw new IrFollowUpDomainError("沟通渠道无效", 400);
  return value as IrContactChannel;
}

const REPLY_DECISIONS: ReadonlyArray<IrReplyDecision> = ["accepted_all", "accepted_partial", "postponed", "declined"];

/** 纸质单创建检查结果：录入后进入待整理定稿，编号服务端原子递增。 */
export function createIrFromPaperSlip(
  slipId: string,
  actorName: string,
): IrDraftReport {
  throwLegacyFollowupRetired();
  return mutate((state) => {
    const slip = state.slips.find((item) => item.id === slipId);
    if (!slip) throw new IrFollowUpDomainError("纸质检查单不存在", 404);
    if (slip.created) throw new IrFollowUpDomainError("该纸质单已创建过检查结果", 409);
    requireText(actorName, "经办人");
    const sequence = 19_500 + state.reportSequence;
    state.reportSequence += 1;
    const draft: IrDraftReport = {
      id: `ir-draft-${state.reportSequence}`,
      reportNo: `KGN-WH-IR-20260810${sequence}`,
      plate: slip.plate,
      customerName: slip.customerName,
      customerPhone: slip.customerPhone,
      inspectorName: slip.inspectorName,
      summaryZh: slip.summaryZh,
      createdAt: new Date().toISOString(),
    };
    slip.created = true;
    state.drafts.push(draft);
    return { ...draft };
  });
}

/** 标记已发送客户：发送是独立于定稿的动作，必须显式记录。 */
export function markIrSent(
  reportId: string,
  channel: IrContactChannel,
  note: string,
  actorName: string,
): IrFollowUpOverlay {
  throwLegacyFollowupRetired();
  return mutate((state) => {
    const overlay = overlayFor(state, reportId, "mechanic_app");
    if (overlay.customerReply) throw new IrFollowUpDomainError("客户已回复，无需再标记发送", 409);
    if (overlay.sentToCustomerAt) throw new IrFollowUpDomainError("该报告已标记发送，重复发送请用催收记录", 409);
    overlay.sentToCustomerAt = new Date().toISOString();
    overlay.sentChannel = requireChannel(channel);
    overlay.followUps.push({
      id: `fu-${reportId}-${overlay.followUps.length + 1}`,
      channel: overlay.sentChannel,
      note: requireText(note, "发送说明"),
      actorName: requireText(actorName, "经办人"),
      recordedAt: overlay.sentToCustomerAt,
    });
    return { ...overlay, followUps: [...overlay.followUps] };
  });
}

/** 记录客户回复：回复到达即闭环，修不修转建单流程，IR 不再追踪。 */
export function recordIrCustomerReply(
  reportId: string,
  decision: IrReplyDecision,
  channel: IrContactChannel,
  note: string,
  actorName: string,
): IrFollowUpOverlay {
  throwLegacyFollowupRetired();
  return mutate((state) => {
    const overlay = overlayFor(state, reportId, "mechanic_app");
    if (!overlay.sentToCustomerAt) throw new IrFollowUpDomainError("尚未发送客户，不能记录回复", 409);
    if (overlay.customerReply) throw new IrFollowUpDomainError("该报告已闭环，客户回复不可改写", 409);
    if (!(REPLY_DECISIONS as string[]).includes(decision)) throw new IrFollowUpDomainError("客户决定无效", 400);
    overlay.customerReply = {
      decision,
      channel: requireChannel(channel),
      note: requireText(note, "回复内容"),
      repliedAt: new Date().toISOString(),
    };
    overlay.followUps.push({
      id: `fu-${reportId}-${overlay.followUps.length + 1}`,
      channel: overlay.customerReply.channel,
      note: `客户回复：${IR_REPLY_DECISION_LABELS[decision]} · ${overlay.customerReply.note}`,
      actorName: requireText(actorName, "经办人"),
      recordedAt: overlay.customerReply.repliedAt,
    });
    return { ...overlay, followUps: [...overlay.followUps] };
  });
}

/** 催收记一笔：超期未回复的跟进留痕，不重置首次发送日期。 */
export function recordIrFollowUp(
  reportId: string,
  channel: IrContactChannel,
  note: string,
  actorName: string,
): IrFollowUpOverlay {
  throwLegacyFollowupRetired();
  return mutate((state) => {
    const overlay = overlayFor(state, reportId, "mechanic_app");
    if (!overlay.sentToCustomerAt) throw new IrFollowUpDomainError("尚未发送客户，不能催收", 409);
    if (overlay.customerReply) throw new IrFollowUpDomainError("该报告已闭环，无需催收", 409);
    overlay.followUps.push({
      id: `fu-${reportId}-${overlay.followUps.length + 1}`,
      channel: requireChannel(channel),
      note: requireText(note, "催收内容"),
      actorName: requireText(actorName, "经办人"),
      recordedAt: new Date().toISOString(),
    });
    return { ...overlay, followUps: [...overlay.followUps] };
  });
}

/** 测试辅助：把某报告直接置为"N 天前已发送"。仅用于演示数据构造。 */
export function seedIrSentDaysAgo(reportId: string, days: number, channel: IrContactChannel): void {
  throwLegacyFollowupRetired();
  mutate((state) => {
    const overlay = overlayFor(state, reportId, "mechanic_app");
    if (!overlay.sentToCustomerAt) {
      overlay.sentToCustomerAt = new Date(Date.now() - days * DAY_MS).toISOString();
      overlay.sentChannel = channel;
    }
  });
}

export type IrFollowUpActionInput =
  | { type: "create_from_slip"; slipId: string }
  | { type: "mark_sent"; reportId: string; channel: string; note: string }
  | { type: "record_reply"; reportId: string; decision: string; channel: string; note: string }
  | { type: "record_followup"; reportId: string; channel: string; note: string };

export async function runIrFollowUpAction(
  input: IrFollowUpActionInput,
  actorName: string,
  store = getMockLinkedOperationsStore(),
): Promise<unknown> {
  void input;
  void actorName;
  await store.ready();
  throwLegacyFollowupRetired();
}
