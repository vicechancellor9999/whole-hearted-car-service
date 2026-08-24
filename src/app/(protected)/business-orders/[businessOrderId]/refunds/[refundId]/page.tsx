import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PrintButton } from "@/app/(protected)/business-orders/[businessOrderId]/print-button";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import { BusinessOrderNotFoundError } from "@/modules/business-order/business-order-service";
import { PaymentNotFoundError } from "@/modules/payment/payment-service";
import { requirePermission } from "@/modules/permissions/require-permission";

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function RefundAcknowledgementPage({ params }: {
  params: Promise<{ businessOrderId: string; refundId: string }>;
}) {
  await connection();
  const [session, route] = await Promise.all([currentSession(), params]);
  const viewer = requirePermission(session, "business.read.all");
  const businessOrderId = Number(route.businessOrderId);
  const refundId = Number(route.refundId);
  if (!Number.isSafeInteger(businessOrderId) || !Number.isSafeInteger(refundId)) notFound();
  const runtime = createBusinessOrderRuntime();
  try {
    let refund;
    let order;
    try {
      [refund, order] = await Promise.all([
        runtime.payments.getRefund({ refundId, viewerAccountId: viewer.id }),
        runtime.service.getBusinessOrder({ businessOrderId, viewerAccountId: viewer.id }),
      ]);
    } catch (error) {
      if (error instanceof PaymentNotFoundError || error instanceof BusinessOrderNotFoundError) notFound();
      throw error;
    }
    if (refund.businessOrderId !== businessOrderId) notFound();
    const signature = refund.evidence.find((file) => file.kind === "customer_signature");
    return (
      <main className="document-page refund-document">
        <nav className="document-toolbar"><Link href={`/business-orders/${businessOrderId}`}>返回 Business Order</Link><PrintButton /></nav>
        <header className="document-header"><div><p>Whole Hearted Car Service Limited</p><h1>退款说明与客户签收单</h1><small>Refund Explanation and Customer Acknowledgement</small></div><div><strong>{refund.refundNo}</strong><span>Business Order: {order.orderNo}</span></div></header>
        <section className="document-facts"><span>客户 / Customer<strong>{order.payer.displayName}</strong></span><span>车辆 / Vehicle<strong>{order.vehicle.plate} · {order.vehicle.description}</strong></span><span>退款时间 / Time<strong>{refund.refundedAt.toLocaleString("zh-CN", { timeZone: "America/Jamaica", hour12: false })}</strong></span><span>退款方式 / Method<strong>{refund.paymentMethodLabelZh}{refund.paymentMethodLabelEn ? ` / ${refund.paymentMethodLabelEn}` : ""}</strong></span></section>
        <section className="refund-amount-box"><span>退款金额 / Refund amount</span><strong>{money(refund.amountMinor)}</strong></section>
        <section className="document-section"><h2>退款说明 / Explanation</h2><p>{refund.reason}</p><p><strong>原客户单据：</strong>{refund.originalDocumentStatus === "returned" ? "原单已交回 / Original document returned" : "原单无法交回 / Original document unavailable"}</p>{refund.originalDocumentNote ? <p><strong>说明：</strong>{refund.originalDocumentNote}</p> : null}</section>
        <section className="document-section"><h2>退款凭证与签收证据 / Evidence</h2><div className="refund-evidence-list">{refund.evidence.map((file) => <Link href={`/api/refund-evidence/${file.fileId}`} key={file.fileId}>{file.kind === "refund_proof" ? "退款凭证" : "客户签字证据"} · {file.originalName}</Link>)}</div></section>
        <section className="refund-acknowledgement"><p>本人确认已经收到上述退款，并确认本单所述退款部分的客户服务关系已经终结。</p><p>I confirm receipt of the refund above and acknowledge that the customer service relationship for the refunded portion is concluded.</p><div><span>客户签名 / Customer signature<strong>{signature ? `已上传：${signature.originalName}` : "________________________"}</strong></span><span>日期 / Date<strong>________________________</strong></span></div></section>
        <footer className="document-footer"><span>本页同时作为退款说明与客户签收证明，不另行拆分单据。</span><span>{refund.refundNo}</span></footer>
      </main>
    );
  } finally {
    await runtime.close();
  }
}
