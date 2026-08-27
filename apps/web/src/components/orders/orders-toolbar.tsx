"use client";

import { Search, ChevronDown } from "lucide-react";
import {
  FLOW_STAGES,
  TEAM_LABELS,
  TEAM_ORDER,
  type FlowStageId,
  type TeamId,
} from "./types";

interface OrdersToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  stageFilter: FlowStageId | "all";
  onStageChange: (value: FlowStageId | "all") => void;
  teamFilter: TeamId | "";
  onTeamChange: (value: TeamId | "") => void;
}

export function OrdersToolbar({
  search,
  onSearchChange,
  stageFilter,
  onStageChange,
  teamFilter,
  onTeamChange,
}: OrdersToolbarProps) {
  return (
    <div
      data-testid="orders-toolbar"
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      {/* Search */}
      <div className="relative flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft dark:text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          data-testid="orders-search"
          aria-label="搜索单据"
          placeholder="搜索客户、电话、车牌、车型、单号或项目"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="min-h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:ring-primary-900"
        />
      </div>

      {/* Flow stage filter */}
      <div className="relative">
        <select
          data-testid="orders-stage-filter"
          aria-label="按流程阶段筛选"
          value={stageFilter}
          onChange={(e) => onStageChange(e.target.value as FlowStageId | "all")}
          className="min-h-10 w-full appearance-none rounded-lg border border-line bg-white px-3 pr-8 text-sm text-ink focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-primary-900 sm:w-auto"
        >
          <option value="all">全部流程</option>
          {FLOW_STAGES.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft dark:text-slate-400"
          aria-hidden
        />
      </div>

      {/* Team filter */}
      <div className="relative">
        <select
          data-testid="orders-team-filter"
          aria-label="按班组筛选"
          value={teamFilter}
          onChange={(e) => onTeamChange(e.target.value as TeamId | "")}
          className="min-h-10 w-full appearance-none rounded-lg border border-line bg-white px-3 pr-8 text-sm text-ink focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-primary-900 sm:w-auto"
        >
          <option value="">全部班组</option>
          {TEAM_ORDER.map((id) => (
            <option key={id} value={id}>
              {TEAM_LABELS[id]}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft dark:text-slate-400"
          aria-hidden
        />
      </div>
    </div>
  );
}
