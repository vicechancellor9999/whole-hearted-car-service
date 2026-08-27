"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  X,
  FileText,
  Sparkles,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  History,
  Camera,
  Gauge,
  ArrowRight,
} from "lucide-react";
import {
  FLOW_STAGE_LABELS,
  TEAM_LABELS,
  type InspectionReportDetail,
  type InspectionItem,
} from "./types";
import { cn, formatJMDFull, formatDateTime } from "@/lib/utils";

interface InspectionDetailModalProps {
  report: InspectionReportDetail;
  onClose: () => void;
}

function decisionBadge(decision?: InspectionItem["customerDecision"]) {
  switch (decision) {
    case "accepted":
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-success dark:bg-emerald-500/10 dark:text-emerald-400">
          <CheckCircle2 size={9} aria-hidden /> 已采用
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-danger dark:bg-rose-500/10 dark:text-rose-400">
          <XCircle size={9} aria-hidden /> 已拒绝
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-warning dark:bg-amber-500/10 dark:text-amber-400">
          <Clock size={9} aria-hidden /> 待决定
        </span>
      );
  }
}

function itemTotalJmd(item: InspectionItem): number {
  return item.laborJmd + (item.partsJmd ?? 0);
}

export function InspectionDetailModal({ report, onClose }: InspectionDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        (initialFocusRef.current ?? dialog).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", keepFocusInside);
    document.body.style.overflow = "hidden";
    (initialFocusRef.current ?? dialog)?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const currentVersion = report.versions.find((v) => v.version === report.currentVersion);
  const totalJmd = currentVersion
    ? currentVersion.items.reduce((sum, item) => sum + itemTotalJmd(item), 0)
    : 0;

  return (
    <div
      ref={dialogRef}
      data-testid="inspection-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`检查报告 ${report.irNo}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative my-auto w-full max-w-4xl rounded-[22px] border border-line bg-white shadow-card-hover",
          "dark:border-slate-600 dark:bg-slate-800",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-600 sm:p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold text-ink dark:text-slate-100">
                {report.irNo}
              </h2>
              <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary dark:bg-primary-500/10 dark:text-primary-300">
                {report.currentVersion}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft dark:text-slate-400">
              <span>{report.customer.nameZh}{report.customer.nameEn ? ` · ${report.customer.nameEn}` : ""}</span>
              <span className="font-mono">{report.vehicle.plate}</span>
              <span>{report.vehicle.modelZh}{report.vehicle.modelEn ? ` · ${report.vehicle.modelEn}` : ""}</span>
            </div>
          </div>
          <button
            ref={initialFocusRef}
            type="button"
            data-testid="inspection-detail-close"
            aria-label="关闭"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-line p-1.5 text-ink-soft transition-colors hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* Section 1: NL original text + signature */}
          <div data-testid="inspection-nl-original">
            <div className="flex items-center gap-1.5">
              <FileText size={13} className="text-primary" aria-hidden />
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-soft dark:text-slate-400">
                维修工自然语言原文
              </h3>
            </div>
            <div className="mt-2 rounded-xl border border-line bg-surface/50 p-3 dark:border-slate-600 dark:bg-slate-700/30">
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink dark:text-slate-200">
                {report.naturalLanguageText}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-[10px] dark:border-slate-600">
                <span className="text-ink-soft dark:text-slate-400">
                  署名 <b className="text-ink dark:text-slate-100">{report.submittedBy.name}</b>
                </span>
                <span className="text-ink-soft dark:text-slate-400">
                  人员编号 <b className="font-mono text-ink dark:text-slate-100">{report.submittedBy.id}</b>
                </span>
                <span className="text-ink-soft dark:text-slate-400">
                  班组 <b className="text-ink dark:text-slate-100">{report.submittedBy.teamName}</b>
                </span>
                <span className="text-ink-soft dark:text-slate-400">
                  提交时间{" "}
                  <b className="text-ink dark:text-slate-100">
                    {report.submittedAt
                      ? formatDateTime(report.submittedAt)
                      : report.submittedBy.name}
                  </b>
                </span>
                {report.mileage ? (
                  <span className="inline-flex items-center gap-0.5 text-ink-soft dark:text-slate-400">
                    <Gauge size={10} aria-hidden />
                    <b className="text-ink dark:text-slate-100">{report.mileage}</b>
                  </span>
                ) : null}
                {report.photoCount > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-ink-soft dark:text-slate-400">
                    <Camera size={10} aria-hidden />
                    <b className="text-ink dark:text-slate-100">{report.photoCount} 张照片</b>
                  </span>
                ) : null}
              </div>
            </div>
            <p className="mt-1 text-[9px] text-ink-faint dark:text-slate-500">
              原始署名记录不可被 AI、前台编辑或后续改组覆盖。
            </p>
          </div>

          {/* Section 2: AI draft */}
          <div data-testid="inspection-ai-draft">
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-purple-500" aria-hidden />
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-soft dark:text-slate-400">
                AI 整理草稿
              </h3>
            </div>
            <div className="mt-2 rounded-xl border border-purple-500/20 bg-purple-50/40 p-3 dark:bg-purple-500/5">
              <p className="text-[12px] font-medium text-ink dark:text-slate-200">
                {report.aiDraft.conclusion}
              </p>
              <div className="mt-2 space-y-1">
                {report.aiDraft.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-[11px]">
                    <span className="text-ink-soft dark:text-slate-400">
                      {item.nameZh}{item.nameEn ? ` · ${item.nameEn}` : ""}
                    </span>
                    <span className="tabular-nums text-ink dark:text-slate-100">
                      {formatJMDFull(itemTotalJmd(item))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 border-t border-purple-500/15 pt-2">
                <p className="text-[10px] text-ink-soft dark:text-slate-400">
                  {report.aiDraft.customerNoteZh}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-faint dark:text-slate-500">
                  {report.aiDraft.customerNoteEn}
                </p>
              </div>
            </div>
            <p className="mt-1 text-[9px] text-ink-faint dark:text-slate-500">
              AI 仅整理结构化草稿，不伪造检查事实、价格、署名或完成状态。
            </p>
          </div>

          {/* Section 3: Official versions */}
          <div data-testid="inspection-versions">
            <div className="flex items-center gap-1.5">
              <GitBranch size={13} className="text-primary" aria-hidden />
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-soft dark:text-slate-400">
                正式检查报价版本
              </h3>
            </div>
            <div className="mt-2 space-y-2">
              {report.versions.map((version) => {
                const isCurrent = version.version === report.currentVersion;
                const versionTotal = version.items.reduce((sum, item) => sum + itemTotalJmd(item), 0);
                return (
                  <div
                    key={version.version}
                    className={cn(
                      "rounded-xl border p-3",
                      isCurrent
                        ? "border-primary/30 bg-primary-50/30 dark:bg-primary-500/5"
                        : "border-line bg-surface/40 dark:border-slate-600 dark:bg-slate-700/20",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-ink dark:text-slate-100">
                          {version.version}
                        </span>
                        {isCurrent ? (
                          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-medium text-white">
                            当前
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-ink-soft dark:text-slate-400">
                        <span>{formatDateTime(version.publishedAt)}</span>
                        <span>{version.publishedBy}</span>
                        <span className="tabular-nums font-semibold text-ink dark:text-slate-100">
                          {formatJMDFull(versionTotal)}
                        </span>
                      </div>
                    </div>

                    {/* Version items with customer decisions */}
                    <div className="mt-2 text-[9px] font-semibold text-ink-soft dark:text-slate-400">
                      报价项目与客户决定
                    </div>
                    <div className="mt-1 space-y-1">
                      {version.items.map((item) => {
                        const isConverted = report.convertedItemIds.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between rounded-lg bg-white/50 px-2 py-1.5 text-[11px] dark:bg-slate-800/40"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-ink dark:text-slate-200">
                                {item.nameZh}
                              </span>
                              {item.nameEn ? (
                                <span className="hidden truncate text-[10px] text-ink-soft dark:text-slate-400 sm:inline">
                                  {item.nameEn}
                                </span>
                              ) : null}
                              {decisionBadge(item.customerDecision)}
                              {isConverted ? (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[9px] font-medium text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
                                  <ArrowRight size={9} aria-hidden /> 已转工单
                                </span>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-[10px] text-ink-soft dark:text-slate-400">
                                {item.quantity > 1 ? `×${item.quantity} ` : ""}
                                {item.partsName ? `${item.partsName} · ` : ""}
                              </span>
                              <span className="tabular-nums font-semibold text-ink dark:text-slate-100">
                                {formatJMDFull(itemTotalJmd(item))}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[9px] text-ink-faint dark:text-slate-500">
              旧版本可查看、比较和打印。内容或价格改变时发布新版本，不覆盖旧版本。
            </p>
          </div>

          {/* Section 4: Converted / unconverted items summary */}
          {report.convertedItemIds.length > 0 || report.linkedOrderNo ? (
            <div data-testid="inspection-conversion-summary">
              <div className="flex items-center gap-1.5">
                <ArrowRight size={13} className="text-cyan-600" aria-hidden />
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-soft dark:text-slate-400">
                  已转换与未转换项目
                </h3>
              </div>
              <div className="mt-2 rounded-xl border border-line bg-surface/40 p-3 dark:border-slate-600 dark:bg-slate-700/20">
                {report.linkedOrderNo ? (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-ink-soft dark:text-slate-400">关联维修工单</span>
                    <span className="font-mono font-semibold text-cyan-700 dark:text-cyan-300">
                      {report.linkedOrderNo}
                    </span>
                  </div>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
                  <span className="text-ink-soft dark:text-slate-400">
                    已转换 <b className="text-success dark:text-emerald-400">{report.convertedItemIds.length}</b> 项
                  </span>
                  <span className="text-ink-soft dark:text-slate-400">
                    未转换{" "}
                    <b className="text-ink dark:text-slate-100">
                      {(currentVersion?.items.length ?? 0) - report.convertedItemIds.length}
                    </b> 项
                  </span>
                </div>
                {report.conversionReferences?.length ? (
                  <div className="mt-2 space-y-1 border-t border-line pt-2 dark:border-slate-600">
                    {report.conversionReferences.map((reference) => (
                      <div
                        key={`${reference.sourceVersion}-${reference.sourceItemId}`}
                        className="flex flex-wrap items-center gap-x-1.5 text-[9px] text-ink-soft dark:text-slate-400"
                      >
                        <span>来源项目</span>
                        <b className="text-ink dark:text-slate-100">
                          {reference.sourceVersion} · {reference.sourceItemName}
                        </b>
                        <span className="font-mono">({reference.sourceItemId})</span>
                        <ArrowRight size={9} aria-hidden />
                        <span className="font-mono text-cyan-700 dark:text-cyan-300">
                          {reference.linkedOrderNo}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Section 5: Reassignment history */}
          <div data-testid="inspection-reassignment-history">
            <div className="flex items-center gap-1.5">
              <History size={13} className="text-amber-500" aria-hidden />
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-soft dark:text-slate-400">
                改组历史
              </h3>
            </div>
            <div className="mt-2 rounded-xl border border-line bg-surface/40 p-3 dark:border-slate-600 dark:bg-slate-700/20">
              {report.reassignmentHistory.length === 0 ? (
                <p className="text-[11px] text-ink-soft dark:text-slate-400">
                  检查署名班组为 {report.submittedBy.teamName}，无改组记录。
                </p>
              ) : (
                <div className="space-y-1.5">
                  {report.reassignmentHistory.map((record) => (
                    <div key={record.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      <span className="font-mono text-ink-soft dark:text-slate-400">
                        {formatDateTime(record.timestamp)}
                      </span>
                      <span className="text-ink dark:text-slate-200">{record.fromTeamName}</span>
                      <ArrowRight size={11} className="text-ink-faint" aria-hidden />
                      <span className="font-medium text-ink dark:text-slate-100">{record.toTeamName}</span>
                      <span className="text-ink-soft dark:text-slate-400">· {record.reason}</span>
                      <span className="text-ink-faint dark:text-slate-500">· {record.operator}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[9px] text-ink-faint dark:text-slate-500">
                检查署名和来源班组永远保留；后续改组不篡改检查事实。
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line p-3 dark:border-slate-600 sm:px-5">
          <span className="text-[10px] text-ink-soft dark:text-slate-400">
            报价金额合计{" "}
            <b className="tabular-nums text-ink dark:text-slate-100">{formatJMDFull(totalJmd)}</b>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-lg border border-line px-4 text-xs font-semibold text-ink-soft transition-colors hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
