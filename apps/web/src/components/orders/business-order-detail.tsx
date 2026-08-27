"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { BillingBusinessOrderResponse } from "@/lib/api/mock-billing";
import { formatJMDFull } from "@/lib/utils";

const PAYMENT_LABELS = { unpaid: "未付款", partially_paid: "未付清", paid: "已付清" } as const;
const ARRANGEMENT_LABELS = { normal: "正常结算", credit: "挂账", special_agreement: "特殊协商" } as const;
const RELEASE_LABELS = { not_authorized: "未授权离店", authorized: "已授权离店", released: "已离店" } as const;
const EXECUTION_LABELS = { planned: "待实施", in_progress: "实施中", completed: "已完成", cancelled: "已取消" } as const;
const CATEGORY_LABELS = { labor: "工时", parts: "配件", other_service: "其他服务" } as const;

export function BusinessOrderDetail({ data, onClose }: { data: BillingBusinessOrderResponse; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const { invoice, payment, release } = data;
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`业务单 ${data.businessOrder.businessOrderNo}`} data-testid="business-order-detail" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="my-auto w-full max-w-4xl overflow-hidden rounded-[22px] border border-line bg-white shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-700 sm:p-5">
          <div><h2 className="text-lg font-bold text-ink dark:text-slate-100">{data.businessOrder.businessOrderNo}</h2><p className="mt-1 text-xs text-ink-soft dark:text-slate-400">Business Order · Invoice 与执行进度</p></div>
          <button ref={closeRef} type="button" aria-label="关闭" onClick={onClose} className="rounded-lg border border-line p-2 text-ink-soft hover:text-primary dark:border-slate-600"><X size={16} /></button>
        </div>
        <div className="max-h-[76vh] space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line p-3 dark:border-slate-700"><div className="text-[10px] text-ink-soft dark:text-slate-400">施工状态</div><div className="mt-1 text-sm font-bold text-ink dark:text-slate-100">{EXECUTION_LABELS[data.businessOrder.executionStatus]}</div></div>
            <div data-testid="business-order-payment-status" className="rounded-xl border border-line p-3 dark:border-slate-700"><div className="text-[10px] text-ink-soft dark:text-slate-400">付款状态</div><div className="mt-1 text-sm font-bold text-ink dark:text-slate-100">{PAYMENT_LABELS[payment.paymentStatus]}</div></div>
            <div data-testid="business-order-release-status" className="rounded-xl border border-line p-3 dark:border-slate-700"><div className="text-[10px] text-ink-soft dark:text-slate-400">车辆离店</div><div className="mt-1 text-sm font-bold text-ink dark:text-slate-100">{RELEASE_LABELS[release.status]}</div></div>
          </div>

          <section data-testid="business-order-invoice" className="rounded-2xl border border-line bg-surface/50 p-4 dark:border-slate-700 dark:bg-slate-700/20">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-ink dark:text-slate-100">Invoice {invoice.invoiceNo}</h3><p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">版本 V{invoice.version.version} · 文件 {invoice.version.fileHash.slice(0, 18)}…</p></div><span data-testid="business-order-settlement-arrangement" className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{ARRANGEMENT_LABELS[invoice.settlementArrangement]}</span></div>
            <div className="mt-3 overflow-hidden"><table className="w-full table-fixed text-left text-[11px]"><thead className="text-ink-soft dark:text-slate-400"><tr><th className="py-2">收费项目</th><th>类别</th><th className="text-right">数量</th><th className="text-right">金额</th></tr></thead><tbody>{invoice.version.lines.map((line) => <tr key={line.id} className="border-t border-line dark:border-slate-700"><td className="break-words py-2 text-ink dark:text-slate-200">{line.descriptionZh}</td><td className="text-ink-soft dark:text-slate-400">{CATEGORY_LABELS[line.category]}</td><td className="text-right tabular-nums">{line.quantity}</td><td className="text-right font-semibold tabular-nums">{formatJMDFull(line.quantity * line.unitPriceJmd)}</td></tr>)}</tbody></table></div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-right dark:border-slate-700"><div><div className="text-[10px] text-ink-soft">总额</div><b className="text-sm tabular-nums">{formatJMDFull(invoice.version.totals.totalJmd)}</b></div><div><div className="text-[10px] text-ink-soft">已收</div><b className="text-sm tabular-nums">{formatJMDFull(payment.paidJmd)}</b></div><div><div className="text-[10px] text-ink-soft">余额</div><b className="text-sm tabular-nums text-rose-700 dark:text-rose-300">{formatJMDFull(payment.balanceJmd)}</b></div></div>
          </section>
          {data.parking ? <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">停车费：{data.parking.finalChargeableDays} 天 · {formatJMDFull(data.parking.finalAmountJmd)}</div> : null}
        </div>
      </div>
    </div>
  );
}
