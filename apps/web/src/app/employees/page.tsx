"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import {
  createFormalMechanic,
  fetchFormalMasterData,
  setFormalEmployeeSalary,
  type FormalDictionaryItem,
  type FormalRepairTeam,
  type FormalStaffMember,
} from "@/lib/api/formal-master-data";

type EmployeeDraft = {
  fullName: string;
  phone: string;
  teamId: string;
  positionItemId: string;
  hiredOn: string;
  effectiveMonth: string;
  baseSalaryCny: string;
  username: string;
  password: string;
};

function currentJamaicaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const EMPTY_DRAFT: EmployeeDraft = {
  fullName: "",
  phone: "",
  teamId: "",
  positionItemId: "",
  hiredOn: currentJamaicaDate(),
  effectiveMonth: currentJamaicaDate().slice(0, 7),
  baseSalaryCny: "",
  username: "",
  password: "",
};

function EmployeesContent() {
  const searchParams = useSearchParams();
  const [employees, setEmployees] = useState<FormalStaffMember[]>([]);
  const [teams, setTeams] = useState<FormalRepairTeam[]>([]);
  const [positions, setPositions] = useState<FormalDictionaryItem[]>([]);
  const [draft, setDraft] = useState<EmployeeDraft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [salaryEditingId, setSalaryEditingId] = useState<number | null>(null);
  const [salaryMonth, setSalaryMonth] = useState(currentJamaicaDate().slice(0, 7));
  const [salaryAmount, setSalaryAmount] = useState("");
  const requestedTeamId = searchParams.get("team") ?? "";
  const employeeReturnPath = `/employees?create=1${requestedTeamId ? `&team=${encodeURIComponent(requestedTeamId)}` : ""}`;
  const positionDictionaryHref = `/dictionaries?returnTo=${encodeURIComponent(employeeReturnPath)}#roles`;

  const refresh = async () => {
    const result = await fetchFormalMasterData();
    const activeTeams = result.teams.filter((team) => team.isActive);
    const activePositions = result.dictionaries.filter((item) => item.category === "staff_position" && item.isActive);
    setEmployees(result.staff);
    setTeams(activeTeams);
    setPositions(activePositions);
    return { activeTeams, activePositions };
  };
  useEffect(() => {
    void refresh().then(({ activeTeams, activePositions }) => {
      if (searchParams.get("create") === "1" && activeTeams.some((team) => String(team.id) === requestedTeamId)) {
        setDraft({ ...EMPTY_DRAFT, teamId: requestedTeamId, positionItemId: String(activePositions[0]?.id ?? "") });
        setFormOpen(true);
        setNotice(`正在为“${activeTeams.find((team) => String(team.id) === requestedTeamId)?.name}”新增维修工账号`);
      }
    }).catch((error) => setNotice(error instanceof Error ? error.message : "员工档案读取失败"));
  }, [searchParams]);

  const beginCreate = () => {
    setDraft({ ...EMPTY_DRAFT, positionItemId: String(positions[0]?.id ?? "") });
    setFormOpen(true);
    setNotice(null);
  };
  const save = async () => {
    try {
      await createFormalMechanic({
        fullName: draft.fullName,
        phone: draft.phone,
        teamId: Number(draft.teamId),
        positionItemId: Number(draft.positionItemId),
        hiredOn: draft.hiredOn,
        effectiveMonth: draft.effectiveMonth,
        baseSalaryCnyMinor: Math.round(Number(draft.baseSalaryCny) * 100),
        username: draft.username,
        password: draft.password,
      });
      setNotice("维修工、班组归属、基准工资和登录账号已同时创建");
      await refresh();
      setFormOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    }
  };

  const saveSalary = async () => {
    if (salaryEditingId === null) return;
    try {
      await setFormalEmployeeSalary({
        staffMemberId: salaryEditingId,
        effectiveMonth: salaryMonth,
        baseSalaryCnyMinor: Math.round(Number(salaryAmount) * 100),
      });
      await refresh();
      setSalaryEditingId(null);
      setSalaryAmount("");
      setNotice("新的个人基准工资已按整月生效保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "基准工资保存失败");
    }
  };

  return (
    <div className="min-h-full bg-[var(--wh-page-bg)] px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-5xl">
        <PageHeader breadcrumb="主营业务" title="员工管理" description="系统初始只有超级管理员；由超级管理员按实际人员新增、修改或删除员工。" />
        <section className="mt-3 rounded-[22px] border border-line bg-white/80 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/40 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-ink dark:text-slate-100">员工档案</h2>
              <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">超级管理员为系统身份，不可删除；新增员工时同步创建该员工的登录身份账号。</p>
            </div>
            <button type="button" data-testid="employee-add-open" onClick={beginCreate} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600">新增员工</button>
          </div>

          <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="font-semibold text-ink dark:text-slate-100">超级管理员</div>
            <div className="text-[11px] text-ink-soft dark:text-slate-400">唯一初始身份 · 全部权限</div>
          </div>

          {formOpen ? (
            <div data-testid="employee-form" className="mt-4 grid gap-3 rounded-xl border border-line bg-surface-warm/40 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800/40">
              <label className="text-xs font-semibold text-ink dark:text-slate-200">姓名
                <input data-testid="employee-name" required value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">手机号（选填）
                <input data-testid="employee-phone" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="+1 876 ..." className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">岗位
                <select data-testid="employee-position" required value={draft.positionItemId} onChange={(event) => setDraft((current) => ({ ...current, positionItemId: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
                  <option value="">选择岗位</option>
                  {positions.map((position) => <option key={position.id} value={position.id}>{position.labelZh}</option>)}
                </select>
                {positions.length === 0 ? <Link href={positionDictionaryHref} className="mt-1 inline-flex text-[11px] font-semibold text-primary">先新增员工岗位 →</Link> : null}
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">维修班组
                <select data-testid="employee-team" required value={draft.teamId} onChange={(event) => setDraft((current) => ({ ...current, teamId: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
                  <option value="">选择维修班组</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">入职日期
                <input data-testid="employee-hired-on" type="date" required value={draft.hiredOn} onChange={(event) => setDraft((current) => ({ ...current, hiredOn: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">基准工资生效月份
                <input data-testid="employee-effective-month" type="month" required value={draft.effectiveMonth} onChange={(event) => setDraft((current) => ({ ...current, effectiveMonth: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">基准工资（CNY）
                <input data-testid="employee-base-salary" inputMode="decimal" required value={draft.baseSalaryCny} onChange={(event) => setDraft((current) => ({ ...current, baseSalaryCny: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">登录名
                <input data-testid="employee-username" autoComplete="off" required value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200 sm:col-span-2">初始密码
                <input data-testid="employee-password" type="password" autoComplete="new-password" required value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" />
                <span className="mt-1 block text-[10px] font-normal text-ink-soft">首次登录必须修改密码；系统不显示已保存密码。</span>
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button type="button" data-testid="employee-save" disabled={!draft.positionItemId || !draft.teamId} onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">保存并创建账号</button>
                <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft dark:border-slate-600">取消</button>
              </div>
            </div>
          ) : null}

          <div data-testid="employee-list" className="mt-4 space-y-2">
            {employees.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-soft dark:border-slate-700">尚未新增员工。</div>
            ) : employees.map((employee) => (
              <div key={employee.id} data-testid="employee-row" className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 dark:border-slate-700">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink dark:text-slate-100">{employee.fullName}</div>
                  <div className="text-[11px] text-ink-soft dark:text-slate-400">{employee.positionLabel} · {employee.currentTeamName ?? "未分配班组"} · {employee.normalizedPhone ?? "未填写手机号"}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-faint dark:text-slate-500">员工编号：{employee.staffNo} · 登录名：{employee.accountUsername}</div>
                  {employee.latestBaseSalaryCnyMinor !== null ? <div className="mt-1 text-[10px] text-ink-soft">基准工资 CNY {(employee.latestBaseSalaryCnyMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} · {employee.salaryEffectiveMonth ?? ""} 生效</div> : null}
                </div>
                <button type="button" onClick={() => { setSalaryEditingId(employee.id); setSalaryMonth(currentJamaicaDate().slice(0, 7)); setSalaryAmount(""); }} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-primary dark:border-slate-600">调整基准工资</button>
                {salaryEditingId === employee.id ? <div className="grid w-full gap-2 rounded-lg bg-surface p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                  <input aria-label="基准工资生效月份" type="month" value={salaryMonth} onChange={(event) => setSalaryMonth(event.target.value)} className="min-h-9 rounded-lg border border-line px-3 text-xs" />
                  <input aria-label="新的基准工资 CNY" inputMode="decimal" value={salaryAmount} onChange={(event) => setSalaryAmount(event.target.value)} placeholder="新的 CNY 金额" className="min-h-9 rounded-lg border border-line px-3 text-xs" />
                  <button type="button" onClick={() => void saveSalary()} className="rounded-lg bg-primary px-3 text-xs font-semibold text-white">保存新版本</button>
                  <button type="button" onClick={() => setSalaryEditingId(null)} className="rounded-lg border border-line px-3 text-xs">取消</button>
                </div> : null}
              </div>
            ))}
          </div>
          {notice ? <p data-testid="employee-notice" role="status" className="mt-3 text-xs font-semibold text-primary">{notice}</p> : null}
        </section>

        <section className="mt-3 rounded-[22px] border border-line bg-white/80 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/40 sm:p-5">
          <h2 className="text-sm font-bold text-ink dark:text-slate-100">员工所属班组</h2>
          <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">班组只在基础字典维护；新增或修改员工时从已建立的班组中选择。</p>
          <Link href="/dictionaries#teams" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white">管理维修班组</Link>
        </section>
      </div>
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-[var(--wh-page-bg)] p-6 text-sm text-ink-soft">正在准备员工档案…</div>}>
      <EmployeesContent />
    </Suspense>
  );
}
