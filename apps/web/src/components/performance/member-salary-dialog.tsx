"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Calculator, Save } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";
import type {
  PerformanceMemberDetail,
  SalaryChangePreview,
  TeamMonthSnapshot,
  TeamPerformanceDetailResponse,
} from "@/lib/performance/types";
import {
  formatCNYFull,
  formatDateTime,
  formatJMDFull,
  formatPercentRatio,
  formatYearMonth,
} from "@/lib/utils";

type SalaryEditState =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "previewed"; preview: SalaryChangePreview }
  | { status: "saving"; preview: SalaryChangePreview }
  | { status: "error"; message: string; preview?: SalaryChangePreview };

interface MemberSalaryDialogProps {
  detail: PerformanceMemberDetail;
  snapshot: TeamMonthSnapshot;
  returnFocusElement?: HTMLElement | null;
  onClose: () => void;
  onSaved: (detail: TeamPerformanceDetailResponse, member: PerformanceMemberDetail) => void;
}

const amountOrError = (value: number | null, currency: "cny" | "jmd", digits = 2) => {
  if (value === null) return "无法测算";
  return currency === "cny" ? formatCNYFull(value, digits) : formatJMDFull(value);
};

const messageOf = (error: unknown) => error instanceof Error ? error.message : "请求失败，请稍后重试";

export function MemberSalaryDialog({
  detail,
  snapshot,
  returnFocusElement,
  onClose,
  onSaved,
}: MemberSalaryDialogProps) {
  const [salaryInput, setSalaryInput] = useState(() => String(detail.member.standardSalaryCny ?? ""));
  const [inputTouched, setInputTouched] = useState(false);
  const [editState, setEditState] = useState<SalaryEditState>({ status: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSalaryInput(String(detail.member.standardSalaryCny ?? ""));
    setInputTouched(false);
    setEditState({ status: "idle" });
    setSaveError(null);
  }, [detail.member.memberId, detail.member.standardSalaryCny, detail.selectedMonth]);

  const parsedSalary = Number(salaryInput);
  const salaryIsValid = salaryInput.trim() !== ""
    && Number.isFinite(parsedSalary)
    && parsedSalary > 0
    && parsedSalary <= 1_000_000;
  const canEdit = detail.permissions.canEditSalary && snapshot.status === "collecting";
  const preview = editState.status === "previewed"
    || editState.status === "saving"
    || editState.status === "error"
    ? editState.preview
    : undefined;
  const canSave = editState.status === "previewed"
    || (editState.status === "error" && editState.preview !== undefined);

  const handleInput = (value: string) => {
    setSalaryInput(value);
    setInputTouched(true);
    setEditState({ status: "idle" });
    setSaveError(null);
  };

  const handlePreview = async () => {
    if (!salaryIsValid) {
      setInputTouched(true);
      return;
    }
    setEditState({ status: "previewing" });
    setSaveError(null);
    try {
      const nextPreview = await api.performance.previewSalary({
        teamId: detail.teamId,
        memberId: detail.member.memberId,
        month: detail.selectedMonth,
        newSalaryCny: parsedSalary,
      });
      setEditState({ status: "previewed", preview: nextPreview });
    } catch (error) {
      setEditState({ status: "error", message: messageOf(error) });
    }
  };

  const handleSave = async () => {
    if (!preview || !canSave) return;
    setEditState({ status: "saving", preview });
    setSaveError(null);
    try {
      const result = await api.performance.updateSalary({
        ...preview.input,
        previewToken: preview.previewToken,
      });
      onSaved(result.detail, result.member);
      setEditState({ status: "idle" });
    } catch (error) {
      const message = messageOf(error);
      setSaveError(message);
      if (message.includes("源数据已变化")) {
        setEditState({ status: "idle" });
      } else {
        setEditState({ status: "error", message, preview });
      }
    }
  };

  return (
    <Dialog
      open
      title={`${detail.member.name} · 工资详情`}
      onClose={onClose}
      returnFocusElement={returnFocusElement}
      dataTestId="member-wage-dialog"
      closeTestId="member-dialog-close"
    >
      <div className="space-y-5 p-4 sm:p-5">
        <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-ink dark:text-slate-100">{detail.member.name}</h3>
              <span className="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold text-primary dark:bg-primary/15">
                {detail.member.role}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">
              {detail.member.employeeNo} · {formatYearMonth(detail.selectedMonth)} · {snapshot.status === "locked" ? "已锁定快照" : "正在归集"}
            </p>
          </div>
          <div className="sm:text-right">
            <div className="text-[10px] text-ink-soft dark:text-slate-400">月标准工资（人民币）</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-slate-100">
              {amountOrError(detail.member.standardSalaryCny, "cny", 0)}
            </div>
          </div>
        </section>

        <section aria-label="成员工资测算摘要" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["携带班组指标", amountOrError(detail.member.carriedTargetJmd, "jmd")],
            ["班组统一完成率", detail.teamCompletionRate === null ? "无法测算" : formatPercentRatio(detail.teamCompletionRate, 4)],
            ["工资预算", amountOrError(detail.member.wageBudgetCny, "cny")],
            ["应发工资测算", amountOrError(detail.member.estimatedPayableCny, "cny")],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border border-line bg-white p-3 dark:bg-slate-800">
              <div className="text-[10px] font-medium text-ink-soft dark:text-slate-400">{label}</div>
              <div className="mt-2 break-words text-sm font-bold tabular-nums text-ink dark:text-slate-100">{value}</div>
            </div>
          ))}
        </section>

        {canEdit ? (
          <section className="rounded-2xl border border-primary-100 bg-primary-50/45 p-4 dark:border-primary/30 dark:bg-primary/10">
            <div className="flex items-start gap-2">
              <Calculator className="mt-0.5 shrink-0 text-primary" size={17} aria-hidden />
              <div>
                <h3 className="text-sm font-bold text-ink dark:text-slate-100">调整月标准工资</h3>
                <p className="mt-1 text-[11px] leading-4 text-ink-soft dark:text-slate-400">
                  先预览对成员携带指标、班组完成率和整组工资测算的影响，再保存。
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
              <label className="block text-xs font-semibold text-ink dark:text-slate-200">
                月标准工资（人民币）
                <input
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  value={salaryInput}
                  data-testid="standard-wage-input"
                  aria-invalid={inputTouched && !salaryIsValid}
                  aria-describedby={!salaryIsValid ? "standard-wage-error" : undefined}
                  onChange={(event) => handleInput(event.target.value)}
                  onBlur={() => setInputTouched(true)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <button
                type="button"
                data-testid="preview-wage-impact"
                disabled={!salaryIsValid || editState.status === "previewing" || editState.status === "saving"}
                onClick={handlePreview}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-primary bg-white px-4 text-xs font-bold text-primary transition-colors hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-slate-900"
              >
                {editState.status === "previewing" ? "预览中…" : "预览影响"}
              </button>
              <button
                type="button"
                data-testid="save-standard-wage"
                disabled={!canSave}
                onClick={handleSave}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Save size={14} aria-hidden />
                {editState.status === "saving" ? "保存中…" : "保存标准工资"}
              </button>
            </div>
            {inputTouched && !salaryIsValid ? (
              <p id="standard-wage-error" data-testid="standard-wage-error" className="mt-2 text-xs font-medium text-danger">
                标准工资必须大于 0 且不超过 ¥1,000,000。
              </p>
            ) : null}
            {editState.status === "error" && !editState.preview ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
                <AlertCircle size={14} aria-hidden />{editState.message}
              </p>
            ) : null}
            {saveError ? (
              <p data-testid="wage-save-error" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
                <AlertCircle size={14} aria-hidden />{saveError}
              </p>
            ) : null}

            {preview ? (
              <div className="mt-4 rounded-xl border border-primary-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs font-bold text-ink dark:text-slate-100">预览影响</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-surface p-3 dark:bg-slate-800">
                    <div className="text-[10px] text-ink-soft dark:text-slate-400">个人携带班组指标</div>
                    <div data-testid="wage-impact-member-target" className="mt-1 flex flex-wrap items-center gap-1 text-xs font-bold tabular-nums text-ink dark:text-slate-100">
                      {amountOrError(preview.before.members.find((member) => member.memberId === preview.changedMemberId)?.carriedTargetJmd ?? null, "jmd")}
                      <ArrowRight size={13} aria-hidden />
                      {amountOrError(preview.after.members.find((member) => member.memberId === preview.changedMemberId)?.carriedTargetJmd ?? null, "jmd")}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface p-3 dark:bg-slate-800">
                    <div className="text-[10px] text-ink-soft dark:text-slate-400">班组指标</div>
                    <div data-testid="wage-impact-team-target" className="mt-1 flex flex-wrap items-center gap-1 text-xs font-bold tabular-nums text-ink dark:text-slate-100">
                      {amountOrError(preview.before.teamTargetJmd, "jmd")}
                      <ArrowRight size={13} aria-hidden />
                      {amountOrError(preview.after.teamTargetJmd, "jmd")}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink-soft dark:bg-slate-900/60 dark:text-slate-400">
            {snapshot.status === "locked" ? "该月份已锁定，仅可查看工资详情。" : "当前身份仅可查看工资详情。"}
          </p>
        )}

        <section>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-ink dark:text-slate-100">历月工资测算</h3>
              <p className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">展示已锁定月份的携带指标、工资预算与应发测算。</p>
            </div>
            <span className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">{detail.history.length} 个月</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {detail.history.map(({ month, result }) => (
              <div key={month} data-testid="member-history-row" className="rounded-xl border border-line bg-white p-3 dark:bg-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink dark:text-slate-100">{formatYearMonth(month)}</span>
                  <span className="text-xs font-bold tabular-nums text-primary">{amountOrError(result.estimatedPayableCny, "cny")}</span>
                </div>
                <div className="mt-2 grid gap-1 text-[10px] text-ink-soft dark:text-slate-400">
                  <span>携带班组指标：<b className="font-semibold text-ink dark:text-slate-200">{amountOrError(result.carriedTargetJmd, "jmd")}</b></span>
                  <span>工资预算：<b className="font-semibold text-ink dark:text-slate-200">{amountOrError(result.wageBudgetCny, "cny")}</b></span>
                  <span>应发工资测算：<b className="font-semibold text-ink dark:text-slate-200">{amountOrError(result.estimatedPayableCny, "cny")}</b></span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section data-testid="wage-adjustment-history">
          <h3 className="text-sm font-bold text-ink dark:text-slate-100">标准工资调整记录</h3>
          {detail.salaryAdjustments.length === 0 ? (
            <p className="mt-2 rounded-xl bg-surface px-3 py-3 text-xs text-ink-soft dark:bg-slate-900/60 dark:text-slate-400">暂无工资调整记录</p>
          ) : (
            <div className="mt-2 space-y-2">
              {detail.salaryAdjustments.slice().reverse().map((record) => (
                <div key={record.id} className="flex flex-col gap-1 rounded-xl bg-surface px-3 py-3 text-xs dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
                  <div className="font-bold tabular-nums text-ink dark:text-slate-100">
                    {formatCNYFull(record.fromCny, 0)} <ArrowRight className="mx-1 inline" size={13} aria-hidden /> {formatCNYFull(record.toCny, 0)}
                  </div>
                  <div className="text-[10px] text-ink-soft dark:text-slate-400">{formatDateTime(record.changedAt)} · {record.changedBy}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
