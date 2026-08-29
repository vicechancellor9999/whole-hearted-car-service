"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { CarFront, LoaderCircle, Plus, Search, X } from "lucide-react";
import { VehicleFormDialog } from "@/components/customers/form-dialogs";
import { createFormalInspectionReport } from "@/lib/api/formal-inspections";
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
import {
  activeStaffForInspectionTeam,
  normalizeInspectionPlateQuery,
  retainInspectorForTeam,
} from "@/lib/orders/formal-inspection-intake";

type SelectedVehicle = { id: number; title: string; detail: string };

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
  onClose(): void;
  onCreated(): void;
};

export function FormalInspectionCreateDialog({
  vehicleId,
  sourceBusinessOrderId,
  onClose,
  onCreated,
}: FormalInspectionCreateDialogProps) {
  const [teams, setTeams] = useState<FormalRepairTeam[]>([]);
  const [staff, setStaff] = useState<FormalStaffMember[]>([]);
  const [inspectionTeamId, setInspectionTeamId] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  const [summaryZh, setSummaryZh] = useState("");
  const [specialCaseNotesZh, setSpecialCaseNotesZh] = useState("");
  const [plateQuery, setPlateQuery] = useState("");
  const [vehicleResults, setVehicleResults] = useState<FormalVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<SelectedVehicle | null>(null);
  const [searching, setSearching] = useState(false);
  const [vehicleCreateOpen, setVehicleCreateOpen] = useState(false);
  const [vehicleWorkspace, setVehicleWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [loadingVehicleWorkspace, setLoadingVehicleWorkspace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchFormalMasterData()
      .then((data) => {
        setTeams(data.teams.filter((team) => team.isActive));
        setStaff(data.staff.filter((member) => member.status === "active"));
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "无法读取班组资料"));
  }, []);

  useEffect(() => {
    if (vehicleId) return;
    const search = normalizeInspectionPlateQuery(plateQuery);
    if (!search) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetchFormalVehicleSearch(search, controller.signal)
        .then(setVehicleResults)
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "车辆搜索失败");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [plateQuery, vehicleId]);

  const selectedTeamId = inspectionTeamId ? Number(inspectionTeamId) : null;
  const eligibleStaff = useMemo(
    () => activeStaffForInspectionTeam(staff, selectedTeamId),
    [selectedTeamId, staff],
  );
  const resolvedVehicleId = vehicleId ?? selectedVehicle?.id ?? null;
  const normalizedPlateQuery = normalizeInspectionPlateQuery(plateQuery);

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
    if (!resolvedVehicleId || !selectedTeamId || !summaryZh.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createFormalInspectionReport({
        vehicleId: resolvedVehicleId,
        ...(sourceBusinessOrderId ? { sourceBusinessOrderId } : {}),
        inspectionTeamId: selectedTeamId,
        actualInspectorStaffMemberId: inspectorId ? Number(inspectorId) : null,
        summaryZh,
        specialCaseNotesZh: specialCaseNotesZh.trim() || null,
        findings: [],
      });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label="新建检查结果" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
        <form onSubmit={submit} className="max-h-[min(860px,calc(100vh-1.5rem))] w-full max-w-2xl overflow-y-auto rounded-[22px] border border-line bg-white p-5 shadow-card dark:bg-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold">新建正式检查结果</h2>
              <p className="mt-1 text-xs text-ink-soft dark:text-slate-300">选择提交班组，记录本次实际检查结果。</p>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line text-ink-soft hover:bg-surface dark:hover:bg-slate-700"><X size={16} /></button>
          </div>

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
                    aria-controls="inspection-vehicle-results"
                    value={plateQuery}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPlateQuery(value);
                      setSelectedVehicle(null);
                      setError(null);
                      if (!normalizeInspectionPlateQuery(value)) {
                        setVehicleResults([]);
                        setSearching(false);
                      }
                    }}
                    placeholder="输入车牌号，实时显示匹配车辆"
                    className="min-h-11 w-full rounded-xl border border-line bg-white pl-10 pr-10 text-sm outline-none focus:border-primary dark:bg-slate-900"
                  />
                  {searching ? <LoaderCircle size={16} className="absolute right-3 top-3 animate-spin text-primary" /> : null}
                  {normalizedPlateQuery ? (
                    <div id="inspection-vehicle-results" role="listbox" className="mt-2 overflow-hidden rounded-xl border border-line bg-white dark:bg-slate-900">
                      {vehicleResults.length > 0 ? vehicleResults.map((vehicle) => {
                        const choice = vehicleChoice(vehicle);
                        return (
                          <button key={vehicle.id} type="button" role="option" aria-selected="false" onClick={() => setSelectedVehicle(choice)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line px-3 text-left last:border-b-0 hover:bg-surface dark:hover:bg-slate-800">
                            <span className="min-w-0"><span className="block truncate text-sm font-bold">{choice.title}</span><span className="mt-0.5 block truncate text-xs text-ink-soft dark:text-slate-300">{choice.detail}</span></span>
                            <span className="shrink-0 text-xs font-bold text-primary">选择</span>
                          </button>
                        );
                      }) : !searching ? (
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

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold">提交班组 <span className="text-rose-600">*</span>
              <select required value={inspectionTeamId} onChange={(event) => selectTeam(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 dark:bg-slate-900">
                <option value="">选择提交班组</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold">维修工姓名（可选）
              <select value={inspectorId} onChange={(event) => setInspectorId(event.target.value)} disabled={!selectedTeamId} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 disabled:opacity-50 dark:bg-slate-900">
                <option value="">未填写</option>
                {eligibleStaff.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
              </select>
            </label>
          </div>

          <label className="mt-4 block text-xs font-semibold">检查结果 <span className="text-rose-600">*</span>
            <textarea required value={summaryZh} onChange={(event) => setSummaryZh(event.target.value)} placeholder="填写本次实际检查结果" className="mt-1.5 min-h-28 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-primary dark:bg-slate-900" />
          </label>
          <label className="mt-4 block text-xs font-semibold">特殊情况备注（可选）
            <textarea value={specialCaseNotesZh} onChange={(event) => setSpecialCaseNotesZh(event.target.value)} placeholder="仅在有特殊情况时填写" className="mt-1.5 min-h-20 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-primary dark:bg-slate-900" />
          </label>

          {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-line px-4 text-xs font-bold">取消</button>
            <button disabled={busy || !resolvedVehicleId || !selectedTeamId || !summaryZh.trim()} className="min-h-10 rounded-xl bg-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-45">{busy ? "创建中…" : vehicleId ? "创建并留在本单" : "创建检查结果"}</button>
          </div>
        </form>
      </div>

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
