"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { isMockApiEnabled } from "@/lib/api/client";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import { searchVehicles } from "@/lib/customers/selectors";
import { PageHeader } from "@/components/layout/page-header";
import { VehicleFormDialog } from "./form-dialogs";
import { FilterBar } from "./filter-bar";
import { VehicleList } from "./vehicle-list";
import {
  VehicleSummaryCards,
  vehicleMatchesSummaryFilter,
  type VehicleSummaryFilter,
} from "./vehicle-summary-cards";
import { currentSessionKey, errorMessage, loadWorkspace, reloadWorkspaceFresh } from "./detail-shared";
import { ArchivePagination, useArchivePageSize } from "./archive-pagination";

/** 车辆档案页：只显示车辆正式资料和真实归档内容；客户档案在 /customers。 */
export function VehiclesWorkspace() {
  // 订阅路由状态：pushState/popstate 身份切换时触发重渲染，sessionKey 随之刷新
  const searchParams = useSearchParams();
  void searchParams;
  const sessionKey = currentSessionKey();
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [workspaceSessionKey, setWorkspaceSessionKey] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = useArchivePageSize();

  useEffect(() => {
    if (isMockApiEnabled && sessionKey === "anonymous") {
      setWorkspaceLoading(true);
      setWorkspaceError(null);
      setWorkspace(null);
      setWorkspaceSessionKey(null);
      return;
    }
    let active = true;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    void loadWorkspace().then((response) => {
      if (!active) return;
      setWorkspace(response);
      setWorkspaceSessionKey(sessionKey);
      setWorkspaceLoading(false);
    }).catch((error) => {
      if (!active) return;
      setWorkspaceSessionKey(sessionKey);
      setWorkspaceError(errorMessage(error));
      setWorkspaceLoading(false);
    });
    return () => { active = false; };
  }, [reloadSequence, sessionKey]);

  const visibleWorkspace = workspaceSessionKey === sessionKey ? workspace : null;

  const customersById = useMemo(
    () => new Map((visibleWorkspace?.customers ?? []).map((customer) => [customer.id, customer])),
    [visibleWorkspace],
  );

  const filteredVehicles = useMemo(() => {
    if (!visibleWorkspace) return [];
    let records = searchVehicles(visibleWorkspace, query);
    if (filters.make && filters.make !== "all") records = records.filter((vehicle) => vehicle.make === filters.make);
    if (filters.status && filters.status !== "all") records = records.filter((vehicle) => vehicle.status === filters.status);
    const summaryFilter = (filters.summary as VehicleSummaryFilter | undefined) ?? "all";
    records = records.filter((vehicle) => vehicleMatchesSummaryFilter(
      vehicle,
      visibleWorkspace.relationships,
      summaryFilter,
    ));
    return records;
  }, [filters, query, visibleWorkspace]);

  useEffect(() => {
    setPage(1);
  }, [filters, query]);

  const pageCount = Math.max(1, Math.ceil(filteredVehicles.length / pageSize));
  const visiblePage = Math.min(page, pageCount);
  const paginatedVehicles = filteredVehicles.slice(
    (visiblePage - 1) * pageSize,
    visiblePage * pageSize,
  );

  const refreshFromSource = useCallback(async () => {
    try {
      const nextWorkspace = await reloadWorkspaceFresh();
      setWorkspace(nextWorkspace);
      setWorkspaceSessionKey(currentSessionKey());
      setPage(Math.max(1, Math.ceil(nextWorkspace.vehicles.length / pageSize)));
      setCreating(false);
    } catch (error) {
      setCreating(false);
      setWorkspace(null);
      setWorkspaceError(`保存成功，但刷新失败：${errorMessage(error)}`);
    }
  }, [pageSize]);

  return (
    <div data-testid="vehicles-page" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto w-full min-w-0 max-w-[1320px] shrink-0">
        <PageHeader
          breadcrumb="客户与车辆管理"
          title="车辆档案"
          titleTestId="vehicles-heading"
          description="维护车辆正式资料、当前客户关系、照片档案、零件需求与车辆任务。"
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              data-testid="create-vehicle-btn"
              disabled={!visibleWorkspace}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={15} aria-hidden />
              新建车辆
            </button>
          }
        />
      </div>
      <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-[1320px] flex-1 flex-col overflow-hidden rounded-2xl border border-[#dbe5f3] bg-[var(--wh-page-bg)] shadow-card dark:border-slate-700">
        {visibleWorkspace ? (
          <>
            <div className="border-b border-line px-3 py-3 sm:px-5">
              <VehicleSummaryCards
                vehicles={visibleWorkspace.vehicles}
                relationships={visibleWorkspace.relationships}
                activeFilter={(filters.summary as VehicleSummaryFilter | undefined) ?? "all"}
                onFilterChange={(summary) => setFilters((previous) => ({
                  ...previous,
                  summary,
                  ...(summary === "on_site" || summary === "off_site" ? { status: "all" } : {}),
                }))}
              />
            </div>
            <div className="border-b border-line px-3 py-3 sm:px-5">
              <FilterBar
                mode="vehicles"
                query={query}
                onQueryChange={setQuery}
                filters={filters}
                onFilterChange={(key, value) => setFilters((previous) => ({ ...previous, [key]: value }))}
                onReset={() => { setQuery(""); setFilters({}); }}
                vehicleMakes={[...new Set(visibleWorkspace.vehicles.map((vehicle) => vehicle.make))].sort()}
              />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3 sm:p-5">
              <VehicleList vehicles={paginatedVehicles} customersById={customersById} relationships={visibleWorkspace.relationships} />
            </div>
            <ArchivePagination page={visiblePage} total={filteredVehicles.length} onPageChange={setPage} testIdPrefix="vehicle" pageSize={pageSize} />
          </>
        ) : workspaceLoading ? (
          <div data-testid="vehicle-workspace-loading" role="status" className="p-12 text-center text-sm text-ink-soft dark:text-slate-400">正在读取车辆资料…</div>
        ) : (
          <div data-testid="vehicle-workspace-error" role="alert" className="p-8 text-center">
            <p className="text-sm font-semibold text-danger">{workspaceError}</p>
            <button type="button" data-testid="vehicle-workspace-retry" onClick={() => setReloadSequence((value) => value + 1)} className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white">重试</button>
          </div>
        )}
      </div>

      {visibleWorkspace && creating ? (
        <VehicleFormDialog mode="create" customers={visibleWorkspace.customers} relationships={[]} onClose={() => setCreating(false)} onSaved={() => refreshFromSource()} />
      ) : null}
    </div>
  );
}
