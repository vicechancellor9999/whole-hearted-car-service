"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import {
  fetchFormalBusinessOrders,
  createFormalBusinessOrder,
  formalBusinessOrderStatusLabel,
  type FormalBusinessOrderList,
} from "@/lib/api/formal-business-orders";
import {
  fetchFormalCustomerVehicleWorkspace,
  selectFormalVehicleByPlate,
  type FormalCustomerVehicleWorkspace,
} from "@/lib/customers/formal-customer-vehicle-adapter";
import { formatDateTime } from "@/lib/utils";

export function FormalBusinessOrdersWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSearch = searchParams.get("search") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [search, setSearch] = useState(activeSearch);
  const [data, setData] = useState<FormalBusinessOrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [workspace, setWorkspace] = useState<FormalCustomerVehicleWorkspace | null>(null);
  const [plate, setPlate] = useState("");
  const [companyContactId, setCompanyContactId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { setSearch(activeSearch); }, [activeSearch]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void fetchFormalBusinessOrders({ search: activeSearch || undefined, page, pageSize: 20 })
      .then((result) => { if (active) setData(result); })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Business Order 读取失败");
      });
    return () => { active = false; };
  }, [activeSearch, page, reloadKey]);

  useEffect(() => {
    if (!createOpen || workspace) return;
    void fetchFormalCustomerVehicleWorkspace()
      .then(setWorkspace)
      .catch((caught) => setCreateError(caught instanceof Error ? caught.message : "车辆档案读取失败"));
  }, [createOpen, workspace]);

  const navigate = (nextPage: number, nextSearch = activeSearch) => {
    const query = new URLSearchParams();
    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (nextPage > 1) query.set("page", String(nextPage));
    router.push(`/orders/business${query.size ? `?${query.toString()}` : ""}`);
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
      const created = await createFormalBusinessOrder({
        vehicleId: matchedVehicle.id,
        companyContactId: companyContactId ? Number(companyContactId) : null,
      });
      router.push(`/orders/business/${created.id}`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "Business Order 创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-testid="formal-business-orders-workspace" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <PageHeader
          breadcrumb="工单管理 · 正式数据"
          title="Business Order"
          description="这里读取正式后端保存的车辆、费用承担方、收费版本和维修状态；刷新页面后事实保持不变。"
        />

        <section className="mt-3 rounded-[22px] border border-line bg-white/80 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/50 sm:p-4">
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
                className="min-h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white">搜索</button>
          </form>
          <button type="button" onClick={() => { setCreateOpen(true); setCreateError(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-primary px-4 text-xs font-bold text-white"><Plus size={14} />新建 Business Order</button>
          </div>

          {createOpen ? (
            <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3 dark:border-primary-500/30 dark:bg-primary-500/5">
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
              {createError ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{createError}</p> : null}
            </div>
          ) : null}

          {!data && !error ? <div role="status" className="mt-3 h-[360px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
          {error ? (
            <div role="alert" className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center dark:border-rose-500/30">
              <AlertCircle className="text-rose-600" />
              <p className="mt-2 text-sm font-semibold">Business Order 读取失败</p>
              <p className="mt-1 text-xs text-ink-soft">{error}</p>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
            </div>
          ) : null}
          {data ? (
            <>
              <div className="mt-3 flex items-center justify-between text-xs text-ink-soft">
                <span>共 {data.total} 张正式 Business Order</span>
                <span>第 {data.page} / {data.pageCount} 页</span>
              </div>
              {data.items.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">没有符合条件的正式 Business Order。</div>
              ) : (
                <div className="mt-2 overflow-hidden rounded-xl border border-line dark:border-slate-700">
                  <div className="hidden grid-cols-[1.25fr_1.2fr_1fr_.65fr_.8fr] gap-3 border-b border-line bg-surface px-3 py-2 text-[10px] font-semibold text-ink-soft dark:border-slate-700 dark:bg-slate-800/60 lg:grid">
                    <span>Business Order / 车辆</span><span>费用承担方</span><span>联系方式</span><span>状态</span><span>创建时间</span>
                  </div>
                  {data.items.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => router.push(`/orders/business/${order.id}`)}
                      className="grid w-full min-w-0 gap-2 border-b border-line/70 px-3 py-3 text-left text-xs last:border-0 hover:bg-primary-50/50 dark:border-slate-700 dark:hover:bg-slate-800/60 lg:grid-cols-[1.25fr_1.2fr_1fr_.65fr_.8fr] lg:items-center"
                    >
                      <span className="min-w-0"><strong className="block truncate font-mono text-ink dark:text-slate-100">{order.orderNo}</strong><small className="block truncate text-ink-soft">{order.vehicle.plate} · {order.vehicle.description}</small></span>
                      <span className="min-w-0 truncate font-semibold text-ink dark:text-slate-100">{order.payer.displayName}{order.payer.contactName ? ` · ${order.payer.contactName}` : ""}</span>
                      <span className="min-w-0 truncate text-ink-soft">{order.payer.phone ?? "未填写"}{order.payer.trn ? ` · TRN ${order.payer.trn}` : ""}</span>
                      <span><em className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold not-italic ${order.voided ? "bg-rose-100 text-rose-700" : "bg-primary-50 text-primary dark:bg-primary-500/10 dark:text-primary-300"}`}>{order.voided ? "已作废" : formalBusinessOrderStatusLabel(order.status)}</em></span>
                      <span className="text-[11px] text-ink-soft">{formatDateTime(order.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" disabled={data.page <= 1} onClick={() => navigate(data.page - 1)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-40">上一页</button>
                <button type="button" disabled={data.page >= data.pageCount} onClick={() => navigate(data.page + 1)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-40">下一页</button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
