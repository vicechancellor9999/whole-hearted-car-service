"use client";

import { FileText, RefreshCw } from "lucide-react";
import type { OrderListItem } from "@/lib/orders/types";
import { ORDER_PROCESSING_STATUS_LABELS } from "@/lib/orders/types";
import { formatJMDFull, timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  items: OrderListItem[];
  canManage: boolean;
  onOpen: (item: OrderListItem) => void;
  onReassign: (item: OrderListItem, trigger: HTMLElement) => void;
}

function mayReassign(item: OrderListItem): boolean {
  return Boolean(item.teamId)
    && item.processingStatus !== "submitted_awaiting_collection";
}

function Status({ item }: { item: OrderListItem }) {
  return (
    <span className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary dark:bg-primary-500/10 dark:text-primary-300">
      {ORDER_PROCESSING_STATUS_LABELS[item.processingStatus]}
    </span>
  );
}

function ActionButtons({ item, canManage, onOpen, onReassign }: Props & { item: OrderListItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpen(item); }}
        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[11px] font-semibold text-primary hover:border-primary-200 dark:border-slate-600"
      >
        <FileText size={13} /> 查看
      </button>
      {canManage && mayReassign(item) ? (
        <button
          type="button"
          aria-label={`改组 ${item.orderNo}`}
          onClick={(event) => { event.stopPropagation(); onReassign(item, event.currentTarget); }}
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[11px] font-semibold text-ink-soft hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-300"
        >
          <RefreshCw size={12} /> 改组
        </button>
      ) : null}
    </div>
  );
}

export function BusinessOrdersTable(props: Props) {
  const { items, onOpen } = props;
  const activate = (event: React.KeyboardEvent, item: OrderListItem) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(item);
    }
  };

  return (
    <div data-testid="business-orders-table" className="min-w-0">
      <div className="hidden overflow-hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-y-1.5 text-left">
          <thead className="text-[10px] uppercase tracking-wide text-ink-soft dark:text-slate-400">
            <tr>
              <th className="px-3 py-1">业务单／客户车辆</th>
              <th className="px-3 py-1">收费项目</th>
              <th className="px-3 py-1">执行</th>
              <th className="px-3 py-1">Invoice</th>
              <th className="px-3 py-1">最近更新</th>
              <th className="px-3 py-1">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                data-testid="business-order-row"
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(event) => activate(event, item)}
                className="cursor-pointer bg-white shadow-sm outline-none transition hover:bg-primary-50/40 focus-visible:ring-2 focus-visible:ring-primary-300 dark:bg-slate-800 dark:hover:bg-primary-500/10"
              >
                <td className="rounded-l-xl border-y border-l border-line px-3 py-3 dark:border-slate-700">
                  <div className="font-mono text-xs font-bold text-ink dark:text-slate-100">{item.orderNo}</div>
                  <div className="mt-1 text-[11px] font-semibold text-ink dark:text-slate-200">{item.vehicle.plate} · {item.customer.nameZh}</div>
                  <div className="text-[10px] text-ink-soft dark:text-slate-400">{item.vehicle.modelZh ?? item.vehicle.modelEn ?? "车型未录入"} · {item.customer.phone}</div>
                  {item.sourceInspection ? <div className="mt-1 font-mono text-[9px] text-violet-700 dark:text-violet-300">来源 {item.sourceInspection.reportNo}</div> : null}
                </td>
                <td className="border-y border-line px-3 py-3 dark:border-slate-700">
                  <div className="max-w-[260px] truncate text-[11px] text-ink dark:text-slate-200">{item.projectNames.join("、") || "尚未添加收费项目"}</div>
                  <div className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">工时 {item.laborItemCount} · 配件 {item.partItemCount}</div>
                </td>
                <td className="border-y border-line px-3 py-3 dark:border-slate-700">
                  <Status item={item} />
                  <div className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">{item.teamName ?? "未派组"}{item.mechanicNames.length ? ` · ${item.mechanicNames.join("、")}` : ""}</div>
                </td>
                <td className="border-y border-line px-3 py-3 dark:border-slate-700">
                  <div className="text-xs font-bold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(item.receivableJmd)}</div>
                  <div className={cn("mt-1 text-[10px]", item.balanceJmd > 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300")}>余额 {formatJMDFull(item.balanceJmd)}</div>
                </td>
                <td className="border-y border-line px-3 py-3 text-[10px] text-ink-soft dark:border-slate-700 dark:text-slate-400">
                  <div suppressHydrationWarning>{timeAgo(item.updatedAt)}</div>
                  <div>{item.updatedBy}</div>
                </td>
                <td className="rounded-r-xl border-y border-r border-line px-3 py-3 dark:border-slate-700">
                  <ActionButtons {...props} item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {items.map((item) => (
          <article
            key={item.id}
            data-testid="business-order-card"
            tabIndex={0}
            onClick={() => onOpen(item)}
            onKeyDown={(event) => activate(event, item)}
            className="rounded-2xl border border-line bg-white p-3 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-primary-300 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-[11px] font-bold text-ink dark:text-slate-100">{item.orderNo}</div>
                <div className="mt-1 text-sm font-bold text-ink dark:text-slate-100">{item.vehicle.plate}</div>
                <div className="text-[11px] text-ink-soft dark:text-slate-400">{item.customer.nameZh} · {item.customer.phone}</div>
              </div>
              <Status item={item} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface/70 p-2.5 text-[10px] dark:bg-slate-700/30">
              <div><span className="text-ink-soft dark:text-slate-400">班组</span><div className="mt-0.5 font-semibold text-ink dark:text-slate-100">{item.teamName ?? "未派组"}</div></div>
              <div><span className="text-ink-soft dark:text-slate-400">Invoice 余额</span><div className="mt-0.5 font-semibold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(item.balanceJmd)}</div></div>
            </div>
            <div className="mt-3"><ActionButtons {...props} item={item} /></div>
          </article>
        ))}
      </div>
    </div>
  );
}
