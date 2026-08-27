"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FormalInspectionCreateDialog } from "@/components/orders/formal-inspection-create-dialog";
import { fetchFormalInspectionReports, type FormalInspectionListItem } from "@/lib/api/formal-inspections";
import { formatDateTime } from "@/lib/utils";

export function FormalInspectionReportsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const [items, setItems] = useState<FormalInspectionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    router.replace(`/orders/inspections${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchFormalInspectionReports({ page, search: search || undefined })
      .then((result) => {
        if (!active) return;
        setItems(result.items); setTotal(result.total); setPageCount(result.pageCount);
      })
      .catch((caught) => { if (active) { setItems([]); setError(caught instanceof Error ? caught.message : "无法读取检查结果"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry, search]);

  return <div data-testid="inspection-reports-workspace" className="px-3 py-3 sm:px-5"><div className="mx-auto w-full max-w-[1720px]">
    <PageHeader breadcrumb="工单管理" title="检查结果" description="Inspection Report 是独立检查成果，必须归属车辆；可选关联来源 Business Order。" />
    <div className="mt-3 flex justify-end"><button type="button" onClick={() => setCreateOpen(true)} className="min-h-10 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white">新建检查结果</button></div>
    <section className="mt-3 rounded-[22px] border border-line bg-white/75 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-4">
      <label className="relative block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><span className="sr-only">搜索检查结果</span>
        <input data-testid="inspection-reports-search" defaultValue={search} onChange={(event) => updateQuery({ search: event.target.value || null, page: null })} placeholder="搜索车牌、客户、报告编号或检查结论" className="min-h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-primary-300 dark:bg-slate-800" />
      </label>
      <div className="mt-3 text-[11px] text-ink-soft">{total} 份检查结果</div>
      {loading ? <div data-testid="inspection-reports-loading" className="mt-3 h-[360px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
      {error ? <div className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center"><AlertCircle className="text-rose-600" /><p className="mt-2 text-sm font-semibold">检查结果读取失败</p><p className="mt-1 text-xs text-ink-soft">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button></div> : null}
      {!loading && !error && items.length === 0 ? <div data-testid="inspection-report-empty" className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">没有符合条件的检查结果。</div> : null}
      {!loading && !error && items.length > 0 ? <div className="mt-3 overflow-hidden rounded-xl border border-line"><table data-testid="inspection-reports-table" className="w-full table-fixed text-left text-xs"><thead><tr className="border-b border-line bg-surface text-[10px] text-ink-soft"><th className="px-3 py-2">报告编号</th><th className="px-3 py-2">车辆 · 客户</th><th className="px-3 py-2">检查人</th><th className="px-3 py-2">来源 Business Order</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">更新</th></tr></thead><tbody>{items.map((item) => <tr key={item.report.id} data-testid="inspection-report-row" onClick={() => router.push(`/orders/inspections/${item.report.id}`)} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-primary-50/40"><td className="px-3 py-2.5 font-mono font-semibold text-primary">{item.report.reportNo}</td><td className="px-3 py-2.5"><b>{item.vehicle.plate} · {item.vehicle.description}</b><div className="text-[10px] text-ink-soft">{item.customer.name ?? "未登记客户"}{item.customer.phone ? ` · ${item.customer.phone}` : ""}</div></td><td className="px-3 py-2.5">{item.inspectorName ?? "待补"}</td><td className="px-3 py-2.5">{item.sourceBusinessOrder?.orderNo ?? "独立检查"}</td><td className="px-3 py-2.5">{item.report.status === "submitted" ? "已提交" : "草稿"}</td><td className="px-3 py-2.5 text-[10px] text-ink-soft">{formatDateTime(item.report.submittedAt ?? item.report.createdAt)}</td></tr>)}</tbody></table></div> : null}
      {!loading && !error && pageCount > 1 ? <nav className="mt-3 flex justify-end gap-2"><button disabled={page <= 1} type="button" onClick={() => updateQuery({ page: String(page - 1) })} className="min-h-10 rounded-lg border border-line px-3 text-xs disabled:opacity-40">上一页</button><span className="py-2 text-xs text-ink-soft">第 {page} / {pageCount} 页</span><button disabled={page >= pageCount} type="button" onClick={() => updateQuery({ page: String(page + 1) })} className="min-h-10 rounded-lg border border-line px-3 text-xs disabled:opacity-40">下一页</button></nav> : null}
    </section>{createOpen ? <FormalInspectionCreateDialog onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setRetry((value) => value + 1); }} /> : null}
  </div></div>;
}
