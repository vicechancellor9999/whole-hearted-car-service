"use client";

import { useCallback, useState } from "react";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import type { CustomerRecord, RiskFlag } from "@/lib/customers/types";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";

const RISK_LEVEL_LABEL: Record<RiskFlag["level"], string> = {
  attention: "关注",
  high: "高风险",
  blacklist: "黑名单",
};

interface VerificationRiskSectionsProps {
  customer: CustomerRecord;
  onChanged: () => void;
}

/** 风险状态仍为提醒制；验证证据已拆到 VerificationEvidenceSection。 */
export function VerificationRiskSections({ customer, onChanged }: VerificationRiskSectionsProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingRisk, setAddingRisk] = useState(false);
  const [addTrigger, setAddTrigger] = useState<HTMLElement | null>(null);

  const run = useCallback(async (key: string, action: () => Promise<unknown>) => {
    setPending(key);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
    } finally {
      setPending(null);
    }
  }, [onChanged]);

  const activeFlags = customer.riskFlags.filter((flag) => flag.removedAt === null);
  const removedFlags = customer.riskFlags.filter((flag) => flag.removedAt !== null);

  return (
    <>
      <section data-testid="customer-risk-section" className="rounded-2xl border border-line bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert size={15} className={activeFlags.length > 0 ? "text-rose-600" : "text-ink-soft"} aria-hidden />
            <h3 className="text-sm font-bold text-ink dark:text-slate-100">风险状态</h3>
            <span className="text-[10px] text-ink-soft dark:text-slate-400">跟随客户基本资料 · 提醒但不阻止办理</span>
          </div>
          <button
            type="button"
            data-testid="risk-add-btn"
            onClick={(event) => { setAddTrigger(event.currentTarget); setAddingRisk(true); }}
            className="inline-flex min-h-8 items-center rounded-lg border border-line px-2.5 text-[11px] font-semibold text-ink hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            ＋ 添加风险
          </button>
        </div>
        {activeFlags.length === 0 ? (
          <p data-testid="risk-empty" className="rounded-xl bg-surface px-3 py-2.5 text-xs text-ink-soft dark:bg-slate-900/50 dark:text-slate-400">暂无风险条目</p>
        ) : (
          <div className="space-y-2">
            {activeFlags.map((flag) => (
              <div key={flag.id} data-testid={`risk-flag-${flag.id}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 ${flag.level === "blacklist" ? "bg-rose-50 dark:bg-rose-500/10" : flag.level === "high" ? "bg-amber-50 dark:bg-amber-500/10" : "bg-surface dark:bg-slate-900/50"}`}>
                <div className="min-w-0">
                  <p className="text-xs">
                    <span className={`font-bold ${flag.level === "blacklist" ? "text-rose-700 dark:text-rose-300" : flag.level === "high" ? "text-amber-700 dark:text-amber-300" : "text-ink dark:text-slate-200"}`}>{RISK_LEVEL_LABEL[flag.level]}</span>
                    <span className="ml-1.5 text-ink dark:text-slate-200">{flag.note}</span>
                  </p>
                  <p className="text-[10px] text-ink-soft dark:text-slate-400">添加 {formatDateTime(flag.addedAt)} · {flag.addedBy}</p>
                </div>
                <button
                  type="button"
                  data-testid={`risk-remove-${flag.id}`}
                  disabled={pending !== null}
                  onClick={() => void run(`risk-${flag.id}`, () => api.customers.action(customer.id, { type: "remove_risk", flagId: flag.id }))}
                  className="shrink-0 rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300"
                >
                  解除风险
                </button>
              </div>
            ))}
          </div>
        )}
        {removedFlags.length > 0 ? <p className="mt-2 text-[10px] text-ink-faint dark:text-slate-500">已解除 {removedFlags.length} 条（保留审计记录）</p> : null}
        {error ? <p role="alert" data-testid="customer-risk-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
      </section>

      {addingRisk ? (
        <RiskDialog
          pending={pending === "add-risk"}
          returnFocusElement={addTrigger}
          onClose={() => setAddingRisk(false)}
          onConfirm={(level, note) => void run("add-risk", async () => {
            await api.customers.action(customer.id, { type: "add_risk", level, note });
            setAddingRisk(false);
          })}
        />
      ) : null}
    </>
  );
}

function RiskDialog({ pending, returnFocusElement, onClose, onConfirm }: {
  pending: boolean;
  returnFocusElement: HTMLElement | null;
  onClose: () => void;
  onConfirm: (level: RiskFlag["level"], note: string) => void;
}) {
  const [level, setLevel] = useState<RiskFlag["level"]>("attention");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open title="添加风险条目" onClose={onClose} dataTestId="risk-dialog" closeLabel="关闭风险登记" returnFocusElement={returnFocusElement} className="w-[min(480px,calc(100vw-2rem))]">
      <div className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink dark:text-slate-100"><BadgeCheck size={17} aria-hidden />记录有意义的风险事实</h3>
        <label className="mt-4 block text-xs font-semibold text-ink dark:text-slate-200">
          风险等级
          <select data-testid="risk-level" value={level} onChange={(event) => setLevel(event.target.value as RiskFlag["level"])} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
            <option value="attention">关注</option>
            <option value="high">高风险</option>
            <option value="blacklist">黑名单</option>
          </select>
        </label>
        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          原因（写清楚具体事实）
          <textarea data-testid="risk-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="例如：历史付款承诺多次失约" className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
        </label>
        {error ? <p role="alert" data-testid="risk-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
          <button
            type="button"
            data-testid="risk-confirm"
            disabled={pending}
            onClick={() => {
              if (!note.trim()) { setError("请填写风险原因"); return; }
              setError(null);
              onConfirm(level, note.trim());
            }}
            className="min-h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "提交中…" : "确认添加"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
