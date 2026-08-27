"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ArrowRight, AlertTriangle, Lock } from "lucide-react";
import {
  TEAM_COLORS,
  TEAM_LABELS,
  TEAM_ORDER,
  type DocumentListItem,
  type TeamId,
} from "./types";
import { canReassign } from "./visual-data";
import { cn } from "@/lib/utils";

export interface ReassignmentResult {
  fromTeamId: TeamId;
  toTeamId: TeamId;
  reason: string;
}

interface ReassignmentDialogProps {
  document: DocumentListItem;
  operatorName: string;
  onClose: () => void;
  onConfirm: (result: ReassignmentResult) => void | Promise<void>;
}

const REASON_PRESETS = [
  "一组负载较高，调度到二组",
  "二组有相关车型经验",
  "客户指定班组",
  "班组人员调整",
  "维修项目变更",
];

export function ReassignmentDialog({
  document: orderDocument,
  operatorName,
  onClose,
  onConfirm,
}: ReassignmentDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const eligible = canReassign(orderDocument.flowStage);
  const fromTeamId = orderDocument.teamId;
  const [toTeamId, setToTeamId] = useState<TeamId | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  const handleConfirm = useCallback(async () => {
    if (pendingRef.current) return;
    if (!eligible) {
      setError("当前阶段不允许改组。正式交单后只能走绩效更正。");
      return;
    }
    if (!fromTeamId) {
      setError("当前未派组，无法改组。请先派组。");
      return;
    }
    if (!toTeamId) {
      setError("请选择新班组。");
      return;
    }
    if (toTeamId === fromTeamId) {
      setError("新班组与原班组相同。");
      return;
    }
    if (!reason.trim()) {
      setError("请填写改组原因。");
      return;
    }
    setError(null);
    pendingRef.current = true;
    setPending(true);
    try {
      await onConfirm({
        fromTeamId,
        toTeamId,
        reason: reason.trim(),
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [eligible, fromTeamId, onConfirm, reason, toTeamId]);

  return (
    <div
      ref={dialogRef}
      data-testid="reassignment-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`改组 ${orderDocument.docNo}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-lg rounded-[22px] border border-line bg-white shadow-card-hover dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-600 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink dark:text-slate-100">人工改组</h2>
            <p className="mt-0.5 text-[11px] text-ink-soft dark:text-slate-400">
              {orderDocument.docNo} · {orderDocument.customer.nameZh} · {orderDocument.vehicle.plate}
            </p>
          </div>
          <button
            ref={initialFocusRef}
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-line p-1.5 text-ink-soft transition-colors hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4 sm:p-5">
          <p className="rounded-lg bg-surface/60 px-3 py-2 text-[10px] text-ink-soft dark:bg-slate-700/30 dark:text-slate-400">
            维修班组默认继承检查结果的署名班组；前台正式交单前可根据现场负载人工调整，检查署名不会被改写。
          </p>
          {!eligible ? (
            <div
              data-testid="reassignment-locked"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-50/60 p-3 dark:bg-amber-500/10"
            >
              <Lock size={16} className="mt-0.5 shrink-0 text-warning dark:text-amber-400" aria-hidden />
              <div>
                <p className="text-[12px] font-medium text-ink dark:text-slate-200">
                  当前阶段不允许改组
                </p>
                <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                  前台正式交单后禁止普通改组。如发现绩效归属错误，只能走带原因的绩效更正。
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Current team → New team */}
              <div>
                <label className="text-[11px] font-semibold text-ink-soft dark:text-slate-400">
                  班组变更
                </label>
                <div className="mt-2 flex items-center gap-3">
                  {/* From */}
                  <div
                    className="flex-1 rounded-xl border border-line p-2.5 text-center dark:border-slate-600"
                    style={{ borderLeftWidth: 3, borderLeftColor: fromTeamId ? TEAM_COLORS[fromTeamId] : "#9ca3af" }}
                  >
                    <div className="text-[9px] text-ink-soft dark:text-slate-400">原班组</div>
                    <div className="mt-0.5 text-[12px] font-bold text-ink dark:text-slate-100">
                      {fromTeamId ? TEAM_LABELS[fromTeamId] : "未派组"}
                    </div>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-ink-faint" aria-hidden />
                  {/* To */}
                  <div
                    className="flex-1 rounded-xl border border-line p-2.5 text-center dark:border-slate-600"
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: toTeamId ? TEAM_COLORS[toTeamId] : "var(--wh-border)",
                    }}
                  >
                    <div className="text-[9px] text-ink-soft dark:text-slate-400">新班组</div>
                    <div className="mt-0.5 text-[12px] font-bold text-ink dark:text-slate-100">
                      {toTeamId ? TEAM_LABELS[toTeamId] : "选择…"}
                    </div>
                  </div>
                </div>

                {/* Team selector */}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {TEAM_ORDER.filter((id) => id !== fromTeamId).map((id) => (
                    <button
                      key={id}
                      type="button"
                      data-testid={`reassignment-team-${id}`}
                      aria-pressed={toTeamId === id}
                      onClick={() => setToTeamId(id)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-medium transition-all",
                        "motion-reduce:transition-none",
                        toTeamId === id
                          ? "border-primary bg-primary-50 text-primary dark:bg-primary-500/10 dark:text-primary-300"
                          : "border-line bg-white text-ink-soft hover:border-primary-200 dark:bg-slate-700/40 dark:text-slate-300",
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: TEAM_COLORS[id] }}
                      />
                      {TEAM_LABELS[id]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason */}
              <div>
                <label
                  htmlFor="reassignment-reason"
                  className="text-[11px] font-semibold text-ink-soft dark:text-slate-400"
                >
                  调整原因 <span className="text-danger">*</span>
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {REASON_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[10px] transition-colors",
                        reason === preset
                          ? "border-primary bg-primary-50 text-primary dark:bg-primary-500/10 dark:text-primary-300"
                          : "border-line bg-white text-ink-soft hover:border-primary-200 dark:bg-slate-700/40 dark:text-slate-300",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <textarea
                  id="reassignment-reason"
                  data-testid="reassignment-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="填写改组原因（必填）"
                  rows={2}
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-[12px] text-ink placeholder:text-ink-soft focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:bg-slate-700/40 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:ring-primary-900"
                />
              </div>

              {/* Operator + time info */}
              <div className="flex items-center gap-4 rounded-lg bg-surface/50 px-3 py-2 text-[10px] text-ink-soft dark:bg-slate-700/30 dark:text-slate-400">
                <span>
                  操作人 <b className="text-ink dark:text-slate-100">{operatorName}</b>
                </span>
                <span>
                  操作时间 <b className="text-ink dark:text-slate-100">确认后由系统记录</b>
                </span>
              </div>

              {error ? (
                <div className="flex items-start gap-1.5 rounded-lg border border-danger/30 bg-rose-50/60 p-2 text-[11px] text-danger dark:bg-rose-500/10 dark:text-rose-400">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line p-3 dark:border-slate-600 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-lg border border-line px-4 text-xs font-semibold text-ink-soft transition-colors hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400"
          >
            取消
          </button>
          {eligible ? (
            <button
              type="button"
              data-testid="reassignment-confirm"
              onClick={handleConfirm}
              disabled={pending || !toTeamId || !reason.trim() || toTeamId === fromTeamId}
              className="min-h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {pending ? "正在改组…" : "确认改组"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
