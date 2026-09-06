"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CarFront, Check, LoaderCircle, Plus, Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { VehicleFormDialog } from "@/components/customers/form-dialogs";
import { createFormalInspectionReport, type FormalInspectionReport } from "@/lib/api/formal-inspections";
import {
  fetchFormalMasterData,
  type FormalRepairTeam,
  type FormalStaffMember,
} from "@/lib/api/formal-master-data";
import {
  adaptFormalCustomerVehicleWorkspace,
  fetchFormalCustomerVehicleWorkspace,
  fetchFormalVehicleSearch,
  type FormalVehicle,
} from "@/lib/customers/formal-customer-vehicle-adapter";
import type { CustomerVehicleWorkspaceResponse, VehicleRecord } from "@/lib/customers/types";
import type { InspectionCreationAttempt, InspectionCreationDraft } from "./inspection-creation-recovery";
import {
  activeStaffForInspectionTeam,
  normalizeInspectionPlateQuery,
  retainInspectorForTeam,
} from "@/lib/orders/formal-inspection-intake";

type SelectedVehicle = { id: number; title: string; detail: string };

type InspectionChoice = {
  value: string;
  label: string;
  description?: string;
};

type InspectionChoiceCardsProps = {
  ariaLabel: string;
  choices: InspectionChoice[];
  value: string;
  disabled?: boolean;
  onSelect(value: string): void;
};

export function InspectionChoiceCards({
  ariaLabel,
  choices,
  value,
  disabled = false,
  onSelect,
}: InspectionChoiceCardsProps) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value || "none"}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onSelect(choice.value)}
            className={`group flex min-h-16 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? "border-primary bg-primary-50/80 dark:bg-primary/15"
                : "border-line bg-surface/70 hover:border-primary/45 hover:bg-primary-50/40 dark:hover:bg-primary/10"
            }`}
          >
            <span className="min-w-0">
              <span className={`block truncate text-sm font-bold ${selected ? "text-primary" : "text-ink"}`}>{choice.label}</span>
              {choice.description ? <span className="mt-1 block truncate text-[11px] text-ink-soft dark:text-slate-300">{choice.description}</span> : null}
            </span>
            <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors ${selected ? "border-primary bg-primary text-white" : "border-line bg-white text-transparent dark:bg-slate-800"}`}>
              <Check size={14} strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function vehicleChoice(vehicle: FormalVehicle): SelectedVehicle {
  return {
    id: vehicle.id,
    title: vehicle.plateDisplay ?? vehicle.vehicleNo,
    detail: [vehicle.makeZh ?? vehicle.make, vehicle.modelZh ?? vehicle.model, vehicle.vin]
      .filter(Boolean)
      .join(" · "),
  };
}

type FormalInspectionCreateDialogProps = {
  vehicleId?: number;
  sourceBusinessOrderId?: number;
  vehicleLabel?: string;
  submitLabel?: string;
  initialDraft?: InspectionCreationDraft;
  onBackgroundStatus?(attempt: InspectionCreationAttempt): void;
  onClose(): void;
  onCreated(report: FormalInspectionReport, context?: { background: boolean }): void | Promise<void>;
};

export function FormalInspectionCreateDialog({
  vehicleId,
  sourceBusinessOrderId,
  vehicleLabel,
  submitLabel = "创建检查结果",
  initialDraft,
  onBackgroundStatus,
  onClose,
  onCreated,
}: FormalInspectionCreateDialogProps) {
  const [teams, setTeams] = useState<FormalRepairTeam[]>([]);
  const [staff, setStaff] = useState<FormalStaffMember[]>([]);
  const [inspectionTeamId, setInspectionTeamId] = useState(initialDraft?.inspectionTeamId ?? "");
  const [inspectorId, setInspectorId] = useState(initialDraft?.inspectorId ?? "");
  const [summaryZh, setSummaryZh] = useState(initialDraft?.summaryZh ?? "");
  const [specialCaseNotesZh, setSpecialCaseNotesZh] = useState(initialDraft?.specialCaseNotesZh ?? "");
  const [plateQuery, setPlateQuery] = useState(initialDraft?.plateQuery ?? "");
  const [vehicleSearchRetry, setVehicleSearchRetry] = useState(0);
  const [vehicleSearchResponse, setVehicleSearchResponse] = useState<{ key: string; vehicles: FormalVehicle[]; error: string | null } | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<SelectedVehicle | null>(initialDraft?.selectedVehicle ?? null);
  const normalizedPlateQuery = normalizeInspectionPlateQuery(plateQuery);
  const vehicleSearchKey = JSON.stringify([normalizedPlateQuery, vehicleSearchRetry]);
  const currentSearch = vehicleSearchResponse?.key === vehicleSearchKey ? vehicleSearchResponse : null;
  const searching = Boolean(normalizedPlateQuery) && !currentSearch;
  const vehicleResults = currentSearch?.vehicles ?? [];
  const vehicleSearchError = currentSearch?.error ?? null;
  const [vehicleCreateOpen, setVehicleCreateOpen] = useState(false);
  const [vehicleWorkspace, setVehicleWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [loadingVehicleWorkspace, setLoadingVehicleWorkspace] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const closed = useRef(false);
  const attempt = useRef<InspectionCreationAttempt | null>(null);
  const committed = useRef<FormalInspectionReport | null>(null);
  const [createdReport, setCreatedReport] = useState<FormalInspectionReport | null>(null);
  const [openResultError, setOpenResultError] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingCloseOpen, setPendingCloseOpen] = useState(false);
  const [error, setError] = useState<string | null>(initialDraft?.error ?? null);
  const [masterRetry, setMasterRetry] = useState(0);
  const [masterResponse, setMasterResponse] = useState<{ attempt: number; error: string | null } | null>(null);
  const currentMaster = masterResponse?.attempt === masterRetry ? masterResponse : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchFormalMasterData()
      .then((data) => {
        if (!active) return;
        setTeams(data.teams.filter((team) => team.isActive));
        setStaff(data.staff.filter((member) => member.status === "active"));
        setMasterResponse({ attempt: masterRetry, error: null });
      })
      .catch((caught) => { if (active) setMasterResponse({ attempt: masterRetry, error: caught instanceof Error ? caught.message : "无法读取班组资料" }); });
    return () => { active = false; };
  }, [masterRetry]);

  useEffect(() => {
    if (vehicleId || selectedVehicle) return;
    const search = normalizedPlateQuery;
    if (!search) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchFormalVehicleSearch(search, controller.signal)
        .then((vehicles) => {
          if (!controller.signal.aborted) setVehicleSearchResponse({ key: vehicleSearchKey, vehicles, error: null });
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setVehicleSearchResponse({ key: vehicleSearchKey, vehicles: [], error: caught instanceof Error ? caught.message : "车辆搜索失败" });
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedPlateQuery, selectedVehicle, vehicleId, vehicleSearchKey]);

  const selectedTeamId = inspectionTeamId ? Number(inspectionTeamId) : null;
  const eligibleStaff = useMemo(
    () => activeStaffForInspectionTeam(staff, selectedTeamId),
    [selectedTeamId, staff],
  );
  const teamChoices = useMemo(
    () => teams.map((team) => {
      const activeMemberCount = activeStaffForInspectionTeam(staff, team.id).length;
      return {
        value: String(team.id),
        label: team.name,
        description: `${activeMemberCount} 名在职维修工`,
      };
    }),
    [staff, teams],
  );
  const inspectorChoices = useMemo<InspectionChoice[]>(
    () => [
      { value: "", label: "不指定维修工", description: "稍后补录或仅记录提交班组" },
      ...eligibleStaff.map((member) => ({
        value: String(member.id),
        label: member.fullName,
        description: member.positionLabel,
      })),
    ],
    [eligibleStaff],
  );
  const resolvedVehicleId = vehicleId ?? selectedVehicle?.id ?? null;
  const dirty = Boolean(plateQuery || selectedVehicle || inspectionTeamId || inspectorId || summaryZh || specialCaseNotesZh);
  const requestClose = () => {
    if (committed.current) { onClose(); return; }
    if (submitting.current) { setPendingCloseOpen(true); return; }
    if (loadingVehicleWorkspace || vehicleCreateOpen) return;
    if (discardOpen) setDiscardOpen(false);
    else if (dirty) setDiscardOpen(true);
    else onClose();
  };

  const selectTeam = (value: string) => {
    const nextTeamId = value ? Number(value) : null;
    setInspectionTeamId(value);
    setInspectorId((current) => retainInspectorForTeam(current, staff, nextTeamId));
  };

  const openVehicleCreate = async () => {
    setLoadingVehicleWorkspace(true);
    setError(null);
    try {
      const source = await fetchFormalCustomerVehicleWorkspace();
      setVehicleWorkspace(adaptFormalCustomerVehicleWorkspace(source));
      setVehicleCreateOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开车辆档案");
    } finally {
      setLoadingVehicleWorkspace(false);
    }
  };

  const useCreatedVehicle = async (vehicle: VehicleRecord) => {
    if (!vehicle.formalId) {
      setError("车辆已经保存，但没有返回正式车辆编号，请重新搜索车牌");
      return;
    }
    setSelectedVehicle({
      id: vehicle.formalId,
      title: vehicle.plate || vehicle.id,
      detail: [vehicle.makeZh ?? vehicle.make, vehicle.modelZh ?? vehicle.model, vehicle.vin]
        .filter(Boolean)
        .join(" · "),
    });
    setPlateQuery(vehicle.plate || normalizedPlateQuery);
    setVehicleCreateOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || committed.current || !resolvedVehicleId || !selectedTeamId || !summaryZh.trim()) return;
    submitting.current = true;
    const resolvedSourceBusinessOrderId = sourceBusinessOrderId ?? initialDraft?.sourceBusinessOrderId;
    attempt.current = { id: initialDraft?.recoveryAttemptId ?? attempt.current?.id ?? crypto.randomUUID(), status: "pending", draft: { inspectionTeamId, inspectorId, summaryZh, specialCaseNotesZh, plateQuery, selectedVehicle: selectedVehicle ?? { id: resolvedVehicleId, title: vehicleLabel ?? plateQuery, detail: "" }, sourceBusinessOrderId: resolvedSourceBusinessOrderId } };
    onBackgroundStatus?.(attempt.current);
    setBusy(true);
    setError(null);
    try {
      const report = await createFormalInspectionReport({
        vehicleId: resolvedVehicleId,
        ...(resolvedSourceBusinessOrderId ? { sourceBusinessOrderId: resolvedSourceBusinessOrderId } : {}),
        inspectionTeamId: selectedTeamId,
        actualInspectorStaffMemberId: inspectorId ? Number(inspectorId) : null,
        summaryZh,
        specialCaseNotesZh: specialCaseNotesZh.trim() || null,
        findings: [],
      });
      committed.current = report;
      const background = closed.current || !mounted.current;
      if (attempt.current) onBackgroundStatus?.({ ...attempt.current, status: "saved", report });
      if (!background) setCreatedReport(report);
      try {
        if (background) await onCreated(report, { background: true });
        else await onCreated(report);
      } catch {
        // A navigation/refresh failure cannot undo an already committed report.
        if (mounted.current && !closed.current) setOpenResultError(true);
      }
    } catch (caught) {
      if (attempt.current) onBackgroundStatus?.({ ...attempt.current, status: "unconfirmed", error: caught instanceof Error ? caught.message : "无法确认创建结果，请先核对列表" });
      if (mounted.current && !closed.current) setError(caught instanceof Error ? caught.message : "创建失败");
    } finally {
      submitting.current = false;
      if (mounted.current && !closed.current) {
        setBusy(false);
        setPendingCloseOpen(false);
      }
    }
  };

  return (
    <>
      <Dialog open title="新建检查结果" onClose={requestClose} closeLabel="关闭" mobileFullscreen className="sm:max-w-2xl">
        {createdReport ? <section className="p-5">
          <h3 role="status" className="text-base font-bold">检查结果已创建</h3>
          <p className="mt-2 font-mono text-sm">{createdReport.reportNo}</p>
          {openResultError ? <p role="alert" className="mt-2 text-sm text-amber-700">页面未能自动打开，记录已经保存。可以使用下面的入口继续。</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold">完成</button>
            <a href={`/orders/inspections/${createdReport.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-white">打开检查结果</a>
          </div>
        </section> : discardOpen ? <section className="p-5">
          <h3 className="text-base font-bold">放弃更改？</h3>
          <p className="mt-2 text-sm text-ink-soft">检查内容尚未保存。可以继续编辑，或放弃本次填写。</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-700">放弃更改</button>
            <button type="button" autoFocus onClick={() => setDiscardOpen(false)} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white">继续编辑</button>
          </div>
        </section> : <form onSubmit={submit} className="p-4 sm:p-5">
          <p className="text-xs text-ink-soft dark:text-slate-300">选择提交班组，记录本次实际检查结果。</p>
          <fieldset disabled={busy} className="min-w-0">

          {vehicleId && vehicleLabel ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-layer-2 p-3 text-sm font-semibold"><CarFront size={18} className="shrink-0 text-primary" />{vehicleLabel}</div> : null}
          {!vehicleId ? (
            <section className="mt-5 rounded-2xl border border-line p-4">
              <div className="flex items-center gap-2 text-sm font-bold"><CarFront size={17} className="text-primary" />车辆</div>
              {selectedVehicle ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary-50/50 px-3.5 py-3 dark:bg-primary/10">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{selectedVehicle.title}</div>
                    <div className="mt-1 truncate text-xs text-ink-soft dark:text-slate-300">{selectedVehicle.detail}</div>
                  </div>
                  <button type="button" onClick={() => { setSelectedVehicle(null); setPlateQuery(""); }} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-bold">更换</button>
                </div>
              ) : (
                <div className="relative mt-3">
                  <Search size={16} className="pointer-events-none absolute left-3 top-3 text-ink-soft" />
                  <input
                    autoFocus
                    role="combobox"
                    aria-label="输入车辆车牌号"
                    aria-expanded={Boolean(normalizedPlateQuery)}
                    aria-controls="inspection-vehicle-matches"
                    value={plateQuery}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPlateQuery(value);
                      setSelectedVehicle(null);
                      setError(null);
                    }}
                    placeholder="输入车牌号，实时显示匹配车辆"
                    className="min-h-11 w-full rounded-xl border border-line bg-white pl-10 pr-10 text-sm outline-none focus:border-primary dark:bg-slate-900"
                  />
                  {searching ? <LoaderCircle size={16} className="absolute right-3 top-3 animate-spin text-primary" /> : null}
                  {normalizedPlateQuery ? (
                    <div id="inspection-vehicle-results" className="mt-2 overflow-hidden rounded-xl border border-line bg-white dark:bg-slate-900">
                      {searching ? <p role="status" className="p-3 text-sm text-ink-soft">正在搜索车辆…</p> : null}
                      {vehicleSearchError ? <div role="alert" className="p-3 text-sm text-rose-700 dark:text-rose-300"><p>{vehicleSearchError}</p><button type="button" onClick={() => setVehicleSearchRetry((value) => value + 1)} className="mt-2 min-h-11 rounded-xl border border-line px-3 font-semibold">重新搜索车辆</button></div> : null}
                      <div id="inspection-vehicle-matches" role="listbox" aria-label="匹配车辆">
                      {vehicleResults.length > 0 ? vehicleResults.map((vehicle) => {
                        const choice = vehicleChoice(vehicle);
                        return (
                          <button key={vehicle.id} type="button" role="option" aria-selected="false" onClick={() => setSelectedVehicle(choice)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line px-3 text-left last:border-b-0 hover:bg-surface dark:hover:bg-slate-800">
                            <span className="min-w-0"><span className="block truncate text-sm font-bold">{choice.title}</span><span className="mt-0.5 block truncate text-xs text-ink-soft dark:text-slate-300">{choice.detail}</span></span>
                            <span className="shrink-0 text-xs font-bold text-primary">选择</span>
                          </button>
                        );
                      }) : null}
                      </div>
                      {!vehicleResults.length && !searching && !vehicleSearchError ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div><div className="text-sm font-bold">没有匹配车辆</div><div className="mt-1 text-xs text-ink-soft dark:text-slate-300">可用当前车牌新建正式车辆档案</div></div>
                          <button type="button" disabled={loadingVehicleWorkspace} onClick={() => void openVehicleCreate()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-bold text-white disabled:opacity-50"><Plus size={15} />{loadingVehicleWorkspace ? "正在打开…" : "新建车辆"}</button>
                        </div>
                      ) : null}
                    </div>
                  ) : <p className="mt-2 text-xs text-ink-soft dark:text-slate-300">输入车牌即可查找车辆。</p>}
                </div>
              )}
            </section>
          ) : null}

          <section className="mt-4 rounded-2xl border border-line p-4">
            <div className="text-xs font-semibold">提交班组 <span className="text-rose-600">*</span></div>
            <div className="mt-2">
              {!currentMaster ? <p role="status" className="py-3 text-sm text-ink-soft">正在读取班组资料…</p> : currentMaster.error ? <div role="alert" className="text-sm text-rose-700 dark:text-rose-300"><p>{currentMaster.error}</p><button type="button" onClick={() => setMasterRetry((value) => value + 1)} className="mt-2 min-h-11 rounded-xl border border-line px-3 font-semibold">重新加载班组</button></div> : teams.length === 0 ? <div className="text-sm text-ink-soft"><p>暂无启用的维修班组，请联系管理员在员工管理中维护班组，然后重新加载。</p><button type="button" onClick={() => setMasterRetry((value) => value + 1)} className="mt-2 min-h-11 rounded-xl border border-line px-3 font-semibold">重新加载班组</button></div> : null}
              <InspectionChoiceCards
                ariaLabel="提交班组"
                choices={teamChoices}
                value={inspectionTeamId}
                onSelect={selectTeam}
              />
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-line p-4">
            <div className="text-xs font-semibold">维修工姓名（可选）</div>
            <div className="mt-2">
              {selectedTeamId ? (
                <InspectionChoiceCards
                  ariaLabel="维修工姓名（可选）"
                  choices={inspectorChoices}
                  value={inspectorId}
                  onSelect={setInspectorId}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-line bg-surface/60 px-3.5 py-4 text-xs text-ink-soft dark:text-slate-300">先选择提交班组，再选择维修工。</div>
              )}
            </div>
          </section>

          <label className="mt-4 block text-xs font-semibold">检查结果 <span className="text-rose-600">*</span>
            <textarea required value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} placeholder="填写本次实际检查结果" className="mt-1.5 min-h-28 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-primary dark:bg-slate-900" />
          </label>
          <label className="mt-4 block text-xs font-semibold">特殊情况备注（可选）
            <textarea value={specialCaseNotesZh} onChange={(event) => setSpecialCaseNotesZh(event.target.value)} placeholder="仅在有特殊情况时填写" className="mt-1.5 min-h-20 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-primary dark:bg-slate-900" />
          </label>
          </fieldset>

          {error ? <div role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <p>{error}</p>
            <a href="/orders/inspections" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">打开检查结果列表核对（新标签页）</a>
          </div> : null}
          {busy ? <p role="status" className="mt-3 text-sm text-primary">正在创建检查结果，请稍候。保存完成后会自动返回。</p> : null}
          {busy && pendingCloseOpen ? <section role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <p>服务器仍在处理。关闭窗口不会撤销这次保存，请稍后到检查结果列表核对，避免重复创建。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" autoFocus onClick={() => setPendingCloseOpen(false)} className="min-h-11 rounded-xl border border-line px-3 font-semibold">继续等待</button>
              <button type="button" onClick={() => { closed.current = true; if (attempt.current) onBackgroundStatus?.(attempt.current); onClose(); }} className="min-h-11 rounded-xl border border-line px-3 font-semibold">关闭窗口，稍后核对</button>
            </div>
          </section> : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" disabled={busy} onClick={requestClose} className="min-h-11 rounded-xl border border-line px-4 text-xs font-bold disabled:opacity-45">取消</button>
            <button disabled={busy || !resolvedVehicleId || !selectedTeamId || !summaryZh.trim()} className="min-h-11 rounded-xl bg-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-45">{busy ? "创建中…" : submitLabel}</button>
          </div>
        </form>}
      </Dialog>

      {vehicleCreateOpen && vehicleWorkspace ? (
        <VehicleFormDialog
          mode="create"
          initialPlate={normalizedPlateQuery}
          customers={vehicleWorkspace.customers}
          relationships={[]}
          onClose={() => setVehicleCreateOpen(false)}
          onSaved={useCreatedVehicle}
        />
      ) : null}
    </>
  );
}
