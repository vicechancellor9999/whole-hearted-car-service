"use client";

import { methodLabelEn, methodLabelZh } from "@/lib/payments/method-dictionary";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client";
import type { QuickOrder, QuickRefund } from "@/lib/orders/quick-order-types";
import { formatDateTime, formatJMDFull } from "@/lib/utils";

const ORIGINAL_DOCUMENT_LABELS = {
  returned: "原发票已交回",
  unavailable: "原单无法交回",
  not_issued: "未曾出具原发票",
} as const;

/** 一笔退款只生成这一张退款说明与签收单，全部内容来自退款时冻结的事实快照。 */
export function RefundReceiptPrintSheet({ orderId, refundId }: { orderId: string; refundId: string }) {
  const params = useSearchParams();
  const pdfMode = params.get("pdf") === "1";
  const [order, setOrder] = useState<QuickOrder | null>(null);
  const [refund, setRefund] = useState<QuickRefund | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const detail = await api.quickOrders.detail(orderId);
        setOrder(detail);
        setRefund(detail.refunds.find((candidate) => candidate.id === refundId) ?? null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "加载失败");
      }
    })();
  }, [orderId, refundId]);

  if (error) return <div className="p-8 text-sm font-semibold text-rose-600">{error}</div>;
  if (!order || !refund) return <div className="p-8 text-sm text-ink-soft">加载退款说明与签收单…</div>;
  const document = refund.document;
  const customerName = [document.customer.nameZh, document.customer.nameEn].filter(Boolean).join(" / ");
  const modelText = [document.vehicle.modelZh, document.vehicle.modelEn].filter(Boolean).join(" / ");

  return (
    <div data-testid={`refund-receipt-${refund.id}`} className="mx-auto max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed text-neutral-900 print:p-8">
      <style>{`@media print { .no-print { display: none; } body { background: white; } }`}</style>
      {!pdfMode && (
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href={`/orders/business/${order.id}`} data-testid="refund-receipt-back"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft hover:text-primary">
          ← 返回 Business Order
        </Link>
        <button type="button" onClick={() => window.print()} data-testid="refund-receipt-print"
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">打印 / 存 PDF</button>
      </div>
      )}

      <header className="flex items-start justify-between border-b-2 border-blue-800 pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="Whole Hearted" className="h-14 w-14 flex-shrink-0 rounded-xl object-cover" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-blue-900">Whole Hearted Car Service Limited</h1>
            <p className="text-xs tracking-wide text-neutral-500">全心全意汽修服务 · Kingston, Jamaica</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold uppercase tracking-widest text-blue-700">退款说明与签收单</p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Refund Statement & Acknowledgement</p>
          <p className="mt-1 text-xs font-semibold text-neutral-700">{refund.receiptNo}</p>
        </div>
      </header>

      <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
        兹证明：以下款项已经退还。本单集中记录退款原因、原发票处理、退款凭证及客户签收；该部分客户服务关系至此终结。
      </p>

      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <p><span className="text-neutral-500">Business Order：</span><b>{document.businessOrderNo}</b></p>
        <p><span className="text-neutral-500">退款单号：</span><b>{refund.receiptNo}</b></p>
        <p><span className="text-neutral-500">客户：</span><b>{customerName}</b>{document.customer.phone ? ` · ${document.customer.phone}` : ""}</p>
        <p><span className="text-neutral-500">车辆：</span><b>{document.vehicle.plate}</b>{modelText ? ` · ${modelText}` : ""}</p>
        <p><span className="text-neutral-500">退款方式：</span><b>{methodLabelZh(refund.method)} / {methodLabelEn(refund.method)}</b></p>
        <p><span className="text-neutral-500">退款日期：</span><b>{formatDateTime(refund.refundedAt)}</b></p>
      </section>

      <section className="mt-5">
        <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold text-neutral-800">退款事实 / Refund Fact</h2>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 rounded-lg border border-neutral-200 p-4 text-sm">
          <span className="text-neutral-500">退款原因</span><b>{refund.reason}</b>
          <span className="text-neutral-500">原发票处理</span><b>{ORIGINAL_DOCUMENT_LABELS[refund.originalDocumentStatus]}</b>
          {refund.originalDocumentNote ? <><span className="text-neutral-500">原单说明</span><b>{refund.originalDocumentNote}</b></> : null}
          <span className="text-neutral-500">本次退款</span><b className="text-xl text-rose-700">{formatJMDFull(refund.amountJmd)}</b>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-3 gap-3 rounded-lg bg-neutral-50 p-4 text-center text-sm">
        <div><p className="text-neutral-500">累计收款</p><b>{formatJMDFull(document.paidToDateJmd)}</b></div>
        <div><p className="text-neutral-500">累计退款</p><b>{formatJMDFull(document.refundedToDateJmd)}</b></div>
        <div><p className="text-neutral-500">本次退款后未付</p><b>{formatJMDFull(document.balanceAfterJmd)}</b></div>
      </section>

      <section className="mt-5">
        <h2 className="border-b border-neutral-300 pb-1 text-sm font-bold text-neutral-800">退款凭证</h2>
        {refund.proof ? <a href={refund.proof.dataUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700">
          打开退款凭证：{refund.proof.fileName}
        </a> : <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">退款已记录，转账回单等退款凭证待款项退回后补充。</p>}
        {refund.proof?.mimeType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={refund.proof.dataUrl} alt="退款凭证" className="mt-3 max-h-56 rounded-lg border border-neutral-200 object-contain" />
        ) : null}
      </section>

      <section className="mt-8 flex items-end justify-between gap-8">
        <div className="text-sm">
          <p className="text-neutral-500">经办人：{refund.refundedBy}</p>
        </div>
        {refund.signature ? <div className="text-center text-sm">
          <p className="text-neutral-500">客户确认已收到现金退款</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={refund.signature.photoDataUrl} alt="客户退款签字" className="mt-2 max-h-24 w-48 object-contain" />
          <p className="mt-1 text-xs text-neutral-500">{refund.signature.signerName} · {formatDateTime(refund.signature.signedAt)}</p>
        </div> : <p className="text-sm text-neutral-500">非现金退款：以退款凭证证明款项已经退回。</p>}
      </section>

      <footer className="mt-8 border-t border-neutral-200 pt-3 text-center text-[11px] text-neutral-400">
        Whole Hearted Car Service Limited · 16 Ferry Pen, Kingston · WhatsApp 1 876-899-3924 / 1 876-333-3322 · TRN 003650332
      </footer>
    </div>
  );
}
