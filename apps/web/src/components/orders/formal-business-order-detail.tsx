"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readPerformanceDraft, writePerformanceDraft } from "@/lib/orders/performance-draft-storage";
import { clearRoundDeletionAttempt, readRoundDeletionAttempt, saveRoundDeletionAttempt, type RoundDeletionAttempt } from "@/lib/orders/round-deletion-storage";
import { RoundDeletionAttemptView } from "./round-deletion-attempt";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";
import { FormalInspectionCreateDialog } from "@/components/orders/formal-inspection-create-dialog";
import { InspectionCreationRecoveryPanel, useInspectionCreationRecovery } from "./inspection-creation-recovery";
import { BusinessChargeSection } from "@/components/orders/business-charge-section";
import { BusinessChargePriceFields } from "@/components/orders/business-charge-price-fields";
import { BusinessChargeQuantityField, isWholeChargeQuantity, normalizeChargeQuantity } from "@/components/orders/business-charge-quantity-field";
import { BusinessPendingQuoteNotice } from "@/components/orders/business-pending-quote-notice";
import { BusinessChargeComparison } from "@/components/orders/business-charge-comparison";
import { BusinessOrderInspections } from "@/components/orders/business-order-inspections";
import { FormalBusinessOrderMessages } from "@/components/orders/formal-business-order-messages";
import workspaceStyles from "./business-order-workspace.module.css";
import { FormalBusinessOrderDocumentsWorkspace } from "@/components/orders/formal-business-order-documents-workspace";
import { FormalBusinessOrderAttachmentsWorkspace } from "@/components/orders/formal-business-order-attachments-workspace";
import { FormalBusinessOrderProblemDescription } from "@/components/orders/formal-business-order-problem-description";
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
import { assertPerformanceSaveResponse, assertPerformanceWorkspace } from "@/lib/api/formal-performance-response";
import { ChoiceCards } from "@/components/shared/choice-cards";
import { fetchFormalInspectionReports, type FormalInspectionListItem } from "@/lib/api/formal-inspections";
import { uploadFormalBusinessOrderAttachment } from "@/lib/api/formal-business-order-attachments";
import {
  appendFormalRefundProof,
  appendFormalRefundSignedAcknowledgement,
  cancelFormalHandoffInSameMonth,
  fetchFormalBusinessOrder,
  fetchFormalRepairRounds,
  formalDocumentKindLabel,
  formalBusinessOrderStatusLabel,
  formalGroupedChargeDiscounts,
  formalGroupedChargeNetTotals,
  formalRefundHasSignedAcknowledgement,
  formalRefundNeedsProof,
  formatFormalMoney,
  generateFormalDocument,
  recordFormalPayment,
  recordFormalRefund,
  replaceFormalChargeVersion,
  runFormalRepairRoundAction,
  type FormalAfterSalesRoundDeletionPreview,
  type FormalBusinessOrderDetail,
  type FormalBusinessOrderProblemDescriptionContext,
  type FormalChargeSnapshot,
  type FormalRepairRoundWorkspace,
} from "@/lib/api/formal-business-orders";
import { fetchFormalMasterData, type FormalMasterData } from "@/lib/api/formal-master-data";
import { aiParseFormalChargeEntry, aiTranslateRepair } from "@/lib/ai/auto-repair";
import {
  businessOrderAuditChanges,
  businessOrderAuditReason,
  businessOrderAuditSummary,
} from "@/lib/orders/business-order-audit-presentation";
import { parseChargeEntryInput } from "@/lib/orders/nl-parse";
import { displayedRepairRoundPerformanceMinor } from "@/lib/orders/repair-round-performance";
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

type AfterSalesRoundDeletionReasonCode = "duplicate" | "input_error" | "test_data" | "other";

const AFTER_SALES_DELETION_COUNT_KEYS = [
  "events",
  "workReturns",
  "workReturnAttachments",
  "mileageRecords",
  "intakePhotos",
  "formalHandoffs",
  "formalHandoffCancellations",
  "problemVersions",
  "inspectionReports",
  "documentSnapshots",
] as const satisfies ReadonlyArray<keyof FormalAfterSalesRoundDeletionPreview["counts"]>;

const AFTER_SALES_DELETION_COUNT_LABELS: Record<
  (typeof AFTER_SALES_DELETION_COUNT_KEYS)[number],
  { zh: string; en: string }
> = {
  events: { zh: "维修操作记录", en: "Repair activity" },
  workReturns: { zh: "维修回单", en: "Work returns" },
  workReturnAttachments: { zh: "回单附件", en: "Work-return attachments" },
  mileageRecords: { zh: "里程记录", en: "Mileage records" },
  intakePhotos: { zh: "接车照片", en: "Intake photos" },
  formalHandoffs: { zh: "正式交单", en: "Formal handoffs" },
  formalHandoffCancellations: { zh: "交单作废记录", en: "Handoff cancellations" },
  problemVersions: { zh: "问题描述版本", en: "Problem-description versions" },
  inspectionReports: { zh: "检查结果", en: "Inspection reports" },
  documentSnapshots: { zh: "正式单据快照", en: "Document snapshots" },
};

const AFTER_SALES_DELETION_BLOCKER_LABELS_EN: Record<string, string> = {
  BUSINESS_ORDER_VOIDED: "This Business Order is voided. A repair round cannot be deleted separately from a voided record.",
  PREVIOUS_ROUND_NOT_FORMALLY_HANDED_OFF: "The preceding repair round is not formally handed off.",
  PREVIOUS_ROUND_HAS_NO_ACTIVE_HANDOFF: "The preceding repair round has no active formal handoff.",
  ACTIVE_FORMAL_HANDOFF_EXISTS: "This round still has an active formal handoff.",
  INSPECTION_REPORTS_EXIST: "Handle the linked inspection reports before deleting this round.",
  DOCUMENT_SNAPSHOTS_EXIST: "This round has immutable formal documents. Keep the round and create a correction record instead.",
};

function emptyProblemDescriptionContext(confirmedAt: string): FormalBusinessOrderProblemDescriptionContext {
  return {
    original: {
      contentZh: null,
      contentEn: null,
      sourceType: "creation",
      sourceReferenceId: null,
      confirmedBy: 0,
      confirmedByName: "—",
      confirmedAt,
    },
    current: null,
    businessOrderHistory: [],
    currentRound: null,
    currentRoundHistory: [],
  };
}

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
  pendingQuote: boolean;
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

function performanceAdjustmentUnavailableLabel(
  reason: "cancelled" | "closed_month" | null,
  language: UiLanguage,
) {
  if (reason === "cancelled") {
    return language === "en"
      ? "This handoff has already been cancelled. Adjust the active replacement instead."
      : "这次交单已经取消，请调整当前有效的更正记录";
  }
  if (reason === "closed_month") {
    return language === "en"
      ? "This Jamaica month is closed, so the performance value can no longer be adjusted."
      : "已过当前牙买加月份，绩效已结账，不能再调整";
  }
  return null;
}

function RepairHistoryDialog({
  rounds,
  masterData,
  language,
  canAdjustPerformance,
  onAdjustPerformance,
  onClose,
}: {
  rounds: FormalRepairRoundWorkspace;
  masterData: FormalMasterData;
  language: UiLanguage;
  canAdjustPerformance: boolean;
  onAdjustPerformance: (target: {
    handoffId: number;
    roundId: number;
    roundNo: number;
    roundVersion: number;
    performanceMinor: number;
  }) => void;
  onClose?: () => void;
}) {
  const english = language === "en";
  const teamName = (teamId: number | null) => {
    if (!teamId) return null;
    return masterData.teams.find((team) => team.id === teamId)?.name
      ?? (english ? `Repair team #${teamId}` : `维修班组 #${teamId}`);
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
              {handoff && canAdjustPerformance ? <div className="mt-3 flex justify-end border-t border-line pt-3">{handoff.performanceAdjustmentAllowed !== false
                ? <button type="button" aria-label={english ? `Adjust performance for repair round ${round.roundNo}` : `调整第 ${round.roundNo} 轮绩效值`} onClick={() => onAdjustPerformance({ handoffId: handoff.id, roundId: round.id, roundNo: round.roundNo, roundVersion: round.version, performanceMinor: handoff.performanceMinor })} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary">{english ? "Adjust performance" : "调整绩效值"}</button>
                : <p className="text-right text-xs font-semibold text-ink-soft">{performanceAdjustmentUnavailableLabel(handoff.performanceAdjustmentUnavailableReason, language)}</p>}</div> : null}
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
              const reason = businessOrderAuditReason(event.reason, language);
              return <li key={event.id} className="rounded-xl border border-line p-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-[145px_150px_minmax(0,1fr)]">
                  <span><small className="block text-ink-soft">{english ? "Time" : "时间"}</small><time className="font-semibold">{formatDateTime(event.occurredAt)}</time></span>
                  <span><small className="block text-ink-soft">{english ? "Operator" : "操作人"}</small><strong className="block">{actor}</strong></span>
                  <span><small className="block text-ink-soft">{english ? "Action and result" : "做了什么，结果如何"}</small><strong className="block">{summary}</strong>{reason ? <small className="mt-1 block text-ink-soft">{english ? "Reason" : "原因"}: {reason}</small> : null}</span>
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
    quantity: normalizeChargeQuantity(item.quantity),
    unitPrice: item.pendingQuote ? "" : moneyText(item.unitPriceMinor),
    pendingQuote: item.pendingQuote === true,
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

const ChargeSection = BusinessChargeSection;

export function FormalBusinessOrderDetailView({ businessOrderId }: { businessOrderId: number }) {
  return <BusinessOrderDetailContent key={businessOrderId} businessOrderId={businessOrderId} />;
}

function BusinessOrderDetailContent({ businessOrderId }: { businessOrderId: number }) {
  const { language } = useI18n();
  const english = language === "en";
  const pathname = usePathname();
  const router = useRouter();
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
  const [paperReturnOpen, setPaperReturnOpen] = useState(false);
  const [returnReviewOpen, setReturnReviewOpen] = useState(false);
  const [rejectReturnOpen, setRejectReturnOpen] = useState(false);
  const [formalHandoffOpen, setFormalHandoffOpen] = useState(false);
  const [performanceEditTarget, setPerformanceEditTarget] = useState<{
    roundId: number;
    roundNo: number;
    roundVersion: number;
    performanceMinor: number;
    handoffId: number | null;
  } | null>(null);
  const [performanceEditError, setPerformanceEditError] = useState<string | null>(null);
  const [performanceEditorOpen, setPerformanceEditorOpen] = useState(false);
  const [performanceValueDraft, setPerformanceValueDraft] = useState("");
  const [performanceReasonDraft, setPerformanceReasonDraft] = useState("");
  const [performanceSaving, setPerformanceSaving] = useState(false);
  const [performanceChecking, setPerformanceChecking] = useState(false);
  const performanceInFlight = useRef(false);
  const performanceCheckGeneration = useRef(0);
  const performanceMounted = useRef(true);
  const performanceScopeGeneration = useRef(0);
  const performanceRecoveryAccount = useRef<number | null>(null);
  const [performanceStorageAvailable, setPerformanceStorageAvailable] = useState(true);
  const [performanceCleanupPending, setPerformanceCleanupPending] = useState<"saved" | "discarded" | null>(null);
  useEffect(() => {
    performanceMounted.current = true;
    return () => { performanceMounted.current = false; performanceCheckGeneration.current += 1; performanceScopeGeneration.current += 1; };
  }, []);
  useEffect(() => {
    if (!data || !performanceEditTarget || performanceRecoveryAccount.current !== data.currentAccountId || !data.capabilities.canWrite) return;
    setPerformanceStorageAvailable(writePerformanceDraft(data.currentAccountId, businessOrderId, {
      version: 1, accountId: data.currentAccountId, businessOrderId, updatedAt: Date.now(),
      target: performanceEditTarget, value: performanceValueDraft, reason: performanceReasonDraft,
      unconfirmed: performanceSaving || Boolean(performanceEditError),
    }));
  }, [data, businessOrderId, performanceEditTarget, performanceValueDraft, performanceReasonDraft, performanceSaving, performanceEditError]);
  const closePerformanceEditor = useCallback(() => {
    performanceCheckGeneration.current += 1;
    setPerformanceChecking(false);
    setPerformanceEditorOpen(false);
  }, []);
  const openPerformanceEditor = (target: NonNullable<typeof performanceEditTarget>) => {
    // Keep the existing adjustment attached to its original round until saved or discarded.
    if (!performanceEditTarget) {
      setPerformanceCleanupPending(null);
      setPerformanceEditTarget(target);
      setPerformanceValueDraft(String(target.performanceMinor / 100));
      setPerformanceReasonDraft("");
      setPerformanceEditError(null);
    }
    setPerformanceEditorOpen(true);
  };
  const clearPerformanceRecovery = (outcome: "saved" | "discarded") => {
    if (!data) return;
    const cleared = writePerformanceDraft(data.currentAccountId, businessOrderId, null);
    setPerformanceStorageAvailable(cleared);
    setPerformanceCleanupPending(cleared ? null : outcome);
  };
  const discardPerformanceDraft = () => {
    clearPerformanceRecovery("discarded");
    setPerformanceEditTarget(null);
    setPerformanceEditError(null);
    closePerformanceEditor();
  };
  const [financeHistoryOpen, setFinanceHistoryOpen] = useState(false);
  const [inspectionCreateOpen, setInspectionCreateOpen] = useState(false);
  const inspectionCreationRecovery = useInspectionCreationRecovery(data?.currentAccountId, businessOrderId);
  const [afterSalesOpen, setAfterSalesOpen] = useState(false);
  const [afterSalesDeletionOpen, setAfterSalesDeletionOpen] = useState(false);
  const [afterSalesDeletionReason, setAfterSalesDeletionReason] = useState<AfterSalesRoundDeletionReasonCode | "">("");
  const [afterSalesDeletionNote, setAfterSalesDeletionNote] = useState("");
  const [afterSalesDeletionConfirmation, setAfterSalesDeletionConfirmation] = useState("");
  const [afterSalesDeletionError, setAfterSalesDeletionError] = useState<string | null>(null);
  const [afterSalesDeletionChecking, setAfterSalesDeletionChecking] = useState(false);
  const [afterSalesDeletionCheckFailed, setAfterSalesDeletionCheckFailed] = useState(false);
  const afterSalesDeletionCheckRef = useRef({ generation: 0, pending: false });
  const afterSalesDeletionRequestIdRef = useRef<string | null>(null);
  const [roundDeletionAttempt, setRoundDeletionAttempt] = useState<RoundDeletionAttempt | null>(null);
  const [roundDeletionStorageAvailable, setRoundDeletionStorageAvailable] = useState(true);
  const roundDeletionInFlight = useRef(false);
  const [cancelHandoffDraft, setCancelHandoffDraft] = useState<{
    handoffId: number;
    reason: string;
  } | null>(null);
  const cancelHandoffInFlight = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [relatedInspectionReports, setRelatedInspectionReports] = useState<FormalInspectionListItem[]>([]);
  const [inspectionLoading, setInspectionLoading] = useState(true);
  const [inspectionError, setInspectionError] = useState(false);
  const [inspectionPage, setInspectionPage] = useState(1);
  const [inspectionPageCount, setInspectionPageCount] = useState(1);
  const [inspectionTotal, setInspectionTotal] = useState(0);
  const [inspectionRetryKey, setInspectionRetryKey] = useState(0);
  const [chargeEditing, setChargeEditing] = useState(false);
  const [naturalLanguageOpen, setNaturalLanguageOpen] = useState(false);
  const [naturalLanguageText, setNaturalLanguageText] = useState("");
  const [chargeDraft, setChargeDraft] = useState<ChargeDraftItem[]>([]);
  const [chargeBaseline, setChargeBaseline] = useState<{ version: number; totals: FormalChargeSnapshot["totals"] } | null>(null);
  const [chargeComparisonOpen, setChargeComparisonOpen] = useState(false);
  const [chargeNoteDraft, setChargeNoteDraft] = useState<ChargeDraftNote[]>([]);
  const [chargeActionError, setChargeActionError] = useState<string | null>(null);
  const [chargeActionNotice, setChargeActionNotice] = useState<string | null>(null);
  const chargeEditFormRef = useRef<HTMLFormElement | null>(null);
  const chargeSubmitAuthorizedRef = useRef(false);
  const chargeSaveInFlight = useRef(false);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const translationRequest = useRef(0);
  const [naturalLanguageBusy, setNaturalLanguageBusy] = useState(false);
  const naturalLanguageRequest = useRef(0);
  const [naturalLanguageError, setNaturalLanguageError] = useState<string | null>(null);
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
          if (performanceRecoveryAccount.current !== detail.currentAccountId) {
            performanceScopeGeneration.current += 1;
            performanceCheckGeneration.current += 1;
            if (performanceInFlight.current) setBusy(false);
            if (roundDeletionInFlight.current) setBusy(false);
            roundDeletionInFlight.current = false;
            const deletionRecovery = readRoundDeletionAttempt(detail.currentAccountId, businessOrderId);
            setRoundDeletionAttempt(detail.capabilities.canWrite ? deletionRecovery.attempt : null);
            setRoundDeletionStorageAvailable(deletionRecovery.available);
            setAfterSalesDeletionOpen(false);
            setAfterSalesDeletionChecking(false);
            setAfterSalesDeletionError(null);
            afterSalesDeletionRequestIdRef.current = null;
            afterSalesDeletionCheckRef.current = { generation: afterSalesDeletionCheckRef.current.generation + 1, pending: false };
            performanceInFlight.current = false;
            setPerformanceSaving(false);
            setPerformanceChecking(false);
            setHistoryOpen(false);
            setNotice(null);
            setPerformanceCleanupPending(null);
            performanceRecoveryAccount.current = detail.currentAccountId;
            const recovered = detail.capabilities.canWrite ? readPerformanceDraft(detail.currentAccountId, businessOrderId) : null;
            setPerformanceEditTarget(recovered?.target ?? null);
            setPerformanceValueDraft(recovered?.value ?? "");
            setPerformanceReasonDraft(recovered?.reason ?? "");
            setPerformanceEditorOpen(false);
            setPerformanceEditError(recovered?.unconfirmed
              ? (english ? "The previous submission result is unconfirmed. Check the latest performance records before retrying." : "上次提交结果尚未确认，请先核对最新绩效记录，再决定是否重试。") : null);
          }
          setData(detail);
          setRounds(roundWorkspace);
          setMasterData(formalMasterData);
          setError(null);
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
    void fetchFormalInspectionReports({ sourceBusinessOrderId: businessOrderId, page: inspectionPage })
      .then((result) => {
        if (active && inspectionLoadGeneration.current === generation) {
          setRelatedInspectionReports(result.items);
          setInspectionTotal(result.total);
          setInspectionPageCount(result.pageCount);
          setInspectionLoading(false);
        }
      })
      .catch(() => {
        if (active && inspectionLoadGeneration.current === generation) {
          setInspectionError(true);
          setInspectionLoading(false);
        }
      });
    return () => { active = false; };
  }, [businessOrderId, reloadKey, inspectionPage, inspectionRetryKey]);

  const refresh = useCallback(() => {
    loadGeneration.current += 1;
    inspectionLoadGeneration.current += 1;
    setInspectionLoading(true);
    setInspectionError(false);
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
      reason: businessOrderAuditReason(event.reason, language),
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
      if (document.generationError) {
        setError(english ? `Document ${document.documentNo} was saved, but its PDF needs recovery. Use “Regenerate file” in Documents.` : `单据 ${document.documentNo} 已保存。${document.generationError} 请在单据中点击“重新生成文件”。`);
      } else {
        const label = document.kind === "customer_copy" ? (english ? "office + customer copies" : "费用确认单（办公室联＋客户联）") : formalDocumentKindLabel(document.kind, language);
        setNotice(english ? `Generated ${label}: ${document.documentNo}` : `已生成 ${label}：${document.documentNo}`);
      }
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
      return result;
    } catch (caught) {
      setError(english ? "Could not update the repair round" : (caught instanceof Error ? caught.message : "维修轮次操作失败"));
      return null;
    } finally { setBusy(false); }
  };

  const submitPaperReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rounds || !data) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("paperReturn");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const attachmentIds: number[] = [];
      if (file instanceof File && file.size > 0) {
        const attachment = await uploadFormalBusinessOrderAttachment(businessOrderId, {
          file,
          category: "other",
          caption: english ? "Paper work return" : "纸质维修回单",
        });
        attachmentIds.push(attachment.id);
      }
      const staffValue = String(fields.get("actualStaffMemberId") ?? "").trim();
      const itemResults = data.charges.items.map((item) => ({
        chargeItemId: String(item.id),
        category: item.kind,
        labelZh: item.nameZh,
        labelEn: item.nameEn,
        result: fields.get(`item-${item.id}`) === "on" ? "completed" : "not_completed",
      }));
      const result = await runFormalRepairRoundAction(businessOrderId, {
        action: "record_paper_return_and_formal_handoff",
        repairRoundVersion: rounds.current.version,
        actualStaffMemberId: staffValue ? Number(staffValue) : undefined,
        attachmentIds,
        workSummary: String(fields.get("workSummary") ?? ""),
        exceptionSummary: String(fields.get("exceptionSummary") ?? ""),
        itemResults,
        performanceValue: String(fields.get("performanceValue") ?? ""),
      });
      setRounds(result);
      setPaperReturnOpen(false);
      form.reset();
      setNotice(english ? "Paper work return confirmed and formally handed off." : "纸质回单已确认，本轮已正式交单。");
      refresh();
    } catch (caught) {
      setError(english ? "Could not record the paper work return" : (caught instanceof Error ? caught.message : "纸质回单登记失败"));
    } finally {
      setBusy(false);
    }
  };

  const approveLatestReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rounds?.current.latestWorkReturnId) return;
    const fields = new FormData(event.currentTarget);
    const result = await submitRoundAction({
      action: "approve_and_formal_handoff",
      repairRoundVersion: rounds.current.version,
      workReturnId: rounds.current.latestWorkReturnId,
      performanceValue: String(fields.get("performanceValue") ?? ""),
    }, english ? "Work return approved and formally handed off." : "维修回单已审核通过，本轮已正式交单。");
    if (result) setReturnReviewOpen(false);
  };

  const rejectLatestReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rounds?.current.latestWorkReturnId) return;
    const fields = new FormData(event.currentTarget);
    const result = await submitRoundAction({
      action: "reject_return",
      repairRoundVersion: rounds.current.version,
      workReturnId: rounds.current.latestWorkReturnId,
      reason: String(fields.get("reason") ?? ""),
    }, english ? "Work return sent back to the mechanic with the reason recorded." : "维修回单已退回维修工，退回原因已记录。");
    if (result) {
      setRejectReturnOpen(false);
      setReturnReviewOpen(false);
    }
  };

  const submitFormalHandoff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rounds) return;
    const fields = new FormData(event.currentTarget);
    const result = await submitRoundAction({
      action: "formal_handoff",
      repairRoundVersion: rounds.current.version,
      performanceValue: String(fields.get("performanceValue") ?? ""),
    }, english ? "Round formally handed off and performance recorded" : "本轮已正式交单，绩效事实已落地");
    if (result) setFormalHandoffOpen(false);
  };

  const beginChargeEditing = () => {
    if (!data) return;
    naturalLanguageRequest.current += 1;
    setNaturalLanguageBusy(false);
    translationRequest.current += 1;
    setTranslatingKey(null);
    setChargeBaseline({ version: data.order.version, totals: { ...data.charges.totals } });
    setChargeDraft(chargeDraftFromSnapshot(data.charges));
    setChargeNoteDraft(chargeNoteDraftFromSnapshot(data.charges));
    setChargeActionError(null);
    setChargeActionNotice(null);
    setChargeEditing(true);
  };

  const cancelChargeEditing = () => {
    if (busy || chargeSaveInFlight.current) return;
    naturalLanguageRequest.current += 1;
    setNaturalLanguageBusy(false);
    translationRequest.current += 1;
    setTranslatingKey(null);
    setChargeEditing(false);
    setChargeDraft([]);
    setChargeNoteDraft([]);
    setChargeActionError(null);
    setChargeActionNotice(null);
    setChargeComparisonOpen(false);
  };

  const cancelChargeTranslation = () => {
    translationRequest.current += 1;
    setTranslatingKey(null);
    setChargeActionNotice(english ? "Translation cancelled. Your current input is kept." : "已取消翻译，当前输入保留。");
  };

  const stopNaturalLanguage = (discard = false) => {
    naturalLanguageRequest.current += 1;
    setNaturalLanguageBusy(false);
    setNaturalLanguageError(null);
    if (discard) {
      setNaturalLanguageOpen(false);
      setNaturalLanguageText("");
    }
  };

  const updateChargeDraft = (key: string, field: keyof ChargeDraftItem, value: string | number | boolean) => {
    setChargeDraft((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  };

  const chooseComparedCharges = (latest: FormalBusinessOrderDetail, keepMine: boolean) => {
    if (!data || !latest.capabilities.canWrite || latest.order.voided || latest.order.id !== businessOrderId) return;
    setChargeBaseline({ version: latest.order.version, totals: { ...(keepMine ? chargeBaseline?.totals ?? data.charges.totals : latest.charges.totals) } });
    if (!keepMine) {
      setChargeDraft(chargeDraftFromSnapshot(latest.charges));
      setChargeNoteDraft(chargeNoteDraftFromSnapshot(latest.charges));
    }
    setChargeComparisonOpen(false);
    setError(null);
    setChargeActionError(null);
    setChargeActionNotice(english ? "Comparison complete. Review the draft and save when ready." : "已完成版本核对。请检查草稿，确认后再保存。");
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
      unitPrice: "",
      pendingQuote: true,
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
    const request = ++translationRequest.current;
    setTranslatingKey(`item-${key}`);
    setChargeActionError(null);
    setChargeActionNotice(null);
    try {
      const [nameEn, descriptionEn] = await Promise.all([
        item.nameZh.trim() ? aiTranslateRepair(item.nameZh) : Promise.resolve(null),
        item.descriptionZh.trim() ? aiTranslateRepair(item.descriptionZh) : Promise.resolve(null),
      ]);
      if (request !== translationRequest.current) return;
      if (!nameEn && !descriptionEn) {
        setChargeActionError(english ? "AI translation returned no result. Check the AI service in Settings and try again." : "AI 翻译没有返回结果，请到系统设置检查 AI 服务后重试");
        return;
      }
      setChargeDraft((current) => current.map((candidate) => candidate.key === key ? {
        ...candidate,
        nameEn: candidate.nameZh === item.nameZh && candidate.nameEn === item.nameEn ? nameEn ?? candidate.nameEn : candidate.nameEn,
        descriptionEn: candidate.descriptionZh === item.descriptionZh && candidate.descriptionEn === item.descriptionEn ? descriptionEn ?? candidate.descriptionEn : candidate.descriptionEn,
      } : candidate));
      setChargeActionNotice(english ? "Translation finished. Fields edited during translation keep your input. Review before saving." : "翻译处理完成；期间改动的字段保留人工输入，请核对后保存。");
    } catch (caught) {
      if (request === translationRequest.current) setChargeActionError(english ? "Translation failed. Your draft is kept; retry translation or enter the text manually." : (caught instanceof Error ? `翻译失败：${caught.message}。草稿已保留，可重试或手动填写。` : "翻译失败，草稿已保留，可重试或手动填写。"));
    } finally {
      if (request === translationRequest.current) setTranslatingKey(null);
    }
  };

  const translateChargeNoteDraft = async (key: string) => {
    const note = chargeNoteDraft.find((candidate) => candidate.key === key);
    if (!note?.contentZh.trim()) {
      setChargeActionError(english ? "Enter the Chinese note before translating" : "请先填写要翻译的中文备注");
      return;
    }
    const request = ++translationRequest.current;
    setTranslatingKey(`note-${key}`);
    setChargeActionError(null);
    setChargeActionNotice(null);
    try {
      const contentEn = await aiTranslateRepair(note.contentZh);
      if (request !== translationRequest.current) return;
      if (!contentEn) {
        setChargeActionError(english ? "AI translation returned no result. Check the AI service in Settings and try again." : "AI 翻译没有返回结果，请到系统设置检查 AI 服务后重试");
        return;
      }
      setChargeNoteDraft((current) => current.map((candidate) => candidate.key === key && candidate.contentZh === note.contentZh && candidate.contentEn === note.contentEn
        ? { ...candidate, contentEn }
        : candidate));
      setChargeActionNotice(english ? "Translation finished. Notes edited during translation keep your input. Review before saving." : "翻译处理完成；期间改动的备注保留人工输入，请核对后保存。");
    } catch (caught) {
      if (request === translationRequest.current) setChargeActionError(english ? "Translation failed. Your draft is kept; retry translation or enter the text manually." : (caught instanceof Error ? `翻译失败：${caught.message}。草稿已保留，可重试或手动填写。` : "翻译失败，草稿已保留，可重试或手动填写。"));
    } finally {
      if (request === translationRequest.current) setTranslatingKey(null);
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

  const openAfterSalesRoundDeletion = () => {
    if (roundDeletionAttempt?.accountId === data?.currentAccountId) {
      setAfterSalesDeletionOpen(true);
      return;
    }
    if (!rounds?.afterSalesRoundDeletion) {
      setError(english ? "The deletion check is not available. Refresh and try again." : "删除检查尚未就绪，请刷新后重试");
      return;
    }
    afterSalesDeletionCheckRef.current = { generation: afterSalesDeletionCheckRef.current.generation + 1, pending: false };
    setAfterSalesDeletionChecking(false);
    setAfterSalesDeletionCheckFailed(false);
    afterSalesDeletionRequestIdRef.current = `delete-after-sales-${crypto.randomUUID()}`;
    setAfterSalesDeletionReason("");
    setAfterSalesDeletionNote("");
    setAfterSalesDeletionConfirmation("");
    setAfterSalesDeletionError(null);
    setError(null);
    setAfterSalesDeletionOpen(true);
  };

  const closeAfterSalesRoundDeletion = () => {
    if (busy && !roundDeletionInFlight.current) return;
    afterSalesDeletionCheckRef.current = { generation: afterSalesDeletionCheckRef.current.generation + 1, pending: false };
    setAfterSalesDeletionChecking(false);
    setAfterSalesDeletionOpen(false);
    setAfterSalesDeletionError(null);
    afterSalesDeletionRequestIdRef.current = null;
  };

  const recheckAfterSalesRoundDeletion = async () => {
    if (!rounds || busy || afterSalesDeletionCheckRef.current.pending) return;
    const roundId = rounds.current.id;
    const generation = ++afterSalesDeletionCheckRef.current.generation;
    afterSalesDeletionCheckRef.current.pending = true;
    setAfterSalesDeletionChecking(true);
    setAfterSalesDeletionCheckFailed(true);
    setAfterSalesDeletionConfirmation("");
    setAfterSalesDeletionError(null);
    try {
      const latest = await fetchFormalRepairRounds(businessOrderId);
      if (generation !== afterSalesDeletionCheckRef.current.generation) return;
      if (latest.current.id !== roundId || !latest.afterSalesRoundDeletion) {
        throw new Error(english ? "The current repair round has changed. Close this window and refresh the order before checking again." : "当前维修轮次已变化，请关闭窗口并刷新业务单后重新检查。");
      }
      setRounds(latest);
      setAfterSalesDeletionCheckFailed(false);
      afterSalesDeletionRequestIdRef.current = `delete-after-sales-${crypto.randomUUID()}`;
    } catch (caught) {
      if (generation !== afterSalesDeletionCheckRef.current.generation) return;
      setAfterSalesDeletionError(caught instanceof Error ? caught.message : (english ? "Could not check linked records. Try again." : "关联记录检查失败，请重试。"));
    } finally {
      if (generation === afterSalesDeletionCheckRef.current.generation) {
        afterSalesDeletionCheckRef.current.pending = false;
        setAfterSalesDeletionChecking(false);
      }
    }
  };

  const executeRoundDeletionAttempt = async (attempt: RoundDeletionAttempt) => {
    if (!data?.capabilities.canWrite || attempt.accountId !== data.currentAccountId || attempt.businessOrderId !== businessOrderId || roundDeletionInFlight.current || afterSalesDeletionCheckRef.current.pending || busy) return;
    const scope = performanceScopeGeneration.current;
    const currentScope = () => performanceMounted.current && performanceScopeGeneration.current === scope;
    roundDeletionInFlight.current = true;
    setBusy(true);
    const pending: RoundDeletionAttempt = { ...attempt, status: "pending", error: undefined };
    const initiallyStored = saveRoundDeletionAttempt(pending);
    setRoundDeletionStorageAvailable(initiallyStored);
    setRoundDeletionAttempt(pending);
    setAfterSalesDeletionError(null);
    try {
      const response = await runFormalRepairRoundAction(businessOrderId, attempt.input);
      try { assertPerformanceWorkspace(response, businessOrderId, english); }
      catch { throw new Error(english ? "The deletion response could not be verified. Check the original request before retrying." : "删除响应无法核实，原请求已保留，请核对后再重试。"); }
      const result = response.result as { cancelled?: unknown; deletedRoundNo?: unknown; restoredRoundNo?: unknown } | null;
      if (result?.cancelled !== true || result.deletedRoundNo !== attempt.roundNo || result.restoredRoundNo !== attempt.roundNo - 1
          || response.current.id === attempt.roundId || response.history.some(round => round.id === attempt.roundId)) {
        throw new Error(english ? "The deletion response does not match the original round. Verify before retrying." : "删除回执与原轮次不一致，结果尚未确认，请核对后再重试。");
      }
      const completed: RoundDeletionAttempt = { ...attempt, status: "completed", error: undefined };
      const stored = saveRoundDeletionAttempt(completed, currentScope() ? initiallyStored : true);
      if (!currentScope()) return;
      setRoundDeletionAttempt(completed);
      setRoundDeletionStorageAvailable(stored);
      setRounds(response);
      setAfterSalesOpen(false);
      setNotice(english ? "The original repair-round deletion is confirmed." : "原维修轮次删除已确认完成");
      refresh();
    } catch (caught) {
      const unconfirmed: RoundDeletionAttempt = { ...attempt, status: "unconfirmed", error: (caught instanceof Error ? caught.message : "删除结果尚未确认，请核对后再重试。").slice(0, 4000) };
      const stored = saveRoundDeletionAttempt(unconfirmed, currentScope() ? initiallyStored : true);
      if (currentScope()) {
        setRoundDeletionAttempt(unconfirmed);
        setRoundDeletionStorageAvailable(stored);
      }
    } finally {
      if (currentScope()) { roundDeletionInFlight.current = false; setBusy(false); }
    }
  };

  const checkRoundDeletionHistory = async () => {
    if (!roundDeletionAttempt || busy || afterSalesDeletionCheckRef.current.pending) return;
    const generation = ++afterSalesDeletionCheckRef.current.generation;
    afterSalesDeletionCheckRef.current.pending = true;
    setAfterSalesDeletionChecking(true);
    try {
      const latest = await fetchFormalRepairRounds(businessOrderId);
      if (!performanceMounted.current || generation !== afterSalesDeletionCheckRef.current.generation) return;
      try { assertPerformanceWorkspace(latest, businessOrderId, english); }
      catch { throw new Error(english ? "The latest repair history could not be verified. Try again." : "最新维修历史无法核实，请重新读取。"); }
      setRounds(latest);
      setAfterSalesDeletionOpen(false);
      setHistoryOpen(true);
    } catch (caught) {
      if (performanceMounted.current && generation === afterSalesDeletionCheckRef.current.generation) {
        setRoundDeletionAttempt(current => current ? { ...current, error: caught instanceof Error ? caught.message : "维修历史读取失败，请重试。" } : current);
      }
    } finally {
      if (performanceMounted.current && generation === afterSalesDeletionCheckRef.current.generation) {
        afterSalesDeletionCheckRef.current.pending = false;
        setAfterSalesDeletionChecking(false);
      }
    }
  };

  const submitAfterSalesRoundDeletion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const preview = rounds?.afterSalesRoundDeletion;
    if (!data?.capabilities.canWrite || !rounds || !preview || !preview.eligible || roundDeletionAttempt || afterSalesDeletionReason === "" || afterSalesDeletionCheckRef.current.pending || afterSalesDeletionCheckFailed || busy) return;
    const confirmationRecordNo = afterSalesDeletionConfirmation.trim();
    if (confirmationRecordNo !== preview.recordNo) return;
    const requestId = afterSalesDeletionRequestIdRef.current
      ?? `delete-after-sales-${crypto.randomUUID()}`;
    afterSalesDeletionRequestIdRef.current = requestId;
    setError(null);
    setNotice(null);
    setAfterSalesDeletionError(null);
    await executeRoundDeletionAttempt({
      accountId: data.currentAccountId, businessOrderId, roundId: preview.repairRoundId, roundNo: preview.roundNo, createdAt: Date.now(), status: "pending",
      input: {
        action: "delete_invalid_after_sales",
        repairRoundVersion: rounds.current.version,
        previewFingerprint: preview.previewFingerprint,
        reasonCode: afterSalesDeletionReason,
        reasonNote: afterSalesDeletionNote.trim(),
        confirmationRecordNo,
        requestId,
      },
    });
  };

  const stageNaturalLanguage = async () => {
    if (!data || !naturalLanguageText.trim() || naturalLanguageBusy || busy) return;
    const request = ++naturalLanguageRequest.current;
    setNaturalLanguageBusy(true);
    setNaturalLanguageError(null);
    setChargeActionError(null);
    setChargeActionNotice(null);
    try {
      const aiParsed = await aiParseFormalChargeEntry(naturalLanguageText);
      if (request !== naturalLanguageRequest.current) return;
      const parsed = aiParsed ?? parseChargeEntryInput(naturalLanguageText);
      if (!parsed.items.length && !parsed.notes.length) {
        setNaturalLanguageError(english ? "No charge items or notes were identified. Add more detail and retry, or enter them manually." : "未识别到收费项目或备注，请补充原文后重试，也可手动录入。");
        return;
      }
      const staged = parsed.items.map((item, index): ChargeDraftItem => {
        const kind: ChargeDraftItem["kind"] = item.category === "parts" ? "part" : "labor";
        const preferredUnit = data.chargeUnits.find((unit) =>
          (kind === "labor" && unit.labelZh.includes("工时"))
          || (kind === "part" && (unit.labelZh.includes("件") || unit.labelZh.includes("个"))),
        ) ?? data.chargeUnits[0];
        if (!preferredUnit) throw new Error(english ? "Add charge units in Dictionaries, then retry." : "请先在基础字典配置收费单位，再重试。");
        return {
          key: `natural-${Date.now()}-${index}`, kind,
          nameZh: item.descZh, nameEn: item.descEn,
          descriptionZh: item.remarkZh ?? "", descriptionEn: item.remarkEn ?? "",
          unitItemId: preferredUnit.id, quantity: String(item.quantity),
          unitPrice: item.pendingQuote ? "" : String(item.unitPriceJmd ?? 0), itemDiscount: String(item.discountJmd ?? 0),
          pendingQuote: item.pendingQuote === true,
        };
      });
      if (!chargeEditing) setChargeBaseline({ version: data.order.version, totals: { ...data.charges.totals } });
      setChargeDraft((current) => [...(chargeEditing ? current : chargeDraftFromSnapshot(data.charges)), ...staged]);
      const stagedNotes = parsed.notes.map((note, index): ChargeDraftNote => ({
        key: `natural-note-${Date.now()}-${index}`, kind: note.kind,
        contentZh: note.contentZh, contentEn: note.contentEn,
      }));
      setChargeNoteDraft((current) => [...(chargeEditing ? current : chargeNoteDraftFromSnapshot(data.charges)), ...stagedNotes]);
      setChargeEditing(true);
      setNaturalLanguageOpen(false);
      setNaturalLanguageText("");
      setChargeActionNotice(english ? `${aiParsed ? "AI" : "Local rules"} prepared ${staged.length} charge items and ${stagedNotes.length} note drafts. Review them before saving.` : `${aiParsed ? "AI" : "本地规则"}已整理 ${staged.length} 个收费项目和 ${stagedNotes.length} 条备注草稿，请核对后保存`);
    } catch (caught) {
      if (request === naturalLanguageRequest.current) setNaturalLanguageError(caught instanceof Error ? caught.message : (english ? "Preparation failed. Your input is kept; retry or enter items manually." : "整理失败，原文已保留，可重试或手动录入。"));
    } finally {
      if (request === naturalLanguageRequest.current) setNaturalLanguageBusy(false);
    }
  };

  const submitCharges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chargeSubmitAuthorizedRef.current) return;
    chargeSubmitAuthorizedRef.current = false;
    if (!data || busy || chargeSaveInFlight.current || translatingKey !== null || naturalLanguageBusy) return;
    if (chargeDraft.some((item) => !isWholeChargeQuantity(item.quantity))) {
      setChargeActionError(english ? "Quantity must be a positive whole number. Check the quantity and unit price; your input is kept." : "数量须为正整数，请核对数量与单价；原输入已保留。");
      event.currentTarget.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
      return;
    }
    const fields = new FormData(event.currentTarget);
    chargeSaveInFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setChargeActionError(null);
    setChargeActionNotice(english ? "Saving charges and notes…" : "正在保存收费项目和备注…");
    try {
      await replaceFormalChargeVersion(businessOrderId, {
        expectedBusinessOrderVersion: chargeBaseline?.version ?? data.order.version,
        reason: String(fields.get("reason") ?? ""),
        laborDiscount: moneyText((chargeBaseline?.totals ?? data.charges.totals).laborDiscountMinor),
        partDiscount: moneyText((chargeBaseline?.totals ?? data.charges.totals).partDiscountMinor),
        otherDiscount: moneyText((chargeBaseline?.totals ?? data.charges.totals).otherDiscountMinor),
        wholeOrderDiscount: moneyText((chargeBaseline?.totals ?? data.charges.totals).wholeOrderDiscountMinor),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: chargeDraft.map(({ key: _key, ...item }) => ({ ...item, quantity: normalizeChargeQuantity(item.quantity), unitPrice: item.pendingQuote ? "" : item.unitPrice, itemDiscount: item.pendingQuote ? "0" : item.itemDiscount })),
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
      chargeSaveInFlight.current = false;
      setBusy(false);
    }
  };

  const requestChargeSubmit = () => {
    const form = chargeEditFormRef.current;
    if (!form || busy || chargeSaveInFlight.current || translatingKey !== null || naturalLanguageBusy) return;
    chargeSubmitAuthorizedRef.current = true;
    form.requestSubmit();
    chargeSubmitAuthorizedRef.current = false;
  };

  if (!data && !error) return <div role="status" className="mx-auto mt-6 h-[640px] max-w-[1720px] animate-pulse rounded-2xl bg-layer-2" />;
  if (error && !data) return <div role="alert" className="mx-auto mt-6 flex min-h-[360px] max-w-[1720px] flex-col items-center justify-center rounded-2xl border border-rose-200"><AlertCircle className="text-rose-600" /><p className="mt-2 text-sm font-semibold">{error}</p><button type="button" onClick={refresh} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm"><RefreshCw size={14} />{english ? "Retry" : "重试"}</button></div>;
  if (!data) return null;

  const { order, charges, ledger } = data;
  const pendingQuoteCount = charges.items.filter((item) => item.pendingQuote).length;
  const isFinanciallySettled = ledger.balanceMinor === 0 && pendingQuoteCount === 0;
  const groupedDiscounts = formalGroupedChargeDiscounts(charges);
  const groupedChargeTotals = formalGroupedChargeNetTotals(charges);
  const progressIndex = PROGRESS.findIndex(([status]) => status === order.status);
  const refundById = new Map(data.refunds.map((refund) => [refund.id, refund]));
  const payerMeta = [
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
    ? masterData?.teams.find((team) => team.id === currentHistoricalTeamId)?.name
      ?? (english ? `Repair team #${currentHistoricalTeamId}` : `维修班组 #${currentHistoricalTeamId}`)
    : null;
  const laborSubtotalMinor = charges.items
    .filter((item) => item.kind === "labor")
    .reduce((sum, item) => sum + item.subtotalMinor, 0);
  const currentRoundPerformanceMinor = rounds
    ? displayedRepairRoundPerformanceMinor({
      roundNo: rounds.current.roundNo,
      performanceDraftMinor: rounds.current.performanceDraftMinor,
      laborSubtotalMinor,
    })
    : 0;
  const afterSalesRoundDeletionPreview = rounds?.afterSalesRoundDeletion ?? null;
  const afterSalesRoundDeletionCounts = afterSalesRoundDeletionPreview
    ? AFTER_SALES_DELETION_COUNT_KEYS.flatMap((key) => {
      const count = afterSalesRoundDeletionPreview.counts[key];
      return count > 0 ? [{ key, count }] : [];
    })
    : [];
  const canDeleteAfterSalesRound = Boolean(
    afterSalesRoundDeletionPreview?.eligible
    && afterSalesDeletionReason !== ""
    && (afterSalesDeletionReason !== "other" || afterSalesDeletionNote.trim() !== "")
    && afterSalesDeletionConfirmation.trim() === afterSalesRoundDeletionPreview.recordNo
    && !afterSalesDeletionChecking && !afterSalesDeletionCheckFailed
    && !busy,
  );

  const submitPerformanceDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rounds || !data.capabilities.canWrite || !performanceEditTarget || performanceInFlight.current || busy || performanceChecking) return;
    const originalRound = performanceEditTarget.handoffId === null
      ? rounds.current : rounds.history.find(round => round.id === performanceEditTarget.roundId);
    const originalHandoff = performanceEditTarget.handoffId === null ? null
      : rounds.history.find(round => round.id === performanceEditTarget.roundId)?.formalHandoffs.find(handoff => handoff.id === performanceEditTarget.handoffId);
    if (!originalRound || originalRound.id !== performanceEditTarget.roundId || originalRound.version !== performanceEditTarget.roundVersion
      || (performanceEditTarget.handoffId !== null && (!originalHandoff || originalHandoff.cancelledAt || originalHandoff.performanceAdjustmentAllowed === false))) {
      setPerformanceEditError(english ? "The original repair round or handoff has changed. Check the latest records; keep this draft for reference and start a new adjustment from the correct record." : "原维修轮次或交单已变化，请先核对最新记录；保留这份草稿作参考，再从正确记录重新发起调整。");
      return;
    }
    performanceInFlight.current = true;
    const performanceScope = performanceScopeGeneration.current;
    setPerformanceSaving(true);
    const isHandedOff = performanceEditTarget.handoffId !== null;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPerformanceEditError(null);
    setPerformanceStorageAvailable(writePerformanceDraft(data.currentAccountId, businessOrderId, {
      version: 1, accountId: data.currentAccountId, businessOrderId, updatedAt: Date.now(),
      target: performanceEditTarget, value: performanceValueDraft, reason: performanceReasonDraft, unconfirmed: true,
    }));
    try {
      const result = await runFormalRepairRoundAction(businessOrderId, isHandedOff ? {
        action: "adjust_formal_handoff_performance",
        formalHandoffId: performanceEditTarget.handoffId,
        repairRoundVersion: performanceEditTarget.roundVersion,
        performanceValue: performanceValueDraft,
        reason: performanceReasonDraft,
      } : {
        action: "set_performance_draft",
        repairRoundId: performanceEditTarget.roundId,
        repairRoundVersion: performanceEditTarget.roundVersion,
        performanceValue: performanceValueDraft,
      });
      if (!performanceMounted.current || performanceScope !== performanceScopeGeneration.current) return;
      assertPerformanceSaveResponse(result, { businessOrderId, roundId: performanceEditTarget.roundId, roundVersion: performanceEditTarget.roundVersion, handoffId: performanceEditTarget.handoffId, performanceValue: performanceValueDraft }, english);
      setRounds(result);
      setNotice(isHandedOff
        ? (english ? "Round performance adjusted with the original handoff preserved" : "本轮绩效已调整，原交单事实已保留")
        : (english ? "Round performance value saved" : "本轮绩效值已保存"));
      clearPerformanceRecovery("saved");
      setPerformanceEditTarget(null);
      setPerformanceEditorOpen(false);
      refresh();
    } catch (caught) {
      if (!performanceMounted.current || performanceScope !== performanceScopeGeneration.current) return;
      setPerformanceEditError(english
        ? "Could not update this repair round performance value"
        : (caught instanceof Error ? caught.message : "绩效值调整失败"));
    } finally {
      if (performanceMounted.current && performanceScope === performanceScopeGeneration.current) {
        performanceInFlight.current = false;
        setPerformanceSaving(false);
        setBusy(false);
      }
    }
  };

  const performanceRetentionLabel = performanceStorageAvailable
    ? (english ? "Draft saved in this tab for up to 24 hours. Return with the same account to continue after refreshing. Closing the tab may discard it." : "草稿在当前标签页暂存，最多保留 24 小时；刷新或返回本单后，同一账号可继续。关闭标签页可能丢失。")
    : (english ? "Browser storage is unavailable. Your inputs remain only on this page; copy them before leaving or refreshing." : "浏览器暂存不可用，输入仅保留在本页；离开或刷新前请先复制保存。");

  const checkPerformanceHistory = async () => {
    if (performanceInFlight.current || performanceChecking) return;
    const generation = ++performanceCheckGeneration.current;
    setPerformanceChecking(true);
    try {
      const latest = await fetchFormalRepairRounds(businessOrderId);
      if (generation !== performanceCheckGeneration.current) return;
      assertPerformanceWorkspace(latest, businessOrderId, english);
      setRounds(latest);
      closePerformanceEditor();
      setHistoryOpen(true);
    } catch (caught) {
      if (generation !== performanceCheckGeneration.current) return;
      setPerformanceEditError(caught instanceof Error ? caught.message : (english ? "Could not read the latest performance records. Try again." : "最新绩效记录读取失败，请重试。"));
    } finally {
      if (generation === performanceCheckGeneration.current) setPerformanceChecking(false);
    }
  };

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
    <div data-testid="formal-business-order-detail" className={`formal-business-order-page bg-page text-ink ${workspaceStyles.page}`}>
      <div className={workspaceStyles.layout}>
        <div className="flex shrink-0 items-center gap-3 text-xs"><Link href="/orders/business" className="inline-flex min-h-11 shrink-0 items-center font-semibold text-primary">← {english ? "Orders" : "业务单列表"}</Link><span className="min-w-0 truncate font-mono text-ink-soft">{order.orderNo}</span></div>

        <FormalBusinessOrderTabs
          pathname={pathname}
          searchParams={workspaceSearchParams}
          active={activeWorkspace}
          unreadMessageCount={data.unreadMentionCount}
        />
        <InspectionCreationRecoveryPanel attempts={inspectionCreationRecovery.attempts} storageAvailable={inspectionCreationRecovery.storageAvailable} onDismiss={inspectionCreationRecovery.dismiss} onRestore={(attempt) => { inspectionCreationRecovery.restore(attempt); setInspectionCreateOpen(true); }} />
        {!roundDeletionAttempt && !roundDeletionStorageAvailable && data.capabilities.canWrite ? <p role="alert" className="shrink-0 rounded-xl border border-line bg-card px-3 text-xs text-state-warning-text">{english ? "Round deletion recovery could not be read. Verify any previous submission before starting another." : "维修轮次删除暂存读取失败，请先核对之前的提交结果。"}<button type="button" onClick={() => { const recovered = readRoundDeletionAttempt(data.currentAccountId, businessOrderId); setRoundDeletionAttempt(recovered.attempt); setRoundDeletionStorageAvailable(recovered.available); }} className="ml-2 min-h-11 underline">{english ? "Reload round deletion recovery" : "重新读取轮次删除暂存"}</button></p> : null}
        {roundDeletionAttempt && roundDeletionAttempt.accountId === data.currentAccountId && data.capabilities.canWrite ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 text-sm"><span>{roundDeletionAttempt.status === "completed" ? (english ? "Round deletion completed" : "轮次删除已完成") : (english ? "A repair-round deletion needs verification" : "有一笔维修轮次删除需要核对")}</span><button type="button" onClick={() => setAfterSalesDeletionOpen(true)} className="min-h-11 font-semibold text-primary">{english ? "View round deletion progress" : "查看轮次删除进度"}</button></div> : null}

        {activeWorkspace === "operations" ? <nav aria-label={english ? "Jump within order" : "明细内快速定位"} className="flex shrink-0 gap-2 min-[1200px]:hidden">
          {([["business-order-operations-workspace", "基本与费用", "Details & charges"], ["business-order-repair-workspace", "维修与检查", "Repair"], ["business-order-finance-workspace", "收付款", "Payments"]] as const).map(([id, zh, en]) => <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" })} className="min-h-11 flex-1 rounded-lg border border-line bg-card px-2 text-xs font-semibold text-ink">{english ? en : zh}</button>)}
        </nav> : null}

        {notice ? <p role="status" className="shrink-0 rounded-xl border border-state-success-border bg-state-success-subtle px-4 py-2 text-xs font-semibold text-state-success-text">{notice}</p> : null}
        {performanceCleanupPending ? <section aria-label={english ? "Local draft cleanup" : "本机草稿清理"} className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3">
          <p role="alert" className="min-w-0 flex-1 text-xs leading-5 text-ink-soft">{performanceCleanupPending === "saved"
            ? (english ? "Performance was saved. The old local draft could not be cleared and may reappear after refreshing. Retry local cleanup; do not submit the performance again." : "绩效已保存。本机旧草稿暂未清理，刷新后可能再次出现；请重试清理，不要重复提交绩效。")
            : (english ? "The draft was discarded on this page, but its old local copy could not be cleared and may reappear after refreshing. Retry local cleanup." : "本页已放弃草稿，但本机旧草稿暂未清理，刷新后可能再次出现；请重试清理。")}</p>
          <button type="button" onClick={() => clearPerformanceRecovery(performanceCleanupPending)} className="min-h-11 rounded-lg border border-primary px-3 text-xs font-bold text-primary">{english ? "Retry local draft cleanup" : "重试清理本机草稿"}</button>
        </section> : null}
        {performanceEditTarget && !performanceEditorOpen ? <section aria-label={english ? "Performance adjustment in progress" : "绩效调整记录"} className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3">
          <div className="min-w-0"><strong className="text-sm">{english ? `Repair round ${performanceEditTarget.roundNo} performance` : `第 ${performanceEditTarget.roundNo} 轮绩效调整`}</strong>
            <p role={performanceEditError ? "alert" : "status"} className="mt-1 text-xs leading-5 text-ink-soft">{performanceEditError || (performanceSaving ? (english ? "Waiting for the save result. Do not submit again." : "正在等待保存结果，请勿重复提交。") : performanceRetentionLabel)}</p>
          </div>
          <button type="button" onClick={() => setPerformanceEditorOpen(true)} className="min-h-11 rounded-lg border border-primary px-3 text-xs font-bold text-primary">{english ? "View performance adjustment" : "查看绩效调整"}</button>
        </section> : null}
        {error ? <p role="alert" className="shrink-0 rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-2 text-xs font-semibold text-state-danger-text">{error}</p> : null}

        <div data-workspace={activeWorkspace} className={workspaceStyles.body}>


        {historyOpen && rounds && masterData ? <RepairHistoryDialog rounds={rounds} masterData={masterData} language={language} canAdjustPerformance={data.capabilities.canWrite} onAdjustPerformance={(target) => { setHistoryOpen(false); openPerformanceEditor({ roundId: target.roundId, roundNo: target.roundNo, roundVersion: target.roundVersion, performanceMinor: target.performanceMinor, handoffId: target.handoffId }); }} onClose={() => setHistoryOpen(false)} /> : null}

        <section id="business-order-history-workspace" role="tabpanel" hidden={activeWorkspace !== "history"} className="rounded-2xl border border-line bg-card p-4 shadow-card">
          {rounds && masterData ? <FormalBusinessOrderHistoryTimeline items={historyItems} /> : <p className="rounded-xl bg-surface px-3 py-4 text-xs text-ink-soft">{english ? "Loading the complete history and change record…" : "正在读取完整历史与修改记录…"}</p>}
        </section>

        <section id="business-order-documents-workspace" role="tabpanel" hidden={activeWorkspace !== "documents"} className={`rounded-xl border border-line bg-card ${workspaceStyles.documents}`}>
          {activeWorkspace === "documents" ? <FormalBusinessOrderDocumentsWorkspace businessOrderId={businessOrderId} documents={data.documents} currentChargeVersionNo={charges.versionNo} canWrite={data.capabilities.canWrite} busy={busy} onGenerate={generatePrintDocument} /> : null}
        </section>

        <section id="business-order-attachments-workspace" role="tabpanel" hidden={activeWorkspace !== "attachments"} className="rounded-2xl border border-line bg-card p-4 shadow-card">
          {activeWorkspace === "attachments" ? <FormalBusinessOrderAttachmentsWorkspace businessOrderId={businessOrderId} canWrite={data.capabilities.canWrite && !order.voided} /> : null}
        </section>

        <section id="business-order-operations-workspace" role="tabpanel" hidden={activeWorkspace !== "operations"} className={`rounded-xl border border-line bg-card p-4 ${workspaceStyles.operations}`}>
        <header data-testid="business-order-identity" className={workspaceStyles.identity}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 w-full sm:w-auto sm:flex-1">
              <div className={workspaceStyles.identityGrid}>
                <div className="min-w-0"><h1 className="flex flex-col gap-1"><Link href={`/vehicles/${order.vehicleId}`} className="text-2xl font-bold tracking-tight hover:text-primary">{order.vehicle.plate}</Link><span className="text-sm font-semibold">{order.vehicle.description}</span></h1>{order.vehicle.vin ? <p className="mt-2 break-all font-mono text-xs text-ink-soft">VIN {order.vehicle.vin}</p> : null}</div>
                <div className="min-w-0"><p className="flex flex-col gap-1 text-base"><span className="text-xs text-ink-soft">{english ? "Payer" : "费用承担方"}</span><strong>{order.payer.displayName}</strong></p><div className="mt-2 flex flex-wrap gap-2">{payerMeta.map((value) => <span key={value} className="text-xs text-ink-soft">{value}</span>)}</div></div>
              </div>
            </div>
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
          <div aria-label={english ? "Repair progress" : "维修进度"} className="mt-4 grid grid-cols-5 gap-1">
            {PROGRESS.map(([status, labelZh, labelEn], index) => <div key={status} className={`rounded-md border px-2 py-1.5 text-center text-[11px] font-semibold ${index < progressIndex ? "border-accent-solid bg-accent-solid text-accent-foreground" : index === progressIndex ? "border-state-warning-border bg-state-warning-subtle text-state-warning-text" : "border-line bg-layer-2 text-ink-soft"}`}>{index + 1} {english ? labelEn : labelZh}</div>)}
          </div>
        </header>
          <FormalBusinessOrderProblemDescription
            businessOrderId={businessOrderId}
            context={data.problemDescriptions ?? emptyProblemDescriptionContext(order.createdAt)}
            canWrite={data.capabilities.canWrite && !order.voided}
            onSaved={(problemDescriptions) => {
              setData((current) => current ? { ...current, problemDescriptions } : current);
              setNotice(english ? "Problem description saved as a new version" : "问题描述已保存为新版本");
            }}
          />
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-bold">{english ? "Charges" : "收费项目"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? `Version V${charges.versionNo} · Unit prices and subtotals include tax` : `版本 V${charges.versionNo} · 单价与小计均为含税金额`}</p></div>{data.capabilities.canWrite ? <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { if (naturalLanguageOpen) stopNaturalLanguage(); setNaturalLanguageOpen(!naturalLanguageOpen); }} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary">{english ? "Natural-language entry" : "自然语言录入"}</button>{chargeEditing ? <button type="button" disabled={busy} onClick={cancelChargeEditing} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">{english ? "Cancel editing" : "取消编辑"}</button> : null}{chargeEditing ? <button key="save-charges" type="button" onClick={requestChargeSubmit} disabled={busy || chargeDraft.length === 0 || translatingKey !== null || naturalLanguageBusy} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-40">{english ? "Save charges" : "保存收费项目"}</button> : <button key="edit-charges" type="button" onClick={beginChargeEditing} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white">{english ? "Edit charges" : "编辑收费项目"}</button>}</div> : <span className="text-xs text-ink-soft">{charges.reason}</span>}</div>

          {naturalLanguageOpen ? <div className="mt-3 rounded-xl border border-state-info-border bg-state-info-subtle p-3"><label className="text-xs font-bold">{english ? "Natural-language input" : "自然语言输入"}<textarea disabled={naturalLanguageBusy} value={naturalLanguageText} onChange={(event) => setNaturalLanguageText(event.target.value)} placeholder={english ? "Example: Replace front brake pads 12000, labor 5000\nCustomer concern: brake noise\nWork instruction: inspect before replacement\nAdvance notice: confirm any additional work" : "例如：更换前刹车片一套 12000，工时 5000\n客户反馈：刹车异响\n施工说明：先检查再更换\n提前告知：追加项目须再次确认"} className="mt-2 min-h-28 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm text-ink" /></label>{naturalLanguageError ? <p role="alert" className="mt-2 rounded-lg border border-state-danger-border bg-state-danger-subtle p-3 text-sm text-state-danger-text">{naturalLanguageError}</p> : null}{naturalLanguageBusy ? <p role="status" className="mt-2 text-sm">{english ? "Preparing a draft… Cancel at any time; nothing is saved automatically." : "正在整理草稿… 可随时取消，系统不会自动保存。"}</p> : null}<div className="mt-2 flex gap-2"><button type="button" disabled={!naturalLanguageText.trim() || naturalLanguageBusy} onClick={() => void stageNaturalLanguage()} className="min-h-9 rounded-lg bg-accent-solid px-3 text-xs font-bold text-accent-foreground disabled:opacity-40">{naturalLanguageBusy ? (english ? "AI is preparing…" : "AI 整理中…") : (english ? "Prepare charge draft with AI" : "AI 整理到收费草稿")}</button><button type="button" onClick={() => stopNaturalLanguage(true)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">{english ? "Cancel" : "取消"}</button></div><p className="mt-2 text-[11px] text-ink-soft">{english ? "AI prepares charge items, customer concerns, work instructions, liability notices and advance notices together. Front-desk staff review before saving. If AI is unavailable, the system identifies use of local rules." : "后台 AI 同时整理收费项目、客户反馈、施工说明、责任说明和提前告知；由前台核对后保存。AI 不可用时会明确提示采用本地规则。"}</p></div> : null}

          {chargeEditing ? <form id="charge-edit-form" ref={chargeEditFormRef} className={`mt-3 ${workspaceStyles.chargeEditor}`} onSubmit={submitCharges} onInvalid={(event) => { event.preventDefault(); setChargeActionError(english ? "Complete the required fields in this form" : "有必填内容未填写，请检查当前表单"); (event.target as HTMLElement).focus(); }}>
            <fieldset disabled={busy} className="min-w-0">
            {translatingKey !== null ? <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm"><span>{english ? "Translating… You can continue editing or cancel translation to save now." : "正在翻译… 可继续编辑，或取消翻译后立即保存。"}</span><button type="button" onClick={cancelChargeTranslation} className="min-h-11 rounded-lg border border-line px-3 font-semibold">{english ? "Cancel translation" : "取消翻译"}</button></div> : null}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-xs"><span>{english ? "Draft order revision" : "草稿对应业务单版本"} {chargeBaseline?.version ?? data.order.version}</span><button type="button" disabled={busy || naturalLanguageBusy || translatingKey !== null} onClick={() => setChargeComparisonOpen(true)} className="min-h-11 rounded-lg border border-primary px-3 font-bold text-primary disabled:opacity-40">{english ? "Compare latest charges" : "核对最新收费"}</button></div>
            <div className="space-y-3">{(["labor", "part", "other"] as const).map((kind) => <section key={kind}><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-primary">{english ? CATEGORY_LABELS_EN[kind] : CATEGORY_LABELS[kind]}</h3><button type="button" onClick={() => addChargeDraftItem(kind)} className="rounded-md border border-primary px-2 py-1 text-[11px] font-bold text-primary">{english ? CATEGORY_ADD_LABELS_EN[kind] : CATEGORY_ADD_LABELS[kind]}</button></div><div className="mt-1 space-y-2">{chargeDraft.filter((item) => item.kind === kind).map((item) => <div key={item.key} className={`formal-charge-editor-row rounded-xl border border-line p-3 text-sm ${workspaceStyles.chargeEditorRow}`}><label>{english ? "Chinese item name" : "项目名称"}<input aria-label={english ? "Chinese item name" : "项目名称"} required value={item.nameZh} onChange={(event) => updateChargeDraft(item.key, "nameZh", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /><input aria-label={english ? "English item name" : "项目英文名称"} value={item.nameEn} onChange={(event) => updateChargeDraft(item.key, "nameEn", event.target.value)} placeholder="English" className="mt-1 min-h-8 w-full rounded-md border border-line px-2 text-[11px]" /></label><label>{english ? "Chinese description" : "描述"}<input aria-label={english ? "Chinese description" : "描述"} value={item.descriptionZh} onChange={(event) => updateChargeDraft(item.key, "descriptionZh", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /><input aria-label={english ? "English description" : "英文描述"} value={item.descriptionEn} onChange={(event) => updateChargeDraft(item.key, "descriptionEn", event.target.value)} placeholder="English" className="mt-1 min-h-8 w-full rounded-md border border-line px-2 text-[11px]" /></label><label className="lg:self-start">{english ? "Unit" : "单位"}<select disabled={item.kind === "labor"} aria-label={english ? "Unit" : "单位"} value={item.unitItemId} onChange={(event) => updateChargeDraft(item.key, "unitItemId", Number(event.target.value))} className="mt-1 min-h-9 w-full rounded-md border border-line px-2">{data.chargeUnits.map((unit) => <option key={unit.id} value={unit.id}>{item.kind === "labor" ? "JOB" : english ? unit.labelEn || "Translation required" : unit.labelZh}</option>)}</select></label><BusinessChargeQuantityField value={item.quantity} english={english} onChange={(value) => updateChargeDraft(item.key, "quantity", value)} /><BusinessChargePriceFields name={item.nameZh} unitPrice={item.unitPrice} itemDiscount={item.itemDiscount} pendingQuote={item.pendingQuote} english={english} onChange={(field, value) => updateChargeDraft(item.key, field, value)} /><button type="button" aria-label={english ? `Translate charge item ${item.nameZh || "unnamed"}` : `翻译收费项目 ${item.nameZh || "未命名"}`} disabled={translatingKey !== null} onClick={() => void translateChargeDraftItem(item.key)} className="min-h-9 rounded-md border border-primary px-2 font-bold text-primary disabled:opacity-40">{translatingKey === `item-${item.key}` ? "…" : (english ? "Translate" : "译")}</button><button type="button" onClick={() => setChargeDraft((current) => current.filter((candidate) => candidate.key !== item.key))} className="min-h-9 rounded-md border border-rose-300 px-2 font-bold text-rose-600">{english ? "Delete" : "删"}</button></div>)}</div></section>)}</div>
            <section className="mt-3 rounded-xl border border-state-warning-border bg-state-warning-subtle p-3"><div className="flex items-center justify-between gap-2"><div><h3 className="text-xs font-bold text-state-warning-text">{english ? "Notes, responsibilities and advance notice" : "备注、责任义务与提前告知"}</h3><p className="mt-1 text-[11px] text-state-warning-text">{english ? "Saved with this charge version and preserved for printing." : "与本次收费版本一起保存，打印时采用当时版本。"}</p></div><button type="button" onClick={addChargeNoteDraft} className="rounded-md border border-state-warning-border px-2 py-1 text-[11px] font-bold text-state-warning-text">{english ? "Add note" : "新增备注"}</button></div><div className="mt-2 space-y-2">{chargeNoteDraft.map((note) => <div key={note.key} className="grid gap-2 rounded-lg border border-state-warning-border bg-card p-2 text-xs lg:grid-cols-[.85fr_1.5fr_1.5fr_auto_auto] lg:items-end"><label>{english ? "Note type" : "备注类型"}<select aria-label={english ? "Note type" : "备注类型"} value={note.kind} onChange={(event) => updateChargeNoteDraft(note.key, "kind", event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-line bg-layer-2 px-2 text-ink">{Object.entries(english ? NOTE_KIND_LABELS_EN : NOTE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><label>{english ? "Chinese content" : "中文内容"}<textarea aria-label={english ? "Chinese note content" : "备注中文内容"} required value={note.contentZh} onChange={(event) => updateChargeNoteDraft(note.key, "contentZh", event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-line bg-layer-2 p-2 text-ink" /></label><label>{english ? "English content" : "英文内容"}<textarea aria-label={english ? "English note content" : "备注英文内容"} value={note.contentEn} onChange={(event) => updateChargeNoteDraft(note.key, "contentEn", event.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-line bg-layer-2 p-2 text-ink" /></label><button type="button" aria-label={english ? `Translate note ${NOTE_KIND_LABELS_EN[note.kind]}` : `翻译备注 ${NOTE_KIND_LABELS[note.kind]}`} disabled={translatingKey !== null} onClick={() => void translateChargeNoteDraft(note.key)} className="min-h-9 rounded-md border border-state-warning-border px-2 font-bold text-state-warning-text disabled:opacity-40">{translatingKey === `note-${note.key}` ? "…" : (english ? "Translate" : "译")}</button><button type="button" onClick={() => setChargeNoteDraft((current) => current.filter((candidate) => candidate.key !== note.key))} className="min-h-9 rounded-md border border-state-danger-border px-2 font-bold text-state-danger-text">{english ? "Delete" : "删"}</button></div>)}</div></section>
            <div className="mt-3 rounded-xl bg-surface p-3 text-xs"><label>{english ? "Reason for change" : "修改原因"}<input name="reason" required defaultValue={english ? "Charges updated after front-desk review" : "前台核对后更新收费"} className="mt-1 min-h-9 w-full rounded-md border border-line px-2" /></label></div>
                {chargeActionError ? <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{chargeActionError}</p> : null}
                {chargeActionNotice ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{chargeActionNotice}</p> : null}
            <div role="group" aria-label={english ? "Charge editor actions" : "收费编辑操作"} className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              {naturalLanguageBusy ? <button type="button" onClick={() => stopNaturalLanguage()} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold">{english ? "Stop AI preparation" : "停止 AI 整理"}</button> : null}
              {translatingKey !== null ? <button type="button" onClick={cancelChargeTranslation} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold">{english ? "Stop translation" : "停止翻译"}</button> : null}
              <button type="button" onClick={cancelChargeEditing} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold disabled:opacity-40">{english ? "Discard this edit" : "放弃本次编辑"}</button>
              <button type="button" onClick={() => setChargeComparisonOpen(true)} disabled={naturalLanguageBusy || translatingKey !== null} className="min-h-11 rounded-lg border border-primary px-4 text-sm font-semibold text-primary disabled:opacity-40">{english ? "Compare versions" : "核对版本"}</button>
              <button type="button" onClick={requestChargeSubmit} disabled={chargeDraft.length === 0 || translatingKey !== null || naturalLanguageBusy} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-40">{busy ? (english ? "Saving…" : "正在保存…") : (english ? "Save charges and notes" : "保存收费与备注")}</button>
            </div>
            </fieldset>
          </form> : <><BusinessPendingQuoteNotice count={pendingQuoteCount} english={english} onEdit={data.capabilities.canWrite && !data.order.voided && !busy ? beginChargeEditing : undefined} /><div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-layer-2 p-3 text-xs lg:grid-cols-4"><span className="min-w-0"><span className="block whitespace-nowrap">{english ? "Labor total" : "工时合计"}</span><strong data-testid="business-order-labor-total" className="mt-1 block whitespace-nowrap text-base tabular-nums">{formatFormalMoney(groupedChargeTotals.laborTotalMinor)}</strong><small className="block whitespace-nowrap text-rose-600">{english ? "Discounts" : "优惠"} −{formatFormalMoney(groupedDiscounts.laborDiscountMinor)}</small></span><span className="min-w-0"><span className="block whitespace-nowrap">{english ? "Parts total" : "配件合计"}</span><strong data-testid="business-order-part-total" className="mt-1 block whitespace-nowrap text-base tabular-nums">{formatFormalMoney(groupedChargeTotals.partTotalMinor)}</strong><small className="block whitespace-nowrap text-rose-600">{english ? "Discounts" : "优惠"} −{formatFormalMoney(groupedDiscounts.partDiscountMinor)}</small></span><span className="min-w-0"><span className="block whitespace-nowrap">{english ? "Other charges total" : "其他费用合计"}</span><strong data-testid="business-order-other-total" className="mt-1 block whitespace-nowrap text-base tabular-nums">{formatFormalMoney(groupedChargeTotals.otherTotalMinor)}</strong><small className="block whitespace-nowrap text-rose-600">{english ? "Discounts" : "优惠"} −{formatFormalMoney(groupedDiscounts.otherDiscountMinor)}</small></span><span className="min-w-0"><span className="block whitespace-nowrap">{pendingQuoteCount ? (english ? "Quoted charges (15% GCT included)" : "已报价金额（含 15% GCT）") : (english ? "Amount due (15% GCT included)" : "折后应收（含 15% GCT）")}</span><strong className="mt-1 block whitespace-nowrap text-base tabular-nums">{formatFormalMoney(charges.totals.totalDueMinor)}</strong><small className="block whitespace-nowrap text-ink-soft">{english ? "Original charges" : "收费原价"} {formatFormalMoney(charges.totals.grossMinor)}</small>{charges.totals.wholeOrderDiscountMinor > 0 ? <small data-testid="business-order-whole-order-discount" className="block whitespace-nowrap text-rose-600">{english ? "Whole-order discount" : "整单优惠"} −{formatFormalMoney(charges.totals.wholeOrderDiscountMinor)}</small> : null}<small className="block whitespace-nowrap text-ink-soft">{english ? "Included GCT" : "其中 GCT"} {formatFormalMoney(charges.totals.includedGctMinor)}</small></span></div><ChargeSection charges={charges} kind="labor" unitLabels={unitLabels} language={language} /><ChargeSection charges={charges} kind="part" unitLabels={unitLabels} language={language} /><ChargeSection charges={charges} kind="other" unitLabels={unitLabels} language={language} />{charges.notes.length > 0 ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-950"><strong>{english ? "Notes, responsibilities and advance notice" : "备注 / 责任义务与提前告知"}</strong>{charges.notes.map((note) => <p key={note.id} className="mt-1">{english ? note.contentEn || "Translation required" : note.contentZh ?? ""}{!english && note.contentEn ? ` / ${note.contentEn}` : ""}</p>)}</div> : null}</>}
        </section>

        <div data-testid="business-order-right-rail" hidden={activeWorkspace !== "operations"} className={`space-y-3 ${workspaceStyles.rail}`}>
        {rounds && masterData ? <section id="business-order-repair-workspace" className="rounded-2xl border border-line bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">{english ? `Repair round ${rounds.current.roundNo}` : `第 ${rounds.current.roundNo} 轮维修`}</h2><p className="mt-1 text-xs text-ink-soft">{rounds.current.source === "after_sales" ? `${english ? "After-sales return" : "售后回厂"}: ${rounds.current.afterSalesIssue}` : (english ? "Initial repair" : "首次维修")} · {english ? "Each round keeps its own activity and formal handoff time" : "每轮记录和正式交单时间独立保留"}</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setHistoryOpen(true)} className="min-h-8 rounded-lg border border-line px-3 text-xs font-bold">{english ? "View full order history" : "查看整单历史"}</button><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary">{formalBusinessOrderStatusLabel(rounds.current.status, language)}</span>{(["assigned", "in_repair", "return_pending_review"] as const).includes(rounds.current.status as "assigned" | "in_repair" | "return_pending_review") ? <button disabled={busy} type="button" onClick={withdrawCurrentAssignment} className="min-h-8 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-700 disabled:opacity-40">{english ? "Withdraw assignment" : "撤回派单"}</button> : null}</div></div>
          {rounds.current.status !== "formally_handed_off" ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-layer-2 px-3 py-2 text-xs"><span>{english ? "Current round performance" : "本轮绩效"}<strong data-testid="repair-round-performance" className="ml-2 tabular-nums">{formatFormalMoney(currentRoundPerformanceMinor)}</strong></span>{data.capabilities.canWrite ? <button disabled={busy} type="button" onClick={() => { openPerformanceEditor({ roundId: rounds.current.id, roundNo: rounds.current.roundNo, roundVersion: rounds.current.version, performanceMinor: currentRoundPerformanceMinor, handoffId: null }); }} className="min-h-8 rounded-lg border border-primary px-3 text-xs font-bold text-primary disabled:opacity-40">{english ? "Edit performance" : "修改绩效值"}</button> : null}</div> : null}
          {rounds.current.status === "waiting_assignment" ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); const confirmed = ledger.totalPaidMinor > 0 || window.confirm(english ? "No payment has been recorded. Have the Business Order details been confirmed with the customer? Cancel to leave the order unassigned." : "本单尚无收款信息。是否已经与客户确认好业务内容？选择取消则不派单。 "); if (!confirmed) return; void submitRoundAction({ action: "assign", businessOrderVersion: order.version, teamId: Number(selectedTeamId), customerConfirmed: true }, english ? "Assigned to the repair team" : "已派给维修班组"); }}><fieldset><legend className="text-xs font-bold">{english ? "Select repair team" : "选择维修班组"}</legend><div className="mt-2 flex flex-wrap gap-2">{masterData.teams.filter((team) => team.isActive).map((team) => <label key={team.id} className={`cursor-pointer rounded-lg border px-4 py-3 text-xs font-bold transition ${selectedTeamId === String(team.id) ? "border-accent-solid bg-accent-solid text-accent-foreground" : "border-line bg-layer-2 text-ink"}`}><input type="radio" name="teamId" value={team.id} required checked={selectedTeamId === String(team.id)} onChange={(event) => setSelectedTeamId(event.target.value)} className="sr-only" />{team.name}</label>)}</div></fieldset><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !selectedTeamId} className="min-h-10 rounded-lg bg-accent-solid px-4 text-xs font-bold text-accent-foreground disabled:opacity-40">{english ? "Assign" : "派单"}</button>{masterData.teams.every((team) => !team.isActive) ? <Link href={`/dictionaries?returnTo=${encodeURIComponent(`/orders/business/${businessOrderId}`)}#teams`} className="min-h-10 rounded-lg border border-accent px-4 py-2.5 text-xs font-bold text-accent">{english ? "Add a repair team first" : "先新增维修班组"}</Link> : null}</div></form> : null}
          {rounds.current.source === "after_sales" && data.capabilities.canWrite ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-state-danger-border bg-state-danger-subtle px-3 py-2"><p className="max-w-[36rem] text-xs leading-5 text-state-danger-text">{english ? "To delete this repair round, first review its linked records and any blockers. Formal business facts must be handled before deletion." : "删除本轮前，请先查看关联记录和阻断原因；存在正式业务事实时需要先处理。"}</p><button disabled={busy} type="button" onClick={openAfterSalesRoundDeletion} className="min-h-9 rounded-lg border border-state-danger-border bg-card px-3 text-xs font-bold text-state-danger-text disabled:opacity-40">{english ? "Delete this round" : "删除本轮"}</button></div> : null}
          {rounds.current.status === "assigned" ? <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-xs font-bold text-amber-950">{english ? "Next: record mechanic acceptance" : "下一步：登记维修工接单"}</h3>
            <p className="mt-1 text-xs text-amber-900">{english ? "The round moves to In repair when a mechanic accepts it on mobile. If a paper mechanic copy is returned, select the actual mechanic here to record acceptance." : "维修工手机端接单后会自动进入维修中；收到纸质维修工联时，也可以在这里选择实际维修工代录接单。"}</p>
            {assignedTeamStaff.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{assignedTeamStaff.map((staff) => <button key={staff.id} disabled={busy} type="button" onClick={() => void submitRoundAction({ action: "record_paper_acceptance", repairRoundVersion: rounds.current.version, actualStaffMemberId: staff.id }, english ? `Recorded acceptance by ${staff.fullName}` : `已登记 ${staff.fullName} 接单`)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{staff.fullName} · {english ? "Accept" : "接单"}</button>)}</div> : <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-rose-700">{english ? "This team has no active mechanic who can accept the round." : "当前班组没有可接单的在职维修工。"}</span><Link href={`/employees?create=1&team=${rounds.current.assignedTeamId}&returnTo=${encodeURIComponent(`/orders/business/${businessOrderId}`)}`} className="min-h-9 rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary">{english ? "Add a mechanic and return" : "新增维修工后返回"}</Link></div>}
          </section> : null}
          {rounds.current.status === "in_repair" ? <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-layer-2 p-3 text-xs"><span className="text-ink-soft">{english ? "Intake mileage" : "接车里程"}</span><strong className="mt-1 block text-sm">{rounds.current.intakeMileageKm === null ? (english ? "Waiting for mechanic" : "等待维修工登记") : `${rounds.current.intakeMileageKm.toLocaleString()} km`}</strong></div>
              <div className="rounded-xl bg-layer-2 p-3 text-xs"><span className="text-ink-soft">{english ? "Odometer photo" : "里程照片"}</span><strong className="mt-1 block text-sm">{rounds.current.intakePhotoFileIds.length > 0 ? (english ? `${rounds.current.intakePhotoFileIds.length} archived` : `已归档 ${rounds.current.intakePhotoFileIds.length} 张`) : (english ? "Waiting for mechanic" : "等待维修工拍摄")}</strong></div>
            </div>
            <p className="rounded-xl border border-line bg-layer-1 px-3 py-2 text-xs text-ink-soft">{english ? "The mechanic receives the vehicle by entering the odometer and taking its photo in the mobile portal. Electronic returns then appear here automatically for review." : "维修工在手机端填写接车里程并拍摄里程照片后即完成接车；电子回单提交后会自动出现在这里等待审核。"}</p>
            <div className="flex flex-wrap gap-2">{data.capabilities.canWrite ? <button type="button" onClick={() => setPaperReturnOpen(true)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">{english ? "Received paper work return" : "收到纸质回单"}</button> : null}</div>
          </div> : null}
          {rounds.current.status === "return_pending_review" ? <div className="mt-3 rounded-xl border border-line bg-layer-1 p-3">
            {rounds.current.latestWorkReturn ? <><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{rounds.current.latestWorkReturn.submissionSource === "paper" ? (english ? "Paper work return" : "纸质回单") : (english ? "Electronic work return" : "电子维修回单")} · #{rounds.current.latestWorkReturn.submissionNo}</h3><p className="mt-1 text-xs text-ink-soft">{rounds.current.latestWorkReturn.actualStaffName ?? (english ? "Mechanic not recorded" : "未记录维修工")} · {formatDateTime(rounds.current.latestWorkReturn.submittedAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${rounds.current.approvedWorkReturnId ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{rounds.current.approvedWorkReturnId ? (english ? "Approved" : "已审核通过") : (english ? "Review required" : "需要前台审核")}</span></div>{rounds.current.latestWorkReturn.workSummary ? <p className="mt-3 text-xs leading-5">{rounds.current.latestWorkReturn.workSummary}</p> : null}</> : <p className="text-xs text-rose-700">{english ? "The latest return details could not be loaded. Refresh before reviewing." : "最新回单详情未能读取，请刷新后再审核。"}</p>}
            <div className="mt-3 flex flex-wrap gap-2">{rounds.current.latestWorkReturnId && !rounds.current.approvedWorkReturnId ? <button disabled={busy} type="button" onClick={() => setReturnReviewOpen(true)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">{english ? "Review and hand off" : "审核并正式交单"}</button> : null}{rounds.current.approvedWorkReturnId ? <button disabled={busy} type="button" onClick={() => setFormalHandoffOpen(true)} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white">{english ? "Complete legacy handoff" : "完成旧回单交单"}</button> : null}</div>
          </div> : null}
          {rounds.current.status === "formally_handed_off" ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-sm font-bold text-emerald-900">{english ? "This repair round has been formally handed off" : "本轮维修已经正式交单"}</h3><p className="mt-1 text-xs text-emerald-800">{english ? "Repair work is complete. Payments, vehicle release and any outstanding balance remain in this Business Order." : "维修工作已经完成；收款、取车和未结余额继续在本 Business Order 内处理。"}</p></div>
              {data.capabilities.canWrite ? <div className="flex flex-wrap gap-2">
                {currentActiveHandoff && currentActiveHandoff.performanceAdjustmentAllowed !== false ? <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCancelHandoffDraft(null);
                    setAfterSalesOpen(false);
                    openPerformanceEditor({ roundId: rounds.current.id, roundNo: rounds.current.roundNo, roundVersion: rounds.current.version, performanceMinor: currentActiveHandoff.performanceMinor, handoffId: currentActiveHandoff.id });
                  }}
                  className="min-h-9 rounded-lg border border-primary bg-card px-3 text-xs font-bold text-primary disabled:opacity-40"
                >{english ? "Adjust performance" : "调整绩效值"}</button> : null}
                {currentActiveHandoff && currentActiveHandoff.performanceAdjustmentAllowed !== false ? <button
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
            {data.capabilities.canWrite && currentActiveHandoff?.performanceAdjustmentAllowed === false ? <p className="mt-3 rounded-lg border border-line bg-layer-2 px-3 py-2 text-xs font-semibold text-ink-soft">{performanceAdjustmentUnavailableLabel(currentActiveHandoff.performanceAdjustmentUnavailableReason, language)}</p> : null}
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
            {data.capabilities.canWrite && afterSalesOpen ? <form id="formal-after-sales-form" className="mt-3 flex flex-wrap items-end gap-2 border-t border-state-success-border pt-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setAfterSalesOpen(false); void submitRoundAction({ action: "start_after_sales", businessOrderVersion: order.version, issue: String(form.get("issue")) }, english ? "Started the next after-sales repair round in this Business Order" : "已在本 Business Order 开始下一轮售后维修"); }}><label className="min-w-0 w-full flex-1 text-xs">{english ? "After-sales return issue" : "本次售后回厂问题"}<input name="issue" required className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-ink" /></label><button type="button" onClick={() => setAfterSalesOpen(false)} className="min-h-10 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} className="min-h-10 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white">{english ? "Start next repair round" : "确认开始下一轮维修"}</button></form> : null}
          </div> : null}
        </section> : null}
        <BusinessOrderInspections english={english} items={relatedInspectionReports} total={inspectionTotal} loading={inspectionLoading} error={inspectionError} canCreate={data.capabilities.canWrite} page={inspectionPage} pageCount={inspectionPageCount} onPage={(page) => { setInspectionLoading(true); setInspectionError(false); setInspectionPage(page); }} onCreate={() => setInspectionCreateOpen(true)} onRetry={() => { setInspectionLoading(true); setInspectionError(false); setInspectionRetryKey((value) => value + 1); }} />
        <section id="business-order-finance-workspace" className="rounded-2xl border border-line bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">{english ? "Payments and refunds" : "收付款"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Every payment and refund is preserved as a separate record. The balance is calculated from the transaction history." : "每一笔收款、退款独立留痕，余额由历史自动计算。"}</p></div><div className="flex gap-2">{data.capabilities.canRecordPayment ? <button type="button" onClick={() => { setPaymentFormOpen(true); setRefundFormOpen(false); }} className="min-h-9 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white">{english ? "Record payment" : "登记收款"}</button> : null}{data.capabilities.canRefund ? <button type="button" onClick={() => { setRefundFormOpen(true); setPaymentFormOpen(false); }} className="min-h-9 rounded-lg border border-rose-400 px-3 text-xs font-bold text-rose-700">{english ? "Create refund" : "生成退款"}</button> : null}</div></div>
          <BusinessPendingQuoteNotice count={pendingQuoteCount} english={english} />
          {isFinanciallySettled ? <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-black text-emerald-900">{english ? "Financially settled · Outstanding balance" : "财务已结清 · 当前未结余额"} {formatFormalMoney(0)}</div> : null}
          <div className="mt-3 grid grid-cols-2 gap-2"><span className="min-w-0 rounded-xl bg-surface p-3 text-xs">{pendingQuoteCount ? (english ? "Quoted charges" : "已报价金额") : (english ? "Amount due after discounts" : "折后应收")}<strong className="mt-1 block whitespace-nowrap text-sm tabular-nums">{formatFormalMoney(ledger.currentDueMinor)}</strong></span><span className="min-w-0 rounded-xl bg-emerald-50 p-3 text-xs">{english ? "Total paid" : "累计收款"}<strong className="mt-1 block whitespace-nowrap text-sm tabular-nums text-emerald-700">{formatFormalMoney(ledger.totalPaidMinor)}</strong></span><span className="min-w-0 rounded-xl bg-rose-50 p-3 text-xs">{english ? "Total refunded" : "累计退款"}<strong className="mt-1 block whitespace-nowrap text-sm tabular-nums text-rose-700">{formatFormalMoney(ledger.totalRefundedMinor)}</strong></span><span className={`min-w-0 rounded-xl p-3 text-xs ${isFinanciallySettled ? "border border-emerald-300 bg-emerald-100 text-emerald-900" : "bg-amber-50"}`}>{isFinanciallySettled ? (english ? "Outstanding balance / Settled" : "未结余额 / 已结清") : pendingQuoteCount ? (english ? "Outstanding on priced items" : "已报价部分未结余额") : (english ? "Outstanding balance" : "未结余额")}<strong className={`mt-1 block whitespace-nowrap text-sm tabular-nums ${isFinanciallySettled ? "text-emerald-800" : "text-amber-800"}`}>{formatFormalMoney(ledger.balanceMinor)}</strong></span></div>

          {!data.capabilities.canRecordPayment && !data.capabilities.canRefund ? <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-ink-soft">{english ? "This account is read-only and can view all payment and refund records." : "当前账号只读，可查看全部收付款事实。"}</p> : null}

          <div className="mt-4"><button type="button" aria-expanded={financeHistoryOpen} onClick={() => setFinanceHistoryOpen((open) => !open)} className="flex min-h-10 w-full items-center justify-between rounded-xl border border-line bg-layer-2 px-3 text-left text-xs font-bold"><span>{english ? "Payment and refund history" : "收付款历史"}</span><span className="font-semibold text-ink-soft">{ledger.transactions.length} · {financeHistoryOpen ? (english ? "Hide" : "收起") : (english ? "Show" : "展开")}</span></button>{financeHistoryOpen ? (ledger.transactions.length === 0 ? <p className="mt-2 text-xs text-ink-soft">{english ? "No payments or refunds recorded." : "尚无收付款记录。"}</p> : <div className="mt-2 overflow-hidden rounded-xl border border-line">{ledger.transactions.map((transaction) => {
            const refund = transaction.type === "refund" ? refundById.get(transaction.id) : null;
            return <article key={`${transaction.type}-${transaction.id}`} className="grid gap-2 border-b border-line p-3 text-xs last:border-0"><span><strong className="block">{transaction.type === "payment" ? (english ? "Payment" : "收款") : (english ? "Refund" : "退款")} · {transaction.referenceNo}</strong><small className="text-ink-soft">{formatDateTime(transaction.occurredAt)} · {english ? transaction.methodLabelEn || "Translation required" : transaction.methodLabelZh}</small></span><strong className={transaction.type === "refund" ? "text-rose-600" : "text-emerald-600"}>{transaction.type === "refund" ? "−" : "+"}{formatFormalMoney(transaction.amountMinor)}</strong><span>{transaction.note ?? refund?.reason ?? (english ? "No note" : "无备注")}</span><span>{refund ? <span className="flex flex-col items-start gap-2"><Link href={`/orders/business/${businessOrderId}/refund/${refund.id}/print`} className="font-bold text-primary">{english ? "Print refund acknowledgement" : "打印退款签收单"}</Link>{formalRefundNeedsProof(refund) ? <form onSubmit={(event) => submitProof(event, refund.id)} className="flex w-full items-center gap-2"><input aria-label={english ? `Refund ${refund.refundNo} proof` : `退款 ${refund.refundNo} 实际凭证`} name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="min-w-0 flex-1 text-[10px]" /><button disabled={busy} className="shrink-0 rounded-md border border-primary px-2 py-1 font-semibold text-primary">{english ? "Upload transfer proof" : "补传转账凭证"}</button></form> : refund.paymentMethodCode !== "cash" ? <span className="font-semibold text-emerald-700">{english ? "Transfer proof archived" : "转账凭证已归档"}</span> : null}{formalRefundHasSignedAcknowledgement(refund) ? <span className="font-semibold text-emerald-700">{english ? "Signed refund acknowledgement uploaded" : "已上传签字后的退款签收单"}</span> : <form onSubmit={(event) => submitSignedAcknowledgement(event, refund.id)} className="flex w-full items-center gap-2"><input aria-label={english ? `Upload signed refund acknowledgement for ${refund.refundNo}` : `退款 ${refund.refundNo} 上传签字后的退款签收单`} name="signedAcknowledgement" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="min-w-0 flex-1 text-[10px]" /><button disabled={busy} className="shrink-0 rounded-md border border-primary px-2 py-1 font-semibold text-primary">{english ? "Upload signed copy" : "上传签收单"}</button></form>}</span> : transaction.receiptId ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><strong className="w-full">{english ? "Receipt: " : "Receipt："}{transaction.referenceNo}</strong><Link href={`/orders/business/${businessOrderId}/receipt/${transaction.receiptId}/print?copy=zh`} className="font-semibold text-primary">{english ? "Chinese Receipt" : "中文 Receipt"}</Link><Link href={`/orders/business/${businessOrderId}/receipt/${transaction.receiptId}/print?copy=en`} className="font-semibold text-primary">{english ? "English Receipt" : "英文 Receipt"}</Link></span> : null}</span></article>;
          })}</div>) : null}</div>
        </section>
        </div>

        <section id="business-order-messages-workspace" role="tabpanel" hidden={activeWorkspace !== "messages"} className="rounded-2xl border border-line bg-card p-4 shadow-card">
          {activeWorkspace === "messages" ? <FormalBusinessOrderMessages businessOrderId={businessOrderId} currentAccountId={data.currentAccountId} canCollaborate={data.capabilities.canCollaborate} highlightedMessageId={Number.isSafeInteger(highlightedMessageId) && highlightedMessageId > 0 ? highlightedMessageId : null} onMentionsRead={handleMentionsRead} /> : null}
        </section>
        </div>
      </div>
      {chargeComparisonOpen && chargeEditing ? <BusinessChargeComparison businessOrderId={businessOrderId} version={chargeBaseline?.version ?? data.order.version} items={chargeDraft} notes={chargeNoteDraft} totals={chargeBaseline?.totals ?? data.charges.totals} units={data.chargeUnits} english={english} onClose={() => setChargeComparisonOpen(false)} onChoose={chooseComparedCharges} /> : null}
      <ActionDialog
        open={afterSalesDeletionOpen && data.capabilities.canWrite && Boolean(afterSalesRoundDeletionPreview || roundDeletionAttempt)}
        title={english
          ? `Delete repair round ${roundDeletionAttempt?.roundNo ?? afterSalesRoundDeletionPreview?.roundNo ?? ""}`
          : `删除第 ${roundDeletionAttempt?.roundNo ?? afterSalesRoundDeletionPreview?.roundNo ?? ""} 轮维修`}
        description={english
          ? "The system checks linked records before deleting this repair round. Blocking business facts must be handled first."
          : "系统会先核对本轮关联记录；存在正式业务事实时，必须先处理阻断项。"}
        onClose={closeAfterSalesRoundDeletion}
      >
        {roundDeletionAttempt ? <RoundDeletionAttemptView attempt={roundDeletionAttempt} english={english} busy={busy} checking={afterSalesDeletionChecking} storageAvailable={roundDeletionStorageAvailable}
          onRetry={() => void executeRoundDeletionAttempt(roundDeletionAttempt)}
          onClose={closeAfterSalesRoundDeletion}
          onHistory={() => void checkRoundDeletionHistory()}
          onStore={() => setRoundDeletionStorageAvailable(saveRoundDeletionAttempt(roundDeletionAttempt))}
          onDismiss={() => { const cleared = clearRoundDeletionAttempt(roundDeletionAttempt); setRoundDeletionStorageAvailable(cleared); if (cleared) { setRoundDeletionAttempt(null); closeAfterSalesRoundDeletion(); } }}
        /> : afterSalesRoundDeletionPreview ? <form onSubmit={submitAfterSalesRoundDeletion} className="space-y-4">
          {afterSalesDeletionError ? <p role="alert" className="rounded-xl border border-state-danger-border bg-state-danger-subtle px-3 py-2 text-xs font-semibold leading-5 text-state-danger-text">{afterSalesDeletionError}</p> : null}

          <section className="rounded-xl border border-line bg-layer-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-ink">{afterSalesRoundDeletionPreview.eligible
                  ? (english ? "Records removed together" : "本次一并清理")
                  : (english ? "Linked records" : "当前关联记录")}</h3>
                <p className="mt-1 text-xs leading-5 text-ink-soft">{english
                  ? `${afterSalesRoundDeletionPreview.recordNo} · Repair round ${afterSalesRoundDeletionPreview.roundNo}`
                  : `${afterSalesRoundDeletionPreview.recordNo} · 第 ${afterSalesRoundDeletionPreview.roundNo} 轮维修`}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${afterSalesRoundDeletionPreview.eligible ? "border-state-warning-border bg-state-warning-subtle text-state-warning-text" : "border-state-danger-border bg-state-danger-subtle text-state-danger-text"}`}>{afterSalesRoundDeletionPreview.eligible
                ? (english ? "Eligible to delete" : "可以删除")
                : (english ? "Blocked" : "当前不可删除")}</span>
            </div>
            {afterSalesRoundDeletionCounts.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {afterSalesRoundDeletionCounts.map(({ key, count }) => <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2 text-xs"><span className="text-ink-soft">{english ? AFTER_SALES_DELETION_COUNT_LABELS[key].en : AFTER_SALES_DELETION_COUNT_LABELS[key].zh}</span><strong className="tabular-nums text-ink">{count}</strong></div>)}
            </div> : <p className="mt-3 rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-soft">{english ? "No additional linked records." : "没有其他关联记录。"}</p>}
            {afterSalesRoundDeletionPreview.eligible && afterSalesRoundDeletionPreview.performanceDraftMinor !== null && afterSalesRoundDeletionPreview.performanceDraftMinor !== 0 ? <p className="mt-3 rounded-lg border border-state-warning-border bg-state-warning-subtle px-3 py-2 text-xs leading-5 text-state-warning-text">{english
              ? `The unhanded-off performance draft ${formatFormalMoney(afterSalesRoundDeletionPreview.performanceDraftMinor)} will also be discarded. It has not been counted as formal performance.`
              : `未交单的绩效草稿 ${formatFormalMoney(afterSalesRoundDeletionPreview.performanceDraftMinor)} 也会一并删除；该草稿尚未计入正式绩效。`}</p> : null}
          </section>

          {afterSalesRoundDeletionPreview.blockers.length > 0 ? <section className="rounded-xl border border-state-danger-border bg-state-danger-subtle p-4">
            <h3 className="text-sm font-bold text-state-danger-text">{english ? "Resolve these blockers first" : "请先处理以下阻断项"}</h3>
            <ul className="mt-3 space-y-2">
              {afterSalesRoundDeletionPreview.blockers.map((blocker) => <li key={blocker.code} className="rounded-lg border border-state-danger-border bg-card px-3 py-2 text-xs leading-5 text-ink">
                <strong className="block">{english ? AFTER_SALES_DELETION_BLOCKER_LABELS_EN[blocker.code] ?? blocker.label : blocker.label}</strong>
                {blocker.recordNos?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{blocker.recordNos.map((recordNo) => <span key={recordNo} className="rounded-md bg-layer-2 px-2 py-1 font-mono text-[11px] text-state-danger-text">{recordNo}</span>)}</div> : null}
                {blocker.code === "DOCUMENT_SNAPSHOTS_EXIST" ? <>
                  <p className="mt-2 text-ink-soft">{english ? "Issued documents remain in history. Review the document and its correction options; cancelling a handoff alone does not remove this restriction." : "已生成的正式单据会保留在历史中。请查看单据及更正入口；仅取消交单不会解除这一限制。"}</p>
                  <Link href={`/orders/business/${businessOrderId}?tab=documents`} onClick={closeAfterSalesRoundDeletion} className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-line px-3 font-bold text-primary">{english ? "View issued documents and corrections" : "查看正式单据与更正版本"}</Link>
                </> : blocker.code === "INSPECTION_REPORTS_EXIST" ? <button type="button" onClick={() => { closeAfterSalesRoundDeletion(); document.getElementById("business-order-related-inspections")?.scrollIntoView({ block: "start", behavior: "instant" }); }} className="mt-2 min-h-11 rounded-lg border border-line px-3 font-bold text-primary">{english ? "View this order's inspection reports" : "查看本单检查结果"}</button> : <button type="button" onClick={() => { closeAfterSalesRoundDeletion(); setHistoryOpen(true); }} className="mt-2 min-h-11 rounded-lg border border-line px-3 font-bold text-primary">{english ? "View handoff and performance records" : "查看交单与绩效记录"}</button>}
              </li>)}
            </ul>
          </section> : null}

          {afterSalesRoundDeletionPreview.eligible ? <>
            <ChoiceCards
              legend={english ? "Deletion reason" : "删除原因"}
              name="afterSalesDeletionReason"
              defaultValue=""
              required
              columns={2}
              onValueChange={(value) => setAfterSalesDeletionReason(value as AfterSalesRoundDeletionReasonCode)}
              choices={[
                { value: "duplicate", label: english ? "Duplicate round" : "重复创建", description: english ? "The same after-sales visit was entered twice" : "同一次售后回厂被重复建立" },
                { value: "input_error", label: english ? "Entry error" : "录入错误", description: english ? "The round was attached or entered incorrectly" : "轮次归属或内容录入错误" },
                { value: "test_data", label: english ? "Test data" : "测试数据", description: english ? "This round was created only for testing" : "仅为测试而创建的轮次" },
                { value: "other", label: english ? "Other reason" : "其他原因", description: english ? "Describe the reason below" : "请在下方填写具体原因" },
              ]}
            />
            <label className="block text-xs font-semibold text-ink">{afterSalesDeletionReason === "other"
              ? (english ? "Reason note (required for Other)" : "原因说明（选择其他原因时必填）")
              : (english ? "Reason note (optional)" : "原因说明（可选）")}<textarea required={afterSalesDeletionReason === "other"} value={afterSalesDeletionNote} onChange={(event) => setAfterSalesDeletionNote(event.target.value)} rows={3} maxLength={1000} className="mt-1.5 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm font-normal text-ink" /></label>
            <label className="block text-xs font-semibold text-ink">
              {english ? "Enter the repair-round number to confirm" : "输入轮次编号确认"}
              <span className="mt-1 block font-mono text-[11px] font-normal text-ink-soft">{afterSalesRoundDeletionPreview.recordNo}</span>
              <input value={afterSalesDeletionConfirmation} onChange={(event) => setAfterSalesDeletionConfirmation(event.target.value)} autoComplete="off" spellCheck={false} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3 font-mono text-sm font-normal text-ink" />
            </label>
          </> : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <button type="button" disabled={busy || afterSalesDeletionChecking} onClick={() => void recheckAfterSalesRoundDeletion()} className="min-h-11 rounded-lg border border-line px-4 text-xs font-bold text-primary disabled:opacity-40">{afterSalesDeletionChecking ? (english ? "Checking…" : "正在检查…") : (english ? "Recheck linked records" : "重新检查关联记录")}</button>
            <button type="button" disabled={busy} onClick={closeAfterSalesRoundDeletion} className="min-h-11 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold text-ink disabled:opacity-40">{english ? "Close" : "关闭"}</button>
            {afterSalesRoundDeletionPreview.eligible ? <button type="submit" disabled={!canDeleteAfterSalesRound} className="min-h-10 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? (english ? "Deleting…" : "正在删除…") : (english ? "Delete this repair round" : "确认删除本轮")}</button> : null}
          </div>
        </form> : null}
      </ActionDialog>
      <ActionDialog open={paperReturnOpen && data.capabilities.canWrite} title={english ? "Confirm paper return and hand off" : "确认纸质回单并正式交单"} description={english ? "Record what is available, confirm completed items and performance value. The mechanic and source file can be added later." : "登记当前已有信息，核对完成项目和本轮绩效；维修工和纸质附件都可稍后补录。一次确认完成正式交单。"} onClose={() => setPaperReturnOpen(false)}>
        <form onSubmit={submitPaperReturn}>
          <div className="grid gap-3 sm:grid-cols-[1.35fr_1fr]"><ChoiceCards legend={english ? "Actual mechanic (optional)" : "实际维修工（可选）"} name="actualStaffMemberId" defaultValue="" columns={2} choices={[{ value: "", label: english ? "Not specified" : "未指定", description: english ? "Add later if needed" : "需要时稍后补录" }, ...assignedTeamStaff.map((staff) => ({ value: String(staff.id), label: staff.fullName, description: english ? "Mechanic" : "维修工" }))]} /><label className="text-xs font-semibold">{english ? "Paper return photo / PDF (optional)" : "纸质回单照片 / PDF（可选）"}<input name="paperReturn" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1.5 block min-h-12 w-full rounded-xl border border-line bg-layer-2 p-2 text-xs" /></label></div>
          <fieldset className="mt-4"><legend className="text-xs font-bold">{english ? "Completed items" : "实际完成项目"}</legend><div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-line p-2">{charges.items.map((item) => <label key={item.id} className="flex min-h-10 items-center gap-3 rounded-lg bg-layer-2 px-3 text-xs"><input type="checkbox" name={`item-${item.id}`} defaultChecked className="h-4 w-4" /><span className="min-w-0 flex-1 font-semibold">{english ? item.nameEn || item.nameZh : item.nameZh}</span><span className="text-ink-soft">× {item.quantity}</span></label>)}</div></fieldset>
          <label className="mt-3 block text-xs font-semibold">{english ? "Work completed" : "实际完成情况"}<textarea name="workSummary" rows={3} className="mt-1 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm" /></label><label className="mt-3 block text-xs font-semibold">{english ? "Exceptions / unfinished work" : "异常 / 未完成说明"}<textarea name="exceptionSummary" rows={2} className="mt-1 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm" /></label><label className="mt-3 block text-xs font-semibold">{english ? "Round performance value (JMD)" : "本轮绩效值（JMD）"}<input name="performanceValue" required readOnly value={String(currentRoundPerformanceMinor / 100)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm" /></label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPaperReturnOpen(false)} className="min-h-10 rounded-lg border border-line px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? (english ? "Saving…" : "正在保存…") : (english ? "Confirm and formally hand off" : "确认并正式交单")}</button></div>
        </form>
      </ActionDialog>
      <ActionDialog open={returnReviewOpen && Boolean(rounds?.current.latestWorkReturn)} title={english ? "Review mechanic work return" : "审核维修工回单"} description={english ? "Review the actual mechanic, completed items, exceptions and supporting photos before approving or returning it." : "核对实际维修工、完成项目、异常说明和维修照片，再决定通过或退回。"} onClose={() => setReturnReviewOpen(false)}>
        {rounds?.current.latestWorkReturn ? <form onSubmit={approveLatestReturn} className="space-y-4 text-sm"><div className="grid gap-3 rounded-xl bg-layer-2 p-3 sm:grid-cols-2"><span><small className="block text-ink-soft">{english ? "Actual mechanic" : "实际维修工"}</small><strong>{rounds.current.latestWorkReturn.actualStaffName ?? "—"}</strong></span><span><small className="block text-ink-soft">{english ? "Submitted" : "提交时间"}</small><strong>{formatDateTime(rounds.current.latestWorkReturn.submittedAt)}</strong></span></div>{rounds.current.latestWorkReturn.workSummary ? <section><h3 className="text-xs font-bold">{english ? "Work completed" : "实际完成情况"}</h3><p className="mt-1 rounded-xl border border-line p-3 leading-6">{rounds.current.latestWorkReturn.workSummary}</p></section> : null}{rounds.current.latestWorkReturn.exceptionSummary ? <section><h3 className="text-xs font-bold text-amber-800">{english ? "Exceptions / unfinished work" : "异常 / 未完成说明"}</h3><p className="mt-1 rounded-xl bg-amber-50 p-3 leading-6 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{rounds.current.latestWorkReturn.exceptionSummary}</p></section> : null}<section><h3 className="text-xs font-bold">{english ? "Item results" : "施工项目结果"}</h3><div className="mt-2 divide-y divide-line rounded-xl border border-line">{rounds.current.latestWorkReturn.itemResults.length ? rounds.current.latestWorkReturn.itemResults.map((item) => <div key={item.chargeItemId} className="flex items-center gap-3 px-3 py-2 text-xs"><span className="min-w-0 flex-1 font-semibold">{english ? item.labelEn || item.labelZh : item.labelZh}</span><strong className={item.result === "completed" ? "text-emerald-700" : "text-rose-700"}>{item.result === "completed" ? (english ? "Completed" : "已完成") : (english ? "Not completed" : "未完成")}</strong></div>) : <p className="p-3 text-xs text-ink-soft">{english ? "No item-level result was recorded." : "未记录逐项施工结果。"}</p>}</div></section>{rounds.current.latestWorkReturn.attachments.length ? <section><h3 className="text-xs font-bold">{english ? "Attachments" : "回单附件"}</h3><div className="mt-2 flex flex-wrap gap-2">{rounds.current.latestWorkReturn.attachments.map((attachment) => <a key={attachment.id} href={`/api/formal/business-orders/${businessOrderId}/attachments/${attachment.id}`} target="_blank" rel="noreferrer" className="rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary">{attachment.originalName}</a>)}</div></section> : null}<label className="block text-xs font-semibold">{english ? "Round performance value (JMD)" : "本轮绩效值（JMD）"}<input name="performanceValue" required readOnly value={String(currentRoundPerformanceMinor / 100)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm" /></label><div className="flex justify-end gap-2 border-t border-line pt-4"><button type="button" onClick={() => setRejectReturnOpen(true)} className="min-h-10 rounded-lg border border-rose-400 px-4 text-xs font-bold text-rose-700">{english ? "Return for correction" : "退回修改"}</button><button disabled={busy} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{english ? "Approve and formally hand off" : "审核通过并正式交单"}</button></div></form> : null}
      </ActionDialog>
      <ActionDialog open={rejectReturnOpen} title={english ? "Return work return for correction" : "退回维修回单"} description={english ? "The mechanic will see this reason and can resubmit a corrected work return." : "维修工会看到这条原因，并可补充后重新提交回单。"} onClose={() => setRejectReturnOpen(false)}><form onSubmit={rejectLatestReturn}><label className="text-xs font-semibold">{english ? "Return reason" : "退回原因"}<textarea name="reason" required autoFocus rows={4} className="mt-1 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRejectReturnOpen(false)} className="min-h-10 rounded-lg border border-line px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} className="min-h-10 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white">{english ? "Return to mechanic" : "确认退回"}</button></div></form></ActionDialog>
      <ActionDialog open={formalHandoffOpen && Boolean(rounds?.current.approvedWorkReturnId)} title={english ? "Formal handoff" : "正式交单"} description={english ? "The work return is approved. Confirm the performance value to complete this repair round." : "维修回单已经审核通过。确认本轮绩效值后完成正式交单。"} onClose={() => setFormalHandoffOpen(false)}><form onSubmit={submitFormalHandoff}><label className="text-xs font-semibold">{english ? "Round performance value (JMD)" : "本轮绩效值（JMD）"}<input name="performanceValue" required readOnly value={String(currentRoundPerformanceMinor / 100)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setFormalHandoffOpen(false)} className="min-h-10 rounded-lg border border-line px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white">{english ? "Complete formal handoff" : "确认正式交单"}</button></div></form></ActionDialog>
      <ActionDialog open={performanceEditorOpen && Boolean(performanceEditTarget) && data.capabilities.canWrite}
        title={performanceEditTarget?.handoffId ? (english ? `Adjust handed-off performance for repair round ${performanceEditTarget.roundNo}` : `调整第 ${performanceEditTarget.roundNo} 轮已交单绩效`) : (english ? "Edit performance" : "修改绩效值")}
        description={performanceEditTarget?.handoffId ? (english ? "The original handoff remains in history. This adjustment corrects performance in the same Jamaica month and preserves the charge snapshot." : "原交单记录会保留；本次调整只更正同一牙买加自然月内的绩效，原收费版本和收费快照保持不变。") : (english ? "Save this repair round's performance draft with an audit trail." : "保存当前维修轮次的绩效草稿，并保留审计记录。")}
        onClose={closePerformanceEditor}>
        <form onSubmit={submitPerformanceDraft}>
          <p className="mb-3 text-xs leading-5 text-ink-soft">{english ? `Repair round ${performanceEditTarget?.roundNo}. ` : `第 ${performanceEditTarget?.roundNo} 轮。`}{performanceRetentionLabel}</p>
          {performanceEditError ? <p role="alert" className="mb-3 rounded-lg border border-state-danger-border bg-state-danger-subtle px-3 py-2 text-xs font-semibold text-state-danger-text">{performanceEditError}</p> : null}
          {performanceEditError ? <div className="mb-3 rounded-lg border border-line p-3 text-xs leading-5"><p>{english ? "The save result is not confirmed. Check the latest records before trying again. If the original round or handoff has changed, discard this draft and start a new adjustment from that record." : "保存结果尚未确认，请先核对最新记录再决定是否重试。如原轮次或交单已变化，请放弃这份草稿，从最新记录重新发起调整。"}</p><button type="button" disabled={performanceSaving || performanceChecking} onClick={() => void checkPerformanceHistory()} className="mt-2 min-h-11 rounded-lg border border-primary px-3 font-bold text-primary disabled:opacity-50">{performanceChecking ? (english ? "Checking…" : "正在核对…") : (english ? "Check latest performance records" : "核对最新绩效记录")}</button></div> : null}
          <label className="block text-xs font-semibold">{english ? "Round performance value (JMD)" : "本轮绩效值（JMD）"}
            <input name="performanceValue" required autoFocus inputMode="decimal" readOnly={performanceSaving} value={performanceValueDraft} onChange={(event) => setPerformanceValueDraft(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm" />
          </label>
          {performanceEditTarget?.handoffId ? <label className="mt-3 block text-xs font-semibold">{english ? "Adjustment reason" : "调整原因"}
            <textarea name="reason" required rows={3} readOnly={performanceSaving} value={performanceReasonDraft} onChange={(event) => setPerformanceReasonDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm" />
          </label> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {!performanceSaving ? <button type="button" disabled={performanceChecking} onClick={discardPerformanceDraft} className="min-h-11 rounded-lg border border-line px-4 text-xs font-bold">{english ? "Discard draft" : "放弃草稿"}</button> : null}
            <button type="button" onClick={closePerformanceEditor} className="min-h-11 rounded-lg border border-line px-4 text-xs font-bold">{english ? "Close window" : "关闭窗口"}</button>
            <button disabled={busy || performanceSaving || performanceChecking} className="min-h-11 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-50">{performanceSaving ? (english ? "Saving…" : "正在保存…") : performanceEditTarget?.handoffId ? (english ? "Confirm performance adjustment" : "确认调整绩效") : (english ? "Save performance" : "保存绩效值")}</button>
          </div>
        </form>
      </ActionDialog>
      <ActionDialog open={paymentFormOpen && data.capabilities.canRecordPayment} title={english ? "Record a payment" : "登记一笔收款"} description={english ? "Saving creates an immutable payment record and its corresponding Receipt." : "保存后立即形成一笔不可修改的收款事实，并生成对应 Receipt。"} onClose={() => setPaymentFormOpen(false)}>
        <form onSubmit={submitPayment}>
          <div className="grid gap-3 sm:grid-cols-[.8fr_1.2fr]"><label className="text-xs font-semibold">{english ? "Amount (JMD)" : "金额（JMD）"}<input name="amount" inputMode="decimal" required autoFocus className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-layer-2 px-3 text-sm text-ink" /></label><ChoiceCards legend={english ? "Payment method" : "收款方式"} name="paymentMethodItemId" required columns={3} choices={data.paymentMethods.map((method) => ({ value: String(method.id), label: english ? method.labelEn || "Translation required" : method.labelZh, description: english ? method.labelZh : method.labelEn }))} /></div>
          <label className="mt-3 block text-xs font-semibold">{english ? "Note" : "备注"}<input name="note" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink" /></label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPaymentFormOpen(false)} className="min-h-10 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} type="submit" className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? (english ? "Recording…" : "正在登记…") : (english ? "Record payment and generate Receipt" : "收款并生成 Receipt")}</button></div>
        </form>
      </ActionDialog>
      <ActionDialog open={refundFormOpen && data.capabilities.canRefund} title={english ? "Record a refund" : "登记一笔退款"} description={english ? "Record the refund and generate an acknowledgement. Print it for the customer's handwritten signature, then upload the signed copy later." : "先登记退款并生成签收单；打印后由客户手写签字，签字件可随后回传。"} onClose={() => setRefundFormOpen(false)}>
        <form onSubmit={submitRefund}>
          <div className="grid gap-3 sm:grid-cols-[.8fr_1.2fr]"><label className="text-xs font-semibold">{english ? "Amount (JMD)" : "金额（JMD）"}<input name="amount" inputMode="decimal" required autoFocus className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-layer-2 px-3 text-sm text-ink" /></label><ChoiceCards legend={english ? "Refund method" : "退款方式"} name="paymentMethodItemId" required columns={3} choices={data.paymentMethods.map((method) => ({ value: String(method.id), label: english ? method.labelEn || "Translation required" : method.labelZh, description: english ? method.labelZh : method.labelEn }))} /></div>
          <label className="mt-3 block text-xs font-semibold">{english ? "Refund reason" : "退款原因"}<textarea name="reason" required className="mt-1 min-h-20 w-full rounded-lg border border-line bg-layer-2 p-3 text-sm text-ink" /></label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><ChoiceCards legend={english ? "Original customer document" : "原客户单据"} name="originalDocumentStatus" required defaultValue="returned" columns={2} choices={[{ value: "returned", label: english ? "Original returned" : "原单已交回" }, { value: "unavailable", label: english ? "Original unavailable" : "原单无法交回" }]} /><label className="text-xs font-semibold">{english ? "Reason original is unavailable" : "无法交回说明"}<input name="originalDocumentNote" className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-layer-2 px-3 text-sm text-ink" /></label></div>
          <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">{english ? "After completing a non-cash refund transfer, upload the transfer proof to the refund record." : "非现金退款完成转账后，需在该笔退款记录中补传转账凭证。"}</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRefundFormOpen(false)} className="min-h-10 rounded-lg border border-line bg-layer-2 px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy} type="submit" className="min-h-10 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? (english ? "Recording…" : "正在登记…") : (english ? "Record refund and generate acknowledgement" : "登记退款并生成签收单")}</button></div>
        </form>
      </ActionDialog>
      {inspectionCreateOpen ? <FormalInspectionCreateDialog key={data?.currentAccountId ?? "unverified"} initialDraft={inspectionCreationRecovery.draft} onBackgroundStatus={inspectionCreationRecovery.track} vehicleId={order.vehicleId} vehicleLabel={`${order.vehicle.plate} · ${order.vehicle.description}`} submitLabel={english ? "Create and open report" : "创建并打开报告"} sourceBusinessOrderId={businessOrderId} onClose={() => { setInspectionCreateOpen(false); inspectionCreationRecovery.clearDraft(); }} onCreated={(report, context) => { if (!inspectionCreationRecovery.isCurrentScope()) return; if (context?.background) { refresh(); return; } router.push(`/orders/inspections/${report.id}`); setInspectionCreateOpen(false); inspectionCreationRecovery.clearDraft(); }} /> : null}
    </div>
  );
}
