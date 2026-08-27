"use client";

import Link from "next/link";

import {
  FLOW_GROUP_LABELS,
  FLOW_STAGES,
  type FlowStageGroup,
  type FlowStageId,
  type ProcessCount,
} from "./types";
import type { OrdersOperationsOverview } from "@/lib/orders/operations-overview";
import { cn } from "@/lib/utils";

interface ProcessCountsProps {
  counts: ProcessCount[] | OrdersOperationsOverview["processCounts"];
  selectedStage?: FlowStageId | null;
  onSelectStage?: (stage: FlowStageId | null) => void;
  hrefForStage?: (stage: FlowStageId) => string;
}

const GROUP_ORDER: FlowStageGroup[] = ["inspection", "quotation", "repair", "handover"];

const GROUP_STYLES: Record<FlowStageGroup, { dot: string; chip: string }> = {
  inspection: { dot: "bg-primary", chip: "border-primary/30 bg-primary-50/60 dark:bg-primary-500/10" },
  quotation: { dot: "bg-purple-500", chip: "border-purple-500/30 bg-purple-50/60 dark:bg-purple-500/10" },
  repair: { dot: "bg-amber-500", chip: "border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10" },
  handover: { dot: "bg-emerald-500", chip: "border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10" },
};

export function ProcessCounts({ counts, selectedStage, onSelectStage, hrefForStage }: ProcessCountsProps) {
  const countMap = Array.isArray(counts)
    ? new Map(counts.map((count) => [count.id, count.count]))
    : new Map(Object.entries(counts) as Array<[FlowStageId, number]>);

  return (
    <section
      data-testid="orders-process-counts"
      className="rounded-[22px] border border-line bg-white/80 p-4 shadow-card dark:bg-slate-800/80"
    >
      <h2 className="text-sm font-bold text-ink dark:text-slate-100">流程数量</h2>
      <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">
        点击数字进入对应的业务单、检查结果或收付款页面
      </p>

      <div data-testid="process-counts" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {GROUP_ORDER.map((group) => {
          const groupStages = FLOW_STAGES.filter((s) => s.group === group);
          const style = GROUP_STYLES[group];
          return (
            <div
              key={group}
              data-testid={`orders-process-group-${group}`}
              className="rounded-xl border border-line bg-surface/40 p-2.5 dark:border-slate-600 dark:bg-slate-700/20"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                <span className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">
                  {FLOW_GROUP_LABELS[group]}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groupStages.map((stage) => {
                  const count = countMap.get(stage.id) ?? 0;
                  const isSelected = selectedStage === stage.id;
                  const hasItems = count > 0;
                  const className = cn(
                    "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-all",
                    "motion-reduce:transition-none",
                    isSelected
                      ? "border-primary bg-primary text-white shadow-sm"
                      : hasItems
                        ? cn("cursor-pointer hover:shadow-sm", style.chip, "text-ink dark:text-slate-200")
                        : "cursor-not-allowed border-line bg-gray-50/50 text-ink-faint dark:bg-slate-700/30 dark:text-slate-500",
                  );
                  const content = (
                    <>
                      <span>{stage.label}</span>
                      <span className={cn("tabular-nums", isSelected ? "text-white/80" : "font-bold")}>{count}</span>
                    </>
                  );
                  return hrefForStage && hasItems ? (
                    <Link key={stage.id} href={hrefForStage(stage.id)} className={className}>
                      {content}
                    </Link>
                  ) : (
                    <button
                      key={stage.id}
                      type="button"
                      data-testid={`orders-process-chip-${stage.id}`}
                      aria-pressed={isSelected}
                      disabled={!hasItems || !onSelectStage}
                      onClick={() => onSelectStage?.(isSelected ? null : stage.id)}
                      className={className}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
