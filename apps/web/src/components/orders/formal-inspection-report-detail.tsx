"use client";

import { FormEvent, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Bot, FileText, Paperclip, Plus, Printer, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import {
  fetchFormalInspectionReport,
  organizeFormalInspectionReport,
  recordFormalInspectionNotification,
  saveFormalInspectionWorkspace,
  sendFormalInspectionSms,
  type FormalInspectionCommunication,
  type FormalInspectionOrganized,
  type FormalInspectionQuotation,
  type FormalInspectionReportDetail,
} from "@/lib/api/formal-inspections";
import {
  deriveInspectionFollowupStage,
  calculateInspectionQuotationLineSubtotalMinor,
  inspectionContentVersionLabel,
  inspectionFollowupStageLabel,
  inspectionTeamNameForReport,
  inspectionVehicleDescriptionForReport,
  summarizeInspectionQuotation,
} from "@/lib/inspection/formal-inspection-ai";
import { formatDateTime } from "@/lib/utils";
import { RecordDeleteButton } from "@/components/shared/record-delete-dialog";
import { ChoiceCards } from "@/components/shared/choice-cards";
import { useI18n } from "@/lib/i18n/language";
import headerStyles from "./inspection-report-header.module.css";
import readerStyles from "./inspection-report-reader.module.css";
import editorStyles from "./inspection-editor.module.css";
import { Dialog } from "@/components/ui/dialog";
import { printInspectionSheet } from "@/lib/orders/inspection-html-print";
import { inspectionMoney as money, quotationStatusLabel, quotationDisplayStatus, quotationAmount, quotationUnit } from "@/lib/orders/formal-inspection-document";
import { InspectionPdfDownload } from "./inspection-pdf-download";

type Workspace = "inspection" | "report" | "followup" | "attachments" | "history";
type Proposal = { organized: FormalInspectionOrganized; quotation: FormalInspectionQuotation; expectedVersion: number };
type ReportLanguage = "zh" | "en" | "bilingual";

const TABS: Array<{ id: Workspace; zh: string; en: string; icon: typeof FileText }> = [
  { id: "inspection", zh: "检查与报价", en: "Inspection & quote", icon: Sparkles },
  { id: "report", zh: "正式报告", en: "Formal report", icon: FileText },
  { id: "followup", zh: "客户跟进", en: "Customer follow-up", icon: Send },
  { id: "attachments", zh: "业务附件", en: "Attachments", icon: Paperclip },
  { id: "history", zh: "历史记录", en: "History", icon: RefreshCw },
];

const channelLabel = { sms: "短信", email: "Email", whatsapp: "WhatsApp" } as const;
function inputMoneyMinor(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function cloneWorkspace(detail: FormalInspectionReportDetail): Proposal {
  return { organized: structuredClone(detail.workspace.organized), quotation: structuredClone(detail.workspace.quotation), expectedVersion: detail.report.version };
}

export function FormalInspectionReportDetailView({ inspectionReportId }: { inspectionReportId: number }) {
  return <InspectionReportDetailContent key={inspectionReportId} inspectionReportId={inspectionReportId} />;
}

function InspectionReportDetailContent({ inspectionReportId }: { inspectionReportId: number }) {
  const searchParams = useSearchParams();
  const listQuery = new URLSearchParams();
  const listSearch = searchParams.get("listSearch");
  const listPage = Number(searchParams.get("listPage"));
  if (listSearch) listQuery.set("search", listSearch);
  if (Number.isSafeInteger(listPage) && listPage > 1) listQuery.set("page", String(listPage));
  const listHref = `/orders/inspections${listQuery.size ? `?${listQuery.toString()}` : ""}`;
  const { language } = useI18n();
  const english = language === "en";
  const [detail, setDetail] = useState<FormalInspectionReportDetail | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("inspection");
  const [draft, setDraftState] = useState<Proposal | null>(null);
  // Keep the event-time draft available to delayed save responses. A save
  // confirms its submitted snapshot, not edits made while that request waits.
  const currentDraft = useRef<Proposal | null>(null);
  const setDraft = useCallback((update: SetStateAction<Proposal | null>) => {
    const next = typeof update === "function" ? update(currentDraft.current) : update;
    currentDraft.current = next;
    setDraftState(next);
  }, []);
  const workspaceSaveInFlight = useRef(false);
  const replyInFlight = useRef(false);
  const [replySaving, setReplySaving] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const aiRequest = useRef(0);
  const aiController = useRef<AbortController | null>(null);
  const [pendingAi, setPendingAi] = useState<Proposal | null>(null);
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [beforeAiDraft, setBeforeAiDraft] = useState<Proposal | null>(null);
  useEffect(() => () => {
    aiRequest.current += 1;
    aiController.current?.abort();
  }, []);
  const [statusCorrectionOpen, setStatusCorrectionOpen] = useState(false);
  const [statusCorrectionError, setStatusCorrectionError] = useState<string | null>(null);
  const [statusCorrectionSaving, setStatusCorrectionSaving] = useState(false);
  const [submittedCorrection, setSubmittedCorrection] = useState<{ stage: string; reason: string } | null>(null);
  const statusCorrectionInFlight = useRef(false);
  const closeStatusCorrection = () => {
    setStatusCorrectionOpen(false);
  };
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonLatest, setComparisonLatest] = useState<FormalInspectionReportDetail | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const comparisonRequest = useRef(0);
  const [reload, setReload] = useState(0);
  const load = useCallback(() => fetchFormalInspectionReport(inspectionReportId).then((next) => {
    setDetail(next);
    // Follow-up/history refreshes must not replace the report being edited.
    // Explicit save and revert paths remain responsible for replacing a draft.
    setDraft((current) => current ?? cloneWorkspace(next));
    setLoadError(null);
  }), [inspectionReportId, setDraft]);

  useEffect(() => {
    void load().catch((caught) => setLoadError(caught instanceof Error ? caught.message : "Inspection Report 读取失败"));
  }, [load, reload]);

  const notify = async (channel: "sms" | "email" | "whatsapp") => {
    if (!detail) return;
    const target = channel === "email" ? detail.customer.email : channel === "whatsapp" ? detail.customer.whatsapp ?? detail.customer.phone : detail.customer.phone;
    if (!target) { setError(`该客户没有可用${channelLabel[channel]}联系方式`); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const message = `${detail.vehicle.plate} 检查报告 ${detail.report.reportNo}：${detail.workspace.organized.summaryZh}`;
      if (channel === "sms") {
        await sendFormalInspectionSms({ inspectionReportId, targetContact: target, message });
        setNotice(english ? "The SMS provider accepted the message. A customer reply is still pending." : "短信接口已接受发送；系统继续等待客户回复。");
      } else {
        await recordFormalInspectionNotification({ inspectionReportId, channel, targetContact: target, noteOrReply: "已发起外部通知，待客户确认。" });
        const text = encodeURIComponent(message);
        const href = channel === "email"
          ? `mailto:${target}?subject=${encodeURIComponent(`Inspection Report ${detail.report.reportNo}`)}&body=${text}`
          : `https://wa.me/${target.replace(/\D/g, "")}?text=${text}`;
        window.open(href, "_blank", "noopener,noreferrer");
        setNotice(english ? "Contact action recorded. Delivery is awaiting confirmation." : "已记录发送动作；系统仍等待人工确认客户是否收到并回复。");
      }
      setReload((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知留痕失败"); } finally { setBusy(false); }
  };

  const correctFollowupStage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || busy || statusCorrectionInFlight.current) return;
    const fields = new FormData(event.currentTarget);
    const nextStage = String(fields.get("followupStage"));
    const reason = String(fields.get("reason") ?? "").trim();
    if (!reason || !["ready", "waiting", "closed"].includes(nextStage)) {
      setStatusCorrectionError(english ? "Choose a stage and enter the correction reason." : "请选择跟进状态并填写更正原因。");
      return;
    }
    const latest = detail.communications[0];
    const status = nextStage === "closed" ? "confirmed" : nextStage === "waiting" ? "initiated" : "not_delivered";
    statusCorrectionInFlight.current = true;
    setSubmittedCorrection({ stage: nextStage, reason });
    setStatusCorrectionSaving(true);
    setStatusCorrectionError(null);
    setBusy(true); setError(null); setNotice(null);
    try {
      await recordFormalInspectionNotification({
        inspectionReportId,
        channel: latest?.channel ?? "whatsapp",
        targetContact: latest?.targetContact ?? detail.customer.whatsapp ?? detail.customer.phone ?? "前台人工更正",
        noteOrReply: `状态更正：${reason}`,
        status,
        eventKind: "status_correction",
      });
      setStatusCorrectionOpen(false);
      setSubmittedCorrection(null);
      setNotice(english ? "The current stage was corrected. Earlier history remains intact." : "当前跟进状态已更正；旧记录完整保留。");
      setReload((value) => value + 1);
    } catch (caught) {
      setStatusCorrectionError(caught instanceof Error ? caught.message : (english ? "Could not save the correction" : "跟进状态更正失败"));
    } finally {
      statusCorrectionInFlight.current = false;
      setStatusCorrectionSaving(false);
      setBusy(false);
    }
  };

  const recordReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || busy || replyInFlight.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const submittedReply = String(fields.get("reply") ?? "");
    const note = submittedReply.trim();
    if (!note) return;
    replyInFlight.current = true;
    setReplySaving(true);
    setBusy(true); setError(null); setNotice(null);
    try {
      await recordFormalInspectionNotification({ inspectionReportId, channel: "whatsapp", targetContact: detail.customer.whatsapp ?? detail.customer.phone ?? "前台人工登记", noteOrReply: note, status: "confirmed", eventKind: "reply" });
      const hasLaterEdits = String(new FormData(form).get("reply") ?? "") !== submittedReply;
      setNotice(hasLaterEdits
        ? (english ? "Submitted response recorded. Your later input is preserved and has not been submitted." : "已记录本次提交的回复；后续输入仍保留，尚未提交。")
        : (english ? "Customer response recorded; this follow-up is closed." : "已记录客户回复，本次检查报告跟进闭环。"));
      if (!hasLaterEdits) form.reset();
      setReload((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "客户回复记录失败"); } finally { replyInFlight.current = false; setReplySaving(false); setBusy(false); }
  };

  const stageAi = (next: Proposal) => {
    setBeforeAiDraft(currentDraft.current);
    setProposal(next);
    setDraft(next);
  };
  const revertAi = () => {
    if (beforeAiDraft) setDraft(beforeAiDraft);
    setProposal(null);
    setBeforeAiDraft(null);
    setNotice(null);
  };
  const stopAi = () => {
    aiRequest.current += 1;
    aiController.current?.abort();
    aiController.current = null;
    setAiBusy(false);
    setNotice(english ? "Stopped waiting for AI. Your draft is unchanged; you can try again." : "已停止等待 AI，当前草稿保留，可重新整理。");
  };
  const runAi = async (instruction?: string) => {
    if (!detail || busy || aiController.current) return;
    const request = ++aiRequest.current;
    const controller = new AbortController();
    aiController.current = controller;
    const baseDraft = currentDraft.current;
    setPendingAi(null);
    setAiReviewOpen(false);
    setAiBusy(true); setError(null); setNotice(null);
    try {
      const next = await organizeFormalInspectionReport(detail, { currentDraft: baseDraft ?? undefined, instruction, signal: controller.signal });
      if (request !== aiRequest.current) return;
      const nextDraft = { ...next, expectedVersion: baseDraft?.expectedVersion ?? detail.report.version };
      if (currentDraft.current !== baseDraft) {
        setPendingAi(nextDraft);
      } else {
        stageAi(nextDraft);
        setNotice(english ? "The bilingual AI draft is now in the main workspace. Review and save it when ready." : "AI 已把双语报告和报价放入主工作区；核对无误后再保存。");
      }
    } catch (caught) {
      if (request === aiRequest.current) setError(caught instanceof Error ? caught.message : "AI 整理失败；当前草稿已保留，可重新整理。");
    } finally {
      if (request === aiRequest.current) { aiController.current = null; setAiBusy(false); }
    }
  };

  const persist = async (source: "manual" | "ai", next: Proposal) => {
    if (!detail || busy || workspaceSaveInFlight.current) return;
    workspaceSaveInFlight.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = await saveFormalInspectionWorkspace(inspectionReportId, {
        expectedVersion: next.expectedVersion,
        organized: next.organized,
        quotation: next.quotation,
        source,
        changeReason: source === "ai" ? "AI 整理后由前台确认" : "前台修改检查报告与报价",
      });
      const laterDraft = currentDraft.current;
      const hasLaterEdits = laterDraft !== null && laterDraft !== next;
      setDetail(saved);
      setDraft(hasLaterEdits ? { ...laterDraft, expectedVersion: saved.report.version } : cloneWorkspace(saved));
      if (!hasLaterEdits) setProposal(null);
      setNotice(hasLaterEdits
        ? (english ? "The submitted version was saved. Later edits are still unsaved; review and save them when ready." : "提交的版本已保存；后续修改尚未保存，请核对后再次保存。")
        : (english ? "A new report draft version was saved. The original return is unchanged." : "已保存新的报告草稿版本；维修工原始回单没有被覆盖。"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "报告草稿保存失败"); } finally { workspaceSaveInFlight.current = false; setBusy(false); }
  };

  const compareLatest = async () => {
    const request = ++comparisonRequest.current;
    setComparisonOpen(true);
    setComparisonBusy(true);
    setComparisonLatest(null);
    setComparisonError(null);
    try {
      const latest = await fetchFormalInspectionReport(inspectionReportId);
      if (request === comparisonRequest.current) setComparisonLatest(latest);
    } catch (caught) {
      if (request === comparisonRequest.current) setComparisonError(caught instanceof Error ? caught.message : "最新版本读取失败");
    } finally {
      if (request === comparisonRequest.current) setComparisonBusy(false);
    }
  };
  const closeComparison = () => {
    comparisonRequest.current += 1;
    setComparisonOpen(false);
    setComparisonBusy(false);
  };
  const adoptComparedDraft = (keepMine: boolean) => {
    if (!comparisonLatest || !draft) return;
    setDetail(comparisonLatest);
    setDraft(keepMine ? { ...draft, expectedVersion: comparisonLatest.report.version } : cloneWorkspace(comparisonLatest));
    setProposal(null);
    setWorkspace("inspection");
    setError(null);
    setNotice(english ? "The selected version is in your draft. Review or edit it, then save a new version." : "已载入选定草稿；可继续编辑，点击保存版本后才会写入。");
    closeComparison();
  };

  if (loadError && !detail) return <div className="p-5 text-center"><AlertCircle className="mx-auto text-rose-600" /><p className="mt-2 text-sm">{loadError}</p><button className="mt-3 rounded-lg border px-3 py-2 text-xs" onClick={() => setReload((value) => value + 1)}><RefreshCw size={13} className="mr-1 inline" />重试</button></div>;
  if (!detail || !draft) return <div className="m-5 h-[720px] animate-pulse rounded-[22px] bg-layer-2" />;

  const flowStage = detail.followupStage
    ?? deriveInspectionFollowupStage(detail.workspace.versionNo, detail.communications);
  const presentationLanguage = english ? "en" : "zh";
  const interfaceVehicleDescription = inspectionVehicleDescriptionForReport(
    detail.vehicle,
    presentationLanguage,
  );
  const stages = ([0, 1, 2, 3] as const).map((stage) => inspectionFollowupStageLabel(stage, presentationLanguage));
  return <div className="inspection-report-page min-h-full bg-page px-3 py-3 text-ink sm:px-5 xl:h-full xl:min-h-0 xl:overflow-hidden">
    <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-2 xl:h-full xl:min-h-0">
      <header className="shrink-0 rounded-[22px] border border-line bg-card p-4 shadow-card">
        {detail.sourceBusinessOrder ? <Link data-testid="inspection-source-order" href={`/orders/business/${detail.sourceBusinessOrder.id}`} className="mb-3 inline-flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-line bg-layer-2 px-3 py-2 text-xs font-semibold text-primary"><ArrowLeft size={14} /><span>{english ? "Back to source Business Order" : "返回来源业务单"}</span><span className="font-mono">{detail.sourceBusinessOrder.orderNo}</span></Link> : null}
        <div className={headerStyles.heading}>
          <div className="min-w-0">
            <Link href={listHref} className={headerStyles.backLink}><ArrowLeft size={14} />{english ? "Back to Inspection Reports" : "返回检查结果列表"}</Link>
            <h1 className={headerStyles.reportNumber}>{detail.report.reportNo}</h1>
          </div>
          <div className={headerStyles.actions}>
            <span className="rounded-full bg-accent-subtle px-3 py-1.5 text-xs font-bold text-accent">{inspectionFollowupStageLabel(flowStage, presentationLanguage)}</span>
            <span className="rounded-full border border-line bg-layer-2 px-3 py-1.5 text-[11px] font-semibold text-ink-soft">{inspectionContentVersionLabel(detail.workspace.versionNo, presentationLanguage)}</span>
            <RecordDeleteButton record={{ kind: "inspection_report", recordNo: detail.report.reportNo, version: detail.report.version }} title={english ? "Delete Inspection Report" : "删除检查结果"} returnTo="/orders/inspections" onReviewBlockers={(preview) => setWorkspace(preview.blockers.some((blocker) => blocker.code === "HAS_CUSTOMER_COMMUNICATION") ? "followup" : "history")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-state-danger-border px-3 text-xs font-semibold text-state-danger-text" />
          </div>
        </div>
        <div className={headerStyles.identity}>
          <div data-testid="inspection-report-vehicle" className={headerStyles.identityCard}>
            <span className={headerStyles.label}>{english ? "Vehicle" : "车辆"}</span>
            <p className={headerStyles.identityValue}>{detail.vehicle.plate} · {interfaceVehicleDescription}</p>
          </div>
          <div data-testid="inspection-report-customer" className={headerStyles.identityCard}>
            <span className={headerStyles.label}>{english ? "Customer" : "车主 / 客户"}</span>
            <p className={headerStyles.identityValue}>{detail.customer.name ?? (english ? "Customer not recorded" : "未登记客户")}</p>
            <p className="mt-1 text-xs text-ink-soft">{detail.teamName} · {detail.inspectorName ?? (english ? "Mechanic not specified" : "未指定维修工")}</p>
          </div>
        </div>
        <div className={headerStyles.progress}>
          <div className={headerStyles.stages}>{stages.map((stage, index) => <div key={stage} className={`rounded-lg border px-2 py-2 text-center text-[11px] font-bold ${index < flowStage ? "border-primary bg-primary text-white" : index === flowStage ? "border-state-warning-border bg-state-warning-subtle text-state-warning-text" : "border-line bg-layer-2 text-ink-soft"}`}>{index + 1} {stage}</div>)}</div>
          <button type="button" onClick={() => setStatusCorrectionOpen(true)} className={headerStyles.correctStage}>{english ? "Correct stage" : "更正跟进状态"}</button>
        </div>
      </header>
      <Dialog open={statusCorrectionOpen} title={english ? "Correct follow-up stage" : "更正跟进状态"} closeLabel={english ? "Close stage correction" : "关闭更正跟进状态"} onClose={closeStatusCorrection} mobileFullscreen className="sm:max-w-lg">
        <form onSubmit={correctFollowupStage} className="p-4 sm:p-5" aria-busy={busy}>
          <p className="mb-4 text-sm text-ink-soft">{english ? "A correction appends a new fact; earlier history is never deleted." : "更正只追加记录，不删除旧历史。"}</p>
          {statusCorrectionSaving ? <p role="status" className="mb-4 rounded-xl border border-line bg-layer-2 p-3 text-sm">{english ? "Still waiting for the save response. You may return to the report. Closing this window does not cancel the save; do not submit it again." : "保存尚未返回，可以先返回报告。关闭窗口不会取消保存，请勿重复提交。"}</p> : null}
          {statusCorrectionError ? <div role="alert" className="mb-4 rounded-xl border border-state-danger-border bg-state-danger-subtle p-3 text-sm text-state-danger-text"><p>{statusCorrectionError}</p><p className="mt-1">{english ? "Your selection and reason are kept. Check follow-up history before retrying if the connection was interrupted." : "所选状态与原因已保留。如连接中断，请先核对客户跟进历史，再决定是否重新保存。"}</p><button type="button" onClick={() => { closeStatusCorrection(); setWorkspace("followup"); }} className="mt-2 min-h-11 rounded-lg border border-line bg-card px-3 text-sm font-semibold">{english ? "Check follow-up history" : "核对客户跟进历史"}</button></div> : null}
          <fieldset disabled={busy} className="min-w-0">
            <ChoiceCards legend={english ? "Correct current stage" : "把当前状态更正为"} name="followupStage" defaultValue={submittedCorrection?.stage ?? (flowStage === 3 ? "closed" : flowStage === 2 ? "waiting" : "ready")} columns={3} choices={[{ value: "ready", label: english ? "Ready to send" : "待发送" }, { value: "waiting", label: english ? "Awaiting reply" : "待回复" }, { value: "closed", label: english ? "Closed" : "已闭环" }]} />
            <label className="mt-4 block text-sm font-bold">{english ? "Correction reason" : "更正原因"}<textarea name="reason" required rows={3} defaultValue={submittedCorrection?.reason ?? ""} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm" /></label>
          </fieldset>
          <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-line bg-card py-3">
            <button type="button" onClick={closeStatusCorrection} className="min-h-11 rounded-xl border border-line px-4 text-sm font-bold">{statusCorrectionSaving ? (english ? "Return to report" : "返回报告") : (english ? "Cancel" : "取消")}</button>
            <button disabled={busy} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-40">{busy ? (english ? "Saving…" : "正在保存…") : (english ? "Save correction" : "保存更正")}</button>
          </div>
        </form>
      </Dialog>
      {!statusCorrectionOpen && statusCorrectionSaving ? <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-layer-2 px-4 py-3 text-sm"><p>{english ? "The stage correction save is still pending. Closing the window has not cancelled it." : "跟进状态更正的保存尚未返回。关闭窗口没有取消这次保存。"}</p><button type="button" onClick={() => setStatusCorrectionOpen(true)} className="min-h-11 rounded-lg border border-line bg-card px-3 font-semibold">{english ? "View save progress" : "查看保存进度"}</button></div> : null}
      {!statusCorrectionOpen && statusCorrectionError ? <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-3 text-sm text-state-danger-text"><p>{statusCorrectionError}</p><button type="button" onClick={() => setStatusCorrectionOpen(true)} className="min-h-11 rounded-lg border border-line bg-card px-3 font-semibold">{english ? "Review correction" : "查看更正内容"}</button></div> : null}
      {notice ? <p role="status" className="shrink-0 rounded-xl border border-state-success-border bg-state-success-subtle px-4 py-2 text-xs font-semibold text-state-success-text">{notice}</p> : null}
      {error ? <p role="alert" className="shrink-0 rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-2 text-xs font-semibold text-state-danger-text">{error}</p> : null}
      {loadError ? <div role="alert" className="shrink-0 rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-2 text-xs text-state-danger-text"><p>{loadError}</p><button type="button" className="mt-1 min-h-11 rounded-lg border px-3 font-semibold" onClick={() => setReload((value) => value + 1)}>{english ? "Reload report and history" : "重新读取报告与历史"}</button></div> : null}
      {pendingAi ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-layer-2 px-4 py-3 text-sm" role="status"><p>{english ? "Your draft changed while AI was working. Review the suggestion before applying it." : "整理期间草稿已修改，AI 建议已保留，核对后再决定是否采用。"}</p><button type="button" onClick={() => setAiReviewOpen(true)} className="min-h-11 rounded-lg border border-primary px-3 font-semibold text-primary">{english ? "Review AI suggestion" : "查看 AI 建议"}</button></div> : null}
      <Dialog open={aiReviewOpen && !!pendingAi} title={english ? "Compare AI suggestion" : "核对 AI 建议"} closeLabel={english ? "Close AI comparison" : "关闭 AI 核对"} onClose={() => setAiReviewOpen(false)} mobileFullscreen>
        {pendingAi ? <div className="p-4 sm:p-5">
          <p className="text-sm leading-6 text-ink-soft">{english ? "Applying replaces the current draft with the suggestion. You can edit or undo it before saving a version." : "应用会把建议载入当前草稿；可继续编辑或撤销，保存版本后才会写入。"}</p>
          <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2"><ComparisonSnapshot title={english ? "My current draft" : "我的当前草稿"} draft={draft} english={english} /><ComparisonSnapshot title={english ? "AI suggestion" : "AI 建议"} draft={pendingAi} english={english} /></div>
          <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 border-t border-line bg-card py-3">
            <button type="button" onClick={() => { setPendingAi(null); setAiReviewOpen(false); }} className="min-h-11 flex-1 rounded-xl border border-line px-4 py-2 text-sm font-bold">{english ? "Keep my draft" : "保留我的草稿"}</button>
            <button type="button" disabled={busy || aiBusy} onClick={() => { stageAi({ ...pendingAi, expectedVersion: currentDraft.current?.expectedVersion ?? pendingAi.expectedVersion }); setPendingAi(null); setAiReviewOpen(false); setWorkspace("inspection"); setNotice(english ? "AI suggestion loaded. Review and save when ready." : "AI 建议已载入草稿，核对后再保存。"); }} className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{english ? "Apply AI suggestion to draft" : "应用 AI 建议到草稿"}</button>
          </div>
        </div> : null}
      </Dialog>
      <Dialog open={comparisonOpen} title={english ? "Compare report versions" : "核对报告版本"} closeLabel={english ? "Close version comparison" : "关闭核对报告版本"} onClose={closeComparison} mobileFullscreen>
        <div className="p-4 sm:p-5">
          <p className="text-sm leading-6 text-ink-soft">{english ? "Compare every conclusion, recommendation and quote before choosing. Nothing is saved until you explicitly save the draft." : "核对结论、建议和报价后再选择。此处只载入草稿，点击保存版本后才会写入。"}</p>
          {comparisonBusy ? <p role="status" className="py-8 text-center text-sm">{english ? "Reading latest version…" : "正在读取最新版本…"}</p> : null}
          {comparisonError ? <div role="alert" className="mt-4 rounded-xl border border-state-danger-border p-4"><p className="text-sm text-state-danger-text">{comparisonError}</p><button type="button" onClick={() => void compareLatest()} className="mt-3 min-h-11 rounded-lg border border-line px-4 text-sm">{english ? "Retry latest version" : "重新读取最新版本"}</button></div> : null}
          {comparisonLatest ? <>
            <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
              <ComparisonSnapshot title={english ? "My draft" : "我的草稿"} draft={draft} english={english} />
              <ComparisonSnapshot title={english ? "Latest saved version" : "系统最新版本"} draft={cloneWorkspace(comparisonLatest)} english={english} />
            </div>
            <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 border-t border-line bg-card py-3">
              <button type="button" onClick={() => adoptComparedDraft(true)} className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">{english ? "Keep my draft after review" : "核对后保留我的草稿"}</button>
              <button type="button" onClick={() => adoptComparedDraft(false)} className="min-h-11 flex-1 rounded-xl border border-line px-4 py-2 text-sm font-bold">{english ? "Use latest version as draft" : "使用最新版本作为草稿"}</button>
            </div>
          </> : null}
        </div>
      </Dialog>
      <nav role="tablist" aria-label={english ? "Inspection Report workspace" : "检查报告工作区"} className="flex shrink-0 gap-1 overflow-x-auto rounded-2xl border border-line bg-card p-1.5 shadow-card">{TABS.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" role="tab" aria-selected={workspace === tab.id} onClick={() => setWorkspace(tab.id)} className={`flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-xs font-bold xl:flex-1 ${workspace === tab.id ? "bg-primary text-white shadow-sm" : "text-ink-soft hover:bg-layer-2"}`}><Icon size={14} />{english ? tab.en : tab.zh}</button>; })}</nav>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-card">
        {workspace === "inspection" ? <div className="mb-3 flex justify-end"><button type="button" disabled={busy || aiBusy} onClick={() => void compareLatest()} className="min-h-11 rounded-lg border border-line px-3 text-xs font-semibold text-primary disabled:opacity-40">{english ? "Compare latest version" : "核对最新版本"}</button></div> : null}
        <InspectionWorkspace english={english} active={workspace === "inspection"} detail={detail} draft={draft} setDraft={setDraft} proposal={proposal} revertAi={revertAi} busy={busy} aiBusy={aiBusy} runAi={runAi} stopAi={stopAi} persist={persist} />
        <ReportWorkspace english={english} detail={detail} active={workspace === "report"} />
        <FollowupWorkspace english={english} detail={detail} active={workspace === "followup"} busy={busy} replySaving={replySaving} notify={notify} recordReply={recordReply} />
        <AttachmentsWorkspace english={english} detail={detail} active={workspace === "attachments"} />
        <HistoryWorkspace english={english} detail={detail} active={workspace === "history"} />
      </div>
    </div>
  </div>;
}

function ComparisonSnapshot({ title, draft, english }: { title: string; draft: Proposal; english: boolean }) {
  const totals = summarizeInspectionQuotation(draft.quotation);
  return <section className="min-w-0 rounded-xl border border-line p-4 text-sm">
    <h3 className="font-bold">{title}</h3>
    <p className="mt-1 text-xs text-ink-soft">{english ? "Record version" : "记录版本"} {draft.expectedVersion}</p>
    <dl className="mt-4 space-y-3">
      {([["中文结论", draft.organized.summaryZh], ["English conclusion", draft.organized.summaryEn], ["中文备注", draft.organized.specialCaseNotesZh], ["English notes", draft.organized.specialCaseNotesEn]] as const).map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-ink-soft">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6">{value?.trim() || "—"}</dd></div>)}
    </dl>
    {draft.organized.findings.map((finding, index) => <div key={index} className="mt-3 border-t border-line pt-3"><strong>{index + 1}. {finding.findingZh}</strong><p className="whitespace-pre-wrap break-words">{finding.findingEn}</p><p className="mt-1 whitespace-pre-wrap break-words">{finding.recommendationZh || "—"}</p><p className="whitespace-pre-wrap break-words">{finding.recommendationEn || "—"}</p></div>)}
    <h4 className="mt-4 border-t border-line pt-3 font-bold">{english ? "Quotation" : "报价"} · {quotationStatusLabel[quotationDisplayStatus(draft.quotation)][english ? 1 : 0]}</h4>
    <p className="mt-1 whitespace-pre-wrap break-words text-xs">{draft.quotation.noteZh}</p><p className="whitespace-pre-wrap break-words text-xs">{draft.quotation.noteEn}</p>
    {draft.quotation.lines.map((line, index) => <article key={index} className="mt-3 rounded-lg bg-layer-2 p-3">
      <p className="text-xs text-ink-soft">{line.kind === "labor" ? (english ? "Labor" : "工时") : line.kind === "part" ? (english ? "Parts" : "配件") : (english ? "Other" : "其他")}</p>
      <strong className="break-words">{line.nameZh}</strong><p className="break-words">{line.nameEn}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs">{line.descriptionZh}</p><p className="whitespace-pre-wrap break-words text-xs">{line.descriptionEn}</p>
      <p className="mt-2 text-xs">{english ? "Qty" : "数量"} {line.quantity} · {quotationUnit(line.kind, english)}</p>
      <p className="text-xs">{english ? "Price" : "单价"} <span className="whitespace-nowrap">{money(line.unitPriceMinor, english)}</span></p>
      <p className="text-xs">{english ? "Discount" : "折扣"} <span className="whitespace-nowrap">{money(line.itemDiscountMinor ?? 0)}</span></p>
      <p className="text-xs font-bold">{english ? "Subtotal" : "小计"} <span className="whitespace-nowrap">{money(line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line), english)}</span></p>
    </article>)}
    <p className="mt-3 text-xs">{english ? "Whole-order discount" : "整单优惠"} <span className="whitespace-nowrap">{money(totals.wholeOrderDiscountMinor)}</span></p>
    <p className="mt-2 font-bold">{english ? "Total quote" : "报价合计"} <span className="whitespace-nowrap">{quotationAmount(draft.quotation, totals.totalDueMinor, english)}</span></p>
  </section>;
}

function InspectionWorkspace({ english, active, detail, draft, setDraft, proposal, revertAi: restoreBeforeAi, busy, aiBusy, runAi, stopAi, persist }: { english: boolean; active: boolean; detail: FormalInspectionReportDetail; draft: Proposal; setDraft(value: Proposal): void; proposal: Proposal | null; revertAi(): void; busy: boolean; aiBusy: boolean; stopAi(): void; runAi(instruction?: string): Promise<void>; persist(source: "manual" | "ai", value: Proposal): Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const revertAi = () => {
    restoreBeforeAi();
    setInstruction("");
  };
  return <section id="inspection-report-inspection-workspace" className={editorStyles.workspace} role="tabpanel" hidden={!active}>
    {proposal ? <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary bg-accent-subtle px-4 py-3" role="status"><div><strong className="text-sm text-accent">{english ? "AI draft is in the main workspace" : "AI 草稿已进入主工作区"}</strong><p className="mt-0.5 text-[11px] text-ink-soft">{english ? "Bilingual report and quotation are staged but not saved." : "双语报告与报价已暂存，尚未写入正式版本。"}</p></div><div className="flex gap-2"><button type="button" onClick={revertAi} className="min-h-9 rounded-lg border border-line px-3 text-xs font-bold">{english ? "Revert" : "撤销本次整理"}</button><button type="button" disabled={busy} onClick={() => void persist("ai", draft)} className="min-h-9 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{english ? "Save AI draft" : "保存 AI 草稿"}</button></div></div> : null}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section data-testid="inspection-primary-workspace" className="min-w-0 overflow-hidden rounded-2xl border border-line">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-layer-2 px-4 py-3"><div><h2 className="text-base font-bold">{english ? "Inspection report and quotation" : "检查报告与报价"}</h2><p className="mt-0.5 text-[11px] text-ink-soft">V{detail.workspace.versionNo}{proposal ? (english ? " · AI draft" : " · AI 草稿") : ` · ${detail.workspace.source}`}</p></div><div className="flex gap-2"><button type="button" onClick={() => setEditing((value) => !value)} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary">{editing ? (english ? "Finish editing" : "完成编辑") : (english ? "Edit report" : "编辑报告")}</button>{!proposal ? <button type="button" disabled={busy} onClick={() => void persist("manual", draft)} className="min-h-9 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{english ? "Save version" : "保存版本"}</button> : null}</div></div>
        {editing ? <div className="space-y-4 p-4"><ReportDraftEditor english={english} draft={draft} setDraft={setDraft} /><QuotationEditor english={english} draft={draft} setDraft={setDraft} /></div> : <ReportDraftView english={english} draft={draft} onEdit={() => setEditing(true)} />}
      </section>
      <aside data-testid="inspection-ai-rail" className="space-y-3">
        {aiBusy ? <div role="status" className="rounded-xl border border-line bg-layer-2 p-3 text-sm"><p className="flex items-center gap-2"><RefreshCw size={16} className="shrink-0 animate-spin motion-reduce:animate-none" />{english ? "AI is working. You may keep editing." : "AI 正在整理，可以继续编辑。"}</p><button type="button" onClick={stopAi} className="mt-2 min-h-11 rounded-lg border border-line bg-card px-3 font-semibold">{english ? "Stop organizing" : "停止整理"}</button></div> : null}
        <section className="rounded-2xl border border-primary/40 bg-accent-subtle p-4"><div className="flex items-center gap-2"><Bot size={17} className="text-accent" /><h3 className="text-sm font-bold text-accent">{english ? "AI report assistant" : "AI 报告助手"}</h3></div><p className="mt-2 text-xs leading-5 text-ink-soft">{english ? "Organizes the report, extracts explicit prices and produces Chinese and English together." : "整理维修工表达、提取原文明确报价，并同时生成中文与英文。"}</p><button type="button" disabled={aiBusy || busy} onClick={() => void runAi()} className="mt-3 min-h-10 w-full rounded-xl bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{aiBusy ? (english ? "Organizing and translating…" : "正在整理并翻译…") : (english ? "Organize and translate" : "AI 整理并翻译")}</button><label className="mt-4 block text-xs font-bold">{english ? "Tell AI what to change" : "告诉 AI 怎么改"}<textarea data-testid="inspection-ai-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} placeholder={english ? "Example: make the conclusion shorter; keep both quote lines." : "例如：结论再简短一点，两条报价都保留。"} className="mt-1 w-full rounded-xl border border-line bg-card p-3 text-xs leading-5" /></label><button type="button" disabled={aiBusy || busy || !instruction.trim()} onClick={() => void runAi(instruction)} className="mt-2 min-h-10 w-full rounded-xl border border-primary bg-card px-4 text-xs font-bold text-primary disabled:opacity-40">{english ? "Revise current draft" : "按要求重新整理"}</button></section>
        <details open className="rounded-2xl border border-line bg-layer-2 p-4"><summary className="cursor-pointer text-sm font-bold">{english ? "Mechanic's original return" : "维修工原始回单"} <span className="ml-2 text-[10px] text-ink-soft">{english ? "Read only" : "只读"}</span></summary><p className="mt-3 whitespace-pre-wrap text-xs leading-6">{detail.report.summaryZh}</p>{detail.report.specialCaseNotesZh ? <p className="mt-3 rounded-xl bg-state-warning-subtle p-3 text-xs leading-5 text-state-warning-text">{detail.report.specialCaseNotesZh}</p> : null}</details>
        {detail.sourceBusinessOrder ? <Link href={`/orders/business/${detail.sourceBusinessOrder.id}`} className="block rounded-xl border border-primary/30 bg-accent-subtle p-3 text-xs font-semibold text-accent">{english ? "Source Business Order" : "来源 Business Order"} · {detail.sourceBusinessOrder.orderNo}</Link> : <p className="rounded-xl border border-line p-3 text-xs text-ink-soft">{english ? "Independent report; no Business Order source." : "独立检查结果，未关联 Business Order。"}</p>}
      </aside>
    </div>
  </section>;
}

function ReportDraftView({ english, draft, onEdit }: { english: boolean; draft: Proposal; onEdit(): void }) {
  const groups = (["labor", "part", "other"] as const).map((kind) => ({ kind, lines: draft.quotation.lines.filter((line) => line.kind === kind) })).filter((group) => group.lines.length > 0);
  const totals = summarizeInspectionQuotation(draft.quotation);
  const groupLabel = (kind: FormalInspectionQuotation["lines"][number]["kind"], pending: boolean) => {
    if (kind === "labor") return english ? "Labor" : "工时";
    if (kind === "part") return english ? "Parts / materials" : "配件 / 材料";
    if (pending) return english ? "Classification pending" : "分类待确认";
    return english ? "Other charges" : "其他费用";
  };
  return <div className="space-y-4 p-4"><section className="grid gap-3 lg:grid-cols-2"><article className="rounded-xl border border-line p-4"><span className="text-[10px] font-bold uppercase tracking-wide text-primary">中文检查结论</span><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{draft.organized.summaryZh}</p></article><article className="rounded-xl border border-line p-4"><span className="text-[10px] font-bold uppercase tracking-wide text-primary">English conclusion</span>{draft.organized.summaryEn?.trim() ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{draft.organized.summaryEn}</p> : <div className="mt-2"><p className="text-xs leading-5 text-ink-soft">{english ? "English conclusion pending. Enter it here or use the AI report assistant to prepare a bilingual draft." : "英文结论待补。可手动填写，或使用 AI 报告助手生成双语草稿。"}</p><button type="button" onClick={onEdit} className="mt-2 min-h-11 rounded-lg border border-line px-3 text-xs font-semibold text-primary">{english ? "Add English conclusion" : "补充英文结论"}</button></div>}</article></section>
    {draft.organized.findings.length > 0 ? <section className="overflow-hidden rounded-xl border border-line"><div className="bg-layer-2 px-4 py-2 text-xs font-bold">{english ? "Findings and recommendations" : "发现的问题与处理建议"}</div><div className="divide-y divide-line">{draft.organized.findings.map((finding, index) => <article key={index} className="grid gap-3 px-4 py-3 text-xs lg:grid-cols-[32px_1fr_1fr]"><b className="text-primary">{index + 1}</b><div><strong>{finding.findingZh}</strong><p className="mt-1 text-ink-soft">{finding.findingEn}</p></div><div><strong>{finding.recommendationZh ?? "—"}</strong><p className="mt-1 text-ink-soft">{finding.recommendationEn ?? "—"}</p></div></article>)}</div></section> : null}
    <section data-testid="inspection-quote-table" className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center justify-between bg-layer-2 px-4 py-3"><div><h3 className="text-sm font-bold">{english ? "Quotation" : "报价"}</h3><p className="mt-0.5 text-[10px] text-ink-soft">{english ? quotationStatusLabel[quotationDisplayStatus(draft.quotation)][1] : quotationStatusLabel[quotationDisplayStatus(draft.quotation)][0]}</p></div><div className="text-right"><span className="block text-[10px] text-ink-soft">{english ? "Discounted quote" : "折后报价"}</span><strong className="text-base">{quotationAmount(draft.quotation, totals.totalDueMinor, english)}</strong></div></div>
      {draft.quotation.noteZh || draft.quotation.noteEn ? <p className="border-t border-line bg-state-warning-subtle px-4 py-2 text-[11px] text-state-warning-text">{english ? draft.quotation.noteEn : draft.quotation.noteZh}</p> : null}
      {groups.length > 0 ? groups.map((group) => {
        const pending = group.kind === "other" && group.lines.some((line) => line.nameZh === "待确认项目");
        return <div key={group.kind}>
          <div className="border-y border-line bg-accent-subtle px-4 py-2 text-xs font-bold text-accent">{groupLabel(group.kind, pending)}</div>
          <div className="hidden grid-cols-[minmax(120px,.9fr)_minmax(150px,1.2fr)_70px_58px_105px_95px_110px] gap-2 border-b border-line bg-layer-2 px-4 py-2 text-[10px] font-bold text-ink-soft lg:grid">
            <span>{english ? "Item" : "项目名称"}</span><span>{english ? "Description" : "描述"}</span><span>{english ? "Unit" : "单位"}</span><span className="text-right">{english ? "Qty" : "数量"}</span><span className="text-right">{english ? "Tax-inclusive price" : "含税单价"}</span><span className="text-right">{english ? "Item discount" : "本项折扣"}</span><span className="text-right">{english ? "Subtotal" : "小计"}</span>
          </div>
          <div className="divide-y divide-line">{group.lines.map((line, index) => {
            const discountMinor = line.itemDiscountMinor ?? 0;
            const subtotalMinor = line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line);
            return <div key={index} className="grid gap-2 px-4 py-3 text-xs lg:grid-cols-[minmax(120px,.9fr)_minmax(150px,1.2fr)_70px_58px_105px_95px_110px] lg:items-start lg:gap-2">
              <div className="min-w-0"><strong className="block break-words">{line.nameZh}</strong><span className="mt-0.5 block break-words text-ink-soft">{line.nameEn}</span></div>
              <div className="min-w-0"><p className="break-words">{line.descriptionZh ?? "—"}</p><p className="mt-0.5 break-words text-ink-soft">{line.descriptionEn ?? "—"}</p></div>
              <span><span className="lg:hidden">{english ? "Unit: " : "单位："}</span>{quotationUnit(line.kind, english)}</span>
              <span className="lg:text-right"><span className="lg:hidden">{english ? "Qty: " : "数量："}</span>{line.quantity}</span>
              <span className="lg:text-right"><span className="lg:hidden">{english ? "Price: " : "含税单价："}</span>{money(line.unitPriceMinor, english)}</span>
              <span className={discountMinor > 0 ? "text-state-danger-text lg:text-right" : "lg:text-right"}><span className="lg:hidden">{english ? "Discount: " : "本项折扣："}</span>{discountMinor > 0 ? `−${money(discountMinor)}` : money(0)}</span>
              <strong className="lg:text-right"><span className="font-normal lg:hidden">{english ? "Subtotal: " : "小计："}</span>{money(subtotalMinor, english)}</strong>
            </div>;
          })}</div>
        </div>;
      }) : <p className="p-4 text-xs text-ink-soft">{english ? draft.quotation.noteEn : draft.quotation.noteZh}</p>}
      {groups.length > 0 ? <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 xl:grid-cols-4">
        {(["labor", "part", "other"] as const).map((kind) => <div key={kind}><span className="text-[11px] text-ink-soft">{kind === "labor" ? (english ? "Labor total" : "工时合计") : kind === "part" ? (english ? "Parts total" : "配件合计") : (english ? "Other charges total" : "其他费用合计")}</span><strong className="mt-1 block text-sm">{quotationAmount(draft.quotation, totals.groups[kind].subtotalMinor, english, kind)}</strong><small className="text-state-danger-text">{english ? "Discount" : "优惠"} −{money(totals.groups[kind].discountMinor)}</small></div>)}
        <div className="rounded-xl bg-layer-2 px-3 py-2"><span className="text-[11px] text-ink-soft">{english ? "Discounted quote" : "折后报价"}</span><strong className="mt-1 block text-base">{quotationAmount(draft.quotation, totals.totalDueMinor, english)}</strong><small className="block text-ink-soft">{english ? "Original quote" : "原报价"} {quotationAmount(draft.quotation, totals.grossMinor, english)}</small><small className="block text-state-danger-text">{english ? "Item discounts" : "本项折扣"} −{money(totals.itemDiscountMinor)}</small><small className="block text-state-danger-text">{english ? "Whole-order discount" : "整单优惠"} −{money(totals.wholeOrderDiscountMinor)}</small></div>
      </div> : null}
    </section>
    {(draft.organized.specialCaseNotesZh || draft.organized.specialCaseNotesEn) ? <section className="rounded-xl border border-state-warning-border bg-state-warning-subtle p-4"><h3 className="text-xs font-bold text-state-warning-text">{english ? "Important notes" : "重要备注与责任界限"}</h3>{draft.organized.specialCaseNotesZh ? <p className="mt-2 text-xs leading-5">{draft.organized.specialCaseNotesZh}</p> : null}{draft.organized.specialCaseNotesEn ? <p className="mt-1 text-xs leading-5 text-ink-soft">{draft.organized.specialCaseNotesEn}</p> : null}</section> : null}</div>;
}

function ReportDraftEditor({ english, draft, setDraft }: { english: boolean; draft: Proposal; setDraft(value: Proposal): void }) {
  return <section className="rounded-2xl border border-primary/30 p-4"><div className="grid gap-3 lg:grid-cols-2"><label className="block text-xs font-bold">{english ? "Chinese inspection conclusion" : "中文检查结论"}<textarea value={draft.organized.summaryZh} onChange={(event) => setDraft({ ...draft, organized: { ...draft.organized, summaryZh: event.target.value } })} rows={4} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm leading-6" /></label><label className="block text-xs font-bold">{english ? "English inspection conclusion" : "英文检查结论"}<textarea value={draft.organized.summaryEn ?? ""} onChange={(event) => setDraft({ ...draft, organized: { ...draft.organized, summaryEn: event.target.value || null } })} rows={4} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm leading-6" /></label></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><label className="block text-xs font-bold">{english ? "Chinese important notes" : "中文重要备注"}<textarea value={draft.organized.specialCaseNotesZh ?? ""} onChange={(event) => setDraft({ ...draft, organized: { ...draft.organized, specialCaseNotesZh: event.target.value || null } })} rows={2} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm" /></label><label className="block text-xs font-bold">{english ? "English important notes" : "英文重要备注"}<textarea value={draft.organized.specialCaseNotesEn ?? ""} onChange={(event) => setDraft({ ...draft, organized: { ...draft.organized, specialCaseNotesEn: event.target.value || null } })} rows={2} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm" /></label></div><div className="mt-3 space-y-2">{draft.organized.findings.map((finding, index) => <article key={index} className="grid gap-2 rounded-xl bg-layer-2 p-3 sm:grid-cols-2"><label className="text-[11px] font-bold">{english ? "Chinese finding" : "中文问题描述"}<textarea value={finding.findingZh} onChange={(event) => { const findings = [...draft.organized.findings]; findings[index] = { ...finding, findingZh: event.target.value }; setDraft({ ...draft, organized: { ...draft.organized, findings } }); }} rows={2} className="mt-1 w-full rounded-lg border border-line bg-card p-2 text-xs" /></label><label className="text-[11px] font-bold">{english ? "English finding" : "英文问题描述"}<textarea value={finding.findingEn ?? ""} onChange={(event) => { const findings = [...draft.organized.findings]; findings[index] = { ...finding, findingEn: event.target.value || null }; setDraft({ ...draft, organized: { ...draft.organized, findings } }); }} rows={2} className="mt-1 w-full rounded-lg border border-line bg-card p-2 text-xs" /></label><label className="text-[11px] font-bold">{english ? "Chinese recommendation" : "中文处理建议"}<textarea value={finding.recommendationZh ?? ""} onChange={(event) => { const findings = [...draft.organized.findings]; findings[index] = { ...finding, recommendationZh: event.target.value || null }; setDraft({ ...draft, organized: { ...draft.organized, findings } }); }} rows={2} className="mt-1 w-full rounded-lg border border-line bg-card p-2 text-xs" /></label><label className="text-[11px] font-bold">{english ? "English recommendation" : "英文处理建议"}<textarea value={finding.recommendationEn ?? ""} onChange={(event) => { const findings = [...draft.organized.findings]; findings[index] = { ...finding, recommendationEn: event.target.value || null }; setDraft({ ...draft, organized: { ...draft.organized, findings } }); }} rows={2} className="mt-1 w-full rounded-lg border border-line bg-card p-2 text-xs" /></label></article>)}</div></section>;
}

function QuotationEditor({ english, draft, setDraft }: { english: boolean; draft: Proposal; setDraft(value: Proposal): void }) {
  const updateLine = (index: number, patch: Partial<FormalInspectionQuotation["lines"][number]>) => {
    const lines = [...draft.quotation.lines];
    const nextLine = { ...lines[index], ...patch };
    const quantity = Number(nextLine.quantity);
    const grossMinor = nextLine.unitPriceMinor !== null && Number.isFinite(quantity) && quantity > 0
      ? Math.round(nextLine.unitPriceMinor * quantity)
      : 0;
    nextLine.itemDiscountMinor = Math.min(nextLine.itemDiscountMinor ?? 0, grossMinor);
    nextLine.subtotalMinor = calculateInspectionQuotationLineSubtotalMinor(nextLine);
    lines[index] = nextLine;
    setDraft({ ...draft, quotation: { ...draft.quotation, status: "entered", lines } });
  };
  const totals = summarizeInspectionQuotation(draft.quotation);
  return <section data-testid="inspection-quotation-editor" className={`${editorStyles.quotation} rounded-2xl border border-line p-4`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{english ? "Quotation" : "报价"}</h3><p className="mt-1 text-xs text-ink-soft">{english ? "Keep the item name short. Put the full work detail in Description." : "项目名称保持简短；完整工作内容放在“描述”。"}</p></div><strong className="rounded-full bg-state-warning-subtle px-3 py-1 text-xs text-state-warning-text">{english ? quotationStatusLabel[quotationDisplayStatus(draft.quotation)][1] : quotationStatusLabel[quotationDisplayStatus(draft.quotation)][0]}</strong></div>
    <ChoiceCards key={draft.quotation.status} legend={english ? "Quotation status" : "报价状态"} name="quotationStatus" defaultValue={draft.quotation.status} columns={3} onValueChange={(value) => setDraft({ ...draft, quotation: { ...draft.quotation, status: value as FormalInspectionQuotation["status"] } })} choices={[{ value: "pending", label: english ? "Price pending" : "报价待补" }, { value: "entered", label: english ? "Quoted" : "已报价" }, { value: "not_quoted", label: english ? "No quote" : "本次不报价" }]} />
    <div className="mt-3 space-y-3">{draft.quotation.lines.map((line, index) => <article key={index} className="rounded-xl border border-line p-3">
      <div role="group" aria-label={english ? "Quote item " + (index + 1) + " classification" : "报价项目 " + (index + 1) + " 分类"} className="grid grid-cols-3 gap-1 rounded-lg bg-layer-2 p-1">{(["labor", "part", "other"] as const).map((kind) => <button key={kind} type="button" onClick={() => updateLine(index, { kind })} className={"min-h-8 rounded-md px-2 text-[11px] font-bold " + (line.kind === kind ? "bg-primary text-white" : "text-ink-soft")}>{kind === "labor" ? (english ? "Labor" : "工时") : kind === "part" ? (english ? "Part / material" : "配件 / 材料") : (english ? "Other / confirm" : "其他 / 待确认")}</button>)}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-[11px] font-bold">{english ? "Chinese item name" : "中文项目名称"}<input aria-label={english ? "Chinese item name" : "中文项目名称"} value={line.nameZh} onChange={(event) => updateLine(index, { nameZh: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label><label className="text-[11px] font-bold">{english ? "English item name" : "英文项目名称"}<input aria-label={english ? "English item name" : "英文项目名称"} value={line.nameEn ?? ""} onChange={(event) => updateLine(index, { nameEn: event.target.value || null })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label><label className="text-[11px] font-bold">{english ? "Chinese description" : "中文项目描述"}<textarea aria-label={english ? "Chinese item description" : "中文项目描述"} value={line.descriptionZh ?? ""} onChange={(event) => updateLine(index, { descriptionZh: event.target.value || null })} rows={2} className="mt-1 w-full rounded-lg border border-line bg-layer-2 p-3 text-xs" /></label><label className="text-[11px] font-bold">{english ? "English description" : "英文项目描述"}<textarea aria-label={english ? "English item description" : "英文项目描述"} value={line.descriptionEn ?? ""} onChange={(event) => updateLine(index, { descriptionEn: event.target.value || null })} rows={2} className="mt-1 w-full rounded-lg border border-line bg-layer-2 p-3 text-xs" /></label></div>
      <div className={editorStyles.lineAmounts}>
        <label className="text-[11px] font-bold">{english ? "Unit" : "单位"}<input aria-label={english ? "Unit" : "单位"} value={quotationUnit(line.kind, english)} readOnly className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs text-ink-soft" /></label>
        <label className="text-[11px] font-bold">{english ? "Quantity" : "数量"}<input aria-label={english ? "Quantity" : "数量"} value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label>
        <label className="text-[11px] font-bold">{english ? "Tax-inclusive unit price JMD" : "含税单价 JMD"}<input aria-label={english ? "Tax-inclusive unit price JMD" : "含税单价 JMD"} inputMode="decimal" value={line.unitPriceMinor === null ? "" : String(line.unitPriceMinor / 100)} onChange={(event) => updateLine(index, { unitPriceMinor: inputMoneyMinor(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label>
        <label className="text-[11px] font-bold">{english ? "Item discount JMD" : "本项折扣 JMD"}<input aria-label={english ? "Item discount JMD" : "本项折扣 JMD"} inputMode="decimal" value={String((line.itemDiscountMinor ?? 0) / 100)} onChange={(event) => updateLine(index, { itemDiscountMinor: inputMoneyMinor(event.target.value) ?? 0 })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label>
        <label className="text-[11px] font-bold">{english ? "Subtotal JMD" : "小计 JMD"}<input aria-label={english ? "Subtotal JMD" : "小计 JMD"} value={(line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line)) === null ? "" : String(((line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line)) ?? 0) / 100)} readOnly className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs font-bold" /></label>
        <button type="button" aria-label={english ? "Delete quote line" : "删除报价项目"} onClick={() => setDraft({ ...draft, quotation: { ...draft.quotation, lines: draft.quotation.lines.filter((_, candidate) => candidate !== index) } })} className={`${editorStyles.removeLine} mt-4 rounded-lg border border-state-danger-border px-3 text-state-danger-text`}><Trash2 size={14} /></button>
      </div>
    </article>)}</div>
    <button type="button" onClick={() => setDraft({ ...draft, quotation: { ...draft.quotation, status: "entered", lines: [...draft.quotation.lines, { kind: "other", nameZh: "", nameEn: null, descriptionZh: null, descriptionEn: null, quantity: "1", unitPriceMinor: null, itemDiscountMinor: 0, subtotalMinor: null }] } })} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary px-3 text-xs font-bold text-primary"><Plus size={14} />{english ? "Add quote item" : "新增报价项目"}</button>
    <div className="mt-3 grid gap-3 rounded-xl bg-layer-2 p-3 sm:grid-cols-2">
      <label className="text-xs font-bold">{english ? "Whole-order discount JMD" : "整单优惠 JMD"}<input aria-label={english ? "Whole-order discount JMD" : "整单优惠 JMD"} inputMode="decimal" value={String((draft.quotation.wholeOrderDiscountMinor ?? 0) / 100)} onChange={(event) => { const lineSubtotalMinor = summarizeInspectionQuotation({ ...draft.quotation, wholeOrderDiscountMinor: 0 }).lineSubtotalMinor; const wholeOrderDiscountMinor = Math.min(inputMoneyMinor(event.target.value) ?? 0, lineSubtotalMinor); setDraft({ ...draft, quotation: { ...draft.quotation, status: "entered", wholeOrderDiscountMinor } }); }} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-card px-3 text-xs" /></label>
      <div className="rounded-lg bg-card px-3 py-2"><span className="text-[11px] text-ink-soft">{english ? "Discounted quote" : "折后报价"}</span><strong className="mt-1 block text-base">{quotationAmount(draft.quotation, totals.totalDueMinor, english)}</strong><small className="mt-1 block text-state-danger-text">{english ? "Total discounts" : "优惠合计"} −{money(totals.itemDiscountMinor + totals.wholeOrderDiscountMinor)}</small></div>
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-2"><label className="block text-xs font-bold">{english ? "Chinese quotation note" : "中文报价说明"}<input value={draft.quotation.noteZh ?? ""} onChange={(event) => setDraft({ ...draft, quotation: { ...draft.quotation, noteZh: event.target.value || null } })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label><label className="block text-xs font-bold">{english ? "English quotation note" : "英文报价说明"}<input value={draft.quotation.noteEn ?? ""} onChange={(event) => setDraft({ ...draft, quotation: { ...draft.quotation, noteEn: event.target.value || null } })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-xs" /></label></div>
  </section>;
}
function ReportWorkspace({ english, detail, active }: { english: boolean; detail: FormalInspectionReportDetail; active: boolean }) {
  const [hasPdf, setHasPdf] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const printController = useRef<AbortController | null>(null);
  const printInFlight = useRef(false);
  useEffect(() => () => printController.current?.abort(), []);
  const printReport = async () => {
    if (printInFlight.current) return;
    printController.current?.abort();
    const controller = new AbortController();
    printController.current = controller;
    const sheet = document.getElementById("inspection-report-print-sheet");
    if (!sheet) return;
    printInFlight.current = true;
    setPrinting(true);
    setPrintError(null);
    try {
      await printInspectionSheet(sheet, `${detail.report.reportNo}-${reportLanguage}`, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setPrintError(error instanceof Error ? error.message : (english ? "Printing could not start. Please try again." : "无法启动打印，请重试。"));
    } finally {
      printInFlight.current = false;
      if (!controller.signal.aborted) setPrinting(false);
    }
  };
  const organized = detail.workspace.organized;
  const quotation = detail.workspace.quotation;
  const quotationTotals = summarizeInspectionQuotation(quotation);
  const quotationGroups = (["labor", "part", "other"] as const)
    .map((kind) => ({ kind, lines: quotation.lines.filter((line) => line.kind === kind) }))
    .filter((group) => group.lines.length > 0);
  const [reportLanguage, setReportLanguage] = useState<ReportLanguage>(english ? "en" : "zh");
  const [readingScale, setReadingScale] = useState<"fit" | 1 | 1.5>(1);
  const [readerWidth, setReaderWidth] = useState(0);
  const readerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !active || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setReaderWidth(entry.contentRect.width);
    });
    observer.observe(reader);
    return () => observer.disconnect();
  }, [active]);
  const scale = readingScale === "fit" ? Math.min(1, readerWidth > 0 ? readerWidth / (210 * 96 / 25.4) : 1) : readingScale;
  const showZh = reportLanguage !== "en";
  const showEn = reportLanguage !== "zh";
  const bilingual = reportLanguage === "bilingual";
  const title = reportLanguage === "zh" ? "车辆检查报告与报价" : reportLanguage === "en" ? "VEHICLE INSPECTION REPORT & QUOTATION" : "车辆检查报告与报价 / INSPECTION REPORT & QUOTATION";
  const vehicleDescription = inspectionVehicleDescriptionForReport(detail.vehicle, reportLanguage);
  const team = inspectionTeamNameForReport(detail.teamName, reportLanguage);
  return <section id="inspection-report-report-workspace" role="tabpanel" hidden={!active}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-base font-bold">{english ? "Customer Inspection Report & Quotation" : "客户检查报告与报价单"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Choose a document language, then print the true A4 sheet." : "先选择给客户的文件版本，再打印真实 A4 单据。"}</p></div>
      <div className="flex flex-wrap items-center gap-2"><ChoiceCards legend={english ? "Document language" : "单据语言版本"} name="reportLanguage" defaultValue={reportLanguage} columns={3} onValueChange={(value) => setReportLanguage(value as ReportLanguage)} choices={[{ value: "zh", label: "中文版" }, { value: "en", label: "English" }, { value: "bilingual", label: "中英对照版" }]} />{!hasPdf ? <button type="button" disabled={printing} onClick={() => void printReport()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-white"><Printer size={16} />{printing ? (english ? "Opening print…" : "正在启动打印…") : (english ? "Print / Save PDF" : "系统打印 / 存 PDF")}</button> : null}</div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><InspectionPdfDownload detail={detail} language={reportLanguage} english={english} onReadyChange={setHasPdf} />{!hasPdf ? <span className="text-xs text-ink-soft">{english ? "Generate a file to preview, download or print it." : "生成文件后，可预览、下载或打印同一份 PDF。"}</span> : null}</div>
    {printError ? <p role="alert" className="mt-3 rounded-xl border border-state-danger-border bg-state-danger-subtle p-3 text-sm text-state-danger-text">{printError}</p> : null}
    <div style={{ display: hasPdf ? "none" : undefined }}>
    <div className={readerStyles.controls} role="group" aria-label={english ? "Report reading size" : "报告阅读大小"}>
      {(["fit", 1, 1.5] as const).map((value) => <button key={value} type="button" aria-pressed={readingScale === value} onClick={() => setReadingScale(value)}>{value === "fit" ? (english ? "Fit width" : "适合宽度") : `${value * 100}%`}</button>)}
      <p className={readerStyles.hint}>{english ? "Scroll inside the report to read. Reading size does not change A4 printing." : "在报告区域内滑动阅读；阅读大小不影响 A4 打印。"}</p>
    </div>
    <div ref={readerRef} className={readerStyles.viewport} role="region" aria-label={english ? "A4 inspection report preview" : "A4 检查报告预览"} tabIndex={0}>
    <article id="inspection-report-print-sheet" style={{ zoom: scale }} className={`${readerStyles.sheet} bg-white p-[12mm] text-slate-950 shadow-xl print:shadow-none`}>
      <div className="flex items-start justify-between border-b-2 border-blue-700 pb-5"><div><p className="text-xl font-black text-blue-950">Whole Hearted Car Service Limited</p><p className="mt-1 text-[10px] text-slate-500">16 Ferry Pen, Kingston, Jamaica · WhatsApp: 1 876-899-3924 / 1 876-333-3322</p></div><div className="max-w-[46%] text-right"><h2 className="text-lg font-black text-blue-950">{title}</h2><p className="mt-1 font-mono text-xs">{detail.report.reportNo}</p></div></div>
      <div className="mt-5 grid grid-cols-2 border border-slate-300 text-xs"><div className="border-b border-r border-slate-300 p-3"><span className="text-slate-500">{showZh ? "车辆" : "Vehicle"}{bilingual ? " / VEHICLE" : ""}</span><strong className="mt-1 block">{detail.vehicle.plate} · {vehicleDescription}</strong></div><div className="border-b border-slate-300 p-3"><span className="text-slate-500">{showZh ? "客户" : "Customer"}{bilingual ? " / CUSTOMER" : ""}</span><strong className="mt-1 block">{detail.customer.name ?? "—"}</strong></div><div className="border-r border-slate-300 p-3"><span className="text-slate-500">{showZh ? "检查班组" : "Inspection team"}{bilingual ? " / TEAM" : ""}</span><strong className="mt-1 block">{team.value}</strong>{team.fallbackNote ? <small className="mt-1 block text-[9px] leading-4 text-slate-500">{team.fallbackNote}</small> : null}</div><div className="p-3"><span className="text-slate-500">{showZh ? "日期" : "Date"}{bilingual ? " / DATE" : ""}</span><strong className="mt-1 block">{formatDateTime(detail.workspace.createdAt)}</strong></div></div>
      <section className="mt-6"><h3 className="border-b border-blue-700 pb-2 text-sm font-black text-blue-950">{showZh ? "检查结论" : "Inspection conclusion"}{bilingual ? " / INSPECTION CONCLUSION" : ""}</h3>{showZh ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{organized.summaryZh}</p> : null}{showEn ? <p className={`${showZh ? "mt-2 border-l-2 border-blue-200 pl-3 text-slate-700" : "mt-3"} whitespace-pre-wrap text-sm leading-7`}>{organized.summaryEn ?? "English translation pending"}</p> : null}</section>
      <section className="mt-6"><h3 className="border-b border-blue-700 pb-2 text-sm font-black text-blue-950">{showZh ? "发现的问题与处理建议" : "Findings and recommendations"}{bilingual ? " / FINDINGS & RECOMMENDATIONS" : ""}</h3><div className="mt-2 divide-y divide-slate-200">{organized.findings.map((finding, index) => <div key={index} className="grid grid-cols-[32px_1fr_1fr] gap-3 py-3 text-xs"><b>{index + 1}</b><div>{showZh ? <p>{finding.findingZh}</p> : null}{showEn ? <p className={showZh ? "mt-1 text-slate-600" : ""}>{finding.findingEn ?? "English translation pending"}</p> : null}</div><div>{showZh ? <p>{finding.recommendationZh ?? "—"}</p> : null}{showEn ? <p className={showZh ? "mt-1 text-slate-600" : ""}>{finding.recommendationEn ?? "English translation pending"}</p> : null}</div></div>)}</div></section>
      <section className="mt-6">
        <div className="flex items-end justify-between border-b border-blue-700 pb-2"><h3 className="text-sm font-black text-blue-950">{showZh ? "报价" : "Quotation"}{bilingual ? " / QUOTATION" : ""}</h3><div className="text-right"><span className="block text-[9px] text-slate-500">{showZh ? "折后报价" : "Discounted quote"}</span><strong data-money className="text-sm">{quotationAmount(quotation, quotationTotals.totalDueMinor, !showZh)}</strong></div></div>
        {quotation.noteZh || quotation.noteEn ? <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">{showZh ? quotation.noteZh : quotation.noteEn}</p> : null}
        {quotation.lines.length ? <>
          {quotationGroups.map((group) => {
            const labels = group.kind === "labor" ? ["工时", "Labor"]
              : group.kind === "part" ? ["配件 / 材料", "Parts / materials"]
              : group.lines.some((line) => line.nameZh === "待确认项目") ? ["分类待确认", "Classification pending"]
              : ["其他费用", "Other charges"];
            const label = bilingual ? labels.join(" / ") : labels[showZh ? 0 : 1];
            return <section key={group.kind} data-quote-kind={group.kind} className="mt-4">
          <h4 className="border-l-4 border-blue-700 bg-blue-50 px-2 py-2 text-xs font-bold text-blue-950">{label}</h4>
          <table className="mt-2 w-full table-fixed border-collapse text-[9px]">
            <thead><tr className="bg-blue-950 text-white"><th className="w-[18%] p-1.5 text-left">{showZh ? "项目名称" : "Item"}</th><th className="w-[24%] p-1.5 text-left">{showZh ? "描述" : "Description"}</th><th className="w-[8%] p-1.5 text-left">{showZh ? "单位" : "Unit"}</th><th className="w-[7%] p-1.5 text-right">{showZh ? "数量" : "Qty"}</th><th className="w-[15%] p-1.5 text-right">{showZh ? "含税单价" : "Tax-inclusive price"}</th><th className="w-[13%] p-1.5 text-right">{showZh ? "本项折扣" : "Item discount"}</th><th className="w-[15%] p-1.5 text-right">{showZh ? "小计" : "Subtotal"}</th></tr></thead>
            <tbody>{group.lines.map((line, index) => <tr key={index} className="border-b border-slate-200 align-top"><td className="p-1.5"><strong className="block">{showZh ? line.nameZh : line.nameEn ?? "English translation pending"}</strong>{bilingual ? <small className="mt-0.5 block text-[8px] text-slate-600">{line.nameEn ?? "English translation pending"}</small> : null}</td><td className="p-1.5"><span className="block">{showZh ? line.descriptionZh ?? "—" : line.descriptionEn ?? "—"}</span>{bilingual ? <small className="mt-0.5 block text-[8px] text-slate-600">{line.descriptionEn ?? "—"}</small> : null}</td><td className="p-1.5">{quotationUnit(line.kind, !showZh)}</td><td className="p-1.5 text-right">{line.quantity}</td><td className="p-1.5 text-right">{money(line.unitPriceMinor, !showZh)}</td><td className="p-1.5 text-right text-red-700">{line.itemDiscountMinor ? "−" + money(line.itemDiscountMinor) : money(0)}</td><td className="p-1.5 text-right font-bold">{money(line.subtotalMinor ?? calculateInspectionQuotationLineSubtotalMinor(line), !showZh)}</td></tr>)}</tbody>
          </table>
          <div className="flex items-center justify-between border-b border-slate-300 bg-slate-50 px-2 py-2 text-[10px] font-bold">
            <span>{showZh ? `${labels[0]}合计` : `${labels[1]} total`}{bilingual ? ` / ${labels[1]} total` : ""}</span>
            <strong data-money data-category-total>{quotationAmount(quotation, quotationTotals.groups[group.kind].subtotalMinor, !showZh, group.kind)}</strong>
          </div>
          </section>;
          })}
          <div className="mt-3 ml-auto grid max-w-[58%] grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-300 pt-2 text-[10px]">
            <span>{showZh ? "原报价" : "Original quote"}</span><strong data-money className="text-right">{quotationAmount(quotation, quotationTotals.grossMinor, !showZh)}</strong>
            <span>{showZh ? "本项折扣合计" : "Item discounts"}</span><strong data-money className="text-right text-red-700">−{money(quotationTotals.itemDiscountMinor)}</strong>
            <span>{showZh ? "整单优惠" : "Whole-order discount"}</span><strong data-money className="text-right text-red-700">−{money(quotationTotals.wholeOrderDiscountMinor)}</strong>
            <span className="border-t border-slate-300 pt-1 font-black">{showZh ? "折后报价" : "Discounted quote"}</span><strong data-money className="border-t border-slate-300 pt-1 text-right text-sm">{quotationAmount(quotation, quotationTotals.totalDueMinor, !showZh)}</strong>
          </div>
        </> : <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{showZh ? quotation.noteZh ?? quotationStatusLabel[quotation.status === "not_quoted" ? "not_quoted" : "pending"][0] : quotation.noteEn ?? quotationStatusLabel[quotation.status === "not_quoted" ? "not_quoted" : "pending"][1]}</p>}
      </section>
      {(showZh && organized.specialCaseNotesZh || showEn && organized.specialCaseNotesEn) ? <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="text-xs font-black text-amber-950">{showZh ? "重要备注与责任界限" : "Important notes and limitations"}{bilingual ? " / IMPORTANT NOTES & LIMITATIONS" : ""}</h3>{showZh && organized.specialCaseNotesZh ? <p className="mt-2 whitespace-pre-wrap text-xs leading-6">{organized.specialCaseNotesZh}</p> : null}{showEn ? <p className={`${showZh ? "mt-2 border-l-2 border-amber-300 pl-3" : "mt-2"} whitespace-pre-wrap text-xs leading-6`}>{organized.specialCaseNotesEn ?? "English translation pending"}</p> : null}</section> : null}
      <div className="mt-12 grid grid-cols-2 gap-12 text-xs"><div className="border-t border-slate-500 pt-2">{showZh ? "客户确认" : "Customer acknowledgement"}{bilingual ? " / CUSTOMER ACKNOWLEDGEMENT" : ""}</div><div className="border-t border-slate-500 pt-2">{showZh ? "前台 / 日期" : "Front desk / Date"}{bilingual ? " / FRONT DESK / DATE" : ""}</div></div>
    </article>
    </div>
    </div>
  </section>;
}

function FollowupWorkspace({ english, detail, active, busy, replySaving, notify, recordReply }: { english: boolean; detail: FormalInspectionReportDetail; active: boolean; busy: boolean; replySaving: boolean; notify(channel: "sms" | "email" | "whatsapp"): Promise<void>; recordReply(event: FormEvent<HTMLFormElement>): Promise<void> }) {
  return <section id="inspection-report-followup-workspace" role="tabpanel" hidden={!active}><div className="mx-auto max-w-5xl"><h2 className="text-base font-bold">{english ? "Customer delivery and response" : "发送客户与回复跟进"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "SMS is sent through the configured system provider. WhatsApp and email open the front-desk tools and only record an initiated action." : "短信由系统接口直接发送；WhatsApp 与 Email 打开前台工具，只记录已发起动作，不冒充送达。"}</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-line p-4"><h3 className="text-sm font-bold">{english ? "Send to customer" : "发送给客户"}</h3><div className="mt-3 grid grid-cols-3 gap-2">{(["whatsapp", "sms", "email"] as const).map((channel) => <button key={channel} type="button" disabled={busy} onClick={() => void notify(channel)} className="min-h-12 rounded-xl border border-primary bg-accent-subtle text-xs font-bold text-accent disabled:opacity-40">{channelLabel[channel]}</button>)}</div></section><form onSubmit={recordReply} className="rounded-2xl border border-line p-4"><h3 className="text-sm font-bold">{english ? "Record customer response" : "登记客户回复"}</h3><p className="mt-1 text-[11px] text-ink-soft">{english ? "Record whether the customer showed interest." : "记录客户是否有意向即可，回复原话可简写。"}</p><textarea name="reply" required rows={3} placeholder={english ? "Customer is interested and will confirm next week." : "例如：客户有意向，下周再确认。"} className="mt-3 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm" /><button disabled={busy} className="mt-3 min-h-11 rounded-xl bg-primary px-4 text-xs font-bold text-white">{replySaving ? (english ? "Recording response…" : "正在记录回复…") : (english ? "Record response and close" : "记录回复并闭环")}</button></form></div><section className="mt-4 rounded-2xl border border-line p-4"><h3 className="text-sm font-bold">{english ? "Follow-up history" : "客户跟进历史"}</h3>{detail.communications.length ? <ol className="mt-3 divide-y divide-line">{detail.communications.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-xs"><strong>{channelLabel[item.channel]}</strong><span className="rounded-full bg-layer-2 px-2 py-1 font-semibold">{item.status === "initiated" ? (english ? "Awaiting reply" : "待回复") : item.status === "confirmed" ? (english ? "Response recorded" : "已记录回复") : (english ? "Ready to send again" : "待重新发送")}</span><span className="text-ink-soft">{item.targetContact} · {formatDateTime(item.initiatedAt)}</span>{item.noteOrReply ? <p className="w-full text-ink-soft">{item.noteOrReply}</p> : null}</li>)}</ol> : <p className="mt-3 text-xs text-ink-soft">{english ? "Not sent yet." : "尚未发起客户通知。"}</p>}</section></div></section>;
}

function AttachmentsWorkspace({ english, detail, active }: { english: boolean; detail: FormalInspectionReportDetail; active: boolean }) {
  return <section id="inspection-report-attachments-workspace" role="tabpanel" hidden={!active}><div className="mx-auto max-w-5xl"><h2 className="text-base font-bold">{english ? "Inspection evidence and attachments" : "检查证据与业务附件"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "The original return stays here; related job photos remain in the source Business Order archive." : "原始回单保留在这里；本轮维修照片和其他资料仍统一归档在来源业务单。"}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><article className="rounded-2xl border border-line p-4"><Paperclip className="text-primary" /><h3 className="mt-3 text-sm font-bold">{english ? "Original paper report" : "原始纸质检查单"}</h3>{detail.report.paperPhotoFileId ? <a href={`/api/formal/vehicle-attachments/${detail.report.paperPhotoFileId}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-bold text-primary underline">{english ? "Open archived file" : "打开已归档文件"}</a> : <p className="mt-2 text-xs text-ink-soft">{english ? "No source file was submitted; photos are optional." : "创建时未提交原始文件；照片不是必填项。"}</p>}</article>{detail.sourceBusinessOrder ? <article className="rounded-2xl border border-line p-4"><Paperclip className="text-primary" /><h3 className="mt-3 text-sm font-bold">{english ? "Related job files" : "关联维修资料"}</h3><p className="mt-2 text-xs text-ink-soft">{english ? `Stored with ${detail.sourceBusinessOrder.orderNo}.` : `统一归档在 ${detail.sourceBusinessOrder.orderNo}。`}</p><Link href={`/orders/business/${detail.sourceBusinessOrder.id}?tab=attachments`} className="mt-3 inline-block text-xs font-bold text-primary underline">{english ? "View source Business Order attachments" : "查看来源业务单附件"}</Link></article> : <article className="rounded-2xl border border-dashed border-line p-4"><h3 className="text-sm font-bold">{english ? "Independent inspection" : "独立检查结果"}</h3><p className="mt-2 text-xs text-ink-soft">{english ? "This report has no source Business Order attachment archive." : "本检查结果未关联业务单，因此没有来源业务附件。"}</p></article>}</div></div></section>;
}

function HistoryWorkspace({ english, detail, active }: { english: boolean; detail: FormalInspectionReportDetail; active: boolean }) {
  return <section id="inspection-report-history-workspace" role="tabpanel" hidden={!active}><div className="mx-auto max-w-4xl"><h2 className="text-base font-bold">{english ? "Report history" : "历史记录"}</h2><ol className="mt-4 border-l-2 border-primary/30 pl-5"><HistoryItem title={english ? "Inspection report created" : "创建检查结果"} meta={`${formatDateTime(detail.report.createdAt)} · ${detail.teamName}`} />{detail.workspace.versionNo ? <HistoryItem title={english ? `Report draft V${detail.workspace.versionNo} saved` : `保存报告草稿 V${detail.workspace.versionNo}`} meta={`${formatDateTime(detail.workspace.createdAt)} · ${detail.workspace.changeReason}`} /> : null}{detail.report.submittedAt ? <HistoryItem title={english ? "Original return submitted" : "原始回单已提交"} meta={formatDateTime(detail.report.submittedAt)} /> : null}{detail.communications.map((item) => <HistoryItem key={item.id} title={communicationHistoryTitle(item, english)} meta={`${formatDateTime(item.initiatedAt)} · ${channelLabel[item.channel]}${item.noteOrReply ? ` · ${item.noteOrReply}` : ""}`} />)}</ol></div></section>;
}

function communicationHistoryTitle(item: FormalInspectionCommunication, english: boolean) {
  if (item.noteOrReply?.startsWith("状态更正：")) return english ? "Follow-up stage corrected" : "更正跟进状态";
  if (item.status === "confirmed") return english ? "Customer response recorded" : "登记客户回复";
  if (item.status === "not_delivered") return english ? "Customer notification not delivered" : "客户通知未送达";
  return english ? "Customer contact initiated" : "发起客户通知";
}

function HistoryItem({ title, meta }: { title: string; meta: string }) {
  return <li className="relative pb-6"><span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-primary" /><strong className="text-sm">{title}</strong><p className="mt-1 text-xs text-ink-soft">{meta}</p></li>;
}
