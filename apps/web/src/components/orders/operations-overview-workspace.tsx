"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/api/client";
import type { OrdersOperationsOverview } from "@/lib/orders/operations-overview";
import type { OrderOperationsStage } from "@/lib/orders/inspection-types";
import { OperationsJudgment } from "./operations-judgment";
import { IrFollowUpReminders } from "./ir-followup-reminders";
import { ProcessCounts } from "./process-counts";
import { TEAM_LABELS } from "./types";

function stageHref(stage: OrderOperationsStage): string {
  if (stage.startsWith("inspection_") || stage.startsWith("quote_")) {
    return `/orders/inspections?stage=${stage}`;
  }
  if (stage === "awaiting_formal_handover" || stage === "submitted_awaiting_collection" || stage === "vehicle_collected") {
    return `/payments?stage=${stage}`;
  }
  return `/orders/business?stage=${stage}`;
}

function OverviewSkeleton() {
  return (
    <div data-testid="orders-overview-loading" className="space-y-3 animate-pulse">
      <div className="h-[76px] rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      <div className="h-[260px] rounded-[22px] bg-slate-200/70 dark:bg-slate-800" />
      <div className="h-[210px] rounded-[22px] bg-slate-200/70 dark:bg-slate-800" />
    </div>
  );
}

export function OperationsOverviewWorkspace() {
  const [data, setData] = useState<OrdersOperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const load = useCallback(() => {
    setError(null);
    api.orders.operationsOverview()
      .then(setData)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "无法读取调度总览");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load, retry]);

  return (
    <div data-testid="orders-operations-page" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <PageHeader
          breadcrumb="主营业务"
          title="运营概览"
          description="今日普通车辆首次派检均衡、四组实时负载与流程数量；所有数字均来自同一运营数据源。"
        />

        {!data && !error ? <OverviewSkeleton /> : null}
        {error ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[22px] border border-rose-200 bg-white/80 p-6 text-center dark:border-rose-900/60 dark:bg-slate-800/80">
            <AlertCircle className="text-rose-600 dark:text-rose-300" />
            <p className="mt-2 text-sm font-semibold text-ink dark:text-slate-100">调度数据暂时无法读取</p>
            <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">{error}</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-primary hover:border-primary-200"
            >
              <RefreshCw size={15} /> 重新读取
            </button>
          </div>
        ) : null}

        {data ? (
          <div className="space-y-3">
            <IrFollowUpReminders />
            <OperationsJudgment
              balance={data.firstInspectionDistribution}
              workloads={data.workloads.map((workload) => ({ ...workload, teamName: TEAM_LABELS[workload.teamId] }))}
            />
            <ProcessCounts counts={data.processCounts} hrefForStage={stageHref} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
