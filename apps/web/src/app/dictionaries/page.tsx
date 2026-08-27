"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, CreditCard, Ruler, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import {
  type ChargeUnitDefinition,
} from "@/lib/billing/unit-dictionary";
import {
  type PaymentMethodEntry,
} from "@/lib/payments/method-dictionary";
import {
  type TeamDefinition,
} from "@/lib/teams/team-dictionary";
import {
  createFormalDictionaryItem,
  createFormalRepairTeam,
  fetchFormalMasterData,
  renameFormalRepairTeam,
  retireFormalRepairTeam,
  updateFormalDictionaryItem,
  type FormalDictionaryItem,
  type FormalStaffMember,
} from "@/lib/api/formal-master-data";

type DictionarySection = "teams" | "payment-methods" | "charge-units" | "roles";
type TeamRemovalRequest = {
  team: TeamDefinition;
  employeeCount: number;
  quickOrderCount: number;
  replacementId: string;
};

const inputClass = "h-10 min-w-0 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const secondaryButton = "h-9 shrink-0 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-primary transition hover:border-primary/40 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800";
const primaryButton = "h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40";

const sectionMeta: ReadonlyArray<{
  id: DictionarySection;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: "teams", label: "维修班组", description: "用于员工归组、Business Order 派单与绩效", icon: Users },
  { id: "payment-methods", label: "支付方式", description: "用于每一笔独立收款与退款", icon: CreditCard },
  { id: "charge-units", label: "收费单位", description: "用于 Business Order 收费项目单位选择", icon: Ruler },
  { id: "roles", label: "员工岗位", description: "用于员工档案和岗位选择", icon: ShieldCheck },
];

function sectionFromHash(): DictionarySection {
  if (typeof window === "undefined") return "teams";
  const value = window.location.hash.slice(1);
  return sectionMeta.some((section) => section.id === value) ? value as DictionarySection : "teams";
}

export default function DictionariesPage() {
  const [activeSection, setActiveSection] = useState<DictionarySection>("teams");
  const [teams, setTeams] = useState<TeamDefinition[]>([]);
  const [employees, setEmployees] = useState<FormalStaffMember[]>([]);
  const [teamDrafts, setTeamDrafts] = useState<Record<string, string>>({});
  const [newTeam, setNewTeam] = useState("");
  const [teamNotice, setTeamNotice] = useState<string | null>(null);
  const [teamRemoval, setTeamRemoval] = useState<TeamRemovalRequest | null>(null);
  const [teamRemovalPending, setTeamRemovalPending] = useState(false);
  const [methods, setMethods] = useState<PaymentMethodEntry[]>([]);
  const [methodDrafts, setMethodDrafts] = useState<Record<string, { zh: string; en: string }>>({});
  const [newMethodZh, setNewMethodZh] = useState("");
  const [newMethodEn, setNewMethodEn] = useState("");
  const [methodNotice, setMethodNotice] = useState<string | null>(null);
  const [units, setUnits] = useState<ChargeUnitDefinition[]>([]);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, { zh: string; en: string }>>({});
  const [newUnitZh, setNewUnitZh] = useState("");
  const [newUnitEn, setNewUnitEn] = useState("");
  const [unitNotice, setUnitNotice] = useState<string | null>(null);
  const [positions, setPositions] = useState<FormalDictionaryItem[]>([]);
  const [positionDrafts, setPositionDrafts] = useState<Record<number, { zh: string; en: string }>>({});
  const [newPositionZh, setNewPositionZh] = useState("");
  const [newPositionEn, setNewPositionEn] = useState("");
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/employees");

  const refreshAll = async () => {
    const result = await fetchFormalMasterData();
    setTeams(result.teams.filter((team) => team.isActive).map((team) => ({
      id: String(team.id), name: team.name, engineering: false, builtin: false,
    })));
    setEmployees(result.staff);
    setMethods(result.dictionaries.filter((item) => item.category === "payment_method" && item.isActive).map((item) => ({
      value: String(item.id), zh: item.labelZh, en: item.labelEn ?? "", builtin: !item.code.startsWith("custom-"),
    })));
    setUnits(result.dictionaries.filter((item) => item.category === "charge_unit" && item.isActive).map((item) => ({
      id: String(item.id), zh: item.labelZh, en: item.labelEn ?? "", builtin: !item.code.startsWith("custom-"),
    })));
    setPositions(result.dictionaries.filter((item) => item.category === "staff_position" && item.isActive));
  };
  const refreshTeams = refreshAll;
  const refreshMethods = refreshAll;
  const refreshUnits = refreshAll;
  const refreshPositions = refreshAll;

  useEffect(() => {
    void refreshAll().catch((error) => setTeamNotice(error instanceof Error ? error.message : "基础资料读取失败"));
    const syncHash = () => setActiveSection(sectionFromHash());
    const requestedReturn = new URLSearchParams(window.location.search).get("returnTo");
    if (requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")) setReturnTo(requestedReturn);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const selectSection = (section: DictionarySection) => {
    setActiveSection(section);
    window.history.replaceState(null, "", `#${section}`);
  };

  const counts: Record<DictionarySection, number> = {
    teams: teams.length,
    "payment-methods": methods.length,
    "charge-units": units.length,
    roles: positions.length,
  };

  const requestTeamRemoval = async (team: TeamDefinition) => {
    try {
      const employeeCount = employees.filter((employee) => String(employee.currentTeamId) === team.id && employee.status === "active").length;
      const quickOrderCount = 0;
      if (employeeCount + quickOrderCount === 0) {
        await retireFormalRepairTeam({ teamId: Number(team.id), reason: "超级管理员在基础字典停用班组" });
        await refreshTeams();
        setTeamNotice("班组已停用");
        return;
      }
      const successor = teams.find((candidate) => candidate.id !== team.id);
      if (!successor) {
        setTeamNotice(`“${team.name}”仍被使用，请先新增另一个维修班组作为继承班组`);
        return;
      }
      setTeamRemoval({ team, employeeCount, quickOrderCount, replacementId: successor.id });
    } catch (error) {
      setTeamNotice(error instanceof Error ? error.message : "班组使用情况读取失败");
    }
  };

  const confirmTeamReplacement = async () => {
    if (!teamRemoval || teamRemovalPending) return;
    const successor = teams.find((team) => team.id === teamRemoval.replacementId);
    if (!successor) {
      setTeamNotice("请选择仍然存在的继承班组");
      return;
    }
    setTeamRemovalPending(true);
    try {
      const result = await retireFormalRepairTeam({
        teamId: Number(teamRemoval.team.id),
        replacementTeamId: Number(successor.id),
        reason: "超级管理员选择继承班组后停用来源班组",
      });
      await refreshTeams();
      setTeamRemoval(null);
      setTeamNotice(`“${teamRemoval.team.name}”已停用；${result.movedMemberCount} 名员工已由“${successor.name}”继承，历史记录保持原班组事实`);
    } catch (error) {
      setTeamNotice(error instanceof Error ? error.message : "班组继承失败");
    } finally {
      setTeamRemovalPending(false);
    }
  };

  return (
    <div className="min-h-full bg-[var(--wh-page-bg)] px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-6xl">
        <PageHeader
          breadcrumb="系统 · 基础资料"
          title="基础字典"
          description="统一维护业务页面允许使用的班组、支付方式、收费单位和员工岗位。"
        />

        <section data-testid="dictionary-overview" className="mt-3 overflow-hidden rounded-xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary dark:bg-primary-500/10"><BookOpen size={17} /></span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-ink dark:text-slate-100">字典管理</h2>
                <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">选择一类后集中维护；业务页面立即读取保存结果。</p>
              </div>
            </div>
            <Link href={returnTo} className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-primary-200 bg-primary-50 px-3 text-xs font-semibold text-primary hover:bg-primary-100 dark:border-primary-500/30 dark:bg-primary-500/10">← 返回员工管理</Link>
          </div>

          <div className="grid min-w-0 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="字典分类" className="grid grid-cols-2 gap-1 border-b border-line bg-surface-warm/35 p-2 dark:border-slate-700 dark:bg-slate-950/20 sm:grid-cols-4 lg:block lg:border-b-0 lg:border-r lg:p-3">
              {sectionMeta.map((section) => {
                const Icon = section.icon;
                const selected = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    data-testid={`dictionary-tab-${section.id}`}
                    aria-pressed={selected}
                    onClick={() => selectSection(section.id)}
                    className={`flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition lg:mb-1 ${selected ? "bg-white text-primary shadow-sm ring-1 ring-line dark:bg-slate-800 dark:ring-slate-700" : "text-ink-soft hover:bg-white/70 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800/60"}`}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{section.label}</span>
                      <span className="mt-0.5 block text-[10px] text-ink-faint">{counts[section.id]} 项</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 p-3 sm:p-4">
              {activeSection === "teams" ? (
                <DictionaryPanel testId="settings-teams-card" title="维修班组" description="新增后立即可用于员工归组、Business Order 派单和绩效统计。">
                  <div className="grid gap-2 border-b border-line pb-4 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input data-testid="settings-team-add-input" value={newTeam} onChange={(event) => setNewTeam(event.target.value)} placeholder="输入真实班组名称" className={inputClass} />
                    <button type="button" data-testid="settings-team-add" disabled={!newTeam.trim()} onClick={async () => {
                      try { await createFormalRepairTeam(newTeam); setNewTeam(""); await refreshTeams(); setTeamNotice("已添加班组"); }
                      catch (error) { setTeamNotice(error instanceof Error ? error.message : "班组添加失败"); }
                    }} className={primaryButton}>添加班组</button>
                  </div>
                  <div className="mt-3 space-y-2" data-testid="settings-teams-list">
                    {teams.length === 0 ? <Empty copy="尚未建立维修班组。上方输入真实名称即可新增。" /> : teams.map((team) => {
                      const draft = teamDrafts[team.id] ?? team.name;
                      return (
                        <div key={team.id} className="grid min-w-0 gap-2 rounded-lg border border-line bg-surface-warm/20 p-2.5 dark:border-slate-700 dark:bg-slate-800/25 sm:grid-cols-[92px_minmax(0,1fr)_auto_auto_auto] sm:items-center">
                          <span className="font-mono text-[11px] text-ink-faint">{team.id}<small className="mt-1 block font-sans text-[10px]">{employees.filter((employee) => String(employee.currentTeamId) === team.id && employee.status === "active").length} 名成员</small></span>
                          <input data-testid={`settings-team-name-${team.id}`} value={draft} onChange={(event) => setTeamDrafts((current) => ({ ...current, [team.id]: event.target.value }))} className={inputClass} aria-label={`${team.name}班组名称`} />
                          <Link href={`/employees?create=1&team=${encodeURIComponent(team.id)}`} data-testid={`settings-team-add-member-${team.id}`} className={secondaryButton}>添加成员账号</Link>
                          <button type="button" data-testid={`settings-team-rename-${team.id}`} disabled={!draft.trim() || draft.trim() === team.name} onClick={async () => {
                            try { await renameFormalRepairTeam(Number(team.id), draft); await refreshTeams(); setTeamNotice("班组名称已更新"); }
                            catch (error) { setTeamNotice(error instanceof Error ? error.message : "班组更新失败"); }
                          }} className={secondaryButton}>保存</button>
                          <DeleteButton label="删除班组" testId={`settings-team-remove-${team.id}`} onClick={() => {
                            void requestTeamRemoval(team);
                          }} />
                        </div>
                      );
                    })}
                  </div>
                  <Notice testId="settings-team-notice" text={teamNotice} />
                </DictionaryPanel>
              ) : null}

              {activeSection === "payment-methods" ? (
                <DictionaryPanel testId="settings-methods-card" title="支付方式" description="每一笔收款和退款只能选择这里存在的方式。标准项可改名，自定义项可删除。">
                  <div className="grid gap-2 border-b border-line pb-4 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input data-testid="settings-method-add-input" value={newMethodZh} onChange={(event) => setNewMethodZh(event.target.value)} placeholder="中文名称" className={inputClass} />
                    <input value={newMethodEn} onChange={(event) => setNewMethodEn(event.target.value)} placeholder="English name" className={inputClass} />
                    <button type="button" data-testid="settings-method-add" disabled={!newMethodZh.trim()} onClick={async () => {
                      try { await createFormalDictionaryItem({ category: "payment_method", labelZh: newMethodZh, labelEn: newMethodEn }); setNewMethodZh(""); setNewMethodEn(""); await refreshMethods(); setMethodNotice("已添加支付方式"); }
                      catch (error) { setMethodNotice(error instanceof Error ? error.message : "支付方式添加失败"); }
                    }} className={primaryButton}>添加</button>
                  </div>
                  <div className="mt-3 space-y-2" data-testid="settings-methods-list">
                    {methods.map((method) => {
                      const draft = methodDrafts[method.value] ?? { zh: method.zh, en: method.en };
                      return (
                        <div key={method.value} data-testid={`settings-method-${method.value}`} className="grid min-w-0 gap-2 rounded-lg border border-line bg-surface-warm/20 p-2.5 dark:border-slate-700 dark:bg-slate-800/25 sm:grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center">
                          <CodeLabel value={method.value} builtin={Boolean(method.builtin)} />
                          <input data-testid={`settings-method-name-${method.value}`} value={draft.zh} onChange={(event) => setMethodDrafts((current) => ({ ...current, [method.value]: { ...draft, zh: event.target.value } }))} className={inputClass} aria-label={`${method.zh}中文名称`} />
                          <input data-testid={`settings-method-name-en-${method.value}`} value={draft.en} onChange={(event) => setMethodDrafts((current) => ({ ...current, [method.value]: { ...draft, en: event.target.value } }))} className={inputClass} aria-label={`${method.zh}英文名称`} />
                          <button type="button" onClick={async () => {
                            try { await updateFormalDictionaryItem({ itemId: Number(method.value), labelZh: draft.zh, labelEn: draft.en, isActive: true, sortOrder: methods.findIndex((item) => item.value === method.value) + 1 }); await refreshMethods(); setMethodNotice("支付方式已更新"); }
                            catch (error) { setMethodNotice(error instanceof Error ? error.message : "支付方式更新失败"); }
                          }} className={secondaryButton}>保存</button>
                          {!method.builtin ? <DeleteButton label={`删除${method.zh}`} onClick={async () => {
                            try { await updateFormalDictionaryItem({ itemId: Number(method.value), labelZh: method.zh, labelEn: method.en, isActive: false, sortOrder: methods.findIndex((item) => item.value === method.value) + 1 }); await refreshMethods(); setMethodNotice("支付方式已停用"); }
                            catch (error) { setMethodNotice(error instanceof Error ? error.message : "支付方式删除失败"); }
                          }} /> : <span className="hidden sm:block" />}
                        </div>
                      );
                    })}
                  </div>
                  <Notice testId="settings-method-notice" text={methodNotice} />
                </DictionaryPanel>
              ) : null}

              {activeSection === "charge-units" ? (
                <DictionaryPanel testId="dictionary-units-card" title="收费单位" description="Business Order 收费项目的单位从这里选择；标准项可改名，自定义项可删除。">
                  <div className="grid gap-2 border-b border-line pb-4 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input data-testid="dictionary-unit-add-zh" value={newUnitZh} onChange={(event) => setNewUnitZh(event.target.value)} placeholder="中文单位" className={inputClass} />
                    <input data-testid="dictionary-unit-add-en" value={newUnitEn} onChange={(event) => setNewUnitEn(event.target.value)} placeholder="English unit" className={inputClass} />
                    <button type="button" data-testid="dictionary-unit-add" disabled={!newUnitZh.trim()} onClick={async () => {
                      try { await createFormalDictionaryItem({ category: "charge_unit", labelZh: newUnitZh, labelEn: newUnitEn }); setNewUnitZh(""); setNewUnitEn(""); await refreshUnits(); setUnitNotice("收费单位已添加"); }
                      catch (error) { setUnitNotice(error instanceof Error ? error.message : "收费单位添加失败"); }
                    }} className={primaryButton}>添加</button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {units.map((unit) => {
                      const draft = unitDrafts[unit.id] ?? { zh: unit.zh, en: unit.en };
                      return (
                        <div key={unit.id} className="grid min-w-0 gap-2 rounded-lg border border-line bg-surface-warm/20 p-2.5 dark:border-slate-700 dark:bg-slate-800/25 sm:grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center">
                          <CodeLabel value={unit.id} builtin={unit.builtin} />
                          <input data-testid={`dictionary-unit-name-${unit.id}`} value={draft.zh} onChange={(event) => setUnitDrafts((current) => ({ ...current, [unit.id]: { ...draft, zh: event.target.value } }))} className={inputClass} aria-label={`${unit.zh}中文名称`} />
                          <input value={draft.en} onChange={(event) => setUnitDrafts((current) => ({ ...current, [unit.id]: { ...draft, en: event.target.value } }))} className={inputClass} aria-label={`${unit.zh}英文名称`} />
                          <button type="button" data-testid={`dictionary-unit-save-${unit.id}`} onClick={async () => {
                            try { await updateFormalDictionaryItem({ itemId: Number(unit.id), labelZh: draft.zh, labelEn: draft.en, isActive: true, sortOrder: units.findIndex((item) => item.id === unit.id) + 1 }); await refreshUnits(); setUnitNotice("收费单位已更新"); }
                            catch (error) { setUnitNotice(error instanceof Error ? error.message : "收费单位更新失败"); }
                          }} className={secondaryButton}>保存</button>
                          {!unit.builtin ? <DeleteButton label={`删除${unit.zh}`} testId={`dictionary-unit-remove-${unit.id}`} onClick={async () => {
                            try { await updateFormalDictionaryItem({ itemId: Number(unit.id), labelZh: unit.zh, labelEn: unit.en, isActive: false, sortOrder: units.findIndex((item) => item.id === unit.id) + 1 }); await refreshUnits(); setUnitNotice("收费单位已停用"); }
                            catch (error) { setUnitNotice(error instanceof Error ? error.message : "收费单位删除失败"); }
                          }} /> : <span className="hidden sm:block" />}
                        </div>
                      );
                    })}
                  </div>
                  <Notice testId="dictionary-unit-notice" text={unitNotice} />
                </DictionaryPanel>
              ) : null}

              {activeSection === "roles" ? (
                <DictionaryPanel testId="dictionary-roles-card" title="员工岗位" description="员工档案中的岗位从这里选择；新增或修改后立即可用。">
                  <div className="grid gap-2 border-b border-line pb-4 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input value={newPositionZh} onChange={(event) => setNewPositionZh(event.target.value)} placeholder="岗位中文名称" className={inputClass} />
                    <input value={newPositionEn} onChange={(event) => setNewPositionEn(event.target.value)} placeholder="Position English name" className={inputClass} />
                    <button type="button" disabled={!newPositionZh.trim()} onClick={async () => {
                      try {
                        await createFormalDictionaryItem({ category: "staff_position", labelZh: newPositionZh, labelEn: newPositionEn });
                        setNewPositionZh(""); setNewPositionEn(""); await refreshPositions(); setPositionNotice("员工岗位已添加");
                      } catch (error) { setPositionNotice(error instanceof Error ? error.message : "岗位添加失败"); }
                    }} className={primaryButton}>添加岗位</button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {positions.length === 0 ? <Empty copy="尚未建立员工岗位。先添加“维修工”等实际岗位。" /> : positions.map((position, index) => {
                      const draft = positionDrafts[position.id] ?? { zh: position.labelZh, en: position.labelEn ?? "" };
                      return <div key={position.id} className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center">
                        <CodeLabel value={position.code} builtin={!position.code.startsWith("custom-")} />
                        <input value={draft.zh} onChange={(event) => setPositionDrafts((current) => ({ ...current, [position.id]: { ...draft, zh: event.target.value } }))} className={inputClass} />
                        <input value={draft.en} onChange={(event) => setPositionDrafts((current) => ({ ...current, [position.id]: { ...draft, en: event.target.value } }))} className={inputClass} />
                        <button type="button" onClick={async () => {
                          try { await updateFormalDictionaryItem({ itemId: position.id, labelZh: draft.zh, labelEn: draft.en, isActive: true, sortOrder: index + 1 }); await refreshPositions(); setPositionNotice("员工岗位已更新"); }
                          catch (error) { setPositionNotice(error instanceof Error ? error.message : "岗位更新失败"); }
                        }} className={secondaryButton}>保存</button>
                        <DeleteButton label={`停用${position.labelZh}`} onClick={async () => {
                          try { await updateFormalDictionaryItem({ itemId: position.id, labelZh: position.labelZh, labelEn: position.labelEn ?? "", isActive: false, sortOrder: index + 1 }); await refreshPositions(); setPositionNotice("员工岗位已停用"); }
                          catch (error) { setPositionNotice(error instanceof Error ? error.message : "岗位停用失败"); }
                        }} />
                      </div>;
                    })}
                  </div>
                  <Notice testId="dictionary-position-notice" text={positionNotice} />
                  <Link href={returnTo} className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white">返回员工管理</Link>
                </DictionaryPanel>
              ) : null}
            </div>
          </div>
        </section>
      </div>
      {teamRemoval ? (
        <div data-testid="team-replacement-dialog" role="dialog" aria-modal="true" aria-label="选择班组继承关系" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-base font-bold text-ink dark:text-slate-100">删除“{teamRemoval.team.name}”</h2>
            <p data-testid="team-replacement-summary" className="mt-2 text-sm leading-6 text-ink-soft dark:text-slate-300">
              当前仍有 {teamRemoval.employeeCount} 名员工、{teamRemoval.quickOrderCount} 张 Business Order 使用该班组。必须先选择一个现有班组继承这些关系。
            </p>
            <label className="mt-4 block text-xs font-semibold text-ink dark:text-slate-200">继承班组
              <select data-testid="team-replacement-select" value={teamRemoval.replacementId} onChange={(event) => setTeamRemoval((current) => current ? { ...current, replacementId: event.target.value } : current)} className={`${inputClass} mt-1`}>
                {teams.filter((team) => team.id !== teamRemoval.team.id).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <p className="mt-3 text-xs leading-5 text-ink-soft dark:text-slate-400">员工归组、Business Order 当前班组与后续绩效归集会转到继承班组；原 Business Order 审计中会记录本次班组继承。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={teamRemovalPending} onClick={() => setTeamRemoval(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft dark:border-slate-600">取消</button>
              <button type="button" data-testid="team-replacement-confirm" disabled={teamRemovalPending || !teamRemoval.replacementId} onClick={() => void confirmTeamReplacement()} className="h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{teamRemovalPending ? "正在转移…" : "确认继承并删除"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DictionaryPanel({ testId, title, description, children }: { testId: string; title: string; description: string; children: ReactNode }) {
  return <section data-testid={testId}><div className="mb-4"><h2 className="text-base font-bold text-ink dark:text-slate-100">{title}</h2><p className="mt-1 text-xs leading-5 text-ink-soft dark:text-slate-400">{description}</p></div>{children}</section>;
}

function CodeLabel({ value, builtin }: { value: string; builtin: boolean }) {
  return <div className="min-w-0"><span className="block truncate font-mono text-[11px] text-ink-faint">{value}</span><span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-semibold ${builtin ? "bg-slate-100 text-slate-500 dark:bg-slate-700" : "bg-primary-50 text-primary dark:bg-primary-500/10"}`}>{builtin ? "标准项" : "自定义"}</span></div>;
}

function DeleteButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return <button type="button" aria-label={label} data-testid={testId} onClick={onClick} className="h-9 shrink-0 rounded-lg px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-500/10">删除</button>;
}

function Notice({ testId, text }: { testId: string; text: string | null }) {
  return text ? <p data-testid={testId} role="status" className="mt-3 rounded-lg bg-primary-50 px-3 py-2 text-xs font-semibold text-primary dark:bg-primary-500/10">{text}</p> : null;
}

function Empty({ copy }: { copy: string }) {
  return <div className="rounded-lg border border-dashed border-line bg-surface-warm/20 px-4 py-10 text-center text-sm text-ink-soft dark:border-slate-700 dark:bg-slate-800/20">{copy}</div>;
}
