"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { fetchFormalPerformance, type FormalMonthlyPerformance } from "@/lib/api/formal-performance";
import { businessDateInJamaica } from "@/lib/orders/document-number";
import { cn, formatDateTime, formatJMDFull } from "@/lib/utils";

function currentJamaicaMonth(): string {
  const date = businessDateInJamaica(new Date());
  return `${date.slice(0, 4)}-${date.slice(4, 6)}`;
}

function formatPerformance(minor: number): string {
  return formatJMDFull(minor / 100);
}

export function PerformanceWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTeamId = searchParams.get("team");
  const month = currentJamaicaMonth();
  const [summary, setSummary] = useState<FormalMonthlyPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const teams = summary?.teams ?? [];
  const selectedTeam = teams.find((team) => String(team.teamId) === requestedTeamId) ?? teams[0] ?? null;
  const teamHandoffs = selectedTeam
    ? (summary?.handoffs.filter((handoff) => handoff.teamId === selectedTeam.teamId) ?? [])
    : [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFormalPerformance(month)
      .then((value) => { if (!cancelled) setSummary(value); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "绩效汇总读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, retry]);

  return (
    <div data-testid="performance-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader breadcrumb="业务管理 · 绩效" title="绩效管理" description="按牙买加月份、维修班组及正式交单事实汇总。" />

        <section data-testid="performance-workspace-content" className="mt-3 overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
          <header className="border-b border-line px-4 py-4 dark:border-slate-700 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-ink-soft dark:text-slate-400">{month.replace("-", "年")}月 · 正式业务事实</p>
                <h2 data-testid="performance-team-name" className="mt-1 text-xl font-bold text-ink dark:text-slate-100">{selectedTeam?.teamName ?? "维修班组"}</h2>
              </div>
              <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">绩效目标：未设置目标</span>
            </div>
            {teams.length > 0 ? (
              <nav aria-label="切换班组" data-testid="performance-team-switcher" className="mt-4 flex flex-wrap gap-2">
                {teams.map((team) => (
                  <button key={team.teamId} type="button" onClick={() => router.push(`/performance?team=${encodeURIComponent(String(team.teamId))}`)}
                    className={cn("min-h-9 rounded-lg border px-3 text-xs font-semibold", team.teamId === selectedTeam?.teamId ? "border-primary bg-primary text-white" : "border-line text-ink-soft hover:border-primary-300 dark:border-slate-600 dark:text-slate-300")}>{team.teamName}</button>
                ))}
              </nav>
            ) : null}
          </header>

          {loading ? <div data-testid="performance-loading" className="m-5 h-44 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" /> : null}
          {error ? (
            <div className="m-5 rounded-xl border border-rose-200 p-6 text-center dark:border-rose-500/30">
              <AlertCircle className="mx-auto text-rose-600" size={24} />
              <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
            </div>
          ) : null}
          {!loading && !error && teams.length === 0 ? (
            <div data-testid="performance-empty" className="p-8 text-center">
              <Users className="mx-auto text-primary" size={30} aria-hidden />
              <h3 className="mt-3 text-lg font-bold text-ink dark:text-slate-100">尚无正式维修班组</h3>
              <p className="mt-2 text-sm text-ink-soft dark:text-slate-400">创建正式维修班组后，正式交单会按班组和月份独立归集。</p>
            </div>
          ) : null}
          {!loading && !error && selectedTeam ? (
            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line p-4 dark:border-slate-700"><p className="text-[11px] text-ink-soft">本月正式交单绩效</p><p data-testid="performance-counted-value" className="mt-2 text-xl font-bold tabular-nums">{formatPerformance(selectedTeam.performanceMinor)}</p><p className="mt-1 text-[11px] text-ink-soft">{selectedTeam.handoffCount} 次有效正式交单</p></div>
                <div className="rounded-xl border border-line p-4 dark:border-slate-700"><p className="text-[11px] text-ink-soft">本班组当月已取消交单</p><p data-testid="performance-cancelled-count" className="mt-2 text-xl font-bold tabular-nums">{selectedTeam.cancelledHandoffCount} 次</p><p className="mt-1 text-[11px] text-ink-soft">取消事实已从有效绩效中排除</p></div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5"><p className="text-[11px] text-ink-soft">绩效目标 / 完成率</p><p data-testid="performance-target-status" className="mt-2 text-xl font-bold">未设置目标</p><p className="mt-1 text-[11px] text-ink-soft">尚无正式目标配置，不能计算完成率</p></div>
              </div>

              <div className="rounded-xl border border-line dark:border-slate-700">
                <div className="border-b border-line px-4 py-3 text-sm font-bold dark:border-slate-700">本班组正式交单事实</div>
                {teamHandoffs.length === 0 ? (
                  <div data-testid="performance-team-empty" className="p-6 text-center text-sm text-ink-soft">本月暂无有效正式交单。</div>
                ) : (
                  <div data-testid="performance-handoff-list" className="divide-y divide-line dark:divide-slate-700">
                    {teamHandoffs.map((handoff) => (
                      <div key={handoff.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div><p className="font-semibold text-ink dark:text-slate-100">{handoff.orderNo} · {handoff.plateDisplay}</p><p className="mt-1 text-[11px] text-ink-soft">第 {handoff.repairRoundNo} 轮 · {formatDateTime(handoff.handedOffAt)}</p></div>
                        <span className="font-semibold tabular-nums text-ink dark:text-slate-100">{formatPerformance(handoff.performanceMinor)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
