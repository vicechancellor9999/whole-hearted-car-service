"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { OrdersPerformanceSummaryResponse } from "@/lib/orders/business-order-types";
import type { TeamMonthSnapshot, TeamPerformanceDetailResponse } from "@/lib/performance/types";
import { formatCNYFull, formatJMDFull, formatPercentRatio } from "@/lib/utils";
import { MemberPayrollTable } from "./member-payroll-table";
import { PerformanceHistoryTable } from "./performance-history-table";
import { PerformanceTrendChart } from "./performance-trend-chart";

interface TeamPerformanceDetailProps {
  detail: TeamPerformanceDetailResponse;
  currentSnapshot: TeamMonthSnapshot;
  teamId: string;
  onSelectMonth: (month: string) => void;
  onSelectMember: (memberId: string) => void;
  onViewRules: () => void;
}

const overviewCards = [
  { key: "target", label: "班组指标", testId: "overview-team-target", tone: "border-l-primary" },
  { key: "actual", label: "实际绩效", testId: "overview-actual-performance", tone: "border-l-success" },
  { key: "completion", label: "全组完成率", testId: "overview-completion-rate", tone: "border-l-purple" },
  { key: "payroll", label: "工资测算合计", testId: "overview-payroll-total", tone: "border-l-amber" },
] as const;

function overviewValue(snapshot: TeamMonthSnapshot, key: typeof overviewCards[number]["key"]): string {
  if (key === "target") return snapshot.teamTargetJmd === null ? "无法测算" : formatJMDFull(snapshot.teamTargetJmd);
  if (key === "actual") return snapshot.actualPerformanceJmd === null ? "实际绩效缺失" : formatJMDFull(snapshot.actualPerformanceJmd);
  if (key === "completion") return snapshot.completionRate === null ? "无法测算" : formatPercentRatio(snapshot.completionRate, 4);
  return snapshot.payrollTotalCny === null ? "无法测算" : formatCNYFull(snapshot.payrollTotalCny);
}

export function TeamPerformanceDetail({
  detail,
  currentSnapshot,
  teamId,
  onSelectMonth,
  onSelectMember,
  onViewRules,
}: TeamPerformanceDetailProps) {
  const snapshot = detail.selected;
  const [ordersSummary, setOrdersSummary] = useState<OrdersPerformanceSummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOrdersSummary(null);
    api.performance.ordersSummary(snapshot.month)
      .then((summary) => { if (!cancelled) setOrdersSummary(summary); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [snapshot.month]);

  const teamSummary = ordersSummary?.byTeam.find((team) => team.teamId === teamId) ?? null;

  return (
    <div className="space-y-3.5 p-3 sm:p-5">
      {detail.permissions.canViewPerformance && (
        <Card className="flex flex-col gap-3 p-4 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] text-ink-soft dark:text-slate-400">本月采用规则</div>
            <div data-testid="applied-rule-summary" className="mt-1 break-words text-sm font-semibold text-primary">
              {snapshot.appliedRule.version} · {(snapshot.appliedRule.commissionRate * 100).toFixed(0)}% · 1 CNY = {snapshot.appliedRule.cnyToJmdRate} JMD
            </div>
          </div>
          <button
            type="button"
            data-testid="performance-rules-entry"
            onClick={onViewRules}
            className="min-h-10 shrink-0 rounded-lg border border-primary-200 bg-primary-50 px-4 text-sm font-semibold text-primary hover:bg-primary-100"
          >
            绩效规则
          </button>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overviewCards.map((card) => (
          <Card key={card.key} className={`min-h-[112px] border-l-[3px] ${card.tone} p-4 dark:bg-slate-800`}>
            <div className="text-[11px] font-medium text-ink-soft dark:text-slate-400">{card.label}</div>
            <div data-testid={card.testId} className="mt-3 break-words text-lg font-bold tabular-nums text-ink dark:text-slate-100 sm:text-[22px]">
              {overviewValue(snapshot, card.key)}
            </div>
            <div className="mt-2 text-[10px] text-ink-faint dark:text-slate-400">
              {card.key === "target" && `${snapshot.members.length} 名成员携带指标合计`}
              {card.key === "actual" && (snapshot.status === "collecting" ? "本月数据持续归集" : "锁定快照")}
              {card.key === "completion" && "全组统一计算口径"}
              {card.key === "payroll" && "按全组统一完成率测算"}
            </div>
          </Card>
        ))}
      </div>

      {teamSummary && (
        <div data-testid="orders-performance-summary">
        <Card className="p-4 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] text-ink-soft dark:text-slate-400">已正式交单绩效值（{snapshot.month} · 交单时间定归属月）</div>
              <div className="mt-1 text-sm font-semibold text-ink dark:text-slate-100">
                已计入 <b className="text-emerald-600">{teamSummary.countedOrderCount}</b> 单 / <b className="text-emerald-600">{formatJMDFull(teamSummary.countedValueJmd)}</b>
              </div>
            </div>
            <div className="text-sm font-semibold text-ink dark:text-slate-100">
              待计入 <b className="text-amber-600">{teamSummary.pendingOrderCount}</b> 单 / <b className="text-amber-600">{formatJMDFull(teamSummary.pendingValueJmd)}</b>
            </div>
          </div>
        </Card>
        </div>
      )}

      <PerformanceTrendChart currentSnapshot={currentSnapshot} history={detail.history} selected={snapshot} />
      <MemberPayrollTable snapshot={snapshot} onSelectMember={onSelectMember} />

      <div className="grid gap-3.5 xl:grid-cols-[2fr_1fr]">
        <PerformanceHistoryTable history={detail.history} selectedMonth={snapshot.month} onSelectMonth={onSelectMonth} />
        <Card className="p-4 dark:bg-slate-800">
          <h2 className="text-base font-bold text-ink dark:text-slate-100">计算口径</h2>
          <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">页面始终显示同一套班组绩效规则。</p>
          <div className="mt-3 space-y-2">
            {[
              ["个人携带班组指标", `个人月标准工资 ÷ ${(snapshot.appliedRule.commissionRate * 100).toFixed(0)}% × 人民币汇率 ${snapshot.appliedRule.cnyToJmdRate}`],
              ["班组指标", "当月所有成员携带班组指标的合计"],
              ["工资预算", "个人月标准工资 × 全组统一完成率"],
              ["历史平均", "仅使用当前月份之前的已锁定完整月份"],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-xl bg-surface p-3 dark:bg-slate-900/60">
                <div className="text-xs font-semibold text-ink dark:text-slate-100">{title}</div>
                <div className="mt-1 text-[10px] leading-4 text-ink-soft dark:text-slate-400">{copy}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="pb-1 text-center text-[11px] text-ink-soft dark:text-slate-400">
        点击任一成员行进入成员详情；锁定月份数据只读。
      </p>
    </div>
  );
}
