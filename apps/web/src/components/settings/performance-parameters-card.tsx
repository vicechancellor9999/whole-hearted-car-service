"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import {
  fetchFormalMasterData,
  setFormalPayrollParameters,
  setFormalTeamCommissionRate,
  type FormalMasterData,
} from "@/lib/api/formal-master-data";
import { businessDateInJamaica } from "@/lib/orders/document-number";

function currentMonth(): string {
  const date = businessDateInJamaica(new Date());
  return `${date.slice(0, 4)}-${date.slice(4, 6)}`;
}

function percentage(rate: string): string {
  return `${Number(rate) * 100}%`;
}

function decimalRate(percent: string): string {
  return String(Number(percent) / 100);
}

function canEditPerformanceParameters(): boolean {
  try {
    const raw = window.localStorage.getItem("wh_session");
    const session = raw ? JSON.parse(raw) as { identity?: { role?: unknown } } : null;
    return session?.identity?.role === "superadmin";
  } catch {
    return false;
  }
}

export function PerformanceParametersCard() {
  const [data, setData] = useState<FormalMasterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editable, setEditable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalMonth, setGlobalMonth] = useState(currentMonth);
  const [globalCommission, setGlobalCommission] = useState("");
  const [globalExchange, setGlobalExchange] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamMonth, setTeamMonth] = useState(currentMonth);
  const [teamCommission, setTeamCommission] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchFormalMasterData();
      setData(next);
      const initialTeam = new URL(window.location.href).searchParams.get("team");
      setTeamId((current) => current || (
        initialTeam && next.teams.some((team) => String(team.id) === initialTeam)
          ? initialTeam
          : String(next.teams.find((team) => team.isActive)?.id ?? "")
      ));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取绩效参数失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setEditable(canEditPerformanceParameters());
    void load();
  }, [load]);

  const activeGlobal = useMemo(() => data?.payrollParameters
    .filter((version) => version.effectiveMonth <= currentMonth())
    .sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth))[0] ?? null,
  [data]);
  const selectedTeam = data?.teams.find((team) => String(team.id) === teamId) ?? null;
  const activeTeamVersion = useMemo(() => data?.teamCommissionRates
    .filter((version) => String(version.teamId) === teamId && version.effectiveMonth <= currentMonth())
    .sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth))[0] ?? null,
  [data, teamId]);

  const validateGlobal = (): string | null => {
    const commission = Number(globalCommission);
    const exchange = Number(globalExchange);
    if (!/^\d{4}-\d{2}$/.test(globalMonth)) return "请选择全厂参数生效月份";
    if (!(commission > 0 && commission <= 100)) return "默认提成比例必须大于 0% 且不超过 100%";
    if (!(exchange > 0)) return "汇率必须大于 0";
    return null;
  };

  const saveGlobal = async () => {
    const error = validateGlobal();
    if (error) return setNotice(error);
    setBusy(true);
    setNotice(null);
    try {
      await setFormalPayrollParameters({
        effectiveMonth: globalMonth,
        commissionRate: decimalRate(globalCommission),
        cnyToJmdRate: String(Number(globalExchange)),
      });
      await load();
      setNotice(`${globalMonth} 全厂参数已保存，所有未设置特殊比例的维修组将自动使用。`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "保存全厂参数失败");
    } finally {
      setBusy(false);
    }
  };

  const saveTeam = async (commissionRate: string | null) => {
    const parsedTeamId = Number(teamId);
    if (!Number.isInteger(parsedTeamId) || parsedTeamId <= 0) return setNotice("请选择维修组");
    if (!/^\d{4}-\d{2}$/.test(teamMonth)) return setNotice("请选择维修组参数生效月份");
    if (commissionRate !== null) {
      const percent = Number(commissionRate);
      if (!(percent > 0 && percent <= 100)) return setNotice("特殊提成比例必须大于 0% 且不超过 100%");
    }
    setBusy(true);
    setNotice(null);
    try {
      await setFormalTeamCommissionRate({
        teamId: parsedTeamId,
        effectiveMonth: teamMonth,
        commissionRate: commissionRate === null ? null : decimalRate(commissionRate),
      });
      await load();
      setNotice(commissionRate === null
        ? `${selectedTeam?.name ?? "该维修组"}将从 ${teamMonth} 起恢复全厂默认比例。`
        : `${selectedTeam?.name ?? "该维修组"}的 ${teamMonth} 特殊比例已保存。`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "保存维修组比例失败");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-primary disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900";

  return (
    <section id="performance-parameters" data-testid="settings-performance-parameters" className="scroll-mt-4 rounded-[22px] border border-primary-100 bg-white/85 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/45 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-ink dark:text-slate-100">绩效参数</h2>
          <p className="mt-1 text-[11px] leading-5 text-ink-soft dark:text-slate-400">
            先设置全厂每月默认提成比例与 CNY→JMD 汇率；只有特殊维修组才单独设置比例。每次变更都会保存为历史版本。
          </p>
        </div>
        <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary dark:bg-primary/15 dark:text-primary-300">
          {editable ? "超级管理员可修改" : "只读"}
        </span>
      </div>

      {loading && !data ? <p className="mt-4 text-xs text-ink-soft">正在读取正式参数…</p> : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <p className="text-[10px] font-semibold text-ink-faint dark:text-slate-400">当前全厂默认提成比例</p>
              <p className="mt-1 text-lg font-bold text-ink dark:text-slate-100">{activeGlobal ? percentage(activeGlobal.commissionRate) : "未设置"}</p>
              <p className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">{activeGlobal ? `${activeGlobal.effectiveMonth} 起生效` : "尚无可用于目标计算的版本"}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <p className="text-[10px] font-semibold text-ink-faint dark:text-slate-400">当前全厂汇率</p>
              <p className="mt-1 text-lg font-bold text-ink dark:text-slate-100">{activeGlobal ? `1 CNY = ${Number(activeGlobal.cnyToJmdRate)} JMD` : "未设置"}</p>
              <p className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">历史月份继续使用当时已生效的版本</p>
            </div>
          </div>

          {editable ? (
            <div className="mt-4 rounded-xl border border-line p-3 dark:border-slate-700">
              <h3 className="text-xs font-bold text-ink dark:text-slate-100">新增全厂月度参数版本</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-ink dark:text-slate-200">生效月份
                  <input data-testid="performance-global-month" type="month" value={globalMonth} onChange={(event) => setGlobalMonth(event.target.value)} className={inputClass} />
                </label>
                <label className="text-xs font-semibold text-ink dark:text-slate-200">默认工时提成比例（%）
                  <input data-testid="performance-global-commission" inputMode="decimal" value={globalCommission} onChange={(event) => setGlobalCommission(event.target.value)} className={inputClass} placeholder="例如 25" />
                </label>
                <label className="text-xs font-semibold text-ink dark:text-slate-200">1 CNY = 多少 JMD
                  <input data-testid="performance-global-exchange" inputMode="decimal" value={globalExchange} onChange={(event) => setGlobalExchange(event.target.value)} className={inputClass} placeholder="例如 22" />
                </label>
              </div>
              <button data-testid="performance-global-save" type="button" disabled={busy} onClick={() => void saveGlobal()} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-50">
                <Save size={14} /> 保存全厂参数版本
              </button>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-line p-3 dark:border-slate-700">
            <h3 className="text-xs font-bold text-ink dark:text-slate-100">维修组特殊比例</h3>
            <p className="mt-1 text-[10px] leading-5 text-ink-soft dark:text-slate-400">不设置特殊比例时自动跟随全厂默认；恢复默认也会保留生效月份和历史记录。</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-ink dark:text-slate-200">维修组
                <select data-testid="performance-team-select" value={teamId} onChange={(event) => setTeamId(event.target.value)} className={inputClass}>
                  <option value="">请选择</option>
                  {data?.teams.filter((team) => team.isActive).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">生效月份
                <input data-testid="performance-team-month" type="month" value={teamMonth} onChange={(event) => setTeamMonth(event.target.value)} className={inputClass} disabled={!editable} />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">特殊工时提成比例（%）
                <input data-testid="performance-team-commission" inputMode="decimal" value={teamCommission} onChange={(event) => setTeamCommission(event.target.value)} className={inputClass} placeholder="例如 20" disabled={!editable} />
              </label>
            </div>
            {selectedTeam ? (
              <p className="mt-2 text-[11px] font-semibold text-ink-soft dark:text-slate-300">
                {activeTeamVersion?.commissionRate
                  ? `当前：特殊比例 ${percentage(activeTeamVersion.commissionRate)}（${activeTeamVersion.effectiveMonth} 起）`
                  : "当前：跟随全厂默认比例"}
              </p>
            ) : null}
            {editable ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button data-testid="performance-team-save" type="button" disabled={busy} onClick={() => void saveTeam(teamCommission)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-50">
                  <Save size={14} /> 保存特殊比例
                </button>
                <button data-testid="performance-team-restore" type="button" disabled={busy} onClick={() => void saveTeam(null)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-4 text-xs font-semibold text-ink-soft disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
                  <RefreshCw size={14} /> 从该月恢复全厂默认
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="text-[11px] font-bold text-ink dark:text-slate-100">全厂参数历史</h3>
              <div className="mt-2 space-y-1.5">
                {data?.payrollParameters.length ? data.payrollParameters.map((version) => (
                  <div key={version.effectiveMonth} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-[10px] text-ink-soft dark:bg-slate-800/60 dark:text-slate-300">
                    <span>{version.effectiveMonth}</span><span>{percentage(version.commissionRate)} · 1 CNY = {Number(version.cnyToJmdRate)} JMD</span>
                  </div>
                )) : <p className="text-[10px] text-ink-faint">暂无历史版本</p>}
              </div>
            </div>
            <div>
              <h3 className="text-[11px] font-bold text-ink dark:text-slate-100">维修组特殊比例历史</h3>
              <div className="mt-2 space-y-1.5">
                {data?.teamCommissionRates.length ? data.teamCommissionRates.map((version) => (
                  <div key={`${version.teamId}-${version.effectiveMonth}`} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-[10px] text-ink-soft dark:bg-slate-800/60 dark:text-slate-300">
                    <span>{version.effectiveMonth} · {version.teamName}</span><span>{version.commissionRate ? percentage(version.commissionRate) : "恢复全厂默认"}</span>
                  </div>
                )) : <p className="text-[10px] text-ink-faint">暂无特殊比例，所有维修组跟随全厂默认</p>}
              </div>
            </div>
          </div>
        </>
      )}
      {notice ? <p data-testid="performance-parameters-notice" role="status" className="mt-3 text-[11px] font-semibold text-primary">{notice}</p> : null}
    </section>
  );
}
