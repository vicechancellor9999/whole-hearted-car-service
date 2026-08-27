"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import {
  fetchFormalPaymentWorkspace,
  formalPaymentStatus,
  type FormalPaymentStatus,
  type FormalPaymentWorkspace,
} from "@/lib/api/formal-payments";
import { FORMAL_DATA_CHANGED_EVENT } from "@/lib/formal-data-changes";
import { cn, formatDateTime, formatJMDFull } from "@/lib/utils";

function validPaymentStatus(value: string | null): value is "unpaid" | "partially_paid" | "paid" {
  return value === "unpaid" || value === "partially_paid" || value === "paid";
}

type PaymentRow = FormalPaymentWorkspace["items"][number];
type PaymentTransaction = FormalPaymentWorkspace["transactions"][number];

const FORMAL_BO_STATUS_LABELS: Record<string, string> = {
  waiting_assignment: "待派单",
  assigned: "已派单",
  in_repair: "维修中",
  return_pending_review: "回单待审核",
  formally_handed_off: "已交单",
};

const FORMAL_PAYMENT_STATUS_LABELS: Record<FormalPaymentStatus, string> = {
  unpaid: "未付款",
  partially_paid: "未付清",
  paid: "已付清",
};

function jamaicaBusinessDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function filterLedgerItemsForJamaicaDay<T extends Readonly<{ occurredAt: string }>>(
  items: ReadonlyArray<T>,
  now = new Date(),
): T[] {
  const today = jamaicaBusinessDate(now);
  return items.filter((item) => jamaicaBusinessDate(item.occurredAt) === today);
}

export function netCashReceived(
  items: ReadonlyArray<
    Readonly<{ kind: "payment"; amountJmd: number }>
    | Readonly<{ kind: "refund"; cashRefundJmd: number }>
    | Readonly<{ type: "payment" | "refund"; amountMinor: number }>
  >,
): number {
  return items.reduce((total, item) => {
    if ("type" in item) return total + (item.type === "payment" ? item.amountMinor : -item.amountMinor) / 100;
    return total + (item.kind === "payment" ? item.amountJmd : -item.cashRefundJmd);
  }, 0);
}

/** 全局收付款台账：查汇总、查逐笔事实，并从明确操作入口进入对应 Business Order 办理。 */
export function PaymentsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const todayOnly = searchParams.get("period") === "today";
  const paymentStatus = validPaymentStatus(searchParams.get("payment")) ? searchParams.get("payment") as "unpaid" | "partially_paid" | "paid" : undefined;

  const [items, setItems] = useState<PaymentRow[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const requestGenerationRef = useRef(0);

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    router.replace(`/payments${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  const openMoneyAction = useCallback((orderId: number, action: "pay" | "refund") => {
    router.push(`/orders/business/${encodeURIComponent(orderId)}?action=${action}`);
  }, [router]);

  const load = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const responseIsCurrent = () => requestGenerationRef.current === requestGeneration;
    setLoading(true);
    setError(null);
    try {
      const workspace = await fetchFormalPaymentWorkspace();
      if (!responseIsCurrent()) return;
      setItems(workspace.items);
      setTransactions(workspace.transactions);
    } catch (caught) {
      if (!responseIsCurrent()) return;
      setItems([]);
      setTransactions([]);
      setError(caught instanceof Error ? caught.message : "无法读取收付款工作区");
    } finally {
      if (!responseIsCurrent()) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestGenerationRef.current += 1; };
  }, [load, retry]);

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener(FORMAL_DATA_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener(FORMAL_DATA_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(({ order, ledger }) => {
      if (paymentStatus && formalPaymentStatus(ledger) !== paymentStatus) return false;
      if (!needle) return true;
      const haystack = [
        order.orderNo, order.payerDisplayName, order.payerPhone, order.vehiclePlate, order.vehicleDescription,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, paymentStatus, search]);

  const totals = useMemo(() => {
    return {
      receivable: filtered.reduce((sum, row) => sum + row.ledger.currentDueMinor, 0),
      paid: filtered.reduce((sum, row) => sum + row.ledger.totalPaidMinor - row.ledger.totalRefundedMinor, 0),
      balance: filtered.reduce((sum, row) => sum + row.ledger.balanceMinor, 0),
    };
  }, [filtered]);

  const visibleLedgerItems = useMemo(() => {
    return todayOnly ? filterLedgerItemsForJamaicaDay(transactions) : transactions;
  }, [transactions, todayOnly]);
  const todayNetReceived = useMemo(() => netCashReceived(visibleLedgerItems), [visibleLedgerItems]);
  const todayNetReceivedLabel = todayNetReceived < 0
    ? `−${formatJMDFull(Math.abs(todayNetReceived))}`
    : formatJMDFull(todayNetReceived);
  const todaySensitiveRefunds = useMemo(() => visibleLedgerItems.filter((item) => item.type === "refund"), [visibleLedgerItems]);

  // 有欠账客户 = 已交单且未结清的客户数。
  const extraCounts = useMemo(() => {
    const debtCustomers = new Set<string>();
    for (const { order, ledger } of items) {
      if (order.status === "formally_handed_off" && ledger.balanceMinor > 0) debtCustomers.add(order.payerKey);
    }
    return { debtCustomers: debtCustomers.size };
  }, [items]);

  const statusBadge = (paymentStatusValue: FormalPaymentStatus) => {
    const label = FORMAL_PAYMENT_STATUS_LABELS[paymentStatusValue];
    const tone = paymentStatusValue === "paid" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : paymentStatusValue === "partially_paid" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
    return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", tone)}>{label}</span>;
  };

  return (
    <div data-testid="payments-workspace" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <PageHeader
          breadcrumb={todayOnly ? "经营概览 · 今日净收款" : "收付款台账"}
          title={todayOnly ? "今日净收款明细" : "收付款台账"}
          description={todayOnly
            ? "仅显示今天实际发生的逐笔收款与退款；今日净收款等于收款减去退款。"
            : "全局查看每张 Business Order 的应收、逐笔收款、逐笔退款与未结余额，并从本页直接发起对应操作。"}
        />

        {todayOnly ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,360px)_minmax(180px,260px)_1fr]">
            <div data-testid="payments-today-net" className="rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[11px] font-semibold text-ink-soft dark:text-slate-400">今日净收款</div>
              <div className={cn("mt-1 text-2xl font-bold tabular-nums", todayNetReceived < 0 ? "text-rose-600" : "text-emerald-600")}>{todayNetReceivedLabel}</div>
            </div>
            <div data-testid="payments-today-count" className="rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[11px] font-semibold text-ink-soft dark:text-slate-400">今日记录</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-ink dark:text-slate-100">{visibleLedgerItems.length} 笔</div>
            </div>
            <div className="flex items-center justify-end">
              <button type="button" onClick={() => router.push("/payments")} className="min-h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-primary hover:border-primary-300 dark:border-slate-700 dark:bg-slate-800">查看全部收付款</button>
            </div>
          </div>
        ) : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div data-testid="payments-summary-receivable" className="rounded-xl border border-line bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">应收合计</div>
            <div className="mt-1 text-base font-bold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(totals.receivable / 100)}</div>
          </div>
          <div data-testid="payments-summary-paid" className="rounded-xl border border-line bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">已收合计</div>
            <div className="mt-1 text-base font-bold tabular-nums text-emerald-600">{formatJMDFull(totals.paid / 100)}</div>
          </div>
          <div data-testid="payments-summary-balance" className="rounded-xl border border-line bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">待收余额</div>
            <div className="mt-1 text-base font-bold tabular-nums text-rose-600">{formatJMDFull(totals.balance / 100)}</div>
          </div>
          <div data-testid="payments-summary-debt-customers" className="rounded-xl border border-line bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">有欠账客户</div>
            <div className="mt-1 text-base font-bold tabular-nums text-rose-600">{extraCounts.debtCustomers}</div>
          </div>
        </div>}

        {!loading && !error ? (
          <section data-testid="payments-ledger" className="mt-3 rounded-[22px] border border-line bg-white/80 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/40 sm:p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-ink dark:text-slate-100">{todayOnly ? "今天发生的逐笔记录" : "独立收款记录 · 独立退款记录"}</h2>
                <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">每一次收款或退款都是一条独立记录，不合并、不覆盖。</p>
              </div>
              <span className="text-xs font-semibold text-ink-soft dark:text-slate-300">{visibleLedgerItems.length} 笔记录</span>
            </div>
            {visibleLedgerItems.length === 0 ? (
              <div data-testid="payments-today-empty" className="mt-3 rounded-xl border border-dashed border-line py-12 text-center text-sm text-ink-soft dark:border-slate-700">今天尚未发生收款或退款。</div>
            ) : <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {visibleLedgerItems.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  data-testid={`payments-ledger-row-${item.id}`}
                  className="flex min-h-[78px] w-full items-start justify-between gap-3 rounded-xl border border-line bg-white px-3 py-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/30 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-primary-500"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            item.type === "payment"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
                      )}>{item.type === "payment" ? "收款" : "退款"}</span>
                      <span className="font-mono text-[11px] font-semibold text-ink dark:text-slate-100">{item.businessOrderNo}</span>
                    </span>
                    <span className="mt-1.5 block text-xs text-ink-soft dark:text-slate-300">
                      {item.type === "payment"
                        ? `独立收款 ${formatJMDFull(item.amountMinor / 100)}`
                        : `实际退款 ${formatJMDFull(item.amountMinor / 100)}`}
                    </span>
                    {item.type === "refund" && item.note ? (
                      <span className="mt-1 block truncate text-[10px] text-ink-faint dark:text-slate-500">
                        {item.note}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right text-[10px] text-ink-faint dark:text-slate-500">
                    <span className="block">{item.referenceNo}</span>
                    <span className="mt-1 block">{formatDateTime(item.occurredAt)}</span>
                    {item.type === "payment" && item.receiptId !== null ? (
                      <button
                        type="button"
                        data-testid={`payments-ledger-receipt-${item.id}`}
                        onClick={() => router.push(`/orders/business/${item.businessOrderId}/receipt/${item.receiptId}/print`)}
                        className="mt-1 min-h-7 rounded-md border border-primary-200 px-2 font-semibold text-primary hover:bg-primary-50 dark:border-primary-800 dark:hover:bg-primary-500/10"
                      >
                        打开 Receipt
                      </button>
                    ) : item.type === "refund" ? (
                      <button
                        type="button"
                        data-testid={`payments-ledger-refund-${item.id}`}
                        onClick={() => router.push(`/orders/business/${item.businessOrderId}/refund/${item.id}/print`)}
                        className="mt-1 min-h-7 rounded-md border border-rose-200 px-2 font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-500/10"
                      >
                        打开退款说明与签收单
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => router.push(`/orders/business/${item.businessOrderId}`)}
                      className="min-h-7 rounded-md border border-line px-2 font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300"
                    >
                      查看 Business Order
                    </button>
                  </span>
                </div>
              ))}
            </div>}
          </section>
        ) : null}

        {todayOnly && !loading && !error ? (
          <section data-testid="payments-today-sensitive" className="mt-3 rounded-[22px] border border-rose-200 bg-rose-50/55 p-3 shadow-card dark:border-rose-500/30 dark:bg-rose-500/5 sm:p-4">
            <div className="flex items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-rose-800 dark:text-rose-300">今日敏感操作</h2>
                <p className="mt-1 text-[11px] text-rose-700/75 dark:text-rose-300/70">退款必须具体记录车辆、操作人、原因和金额。</p>
              </div>
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">{todaySensitiveRefunds.length} 笔退款</span>
            </div>
            {todaySensitiveRefunds.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-rose-200 bg-white/70 py-8 text-center text-sm text-ink-soft dark:border-rose-500/20 dark:bg-slate-900/30">今天没有退款敏感操作。</p>
            ) : (
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {todaySensitiveRefunds.map((item) => (
                  <article key={item.id} data-testid={`payments-sensitive-refund-${item.id}`} className="rounded-xl border border-rose-200 bg-white p-3 dark:border-rose-500/25 dark:bg-slate-800/70">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="font-mono text-xs text-ink dark:text-slate-100">{item.businessOrderNo} · {item.vehiclePlate}</b>
                      <b className="text-sm text-rose-700 dark:text-rose-300">−{formatJMDFull(item.amountMinor / 100)}</b>
                    </div>
                    <p className="mt-2 text-xs text-ink dark:text-slate-200">{item.note ?? "未填写退款原因"}</p>
                    <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">{item.referenceNo} · {item.methodLabelZh} · {formatDateTime(item.occurredAt)}</p>
                    <button type="button" onClick={() => router.push(`/orders/business/${item.businessOrderId}/refund/${item.id}/print`)} className="mt-2 min-h-8 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300">
                      打开退款说明与签收单
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {!todayOnly ? <section className="mt-3 rounded-[22px] border border-line bg-white/75 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(260px,1fr)_180px]">
            <label className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <span className="sr-only">搜索收付款</span>
              <input
                data-testid="payments-search"
                value={search}
                onChange={(event) => updateQuery({ search: event.target.value || null })}
                placeholder="搜索客户、电话、车牌、单号"
                className="min-h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <select aria-label="付款状态" value={paymentStatus ?? ""} onChange={(event) => updateQuery({ payment: event.target.value || null })}
              className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm dark:bg-slate-800">
              <option value="">全部付款状态</option>
              <option value="unpaid">未付款</option>
              <option value="partially_paid">未付清</option>
              <option value="paid">已付清</option>
            </select>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-soft dark:text-slate-400">
            <span data-testid="payments-count">{filtered.length} 张业务单</span>
            {search || paymentStatus ? <button type="button" onClick={() => router.replace("/payments")} className="font-semibold text-primary">清除筛选</button> : null}
          </div>

          {loading ? <div data-testid="payments-loading" className="mt-3 h-[360px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
          {error ? (
            <div className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center dark:border-rose-500/30">
              <AlertCircle className="text-rose-600" />
              <p className="mt-2 text-sm font-semibold">收付款工作区读取失败</p>
              <p className="mt-1 text-xs text-ink-soft">{error}</p>
              <button type="button" data-testid="payments-retry" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
            </div>
          ) : null}
          {!loading && !error && filtered.length === 0 ? (
            <div data-testid="payments-empty" className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">没有符合条件的业务单。</div>
          ) : null}
          {!loading && !error && filtered.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-xl border border-line dark:border-slate-700">
              <table data-testid="payments-table" className="w-full table-fixed text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface text-[10px] text-ink-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2 font-semibold">业务单号</th>
                    <th className="px-3 py-2 font-semibold">客户 · 车辆</th>
                    <th className="px-3 py-2 font-semibold">工单状态</th>
                    <th className="px-3 py-2 font-semibold">付款状态</th>
                    <th className="px-3 py-2 text-right font-semibold">应收</th>
                    <th className="px-3 py-2 text-right font-semibold">已收</th>
                    <th className="px-3 py-2 text-right font-semibold">余额</th>
                    <th className="px-3 py-2 font-semibold">操作</th>
                    <th className="px-3 py-2 font-semibold">最近更新</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ order, ledger }) => (
                    <tr key={order.id} data-testid={`payment-row-${order.id}`}
                      className="border-b border-line/60 last:border-0 hover:bg-primary-50/40 dark:border-slate-700/60 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2.5 font-mono font-semibold text-ink dark:text-slate-100">{order.orderNo}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-ink dark:text-slate-100">{order.payerDisplayName || "—"}</div>
                        <div className="text-[10px] text-ink-soft dark:text-slate-400">{order.vehiclePlate || "—"}{order.payerPhone ? ` · ${order.payerPhone}` : ""}</div>
                      </td>
                      <td className="px-3 py-2.5 text-ink-soft dark:text-slate-300">
                        {FORMAL_BO_STATUS_LABELS[order.status] ?? order.status}
                      </td>
                      <td className="px-3 py-2.5">{statusBadge(formalPaymentStatus(ledger))}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(ledger.currentDueMinor / 100)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600">{formatJMDFull((ledger.totalPaidMinor - ledger.totalRefundedMinor) / 100)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", ledger.balanceMinor > 0 ? "text-rose-600" : "text-emerald-600")}>
                        {ledger.balanceMinor > 0 ? formatJMDFull(ledger.balanceMinor / 100) : "已结清"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button type="button" onClick={() => openMoneyAction(order.id, "pay")}
                            className="min-h-7 rounded-md bg-emerald-600 px-2 text-[10px] font-semibold text-white hover:bg-emerald-700">收款</button>
                          <button type="button" onClick={() => openMoneyAction(order.id, "refund")}
                            className="min-h-7 rounded-md border border-line px-2 text-[10px] font-semibold text-rose-600 hover:border-rose-300 dark:border-slate-600">退款</button>
                          <button type="button" onClick={() => router.push(`/orders/business/${encodeURIComponent(order.id)}`)}
                            className="min-h-7 rounded-md border border-line px-2 text-[10px] font-semibold text-primary hover:border-primary-300 dark:border-slate-600">查看本单</button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-ink-soft dark:text-slate-400">
                        <div>{formatDateTime(order.createdAt)}</div>
                        <div className="text-[10px]">{order.vehicleDescription}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section> : null}
      </div>

    </div>
  );
}
