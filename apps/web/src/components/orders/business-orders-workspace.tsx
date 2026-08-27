"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Plus, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { currentSessionKey, reloadWorkspaceFresh } from "@/components/customers/detail-shared";
import { api } from "@/lib/api/client";
import type {
  QuickOrderFinancialListResponse,
  QuickOrderFinancialReadModel,
  QuickOrderFinancialSource,
} from "@/lib/billing/quick-order-financial";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import {
  QUICK_BO_STATUS_LABELS,
  quickOrderCanonicalChargeLines,
  quickOrderRepairOverdueDays,
  quickOrderTotals,
  type QuickBoStatus,
  type QuickOrder,
} from "@/lib/orders/quick-order-types";
import { loadTeams, teamNameOf } from "@/lib/teams/team-dictionary";
import { cn, formatDateTime, formatJMDFull } from "@/lib/utils";
import { QuickOrderCreateDialog } from "./quick-order-create-dialog";

const STATUS_CHIPS: ReadonlyArray<{ value: QuickBoStatus; label: string }> = [
  { value: "pending_assign", label: "待派单" },
  { value: "assigned", label: "已派单" },
  { value: "in_repair", label: "维修中" },
  { value: "stalled", label: "停滞" },
  { value: "returned", label: "回单待审核" },
  { value: "submitted", label: "已交单" },
];

function validStatus(value: string | null): value is QuickBoStatus {
  return Boolean(value && Object.prototype.hasOwnProperty.call(QUICK_BO_STATUS_LABELS, value));
}

function lastEventAt(order: QuickOrder): string {
  return order.statusHistory.at(-1)?.at ?? order.createdAt;
}

type BusinessOrderRow = Readonly<{
  order: QuickOrder;
  financial: QuickOrderFinancialReadModel;
}>;

function financialSourceLabel(source: QuickOrderFinancialSource): string {
  if (source.kind === "legacy_quick") return "Business Order 收费记录";
  if (source.kind === "shared_uninvoiced") return "未开票 · 暂记应收";
  return `正式发票 · V${source.versionNo}`;
}

function joinBusinessOrders(
  rawOrders: ReadonlyArray<QuickOrder>,
  financialList: QuickOrderFinancialListResponse,
): BusinessOrderRow[] {
  if (rawOrders.length !== financialList.items.length) {
    throw new Error("业务单与财务读模型数量不一致，请刷新后重试");
  }
  const rawById = new Map<string, QuickOrder>();
  for (const order of rawOrders) {
    if (rawById.has(order.id)) throw new Error("业务单列表包含重复编号");
    rawById.set(order.id, order);
  }
  return financialList.items.map((financial) => {
    if (financial.revision !== financialList.revision) {
      throw new Error("业务单财务读模型版本不一致，请刷新后重试");
    }
    const order = rawById.get(financial.order.id);
    if (!order) throw new Error("业务单与财务读模型无法对应，请刷新后重试");
    rawById.delete(financial.order.id);
    return { order, financial };
  }).sort((left, right) => right.order.createdAt.localeCompare(left.order.createdAt));
}

/** 业务单列表（新 BO）：大白话建单 → AI 拆单；五状态 + 停滞；行点击进详情。 */
export function BusinessOrdersWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = validStatus(searchParams.get("status")) ? searchParams.get("status") as QuickBoStatus : undefined;
  const teams = loadTeams();
  const teamId = teams.some((team) => team.id === searchParams.get("teamId")) ? searchParams.get("teamId") ?? undefined : undefined;
  const search = searchParams.get("search") ?? "";

  const [items, setItems] = useState<BusinessOrderRow[]>([]);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [session, setSession] = useState<Readonly<{ key: string; epoch: number; role: string }> | null>(null);
  const requestGenerationRef = useRef(0);

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    router.replace(`/orders/business${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  const clearSessionBoundState = useCallback(() => {
    setItems([]);
    setWorkspace(null);
    setError(null);
    setLoading(true);
    setShowCreate(false);
  }, []);

  useEffect(() => {
    const syncSession = () => {
      requestGenerationRef.current += 1;
      clearSessionBoundState();
      const key = currentSessionKey();
      let role = "anonymous";
      try {
        const raw = window.localStorage.getItem("wh_session");
        const parsed = raw ? JSON.parse(raw) as { identity?: { role?: unknown } } : null;
        role = typeof parsed?.identity?.role === "string" ? parsed.identity.role : "anonymous";
      } catch {
        role = "invalid";
      }
      setSession((current) => ({ key, role, epoch: (current?.epoch ?? 0) + 1 }));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "wh_session") return;
      syncSession();
    };
    syncSession();
    window.addEventListener("storage", onStorage);
    window.addEventListener("popstate", syncSession);
    return () => {
      requestGenerationRef.current += 1;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("popstate", syncSession);
    };
  }, [clearSessionBoundState]);

  const load = useCallback(async () => {
    if (session === null) return;
    const capturedSessionKey = session.key;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const responseIsCurrent = () => (
      requestGenerationRef.current === requestGeneration
      && currentSessionKey() === capturedSessionKey
    );
    setLoading(true);
    setError(null);
    try {
      const [rawOrders, financialList, customerWorkspace] = await Promise.all([
        api.quickOrders.list(),
        api.quickOrderFinancials.list(),
        // 客户目录仅 superadmin/frontdesk_admin 可见；财务等身份看单不必然看得到客户资料
        reloadWorkspaceFresh().catch(() => null),
      ]);
      if (!responseIsCurrent()) return;
      setItems(joinBusinessOrders(rawOrders, financialList));
      setWorkspace(customerWorkspace);
    } catch (caught) {
      if (!responseIsCurrent()) return;
      setItems([]);
      setWorkspace(null);
      setError(caught instanceof Error ? caught.message : "无法读取业务单");
    } finally {
      if (!responseIsCurrent()) return;
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    return () => { requestGenerationRef.current += 1; };
  }, [load, retry]);

  const customerOf = useCallback((row: BusinessOrderRow) => workspace?.customers.find((customer) => (
    customer.id === row.financial.order.customerId
  )) ?? null, [workspace]);
  const vehicleOf = useCallback((row: BusinessOrderRow) => workspace?.vehicles.find((vehicle) => (
    vehicle.id === row.financial.order.vehicleId
  )) ?? null, [workspace]);

  const statusCounts = useMemo(() => {
    const counts = new Map<QuickBoStatus, number>();
    for (const item of items) {
      const financialOrder = item.financial.order;
      if (financialOrder.voidedAt !== null) continue; // 废除单不参与计数（2026-08-18 老板）
      counts.set(financialOrder.status, (counts.get(financialOrder.status) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
        return items.filter((item) => {
          const order = item.order;
          const financialOrder = item.financial.order;
          if (status && financialOrder.status !== status) return false;
          if (teamId && order.teamId !== teamId) return false;
          if (!needle) return true;
          const customer = customerOf(item);
          const vehicle = vehicleOf(item);
          const haystack = [
            financialOrder.businessOrderNo,
            customer?.nameZh, customer?.nameEn, customer?.organizationName, customer?.phone,
            vehicle?.plate, vehicle?.modelZh, vehicle?.model,
            quickOrderCanonicalChargeLines(order).map((row) => `${row.descZh} ${row.descEn}`).join(" "),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, search, status, teamId, customerOf, vehicleOf]);

  const hasFilters = Boolean(search || status || teamId);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, status, teamId]);

  const statusBadgeClass = (value: QuickBoStatus) =>
    value === "submitted" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : value === "stalled" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      : value === "returned" ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
      : "bg-primary-50 text-primary dark:bg-primary-500/10 dark:text-primary-300";

  return (
    <div data-testid="business-orders-workspace" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <PageHeader
          breadcrumb="工单管理"
          title="业务单"
          description="针对指定车辆新建业务单：前台大白话输入，AI 拆成工时/配件双语收费项，人工可改后确认生成。"
          action={session && (session.role === "superadmin" || session.role === "frontdesk_admin") ? (
            <button type="button" data-testid="business-orders-create" onClick={() => setShowCreate(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600">
              <Plus size={14} /> 新建业务单
            </button>
          ) : undefined}
        />

        <div data-testid="business-orders-status-counts" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => updateQuery({ status: null })}
            className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", !status ? "border-primary bg-primary text-white" : "border-line bg-white/75 text-ink-soft hover:border-primary-200 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300")}
          >
            全部 <span className="tabular-nums">{items.length}</span>
          </button>
          {STATUS_CHIPS.map((chip) => {
            const count = statusCounts.get(chip.value) ?? 0;
            const active = status === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                data-testid={`business-status-chip-${chip.value}`}
                onClick={() => updateQuery({ status: active ? null : chip.value })}
                className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", active ? "border-primary bg-primary text-white" : "border-line bg-white/75 text-ink-soft hover:border-primary-200 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300")}
              >
                {chip.label} <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>

        <section className="mt-3 rounded-[22px] border border-line bg-white/75 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-4">
          <div data-testid="business-orders-filters" className="grid gap-2 sm:grid-cols-[minmax(260px,1fr)_180px]">
            <label className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <span className="sr-only">搜索业务单</span>
              <input
                data-testid="business-orders-search"
                value={search}
                onChange={(event) => updateQuery({ search: event.target.value || null })}
                placeholder="搜索客户、电话、车牌、车型、单号或项目"
                className="min-h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <select aria-label="业务单班组" value={teamId ?? ""} onChange={(event) => updateQuery({ teamId: event.target.value || null })} className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm dark:bg-slate-800">
              <option value="">全部班组（含待派）</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-soft dark:text-slate-400">
            <span data-testid="business-orders-count">{filtered.length} 张业务单</span>
            {hasFilters ? <button type="button" onClick={() => router.replace("/orders/business")} className="font-semibold text-primary">清除筛选</button> : null}
          </div>

          {loading ? <div data-testid="business-orders-loading" className="mt-3 h-[360px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
          {error ? (
            <div className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center dark:border-rose-500/30">
              <AlertCircle className="text-rose-600" />
              <p className="mt-2 text-sm font-semibold">业务单读取失败</p>
              <p className="mt-1 text-xs text-ink-soft">{error}</p>
              <button type="button" data-testid="business-orders-retry" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
            </div>
          ) : null}
          {!loading && !error && filtered.length === 0 ? (
            <div data-testid="business-order-empty" className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">
              没有符合条件的业务单。
              {hasFilters ? <button type="button" onClick={() => router.replace("/orders/business")} className="ml-2 font-semibold text-primary">清除筛选</button> : null}
            </div>
          ) : null}
          {!loading && !error && filtered.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-xl border border-line dark:border-slate-700">
              <table data-testid="business-orders-table" className="w-full table-fixed text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface text-[10px] text-ink-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2 font-semibold">业务单号</th>
                    <th className="px-3 py-2 font-semibold">客户 · 车辆</th>
                    <th className="px-3 py-2 font-semibold">收费项目</th>
                    <th className="px-3 py-2 font-semibold">班组 · 经办</th>
                    <th className="px-3 py-2 font-semibold">状态</th>
                    <th className="px-3 py-2 text-right font-semibold">应收</th>
                    <th className="px-3 py-2 text-right font-semibold">余额</th>
                    <th className="px-3 py-2 font-semibold">最近更新</th>
                  </tr>
                </thead>
                <tbody>
                      {pageItems.map((item) => {
                        const order = item.order;
                        const financial = item.financial;
                        const financialOrder = financial.order;
                        const customer = customerOf(item);
                        const vehicle = vehicleOf(item);
                        const totals = quickOrderTotals(order);
                        const teamName = teamNameOf(order.teamId);
                        const chargeLines = quickOrderCanonicalChargeLines(order);
                        const pendingQuoteCount = chargeLines.filter((row) => row.pricingMode === "unit" && row.pendingQuote).length;
                        return (
                          <tr key={order.id} data-testid="business-order-row" data-order-id={order.id} data-voided={financialOrder.voidedAt !== null ? "true" : "false"}
                            onClick={() => router.push(`/orders/business/${order.id}`)}
                            className={cn("cursor-pointer border-b border-line/60 last:border-0 dark:border-slate-700/60", financialOrder.voidedAt !== null ? "bg-rose-50/50 opacity-70 hover:bg-rose-50/70 dark:bg-rose-500/5" : "hover:bg-primary-50/40 dark:hover:bg-slate-800/50")}>
                            <td className="px-3 py-2.5">
                              <div className="font-mono font-semibold text-ink dark:text-slate-100">{financialOrder.businessOrderNo}</div>
                              <div className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">建单 {formatDateTime(order.createdAt)} · {order.createdBy}</div>
                              <div
                                data-testid={`business-order-financial-source-${order.id}`}
                                data-source-kind={financial.source.kind}
                                className="mt-0.5 text-[10px] font-semibold text-primary/80 dark:text-primary-300/80"
                              >
                                {financialSourceLabel(financial.source)}
                              </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-ink dark:text-slate-100">
                            {customer?.nameZh ?? customer?.organizationName ?? customer?.nameEn ?? "—"}
                            {customer?.nameEn && customer.nameZh && customer.nameEn !== customer.nameZh ? <span className="ml-1 font-normal text-ink-soft dark:text-slate-400">/ {customer.nameEn}</span> : null}
                          </div>
                          <div className="text-[10px] text-ink-soft dark:text-slate-400">
                            {vehicle ? `${vehicle.plate}${vehicle.modelZh ? ` · ${vehicle.modelZh}` : ""}` : "—"}{customer?.phone ? ` · ${customer.phone}` : ""}
                          </div>
                        </td>
                        <td className="max-w-[240px] px-3 py-2.5">
                          <div className="truncate text-ink dark:text-slate-200" title={chargeLines.map((row) => row.descZh).join("、")}>
                            {chargeLines.map((row) => row.descZh).join("、") || "—"}
                          </div>
                          <div className="text-[10px] text-ink-soft dark:text-slate-400">
                            工时 {totals.laborJmd > 0 ? formatJMDFull(totals.laborJmd) : "0"} · 配件 {totals.partsJmd > 0 ? formatJMDFull(totals.partsJmd) : "0"}
                            {pendingQuoteCount > 0 ? ` · ${pendingQuoteCount} 项待报价` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                              <div className="font-semibold text-ink dark:text-slate-100">{teamName ?? "待派"}</div>
                              <div className="text-[10px] text-ink-soft dark:text-slate-400">{order.mechanicName ?? "—"}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              {financialOrder.voidedAt !== null ? (
                                <span data-testid="business-row-voided" className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">已作废</span>
                              ) : (
                                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", statusBadgeClass(financialOrder.status))}>
                                  {QUICK_BO_STATUS_LABELS[financialOrder.status]}
                                </span>
                              )}
                              {order.voidReason ? <div className="mt-0.5 max-w-[120px] truncate text-[10px] text-rose-600" title={order.voidReason}>作废原因：{order.voidReason}</div> : null}
                              {order.stallReason ? <div className="mt-0.5 max-w-[120px] truncate text-[10px] text-amber-600" title={order.stallReason}>{order.stallReason}</div> : null}
                              {(() => { const overdueDays = quickOrderRepairOverdueDays(order); return overdueDays > 0 ? <div className="mt-0.5 text-[10px] font-bold text-rose-600">超时 {overdueDays} 天</div> : null; })()}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(financial.ledger.receivableJmd)}</td>
                            <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", financial.ledger.balanceJmd > 0 ? "text-rose-600" : "text-emerald-600")}>
                              {financial.ledger.balanceJmd > 0 ? formatJMDFull(financial.ledger.balanceJmd) : "已结清"}
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-ink-soft dark:text-slate-400">
                              <div>{formatDateTime(lastEventAt(order))}</div>
                              <div className="text-[10px]">{order.statusHistory.at(-1)?.by ?? ""}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loading && !error && totalPages > 1 ? (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-line bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
              <span data-testid="business-orders-page" className="text-xs text-ink-soft dark:text-slate-400">第 {page} / {totalPages} 页 · 共 {filtered.length} 张</span>
              <div className="flex gap-2">
                <button type="button" data-testid="business-orders-prev" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="min-h-8 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-primary disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">← 上一页</button>
                <button type="button" data-testid="business-orders-next" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="min-h-8 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-primary disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">下一页 →</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {showCreate && <QuickOrderCreateDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}
