import Link from "next/link";
import { ArrowRight, ClipboardList, Plus } from "lucide-react";
import type { FormalInspectionListItem } from "@/lib/api/formal-inspections";

export function BusinessOrderInspections({ english, items, total, loading, error, canCreate, page, pageCount, onPage, onCreate, onRetry }: {
  english: boolean;
  items: FormalInspectionListItem[];
  total: number;
  loading: boolean;
  error: boolean;
  canCreate: boolean;
  page: number;
  pageCount: number;
  onPage(page: number): void;
  onCreate(): void;
  onRetry(): void;
}) {
  const stages = english ? ["Organize", "Ready to send", "Awaiting reply", "Closed"] : ["整理确认", "待发送", "待回复", "已闭环"];
  return <section id="business-order-related-inspections" className="rounded-2xl border border-line bg-card p-4 shadow-card" aria-label={english ? "Related inspection reports" : "相关检查结果"}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-bold"><ClipboardList size={16} className="text-primary" />{english ? "Related inspection reports" : "相关检查结果"}{!loading && !error ? <span className="rounded-md bg-layer-2 px-2 py-0.5 text-xs font-normal text-ink-soft">{total}</span> : null}</h2>
      {canCreate ? <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-primary px-3 text-xs font-bold text-primary hover:bg-primary-50"><Plus size={14} />{english ? "New inspection report" : "新建检查结果"}</button> : null}
    </div>
    {loading ? <p role="status" className="mt-3 text-sm text-ink-soft">{english ? "Loading inspection reports…" : "正在读取检查结果…"}</p> : error ? <div role="alert" className="mt-3 rounded-xl border border-state-danger-border bg-state-danger-subtle p-3 text-sm text-state-danger-text"><p>{english ? "Inspection reports could not be loaded." : "未能读取相关检查结果。"}</p><button type="button" onClick={onRetry} className="mt-2 min-h-9 rounded-lg border border-state-danger-border px-3 font-semibold">{english ? "Retry" : "重试"}</button></div> : items.length ? <div className="mt-3 space-y-2">{items.map(({ report, followupStage, teamName }) => <Link key={report.id} href={`/orders/inspections/${report.id}`} className="group block rounded-xl border border-line p-3 transition-colors hover:border-primary hover:bg-layer-2"><div className="flex items-center justify-between gap-2"><strong className="text-sm text-primary">{report.reportNo}</strong><ArrowRight size={15} className="shrink-0 text-ink-soft" /></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-soft">{(english ? report.summaryEn : report.summaryZh) || (english ? "Open inspection report" : "查看检查报告")}</p><div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-ink-soft"><span>{teamName}</span><span>{stages[followupStage]}</span></div></Link>)}</div> : <div className="mt-3 rounded-xl bg-layer-2 p-3"><p className="text-sm font-medium">{english ? "No related inspection reports" : "尚无相关检查结果"}</p><p className="mt-1 text-xs leading-5 text-ink-soft">{english ? "Keep inspection findings, quotations and customer replies together in a report." : "检查结论、报价与客户回复，在检查报告中一起处理。"}</p></div>}
    {!loading && !error && pageCount > 1 ? <div className="mt-3 flex items-center justify-between gap-2 text-xs"><button disabled={page <= 1} onClick={() => onPage(page - 1)} className="min-h-9 rounded-lg border border-line px-3 disabled:opacity-40">{english ? "Previous page" : "上一页"}</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => onPage(page + 1)} className="min-h-9 rounded-lg border border-line px-3 disabled:opacity-40">{english ? "Next page" : "下一页"}</button></div> : null}
  </section>;
}
