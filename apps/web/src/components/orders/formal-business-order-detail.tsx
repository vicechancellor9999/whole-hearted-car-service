"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";
import { FormalInspectionCreateDialog } from "@/components/orders/formal-inspection-create-dialog";
import { FormalBusinessOrderMessages } from "@/components/orders/formal-business-order-messages";
import { FormalBusinessOrderDocumentsWorkspace } from "@/components/orders/formal-business-order-documents-workspace";
import {
  FormalBusinessOrderHistoryTimeline,
  type FormalBusinessOrderHistoryItem,
} from "@/components/orders/formal-business-order-history-timeline";
import {
  FormalBusinessOrderTabs,
  parseBusinessOrderWorkspace,
} from "@/components/orders/formal-business-order-tabs";
import { RecordDeleteButton } from "@/components/shared/record-delete-dialog";
import { ActionDialog } from "@/components/shared/action-dialog";
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
import {
  businessOrderAuditChanges,
  businessOrderAuditSummary,
} from "@/lib/orders/business-order-audit-presentation";
import { parseChargeEntryInput } from "@/lib/orders/nl-parse";
import { formatDateTime } from "@/lib/utils";
import { useI18n, type UiLanguage } from "@/lib/i18n/language";

const PROGRESS = [
  ["waiting_assignment", "待派单", "Awaiting assignment"],
  ["assigned", "已派单", "Assigned"],
  ["in_repair", "维修中", "In repair"],
  ["return_pending_review", "回单待审核", "Work return review"],
  ["formally_handed_off", "已交单", "Handed off"],
] as const;

const CATEGORY_LABELS = { labor: "工时", part: "配件", other: "其他费用" } as const;
const CATEGORY_LABELS_EN = { labor: "Labor", part: "Parts", other: "Other charges" } as const;
const CATEGORY_ADD_LABELS = { labor: "新增工时", part: "新增配件", other: "新增其他费用" } as const;
const CATEGORY_ADD_LABELS_EN = { labor: "Add labor", part: "Add part", other: "Add other charge" } as const;

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
const NOTE_KIND_LABELS_EN: Record<ChargeDraftNote["kind"], string> = {
  customer_concern: "Customer concern",
  work_instruction: "Work instruction",
  liability_notice: "Liability notice / advance notice",
  internal: "Internal note",
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
const ROUND_EVENT_LABELS_EN: Record<string, string> = {
  assigned: "Assigned to repair team",
  assignment_withdrawn: "Assignment withdrawn",
  accepted: "Mechanic accepted",
  mileage_recorded: "Recorded intake mileage",
  intake_mileage_recorded: "Recorded intake mileage",
  intake_photos_recorded: "Archived intake photos",
  intake_photo_linked: "Archived intake photo",
  return_submitted: "Mechanic submitted work return for front-desk review",
  work_return_submitted: "Mechanic submitted work return for front-desk review",
  return_approved: "Front desk approved the work return and formally handed off the round",
  work_return_approved: "Front desk approved the work return and formally handed off the round",
  return_rejected: "Front desk returned the work return to the repair team",
  work_return_rejected: "Front desk returned the work return to the repair team",
  formally_handed_off: "Formally handed off",
};

function roundEventLabel(eventType: string, language: UiLanguage): string {
  return language === "en"
    ? ROUND_EVENT_LABELS_EN[eventType] ?? "Recorded a repair action"
    : ROUND_EVENT_LABELS[eventType] ?? "记录了一次维修操作";
}

function RepairHistoryDialog({
  rounds,
  masterData,
  language,
  onClose,
}: {
  rounds: FormalRepairRoundWorkspace;
  masterData: FormalMasterData;
  language: UiLanguage;
  onClose?: () => void;
}) {
  const english = language === "en";
  const teamName = (teamId: number | null) => {
    if (!teamId) return null;
    return english ? `Team ${teamId} · Translation required` : masterData.teams.find((team) => team.id === teamId)?.name ?? `维修班组 #${teamId}`;
  };

  const content = (
    <>
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <div><h2 className="text-base font-bold">{english ? "Complete Business Order history and changes" : "Business Order 全部历史与修改记录"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Actions, operators and results in chronological context." : "按时间显示操作人、业务动作和操作结果。"}</p></div>
          {onClose ? <button type="button" onClick={onClose} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">{english ? "Close and return" : "关闭并返回"}</button> : null}
        </div>
        <div className="mt-3 space-y-3">
          {[...rounds.history].sort((left, right) => right.roundNo - left.roundNo).map((round) => {
            const handoff = [...round.formalHandoffs].reverse().find((candidate) => !candidate.cancelledAt) ?? null;
            const historicalTeamId = round.assignedTeamId ?? [...round.events].reverse().find((event) => event.teamId)?.teamId ?? null;
            return <article key={round.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{english ? `Repair round ${round.roundNo}` : `第 ${round.roundNo} 轮维修`}</h3><p className="mt-1 text-xs text-ink-soft">{round.source === "after_sales" ? `${english ? "After-sales return" : "售后回厂"}: ${round.afterSalesIssue}` : (english ? "Initial repair" : "首次维修")}</p></div><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary">{formalBusinessOrderStatusLabel(round.status, language)}</span></div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><span>{english ? "Repair team" : "维修班组"}<strong className="mt-1 block">{teamName(historicalTeamId) ?? (english ? "Not assigned" : "尚未派组")}</strong></span><span>{english ? "Round performance" : "本轮绩效"}<strong className="mt-1 block">{handoff ? formatFormalMoney(handoff.performanceMinor) : (english ? "Not handed off" : "尚未交单")}</strong></span><span>{english ? "Handoff time" : "交单时间"}<strong className="mt-1 block">{handoff ? formatDateTime(handoff.handedOffAt) : (english ? "Not handed off" : "尚未交单")}</strong></span></div>
              {round.events.length > 0 ? <ol className="mt-3 border-t border-line pt-2">{round.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 py-1 text-xs"><span>{roundEventLabel(event.eventType, language)}{event.teamId ? ` · ${teamName(event.teamId)}` : ""}{event.note ? ` · ${event.note}` : ""}</span><time className="text-ink-soft">{formatDateTime(event.occurredAt)}</time></li>)}</ol> : <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">{english ? "No actions recorded for this round." : "本轮尚无操作记录。"}</p>}
            </article>;
          })}
        </div>
        <section className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h3 className="text-sm font-bold">{english ? "Complete business activity" : "完整业务流水"}</h3><p className="mt-1 text-xs text-ink-soft">{english ? "Shows who did what and the resulting business state, newest first." : "按时间倒序展示谁做了什么，以及操作后的业务结果。"}</p></div>
            <span className="text-xs font-semibold text-ink-soft">{english ? `${rounds.auditTrail.length} entries` : `共 ${rounds.auditTrail.length} 条`}</span>
          </div>
          {rounds.auditTrail.length > 0 ? <ol className="mt-3 space-y-2">
            {rounds.auditTrail.map((event) => {
              const changes = businessOrderAuditChanges(event.before, event.after, masterData, language);
              const actor = event.actorDisplayName?.trim() || event.actorUsername?.trim() || (event.actorAccountId ? `${english ? "Account" : "账号"} #${event.actorAccountId}` : (english ? "System" : "系统"));
              const summary = businessOrderAuditSummary(event.eventType, event.after, masterData, language);
              return <li key={event.id} className="rounded-xl border border-line p-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-[145px_150px_minmax(0,1fr)]">
                  <span><small className="block text-ink-soft">{english ? "Time" : "时间"}</small><time className="font-semibold">{formatDateTime(event.occurredAt)}</time></span>
                  <span><small className="block text-ink-soft">{english ? "Operator" : "操作人"}</small><strong className="block">{actor}</strong></span>
                  <span><small className="block text-ink-soft">{english ? "Action and result" : "做了什么，结果如何"}</small><strong className="block">{summary}</strong>{event.reason ? <small className="mt-1 block text-ink-soft">{english ? "Reason" : "原因"}: {event.reason}</small> : null}</span>
                </div>
                <div className="mt-3 rounded-lg bg-surface p-2">
                  <strong className="block text-[11px]">{english ? "Changes" : "变化结果"}</strong>
                  {changes.length > 0 ? <div className="mt-1 space-y-1">{changes.map((change) => <div key={change.key} className="grid gap-1 border-t border-line/60 pt-1 first:border-0 sm:grid-cols-[130px_1fr_1fr]"><span className="font-semibold">{change.label}</span><span><small className="mr-1 text-ink-soft">{english ? "Before" : "原来"}</small>{change.hasBefore ? change.before : (english ? "Not recorded" : "尚未记录")}</span><span><small className="mr-1 text-ink-soft">{english ? "Now" : "现在"}</small>{change.hasAfter ? change.after : (english ? "Cleared" : "已清除")}</span></div>)}</div> : <p className="mt-1 text-ink-soft">{english ? "This action did not change any business data that needs a separate display." : "这次操作没有改变需要单独展示的业务数据。"}</p>}
                </div>
              </li>;
            })}
          </ol> : <p className="mt-3 rounded-xl bg-surface px-3 py-4 text-xs text-ink-soft">{english ? "No audit entries to display." : "尚无可展示的审计记录。"}</p>}
        </section>
    </>
  );

  if (!onClose) return <div>{content}</div>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--wh-overlay)] p-4" role="dialog" aria-modal="true" aria-label={english ? "Complete Business Order repair history" : "Business Order 全部维修历史"} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-line-strong bg-card p-4 shadow-2xl">{content}</section>
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
  language,
}: {
  charges: FormalChargeSnapshot;
  kind: keyof typeof CATEGORY_LABELS;
  unitLabels: Map<number, string>;
  language: UiLanguage;
}) {
  const english = language === "en";
  const items = charges.items.filter((item) => item.kind === kind);
  if (items.length === 0) return null;
  return (
    <section className="mt-3">
      <h3 className="text-xs font-bold text-primary">{english ? CATEGORY_LABELS_EN[kind] : CATEGORY_LABELS[kind]}</h3>
      <div className="mt-1 overflow-hidden rounded-xl border border-line">
        <div className="hidden grid-cols-[1.55fr_1.4fr_.65fr_.55fr_.8fr_.75fr_.8fr] gap-2 bg-surface px-3 py-2 text-[10px] font-semibold text-ink-soft lg:grid">
          <span>{english ? "Item" : "项目名称"}</span><span>{english ? "Description" : "描述"}</span><span>{english ? "Unit" : "单位"}</span><span>{english ? "Qty" : "数量"}</span><span className="text-right">{english ? "Tax-inclusive price" : "含税单价"}</span><span className="text-right">{english ? "Discount" : "本项折扣"}</span><span className="text-right">{english ? "Subtotal" : "小计"}</span>
        </div>
        {items.map((item) => (
          <div key={item.id} className="grid min-w-0 gap-2 border-t border-line/70 px-3 py-2.5 text-xs first:border-0 lg:grid-cols-[1.55fr_1.4fr_.65fr_.55fr_.8fr_.75fr_.8fr] lg:items-center">
            <span className="min-w-0"><strong className="block truncate text-ink">{english ? item.nameEn || "Translation required" : item.nameZh}</strong>{english ? <small className="block truncate text-ink-soft">{item.nameEn ? item.nameZh : ""}</small> : item.nameEn ? <small className="block truncate text-primary">{item.nameEn}</small> : null}</span>
            <span className="min-w-0"><span className="block truncate text-ink-soft">{english ? item.descriptionEn || "—" : item.descriptionZh ?? "—"}</span>{english ? null : item.descriptionEn ? <small className="block truncate text-ink-faint">{item.descriptionEn}</small> : null}</span>
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
  const { language } = useI18n();
  const english = language === "en";
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
          setError(english ? "Could not load the Business Order" : (caught instanceof Error ? caught.message : "Business Order 读取失败"));
        }
      });
    return () => { active = false; };
  }, [businessOrderId, english, reloadKey]);

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
    data?.chargeUnits.map((unit) => [unit.id, english ? unit.labelEn || "Translation required" : unit.labelEn ? `${unit.labelZh} / ${unit.labelEn}` : unit.labelZh]) ?? [],
  ), [data, english]);
  const assignedTeamStaff = useMemo(() => {
    if (!masterData || !rounds?.current.assignedTeamId) return [];
    return masterData.staff.filter((staff) =>
      staff.status === "active" && staff.currentTeamId === rounds.current.assignedTeamId,
    );
  }, [masterData, rounds]);
  const historyItems = useMemo<FormalBusinessOrderHistoryItem[]>(() => {
    if (!rounds || !masterData) return [];
    return rounds.auditTrail.map((event) => ({
      id: `audit-${event.id}`,
      occurredAt: formatDateTime(event.occurredAt),
      actor: event.actorDisplayName?.trim() || event.actorUsername?.trim() || (event.actorAccountId ? `${english ? "Account" : "账号"} #${event.actorAccountId}` : (english ? "System" : "系统")),
      summary: businessOrderAuditSummary(event.eventType, event.after, masterData, language),
      reason: event.reason,
      changes: businessOrderAuditChanges(event.before, event.after, masterData, language),
    }));
  }, [english, language, masterData, rounds]);

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
      setNotice(english ? `Payment recorded. Receipt: ${result.receipt.receiptNo}` : `收款已记录，Receipt：${result.receipt.receiptNo}`);
      refresh();
    } catch (caught) {
      setError(english ? "Could not record the payment" : (caught instanceof Error ? caught.message : "收款失败"));
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
      setNotice(english ? `Refund ${refund.refundNo} created. Print the acknowledgement for the customer's handwritten signature; the signed copy can be uploaded later.` : `退款已生成：${refund.refundNo}。请打印退款签收单交客户手写签字；签字件可稍后回传。`);
      refresh();
    } catch (caught) {
      setError(english ? "Could not record the refund" : (caught instanceof Error ? caught.message : "退款失败"));
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
      setNotice(english ? `Refund proof archived for ${refund.refundNo}. The evidence cannot be replaced.` : `退款凭证已归档：${refund.refundNo}。凭证不可替换。`);
      refresh();
    } catch (caught) {
      setError(english ? "Could not upload the refund proof" : (caught instanceof Error ? caught.message : "退款凭证上传失败"));
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
      setNotice(english ? `Signed refund acknowledgement archived for ${refund.refundNo}. The signed copy cannot be replaced.` : `签字后的退款签收单已归档：${refund.refundNo}。签字件不可替换。`);
      refresh();
    } catch (caught) {
      setError(english ? "Could not upload the signed refund acknowledgement" : (caught instanceof Error ? caught.message : "退款签收单上传失败"));
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
      setNotice(english ? `Generated ${formalDocumentKindLabel(document.kind, language)}: ${document.documentNo}` : `已生成 ${formalDocumentKindLabel(document.kind)}：${document.documentNo}`);
      refresh();
      return document;
    } catch (caught) {
      setError(english ? "Could not generate the print document" : (caught instanceof Error ? caught.message : "打印文档生成失败"));
      return null;
    } finally {
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
      setError(english ? "Could not update the repair round" : (caught instanceof Error ? caught.message : "维修轮次操作失败"));
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
      setChargeActionError(english ? "Enter the Chinese item name or description before translating" : "请先填写要翻译的中文项目名称或描述");
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
        setChargeActionError(english ? "AI translation returned no result. Check the AI service in Settings and try again." : "AI 翻译没有返回结果，请到系统设置检查 AI 服务后重试");
        return;
      }
      setChargeDraft((current) => current.map((candidate) => candidate.key === key ? {
        ...candidate,
        nameEn: nameEn ?? candidate.nameEn,
        descriptionEn: descriptionEn ?? candidate.descriptionEn,
      } : candidate));
      setChargeActionNotice(english ? "The charge item was translated. Review it before saving." : "当前收费项目已翻译，请核对后保存");
    } finally {
      setTranslatingKey(null);
    }
  };

  const translateChargeNoteDraft = async (key: string) => {
    const note = chargeNoteDraft.find((candidate) => candidate.key === key);
    if (!note?.contentZh.trim()) {
      setChargeActionError(english ? "Enter the Chinese note before translating" : "请先填写要翻译的中文备注");
      return;
    }
    setTranslatingKey(`note-${key}`);
    setChargeActionError(null);
    setChargeActionNotice(null);
    try {
      const contentEn = await aiTranslateRepair(note.contentZh);
      if (!contentEn) {
        setChargeActionError(english ? "AI translation returned no result. Check the AI service in Settings and try again." : "AI 翻译没有返回结果，请到系统设置检查 AI 服务后重试");
        return;
      }
      setChargeNoteDraft((current) => current.map((candidate) => candidate.key === key
        ? { ...candidate, contentEn }
        : candidate));
      setChargeActionNotice(english ? "The note was translated. Review it before saving." : "当前备注已翻译，请核对后保存");
    } finally {
      setTranslatingKey(null);
    }
  };

  const withdrawCurrentAssignment = () => {
    if (!rounds) return;
    const confirmed = window.confirm(english ? "Withdrawing returns this round to Awaiting assignment. Existing acceptance, mileage, photos, work returns and timestamps are preserved. Continue?" : "撤回后，本轮回到待派单。已有接单、里程、照片、回单和时间记录都会保留。确认撤回？");
    if (!confirmed) return;
    void submitRoundAction({
      action: "withdraw_assignment",
      repairRoundVersion: rounds.current.version,
    }, english ? "Assignment withdrawn. You can select another repair team." : "派单已撤回，现在可以重新选择维修班组");
  };

  const cancelAccidentalAfterSalesRound = () => {
    if (!rounds) return;
    const confirmed = window.confirm(english ? "This only cancels an accidental after-sales round with no actual records and restores the previous handed-off round. Continue?" : "仅撤销尚未产生任何实际记录的误建售后轮次，并恢复上一轮已交单状态。确认撤销本轮？");
    if (!confirmed) return;
    setAfterSalesOpen(false);
    void submitRoundAction({
      action: "cancel_after_sales",
      repairRoundVersion: rounds.current.version,
    }, english ? "Accidental repair round cancelled. The previous handed-off round was restored." : "误建维修轮次已撤销，已恢复上一轮已交单状态");
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
    setChargeActionNotice(english ? `${aiParsed ? "AI" : "Local rules"} prepared ${staged.length} charge items and ${stagedNotes.length} note drafts. Review them before saving.` : `${aiParsed ? "AI" : "本地规则"}已整理 ${staged.length} 个收费项目和 ${stagedNotes.length} 条备注草稿，请核对后保存`);
  };

  const submitCharges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    setChargeActionError(null);
    setChargeActionNotice(english ? "Saving charges and notes…" : "正在保存收费项目和备注…");
    try {
      await replaceFormalChargeVersion(businessOrderId, {
        expectedBusinessOrderVersion: data.order.version,
        reason: String(fields.get("reason") ?? ""),
        laborDiscount: "0",
        partDiscount: "0",
        otherDiscount: "0",
        wholeOrderDiscount: "0",
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: chargeDraft.map(({ key: _key, ...item }) => item),
        notes: chargeNoteDraft
          .filter((note) => note.contentZh.trim() || note.contentEn.trim())
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(({ key: _key, ...note }) => note),
      });
      setChargeEditing(false);
      setNotice(english ? "Charges saved as a new version" : "收费项目已保存为新版本");
      setChargeActionNotice(null);
      refresh();
    } catch (caught) {
      const message = english ? "Could not save the charge items" : (caught instanceof Error ? caught.message : "收费项目保存失败");
      setError(message);
      setChargeActionNotice(null);
      setChargeActionError(message);
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return <div role="status" className="mx-auto mt-6 h-[640px] max-w-[1720px] animate-pulse rounded-2xl bg-layer-2" />;
  if (error && !data) return <div role="alert" className="mx-auto mt-6 flex min-h-[360px] max-w-[1720px] flex-col items-center justify-center rounded-2xl border border-rose-200"><AlertCircle className="text-rose-600" /><p className="mt-2 text-sm font-semibold">{error}</p><button type="button" onClick={refresh} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm"><RefreshCw size={14} />{english ? "Retry" : "重试"}</button></div>;
  if (!data) return null;

  const { order, charges, ledger } = data;
  const isFinanciallySettled = ledger.balanceMinor === 0;
  const groupedDiscounts = formalGroupedChargeDiscounts(charges);
  const progressIndex = PROGRESS.findIndex(([status]) => status === order.status);
  const refundById = new Map(data.refunds.map((refund) => [refund.id, refund]));
  const payerMeta = [
    `${english ? "Payer" : "费用承担"}：${order.payer.displayName}`,
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
    ? english ? `Team ${currentHistoricalTeamId} · Translation required` : masterData?.teams.find((team) => team.id === currentHistoricalTeamId)?.name ?? `维修班组 #${currentHistoricalTeamId}`
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
      setError(english ? "The formal handoff state changed. Refresh and try again." : "正式交单状态已变化，请刷新后重试");
      return;
    }

    const reason = draft.reason.trim();
    if (!reason) {
      setError(english ? "Enter the reason for cancelling this formal handoff in the same month" : "请输入同月取消正式交单原因");
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
      setNotice(english ? "This formal handoff was cancelled in the same month. The original handoff record remains preserved." : "本次正式交单已在同月取消，原交单事实仍保留");
      refresh();
    } catch (caught) {
      setError(english ? "Could not cancel the formal handoff" : (caught instanceof Error ? caught.message : "取消正式交单失败"));
    } finally {
      cancelHandoffInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div data-testid="formal-business-order-detail" className="formal-business-order-page min-h-full bg-page px-3 py-3 text-ink sm:px-5">
      <div className="mx-auto w-full max-w-[1720px] space-y-3">
        <header className="rounded-[22px] border border-line bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><Link href="/orders/business" className="text-xs font-semibold text-primary">← {english ? "Back to Business Orders" : "返回 Business Order 列表"}</Link><h1 className="mt-2 text-2xl font-bold text-ink">{order.orderNo}</h1><p className="mt-1 text-sm text-ink-soft">{order.vehicle.plate} · {order.vehicle.description}{order.vehicle.vin ? ` · VIN ${order.vehicle.vin}` : ""}</p><p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">{payerMeta.map((value) => <span key={value}>{value}</span>)}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {isFinanciallySettled ? <span className="rounded-full border border-state-success-border bg-state-success-subtle px-4 py-2 text-xs font-black text-state-success-text shadow-sm">{english ? "Financially settled" : "财务已结清"}</span> : null}
              <span className="rounded-full bg-layer-2 px-3 py-1.5 text-xs font-bold text-accent shadow-sm">{order.voided ? (english ? "Voided" : "已作废") : formalBusinessOrderStatusLabel(order.status, language)}</span>
              <RecordDeleteButton
                record={{ kind: "business_order", recordNo: order.orderNo, version: order.version }}
                title={english ? "Delete Business Order" : "删除业务单"}
                returnTo="/orders/business"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-state-danger-border bg-card px-3 text-xs font-semibold text-state-danger-text hover:bg-state-danger-subtle"
              />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-1.5">
            {PROGRESS.map(([status, labelZh, labelEn], index) => <div key={status} className={`rounded-md border px-2 py-2 text-center text-[11px] font-semibold ${index < progressIndex ? "border-accent-solid bg-accent-solid text-accent-foreground" : index === progressIndex ? "border-state-warning-border bg-state-warning-subtle text-state-warning-text" : "border-line bg-layer-2 text-ink-soft"}`}>{index + 1} {english ? labelEn : labelZh}</div>)}
          </div>
        </header>

        {notice ? <p role="status" className="rounded-xl border border-state-success-border bg-state-success-subtle px-4 py-3 text-sm font-semibold text-state-success-text">{notice}</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-3 text-sm font-semibold text-state-danger-text">{error}</p> : null}

        <FormalBusinessOrderTabs
          pathname={pathname}
          searchParams={workspaceSearchParams}
          active={activeWorkspace}
          unreadMessageCount={data.unreadMentionCount}
        />

        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        {rounds && masterData ? <section id="business-order-repair-workspace" hidden={activeWorkspace !== "operations"} className="rounded-2xl border border-line bg-card p-4 shadow-card xl:col-start-2 xl:row-start-1">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">{english ? `Repair round ${rounds.current.roundNo}` : `第 ${rounds.current.roundNo} 轮维修`}</h2><p className="mt-1 text-xs text-ink-soft">{rounds.current.source === "after_sales" ? `${english ? "After-sales return" : "售后回厂"}: ${rounds.current.afterSalesIssue}` : (english ? "Initial repair" : "首次维修")} · {english ? "Each round keeps its own activity and formal handoff time" : "每轮记录和正式交单时间独立保留"}</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setHistoryOpen(true)} className="min-h-8 rounded-lg border border-line px-3 text-xs font-bold">{english ? "View full order history" : "查看整单历史"}</button><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary">{formalBusinessOrderStatusLabel(rounds.current.status, language)}</span>{(["assigned", "in_repair", "return_pending_review"] as const).includes(rounds.current.status as "assigned" | "in_repair" | "return_pending_review") ? <button disabled={busy} type="button" onClick={withdrawCurrentAssignment} className="min-h-8 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-700 disabled:opacity-40">{english ? "Withdraw assignment" : "撤回派单"}</button> : null}</div></div>
          {rounds.current.status === "waiting_assignment" ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); const confirmed = ledger.totalPaidMinor > 0 || window.confirm(english ? "No payment has been recorded. Have the Business Order details been confirmed with the customer? Cancel to leave the order unassigned." : "本单尚无收款信息。是否已经与客户确认好业务内容？选择取消则不派单。 "); if (!confirmed) return; void submitRoundAction({ action: "assign", businessOrderVersion: order.version, teamId: Number(selectedTeamId), customerConfirmed: true }, english ? "Assigned to the repair team" : "已派给维修班组"); }}><fieldset><legend className="text-xs font-bold">{english ? "Select repair team" : "选择维修班组"}</legend><div className="mt-2 flex flex-wrap gap-2">{masterData.teams.filter((team) => team.isActive).map((team) => <label key={team.id} className={`cursor-pointer rounded-lg border px-4 py-3 text-xs font-bold transition ${selectedTeamId === String(team.id) ? "border-accent-solid bg-accent-solid text-accent-foreground" : "border-line bg-layer-2 text-ink"}`}><input type="radio" name="teamId" value={team.id} required checked={selectedTeamId === String(team.id)} onChange={(event) => setSelectedTeamId(event.target.value)} className="sr-only" />{english ? `Team ${team.id} · Translation required` : team.name}</label>)}</div></fieldset><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !selectedTeamId} className="min-h-10 rounded-lg bg-accent-solid px-4 text-xs font-bold text-accent-foreground disabled:opacity-40">{english ? "Assign" : "派单"}</button>{masterData.teams.every((team) => !team.isActive) ? <Link href={`/dictionaries?returnTo=${encodeURIComponent(`/orders/business/${businessOrderId}`)}#teams`} className="min-h-10 rounded-lg border border-accent px-4 py-2.5 text-xs font-bold text-accent">{english ? "Add a repair team first" : "先新增维修班组"}</Link> : null}</div></form> : null}
          {rounds.current.status === "waiting_assignment" && rounds.current.source === "after_sales" && rounds.current.assignedTeamId === null ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-state-danger-border bg-state-danger-subtle px-3 py-2"><p className="text-xs text-state-danger-text">{english ? "If this round was created by mistake and has no actual records, you can cancel it and restore the previous handed-off round." : "如果本轮是误触创建，并且尚未产生任何实际记录，可以撤销并回到上一轮已交单状态。"}</p><button disabled={busy} type="button" onClick={cancelAccidentalAfterSalesRound} className="min-h-9 rounded-lg border border-state-danger-border bg-card px-3 text-xs font-bold text-state-danger-text disabled:opacity-40">{english ? "Cancel this round" : "撤销本轮"}</button></div> : null}
          {rounds.current.status === "assigned" ? <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-xs font-bold text-amber-950">{english ? "Next: record mechanic acceptance" : "下一步：登记维修工接单"}</h3>
            <p className="mt-1 text-xs text-amber-900">{english ? "The round moves to In repair when a mechanic accepts it on mobile. If a paper mechanic copy is returned, select the actual mechanic here to record acceptance." : "维修工手机端接单后会自动进入维修中；收到纸质维修工联时，也可以在这里选择实际维修工代录接单。"}</p>
            {assignedTeamStaff.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{assignedTeamStaff.map((staff) => <button key={staff.id} disabled={busy} type="button" onClick={() => void submitRoundAction({ action: "record_paper_acceptance", repairRoundVersion: rounds.current.version, actualStaffMemberId: staff.id }, english ? `Recorded acceptance by ${staff.fullName}` : `已登记 ${staff.fullName} 接单`)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{staff.fullName} · {english ? "Accept" : "接单"}</button>)}</div> : <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-rose-700">{english ? "This team has no active mechanic who can accept the round." : "当前班组没有可接单的在职维修工。"}</span><Link href={`/employees?create=1&team=${rounds.current.assignedTeamId}&returnTo=${encodeURIComponent(`/orders/business/${businessOrderId}`)}`} className="min-h-9 rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary">{english ? "Add a mechanic and return" : "新增维修工后返回"}</Link></div>}
          </section> : null}
          {rounds.current.status === "in_repair" ? <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {rounds.current.intakeMileageKm === null ? <form className="rounded-xl border border-line p-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitRoundAction({ action: "record_mileage", repairRoundVersion: rounds.current.version, odometerKm: Number(form.get("odometerKm")) }, english ? "Intake mileage recorded" : "接车里程已记录"); }}><h3 className="text-xs font-bold">{english ? "Intake mileage" : "接车里程"}</h3><div className="mt-2 flex gap-2"><input name="odometerKm" required type="number" min="0" step="1" placeholder={english ? "Enter mileage" : "直接输入"} className="min-h-10 min-w-0 flex-1 rounded-lg border border-line px-3" /><span className="py-2.5 text-xs">km</span><button disabled={busy} className="rounded-lg bg-primary px-4 text-xs font-bold text-white">{english ? "Save" : "保存"}</button></div></form> : <div className="rounded-xl border border-line p-3 text-xs"><span className="text-ink-soft">{english ? "Intake mileage" : "接车里程"}</span><strong className="mt-1 block text-base">{rounds.current.intakeMileageKm.toLocaleString()} km</strong></div>}
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line p-3">
              <button type="button" onClick={() => setInspectionCreateOpen(true)} className="inline-flex min-h-10 items-center rounded-lg border border-primary px-4 text-xs font-bold text-primary">{english ? "Create inspection report" : "新建检查结果"}</button>
              <button type="button" onClick={() => setAdvanceRoundOpen((open) => !open)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">{english ? "Advance to next step" : "推进下一步"}</button>
            </div>
            {advanceRoundOpen ? <form className="rounded-xl border border-primary/30 bg-primary-50 p-3 lg:col-span-2" onSubmit={(event) => { event.preventDefault(); setAdvanceRoundOpen(false); void submitRoundAction({ action: "submit_return", repairRoundVersion: rounds.current.version }, "已推进到回单待审核"); }}>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xs font-bold">{english ? "Advance to work-return review" : "推进到回单待审核"}</h3><p className="mt-1 text-[11px] text-ink-soft">{english ? "The mechanic has completed this round and the front desk must verify it on site. This does not formally hand off or close the Business Order." : "表示维修工已完成本轮工作，等待前台现场核验；不代表正式交单或 Business Order 完结。"}</p></div><div className="flex gap-2"><button type="button" onClick={() => setAdvanceRoundOpen(false)} className="min-h-9 rounded-md border border-line bg-layer-2 px-3 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} className="min-h-9 rounded-lg bg-accent-solid px-4 text-xs font-bold text-accent-foreground disabled:opacity-40">{english ? "Confirm" : "确认推进"}</button></div></div>
            </form> : null}
          </div> : null}
          {rounds.current.status === "return_pending_review" ? <div className="mt-3 flex flex-wrap items-end gap-2">{rounds.current.latestWorkReturnId && !rounds.current.approvedWorkReturnId ? <><button disabled={busy} type="button" onClick={() => void submitRoundAction({ action: "approve_return", repairRoundVersion: rounds.current.version, workReturnId: rounds.current.latestWorkReturnId }, english ? "Work return approved" : "维修回单已审核通过")} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">{english ? "Approve" : "审核通过"}</button><button disabled={busy} type="button" onClick={() => { const reason = window.prompt(english ? "Enter the return reason" : "请输入退回原因"); if (reason) void submitRoundAction({ action: "reject_return", repairRoundVersion: rounds.current.version, workReturnId: rounds.current.latestWorkReturnId, reason }, english ? "Work return sent back to the repair team" : "维修回单已退回"); }} className="min-h-10 rounded-lg border border-rose-300 px-4 text-xs font-bold text-rose-700">{english ? "Return to repair team" : "退回维修班组"}</button></> : null}{rounds.current.approvedWorkReturnId ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitRoundAction({ action: "formal_handoff", repairRoundVersion: rounds.current.version, performanceValue: String(form.get("performanceValue")) }, english ? "Round formally handed off and performance recorded" : "本轮已正式交单，绩效事实已落地"); }}><label className="text-xs">{english ? "Round performance value (JMD)" : "本轮绩效值（JMD）"}<input name="performanceValue" required defaultValue={String(charges.items.filter((item) => item.kind === "labor").reduce((sum, item) => sum + item.subtotalMinor, 0) / 100)} className="mt-1 min-h-10 rounded-lg border border-line px-3" /></label><button disabled={busy} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white">{english ? "Formal handoff" : "正式交单"}</button></form> : null}</div> : null}
          {rounds.current.status === "formally_handed_off" ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-sm font-bold text-emerald-900">{english ? "This repair round has been formally handed off" : "本轮维修已经正式交单"}</h3><p className="mt-1 text-xs text-emerald-800">{english ? "Repair work is complete. Payments, vehicle release and any outstanding balance remain in this Business Order." : "维修工作已经完成；收款、取车和未结余额继续在本 Business Order 内处理。"}</p></div>
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
                  className="min-h-9 rounded-lg border border-state-danger-border bg-card px-3 text-xs font-bold text-state-danger-text disabled:opacity-40"
                >{english ? "Cancel this formal handoff" : "取消本次正式交单"}</button> : null}
                <button
                  type="button"
                  disabled={busy}
                  aria-expanded={afterSalesOpen}
                  aria-controls="formal-after-sales-form"
                  onClick={() => {
                    setCancelHandoffDraft(null);
                    setAfterSalesOpen((open) => !open);
                  }}
                  className="min-h-9 rounded-lg border border-state-warning-border bg-card px-3 text-xs font-bold text-state-warning-text disabled:opacity-40"
                >{english ? "After-sales return" : "售后回厂"}</button>
              </div> : null}
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><span>{english ? "Repair team" : "维修班组"}<strong className="mt-1 block text-emerald-950">{currentTeamName ?? (english ? "Not recorded" : "未记录")}</strong></span><span>{english ? "Round performance" : "本轮绩效"}<strong className="mt-1 block text-emerald-950">{currentActiveHandoff ? formatFormalMoney(currentActiveHandoff.performanceMinor) : (english ? "Not recorded" : "未记录")}</strong></span><span>{english ? "Handoff time" : "交单时间"}<strong className="mt-1 block text-emerald-950">{currentActiveHandoff ? formatDateTime(currentActiveHandoff.handedOffAt) : (english ? "Not recorded" : "未记录")}</strong></span></div>
            {data.capabilities.canWrite
              && currentActiveHandoff
              && cancelHandoffDraft?.handoffId === currentActiveHandoff.id
              ? <form
                id="formal-handoff-cancellation-form"
                aria-label={english ? "Cancel formal handoff in the same month" : "同月取消正式交单"}
                className="mt-3 border-t border-rose-200 pt-3"
                onSubmit={submitHandoffCancellation}
              >
                <label htmlFor="formal-handoff-cancellation-reason" className="block text-xs font-bold text-rose-900">{english ? "Cancellation reason" : "取消原因"}</label>
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
                  className="mt-1 min-h-20 w-full rounded-lg border border-state-danger-border bg-layer-2 p-3 text-sm text-ink"
                />
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCancelHandoffDraft(null)}
                    className="min-h-9 rounded-lg border border-line bg-layer-2 px-3 text-xs font-bold disabled:opacity-40"
                  >{english ? "Cancel" : "取消"}</button>
                  <button
                    type="submit"
                    disabled={busy || !cancelHandoffDraft.reason.trim()}
                    className="min-h-9 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white disabled:opacity-40"
                  >{busy ? (english ? "Cancelling…" : "正在取消…") : (english ? "Confirm formal handoff cancellation" : "确认取消正式交单")}</button>
                </div>
              </form>
              : null}
            {data.capabilities.canWrite && afterSalesOpen ? <form id="formal-after-sales-form" className="mt-3 flex flex-wrap items-end gap-2 border-t border-state-success-border pt-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setAfterSalesOpen(false); void submitRoundAction({ action: "start_after_sales", businessOrderVersion: order.version, issue: String(form.get("issue")) }, english ? "Started the next after-sales repair round in this Business Order" : "已在本 Business Order 开始下一轮售后维修"); }}><label className="min-w-[320px] flex-1 text-xs">{english ? "After-sales return issue" : "本次售后回厂问题"}<input name="issue" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-ink" /></label><button type="button" onClick={() => setAfterSalesOpen(false)} className="min-h-10 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} className="min-h-10 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white">{english ? "Start next repair round" : "确认开始下一轮维修"}</button></form> : null}
          </div> : null}
          <div className="mt-3 border-t border-line pt-3"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold">{english ? "Related inspection reports" : "相关检查结果"}</h3><span className="text-[11px] text-ink-soft">{english ? `${relatedInspectionReports.length} reports` : `${relatedInspectionReports.length} 份`}</span></div>{relatedInspectionReports.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{relatedInspectionReports.map((item) => <Link key={item.report.id} href={`/orders/inspections/${item.report.id}`} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-primary">{item.report.reportNo}</Link>)}</div> : <p className="mt-2 text-xs text-ink-soft">{english ? "This Business Order has no related inspection reports." : "本 Business Order 尚无相关检查结果。"}</p>}</div>
        </section> : null}

        {historyOpen && rounds && masterData ? <RepairHistoryDialog rounds={rounds} masterData={masterData} language={language} onClose={() => setHistoryOpen(false)} /> : null}

        <section id="business-order-history-workspace" role="tabpanel" hidden={activeWorkspace !== "history"} className="rounded-2xl border border-line bg-card p-4 shadow-card xl:col-span-2">
          {rounds && masterData ? <FormalBusinessOrderHistoryTimeline items={historyItems} /> : <p className="rounded-xl bg-surface px-3 py-4 text-xs text-ink-soft">{english ? "Loading the complete history and change record…" : "正在读取完整历史与修改记录…"}</p>}
        </section>

        <section id="business-order-documents-workspace" role="tabpanel" hidden={activeWorkspace !== "documents"} className="rounded-2xl border border-line bg-card p-4 shadow-card xl:col-span-2">
          <FormalBusinessOrderDocumentsWorkspace businessOrderId={businessOrderId} documents={data.documents} canWrite={data.capabilities.canWrite} busy={busy} onGenerate={generatePrintDocument} />
        </section>

        <section id="business-order-operations-workspace" role="tabpanel" hidden={activeWorkspace !== "operations"} className="rounded-2xl border border-line bg-card p-4 shadow-card xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-bold">{english ? "Charges" : "收费项目"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? `Version V${charges.versionNo} · Unit prices and subtotals include tax` : `版本 V${charges.versionNo} · 单价与小计均为含税金额`}</p></div>{data.capabilities.canWrite ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setNaturalLanguageOpen((open) => !open)} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary">{english ? "Natural-language entry" : "自然语言录入"}</button>{chargeEditing ? <button type="button" onClick={() => { setChargeEditing(false); setChargeDraft([]); setChargeNoteDraft([]); setChargeActionError(null); setChargeActionNotice(null); }} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">{english ? "Cancel editing" : "取消编辑"}</button> : null}<button type={chargeEditing ? "submit" : "button"} form={chargeEditing ? "charge-edit-form" : undefined} onClick={chargeEditing ? undefined : beginChargeEditing} disabled={chargeEditing && (busy || chargeDraft.length === 0)} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-40">{chargeEditing ? (english ? "Save charges" : "保存收费项目") : (english ? "Edit charges" : "编辑收费项目")}</button></div> : <span className="text-xs text-ink-soft">{charges.reason}</span>}</div>

          {naturalLanguageOpen ? <div className="mt-3 rounded-xl border border-state-info-border bg-state-info-subtle p-3"><label className="text-xs font-bold">{english ? "Natural-language input" : "自然语言输入"}<textarea value={naturalLanguageText} onChange={(event) => setNaturalLanguageText(event.target.value)} placeholder={english ? "Example: Replace front brake pads 12000, labor 5000\nCustomer concern: brake noise\nWork instruction: inspect before replacement\nAdvance notice: confirm any additional work" : "例如：更换前刹车片一套 12000，工时 5000\n客户反馈：刹车异响\n施工说明：先检查再更换\n提前告知：追加项目须再次确认"} className="mt-2 min-h-28 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm text-ink" /></label><div className="mt-2 flex gap-2"><button type="button" disabled={!naturalLanguageText.trim() || naturalLanguageBusy} onClick={() => void stageNaturalLanguage()} className="min-h-9 rounded-lg bg-accent-solid px-3 text-xs font-bold text-accent-foreground disabled:opacity-40">{naturalLanguageBusy ? (english ? "AI is preparing…" : "AI 整理中…") : (english ? "Prepare charge draft with AI" : "AI 整理到收费草稿")}</button><button type="button" onClick={() => { setNaturalLanguageOpen(false); setNaturalLanguageText(""); }} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">{english ? "Cancel" : "取消"}</button></div><p className="mt-2 text-[11px] text-ink-soft">{english ? "AI prepares charge items, customer concerns, work instructions, liability notices and advance notices together. Front-desk staff review before saving. If AI is unavailable, the system identifies use of local rules." : "后台 AI 同时整理收费项目、客户反馈、施工说明、责任说明和提前告知；由前台核对后保存。AI 不可用时会明确提示采用本地规则。"}</p></div> : null}

          {chargeEditing ? <form id="charge-edit-form" className="mt-3" onSubmit={submitCharges} onInvalid={(event) => { event.preventDefault(); setChargeActionError(english ? "Complete the required fields in this form" : "有必填内容未填写，请检查当前表单"); (event.target as HTMLElement).focus(); }}>
            <div className="space-y-3">{(["labor", "part", "other"] as const).map((kind) => <section key={kind}><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-primary">{english ? CATEGORY_LABELS_EN[kind] : CATEGORY_LABELS[kind]}</h3><button type="button" onClick={() => addChargeDraftItem(kind)} className="rounded-md border border-primary px-2 py-1 text-[11px] font-bold text-primary">{english ? CATEGORY_ADD_LABELS_EN[kind] : CATEGORY_ADD_LABELS[kind]}</button></div><div className="mt-1 space-y-2">{chargeDraft.filter((item) => item.kind === kind).map((item) => <div key={item.key} className="grid min-w-0 gap-2 rounded-xl border border-line p-2 text-xs lg:grid-cols-[1.35fr_1.35fr_.7fr_.55fr_.75fr_.7fr_auto_auto] lg:items-end"><label>{english ? "Chinese item name" : "项目名称"}<input aria-label={english ? "Chinese item name" : "项目名称"} required value={item.nameZh} onChange={(event) => updateChargeDraft(item.key, "nameZh", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /><input aria-label={english ? "English item name" : "项目英文名称"} value={item.nameEn} onChange={(event) => updateChargeDraft(item.key, "nameEn", event.target.value)} placeholder="English" className="mt-1 min-h-8 w-full rounded-md border border-line px-2 text-[11px]" /></label><label>{english ? "Chinese description" : "描述"}<input aria-label={english ? "Chinese description" : "描述"} value={item.descriptionZh} onChange={(event) => updateChargeDraft(item.key, "descriptionZh", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /><input aria-label={english ? "English description" : "英文描述"} value={item.descriptionEn} onChange={(event) => updateChargeDraft(item.key, "descriptionEn", event.target.value)} placeholder="English" className="mt-1 min-h-8 w-full rounded-md border border-line px-2 text-[11px]" /></label><label>{english ? "Unit" : "单位"}<select aria-label={english ? "Unit" : "单位"} value={item.unitItemId} onChange={(event) => updateChargeDraft(item.key, "unitItemId", Number(event.target.value))} className="mt-1 min-h-9 w-full rounded-md border border-line px-2">{data.chargeUnits.map((unit) => <option key={unit.id} value={unit.id}>{english ? unit.labelEn || "Translation required" : unit.labelZh}</option>)}</select></label><label>{english ? "Quantity" : "数量"}<input aria-label={english ? "Quantity" : "数量"} required inputMode="decimal" value={item.quantity} onChange={(event) => updateChargeDraft(item.key, "quantity", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label><label>{english ? "Tax-inclusive price" : "含税单价"}<input aria-label={english ? "Tax-inclusive price" : "含税单价"} required inputMode="decimal" value={item.unitPrice} onChange={(event) => updateChargeDraft(item.key, "unitPrice", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label><label>{english ? "Item discount" : "本项折扣"}<input aria-label={english ? "Item discount" : "本项折扣"} required inputMode="decimal" value={item.itemDiscount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateChargeDraft(item.key, "itemDiscount", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label><button type="button" aria-label={english ? `Translate charge item ${item.nameZh || "unnamed"}` : `翻译收费项目 ${item.nameZh || "未命名"}`} disabled={translatingKey !== null} onClick={() => void translateChargeDraftItem(item.key)} className="min-h-9 rounded-md border border-primary px-2 font-bold text-primary disabled:opacity-40">{translatingKey === `item-${item.key}` ? "…" : (english ? "Translate" : "译")}</button><button type="button" onClick={() => setChargeDraft((current) => current.filter((candidate) => candidate.key !== item.key))} className="min-h-9 rounded-md border border-rose-300 px-2 font-bold text-rose-600">{english ? "Delete" : "删"}</button></div>)}</div></section>)}</div>
            <section className="mt-3 rounded-xl border border-state-warning-border bg-state-warning-subtle p-3"><div className="flex items-center justify-between gap-2"><div><h3 className="text-xs font-bold text-state-warning-text">{english ? "Notes, responsibilities and advance notice" : "备注、责任义务与提前告知"}</h3><p className="mt-1 text-[11px] text-state-warning-text">{english ? "Saved with this charge version and preserved for printing." : "与本次收费版本一起保存，打印时采用当时版本。"}</p></div><button type="button" onClick={addChargeNoteDraft} className="rounded-md border border-state-warning-border px-2 py-1 text-[11px] font-bold text-state-warning-text">{english ? "Add note" : "新增备注"}</button></div><div className="mt-2 space-y-2">{chargeNoteDraft.map((note) => <div key={note.key} className="grid gap-2 rounded-lg border border-state-warning-border bg-card p-2 text-xs lg:grid-cols-[.85fr_1.5fr_1.5fr_auto_auto] lg:items-end"><label>{english ? "Note type" : "备注类型"}<select aria-label={english ? "Note type" : "备注类型"} value={note.kind} onChange={(event) => updateChargeNoteDraft(note.key, "kind", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line bg-layer-2 px-2 text-ink">{Object.entries(english ? NOTE_KIND_LABELS_EN : NOTE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><label>{english ? "Chinese content" : "中文内容"}<textarea aria-label={english ? "Chinese note content" : "备注中文内容"} required value={note.contentZh} onChange={(event) => updateChargeNoteDraft(note.key, "contentZh", event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-line bg-layer-2 p-2 text-ink" /></label><label>{english ? "English content" : "英文内容"}<textarea aria-label={english ? "English note content" : "备注英文内容"} value={note.contentEn} onChange={(event) => updateChargeNoteDraft(note.key, "contentEn", event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-line bg-layer-2 p-2 text-ink" /></label><button type="button" aria-label={english ? `Translate note ${NOTE_KIND_LABELS_EN[note.kind]}` : `翻译备注 ${NOTE_KIND_LABELS[note.kind]}`} disabled={translatingKey !== null} onClick={() => void translateChargeNoteDraft(note.key)} className="min-h-9 rounded-md border border-state-warning-border px-2 font-bold text-state-warning-text disabled:opacity-40">{translatingKey === `note-${note.key}` ? "…" : (english ? "Translate" : "译")}</button><button type="button" onClick={() => setChargeNoteDraft((current) => current.filter((candidate) => candidate.key !== note.key))} className="min-h-9 rounded-md border border-state-danger-border px-2 font-bold text-state-danger-text">{english ? "Delete" : "删"}</button></div>)}</div></section>
            <div className="mt-3 rounded-xl bg-surface p-3 text-xs"><label>{english ? "Reason for change" : "修改原因"}<input name="reason" required defaultValue={english ? "Charges updated after front-desk review" : "前台核对后更新收费"} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label></div>
                {chargeActionError ? <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{chargeActionError}</p> : null}
                {chargeActionNotice ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{chargeActionNotice}</p> : null}
          </form> : <><ChargeSection charges={charges} kind="labor" unitLabels={unitLabels} language={language} /><ChargeSection charges={charges} kind="part" unitLabels={unitLabels} language={language} /><ChargeSection charges={charges} kind="other" unitLabels={unitLabels} language={language} /><div className="mt-4 grid gap-2 border-t border-line pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><span>{english ? "Original charges" : "收费原价"}<strong className="mt-1 block">{formatFormalMoney(charges.totals.grossMinor)}</strong></span><span>{english ? "Labor discounts" : "工时折扣合计"}<strong className="mt-1 block text-rose-600">−{formatFormalMoney(groupedDiscounts.laborDiscountMinor)}</strong></span><span>{english ? "Parts discounts" : "配件折扣合计"}<strong className="mt-1 block text-rose-600">−{formatFormalMoney(groupedDiscounts.partDiscountMinor)}</strong></span><span>{english ? "Amount due after discounts (15% GCT included)" : "折后应收（含 15% GCT）"}<strong className="mt-1 block text-base">{formatFormalMoney(charges.totals.totalDueMinor)}</strong><small>{english ? "Included GCT" : "其中 GCT"} {formatFormalMoney(charges.totals.includedGctMinor)}</small></span></div>{charges.notes.length > 0 ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-950"><strong>{english ? "Notes, responsibilities and advance notice" : "备注 / 责任义务与提前告知"}</strong>{charges.notes.map((note) => <p key={note.id} className="mt-1">{english ? note.contentEn || "Translation required" : note.contentZh ?? ""}{!english && note.contentEn ? ` / ${note.contentEn}` : ""}</p>)}</div> : null}</>}
        </section>

        <section id="business-order-finance-workspace" hidden={activeWorkspace !== "operations"} className="rounded-2xl border border-line bg-card p-4 shadow-card xl:col-start-2 xl:row-start-2">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">{english ? "Payments and refunds" : "收付款"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Every payment and refund is preserved as a separate record. The balance is calculated from the transaction history." : "每一笔收款、退款独立留痕，余额由历史自动计算。"}</p></div><div className="flex gap-2">{data.capabilities.canRecordPayment ? <button type="button" onClick={() => { setPaymentFormOpen(true); setRefundFormOpen(false); }} className="min-h-9 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white">{english ? "Record payment" : "登记收款"}</button> : null}{data.capabilities.canRefund ? <button type="button" onClick={() => { setRefundFormOpen(true); setPaymentFormOpen(false); }} className="min-h-9 rounded-lg border border-rose-400 px-3 text-xs font-bold text-rose-700">{english ? "Create refund" : "生成退款"}</button> : null}</div></div>
          {isFinanciallySettled ? <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-black text-emerald-900">{english ? "Financially settled · Outstanding balance" : "财务已结清 · 当前未结余额"} {formatFormalMoney(0)}</div> : null}
          <div className="mt-3 grid grid-cols-2 gap-2"><span className="min-w-0 rounded-xl bg-surface p-3 text-xs">{english ? "Amount due after discounts" : "折后应收"}<strong className="mt-1 block whitespace-nowrap text-sm tabular-nums">{formatFormalMoney(ledger.currentDueMinor)}</strong></span><span className="min-w-0 rounded-xl bg-emerald-50 p-3 text-xs">{english ? "Total paid" : "累计收款"}<strong className="mt-1 block whitespace-nowrap text-sm tabular-nums text-emerald-700">{formatFormalMoney(ledger.totalPaidMinor)}</strong></span><span className="min-w-0 rounded-xl bg-rose-50 p-3 text-xs">{english ? "Total refunded" : "累计退款"}<strong className="mt-1 block whitespace-nowrap text-sm tabular-nums text-rose-700">{formatFormalMoney(ledger.totalRefundedMinor)}</strong></span><span className={`min-w-0 rounded-xl p-3 text-xs ${isFinanciallySettled ? "border border-emerald-300 bg-emerald-100 text-emerald-900" : "bg-amber-50"}`}>{isFinanciallySettled ? (english ? "Outstanding balance / Settled" : "未结余额 / 已结清") : (english ? "Outstanding balance" : "未结余额")}<strong className={`mt-1 block whitespace-nowrap text-sm tabular-nums ${isFinanciallySettled ? "text-emerald-800" : "text-amber-800"}`}>{formatFormalMoney(ledger.balanceMinor)}</strong></span></div>

          {!data.capabilities.canRecordPayment && !data.capabilities.canRefund ? <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-ink-soft">{english ? "This account is read-only and can view all payment and refund records." : "当前账号只读，可查看全部收付款事实。"}</p> : null}

          <div className="mt-4"><h3 className="text-xs font-bold">{english ? "Payment and refund history" : "收付款历史"}</h3>{ledger.transactions.length === 0 ? <p className="mt-2 text-xs text-ink-soft">{english ? "No payments or refunds recorded." : "尚无收付款记录。"}</p> : <div className="mt-2 overflow-hidden rounded-xl border border-line">{ledger.transactions.map((transaction) => {
            const refund = transaction.type === "refund" ? refundById.get(transaction.id) : null;
            return <article key={`${transaction.type}-${transaction.id}`} className="grid gap-2 border-b border-line p-3 text-xs last:border-0 lg:grid-cols-[1.2fr_.7fr_.8fr_1.6fr]"><span><strong className="block">{transaction.type === "payment" ? (english ? "Payment" : "收款") : (english ? "Refund" : "退款")} · {transaction.referenceNo}</strong><small className="text-ink-soft">{formatDateTime(transaction.occurredAt)} · {english ? transaction.methodLabelEn || "Translation required" : transaction.methodLabelZh}</small></span><strong className={transaction.type === "refund" ? "text-rose-600" : "text-emerald-600"}>{transaction.type === "refund" ? "−" : "+"}{formatFormalMoney(transaction.amountMinor)}</strong><span>{transaction.note ?? refund?.reason ?? (english ? "No note" : "无备注")}</span><span>{refund ? <span className="flex flex-col items-start gap-2"><Link href={`/orders/business/${businessOrderId}/refund/${refund.id}/print`} className="font-bold text-primary">{english ? "Print refund acknowledgement" : "打印退款签收单"}</Link>{formalRefundNeedsProof(refund) ? <form onSubmit={(event) => submitProof(event, refund.id)} className="flex w-full items-center gap-2"><input aria-label={english ? `Refund ${refund.refundNo} proof` : `退款 ${refund.refundNo} 实际凭证`} name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="min-w-0 flex-1 text-[10px]" /><button disabled={busy} className="shrink-0 rounded-md border border-primary px-2 py-1 font-semibold text-primary">{english ? "Upload transfer proof" : "补传转账凭证"}</button></form> : refund.paymentMethodCode !== "cash" ? <span className="font-semibold text-emerald-700">{english ? "Transfer proof archived" : "转账凭证已归档"}</span> : null}{formalRefundHasSignedAcknowledgement(refund) ? <span className="font-semibold text-emerald-700">{english ? "Signed refund acknowledgement uploaded" : "已上传签字后的退款签收单"}</span> : <form onSubmit={(event) => submitSignedAcknowledgement(event, refund.id)} className="flex w-full items-center gap-2"><input aria-label={english ? `Upload signed refund acknowledgement for ${refund.refundNo}` : `退款 ${refund.refundNo} 上传签字后的退款签收单`} name="signedAcknowledgement" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="min-w-0 flex-1 text-[10px]" /><button disabled={busy} className="shrink-0 rounded-md border border-primary px-2 py-1 font-semibold text-primary">{english ? "Upload signed copy" : "上传签收单"}</button></form>}</span> : transaction.receiptId ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><strong className="w-full">Receipt: {transaction.referenceNo}</strong><Link href={`/orders/business/${businessOrderId}/receipt/${transaction.receiptId}/print?copy=zh`} className="font-semibold text-primary">Chinese Receipt</Link><Link href={`/orders/business/${businessOrderId}/receipt/${transaction.receiptId}/print?copy=en`} className="font-semibold text-primary">English Receipt</Link></span> : null}</span></article>;
          })}</div>}</div>
        </section>
        <section id="business-order-messages-workspace" role="tabpanel" hidden={activeWorkspace !== "messages"} className="rounded-2xl border border-line bg-card p-4 shadow-card xl:col-span-2">
          {activeWorkspace === "messages" ? <FormalBusinessOrderMessages businessOrderId={businessOrderId} currentAccountId={data.currentAccountId} canCollaborate={data.capabilities.canCollaborate} highlightedMessageId={Number.isSafeInteger(highlightedMessageId) && highlightedMessageId > 0 ? highlightedMessageId : null} onMentionsRead={handleMentionsRead} /> : null}
        </section>
        </div>
      </div>
      <ActionDialog open={paymentFormOpen && data.capabilities.canRecordPayment} title={english ? "Record a payment" : "登记一笔收款"} description={english ? "Saving creates an immutable payment record and its corresponding Receipt." : "保存后立即形成一笔不可修改的收款事实，并生成对应 Receipt。"} onClose={() => setPaymentFormOpen(false)}>
        <form onSubmit={submitPayment}>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">{english ? "Amount (JMD)" : "金额（JMD）"}<input name="amount" inputMode="decimal" required autoFocus className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink" /></label><label className="text-xs font-semibold">{english ? "Payment method" : "收款方式"}<select name="paymentMethodItemId" required className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink"><option value="">{english ? "Select a method" : "选择方式"}</option>{data.paymentMethods.map((method) => <option key={method.id} value={method.id}>{english ? method.labelEn || "Translation required" : method.labelZh}{!english && method.labelEn ? ` / ${method.labelEn}` : ""}</option>)}</select></label></div>
          <label className="mt-3 block text-xs font-semibold">{english ? "Note" : "备注"}<input name="note" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink" /></label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPaymentFormOpen(false)} className="min-h-10 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} type="submit" className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? (english ? "Recording…" : "正在登记…") : (english ? "Record payment and generate Receipt" : "收款并生成 Receipt")}</button></div>
        </form>
      </ActionDialog>
      <ActionDialog open={refundFormOpen && data.capabilities.canRefund} title={english ? "Record a refund" : "登记一笔退款"} description={english ? "Record the refund and generate an acknowledgement. Print it for the customer's handwritten signature, then upload the signed copy later." : "先登记退款并生成签收单；打印后由客户手写签字，签字件可随后回传。"} onClose={() => setRefundFormOpen(false)}>
        <form onSubmit={submitRefund}>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">{english ? "Amount (JMD)" : "金额（JMD）"}<input name="amount" inputMode="decimal" required autoFocus className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink" /></label><label className="text-xs font-semibold">{english ? "Refund method" : "退款方式"}<select name="paymentMethodItemId" required className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink"><option value="">{english ? "Select a method" : "选择方式"}</option>{data.paymentMethods.map((method) => <option key={method.id} value={method.id}>{english ? method.labelEn || "Translation required" : method.labelZh}{!english && method.labelEn ? ` / ${method.labelEn}` : ""}</option>)}</select></label></div>
          <label className="mt-3 block text-xs font-semibold">{english ? "Refund reason" : "退款原因"}<textarea name="reason" required className="mt-1 min-h-20 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm text-ink" /></label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">{english ? "Original customer document" : "原客户单据"}<select name="originalDocumentStatus" required className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink"><option value="returned">{english ? "Original returned" : "原单已交回"}</option><option value="unavailable">{english ? "Original unavailable" : "原单无法交回"}</option></select></label><label className="text-xs font-semibold">{english ? "Reason original is unavailable" : "无法交回说明"}<input name="originalDocumentNote" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink" /></label></div>
          <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">{english ? "After completing a non-cash refund transfer, upload the transfer proof to the refund record." : "非现金退款完成转账后，需在该笔退款记录中补传转账凭证。"}</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRefundFormOpen(false)} className="min-h-10 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} type="submit" className="min-h-10 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? (english ? "Recording…" : "正在登记…") : (english ? "Record refund and generate acknowledgement" : "登记退款并生成签收单")}</button></div>
        </form>
      </ActionDialog>
      {inspectionCreateOpen ? <FormalInspectionCreateDialog vehicleId={order.vehicleId} sourceBusinessOrderId={businessOrderId} onClose={() => setInspectionCreateOpen(false)} onCreated={() => { setInspectionCreateOpen(false); refresh(); }} /> : null}
    </div>
  );
}
