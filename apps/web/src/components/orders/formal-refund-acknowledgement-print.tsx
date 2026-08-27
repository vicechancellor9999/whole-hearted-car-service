"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchFormalBusinessOrder,
  formatFormalMoney,
  type FormalBusinessOrderDetail,
} from "@/lib/api/formal-business-orders";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "@/lib/company-identity";

const ORIGINAL_DOCUMENT_LABELS = {
  returned: "原客户单据已交回 / Original customer document returned",
  unavailable: "原客户单据无法交回 / Original customer document unavailable",
} as const;

const METHOD_LABELS: Record<string, string> = {
  cash: "现金 / Cash",
  bank_transfer: "银行转账 / Bank transfer",
  card: "银行卡 / Card",
};

function businessTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function FormalRefundAcknowledgementPrintSheet({
  orderId,
  refundId,
}: {
  orderId: number;
  refundId: number;
}) {
  const [detail, setDetail] = useState<FormalBusinessOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchFormalBusinessOrder(orderId)
      .then((value) => { if (active) setDetail(value); })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "退款签收单加载失败");
      });
    return () => { active = false; };
  }, [orderId]);

  if (error) return <div className="p-8 text-sm font-semibold text-rose-600">{error}</div>;
  if (!detail) return <div className="p-8 text-sm text-slate-500">加载退款签收单…</div>;
  const refund = detail.refunds.find((candidate) => candidate.id === refundId);
  if (!refund) return <div className="p-8 text-sm font-semibold text-rose-600">退款记录不存在</div>;

  const { order, ledger } = detail;
  return (
    <main className="formal-print-page mx-auto min-h-screen max-w-[210mm] bg-white px-[12mm] py-[10mm] text-[11px] leading-[1.5] text-slate-900 print:min-h-0 print:max-w-none print:p-0">
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          body { background: #fff !important; }
          .formal-print-toolbar { display: none !important; }
          .formal-print-section { break-inside: avoid; }
        }
      `}</style>
      <nav className="formal-print-toolbar mb-5 flex items-center justify-between gap-3">
        <Link href={`/orders/business/${orderId}`} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">← 返回 Business Order</Link>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white">打印 / 保存 PDF</button>
      </nav>

      <header className="flex items-start justify-between gap-6 border-b-[3px] border-blue-800 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WHOLE_HEARTED_COMPANY_IDENTITY.logoUrl} alt="Whole Hearted" className="h-14 w-14 rounded-xl object-cover" />
          <div><h1 className="text-lg font-black text-blue-950">{WHOLE_HEARTED_COMPANY_IDENTITY.legalName}</h1><p className="text-[10px] text-slate-500">{WHOLE_HEARTED_COMPANY_IDENTITY.address} · {WHOLE_HEARTED_COMPANY_IDENTITY.contactLine} · TRN {WHOLE_HEARTED_COMPANY_IDENTITY.trn}</p></div>
        </div>
        <div className="shrink-0 text-right"><p className="text-base font-black text-blue-900">退款签收单</p><p className="text-[10px] font-semibold text-slate-500">Refund Acknowledgement</p><p className="font-mono text-xs font-bold">{refund.refundNo}</p><p className="text-[10px] text-slate-500">Business Order：{order.orderNo}</p></div>
      </header>

      <section className="formal-print-section mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-300 bg-slate-300">
        {[
          ["费用承担方 / Payer", order.payer.displayName],
          ["联系电话 / Phone", order.payer.phone],
          ["车辆 / Vehicle", `${order.vehicle.plate} · ${order.vehicle.description}`],
          ["车架号 / Chassis No.", order.vehicle.vin],
          ["退款时间 / Refunded at", businessTime(refund.refundedAt)],
          ["退款方式 / Method", METHOD_LABELS[refund.paymentMethodCode] ?? refund.paymentMethodLabelZh],
        ].filter((entry) => entry[1]).map(([label, value]) => <div key={label} className="bg-white p-3"><span className="block text-[9px] font-semibold text-slate-500">{label}</span><strong>{value}</strong></div>)}
      </section>

      <section className="formal-print-section mt-4 rounded-xl border-2 border-rose-700 p-4">
        <p className="text-xs font-bold text-slate-500">本次退款 / Refund amount</p>
        <p className="mt-1 text-3xl font-black text-rose-700">{formatFormalMoney(refund.amountMinor)}</p>
        <div className="mt-3 grid gap-2 border-t border-rose-100 pt-3 sm:grid-cols-2"><p><span className="block text-slate-500">退款原因 / Reason</span><strong>{refund.reason}</strong></p><p><span className="block text-slate-500">原客户单据 / Original document</span><strong>{ORIGINAL_DOCUMENT_LABELS[refund.originalDocumentStatus]}</strong>{refund.originalDocumentNote ? <small className="mt-1 block">{refund.originalDocumentNote}</small> : null}</p></div>
      </section>

      <section className="formal-print-section mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center"><p><span className="block text-slate-500">累计收款 / Total paid</span><strong>{formatFormalMoney(ledger.totalPaidMinor)}</strong></p><p><span className="block text-slate-500">累计退款 / Total refunded</span><strong>{formatFormalMoney(ledger.totalRefundedMinor)}</strong></p><p><span className="block text-slate-500">未结余额 / Outstanding</span><strong>{formatFormalMoney(ledger.balanceMinor)}</strong></p></section>

      <section className="formal-print-section mt-8 rounded-xl border-2 border-slate-500 p-5">
        <p className="font-bold">本人确认已收到上述退款金额，并确认本签收单所列退款信息无误。</p>
        <p className="mt-1 text-slate-600">I acknowledge receipt of the refund amount stated above and confirm that the refund information on this form is correct.</p>
        <div className="mt-12 grid grid-cols-2 gap-x-12 gap-y-10"><p>客户姓名 / Customer name：____________________________</p><p>联系电话 / Phone：____________________________</p><p>客户签字 / Customer signature：____________________________</p><p>签收日期 / Date：____________________________</p><p>经办人 / Staff：____________________________</p><p>复核人 / Verified by：____________________________</p></div>
      </section>

      <p className="mt-4 text-[10px] text-slate-500">处理方式：工作人员登记退款后打印本单，由客户手写签字；纸质原件由工作人员保存，也可将签字件上传系统归档。系统中的退款记录不因签字件上传而改写。</p>
    </main>
  );
}
