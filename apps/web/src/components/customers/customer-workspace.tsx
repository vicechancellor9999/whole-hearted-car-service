"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Car, Plus, UserPlus, Users } from "lucide-react";
import { isFormalCustomerVehicleApiEnabled, isMockApiEnabled } from "@/lib/api/client";
import type {
  CustomerVehicleWorkspaceResponse,
} from "@/lib/customers/types";
import {
  deriveCustomerRiskLevel,
  searchCustomers,
  searchVehicles,
} from "@/lib/customers/selectors";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { VehicleFormDialog } from "./form-dialogs";
import { CustomerOnboardingDialog } from "./customer-onboarding-dialog";
import { FormalCustomerCreateDialog } from "./formal-customer-create-dialog";
import { CustomerList } from "./customer-list";
import { FilterBar } from "./filter-bar";
import { SummaryCards } from "./summary-cards";
import { VehicleList } from "./vehicle-list";
import { currentSessionKey, errorMessage, loadWorkspace } from "./detail-shared";

type ViewMode = "customers" | "vehicles";
type FormMode = null | "customer-create" | "vehicle-create";

const FORM_HISTORY_KEY = "__whCustomerVehicleForm";

export function CustomerWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsString = searchParams.toString();
  const rawView = searchParams.get("view");
  const view: ViewMode = rawView === "vehicles" ? "vehicles" : "customers";
  const sessionKey = currentSessionKey();

  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [workspaceSessionKey, setWorkspaceSessionKey] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [queries, setQueries] = useState<Record<ViewMode, string>>(() => ({ customers: "", vehicles: "" }));
  const [filtersByView, setFiltersByView] = useState<Record<ViewMode, Record<string, string>>>(() => ({ customers: {}, vehicles: {} }));
  const [formMode, setFormMode] = useState<FormMode>(null);

  const openForm = useCallback((mode: Exclude<FormMode, null>) => {
    const state = window.history.state;
    if (!state || typeof state !== "object" || state[FORM_HISTORY_KEY] !== true) {
      window.history.pushState({ ...(state && typeof state === "object" ? state : {}), [FORM_HISTORY_KEY]: true }, "", window.location.href);
    }
    setFormMode(mode);
  }, []);

  const closeForm = useCallback(() => {
    const state = window.history.state;
    const consumeHistoryEntry = Boolean(state && typeof state === "object" && state[FORM_HISTORY_KEY] === true);
    setFormMode(null);
    if (consumeHistoryEntry) window.requestAnimationFrame(() => window.history.back());
  }, []);

  useEffect(() => {
    closeForm();
  }, [closeForm, sessionKey]);

  useEffect(() => {
    const canonical = new URLSearchParams(paramsString);
    let changed = false;
    if (rawView !== "customers" && rawView !== "vehicles") {
      canonical.set("view", "customers");
      changed = true;
    }
    if (canonical.has("customer") || canonical.has("vehicle")) {
      canonical.delete("customer");
      canonical.delete("vehicle");
      changed = true;
    }
    if (changed) router.replace(`/customers?${canonical.toString()}`);
  }, [paramsString, rawView, router]);

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
    setWorkspace(null);
    setWorkspaceSessionKey(null);
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
  }, [reloadSequence, sessionKey, view]);

  const visibleWorkspace = workspaceSessionKey === sessionKey ? workspace : null;
  const visibleWorkspaceLoading = workspaceSessionKey !== sessionKey || workspaceLoading;

  const updateQuery = useCallback((updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    const url = `/customers?${next.toString()}`;
    if (replace) router.replace(url);
    else router.push(url);
  }, [router, searchParams]);

  const customersById = useMemo(
    () => new Map((visibleWorkspace?.customers ?? []).map((customer) => [customer.id, customer])),
    [visibleWorkspace],
  );
  const vehicleCounts = useMemo(() => {
    const vehicleIds = new Map<string, Set<string>>();
    for (const relationship of visibleWorkspace?.relationships.filter((entry) => entry.endedAt === null) ?? []) {
      const current = vehicleIds.get(relationship.customerId) ?? new Set<string>();
      current.add(relationship.vehicleId);
      vehicleIds.set(relationship.customerId, current);
    }
    return new Map([...vehicleIds].map(([customerId, ids]) => [customerId, ids.size]));
  }, [visibleWorkspace]);

  const filteredCustomers = useMemo(() => {
    if (!visibleWorkspace) return [];
    const filters = filtersByView.customers;
    let records = searchCustomers(visibleWorkspace, queries.customers);
    if (filters.type && filters.type !== "all") records = records.filter((customer) => customer.customerType === filters.type);
    if (filters.risk && filters.risk !== "all") records = records.filter((customer) => deriveCustomerRiskLevel(customer) === filters.risk);
    if (filters.status && filters.status !== "all") records = records.filter((customer) => customer.status === filters.status);
    if (filters.channel && filters.channel !== "all") records = records.filter((customer) => customer.preferredChannel === filters.channel);
    return records;
  }, [filtersByView.customers, queries.customers, visibleWorkspace]);

  const filteredVehicles = useMemo(() => {
    if (!visibleWorkspace) return [];
    const filters = filtersByView.vehicles;
    let records = searchVehicles(visibleWorkspace, queries.vehicles);
    if (filters.make && filters.make !== "all") records = records.filter((vehicle) => vehicle.make === filters.make);
    if (filters.status && filters.status !== "all") records = records.filter((vehicle) => vehicle.status === filters.status);
    return records;
  }, [filtersByView.vehicles, queries.vehicles, visibleWorkspace]);

  const refreshFromSource = useCallback(async () => {
    if (currentSessionKey() !== sessionKey) return;
    try {
      const nextWorkspace = await loadWorkspace();
      if (currentSessionKey() !== sessionKey) return;
      setWorkspace(nextWorkspace);
      setWorkspaceSessionKey(sessionKey);
      closeForm();
    } catch (error) {
      if (currentSessionKey() !== sessionKey) return;
      closeForm();
      setWorkspace(null);
      setWorkspaceSessionKey(sessionKey);
      setWorkspaceLoading(false);
      setWorkspaceError(`保存成功，但刷新失败：${errorMessage(error)}`);
    }
  }, [closeForm, sessionKey]);

  const switchView = (next: ViewMode) => {
    updateQuery({ view: next });
  };

  return (
    <div data-testid="customers-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader
          breadcrumb="客户与车辆管理"
          title="客户与车辆"
          titleTestId="customers-heading"
          description="客户档案、车辆信息与历史关系的统一工作台"
          action={
            <button
              type="button"
              onClick={() => openForm(view === "customers" ? "customer-create" : "vehicle-create")}
              data-testid={`create-${view === "customers" ? "customer" : "vehicle"}-btn`}
              disabled={!visibleWorkspace}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {view === "customers" ? <UserPlus size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {view === "customers" ? "新建客户" : "新建车辆"}
            </button>
          }
        />
      </div>
      <div className="mx-auto min-w-0 max-w-[1320px] overflow-hidden rounded-2xl border border-[#dbe5f3] bg-[var(--wh-page-bg)] shadow-card dark:border-slate-700">
        {visibleWorkspace ? <div className="border-b border-line px-3 py-4 sm:px-5"><SummaryCards summary={visibleWorkspace.summary} /></div> : null}

        <nav data-testid="view-tabs" aria-label="切换视图" className="grid grid-cols-2 gap-2 border-b border-line px-3 py-3 sm:flex sm:px-5">
          {([
            { id: "customers" as const, label: "客户", icon: Users, count: filteredCustomers.length },
            { id: "vehicles" as const, label: "车辆", icon: Car, count: filteredVehicles.length },
          ]).map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button key={tab.id} type="button" data-testid={`tab-${tab.id}`} aria-pressed={active} onClick={() => switchView(tab.id)} className={cn(
                "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-4 text-xs font-semibold transition-colors",
                active ? "border-primary bg-primary text-white shadow-sm" : "border-line bg-white text-ink-soft hover:border-primary-200 hover:text-primary dark:bg-slate-800 dark:text-slate-300",
              )}>
                <Icon size={14} aria-hidden />{tab.label}
                <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums", active ? "bg-white/20" : "bg-gray-100 dark:bg-slate-700")}>{tab.count}</span>
              </button>
            );
          })}
        </nav>

        {visibleWorkspace ? (
          <>
            <div className="border-b border-line px-3 py-3 sm:px-5">
              <FilterBar
                mode={view}
                query={queries[view]}
                onQueryChange={(value) => setQueries((previous) => ({ ...previous, [view]: value }))}
                filters={filtersByView[view]}
                onFilterChange={(key, value) => setFiltersByView((previous) => ({
                  ...previous,
                  [view]: { ...previous[view], [key]: value },
                }))}
                onReset={() => {
                  setQueries((previous) => ({ ...previous, [view]: "" }));
                  setFiltersByView((previous) => ({ ...previous, [view]: {} }));
                }}
                vehicleMakes={[...new Set(visibleWorkspace.vehicles.map((vehicle) => vehicle.make))].sort()}
                formal={isFormalCustomerVehicleApiEnabled}
              />
            </div>
            <div className="min-w-0 overflow-hidden p-3 sm:p-5">
              {view === "customers"
                ? <CustomerList customers={filteredCustomers} vehicleCounts={vehicleCounts} formal={isFormalCustomerVehicleApiEnabled} />
                : <VehicleList vehicles={filteredVehicles} customersById={customersById} relationships={visibleWorkspace.relationships} />}
            </div>
          </>
        ) : visibleWorkspaceLoading ? (
          <div data-testid="customer-workspace-loading" role="status" className="p-12 text-center text-sm text-ink-soft dark:text-slate-400">正在读取客户与车辆资料…</div>
        ) : (
          <div data-testid="customer-workspace-error" role="alert" className="p-8 text-center">
            <p className="text-sm font-semibold text-danger">{workspaceError}</p>
            <button type="button" data-testid="customer-workspace-retry" onClick={() => setReloadSequence((value) => value + 1)} className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white">重试</button>
          </div>
        )}
      </div>

      {visibleWorkspace && formMode === "customer-create" ? (
        isFormalCustomerVehicleApiEnabled
          ? <FormalCustomerCreateDialog onClose={closeForm} onSaved={() => refreshFromSource()} />
          : <CustomerOnboardingDialog customers={visibleWorkspace.customers} onClose={closeForm} onSaved={() => refreshFromSource()} />
      ) : null}
      {visibleWorkspace && formMode === "vehicle-create" ? <VehicleFormDialog mode="create" customers={visibleWorkspace.customers} relationships={[]} onClose={closeForm} onSaved={() => refreshFromSource()} /> : null}
    </div>
  );
}
