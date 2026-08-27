"use client";

import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import type { PerformanceHistoryRow } from "@/lib/performance/types";
import { formatCNYFull, formatJMDFull, formatPercentRatio, formatYearMonth } from "@/lib/utils";

interface PerformanceHistoryTableProps {
  history: PerformanceHistoryRow[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}

function previousText(row: PerformanceHistoryRow): string {
  const delta = row.previousMonthDelta.actualPerformanceJmd;
  if (delta === null) return "历史数据不足";
  if (delta === 0) return "持平 JMD 0";
  return `${delta > 0 ? "上涨" : "下跌"} ${formatJMDFull(Math.abs(delta))}`;
}

function averageText(row: PerformanceHistoryRow): string {
  const current = row.snapshot.actualPerformanceJmd;
  const baseline = row.historicalAverage.actualPerformanceJmd;
  if (current === null || baseline === null || baseline === 0) return "历史数据不足";
  const delta = current - baseline;
  if (delta === 0) return "与此前历史平均持平";
  return `${delta > 0 ? "高于" : "低于"}此前历史平均 ${Math.abs(delta / baseline * 100).toFixed(2)}%`;
}

function DirectionIcon({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <Minus size={13} aria-hidden />;
  return delta > 0 ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />;
}

export function PerformanceHistoryTable({ history, selectedMonth, onSelectMonth }: PerformanceHistoryTableProps) {
  return (
    <section data-testid="performance-history-table" className="overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:bg-slate-800">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-base font-bold text-ink dark:text-slate-100">历月锁定结果</h2>
        <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">点击月份查看锁定工资快照；历史平均仅使用此前月份。</p>
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-soft dark:text-slate-400">暂无已锁定历史月份</div>
      ) : (
        <div data-testid="history-table-scroll" className="max-w-full transform-gpu overflow-hidden p-3">
          <table className="w-full table-fixed border-separate border-spacing-y-2 text-left text-xs">
            <thead className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-slate-400">
              <tr>
                <th className="px-3 pb-1">月份</th><th className="px-3 pb-1">实际绩效</th>
                <th className="px-3 pb-1">完成率</th><th className="px-3 pb-1">工资测算</th>
                <th className="px-3 pb-1">比上月</th><th className="px-3 pb-1">历史平均</th>
                <th className="px-3 pb-1"><span className="sr-only">动作</span></th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((row) => {
                const delta = row.previousMonthDelta.actualPerformanceJmd;
                return (
                  <tr
                    key={row.snapshot.month}
                    data-testid="history-row"
                    aria-selected={selectedMonth === row.snapshot.month}
                    className="rounded-xl bg-surface text-ink outline outline-1 outline-line dark:bg-slate-900/50 dark:text-slate-100"
                  >
                    <td className="rounded-l-xl px-3 py-3 font-semibold">{formatYearMonth(row.snapshot.month)}</td>
                    <td className="px-3 py-3 tabular-nums">{row.snapshot.actualPerformanceJmd === null ? "缺失" : formatJMDFull(row.snapshot.actualPerformanceJmd)}</td>
                    <td className="px-3 py-3 tabular-nums">{row.snapshot.completionRate === null ? "无法测算" : formatPercentRatio(row.snapshot.completionRate, 4)}</td>
                    <td className="px-3 py-3 tabular-nums">{row.snapshot.payrollTotalCny === null ? "无法测算" : formatCNYFull(row.snapshot.payrollTotalCny)}</td>
                    <td data-testid="history-previous-comparison" className={delta !== null && delta < 0 ? "px-3 py-3 text-danger" : "px-3 py-3 text-success"}>
                      <span className="inline-flex items-center gap-1"><DirectionIcon delta={delta} />{previousText(row)}</span>
                    </td>
                    <td data-testid="history-average-comparison" className="px-3 py-3 text-ink-soft dark:text-slate-300">{averageText(row)}</td>
                    <td className="rounded-r-xl px-3 py-3 text-right">
                      <button
                        type="button"
                        data-testid="history-view-members"
                        onClick={() => onSelectMonth(row.snapshot.month)}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-700 dark:text-primary-300"
                      >
                        查看成员明细 <ArrowRight size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
