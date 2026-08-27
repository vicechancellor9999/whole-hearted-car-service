"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatJMDFull } from "@/lib/utils";
import type { DashboardHeader, TeamPerformance } from "@/lib/types";

interface TeamPerformanceSectionProps {
  data: TeamPerformance;
  header?: DashboardHeader;
}

export function TeamPerformanceSection({ data, header }: TeamPerformanceSectionProps) {
  const shopTargetConfigured = header?.targetStatus === "configured"
    && header.targetTotalAmount !== null;
  const shopMissingReason = header?.targetMissingReasons[0] ?? "目标资料不完整";

  return (
    <div
      data-testid="team-performance"
      className="overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/90 to-blue-100/70 shadow-sm dark:border-slate-700 dark:bg-gradient-to-br dark:from-slate-800/90 dark:to-slate-900/70"
    >
      {/* Header — compact, ~74px */}
      <div className="flex flex-col items-stretch gap-2 border-b border-blue-100/80 bg-white/60 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center sm:justify-between">
        <div data-testid="team-performance-copy" className="min-w-0">
          <div className="text-[11px] text-ink-faint dark:text-slate-400">{data.dateRange}</div>
          <div className="text-sm font-semibold text-ink dark:text-slate-100">{data.title}</div>
          <div className="text-[10px] text-ink-faint dark:text-slate-400">{data.hint}</div>
        </div>

        {header ? (
          <div
            data-testid="team-performance-summary"
            className="flex w-full items-center justify-between gap-2.5 rounded-lg border border-blue-200 bg-white/80 px-3 py-1.5 shadow-sm dark:border-slate-600 dark:bg-slate-800/80 sm:w-auto"
          >
            <div className="flex flex-col">
              <span className="text-[10px] text-ink-faint dark:text-slate-400">
                {data.teams.length === 0
                  ? "尚未创建班组"
                  : shopTargetConfigured
                    ? `${data.teams.length} 个班组综合完成率`
                    : `${data.teams.length} 个班组本月绩效`}
              </span>
              <span className="text-[10px] text-ink-soft dark:text-slate-400">
                {shopTargetConfigured
                  ? `${formatJMDFull(header.targetCompletedAmount)} / ${formatJMDFull(header.targetTotalAmount!)}`
                  : `已完成 ${formatJMDFull(header.targetCompletedAmount)}`}
              </span>
            </div>
            <span
              data-testid="team-performance-rate"
              className={shopTargetConfigured
                ? "text-lg font-bold text-primary dark:text-primary-400"
                : "max-w-56 text-right text-[11px] font-semibold leading-4 text-amber-700 dark:text-amber-300"}
            >
              {shopTargetConfigured
                ? header.targetCompletionRate === null ? "完成率不适用" : `${header.targetCompletionRate}%`
                : shopMissingReason}
              {!shopTargetConfigured && header.targetMissingReasons.length > 1 ? (
                <span className="sr-only">；{header.targetMissingReasons.slice(1).join("；")}</span>
              ) : null}
            </span>
          </div>
        ) : (
          <button className="flex items-center gap-1 rounded-lg bg-white/80 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary-50 dark:bg-slate-800/80 dark:text-primary-400 dark:hover:bg-slate-700">
            {data.actionText}
            <ArrowRight size={14} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 p-2.5 sm:grid-cols-2 lg:min-h-[119px] lg:grid-cols-4 lg:px-3 lg:pb-3.5 lg:pt-3">
        {data.teams.length === 0 ? (
          <div
            data-testid="team-empty-state"
            className="col-span-full flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-blue-200 bg-white/70 px-3 text-center text-[11px] leading-4 text-ink-soft dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
          >
            <span>尚未创建维修班组。超级管理员新增班组和员工后，这里显示绩效。</span>
            <div className="flex flex-wrap justify-center gap-2">
              <Link data-testid="team-empty-add-team" href="/dictionaries#teams" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600">
                新增班组
              </Link>
              <Link data-testid="team-empty-add-employee" href="/employees" className="rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-50 dark:bg-slate-800">
                新增员工
              </Link>
            </div>
          </div>
        ) : data.teams.map((team) => {
          const targetConfigured = team.targetStatus === "configured"
            && team.targetAmount !== null;
          const missingReason = team.targetMissingReasons[0] ?? "目标资料不完整";
          const teamHref = !targetConfigured && team.targetMissingReasons.some((reason) => reason.includes("绩效参数"))
            ? `/settings?team=${encodeURIComponent(team.id)}#performance-parameters`
            : `/performance?team=${encodeURIComponent(team.id)}`;
          return (
            <Link
              key={team.id}
              href={teamHref}
              data-testid="team-card"
              className="flex flex-col justify-between rounded-lg border border-blue-100 bg-white p-2.5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:bg-blue-50/50 hover:shadow-card-hover dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-200 dark:hover:bg-slate-700/50 lg:p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink dark:text-slate-100">{team.name}</span>
                <span className="text-xs font-bold text-ink dark:text-slate-100">
                  {targetConfigured
                    ? team.completionRate === null ? "完成率不适用" : `${team.completionRate}%`
                    : "暂未计算"}
                </span>
              </div>
              {targetConfigured ? (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(team.completionRate!, 100)}%`,
                      backgroundColor: team.color,
                    }}
                  />
                </div>
              ) : (
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 dark:bg-slate-700" />
              )}
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                <span className="text-ink-soft dark:text-slate-400">已完成 {formatJMDFull(team.currentAmount)}</span>
                <span className="text-ink-faint dark:text-slate-400">
                  {targetConfigured ? `目标 ${formatJMDFull(team.targetAmount!)}` : missingReason}
                  {!targetConfigured && team.targetMissingReasons.length > 1 ? (
                    <span className="sr-only">；{team.targetMissingReasons.slice(1).join("；")}</span>
                  ) : null}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
