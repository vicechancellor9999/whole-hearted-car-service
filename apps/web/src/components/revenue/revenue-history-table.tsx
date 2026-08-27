"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { RevenueDetailResponse } from "@/lib/revenue/types";
import { formatJMDFull } from "@/lib/utils";

export function RevenueHistoryTable({ rows }: { rows: RevenueDetailResponse["rows"] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  useEffect(() => {
    if (selectedKey && !rows.some((row) => row.key === selectedKey)) setSelectedKey(null);
  }, [rows, selectedKey]);

  const closeDetail = () => {
    const trigger = selectedKey ? triggerRefs.current.get(selectedKey) : undefined;
    setSelectedKey(null);
    globalThis.setTimeout(() => trigger?.focus(), 0);
  };

  return (
    <section data-testid="revenue-history-table" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:bg-slate-800">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-base font-bold text-ink dark:text-slate-100">分期统计</h2>
        <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">每一行都由该期间实际发生的独立收款和退款记录汇总。</p>
      </div>
      <div data-testid="revenue-table-scroll" className="w-full min-w-0 overflow-hidden">
        <div className="hidden grid-cols-[0.8fr_1fr_1fr_1fr_0.7fr_0.65fr] gap-2 bg-surface px-4 py-3 text-[11px] font-semibold text-ink-soft md:grid dark:bg-slate-900/60 dark:text-slate-300">
          <span>期间</span><span>净收款</span><span>收款总额</span><span>退款</span><span>记录</span><span className="text-right">明细</span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {rows.map((row) => {
            const expanded = selectedKey === row.key;
            return (
              <div key={row.key} data-testid="revenue-history-row" className="grid min-w-0 gap-2 px-4 py-3 text-xs text-ink hover:bg-primary-50/40 md:grid-cols-[0.8fr_1fr_1fr_1fr_0.7fr_0.65fr] md:items-center dark:text-slate-100 dark:hover:bg-slate-700/50">
                <strong>{row.label}</strong>
                <span className="font-semibold tabular-nums"><i className="mr-1 font-normal not-italic text-ink-faint md:hidden">净：</i>{formatJMDFull(row.netPaidJmd)}</span>
                <span className="tabular-nums"><i className="mr-1 font-normal not-italic text-ink-faint md:hidden">收：</i>{formatJMDFull(row.grossPaidJmd)}</span>
                <span className="tabular-nums text-rose-600"><i className="mr-1 font-normal not-italic text-ink-faint md:hidden">退：</i>{formatJMDFull(row.cashRefundedJmd)}</span>
                <span>{row.paymentCount + row.refundCount} 笔</span>
                <button ref={(node) => { if (node) triggerRefs.current.set(row.key, node); else triggerRefs.current.delete(row.key); }} type="button" data-testid="revenue-breakdown-trigger" aria-expanded={expanded} aria-controls={`revenue-breakdown-${row.key}`} onClick={() => setSelectedKey(expanded ? null : row.key)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg px-2 font-semibold text-primary hover:bg-primary-50 md:justify-self-end dark:text-primary-300">
                  查看方式 <ArrowRight size={14} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {selected && (
        <div id={`revenue-breakdown-${selected.key}`} data-testid="revenue-inline-detail" className="border-t border-line bg-primary-900 px-4 py-4 text-white dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] text-primary-200 dark:text-slate-400">{selected.label} · 按收退款方式查看净额</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.methods.length > 0 ? selected.methods.map((method) => (
                  <span key={method.method} className="rounded-lg bg-white/10 px-3 py-2 text-xs">{method.method} <b className="ml-1 tabular-nums">{formatJMDFull(method.total)}</b></span>
                )) : <span className="text-xs text-primary-200">本期没有收退款记录</span>}
              </div>
            </div>
            <button type="button" data-testid="revenue-inline-detail-close" onClick={closeDetail} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/20 text-white hover:bg-white/10" aria-label="关闭明细"><X size={17} aria-hidden /></button>
          </div>
        </div>
      )}
    </section>
  );
}
