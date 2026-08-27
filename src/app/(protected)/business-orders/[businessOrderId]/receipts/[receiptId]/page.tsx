import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PrintButton } from "@/app/(protected)/business-orders/[businessOrderId]/print-button";
import { currentSession } from "@/modules/auth/current-session";
import { createPaymentRuntime } from "@/modules/payment/payment-runtime";
import { PaymentNotFoundError } from "@/modules/payment/payment-service";
import { requirePermission } from "@/modules/permissions/require-permission";

const categoryLabels = {
  labor: ["工时", "Labor"],
  part: ["配件", "Parts"],
  other: ["其他费用", "Other charges"],
} as const;

const noteLabels = {
  customer_concern: ["客户诉求", "Customer concern"],
  work_instruction: ["施工说明", "Work instruction"],
  liability_notice: ["责任与提前告知", "Liability and advance notice"],
  internal: ["内部备注", "Internal note"],
} as const;

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function ReceiptPage({ params, searchParams }: {
  params: Promise<{ businessOrderId: string; receiptId: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  await connection();
  const [session, route, query] = await Promise.all([currentSession(), params, searchParams]);
  const viewer = requirePermission(session, "business.read.all");
  const businessOrderId = Number(route.businessOrderId);
  const receiptId = Number(route.receiptId);
  if (!Number.isSafeInteger(businessOrderId) || !Number.isSafeInteger(receiptId)) notFound();
  const runtime = createPaymentRuntime();
  try {
    let receipt;
    try {
      receipt = await runtime.service.getReceipt({ receiptId, viewerAccountId: viewer.id });
    } catch (error) {
      if (error instanceof PaymentNotFoundError) notFound();
      throw error;
    }
    if (receipt.businessOrderId !== businessOrderId) notFound();
    const snapshot = receipt.snapshot;
    const english = query.copy === "en";
    const language = english ? 1 : 0;
    const visibleNotes = snapshot.charges.notes.filter((note) => note.kind !== "internal");
    return (
      <main className="document-page receipt-document">
        <nav className="document-toolbar">
          <Link href={`/business-orders/${businessOrderId}`}>返回 Business Order</Link>
          <Link href={`?copy=${english ? "zh" : "en"}`}>{english ? "中文版" : "English copy"}</Link>
          <PrintButton />
        </nav>
        <header className="document-header">
          <div><p>Whole Hearted Car Service Limited</p><h1>{english ? "Receipt" : "收款收据 / Receipt"}</h1></div>
          <div><strong>{receipt.receiptNo}</strong><span>Business Order: {snapshot.businessOrder.orderNo}</span></div>
        </header>
        <section className="document-facts">
          <span>{english ? "Customer" : "客户"}<strong>{snapshot.businessOrder.payerName}</strong></span>
          <span>{english ? "Vehicle" : "车辆"}<strong>{snapshot.businessOrder.plate} · {snapshot.businessOrder.vehicleDescription}</strong></span>
          <span>VIN<strong>{snapshot.businessOrder.vin ?? "—"}</strong></span>
          <span>{english ? "Receipt time" : "收款时间"}<strong>{new Date(snapshot.currentPayment.paidAt).toLocaleString(english ? "en-JM" : "zh-CN", { timeZone: "America/Jamaica", hour12: false })}</strong></span>
        </section>
        <section className="document-section">
          <h2>{english ? "Charges" : "收费项目"}</h2>
          {(Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>).map((kind) => {
            const items = snapshot.charges.items.filter((item) => item.kind === kind);
            if (items.length === 0) return null;
            return <section className="document-charge-group" key={kind}><h3>{categoryLabels[kind][language]}</h3>{items.map((item, index) => <div className="document-charge-row" key={`${kind}-${index}`}><span><strong>{english ? item.nameEn || item.nameZh : item.nameZh}</strong><small>{english ? item.descriptionEn || item.descriptionZh : item.descriptionZh}{item.itemDiscountMinor > 0 ? ` · ${english ? "Item discount" : "本项折扣"} ${money(item.itemDiscountMinor)}` : ""}</small></span><span>{item.quantity} {english ? item.unitLabelEn || item.unitLabelZh : item.unitLabelZh}</span><span>{money(item.unitPriceMinor)}</span><strong>{money(item.subtotalMinor)}</strong></div>)}</section>;
          })}
          <div className="document-totals">
            <span>{english ? "Labor discount" : "工时折扣"}<strong>{money(snapshot.charges.totals.laborDiscountMinor)}</strong></span>
            <span>{english ? "Parts discount" : "配件折扣"}<strong>{money(snapshot.charges.totals.partDiscountMinor)}</strong></span>
            <span>{english ? "Other discount" : "其他费用折扣"}<strong>{money(snapshot.charges.totals.otherDiscountMinor)}</strong></span>
            <span>{english ? "Total due (tax included)" : "折后应收（含税）"}<strong>{money(snapshot.charges.totals.totalDueMinor)}</strong></span>
            <span>{english ? "Included 15% GCT" : "其中含 15% GCT"}<strong>{money(snapshot.charges.totals.includedGctMinor)}</strong></span>
          </div>
        </section>
        <section className="document-section">
          <h2>{english ? "Payment and refund history at issue time" : "出具本收据时的收付款历史"}</h2>
          <div className="document-ledger">{snapshot.transactions.map((transaction) => <div key={`${transaction.type}-${transaction.referenceNo}`}><span>{new Date(transaction.occurredAt).toLocaleString(english ? "en-JM" : "zh-CN", { timeZone: "America/Jamaica", hour12: false })}</span><strong>{transaction.type === "payment" ? (english ? "Payment" : "收款") : (english ? "Refund" : "退款")} · {transaction.referenceNo}</strong><span>{english ? transaction.methodLabelEn || transaction.methodLabelZh : transaction.methodLabelZh}</span><b>{transaction.type === "refund" ? "−" : "+"}{money(transaction.amountMinor)}</b></div>)}</div>
          <div className="receipt-current-payment"><span>{english ? "This payment" : "本次收款"}</span><strong>{money(snapshot.currentPayment.amountMinor)}</strong><span>{english ? snapshot.currentPayment.methodLabelEn || snapshot.currentPayment.methodLabelZh : snapshot.currentPayment.methodLabelZh}</span></div>
          <div className="document-totals compact"><span>{english ? "Total paid" : "累计收款"}<strong>{money(snapshot.totals.totalPaidMinor)}</strong></span><span>{english ? "Total refunded" : "累计退款"}<strong>{money(snapshot.totals.totalRefundedMinor)}</strong></span><span>{english ? "Balance after this payment" : "本次收款后余额"}<strong>{money(snapshot.totals.balanceAfterMinor)}</strong></span></div>
        </section>
        {visibleNotes.length > 0 ? <section className="document-section"><h2>{english ? "Notes and notices" : "备注与提前告知"}</h2>{visibleNotes.map((note) => <article className="document-note" key={note.kind}><strong>{noteLabels[note.kind][language]}</strong><p>{english ? note.contentEn || note.contentZh : note.contentZh || note.contentEn}</p></article>)}</section> : null}
        <footer className="document-footer"><span>{english ? "This Receipt confirms only the payment shown above." : "本 Receipt 仅确认上述本次收款事实。"}</span><span>{receipt.receiptNo}</span></footer>
      </main>
    );
  } finally {
    await runtime.close();
  }
}
