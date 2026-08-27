"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { api, isFormalCustomerVehicleApiEnabled, isMockApiEnabled } from "@/lib/api/client";
import type { LinkedOperationsState } from "@/lib/api/mock-orders";
import { debtByArchiveCustomer } from "@/lib/customers/debt";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import {
  deriveCustomerRiskLevel,
  deriveProfileCompleteness,
  searchCustomers,
} from "@/lib/customers/selectors";
import { PageHeader } from "@/components/layout/page-header";
import { formatJMDFull } from "@/lib/utils";
import { CustomerOnboardingDialog } from "./customer-onboarding-dialog";
import { FormalCustomerCreateDialog } from "./formal-customer-create-dialog";
import { CustomerList } from "./customer-list";
import { FilterBar } from "./filter-bar";
import { currentSessionKey, errorMessage, loadWorkspace, pendingVerificationCount, reloadWorkspaceFresh } from "./detail-shared";
import { ArchivePagination, useArchivePageSize } from "./archive-pagination";
import { loadFormalSafeLinkedOperations } from "@/lib/customers/formal-customer-vehicle-consumer";

type CardFilter = "all" | "risk" | "incomplete" | "verification" | "debt";

/** 客户档案页：只装客户，车辆档案在 /vehicles。 */
export function CustomersWorkspace() {
  // 订阅路由状态：pushState/popstate 身份切换时触发重渲染，sessionKey 随之刷新
  const searchParams = useSearchParams();
  void searchParams;
  const sessionKey = currentSessionKey();
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [linkedState, setLinkedState] = useState<LinkedOperationsState | null>(null);
  const [workspaceSessionKey, setWorkspaceSessionKey] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [creatingSessionKey, setCreatingSessionKey] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<CardFilter>("all");
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
    void loadFormalSafeLinkedOperations({
      formal: isFormalCustomerVehicleApiEnabled,
      load: () => api.debug.linkedOperationsState(),
    }).then((state) => { if (active) setLinkedState(state); });
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

  useEffect(() => {
    if (creating && creatingSessionKey !== sessionKey) {
      setCreating(false);
      setCreatingSessionKey(null);
    }
  }, [creating, creatingSessionKey, sessionKey]);

  const visibleWorkspace = workspaceSessionKey === sessionKey ? workspace : null;

  const vehicleCounts = useMemo(() => {
    const vehicleIds = new Map<string, Set<string>>();
    for (const relationship of visibleWorkspace?.relationships.filter((entry) => entry.endedAt === null) ?? []) {
      const current = vehicleIds.get(relationship.customerId) ?? new Set<string>();
      current.add(relationship.vehicleId);
      vehicleIds.set(relationship.customerId, current);
    }
    return new Map([...vehicleIds].map(([customerId, ids]) => [customerId, ids.size]));
  }, [visibleWorkspace]);

  /** 欠账：Invoice 权威来源，按手机号/姓名归并到档案客户（讨债对人不对车）。 */
  const debtByCustomer = useMemo(() => {
    if (!linkedState || !visibleWorkspace) return new Map<string, number>();
    return debtByArchiveCustomer(linkedState, visibleWorkspace.customers);
  }, [linkedState, visibleWorkspace]);

  const filteredCustomers = useMemo(() => {
    if (!visibleWorkspace) return [];
    let records = searchCustomers(visibleWorkspace, query);
    if (filters.type && filters.type !== "all") records = records.filter((customer) => customer.customerType === filters.type);
    if (filters.risk && filters.risk !== "all") records = records.filter((customer) => deriveCustomerRiskLevel(customer) === filters.risk);
    if (filters.status && filters.status !== "all") records = records.filter((customer) => customer.status === filters.status);
    if (filters.channel && filters.channel !== "all") records = records.filter((customer) => customer.preferredChannel === filters.channel);
    // 汇总卡筛选
    if (activeCard === "risk") records = records.filter((customer) => deriveCustomerRiskLevel(customer) !== "normal");
    if (activeCard === "incomplete") records = records.filter((customer) => deriveProfileCompleteness(customer) === "incomplete");
    if (activeCard === "verification") records = records.filter((customer) => pendingVerificationCount(customer) > 0);
    if (activeCard === "debt") records = records.filter((c) => (debtByCustomer.get(c.id) ?? 0) > 0)
      .sort((a, b) => (debtByCustomer.get(b.id) ?? 0) - (debtByCustomer.get(a.id) ?? 0));
    return records;
  }, [activeCard, debtByCustomer, filters, query, visibleWorkspace]);

  useEffect(() => {
    setPage(1);
  }, [activeCard, filters, query]);

  const pageCount = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const visiblePage = Math.min(page, pageCount);
  const paginatedCustomers = filteredCustomers.slice(
    (visiblePage - 1) * pageSize,
    visiblePage * pageSize,
  );

  const refreshFromSource = useCallback(async () => {
    const savedSessionKey = creatingSessionKey;
    if (!savedSessionKey || currentSessionKey() !== savedSessionKey) return;
    try {
      const nextWorkspace = await reloadWorkspaceFresh();
      if (currentSessionKey() !== savedSessionKey) return;
      setWorkspace(nextWorkspace);
      setWorkspaceSessionKey(savedSessionKey);
      setPage(Math.max(1, Math.ceil(nextWorkspace.customers.length / pageSize)));
      setCreating(false);
      setCreatingSessionKey(null);
    } catch (error) {
      if (currentSessionKey() !== savedSessionKey) return;
      setCreating(false);
      setCreatingSessionKey(null);
      setWorkspace(null);
      setWorkspaceSessionKey(savedSessionKey);
      setWorkspaceError(`保存成功，但刷新失败：${errorMessage(error)}`);
    }
  }, [creatingSessionKey, pageSize]);

  return (
    <div data-testid="customers-page" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto w-full min-w-0 max-w-[1320px] shrink-0">
        <PageHeader
          breadcrumb="客户与车辆管理"
          title="客户档案"
          titleTestId="customers-heading"
          description={isFormalCustomerVehicleApiEnabled
            ? "集中维护客户正式资料、启停状态与当前车辆关系。"
            : "集中维护客户正式资料、当前车辆关系、风险状态、挂账资格与可追溯的验证证据。"}
          action={
            <button
              type="button"
              onClick={() => { setCreatingSessionKey(currentSessionKey()); setCreating(true); }}
              data-testid="create-customer-btn"
              disabled={!visibleWorkspace}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus size={15} aria-hidden />
              新建客户
            </button>
          }
        />
      </div>
      <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-[1320px] flex-1 flex-col overflow-hidden rounded-2xl border border-[#dbe5f3] bg-[var(--wh-page-bg)] shadow-card dark:border-slate-700">
        {visibleWorkspace ? (
          <div className="border-b border-line px-3 py-4 sm:px-5">
            {(() => {
              const customers = visibleWorkspace.customers;
              const individuals = customers.filter((c) => c.customerType === "individual").length;
              const organizations = customers.length - individuals;
              const onSite = visibleWorkspace.vehicles.filter((v) => v.status === "on_site").length;
              if (isFormalCustomerVehicleApiEnabled) {
                const activeCustomers = customers.filter((customer) => customer.status === "active").length;
                const facts = [
                  { key: "all", label: "客户总数", value: customers.length, sub: "正式客户档案" },
                  { key: "active", label: "启用客户", value: activeCustomers, sub: `停用 ${customers.length - activeCustomers}` },
                  { key: "individual", label: "个人客户", value: individuals, sub: "个人档案" },
                  { key: "organization", label: "公司客户", value: organizations, sub: "公司账户" },
                ];
                return (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {facts.map((fact) => (
                      <div key={fact.key} className="rounded-xl border border-line bg-white p-3 text-left dark:border-slate-700 dark:bg-slate-800">
                        <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">{fact.label}</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-slate-100">{fact.value}</p>
                        <p data-testid="customer-card-subtext" className="mt-0.5 truncate text-[10px] text-ink-soft dark:text-slate-400">{fact.sub}</p>
                      </div>
                    ))}
                    <Link href="/vehicles" data-testid="customer-card-filter-vehicles" className="rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-primary-200 dark:border-slate-700 dark:bg-slate-800">
                      <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">车辆总数</p>
                      <p className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-slate-100">{visibleWorkspace.vehicles.length}</p>
                      <p data-testid="customer-card-subtext" className="mt-0.5 truncate text-[10px] text-ink-soft dark:text-slate-400">在场 {onSite} 辆 →</p>
                    </Link>
                  </div>
                );
              }
              const riskCount = customers.filter((customer) => deriveCustomerRiskLevel(customer) !== "normal").length;
              const incompleteCount = customers.filter((customer) => deriveProfileCompleteness(customer) === "incomplete").length;
              const verificationCount = customers.filter((customer) => pendingVerificationCount(customer) > 0).length;
              const debtTotal = [...debtByCustomer.values()].reduce((sum, value) => sum + value, 0);
              const cards: Array<{ key: CardFilter; label: string; value: string; sub: string; danger?: boolean }> = [
                { key: "all", label: "客户总数", value: `${customers.length}`, sub: `个人 ${individuals} · 机构 ${organizations}` },
                { key: "risk", label: "风险客户", value: `${riskCount}`, sub: "关注 / 高风险 / 黑名单", danger: riskCount > 0 },
                { key: "incomplete", label: "正式资料待完善", value: `${incompleteCount}`, sub: "姓名音译或联系方式待补" },
                { key: "verification", label: "验证证据待补", value: `${verificationCount}`, sub: "OTP / KYC / 协议", danger: verificationCount > 0 },
                { key: "debt", label: "有欠账", value: `${debtByCustomer.size}`, sub: `合计 ${formatJMDFull(debtTotal)}`, danger: debtTotal > 0 },
              ];
              return (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {cards.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      data-testid={`customer-card-filter-${card.key}`}
                      onClick={() => { setActiveCard(activeCard === card.key ? "all" : card.key); setPage(1); }}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        activeCard === card.key
                          ? "border-primary bg-white ring-1 ring-primary dark:border-primary-400 dark:bg-slate-800 dark:ring-primary-400"
                          : "border-line bg-white hover:border-primary-200 dark:border-slate-700 dark:bg-slate-800"
                      }`}
                    >
                      <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">{card.label}</p>
                      <p className={`mt-1 text-xl font-bold tabular-nums ${card.danger ? "text-rose-600 dark:text-rose-400" : "text-ink dark:text-slate-100"}`}>{card.value}</p>
                      <p data-testid="customer-card-subtext" className="mt-0.5 truncate text-[10px] text-ink-soft dark:text-slate-400">{card.sub}</p>
                    </button>
                  ))}
                  <Link
                    href="/vehicles"
                    data-testid="customer-card-filter-vehicles"
                    className="rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-primary-200 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">车辆总数</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-slate-100">{visibleWorkspace.vehicles.length}</p>
                    <p data-testid="customer-card-subtext" className="mt-0.5 truncate text-[10px] text-ink-soft dark:text-slate-400">在场 {onSite} 辆 →</p>
                  </Link>
                </div>
              );
            })()}
          </div>
        ) : null}
        {visibleWorkspace ? (
          <>
            <div className="border-b border-line px-3 py-3 sm:px-5">
              <FilterBar
                mode="customers"
                query={query}
                onQueryChange={setQuery}
                filters={filters}
                onFilterChange={(key, value) => setFilters((previous) => ({ ...previous, [key]: value }))}
                onReset={() => { setQuery(""); setFilters({}); }}
                vehicleMakes={[...new Set(visibleWorkspace.vehicles.map((vehicle) => vehicle.make))].sort()}
                formal={isFormalCustomerVehicleApiEnabled}
              />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3 sm:p-5">
              <CustomerList customers={paginatedCustomers} vehicleCounts={vehicleCounts} debtByCustomer={debtByCustomer} formal={isFormalCustomerVehicleApiEnabled} />
            </div>
            <ArchivePagination page={visiblePage} total={filteredCustomers.length} onPageChange={setPage} testIdPrefix="customer" pageSize={pageSize} />
          </>
        ) : workspaceLoading ? (
          <div data-testid="customer-workspace-loading" role="status" className="p-12 text-center text-sm text-ink-soft dark:text-slate-400">正在读取客户资料…</div>
        ) : (
          <div data-testid="customer-workspace-error" role="alert" className="p-8 text-center">
            <p className="text-sm font-semibold text-danger">{workspaceError}</p>
            <button type="button" data-testid="customer-workspace-retry" onClick={() => setReloadSequence((value) => value + 1)} className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white">重试</button>
          </div>
        )}
      </div>

      {visibleWorkspace && creating && creatingSessionKey === sessionKey ? (
        isFormalCustomerVehicleApiEnabled
          ? <FormalCustomerCreateDialog onClose={() => { setCreating(false); setCreatingSessionKey(null); }} onSaved={() => refreshFromSource()} />
          : <CustomerOnboardingDialog customers={visibleWorkspace.customers} onClose={() => { setCreating(false); setCreatingSessionKey(null); }} onSaved={() => refreshFromSource()} />
      ) : null}
    </div>
  );
}
