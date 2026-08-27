"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";
import {
  normalizeRevenueViewRange,
  REVENUE_VIEW_RANGES,
  type RevenueDetailResponse,
  type RevenueViewRange,
} from "@/lib/revenue/types";
import { formatJMDFull } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { RevenueChart } from "./revenue-chart";
import { RevenueHistoryTable } from "./revenue-history-table";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取营业收入";
}

const pendingReads = new Map<string, Promise<RevenueDetailResponse>>();

function readRevenue(range: RevenueViewRange): Promise<RevenueDetailResponse> {
  const sessionKey = typeof window === "undefined"
    ? "server"
    : window.localStorage.getItem("wh_session") ?? "anonymous";
  const key = `${sessionKey}:${range}`;
  const pending = pendingReads.get(key);
  if (pending) return pending;
  const request = api.revenue.detail(range);
  pendingReads.set(key, request);
  request.then(
    () => pendingReads.delete(key),
    () => pendingReads.delete(key),
  );
  return request;
}

function RevenueLoading() {
  return (
    <div className="space-y-3.5 p-3 sm:p-5">
      <div data-testid="revenue-summary-skeleton" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="min-h-[134px] rounded-xl border border-line bg-white p-4 dark:bg-slate-800">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-7 w-36" />
            <Skeleton className="mt-4 h-3 w-28" />
          </div>
        ))}
      </div>
      <div data-testid="revenue-chart-skeleton" className="rounded-2xl border border-line bg-white p-4 dark:bg-slate-800">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-[260px] w-full" />
      </div>
      <div data-testid="revenue-table-skeleton" className="rounded-2xl border border-line bg-white p-4 dark:bg-slate-800">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-48 w-full" />
      </div>
    </div>
  );
}

function RevenueSummary({ detail }: { detail: RevenueDetailResponse }) {
  const transactionCount = detail.summary.paymentCount + detail.summary.refundCount;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="min-h-[146px] border-l-[3px] border-l-primary p-4 dark:bg-slate-800">
        <div data-testid="revenue-summary-total">
          <div className="text-[11px] font-medium text-ink-soft dark:text-slate-400">净收款</div>
          <div className="mt-2 break-words text-[22px] font-bold tabular-nums text-ink dark:text-slate-100">
            {formatJMDFull(detail.summary.netPaidJmd)}
          </div>
        </div>
        <div className="mt-3 border-t border-line pt-3 text-[10px]">
          <span data-testid="revenue-card-payments" className="flex flex-wrap gap-x-2 gap-y-1 text-ink-soft dark:text-slate-400">
            {detail.summary.methods.length > 0 ? detail.summary.methods.map((method) => (
              <span key={method.method}>
                {method.method}净额 <b className="ml-0.5 text-ink dark:text-slate-100">{formatJMDFull(method.total)}</b>
              </span>
            )) : <span>当前周期暂无收退款</span>}
          </span>
        </div>
      </Card>

      <Card className="min-h-[146px] border-l-[3px] border-l-emerald-500 p-4 dark:bg-slate-800">
        <div data-testid="revenue-summary-gross">
          <div className="text-[11px] font-medium text-ink-soft dark:text-slate-400">收款总额</div>
          <div className="mt-3 break-words text-[22px] font-bold tabular-nums text-ink dark:text-slate-100">
            {formatJMDFull(detail.summary.grossPaidJmd)}
          </div>
          <div className="mt-3 text-[10px] text-ink-faint dark:text-slate-400">{detail.summary.paymentCount} 笔独立收款记录</div>
        </div>
      </Card>

      <Card className="min-h-[146px] border-l-[3px] border-l-rose-500 p-4 dark:bg-slate-800">
        <div data-testid="revenue-summary-refunds">
          <div className="text-[11px] font-medium text-ink-soft dark:text-slate-400">退款总额</div>
          <div className="mt-3 break-words text-[22px] font-bold tabular-nums text-ink dark:text-slate-100">
            {formatJMDFull(detail.summary.cashRefundedJmd)}
          </div>
          <div className="mt-3 text-[10px] text-ink-faint dark:text-slate-400">{detail.summary.refundCount} 笔独立退款记录</div>
        </div>
      </Card>

      <Card className="min-h-[146px] border-l-[3px] border-l-amber-500 p-4 dark:bg-slate-800">
        <div data-testid="revenue-summary-records">
          <div className="text-[11px] font-medium text-ink-soft dark:text-slate-400">收退款记录</div>
          <div className="mt-3 text-[22px] font-bold tabular-nums text-ink dark:text-slate-100">{transactionCount} 笔</div>
          <div className="mt-3 text-[10px] text-ink-faint dark:text-slate-400">收款 {detail.summary.paymentCount} · 退款 {detail.summary.refundCount}</div>
        </div>
      </Card>
    </div>
  );
}

export function RevenueWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = normalizeRevenueViewRange(searchParams.get("range"));
  const [detail, setDetail] = useState<RevenueDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    readRevenue(range)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((caught) => {
        if (!cancelled) setError(messageOf(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range, retryKey]);

  const selectRange = (nextRange: RevenueViewRange) => {
    if (nextRange === range) return;
    router.push(`/revenue?range=${nextRange}`);
  };

  return (
    <div
      data-testid="revenue-page"
      className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6"
    >
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader
          breadcrumb="经营分析 · 收退款实绩"
          title="营业收入统计"
          titleTestId="revenue-heading"
          description="按今日、本周、本月、本年查看逐笔收款、退款和净收款趋势；所有数字与收付款记录同步。"
          action={(
            <Link
              href="/"
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-medium text-ink hover:border-primary-200 hover:text-primary dark:bg-slate-800 dark:text-slate-100"
            >
              <ArrowLeft size={15} aria-hidden /> 返回经营概览
            </Link>
          )}
        />

        <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dbe5f3] bg-[var(--wh-page-bg)] shadow-card dark:border-slate-700">

        <nav
          data-testid="revenue-range-tabs"
          aria-label="收入统计周期"
          className="grid grid-cols-2 gap-2 border-b border-line px-3 py-4 sm:grid-cols-4 sm:px-5"
        >
          {REVENUE_VIEW_RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`revenue-range-${item.id}`}
              aria-pressed={range === item.id}
              onClick={() => selectRange(item.id)}
              className={`min-h-10 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                range === item.id
                  ? "border-primary bg-primary text-white shadow-sm"
                  : "border-line bg-white text-ink-soft hover:border-primary-200 hover:text-primary dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {loading ? (
          <RevenueLoading />
        ) : error ? (
          <div data-testid="revenue-load-error" className="p-3 sm:p-5">
            <Card className="p-8 text-center dark:bg-slate-800">
              <AlertCircle className="mx-auto text-danger" size={28} aria-hidden />
              <h2 className="mt-3 text-base font-bold text-ink dark:text-slate-100">营业收入读取失败</h2>
              <p className="mt-2 text-sm text-danger">{error}</p>
              <button
                type="button"
                data-testid="revenue-retry"
                onClick={() => setRetryKey((value) => value + 1)}
                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-600"
              >
                <RefreshCw size={15} aria-hidden /> 重新读取
              </button>
            </Card>
          </div>
        ) : detail ? (
          <div className="min-w-0 space-y-3.5 p-3 sm:p-5">
            <RevenueSummary detail={detail} />
            <RevenueChart detail={detail} />
            <RevenueHistoryTable rows={detail.rows} />
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
