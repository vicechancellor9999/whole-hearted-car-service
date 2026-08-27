"use client";

import { useState } from "react";
import { api } from "@/lib/api/client";
import type {
  PerformanceRuleVersion,
  RuleDraftInput,
  RuleImpactPreview,
  RuleWorkspaceResponse,
} from "@/lib/performance/types";
import { RuleImpactPreview as ImpactPreview } from "./rule-impact-preview";

type RuleFormValues = {
  commissionRatePercent: string;
  cnyToJmdRate: string;
  effectiveMonth: string;
  reason: string;
};

type RuleEditorState =
  | { status: "editing" }
  | { status: "previewing" }
  | { status: "previewed"; preview: RuleImpactPreview }
  | { status: "saving"; preview: RuleImpactPreview }
  | { status: "saved"; rule: PerformanceRuleVersion }
  | { status: "activating"; rule: PerformanceRuleVersion }
  | { status: "error"; message: string; preview?: RuleImpactPreview; rule?: PerformanceRuleVersion };

export function RuleVersionForm({
  workspace,
  onActivated,
}: {
  workspace: RuleWorkspaceResponse;
  onActivated: (workspace: RuleWorkspaceResponse) => void;
}) {
  const current = workspace.currentRule;
  const [values, setValues] = useState<RuleFormValues>({
    commissionRatePercent: String(current.parameters.commissionRate * 100),
    cnyToJmdRate: String(current.parameters.cnyToJmdRate),
    effectiveMonth: nextMonth(workspace.currentMonth),
    reason: "",
  });
  const [state, setState] = useState<RuleEditorState>({ status: "editing" });

  const update = (field: keyof RuleFormValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setState({ status: "editing" });
  };
  const input = (): RuleDraftInput => ({
    commissionRatePercent: Number(values.commissionRatePercent),
    cnyToJmdRate: Number(values.cnyToJmdRate),
    effectiveMonth: values.effectiveMonth as RuleDraftInput["effectiveMonth"],
    reason: values.reason,
  });
  const preview = state.status === "previewed" || state.status === "saving"
    ? state.preview
    : state.status === "error"
      ? state.preview
      : undefined;
  const savedRule = state.status === "saved" || state.status === "activating"
    ? state.rule
    : state.status === "error"
      ? state.rule
      : undefined;

  const runPreview = async () => {
    setState({ status: "previewing" });
    try {
      setState({ status: "previewed", preview: await api.performance.previewRule(input()) });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
  const save = async () => {
    if (!preview) return;
    setState({ status: "saving", preview });
    try {
      const rule = await api.performance.saveRuleDraft({ draft: input(), previewToken: preview.previewToken });
      setState({ status: "saved", rule });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error), preview });
    }
  };
  const activate = async () => {
    if (!savedRule) return;
    setState({ status: "activating", rule: savedRule });
    try {
      const next = await api.performance.activateRule(savedRule.id);
      onActivated(next);
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error), rule: savedRule });
    }
  };

  const monthOptions = [workspace.currentMonth, ...Array.from({ length: 5 }, (_, index) => addMonths(workspace.currentMonth, index + 1))]
    .filter((month) => !workspace.lockedMonths.includes(month));

  return (
    <div className="rounded-xl border border-line bg-surface p-3 sm:p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="工时费提成比例（%）">
          <input data-testid="rule-commission-input" value={values.commissionRatePercent} onChange={(event) => update("commissionRatePercent", event.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="人民币汇率（JMD）">
          <input data-testid="rule-exchange-rate-input" value={values.cnyToJmdRate} onChange={(event) => update("cnyToJmdRate", event.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="生效月份">
          <select data-testid="rule-effective-month" value={values.effectiveMonth} onChange={(event) => update("effectiveMonth", event.target.value)} className={inputClass}>
            {monthOptions.map((month) => <option key={month} value={month}>{monthLabel(month)}{month === workspace.currentMonth ? "（本月启用）" : ""}</option>)}
          </select>
        </Field>
        <Field label="变更原因">
          <input data-testid="rule-change-reason" value={values.reason} onChange={(event) => update("reason", event.target.value)} className={inputClass} placeholder="说明为什么调整" />
        </Field>
      </div>
      {state.status === "error" && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-danger">{state.message}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button data-testid="preview-rule-impact" disabled={state.status === "previewing" || state.status === "saving" || state.status === "activating"} onClick={runPreview} className={secondaryButton}>
          {state.status === "previewing" ? "计算中…" : "预览四组影响"}
        </button>
        <button data-testid="save-rule-draft" disabled={!preview || state.status === "saving"} onClick={save} className={secondaryButton}>
          {state.status === "saving" ? "保存中…" : "保存草稿"}
        </button>
        <button data-testid="activate-rule-version" disabled={!savedRule || state.status === "activating"} onClick={activate} className={primaryButton}>
          {state.status === "activating" ? "启用中…" : values.effectiveMonth === workspace.currentMonth ? "保存并启用" : "保存并排期"}
        </button>
      </div>
      {preview && <ImpactPreview preview={preview} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-ink-soft">{label}</span>{children}</label>;
}

function addMonths(month: string, amount: number) {
  const [year, rawMonth] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, rawMonth - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` as RuleDraftInput["effectiveMonth"];
}
const nextMonth = (month: string) => addMonths(month, 1);
const monthLabel = (month: string) => { const [year, value] = month.split("-"); return `${year}年${Number(value)}月`; };
const inputClass = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-primary";
const secondaryButton = "rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary-50 disabled:hover:bg-transparent";
const primaryButton = "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-600";
