"use client";

import type { DashboardHeader } from "@/lib/types";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LiveClock } from "@/components/layout/live-clock";

type StoreOverviewHeader = Pick<DashboardHeader, "breadcrumb" | "title" | "subtitle">;

interface DashboardHeaderProps {
  header?: StoreOverviewHeader;
}

export const STORE_OVERVIEW_HEADER: StoreOverviewHeader = {
  breadcrumb: "门店经营 · 实时数据",
  title: "经营概览",
  subtitle: "每日、每周、每月汇总当前 Business Order、逐笔收款、逐笔退款与停车记录；新增或修改记录后立即重算。",
};

export function DashboardHeaderView({ header = STORE_OVERVIEW_HEADER }: DashboardHeaderProps) {
  const titleClassName = "mt-0.5 text-2xl font-bold text-ink dark:text-slate-100";

  return (
    <div
      data-testid="dashboard-header"
      className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50/80 via-blue-100/60 to-blue-50/80 px-4 py-4 shadow-sm dark:border-slate-700 dark:bg-gradient-to-r dark:from-slate-800/80 dark:via-slate-800/60 dark:to-slate-800/80 sm:flex-row sm:items-center sm:justify-between"
    >
      {/* 顶部细线高光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-200/50 to-transparent dark:via-primary-500/30" />

      <div className="relative">
        <div className="text-xs font-medium text-primary dark:text-primary-400">{header.breadcrumb}</div>
        <h1 className={titleClassName}>{header.title}</h1>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-soft dark:text-slate-400">{header.subtitle}</p>
      </div>

      <div className="flex items-center gap-4 sm:gap-5 sm:text-right">
        <LiveClock />
        <div className="hidden h-10 w-px bg-blue-200/60 dark:bg-slate-600 sm:block" />
        <ThemeToggle />
      </div>
    </div>
  );
}
