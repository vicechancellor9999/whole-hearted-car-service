"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { BUSINESS_ORDER_STATUSES, businessOrderListHref, parseBusinessOrderListFilters } from "@/lib/orders/business-order-list-filters";
import styles from "./business-order-list.module.css";
import {
  fetchFormalBusinessOrders,
  createFormalBusinessOrder,
  formatFormalMoney,
  formalBusinessOrderCategoryLabel,
  formalBusinessOrderStatusLabel,
  type FormalBusinessOrderCategory,
  type FormalBusinessOrderList,
} from "@/lib/api/formal-business-orders";
import { aiClassifyFormalBusinessOrder } from "@/lib/ai/auto-repair";
import {
  fetchFormalCustomerVehicleWorkspace,
  selectFormalVehicleByPlate,
  type FormalCustomerVehicleWorkspace,
} from "@/lib/customers/formal-customer-vehicle-adapter";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/language";

export function FormalBusinessOrdersWorkspace() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { search: activeSearch, status: activeStatus, category: activeCategory, page } = parseBusinessOrderListFilters(searchParams);
  const [search, setSearch] = useState(activeSearch);
  const [data, setData] = useState<FormalBusinessOrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [workspace, setWorkspace] = useState<FormalCustomerVehicleWorkspace | null>(null);
  const [plate, setPlate] = useState("");
  const [companyContactId, setCompanyContactId] = useState("");
  const [problemDescriptionZh, setProblemDescriptionZh] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(activeSearch), 0);
    return () => window.clearTimeout(timer);
  }, [activeSearch]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setData(null);
      setError(null);
      void fetchFormalBusinessOrders({ search: activeSearch || undefined, status: activeStatus, category: activeCategory, page, pageSize: 20 })
        .then((result) => { if (active) setData(result); })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : "Business Order 读取失败");
        });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeSearch, activeStatus, activeCategory, page, reloadKey]);

  useEffect(() => {
    if (!createOpen || workspace) return;
    void fetchFormalCustomerVehicleWorkspace()
      .then(setWorkspace)
      .catch((caught) => setCreateError(caught instanceof Error ? caught.message : "车辆档案读取失败"));
  }, [createOpen, workspace]);

  const navigate = (
    nextPage: number,
    nextSearch = activeSearch,
    nextCategory: FormalBusinessOrderCategory | null | undefined = activeCategory,
  ) => {
    router.push(businessOrderListHref(searchParams, { page: nextPage, search: nextSearch, category: nextCategory }));
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(1, search);
  };

  const matchedVehicle = workspace ? selectFormalVehicleByPlate(workspace.vehicles, plate) : null;
  const owner = matchedVehicle?.currentOwner.type === "person"
    ? workspace?.people.find((person) => person.id === matchedVehicle.currentOwner.id)
    : workspace?.companies.find((company) => company.id === matchedVehicle?.currentOwner.id);
  const companyContacts = matchedVehicle?.currentOwner.type === "company"
    ? (workspace?.companyContacts ?? []).filter((contact) => contact.companyId === matchedVehicle.currentOwner.id && contact.isActive)
    : [];

  const submitCreate = async () => {
    if (!matchedVehicle) return;
    if (matchedVehicle.currentOwner.type === "company" && !companyContactId) {
      setCreateError("公司车辆必须选择本次联系人。请先在公司账户中维护联系人。 ");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const categories = await aiClassifyFormalBusinessOrder(problemDescriptionZh);
      const created = await createFormalBusinessOrder({
        vehicleId: matchedVehicle.id,
        companyContactId: companyContactId ? Number(companyContactId) : null,
        problemDescriptionZh,
        categories: categories ?? undefined,
      });
      router.push(`/orders/business/${created.id}`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "Business Order 创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-testid="formal-business-orders-workspace" className={styles.page}>
      <div className={styles.workspace}>
        <header className={styles.header}>
          <div><h1>业务单</h1><p>查看维修进度、收费与客户信息</p></div>
          <button type="button" onClick={() => { setCreateOpen(true); setCreateError(null); }} className={styles.primary}><Plus size={16} />新建业务单</button>
        </header>

        <section className={styles.panel} aria-label="业务单工作区">
          <div className={styles.toolbar}>
          <div role="group" aria-label="按维修状态筛选" className={styles.statuses}>
            {[undefined, ...BUSINESS_ORDER_STATUSES].map((status) => (
              <button key={status ?? "all"} type="button" aria-pressed={activeStatus === status}
                onClick={() => router.push(businessOrderListHref(searchParams, { status: status ?? null }))}>
                {status ? formalBusinessOrderStatusLabel(status) : "全部状态"}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 gap-2">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
            <label className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <span className="sr-only">搜索 Business Order</span>
              <input
                aria-label="搜索 Business Order"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索编号、车牌或费用承担方"
                className="min-h-10 w-full rounded-lg border border-line bg-layer-1 pl-9 pr-10 text-sm outline-none focus:border-primary"
              />
              {search ? <button type="button" aria-label="清空搜索" onClick={() => { setSearch(""); navigate(1, ""); }} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-ink-soft hover:text-ink"><X size={15} /></button> : null}
            </label>
            <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">搜索</button>
          </form>
          <button type="button" aria-label="刷新业务单" onClick={() => setReloadKey((value) => value + 1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-ink-soft hover:text-ink"><RefreshCw size={15} /></button>
          </div>

          <div role="group" aria-label="按业务分类筛选" className={styles.categories}>
            <span className="shrink-0 text-xs text-ink-soft">业务分类</span>
            {([
              [null, "全部"],
              ["maintenance", "保养"],
              ["repair", "维修"],
              ["inspection", "检查"],
              ["rework", "返修"],
            ] as const).map(([category, label]) => {
              const selected = category === null ? activeCategory === undefined : activeCategory === category;
              return (
                <button
                  key={category ?? "all"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => navigate(1, activeSearch, category)}
                  className={styles.category}
                >
                  {label}
                </button>
              );
            })}
          </div>
          </div>

          {createOpen ? (
            <div className={styles.createPanel}>
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-bold text-ink dark:text-slate-100">先查车牌，再创建 Business Order</h2><p className="mt-0.5 text-[11px] text-ink-soft">系统使用车辆档案中的登记对象作为费用承担方。</p></div>
                <button type="button" aria-label="关闭创建面板" onClick={() => setCreateOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white"><X size={14} /></button>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,.8fr)_1.2fr_auto] lg:items-end">
                <label className="text-[11px] font-semibold text-ink-soft">车牌号
                  <input autoFocus value={plate} onChange={(event) => { setPlate(event.target.value); setCompanyContactId(""); setCreateError(null); }} placeholder="例如 4321 AB" className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm uppercase outline-none focus:border-primary" />
                </label>
                <div className="min-h-10 rounded-lg border border-line bg-white px-3 py-2 text-xs">
                  {!workspace ? <span className="inline-flex items-center gap-2 text-ink-soft"><LoaderCircle size={13} className="animate-spin" />正在读取正式车辆档案</span> : null}
                  {workspace && !plate.trim() ? <span className="text-ink-soft">输入完整车牌号后显示车辆和费用承担方</span> : null}
                  {workspace && plate.trim() && !matchedVehicle ? <span className="text-amber-700">没有找到该车牌的车辆档案</span> : null}
                  {matchedVehicle ? <><strong>{matchedVehicle.plateDisplay} · {matchedVehicle.make} {matchedVehicle.model}</strong><span className="ml-2 text-ink-soft">费用承担方：{owner && "fullName" in owner ? owner.fullName : owner && "legalName" in owner ? owner.legalName : "档案异常"}</span></> : null}
                </div>
                {matchedVehicle ? (
                  <button type="button" disabled={creating || (matchedVehicle.currentOwner.type === "company" && !companyContactId)} onClick={() => void submitCreate()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-50">{creating ? <LoaderCircle size={14} className="animate-spin" /> : null}创建</button>
                ) : (
                  <button type="button" disabled={!plate.trim()} onClick={() => router.push(`/vehicles?create=1&plate=${encodeURIComponent(plate.trim())}`)} className="min-h-10 rounded-lg border border-primary bg-white px-4 text-xs font-bold text-primary disabled:opacity-40">新建车辆档案</button>
                )}
              </div>
              {matchedVehicle?.currentOwner.type === "company" ? (
                <label className="mt-2 block max-w-xl text-[11px] font-semibold text-ink-soft">本次公司联系人
                  <select value={companyContactId} onChange={(event) => setCompanyContactId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-primary">
                    <option value="">请选择联系人</option>
                    {companyContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.personalCustomerName}{contact.jobTitle ? ` · ${contact.jobTitle}` : ""}{contact.normalizedPhone ? ` · ${contact.normalizedPhone}` : ""}</option>)}
                  </select>
                </label>
              ) : null}
              {matchedVehicle ? (
                    <label className="mt-3 block max-w-4xl text-[11px] font-semibold text-ink-soft">
                      <span className="flex items-center gap-2">
                        <span>{t("businessOrder.create.problemDescription")}</span>
                        <span className="font-normal">{t("businessOrder.create.problemDescriptionOptional")}</span>
                      </span>
                      <textarea
                        data-testid="business-order-problem-description"
                        value={problemDescriptionZh}
                        onChange={(event) => setProblemDescriptionZh(event.target.value)}
                        rows={3}
                        placeholder={t("businessOrder.create.problemDescriptionPlaceholder")}
                        className="mt-1 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>
              ) : null}
              {createError ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{createError}</p> : null}
            </div>
          ) : null}

          <div className={styles.results} aria-busy={!data && !error}>
          {!data && !error ? <div role="status" className={styles.loading}><LoaderCircle size={20} className="motion-safe:animate-spin" /><span>正在读取业务单…</span></div> : null}
          {error ? (
            <div role="alert" className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center dark:border-rose-500/30">
              <AlertCircle className="text-rose-600" />
              <p className="mt-2 text-sm font-semibold">业务单读取失败</p>
              <p className="mt-1 text-xs text-ink-soft">{error}</p>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
            </div>
          ) : null}
          {data ? (
            <>
              {data.items.length === 0 ? (
                <div className={styles.empty}><Search size={24} /><h2>{activeSearch || activeCategory || activeStatus ? "没有符合条件的业务单" : "还没有业务单"}</h2><p>{activeSearch || activeCategory || activeStatus ? "试试其他车牌、客户或筛选条件。" : "从车辆开始，记录本次需要处理的问题。"}</p>{activeSearch || activeCategory || activeStatus ? <button type="button" onClick={() => { setSearch(""); router.push("/orders/business"); }} className={styles.secondary}>清除全部筛选</button> : <button type="button" onClick={() => setCreateOpen(true)} className={styles.primary}>新建业务单</button>}</div>
              ) : (
                <div>
                  <div className={styles.tableHead}>
                    <span>车辆 / 业务单</span><span>客户 / 费用承担方</span><span>分类 / 维修内容</span><span className="text-right">收费金额</span><span>维修班组</span><span>状态</span>
                  </div>
                  {data.items.map((order) => (
                    <Link
                      key={order.id}
                      href={`/orders/business/${order.id}`}
                      className={styles.row}
                    >
                      <span className={styles.vehicle}><strong>{order.vehicle.plate}</strong><span title={order.vehicle.description}>{order.vehicle.description}</span><small title={order.orderNo}>{order.orderNo}</small><small>{formatDateTime(order.createdAt)}</small></span>
                      <span className={styles.customer}><strong title={order.payer.displayName}>{order.payer.displayName}</strong>{order.payer.contactName ? <span>{order.payer.contactName}</span> : null}<span>{order.payer.phone ?? "电话待补"}</span></span>
                      <span className={styles.service}>
                        <span className="flex flex-wrap gap-1">
                          {order.categories.length > 0 ? order.categories.map((category) => <em key={category} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold not-italic ${category === "rework" ? "bg-rose-100 text-rose-700" : "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"}`}>{formalBusinessOrderCategoryLabel(category)}</em>) : <em className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] not-italic text-ink-soft">待分类</em>}
                        </span>
                        <span title={order.serviceSummary ?? undefined} className={styles.summary}>{order.serviceSummary ?? "维修内容待补"}</span>
                      </span>
                      <span className={styles.amount}><strong className="whitespace-nowrap">{formatFormalMoney(order.totalDueMinor)}</strong>{order.pendingQuoteCount ? <small className="mt-1 block text-xs font-normal text-state-warning-text">已报价部分 · {order.pendingQuoteCount} 项待报价</small> : null}</span>
                      <span className={styles.team}>{order.assignedTeam?.name ?? "待派单"}</span>
                      <span className={styles.state}><em className={styles.stateBadge} data-state={order.voided ? "voided" : order.status}>{order.voided ? "已作废" : formalBusinessOrderStatusLabel(order.status)}</em></span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : null}
          </div>
          {data ? <footer className={styles.footer}>
                <span>共 {data.total} 张业务单</span>
                <div className="flex items-center gap-2"><span className="mr-2">第 {data.page} / {Math.max(1, data.pageCount)} 页</span>
                <button type="button" disabled={data.page <= 1} onClick={() => navigate(data.page - 1)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-40">上一页</button>
                <button type="button" disabled={data.page >= data.pageCount} onClick={() => navigate(data.page + 1)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-40">下一页</button>
                </div>
          </footer> : null}
        </section>
      </div>
    </div>
  );
}
