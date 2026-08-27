"use client";

import type { InspectionReportListItem } from "@/lib/api/mock-inspection-reports";
import { formatDateTime } from "@/lib/utils";

const STATUS_LABELS = {
  mechanic_submitted: "维修工已提交",
  ai_structured: "AI 已整理",
  awaiting_frontdesk: "待前台审核",
  returned_for_revision: "已退回修改",
  approved: "已审核",
  published: "已发布",
} as const;

export function InspectionReportsTable({ items, onOpen }: { items: InspectionReportListItem[]; onOpen: (item: InspectionReportListItem, trigger: HTMLElement) => void }) {
  const activate = (event: React.KeyboardEvent<HTMLElement>, item: InspectionReportListItem) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item, event.currentTarget); }
  };
  return (
    <div data-testid="inspection-reports-table">
      <div className="hidden overflow-hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-y-1.5 text-left">
          <thead className="text-[10px] uppercase tracking-wide text-ink-soft dark:text-slate-400"><tr><th className="px-3 py-1">检查结果</th><th className="px-3 py-1">客户／车辆</th><th className="px-3 py-1">检查署名</th><th className="px-3 py-1">审核状态</th><th className="px-3 py-1">提交时间</th><th className="px-3 py-1">操作</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id} data-testid="inspection-report-row" tabIndex={0} onClick={(event) => onOpen(item, event.currentTarget)} onKeyDown={(event) => activate(event, item)} className="cursor-pointer bg-white shadow-sm outline-none hover:bg-violet-50/40 focus-visible:ring-2 focus-visible:ring-violet-300 dark:bg-slate-800 dark:hover:bg-violet-500/10"><td className="rounded-l-xl border-y border-l border-line px-3 py-3 font-mono text-xs font-bold text-ink dark:border-slate-700 dark:text-slate-100">{item.reportNo}<div className="mt-1 text-[9px] font-normal text-ink-soft dark:text-slate-400">检查事实 V{item.sourceVersion}</div></td><td className="border-y border-line px-3 py-3 dark:border-slate-700"><div className="text-[11px] font-semibold text-ink dark:text-slate-200">{item.vehicle.plate} · {item.customer.nameZh}</div><div className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">{item.vehicle.modelZh ?? item.vehicle.modelEn ?? "车型未录入"} · {item.customer.phone}</div></td><td className="border-y border-line px-3 py-3 text-[11px] dark:border-slate-700"><div className="font-semibold text-ink dark:text-slate-200">{item.inspector.name}</div><div className="text-[10px] text-ink-soft dark:text-slate-400">{item.inspector.teamId}</div></td><td className="border-y border-line px-3 py-3 dark:border-slate-700"><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{STATUS_LABELS[item.status]}</span></td><td className="border-y border-line px-3 py-3 text-[10px] text-ink-soft dark:border-slate-700 dark:text-slate-400">{formatDateTime(item.submittedAt)}</td><td className="rounded-r-xl border-y border-r border-line px-3 py-3 dark:border-slate-700"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(item, event.currentTarget); }} className="min-h-8 rounded-lg border border-line px-3 text-[11px] font-semibold text-violet-700 hover:border-violet-300 dark:border-slate-600 dark:text-violet-300">查看结果</button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">{items.map((item) => <article key={item.id} data-testid="inspection-report-card" tabIndex={0} onClick={(event) => onOpen(item, event.currentTarget)} onKeyDown={(event) => activate(event, item)} className="rounded-2xl border border-line bg-white p-3 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-violet-300 dark:border-slate-700 dark:bg-slate-800"><div className="flex items-start justify-between gap-2"><div className="font-mono text-[11px] font-bold text-ink dark:text-slate-100">{item.reportNo}</div><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{STATUS_LABELS[item.status]}</span></div><div className="mt-2 text-sm font-bold text-ink dark:text-slate-100">{item.vehicle.plate}</div><div className="text-[11px] text-ink-soft dark:text-slate-400">{item.customer.nameZh} · {item.customer.phone}</div><div className="mt-3 border-t border-line pt-2 text-[10px] text-ink-soft dark:border-slate-700 dark:text-slate-400">署名 {item.inspector.name} · {formatDateTime(item.submittedAt)}</div></article>)}</div>
    </div>
  );
}
