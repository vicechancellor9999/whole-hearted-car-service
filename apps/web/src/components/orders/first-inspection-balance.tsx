"use client";

import type { FirstInspectionBalance } from "./types";

interface FirstInspectionBalancePanelProps {
  balance: FirstInspectionBalance;
}

export function FirstInspectionBalancePanel({ balance }: FirstInspectionBalancePanelProps) {
  const { t1, t2, distinctOrdinaryVehicles: total, difference } = balance;
  const t1Percent = total > 0 ? (t1 / total) * 100 : 50;
  const t2Percent = total > 0 ? (t2 / total) * 100 : 50;

  return (
    <section
      data-testid="first-inspection-capsule"
      className="rounded-2xl border border-line bg-white/85 px-4 py-3 shadow-card dark:border-slate-700 dark:bg-slate-800/85"
      aria-labelledby="first-inspection-title"
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="min-w-[190px] shrink-0">
          <h2 id="first-inspection-title" className="text-sm font-bold text-ink dark:text-slate-100">
            今日普通车辆首次派检
          </h2>
          <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">
            仅记录每辆普通车当天第一次检查派组
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
            <div
              data-testid="first-inspection-segment-t1"
              className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${t1Percent}%` }}
            />
            <div
              data-testid="first-inspection-segment-t2"
              className="h-full bg-violet-500 transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${t2Percent}%` }}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-ink-soft dark:text-slate-300">
            <span className="h-2 w-2 rounded-full bg-primary" />
            车间一组 <b className="tabular-nums text-ink dark:text-slate-100">{t1}</b>
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-soft dark:text-slate-300">
            <span className="h-2 w-2 rounded-full bg-violet-500" />
            车间二组 <b className="tabular-nums text-ink dark:text-slate-100">{t2}</b>
          </span>
          <span className="text-ink-soft dark:text-slate-400">
            合计 <b className="tabular-nums text-ink dark:text-slate-100">{total}</b> 辆
          </span>
          <span className="text-ink-soft dark:text-slate-400">
            差值 <b className="tabular-nums text-ink dark:text-slate-100">{difference}</b>
          </span>
        </div>
      </div>
    </section>
  );
}
