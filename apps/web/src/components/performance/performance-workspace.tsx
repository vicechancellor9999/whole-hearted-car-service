"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { fetchFormalPerformance, type FormalMonthlyPerformance } from "@/lib/api/formal-performance";
import { useI18n } from "@/lib/i18n/language";
import { businessDateInJamaica } from "@/lib/orders/document-number";
import { cn, formatJMDFull } from "@/lib/utils";

function currentJamaicaMonth(): string {
  const date = businessDateInJamaica(new Date());
  return `${date.slice(0, 4)}-${date.slice(4, 6)}`;
}

function formatPerformance(minor: number): string {
  return formatJMDFull(minor / 100);
}

export function PerformanceWorkspace() {
  const { language, t, formatDate } = useI18n();
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
  const targetConfigured = selectedTeam?.targetStatus === "configured"
    && selectedTeam.targetPerformanceMinor !== null;
  const rawTargetMissingReason = selectedTeam?.targetMissingReasons[0] ?? "";
  const targetMissingReason = localizeTargetMissingReason(rawTargetMissingReason, language, t);
  const targetSetupHref = selectedTeam && rawTargetMissingReason.includes("绩效参数")
    ? `/settings?team=${encodeURIComponent(String(selectedTeam.teamId))}#performance-parameters`
    : "/employees";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFormalPerformance(month)
      .then((value) => { if (!cancelled) setSummary(value); })
      .catch((caught) => {
        if (cancelled) return;
        setError(language === "zh" && caught instanceof Error ? caught.message : t("performance.error.read"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [language, month, retry, t]);

  const teamLabel = (team: { teamId: number; teamName: string }) => language === "zh"
    ? team.teamName
    : t("performance.team.translationRequired", { id: team.teamId });

  const monthLabel = formatPerformanceMonth(month, language);

  return (
    <div data-testid="performance-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader
          breadcrumb={t("performance.page.breadcrumb")}
          title={t("performance.page.title")}
          description={t("performance.page.description")}
        />

        <section data-testid="performance-workspace-content" className="mt-3 overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
          <header className="border-b border-line px-4 py-4 dark:border-slate-700 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-ink-soft dark:text-slate-400">{t("performance.page.formalFacts", { month: monthLabel })}</p>
                <h2 data-testid="performance-team-name" className="mt-1 text-xl font-bold text-ink dark:text-slate-100">{selectedTeam ? teamLabel(selectedTeam) : t("performance.team.fallback")}</h2>
              </div>
              <span className={cn(
                "rounded-lg border px-3 py-2 text-xs font-semibold",
                targetConfigured
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
              )}>
                {targetConfigured
                  ? t("performance.target.label", { amount: formatPerformance(selectedTeam.targetPerformanceMinor!) })
                  : targetMissingReason}
              </span>
            </div>
            {teams.length > 0 ? (
              <nav aria-label={t("performance.team.switch")} data-testid="performance-team-switcher" className="mt-4 flex flex-wrap gap-2">
                {teams.map((team) => (
                  <button key={team.teamId} type="button" onClick={() => router.push(`/performance?team=${encodeURIComponent(String(team.teamId))}`)}
                    className={cn("min-h-9 rounded-lg border px-3 text-xs font-semibold", team.teamId === selectedTeam?.teamId ? "border-primary bg-primary text-white" : "border-line text-ink-soft hover:border-primary-300 dark:border-slate-600 dark:text-slate-300")}>{teamLabel(team)}</button>
                ))}
              </nav>
            ) : null}
          </header>

          {loading ? <div data-testid="performance-loading" className="m-5 h-44 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" /> : null}
          {error ? (
            <div className="m-5 rounded-xl border border-rose-200 p-6 text-center dark:border-rose-500/30">
              <AlertCircle className="mx-auto text-rose-600" size={24} />
              <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />{t("common.retry")}</button>
            </div>
          ) : null}
          {!loading && !error && teams.length === 0 ? (
            <div data-testid="performance-empty" className="p-8 text-center">
              <Users className="mx-auto text-primary" size={30} aria-hidden />
              <h3 className="mt-3 text-lg font-bold text-ink dark:text-slate-100">{t("performance.empty.title")}</h3>
              <p className="mt-2 text-sm text-ink-soft dark:text-slate-400">{t("performance.empty.description")}</p>
            </div>
          ) : null}
          {!loading && !error && selectedTeam ? (
            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line p-4 dark:border-slate-700"><p className="text-[11px] text-ink-soft">{t("performance.summary.performance")}</p><p data-testid="performance-counted-value" className="mt-2 text-xl font-bold tabular-nums">{formatPerformance(selectedTeam.performanceMinor)}</p><p className="mt-1 text-[11px] text-ink-soft">{t("performance.summary.validHandoffs", { count: selectedTeam.handoffCount })}</p></div>
                <div className="rounded-xl border border-line p-4 dark:border-slate-700"><p className="text-[11px] text-ink-soft">{t("performance.summary.cancelled")}</p><p data-testid="performance-cancelled-count" className="mt-2 text-xl font-bold tabular-nums">{t("performance.summary.cancelledCount", { count: selectedTeam.cancelledHandoffCount })}</p><p className="mt-1 text-[11px] text-ink-soft">{t("performance.summary.cancelledHint")}</p></div>
                <div className={cn("rounded-xl border p-4", targetConfigured ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/5" : "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5")}>
                  <p className="text-[11px] text-ink-soft">{t("performance.summary.targetRate")}</p>
                  <p data-testid="performance-target-status" className="mt-2 text-xl font-bold">
                    {targetConfigured
                      ? selectedTeam.completionRate === null
                        ? t("performance.summary.rateNotApplicable")
                        : `${selectedTeam.completionRate}%`
                      : targetMissingReason}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-soft">
                    {targetConfigured
                      ? t("performance.summary.completedAgainstTarget", { completed: formatPerformance(selectedTeam.performanceMinor), target: formatPerformance(selectedTeam.targetPerformanceMinor!) })
                      : (
                        <Link href={targetSetupHref} className="font-semibold text-primary hover:underline">
                          {rawTargetMissingReason.includes("绩效参数") ? t("performance.target.setupParameters") : t("performance.target.setupSalary")}
                        </Link>
                      )}
                  </p>
                  {!targetConfigured && selectedTeam.targetMissingReasons.length > 1 ? (
                    <p className="sr-only">{selectedTeam.targetMissingReasons.slice(1).join("；")}</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-line dark:border-slate-700">
                <div className="border-b border-line px-4 py-3 text-sm font-bold dark:border-slate-700">{t("performance.handoffs.title")}</div>
                {teamHandoffs.length === 0 ? (
                  <div data-testid="performance-team-empty" className="p-6 text-center text-sm text-ink-soft">{t("performance.handoffs.empty")}</div>
                ) : (
                  <div data-testid="performance-handoff-list" className="divide-y divide-line dark:divide-slate-700">
                    {teamHandoffs.map((handoff) => (
                      <div key={handoff.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div data-user-content><p className="font-semibold text-ink dark:text-slate-100">{handoff.orderNo} · {handoff.plateDisplay}</p><p className="mt-1 text-[11px] text-ink-soft">{t("performance.handoffs.round", { round: handoff.repairRoundNo, date: formatDate(handoff.handedOffAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) })}</p></div>
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

export function PerformanceLoadingFallback() {
  const { t } = useI18n();
  return <div className="min-h-full bg-[var(--wh-page-bg)] p-6 text-sm text-ink-soft">{t("performance.page.loading")}</div>;
}

function formatPerformanceMonth(month: string, language: "zh" | "en"): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  if (language === "zh") return `${year}年${String(monthNumber).padStart(2, "0")}月`;
  return new Intl.DateTimeFormat("en-JM", { month: "long", year: "numeric", timeZone: "America/Jamaica" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 15, 12)));
}

function localizeTargetMissingReason(
  reason: string,
  language: "zh" | "en",
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (language === "zh") return reason || t("performance.target.missing");
  const parameters = /缺少\s+(\d{4}-\d{2})\s+绩效参数/.exec(reason);
  if (parameters) return t("performance.target.missingParameters", { month: formatPerformanceMonth(parameters[1], "en") });
  if (reason.includes("月标准工资")) return t("performance.target.missingSalary");
  return t("performance.target.missing");
}
