"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { api } from "@/lib/api/client";

interface ReminderCounts {
  notNotified: number;
  replyFresh: number;
  replyWarn: number;
  replyOverdue: number;
}

/**
 * 检查结果跟进强提醒：不闭环不下榜。
 * 定稿未发单独计数；待回复按账龄分档（2 天黄、4 天红）。
 */
export function IrFollowUpReminders() {
  const [counts, setCounts] = useState<ReminderCounts>({
    notNotified: 0,
    replyFresh: 0,
    replyWarn: 0,
    replyOverdue: 0,
  });
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.inspectionReports.list({ page: 1, pageSize: 1 });
      setCounts(result.followUpCounts);
      setFailed(false);
    } catch (caught) {
      console.error("[ir-followup-reminders] load failed", caught);
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (failed) return null;

  const totalOpen = counts.notNotified + counts.replyFresh + counts.replyWarn + counts.replyOverdue;
  const severe = counts.replyOverdue > 0;

  return (
    <section
      data-testid="ir-followup-reminders"
      className={`rounded-2xl border px-4 py-3 ${severe ? "border-rose-300 bg-rose-50/70 dark:border-rose-500/40 dark:bg-rose-500/10" : totalOpen > 0 ? "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5" : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/5"}`}
    >
      <div className="flex items-center gap-2">
        <BellRing size={15} className={severe ? "text-rose-600 dark:text-rose-300" : totalOpen > 0 ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"} />
        <h2 className="text-xs font-bold text-ink dark:text-slate-100">检查结果跟进</h2>
        {totalOpen === 0 ? <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">全部闭环，无滞留单</span> : null}
      </div>
      {totalOpen > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {counts.notNotified > 0 ? (
            <a data-testid="ir-reminder-not-notified" href="/orders/inspections?bucket=not_notified" className="inline-flex min-h-11 items-center rounded-full bg-white/80 px-2.5 text-primary ring-1 ring-primary-200 hover:bg-primary-50 dark:bg-slate-800 dark:text-primary-300 dark:ring-primary-500/40">
              {counts.notNotified} 份尚未通知客户
            </a>
          ) : null}
          {counts.replyWarn > 0 ? (
            <a data-testid="ir-reminder-warn" href="/orders/inspections?bucket=awaiting_reply" className="inline-flex min-h-11 items-center rounded-full bg-white/80 px-2.5 text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100 dark:bg-slate-800 dark:text-amber-300 dark:ring-amber-500/40">
              {counts.replyWarn} 份超 2 天未回
            </a>
          ) : null}
          {counts.replyOverdue > 0 ? (
            <a data-testid="ir-reminder-overdue" href="/orders/inspections?bucket=awaiting_reply" className="inline-flex min-h-11 items-center rounded-full bg-rose-600 px-2.5 text-white ring-1 ring-rose-600 hover:bg-rose-700">
              {counts.replyOverdue} 份超 4 天未回，立即催收
            </a>
          ) : null}
          {counts.replyFresh > 0 ? (
            <span className="inline-flex min-h-11 items-center rounded-full bg-white/60 px-2.5 text-ink-soft ring-1 ring-line dark:bg-slate-800/60 dark:text-slate-400">
              {counts.replyFresh} 份等待回复中
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
