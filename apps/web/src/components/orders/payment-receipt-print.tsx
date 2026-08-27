"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import type { QuickOrder, QuickPayment } from "@/lib/orders/quick-order-types";
import { methodLabelEn, methodLabelZh } from "@/lib/payments/method-dictionary";
import { formatDateTime, formatJMDFull } from "@/lib/utils";

export function PaymentReceiptPrintSheet({
  orderId,
  paymentId,
}: {
  orderId: string;
  paymentId: string;
}) {
  const [order, setOrder] = useState<QuickOrder | null>(null);
  const [payment, setPayment] = useState<QuickPayment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.quickOrders.detail(orderId).then((detail) => {
      if (!active) return;
      const found = detail.payments.find((candidate) => candidate.id === paymentId) ?? null;
      if (!found?.receipt) throw new Error("Receipt 不存在或尚未生成");
      setOrder(detail);
      setPayment(found);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Receipt 加载失败");
    });
    return () => { active = false; };
  }, [orderId, paymentId]);

  if (error) return <div className="p-8 text-sm font-semibold text-rose-600">{error}</div>;
  if (!order || !payment) return <div className="p-8 text-sm text-ink-soft">加载 Receipt…</div>;

  const receipt = payment.receipt;
  const customerName = [receipt.customer.nameZh, receipt.customer.nameEn].filter(Boolean).join(" / ");
  const vehicleModel = [receipt.vehicle.modelZh, receipt.vehicle.modelEn].filter(Boolean).join(" / ");

  return (
    <main data-testid={`payment-receipt-${payment.id}`} className="mx-auto min-h-screen max-w-[210mm] bg-white p-10 text-[12px] leading-relaxed text-neutral-900 print:p-7">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <Link href={`/orders/business/${order.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-primary">
          ← 返回 Business Order
        </Link>
        <button type="button" onClick={() => window.print()} data-testid="payment-receipt-print" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
          打印 / 存 PDF
        </button>
      </div>

      <header className="flex items-start justify-between border-b-2 border-blue-800 pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="Whole Hearted" className="h-14 w-14 rounded-xl object-cover" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-blue-900">Whole Hearted Car Service Limited</h1>
            <p className="text-xs text-neutral-500">全心全意汽修服务 · Kingston, Jamaica</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-black uppercase tracking-[0.2em] text-blue-800">Receipt</p>
          <p className="mt-1 font-mono text-xs font-bold">{receipt.receiptNo}</p>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 border-b border-neutral-200 pb-4">
        <p><span className="text-neutral-500">Business Order：</span><b>{receipt.businessOrderNo}</b></p>
        <p><span className="text-neutral-500">收款时间：</span><b>{formatDateTime(receipt.issuedAt)}</b></p>
        <p><span className="text-neutral-500">客户：</span><b>{customerName || "—"}</b>{receipt.customer.phone ? ` · ${receipt.customer.phone}` : ""}</p>
        <p><span className="text-neutral-500">车辆：</span><b>{receipt.vehicle.plate}</b>{vehicleModel ? ` · ${vehicleModel}` : ""}</p>
        <p><span className="text-neutral-500">本次收款方式：</span><b>{methodLabelZh(receipt.method)} / {methodLabelEn(receipt.method)}</b></p>
        <p><span className="text-neutral-500">经办人：</span><b>{receipt.issuedBy}</b></p>
      </section>

      <section className="mt-5">
        <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold">收费项目 / Charges</h2>
        <table className="mt-2 w-full table-fixed">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500">
              <th className="w-[34%] py-2">项目</th>
              <th className="w-[22%] py-2">描述</th>
              <th className="w-[10%] py-2">单位</th>
              <th className="w-[8%] py-2 text-right">数量</th>
              <th className="w-[13%] py-2 text-right">本项折扣</th>
              <th className="w-[13%] py-2 text-right">含税小计</th>
            </tr>
          </thead>
          <tbody>
            {receipt.chargeLines.map((line) => (
              <tr key={line.id} className="border-b border-neutral-200 align-top">
                <td className="py-2 pr-2"><b>{line.descZh}</b>{line.descEn ? <p className="text-[10px] text-neutral-500">{line.descEn}</p> : null}</td>
                <td className="py-2 pr-2">{line.remarkZh || "—"}{line.remarkEn ? <p className="text-[10px] text-neutral-500">{line.remarkEn}</p> : null}</td>
                <td className="py-2">{line.unit ?? "—"}</td>
                <td className="py-2 text-right">{line.quantity ?? "—"}</td>
                <td className="py-2 text-right">−{formatJMDFull(line.discountJmd)}</td>
                <td className="py-2 text-right font-bold">{line.pendingQuote ? "待报价" : formatJMDFull(line.lineTotalJmd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto mt-2 w-72 space-y-1 border-t border-neutral-300 pt-2 text-right">
          <p>收费原价 <b className="ml-4">{formatJMDFull(receipt.grossJmd)}</b></p>
          <p>折扣合计 <b className="ml-4 text-rose-700">−{formatJMDFull(receipt.discountJmd)}</b></p>
          <p className="text-sm">应收合计（含 15% GCT） <b className="ml-4">{formatJMDFull(receipt.receivableJmd)}</b></p>
          <p className="text-neutral-500">其中已含 GCT <b className="ml-4">{formatJMDFull(receipt.gctIncludedJmd)}</b></p>
        </div>
      </section>

      <section className="mt-5 rounded-xl border-2 border-blue-800 bg-blue-50 px-4 py-3">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><p className="text-neutral-500">本次实收</p><p className="mt-1 text-xl font-black text-blue-900">{formatJMDFull(receipt.amountJmd)}</p></div>
          <div><p className="text-neutral-500">累计实收</p><p className="mt-1 text-lg font-bold">{formatJMDFull(receipt.paidToDateJmd)}</p></div>
          <div><p className="text-neutral-500">本次收款后未付</p><p className="mt-1 text-lg font-bold text-rose-700">{formatJMDFull(receipt.balanceAfterJmd)}</p></div>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold">截至本次的收款记录 / Payment History</h2>
        <table className="mt-2 w-full">
          <thead><tr className="border-b border-neutral-300 text-left text-neutral-500"><th className="py-2">Receipt</th><th>时间</th><th>方式</th><th>经办</th><th className="text-right">金额</th></tr></thead>
          <tbody>
            {receipt.paymentHistory.map((entry) => (
              <tr key={entry.paymentId} className="border-b border-neutral-200">
                <td className="py-2 font-mono text-[10px]">{entry.receiptNo}</td>
                <td>{formatDateTime(entry.receivedAt)}</td>
                <td>{methodLabelZh(entry.method)}</td>
                <td>{entry.receivedBy}</td>
                <td className="text-right font-bold">{formatJMDFull(entry.amountJmd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(receipt.note || receipt.businessNoteZh || receipt.businessNoteEn) ? (
        <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <h2 className="text-sm font-bold">备注 / Notes</h2>
          {receipt.note ? <p className="mt-1">收款备注：{receipt.note}</p> : null}
          {receipt.businessNoteZh ? <p className="mt-1">{receipt.businessNoteZh}</p> : null}
          {receipt.businessNoteEn ? <p className="mt-1 text-neutral-600">{receipt.businessNoteEn}</p> : null}
        </section>
      ) : null}

      <footer className="mt-8 border-t border-neutral-200 pt-3 text-center text-[10px] text-neutral-400">
        本 Receipt 在收款时生成并冻结；重复打印沿用同一编号和同一内容。<br />
        Whole Hearted Car Service Limited · 16 Ferry Pen, Kingston · WhatsApp 1 876-899-3924 / 1 876-333-3322 · TRN 003650332
      </footer>
    </main>
  );
}
