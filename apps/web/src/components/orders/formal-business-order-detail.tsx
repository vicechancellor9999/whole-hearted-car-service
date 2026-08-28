"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";
import { FormalInspectionCreateDialog } from "@/components/orders/formal-inspection-create-dialog";
import { FormalBusinessOrderMessages } from "@/components/orders/formal-business-order-messages";
import {
  FormalBusinessOrderTabs,
  parseBusinessOrderWorkspace,
} from "@/components/orders/formal-business-order-tabs";
import { RecordDeleteButton } from "@/components/shared/record-delete-dialog";
import { fetchFormalInspectionReports, type FormalInspectionListItem } from "@/lib/api/formal-inspections";
import {
  appendFormalRefundProof,
  appendFormalRefundSignedAcknowledgement,
  cancelFormalHandoffInSameMonth,
  fetchFormalBusinessOrder,
  fetchFormalRepairRounds,
  formalDocumentKindLabel,
  formalBusinessOrderStatusLabel,
  formalGroupedChargeDiscounts,
  formalRefundHasSignedAcknowledgement,
  formalRefundNeedsProof,
  formatFormalMoney,
  generateFormalDocument,
  recordFormalPayment,
  recordFormalRefund,
  replaceFormalChargeVersion,
  runFormalRepairRoundAction,
  type FormalBusinessOrderDetail,
  type FormalChargeSnapshot,
  type FormalRepairRoundWorkspace,
} from "@/lib/api/formal-business-orders";
import { fetchFormalMasterData, type FormalMasterData } from "@/lib/api/formal-master-data";
import { aiParseFormalChargeEntry, aiTranslateRepair } from "@/lib/ai/auto-repair";
import { parseChargeEntryInput } from "@/lib/orders/nl-parse";
import { formatDateTime } from "@/lib/utils";

const PROGRESS = [
  ["waiting_assignment", "待派单"],
  ["assigned", "已派单"],
  ["in_repair", "维修中"],
  ["return_pending_review", "回单待审核"],
  ["formally_handed_off", "已交单"],
] as const;

const CATEGORY_LABELS = { labor: "工时", part: "配件", other: "其他费用" } as const;

type ChargeDraftItem = {
  key: string;
  kind: "labor" | "part" | "other";
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  unitItemId: number;
  quantity: string;
  unitPrice: string;
  itemDiscount: string;
};

type ChargeDraftNote = {
  key: string;
  kind: "customer_concern" | "work_instruction" | "liability_notice" | "internal";
  contentZh: string;
  contentEn: string;
};

const NOTE_KIND_LABELS: Record<ChargeDraftNote["kind"], string> = {
  customer_concern: "客户反馈",
  work_instruction: "施工说明",
  liability_notice: "责任说明 / 提前告知",
  internal: "内部备注",
};

const ROUND_EVENT_LABELS: Record<string, string> = {
  assigned: "派给维修班组",
  assignment_withdrawn: "撤回派单",
  accepted: "维修工接单",
  mileage_recorded: "记录接车里程",
  intake_mileage_recorded: "记录接车里程",
  intake_photos_recorded: "归档接车照片",
  intake_photo_linked: "归档接车照片",
  return_submitted: "维修工提交维修回单，等待前台审核",
  work_return_submitted: "维修工提交维修回单，等待前台审核",
  return_approved: "前台审核通过并正式交单",
  work_return_approved: "前台审核通过并正式交单",
  return_rejected: "前台退回维修回单，等待维修班组补充",
  work_return_rejected: "前台退回维修回单，等待维修班组补充",
  formally_handed_off: "正式交单",
};

const AUDIT_EVENT_LABELS: Record<string, string> = {
  "business_order.created": "创建 Business Order",
  "business_order.round_assigned": "派给维修班组",
  "business_order.assignment_withdrawn": "撤回维修班组派单",
  "business_order.round_accepted": "维修工接单",
  "business_order.intake_mileage_recorded": "记录接车里程",
  "business_order.work_return_submitted": "提交维修回单",
  "business_order.work_return_approved": "审核通过维修回单",
  "business_order.work_return_rejected": "退回维修回单",
  "business_order.formally_handed_off": "正式交单",
  "business_order.after_sales_round_started": "开始下一轮售后维修",
  "business_order.after_sales_round_cancelled": "撤销误建售后维修轮次",
  "business_order.charge_version_replaced": "修改收费项目和备注",
  "business_order.charges_replaced": "修改收费项目和备注",
  "business_order.payment_recorded": "登记收款并生成 Receipt",
  "business_order.refund_recorded": "登记退款",
  "payment.recorded": "登记收款",
  "refund.created": "登记退款",
  "refund.proof_attached": "上传退款凭证",
  "refund.signed_acknowledgement_attached": "上传客户签字的退款签收单",
  "business_order.document_generated": "生成正式打印文件",
  "business_order.document_reprinted": "补打正式打印文件",
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
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
  paymentNo: "收款编号",
  refundNo: "退款编号",
  receiptNo: "Receipt 编号",
  paymentMethodCode: "收退款方式",
  originalDocumentStatus: "原客户单据",
  evidenceKinds: "退款签收资料",
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

const REFUND_EVIDENCE_LABELS: Record<string, string> = {
  customer_signature: "客户签字的退款签收单",
  refund_proof: "退款凭证",
};

function roundEventLabel(eventType: string): string {
  return ROUND_EVENT_LABELS[eventType] ?? "记录了一次维修操作";
}

function auditEventLabel(eventType: string): string {
  return AUDIT_EVENT_LABELS[eventType] ?? "完成一次业务操作";
}

function auditValue(
  field: string,
  value: unknown,
  masterData: FormalMasterData,
): string {
  if (value === null || value === undefined || value === "") return "空";
  if ((field === "teamId" || field === "assignedTeamId") && typeof value === "number") {
    return masterData.teams.find((team) => team.id === value)?.name ?? `维修班组 #${value}`;
  }
  if (field === "status" && typeof value === "string" && PROGRESS.some(([status]) => status === value)) {
    return formalBusinessOrderStatusLabel(value as (typeof PROGRESS)[number][0]);
  }
  if (field === "paymentMethodCode" && typeof value === "string") {
    return PAYMENT_METHOD_LABELS[value] ?? "其他方式";
  }
  if (field === "originalDocumentStatus" && typeof value === "string") {
    return ORIGINAL_DOCUMENT_LABELS[value] ?? "原客户单据状态已记录";
  }
  if (field === "evidenceKinds" && Array.isArray(value)) {
    const labels = value.map((item) => REFUND_EVIDENCE_LABELS[String(item)]).filter(Boolean);
    return labels.length > 0 ? labels.join("、") : "退款签收资料已记录";
  }
  if (field.endsWith("Minor") && typeof value === "number") return formatFormalMoney(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return "相关资料已保存";
  return String(value);
}

function auditBusinessSummary(
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
  const receiptNo = typeof values.receiptNo === "string" ? values.receiptNo : null;

  if (eventType === "payment.recorded" || eventType === "business_order.payment_recorded") {
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
  return auditEventLabel(eventType);
}

function auditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  masterData: FormalMasterData,
) {
  const keys = Array.from(new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])).filter((key) => key !== "businessOrderId" && Boolean(AUDIT_FIELD_LABELS[key]));
  return keys
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => ({
      key,
      label: AUDIT_FIELD_LABELS[key],
      before: auditValue(key, before?.[key], masterData),
      after: auditValue(key, after?.[key], masterData),
      hasBefore: Boolean(before && Object.prototype.hasOwnProperty.call(before, key)),
      hasAfter: Boolean(after && Object.prototype.hasOwnProperty.call(after, key)),
    }));
}

function RepairHistoryDialog({
  rounds,
  masterData,
  onClose,
}: {
  rounds: FormalRepairRoundWorkspace;
  masterData: FormalMasterData;
  onClose?: () => void;
}) {
  const teamName = (teamId: number | null) => {
    if (!teamId) return null;
    return masterData.teams.find((team) => team.id === teamId)?.name ?? `维修班组 #${teamId}`;
  };

  const content = (
    <>
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <div><h2 className="text-base font-bold">Business Order 全部历史与修改记录</h2><p className="mt-1 text-xs text-ink-soft">按时间显示操作人、业务动作和操作结果。</p></div>
          {onClose ? <button type="button" onClick={onClose} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">关闭并返回</button> : null}
        </div>
        <div className="mt-3 space-y-3">
          {[...rounds.history].sort((left, right) => right.roundNo - left.roundNo).map((round) => {
            const handoff = [...round.formalHandoffs].reverse().find((candidate) => !candidate.cancelledAt) ?? null;
            const historicalTeamId = round.assignedTeamId ?? [...round.events].reverse().find((event) => event.teamId)?.teamId ?? null;
            return <article key={round.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold">第 {round.roundNo} 轮维修</h3><p className="mt-1 text-xs text-ink-soft">{round.source === "after_sales" ? `售后回厂：${round.afterSalesIssue}` : "首次维修"}</p></div><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary">{formalBusinessOrderStatusLabel(round.status)}</span></div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><span>维修班组<strong className="mt-1 block">{teamName(historicalTeamId) ?? "尚未派组"}</strong></span><span>本轮绩效<strong className="mt-1 block">{handoff ? formatFormalMoney(handoff.performanceMinor) : "尚未交单"}</strong></span><span>交单时间<strong className="mt-1 block">{handoff ? formatDateTime(handoff.handedOffAt) : "尚未交单"}</strong></span></div>
              {round.events.length > 0 ? <ol className="mt-3 border-t border-line pt-2">{round.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 py-1 text-xs"><span>{roundEventLabel(event.eventType)}{event.teamId ? ` · ${teamName(event.teamId)}` : ""}{event.note ? ` · ${event.note}` : ""}</span><time className="text-ink-soft">{formatDateTime(event.occurredAt)}</time></li>)}</ol> : <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">本轮尚无操作记录。</p>}
            </article>;
          })}
        </div>
        <section className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h3 className="text-sm font-bold">完整业务流水</h3><p className="mt-1 text-xs text-ink-soft">按时间倒序展示谁做了什么，以及操作后的业务结果。</p></div>
            <span className="text-xs font-semibold text-ink-soft">共 {rounds.auditTrail.length} 条</span>
          </div>
          {rounds.auditTrail.length > 0 ? <ol className="mt-3 space-y-2">
            {rounds.auditTrail.map((event) => {
              const changes = auditChanges(event.before, event.after, masterData);
              const actor = event.actorDisplayName?.trim() || event.actorUsername?.trim() || (event.actorAccountId ? `账号 #${event.actorAccountId}` : "系统");
              const summary = auditBusinessSummary(event.eventType, event.after, masterData);
              return <li key={event.id} className="rounded-xl border border-line p-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-[145px_150px_minmax(0,1fr)]">
                  <span><small className="block text-ink-soft">时间</small><time className="font-semibold">{formatDateTime(event.occurredAt)}</time></span>
                  <span><small className="block text-ink-soft">操作人</small><strong className="block">{actor}</strong></span>
                  <span><small className="block text-ink-soft">做了什么，结果如何</small><strong className="block">{summary}</strong>{event.reason ? <small className="mt-1 block text-ink-soft">原因：{event.reason}</small> : null}</span>
                </div>
                <div className="mt-3 rounded-lg bg-surface p-2 dark:bg-slate-800/70">
                  <strong className="block text-[11px]">变化结果</strong>
                  {changes.length > 0 ? <div className="mt-1 space-y-1">{changes.map((change) => <div key={change.key} className="grid gap-1 border-t border-line/60 pt-1 first:border-0 sm:grid-cols-[130px_1fr_1fr]"><span className="font-semibold">{change.label}</span><span><small className="mr-1 text-ink-soft">原来</small>{change.hasBefore ? change.before : "尚未记录"}</span><span><small className="mr-1 text-ink-soft">现在</small>{change.hasAfter ? change.after : "已清除"}</span></div>)}</div> : <p className="mt-1 text-ink-soft">这次操作没有改变需要单独展示的业务数据。</p>}
                </div>
              </li>;
            })}
          </ol> : <p className="mt-3 rounded-xl bg-surface px-3 py-4 text-xs text-ink-soft">尚无可展示的审计记录。</p>}
        </section>
    </>
  );

  if (!onClose) return <div>{content}</div>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Business Order 全部维修历史" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">{content}</section>
    </div>
  );
}

const moneyText = (minor: number) => String(minor / 100);

function chargeDraftFromSnapshot(charges: FormalChargeSnapshot): ChargeDraftItem[] {
  return charges.items.map((item) => ({
    key: `charge-${item.id}`,
    kind: item.kind,
    nameZh: item.nameZh,
    nameEn: item.nameEn ?? "",
    descriptionZh: item.descriptionZh ?? "",
    descriptionEn: item.descriptionEn ?? "",
    unitItemId: item.unitItemId,
    quantity: item.quantity,
    unitPrice: moneyText(item.unitPriceMinor),
    itemDiscount: moneyText(item.itemDiscountMinor),
  }));
}

function chargeNoteDraftFromSnapshot(charges: FormalChargeSnapshot): ChargeDraftNote[] {
  return charges.notes.map((note) => ({
    key: `note-${note.id}`,
    kind: note.kind as ChargeDraftNote["kind"],
    contentZh: note.contentZh ?? "",
    contentEn: note.contentEn ?? "",
  }));
}

function ChargeSection({
  charges,
  kind,
  unitLabels,
}: {
  charges: FormalChargeSnapshot;
  kind: keyof typeof CATEGORY_LABELS;
  unitLabels: Map<number, string>;
}) {
  const items = charges.items.filter((item) => item.kind === kind);
  if (items.length === 0) return null;
  return (
    <section className="mt-3">
      <h3 className="text-xs font-bold text-primary">{CATEGORY_LABELS[kind]}</h3>
      <div className="mt-1 overflow-hidden rounded-xl border border-line dark:border-slate-700">
        <div className="hidden grid-cols-[1.55fr_1.4fr_.65fr_.55fr_.8fr_.75fr_.8fr] gap-2 bg-surface px-3 py-2 text-[10px] font-semibold text-ink-soft dark:bg-slate-800/60 lg:grid">
          <span>项目名称</span><span>描述</span><span>单位</span><span>数量</span><span className="text-right">含税单价</span><span className="text-right">本项折扣</span><span className="text-right">小计</span>
        </div>
        {items.map((item) => (
          <div key={item.id} className="grid min-w-0 gap-2 border-t border-line/70 px-3 py-2.5 text-xs first:border-0 dark:border-slate-700 lg:grid-cols-[1.55fr_1.4fr_.65fr_.55fr_.8fr_.75fr_.8fr] lg:items-center">
            <span className="min-w-0"><strong className="block truncate text-ink dark:text-slate-100">{item.nameZh}</strong>{item.nameEn ? <small className="block truncate text-primary">{item.nameEn}</small> : null}</span>
            <span className="min-w-0"><span className="block truncate text-ink-soft">{item.descriptionZh ?? "—"}</span>{item.descriptionEn ? <small className="block truncate text-ink-faint">{item.descriptionEn}</small> : null}</span>
            <span>{unitLabels.get(item.unitItemId) ?? "—"}</span>
            <span className="tabular-nums">{item.quantity}</span>
            <span className="text-right tabular-nums">{formatFormalMoney(item.unitPriceMinor)}</span>
            <span className="text-right tabular-nums text-rose-600">{item.itemDiscountMinor > 0 ? `−${formatFormalMoney(item.itemDiscountMinor)}` : formatFormalMoney(0)}</span>
            <strong className="text-right tabular-nums">{formatFormalMoney(item.subtotalMinor)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FormalBusinessOrderDetailView({ businessOrderId }: { businessOrderId: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeWorkspace = parseBusinessOrderWorkspace(searchParams.get("tab"));
  const highlightedMessageId = Number(searchParams.get("message"));
  const workspaceSearchParams = useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );
  const [data, setData] = useState<FormalBusinessOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loadGeneration = useRef(0);
  const inspectionLoadGeneration = useRef(0);
  const [rounds, setRounds] = useState<FormalRepairRoundWorkspace | null>(null);
  const [masterData, setMasterData] = useState<FormalMasterData | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [refundFormOpen, setRefundFormOpen] = useState(false);
  const [advanceRoundOpen, setAdvanceRoundOpen] = useState(false);
  const [inspectionCreateOpen, setInspectionCreateOpen] = useState(false);
  const [afterSalesOpen, setAfterSalesOpen] = useState(false);
  const [cancelHandoffDraft, setCancelHandoffDraft] = useState<{
    handoffId: number;
    reason: string;
  } | null>(null);
  const cancelHandoffInFlight = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [relatedInspectionReports, setRelatedInspectionReports] = useState<FormalInspectionListItem[]>([]);
  const [chargeEditing, setChargeEditing] = useState(false);
  const [naturalLanguageOpen, setNaturalLanguageOpen] = useState(false);
  const [naturalLanguageText, setNaturalLanguageText] = useState("");
  const [chargeDraft, setChargeDraft] = useState<ChargeDraftItem[]>([]);
  const [chargeNoteDraft, setChargeNoteDraft] = useState<ChargeDraftNote[]>([]);
  const [chargeActionError, setChargeActionError] = useState<string | null>(null);
  const [chargeActionNotice, setChargeActionNotice] = useState<string | null>(null);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [naturalLanguageBusy, setNaturalLanguageBusy] = useState(false);
  const handleMentionsRead = useCallback(() => {
    setData((current) => current ? { ...current, unreadMentionCount: 0 } : current);
  }, []);

  useEffect(() => {
    let active = true;
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setData(null);
    setError(null);
    void Promise.all([
      fetchFormalBusinessOrder(businessOrderId),
      fetchFormalRepairRounds(businessOrderId),
      fetchFormalMasterData(),
    ])
      .then(([detail, roundWorkspace, formalMasterData]) => {
        if (active && loadGeneration.current === generation) {
          setData(detail);
          setRounds(roundWorkspace);
          setMasterData(formalMasterData);
        }
      })
      .catch((caught) => {
        if (active && loadGeneration.current === generation) {
          setError(caught instanceof Error ? caught.message : "Business Order 读取失败");
        }
      });
    return () => { active = false; };
  }, [businessOrderId, reloadKey]);

  useEffect(() => {
    let active = true;
    const generation = inspectionLoadGeneration.current + 1;
    inspectionLoadGeneration.current = generation;
    void fetchFormalInspectionReports({ sourceBusinessOrderId: businessOrderId })
      .then((result) => {
        if (active && inspectionLoadGeneration.current === generation) {
          setRelatedInspectionReports(result.items);
        }
      })
      .catch(() => {
        if (active && inspectionLoadGeneration.current === generation) {
          setRelatedInspectionReports([]);
        }
      });
    return () => { active = false; };
  }, [businessOrderId, reloadKey]);

  const refresh = useCallback(() => {
    loadGeneration.current += 1;
    inspectionLoadGeneration.current += 1;
    setReloadKey((value) => value + 1);
  }, []);
  const unitLabels = useMemo(() => new Map(
    data?.chargeUnits.map((unit) => [unit.id, unit.labelEn ? `${unit.labelZh} / ${unit.labelEn}` : unit.labelZh]) ?? [],
  ), [data]);
  const assignedTeamStaff = useMemo(() => {
    if (!masterData || !rounds?.current.assignedTeamId) return [];
    return masterData.staff.filter((staff) =>
      staff.status === "active" && staff.currentTeamId === rounds.current.assignedTeamId,
    );
  }, [masterData, rounds?.current.assignedTeamId]);

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordFormalPayment(businessOrderId, {
        amount: String(fields.get("amount") ?? ""),
        paymentMethodItemId: Number(fields.get("paymentMethodItemId")),
        note: String(fields.get("note") ?? "") || undefined,
      });
      form.reset();
      setPaymentFormOpen(false);
      setNotice(`收款已记录，Receipt：${result.receipt.receiptNo}`);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "收款失败");
    } finally {
      setBusy(false);
    }
  };

  const submitRefund = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const refund = await recordFormalRefund(businessOrderId, fields);
      form.reset();
      setRefundFormOpen(false);
      setNotice(`退款已生成：${refund.refundNo}。请打印退款签收单交客户手写签字；签字件可稍后回传。`);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退款失败");
    } finally {
      setBusy(false);
    }
  };

  const submitProof = async (event: FormEvent<HTMLFormElement>, refundId: number) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const refund = await appendFormalRefundProof(businessOrderId, refundId, new FormData(form));
      setNotice(`退款凭证已归档：${refund.refundNo}。凭证不可替换。`);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退款凭证上传失败");
    } finally {
      setBusy(false);
    }
  };

  const submitSignedAcknowledgement = async (
    event: FormEvent<HTMLFormElement>,
    refundId: number,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const refund = await appendFormalRefundSignedAcknowledgement(
        businessOrderId,
        refundId,
        new FormData(form),
      );
      setNotice(`签字后的退款签收单已归档：${refund.refundNo}。签字件不可替换。`);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退款签收单上传失败");
    } finally {
      setBusy(false);
    }
  };

  const generatePrintDocument = async (kind: "customer_copy" | "office_archive" | "mechanic_work") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const document = await generateFormalDocument(businessOrderId, kind);
      window.location.href = `/orders/business/${businessOrderId}/documents/${document.id}/print`;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打印文档生成失败");
      setBusy(false);
    }
  };

  const submitRoundAction = async (input: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runFormalRepairRoundAction(businessOrderId, input);
      setRounds(result);
      setNotice(success);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "维修轮次操作失败");
    } finally { setBusy(false); }
  };

  const beginChargeEditing = () => {
    if (!data) return;
    setChargeDraft(chargeDraftFromSnapshot(data.charges));
    setChargeNoteDraft(chargeNoteDraftFromSnapshot(data.charges));
    setChargeActionError(null);
    setChargeActionNotice(null);
    setChargeEditing(true);
  };

  const updateChargeDraft = (key: string, field: keyof ChargeDraftItem, value: string | number) => {
    setChargeDraft((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  };

  const addChargeDraftItem = (kind: ChargeDraftItem["kind"]) => {
    if (!data?.chargeUnits[0]) return;
    setChargeEditing(true);
    setChargeDraft((current) => [...current, {
      key: `new-${Date.now()}-${current.length}`,
      kind,
      nameZh: "",
      nameEn: "",
      descriptionZh: "",
      descriptionEn: "",
      unitItemId: data.chargeUnits[0].id,
      quantity: "1",
      unitPrice: "0",
      itemDiscount: "0",
    }]);
  };

  const updateChargeNoteDraft = (key: string, field: keyof ChargeDraftNote, value: string) => {
    setChargeNoteDraft((current) => current.map((note) => note.key === key ? { ...note, [field]: value } : note));
  };

  const addChargeNoteDraft = () => {
    setChargeNoteDraft((current) => [...current, {
      key: `new-note-${Date.now()}-${current.length}`,
      kind: "customer_concern",
      contentZh: "",
      contentEn: "",
    }]);
  };

  const translateChargeDraftItem = async (key: string) => {
    const item = chargeDraft.find((candidate) => candidate.key === key);
    if (!item || (!item.nameZh.trim() && !item.descriptionZh.trim())) {
      setChargeActionError("请先填写要翻译的中文项目名称或描述");
      return;
    }
    setTranslatingKey(`item-${key}`);
    setChargeActionError(null);
    setChargeActionNotice(null);
    try {
      const [nameEn, descriptionEn] = await Promise.all([
        item.nameZh.trim() ? aiTranslateRepair(item.nameZh) : Promise.resolve(null),
        item.descriptionZh.trim() ? aiTranslateRepair(item.descriptionZh) : Promise.resolve(null),
      ]);
      if (!nameEn && !descriptionEn) {
        setChargeActionError("AI 翻译没有返回结果，请到系统设置检查 AI 服务后重试");
        return;
      }
      setChargeDraft((current) => current.map((candidate) => candidate.key === key ? {
        ...candidate,
        nameEn: nameEn ?? candidate.nameEn,
        descriptionEn: descriptionEn ?? candidate.descriptionEn,
      } : candidate));
      setChargeActionNotice("当前收费项目已翻译，请核对后保存");
    } finally {
      setTranslatingKey(null);
    }
  };

  const translateChargeNoteDraft = async (key: string) => {
    const note = chargeNoteDraft.find((candidate) => candidate.key === key);
    if (!note?.contentZh.trim()) {
      setChargeActionError("请先填写要翻译的中文备注");
      return;
    }
    setTranslatingKey(`note-${key}`);
    setChargeActionError(null);
    setChargeActionNotice(null);
    try {
      const contentEn = await aiTranslateRepair(note.contentZh);
      if (!contentEn) {
        setChargeActionError("AI 翻译没有返回结果，请到系统设置检查 AI 服务后重试");
        return;
      }
      setChargeNoteDraft((current) => current.map((candidate) => candidate.key === key
        ? { ...candidate, contentEn }
        : candidate));
      setChargeActionNotice("当前备注已翻译，请核对后保存");
    } finally {
      setTranslatingKey(null);
    }
  };

  const withdrawCurrentAssignment = () => {
    if (!rounds) return;
    const confirmed = window.confirm("撤回后，本轮回到待派单。已有接单、里程、照片、回单和时间记录都会保留。确认撤回？");
    if (!confirmed) return;
    void submitRoundAction({
      action: "withdraw_assignment",
      repairRoundVersion: rounds.current.version,
    }, "派单已撤回，现在可以重新选择维修班组");
  };

  const cancelAccidentalAfterSalesRound = () => {
    if (!rounds) return;
    const confirmed = window.confirm("仅撤销尚未产生任何实际记录的误建售后轮次，并恢复上一轮已交单状态。确认撤销本轮？");
    if (!confirmed) return;
    setAfterSalesOpen(false);
    void submitRoundAction({
      action: "cancel_after_sales",
      repairRoundVersion: rounds.current.version,
    }, "误建维修轮次已撤销，已恢复上一轮已交单状态");
  };

  const stageNaturalLanguage = async () => {
    if (!data || !naturalLanguageText.trim()) return;
    setNaturalLanguageBusy(true);
    setChargeActionError(null);
    setChargeActionNotice(null);
    const aiParsed = await aiParseFormalChargeEntry(naturalLanguageText);
    const parsed = aiParsed ?? parseChargeEntryInput(naturalLanguageText);
    const staged = parsed.items.map((item, index): ChargeDraftItem => {
      const kind: ChargeDraftItem["kind"] = item.category === "parts" ? "part" : "labor";
      const preferredUnit = data.chargeUnits.find((unit) =>
        (kind === "labor" && unit.labelZh.includes("工时"))
        || (kind === "part" && (unit.labelZh.includes("件") || unit.labelZh.includes("个"))),
      ) ?? data.chargeUnits[0];
      return {
        key: `natural-${Date.now()}-${index}`,
        kind,
        nameZh: item.descZh,
        nameEn: item.descEn,
        descriptionZh: item.remarkZh ?? "",
        descriptionEn: item.remarkEn ?? "",
        unitItemId: preferredUnit.id,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPriceJmd ?? 0),
        itemDiscount: String(item.discountJmd ?? 0),
      };
    });
    setChargeDraft((current) => [...(chargeEditing ? current : chargeDraftFromSnapshot(data.charges)), ...staged]);
    const stagedNotes = parsed.notes.map((note, index): ChargeDraftNote => ({
      key: `natural-note-${Date.now()}-${index}`,
      kind: note.kind,
      contentZh: note.contentZh,
      contentEn: note.contentEn,
    }));
    setChargeNoteDraft((current) => [
      ...(chargeEditing ? current : chargeNoteDraftFromSnapshot(data.charges)),
      ...stagedNotes,
    ]);
    setChargeEditing(true);
    setNaturalLanguageOpen(false);
    setNaturalLanguageText("");
    setNaturalLanguageBusy(false);
    setChargeActionNotice(`${aiParsed ? "AI" : "本地规则"}已整理 ${staged.length} 个收费项目和 ${stagedNotes.length} 条备注草稿，请核对后保存`);
  };

  const submitCharges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    setChargeActionError(null);
    setChargeActionNotice("正在保存收费项目和备注…");
    try {
      await replaceFormalChargeVersion(businessOrderId, {
        expectedBusinessOrderVersion: data.order.version,
        reason: String(fields.get("reason") ?? ""),
        laborDiscount: "0",
        partDiscount: "0",
        otherDiscount: "0",
        wholeOrderDiscount: "0",
        items: chargeDraft.map(({ key: _key, ...item }) => item),
        notes: chargeNoteDraft
          .filter((note) => note.contentZh.trim() || note.contentEn.trim())
          .map(({ key: _key, ...note }) => note),
      });
      setChargeEditing(false);
      setNotice("收费项目已保存为新版本");
      setChargeActionNotice(null);
      refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "收费项目保存失败";
      setError(message);
      setChargeActionNotice(null);
      setChargeActionError(message);
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return <div role="status" className="mx-auto mt-6 h-[640px] max-w-[1720px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />;
  if (error && !data) return <div role="alert" className="mx-auto mt-6 flex min-h-[360px] max-w-[1720px] flex-col items-center justify-center rounded-2xl border border-rose-200"><AlertCircle className="text-rose-600" /><p className="mt-2 text-sm font-semibold">{error}</p><button type="button" onClick={refresh} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm"><RefreshCw size={14} />重试</button></div>;
  if (!data) return null;

  const { order, charges, ledger } = data;
  const isFinanciallySettled = ledger.balanceMinor === 0;
  const groupedDiscounts = formalGroupedChargeDiscounts(charges);
  const progressIndex = PROGRESS.findIndex(([status]) => status === order.status);
  const refundById = new Map(data.refunds.map((refund) => [refund.id, refund]));
  const payerMeta = [
    `费用承担：${order.payer.displayName}`,
    order.payer.contactName?.trim() || null,
    order.payer.phone?.trim() || null,
    order.payer.trn?.trim() ? `TRN ${order.payer.trn.trim()}` : null,
  ].filter((value): value is string => Boolean(value));
  const currentRoundHistory = rounds?.history.find((round) => round.id === rounds.current.id) ?? null;
  const currentActiveHandoff = currentRoundHistory?.formalHandoffs.find((handoff) => !handoff.cancelledAt) ?? null;
  const currentHistoricalTeamId = rounds?.current.assignedTeamId
    ?? [...(currentRoundHistory?.events ?? [])].reverse().find((event) => event.teamId)?.teamId
    ?? null;
  const currentTeamName = currentHistoricalTeamId
    ? masterData?.teams.find((team) => team.id === currentHistoricalTeamId)?.name ?? `维修班组 #${currentHistoricalTeamId}`
    : null;

  const submitHandoffCancellation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cancelHandoffInFlight.current) return;

    const draft = cancelHandoffDraft;
    if (
      !data.capabilities.canWrite
      || !currentActiveHandoff
      || !draft
      || draft.handoffId !== currentActiveHandoff.id
    ) {
      setError("正式交单状态已变化，请刷新后重试");
      return;
    }

    const reason = draft.reason.trim();
    if (!reason) {
      setError("请输入同月取消正式交单原因");
      return;
    }

    cancelHandoffInFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const workspace = await cancelFormalHandoffInSameMonth(businessOrderId, {
        formalHandoffId: draft.handoffId,
        reason,
      });
      setRounds(workspace);
      setCancelHandoffDraft(null);
      setNotice("本次正式交单已在同月取消，原交单事实仍保留");
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消正式交单失败");
    } finally {
      cancelHandoffInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div data-testid="formal-business-order-detail" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px] space-y-3">
        <header className="rounded-[22px] border border-[#dbe7f7] bg-[linear-gradient(110deg,#eef6ff,#f8fbff)] p-4 shadow-card dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><Link href="/orders/business" className="text-xs font-semibold text-primary">← 返回 Business Order 列表</Link><h1 className="mt-2 text-2xl font-bold text-ink dark:text-slate-100">{order.orderNo}</h1><p className="mt-1 text-sm text-ink-soft">{order.vehicle.plate} · {order.vehicle.description}{order.vehicle.vin ? ` · VIN ${order.vehicle.vin}` : ""}</p><p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">{payerMeta.map((value) => <span key={value}>{value}</span>)}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {isFinanciallySettled ? <span className="rounded-full border border-emerald-300 bg-emerald-100 px-4 py-2 text-xs font-black text-emerald-800 shadow-sm">财务已结清</span> : null}
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary shadow-sm dark:bg-slate-800">{order.voided ? "已作废" : formalBusinessOrderStatusLabel(order.status)}</span>
              <RecordDeleteButton
                record={{ kind: "business_order", recordNo: order.orderNo, version: order.version }}
                title="删除业务单"
                returnTo="/orders/business"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/70 dark:bg-slate-800 dark:text-rose-300"
              />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-1.5">
            {PROGRESS.map(([status, label], index) => <div key={status} className={`rounded-md border px-2 py-2 text-center text-[11px] font-semibold ${index < progressIndex ? "border-primary bg-primary text-white" : index === progressIndex ? "border-amber-400 bg-amber-300 text-amber-950" : "border-line bg-white/70 text-ink-soft dark:bg-slate-800"}`}>{index + 1} {label}</div>)}
          </div>
        </header>

        {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}

        <FormalBusinessOrderTabs
          pathname={pathname}
          searchParams={workspaceSearchParams}
          active={activeWorkspace}
          unreadMessageCount={data.unreadMentionCount}
        />

        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        {rounds && masterData ? <section id="business-order-repair-workspace" hidden={activeWorkspace !== "operations"} className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/50 xl:col-start-2 xl:row-start-1">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">第 {rounds.current.roundNo} 轮维修</h2><p className="mt-1 text-xs text-ink-soft">{rounds.current.source === "after_sales" ? `售后回厂：${rounds.current.afterSalesIssue}` : "首次维修"} · 每轮记录和正式交单时间独立保留</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setHistoryOpen(true)} className="min-h-8 rounded-lg border border-line px-3 text-xs font-bold">查看整单历史</button><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary">{formalBusinessOrderStatusLabel(rounds.current.status)}</span>{(["assigned", "in_repair", "return_pending_review"] as const).includes(rounds.current.status as "assigned" | "in_repair" | "return_pending_review") ? <button disabled={busy} type="button" onClick={withdrawCurrentAssignment} className="min-h-8 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-700 disabled:opacity-40">撤回派单</button> : null}</div></div>
          {rounds.current.status === "waiting_assignment" ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); const confirmed = ledger.totalPaidMinor > 0 || window.confirm("本单尚无收款信息。是否已经与客户确认好业务内容？选择取消则不派单。 "); if (!confirmed) return; void submitRoundAction({ action: "assign", businessOrderVersion: order.version, teamId: Number(selectedTeamId), customerConfirmed: true }, "已派给维修班组"); }}><fieldset><legend className="text-xs font-bold">选择维修班组</legend><div className="mt-2 flex flex-wrap gap-2">{masterData.teams.filter((team) => team.isActive).map((team) => <label key={team.id} className={`cursor-pointer rounded-lg border px-4 py-3 text-xs font-bold transition ${selectedTeamId === String(team.id) ? "border-primary bg-primary text-white" : "border-line bg-white text-ink"}`}><input type="radio" name="teamId" value={team.id} required checked={selectedTeamId === String(team.id)} onChange={(event) => setSelectedTeamId(event.target.value)} className="sr-only" />{team.name}</label>)}</div></fieldset><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !selectedTeamId} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">派单</button>{masterData.teams.every((team) => !team.isActive) ? <Link href={`/dictionaries?returnTo=${encodeURIComponent(`/orders/business/${businessOrderId}`)}#teams`} className="min-h-10 rounded-lg border border-primary px-4 py-2.5 text-xs font-bold text-primary">先新增维修班组</Link> : null}</div></form> : null}
          {rounds.current.status === "waiting_assignment" && rounds.current.source === "after_sales" && rounds.current.assignedTeamId === null ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2"><p className="text-xs text-rose-800">如果本轮是误触创建，并且尚未产生任何实际记录，可以撤销并回到上一轮已交单状态。</p><button disabled={busy} type="button" onClick={cancelAccidentalAfterSalesRound} className="min-h-9 rounded-lg border border-rose-400 bg-white px-3 text-xs font-bold text-rose-700 disabled:opacity-40">撤销本轮</button></div> : null}
          {rounds.current.status === "assigned" ? <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-xs font-bold text-amber-950">下一步：登记维修工接单</h3>
            <p className="mt-1 text-xs text-amber-900">维修工手机端接单后会自动进入维修中；收到纸质维修工联时，也可以在这里选择实际维修工代录接单。</p>
            {assignedTeamStaff.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{assignedTeamStaff.map((staff) => <button key={staff.id} disabled={busy} type="button" onClick={() => void submitRoundAction({ action: "record_paper_acceptance", repairRoundVersion: rounds.current.version, actualStaffMemberId: staff.id }, `已登记 ${staff.fullName} 接单`)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{staff.fullName} · 接单</button>)}</div> : <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-rose-700">当前班组没有可接单的在职维修工。</span><Link href={`/employees?create=1&team=${rounds.current.assignedTeamId}&returnTo=${encodeURIComponent(`/orders/business/${businessOrderId}`)}`} className="min-h-9 rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary">新增维修工后返回</Link></div>}
          </section> : null}
          {rounds.current.status === "in_repair" ? <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {rounds.current.intakeMileageKm === null ? <form className="rounded-xl border border-line p-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitRoundAction({ action: "record_mileage", repairRoundVersion: rounds.current.version, odometerKm: Number(form.get("odometerKm")) }, "接车里程已记录"); }}><h3 className="text-xs font-bold">接车里程</h3><div className="mt-2 flex gap-2"><input name="odometerKm" required type="number" min="0" step="1" placeholder="直接输入" className="min-h-10 min-w-0 flex-1 rounded-lg border border-line px-3" /><span className="py-2.5 text-xs">km</span><button disabled={busy} className="rounded-lg bg-primary px-4 text-xs font-bold text-white">保存</button></div></form> : <div className="rounded-xl border border-line p-3 text-xs"><span className="text-ink-soft">接车里程</span><strong className="mt-1 block text-base">{rounds.current.intakeMileageKm.toLocaleString()} km</strong></div>}
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line p-3">
              <button type="button" onClick={() => setInspectionCreateOpen(true)} className="inline-flex min-h-10 items-center rounded-lg border border-primary px-4 text-xs font-bold text-primary">新建检查结果</button>
              <button type="button" onClick={() => setAdvanceRoundOpen((open) => !open)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">推进下一步</button>
            </div>
            {advanceRoundOpen ? <form className="rounded-xl border border-primary/30 bg-primary-50 p-3 lg:col-span-2" onSubmit={(event) => { event.preventDefault(); setAdvanceRoundOpen(false); void submitRoundAction({ action: "submit_return", repairRoundVersion: rounds.current.version }, "已推进到回单待审核"); }}>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xs font-bold">推进到回单待审核</h3><p className="mt-1 text-[11px] text-ink-soft">表示维修工已完成本轮工作，等待前台现场核验；不代表正式交单或 Business Order 完结。</p></div><div className="flex gap-2"><button type="button" onClick={() => setAdvanceRoundOpen(false)} className="min-h-9 rounded-md border border-line bg-white px-3 text-xs font-bold">取消</button><button disabled={busy} className="min-h-9 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">确认推进</button></div></div>
            </form> : null}
          </div> : null}
          {rounds.current.status === "return_pending_review" ? <div className="mt-3 flex flex-wrap items-end gap-2">{rounds.current.latestWorkReturnId && !rounds.current.approvedWorkReturnId ? <><button disabled={busy} type="button" onClick={() => void submitRoundAction({ action: "approve_return", repairRoundVersion: rounds.current.version, workReturnId: rounds.current.latestWorkReturnId }, "维修回单已审核通过")} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">审核通过</button><button disabled={busy} type="button" onClick={() => { const reason = window.prompt("请输入退回原因"); if (reason) void submitRoundAction({ action: "reject_return", repairRoundVersion: rounds.current.version, workReturnId: rounds.current.latestWorkReturnId, reason }, "维修回单已退回"); }} className="min-h-10 rounded-lg border border-rose-300 px-4 text-xs font-bold text-rose-700">退回维修班组</button></> : null}{rounds.current.approvedWorkReturnId ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitRoundAction({ action: "formal_handoff", repairRoundVersion: rounds.current.version, performanceValue: String(form.get("performanceValue")) }, "本轮已正式交单，绩效事实已落地"); }}><label className="text-xs">本轮绩效值（JMD）<input name="performanceValue" required defaultValue={String(charges.items.filter((item) => item.kind === "labor").reduce((sum, item) => sum + item.subtotalMinor, 0) / 100)} className="mt-1 min-h-10 rounded-lg border border-line px-3" /></label><button disabled={busy} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white">正式交单</button></form> : null}</div> : null}
          {rounds.current.status === "formally_handed_off" ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-sm font-bold text-emerald-900">本轮维修已经正式交单</h3><p className="mt-1 text-xs text-emerald-800">维修工作已经完成；收款、取车和未结余额继续在本 Business Order 内处理。</p></div>
              {data.capabilities.canWrite ? <div className="flex flex-wrap gap-2">
                {currentActiveHandoff ? <button
                  type="button"
                  disabled={busy}
                  aria-expanded={cancelHandoffDraft?.handoffId === currentActiveHandoff.id}
                  aria-controls="formal-handoff-cancellation-form"
                  onClick={() => {
                    setAfterSalesOpen(false);
                    setCancelHandoffDraft({ handoffId: currentActiveHandoff.id, reason: "" });
                    setError(null);
                    setNotice(null);
                  }}
                  className="min-h-9 rounded-lg border border-rose-400 bg-white px-3 text-xs font-bold text-rose-700 disabled:opacity-40"
                >取消本次正式交单</button> : null}
                <button
                  type="button"
                  disabled={busy}
                  aria-expanded={afterSalesOpen}
                  aria-controls="formal-after-sales-form"
                  onClick={() => {
                    setCancelHandoffDraft(null);
                    setAfterSalesOpen((open) => !open);
                  }}
                  className="min-h-9 rounded-lg border border-amber-500 bg-white px-3 text-xs font-bold text-amber-700 disabled:opacity-40"
                >售后回厂</button>
              </div> : null}
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><span>维修班组<strong className="mt-1 block text-emerald-950">{currentTeamName ?? "未记录"}</strong></span><span>本轮绩效<strong className="mt-1 block text-emerald-950">{currentActiveHandoff ? formatFormalMoney(currentActiveHandoff.performanceMinor) : "未记录"}</strong></span><span>交单时间<strong className="mt-1 block text-emerald-950">{currentActiveHandoff ? formatDateTime(currentActiveHandoff.handedOffAt) : "未记录"}</strong></span></div>
            {data.capabilities.canWrite
              && currentActiveHandoff
              && cancelHandoffDraft?.handoffId === currentActiveHandoff.id
              ? <form
                id="formal-handoff-cancellation-form"
                aria-label="同月取消正式交单"
                className="mt-3 border-t border-rose-200 pt-3"
                onSubmit={submitHandoffCancellation}
              >
                <label htmlFor="formal-handoff-cancellation-reason" className="block text-xs font-bold text-rose-900">取消原因</label>
                <textarea
                  id="formal-handoff-cancellation-reason"
                  name="reason"
                  required
                  autoFocus
                  value={cancelHandoffDraft.reason}
                  onChange={(event) => setCancelHandoffDraft((draft) => draft ? {
                    ...draft,
                    reason: event.target.value,
                  } : null)}
                  className="mt-1 min-h-20 w-full rounded-lg border border-rose-200 bg-white p-3 text-sm"
                />
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCancelHandoffDraft(null)}
                    className="min-h-9 rounded-lg border border-line bg-white px-3 text-xs font-bold disabled:opacity-40"
                  >取消</button>
                  <button
                    type="submit"
                    disabled={busy || !cancelHandoffDraft.reason.trim()}
                    className="min-h-9 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white disabled:opacity-40"
                  >{cancelHandoffInFlight.current ? "正在取消…" : "确认取消正式交单"}</button>
                </div>
              </form>
              : null}
            {data.capabilities.canWrite && afterSalesOpen ? <form id="formal-after-sales-form" className="mt-3 flex flex-wrap items-end gap-2 border-t border-emerald-200 pt-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setAfterSalesOpen(false); void submitRoundAction({ action: "start_after_sales", businessOrderVersion: order.version, issue: String(form.get("issue")) }, "已在本 Business Order 开始下一轮售后维修"); }}><label className="min-w-[320px] flex-1 text-xs">本次售后回厂问题<input name="issue" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3" /></label><button type="button" onClick={() => setAfterSalesOpen(false)} className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-bold">取消</button><button disabled={busy} className="min-h-10 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white">确认开始下一轮维修</button></form> : null}
          </div> : null}
          <div className="mt-3 border-t border-line pt-3"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold">相关检查结果</h3><span className="text-[11px] text-ink-soft">{relatedInspectionReports.length} 份</span></div>{relatedInspectionReports.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{relatedInspectionReports.map((item) => <Link key={item.report.id} href={`/orders/inspections/${item.report.id}`} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-primary">{item.report.reportNo}</Link>)}</div> : <p className="mt-2 text-xs text-ink-soft">本 Business Order 尚无相关检查结果。</p>}</div>
        </section> : null}

        {historyOpen && rounds && masterData ? <RepairHistoryDialog rounds={rounds} masterData={masterData} onClose={() => setHistoryOpen(false)} /> : null}

        <section id="business-order-history-workspace" role="tabpanel" hidden={activeWorkspace !== "history"} className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/50 xl:col-span-2">
          {rounds && masterData ? <RepairHistoryDialog rounds={rounds} masterData={masterData} /> : <p className="rounded-xl bg-surface px-3 py-4 text-xs text-ink-soft">正在读取完整历史与修改记录…</p>}
        </section>

        <section id="business-order-documents-workspace" role="tabpanel" hidden={activeWorkspace !== "documents"} className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/50 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-sm font-bold">正式打印文件</h2><p className="mt-1 text-xs text-ink-soft">每次生成都会冻结当时的收费、备注、收付款或维修轮次；旧文件打开即为补打。</p></div>
            {data.capabilities.canWrite ? <div className="flex flex-wrap gap-2"><button disabled={busy} type="button" onClick={() => generatePrintDocument("customer_copy")} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-50">生成客户联</button><button disabled={busy} type="button" onClick={() => generatePrintDocument("office_archive")} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary disabled:opacity-50">生成办公室签字留底联</button><button disabled={busy} type="button" onClick={() => generatePrintDocument("mechanic_work")} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary disabled:opacity-50">生成维修工联</button></div> : null}
          </div>
          {data.documents.length === 0 ? <p className="mt-3 rounded-xl bg-surface px-3 py-3 text-xs text-ink-soft">尚未生成正式打印文件。</p> : <div className="mt-3 overflow-hidden rounded-xl border border-line">{data.documents.map((document) => <article key={document.id} className="grid items-center gap-2 border-b border-line px-3 py-2.5 text-xs last:border-0 sm:grid-cols-[1fr_.8fr_auto]"><span><strong className="block">{document.documentNo}</strong><small className="text-ink-soft">{formalDocumentKindLabel(document.kind)} · 收费版本 V{document.chargeVersionNo}{document.repairRoundNo ? ` · 第 ${document.repairRoundNo} 轮维修` : ""}</small></span><span className="text-ink-soft">{formatDateTime(document.generatedAt)}</span><Link href={`/orders/business/${businessOrderId}/documents/${document.id}/print`} className="font-bold text-primary">打开 / 补打</Link></article>)}</div>}
        </section>

        <section id="business-order-operations-workspace" role="tabpanel" hidden={activeWorkspace !== "operations"} className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/50 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-bold">收费项目</h2><p className="mt-1 text-xs text-ink-soft">版本 V{charges.versionNo} · 单价与小计均为含税金额</p></div>{data.capabilities.canWrite ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setNaturalLanguageOpen((open) => !open)} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary">自然语言录入</button><button type="button" onClick={beginChargeEditing} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white">编辑收费项目</button></div> : <span className="text-xs text-ink-soft">{charges.reason}</span>}</div>

          {naturalLanguageOpen ? <div className="mt-3 rounded-xl border border-primary/30 bg-primary-50 p-3"><label className="text-xs font-bold">自然语言输入<textarea value={naturalLanguageText} onChange={(event) => setNaturalLanguageText(event.target.value)} placeholder={"例如：更换前刹车片一套 12000，工时 5000\n客户反馈：刹车异响\n施工说明：先检查再更换\n提前告知：追加项目须再次确认"} className="mt-2 min-h-28 w-full rounded-lg border border-line bg-white p-3 text-sm" /></label><div className="mt-2 flex gap-2"><button type="button" disabled={!naturalLanguageText.trim() || naturalLanguageBusy} onClick={() => void stageNaturalLanguage()} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-40">{naturalLanguageBusy ? "AI 整理中…" : "AI 整理到收费草稿"}</button><button type="button" onClick={() => { setNaturalLanguageOpen(false); setNaturalLanguageText(""); }} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">取消</button></div><p className="mt-2 text-[11px] text-ink-soft">后台 AI 同时整理收费项目、客户反馈、施工说明、责任说明和提前告知；由前台核对后保存。AI 不可用时会明确提示采用本地规则。</p></div> : null}

          {chargeEditing ? <form className="mt-3" onSubmit={submitCharges} onInvalid={(event) => { event.preventDefault(); setChargeActionError("有必填内容未填写，请检查当前表单"); (event.target as HTMLElement).focus(); }}>
            <div className="space-y-3">{(["labor", "part", "other"] as const).map((kind) => <section key={kind}><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-primary">{CATEGORY_LABELS[kind]}</h3><button type="button" onClick={() => addChargeDraftItem(kind)} className="rounded-md border border-primary px-2 py-1 text-[11px] font-bold text-primary">+ 新增</button></div><div className="mt-1 space-y-2">{chargeDraft.filter((item) => item.kind === kind).map((item) => <div key={item.key} className="grid min-w-0 gap-2 rounded-xl border border-line p-2 text-xs lg:grid-cols-[1.35fr_1.35fr_.7fr_.55fr_.75fr_.7fr_auto_auto] lg:items-end"><label>项目名称<input aria-label="项目名称" required value={item.nameZh} onChange={(event) => updateChargeDraft(item.key, "nameZh", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /><input aria-label="项目英文名称" value={item.nameEn} onChange={(event) => updateChargeDraft(item.key, "nameEn", event.target.value)} placeholder="English" className="mt-1 min-h-8 w-full rounded-md border border-line px-2 text-[11px]" /></label><label>描述<input aria-label="描述" value={item.descriptionZh} onChange={(event) => updateChargeDraft(item.key, "descriptionZh", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /><input aria-label="英文描述" value={item.descriptionEn} onChange={(event) => updateChargeDraft(item.key, "descriptionEn", event.target.value)} placeholder="English" className="mt-1 min-h-8 w-full rounded-md border border-line px-2 text-[11px]" /></label><label>单位<select aria-label="单位" value={item.unitItemId} onChange={(event) => updateChargeDraft(item.key, "unitItemId", Number(event.target.value))} className="mt-1 min-h-9 w-full rounded-md border border-line px-2">{data.chargeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.labelZh}</option>)}</select></label><label>数量<input aria-label="数量" required inputMode="decimal" value={item.quantity} onChange={(event) => updateChargeDraft(item.key, "quantity", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label><label>含税单价<input aria-label="含税单价" required inputMode="decimal" value={item.unitPrice} onChange={(event) => updateChargeDraft(item.key, "unitPrice", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label><label>本项折扣<input aria-label="本项折扣" required inputMode="decimal" value={item.itemDiscount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateChargeDraft(item.key, "itemDiscount", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label><button type="button" aria-label={`翻译收费项目 ${item.nameZh || "未命名"}`} disabled={translatingKey !== null} onClick={() => void translateChargeDraftItem(item.key)} className="min-h-9 rounded-md border border-primary px-2 font-bold text-primary disabled:opacity-40">{translatingKey === `item-${item.key}` ? "…" : "译"}</button><button type="button" onClick={() => setChargeDraft((current) => current.filter((candidate) => candidate.key !== item.key))} className="min-h-9 rounded-md border border-rose-300 px-2 font-bold text-rose-600">删</button></div>)}</div></section>)}</div>
            <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3"><div className="flex items-center justify-between gap-2"><div><h3 className="text-xs font-bold text-amber-950">备注、责任义务与提前告知</h3><p className="mt-1 text-[11px] text-amber-800">与本次收费版本一起保存，打印时采用当时版本。</p></div><button type="button" onClick={addChargeNoteDraft} className="rounded-md border border-amber-500 px-2 py-1 text-[11px] font-bold text-amber-800">+ 新增备注</button></div><div className="mt-2 space-y-2">{chargeNoteDraft.map((note) => <div key={note.key} className="grid gap-2 rounded-lg border border-amber-200 bg-white p-2 text-xs lg:grid-cols-[.85fr_1.5fr_1.5fr_auto_auto] lg:items-end"><label>备注类型<select aria-label="备注类型" value={note.kind} onChange={(event) => updateChargeNoteDraft(note.key, "kind", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2">{Object.entries(NOTE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><label>中文内容<textarea aria-label="备注中文内容" required value={note.contentZh} onChange={(event) => updateChargeNoteDraft(note.key, "contentZh", event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-line p-2" /></label><label>英文内容<textarea aria-label="备注英文内容" value={note.contentEn} onChange={(event) => updateChargeNoteDraft(note.key, "contentEn", event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-line p-2" /></label><button type="button" aria-label={`翻译备注 ${NOTE_KIND_LABELS[note.kind]}`} disabled={translatingKey !== null} onClick={() => void translateChargeNoteDraft(note.key)} className="min-h-9 rounded-md border border-amber-600 px-2 font-bold text-amber-800 disabled:opacity-40">{translatingKey === `note-${note.key}` ? "…" : "译"}</button><button type="button" onClick={() => setChargeNoteDraft((current) => current.filter((candidate) => candidate.key !== note.key))} className="min-h-9 rounded-md border border-rose-300 px-2 font-bold text-rose-600">删</button></div>)}</div></section>
            <div className="mt-3 rounded-xl bg-surface p-3 text-xs"><label>修改原因<input name="reason" required defaultValue="前台核对后更新收费" className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label></div>
                {chargeActionError ? <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{chargeActionError}</p> : null}
                {chargeActionNotice ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{chargeActionNotice}</p> : null}
                <div className="mt-3 flex gap-2"><button type="submit" disabled={busy || chargeDraft.length === 0} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{busy ? "正在保存…" : "保存收费项目"}</button><button type="button" onClick={() => { setChargeEditing(false); setChargeDraft([]); setChargeNoteDraft([]); setChargeActionError(null); setChargeActionNotice(null); }} className="min-h-10 rounded-lg border border-line px-4 text-xs font-bold">取消</button></div>
          </form> : <><ChargeSection charges={charges} kind="labor" unitLabels={unitLabels} /><ChargeSection charges={charges} kind="part" unitLabels={unitLabels} /><ChargeSection charges={charges} kind="other" unitLabels={unitLabels} /><div className="mt-4 grid gap-2 border-t border-line pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><span>收费原价<strong className="mt-1 block">{formatFormalMoney(charges.totals.grossMinor)}</strong></span><span>工时折扣合计<strong className="mt-1 block text-rose-600">−{formatFormalMoney(groupedDiscounts.laborDiscountMinor)}</strong></span><span>配件折扣合计<strong className="mt-1 block text-rose-600">−{formatFormalMoney(groupedDiscounts.partDiscountMinor)}</strong></span><span>折后应收（含 15% GCT）<strong className="mt-1 block text-base">{formatFormalMoney(charges.totals.totalDueMinor)}</strong><small>其中 GCT {formatFormalMoney(charges.totals.includedGctMinor)}</small></span></div>{charges.notes.length > 0 ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-950"><strong>备注 / 责任义务与提前告知</strong>{charges.notes.map((note) => <p key={note.id} className="mt-1">{note.contentZh ?? ""}{note.contentEn ? ` / ${note.contentEn}` : ""}</p>)}</div> : null}</>}
        </section>

        <section id="business-order-finance-workspace" hidden={activeWorkspace !== "operations"} className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/50 xl:col-start-2 xl:row-start-2">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">逐笔收付款与 Receipt</h2><p className="mt-1 text-xs text-ink-soft">每次收款、退款都是独立且不可修改的事实；余额由历史自动计算。</p></div><div className="flex gap-2">{data.capabilities.canRecordPayment ? <button type="button" onClick={() => { setPaymentFormOpen((open) => !open); setRefundFormOpen(false); }} className="min-h-9 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white">登记收款</button> : null}{data.capabilities.canRefund ? <button type="button" onClick={() => { setRefundFormOpen((open) => !open); setPaymentFormOpen(false); }} className="min-h-9 rounded-lg border border-rose-400 px-3 text-xs font-bold text-rose-700">生成退款</button> : null}</div></div>
          {isFinanciallySettled ? <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-black text-emerald-900">财务已结清 · 当前未结余额 {formatFormalMoney(0)}</div> : null}
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4"><span className="rounded-xl bg-surface p-3 text-xs">折后应收<strong className="mt-1 block text-base">{formatFormalMoney(ledger.currentDueMinor)}</strong></span><span className="rounded-xl bg-emerald-50 p-3 text-xs">累计收款<strong className="mt-1 block text-base text-emerald-700">{formatFormalMoney(ledger.totalPaidMinor)}</strong></span><span className="rounded-xl bg-rose-50 p-3 text-xs">累计退款<strong className="mt-1 block text-base text-rose-700">{formatFormalMoney(ledger.totalRefundedMinor)}</strong></span><span className={`rounded-xl p-3 text-xs ${isFinanciallySettled ? "border border-emerald-300 bg-emerald-100 text-emerald-900" : "bg-amber-50"}`}>{isFinanciallySettled ? "未结余额 / 已结清" : "未结余额"}<strong className={`mt-1 block text-base ${isFinanciallySettled ? "text-emerald-800" : "text-amber-800"}`}>{formatFormalMoney(ledger.balanceMinor)}</strong></span></div>

          {paymentFormOpen && data.capabilities.canRecordPayment ? <form onSubmit={submitPayment} className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3"><h3 className="text-sm font-bold">登记一笔收款</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">金额（JMD）<input name="amount" inputMode="decimal" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3" /></label><label className="text-xs">收款方式<select name="paymentMethodItemId" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3"><option value="">选择方式</option>{data.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.labelZh}{method.labelEn ? ` / ${method.labelEn}` : ""}</option>)}</select></label></div><label className="mt-2 block text-xs">备注<input name="note" className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3" /></label><div className="mt-3 flex gap-2"><button disabled={busy} type="submit" className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">收款并生成 Receipt</button><button type="button" onClick={() => setPaymentFormOpen(false)} className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-bold">取消</button></div></form> : null}
          {refundFormOpen && data.capabilities.canRefund ? <form onSubmit={submitRefund} className="mt-4 rounded-xl border border-rose-200 bg-rose-50/30 p-3"><h3 className="text-sm font-bold">登记一笔退款</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">金额（JMD）<input name="amount" inputMode="decimal" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3" /></label><label className="text-xs">退款方式<select name="paymentMethodItemId" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3"><option value="">选择方式</option>{data.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.labelZh}{method.labelEn ? ` / ${method.labelEn}` : ""}</option>)}</select></label></div><label className="mt-2 block text-xs">退款原因<textarea name="reason" required className="mt-1 min-h-16 w-full rounded-lg border border-line bg-white p-3" /></label><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">原客户单据<select name="originalDocumentStatus" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3"><option value="returned">原单已交回</option><option value="unavailable">原单无法交回</option></select></label><label className="text-xs">无法交回说明<input name="originalDocumentNote" className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3" /></label></div><p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">先登记退款并生成退款签收单。打印后由客户手写签字，工作人员保存纸质原件；签字件可在该笔退款下稍后上传。非现金退款完成转账后另传转账凭证。</p><div className="mt-3 flex gap-2"><button disabled={busy} type="submit" className="min-h-10 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white disabled:opacity-50">登记退款并生成签收单</button><button type="button" onClick={() => setRefundFormOpen(false)} className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-bold">取消</button></div></form> : null}
          {!data.capabilities.canRecordPayment && !data.capabilities.canRefund ? <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-ink-soft">当前账号只读，可查看全部收付款事实。</p> : null}

          <div className="mt-4"><h3 className="text-xs font-bold">收付款历史</h3>{ledger.transactions.length === 0 ? <p className="mt-2 text-xs text-ink-soft">尚无收付款记录。</p> : <div className="mt-2 overflow-hidden rounded-xl border border-line">{ledger.transactions.map((transaction) => {
            const refund = transaction.type === "refund" ? refundById.get(transaction.id) : null;
            return <article key={`${transaction.type}-${transaction.id}`} className="grid gap-2 border-b border-line p-3 text-xs last:border-0 lg:grid-cols-[1.2fr_.7fr_.8fr_1.6fr]"><span><strong className="block">{transaction.type === "payment" ? "收款" : "退款"} · {transaction.referenceNo}</strong><small className="text-ink-soft">{formatDateTime(transaction.occurredAt)} · {transaction.methodLabelZh}</small></span><strong className={transaction.type === "refund" ? "text-rose-600" : "text-emerald-600"}>{transaction.type === "refund" ? "−" : "+"}{formatFormalMoney(transaction.amountMinor)}</strong><span>{transaction.note ?? refund?.reason ?? "无备注"}</span><span>{refund ? <span className="flex flex-col items-start gap-2"><Link href={`/orders/business/${businessOrderId}/refund/${refund.id}/print`} className="font-bold text-primary">打印退款签收单</Link>{formalRefundNeedsProof(refund) ? <form onSubmit={(event) => submitProof(event, refund.id)} className="flex w-full items-center gap-2"><input aria-label={`退款 ${refund.refundNo} 实际凭证`} name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="min-w-0 flex-1 text-[10px]" /><button disabled={busy} className="shrink-0 rounded-md border border-primary px-2 py-1 font-semibold text-primary">补传转账凭证</button></form> : refund.paymentMethodCode !== "cash" ? <span className="font-semibold text-emerald-700">转账凭证已归档</span> : null}{formalRefundHasSignedAcknowledgement(refund) ? <span className="font-semibold text-emerald-700">已上传签字后的退款签收单</span> : <form onSubmit={(event) => submitSignedAcknowledgement(event, refund.id)} className="flex w-full items-center gap-2"><input aria-label={`退款 ${refund.refundNo} 上传签字后的退款签收单`} name="signedAcknowledgement" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="min-w-0 flex-1 text-[10px]" /><button disabled={busy} className="shrink-0 rounded-md border border-primary px-2 py-1 font-semibold text-primary">上传签收单</button></form>}</span> : transaction.receiptId ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><strong className="w-full">Receipt：{transaction.referenceNo}</strong><Link href={`/orders/business/${businessOrderId}/receipt/${transaction.receiptId}/print?copy=zh`} className="font-semibold text-primary">中文 Receipt</Link><Link href={`/orders/business/${businessOrderId}/receipt/${transaction.receiptId}/print?copy=en`} className="font-semibold text-primary">English Receipt</Link></span> : null}</span></article>;
          })}</div>}</div>
        </section>
        <section id="business-order-messages-workspace" role="tabpanel" hidden={activeWorkspace !== "messages"} className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/50 xl:col-span-2">
          {activeWorkspace === "messages" ? <FormalBusinessOrderMessages businessOrderId={businessOrderId} currentAccountId={data.currentAccountId} canCollaborate={data.capabilities.canCollaborate} highlightedMessageId={Number.isSafeInteger(highlightedMessageId) && highlightedMessageId > 0 ? highlightedMessageId : null} onMentionsRead={handleMentionsRead} /> : null}
        </section>
        </div>
      </div>
      {inspectionCreateOpen ? <FormalInspectionCreateDialog vehicleId={order.vehicleId} sourceBusinessOrderId={businessOrderId} onClose={() => setInspectionCreateOpen(false)} onCreated={() => { setInspectionCreateOpen(false); refresh(); }} /> : null}
    </div>
  );
}
