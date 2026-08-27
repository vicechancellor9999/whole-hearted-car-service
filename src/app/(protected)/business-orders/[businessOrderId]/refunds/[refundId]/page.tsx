import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { businessOrderFinanceAction } from "@/app/(protected)/business-orders/[businessOrderId]/finance-actions";
import { PrintButton } from "@/app/(protected)/business-orders/[businessOrderId]/print-button";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import { BusinessOrderNotFoundError } from "@/modules/business-order/business-order-service";
import {
  PaymentNotFoundError,
  type RefundEvidenceRecord,
} from "@/modules/payment/payment-service";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";

type FormAction = (formData: FormData) => void | Promise<void>;

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RefundEvidenceSection({
  action,
  businessOrderId,
  canUpload,
  evidence,
  refundId,
  requiresProof,
}: {
  action: FormAction;
  businessOrderId: number;
  canUpload: boolean;
  evidence: RefundEvidenceRecord[];
  refundId: number;
  requiresProof: boolean;
}) {
  const proof = evidence.find((file) => file.kind === "refund_proof");
  const signature = evidence.find((file) => file.kind === "customer_signature");
  return (
    <section className="document-section">
      <h2>退款凭证与签收单归档 / Evidence</h2>
      <div className="refund-evidence-list">
        {!requiresProof ? (
          <p>现金退款不需要另传转账凭证。</p>
        ) : proof ? (
          <>
            <Link href={`/api/refund-evidence/${proof.fileId}`}>退款凭证 · {proof.originalName}</Link>
            <p>退款凭证已归档，不允许替换。</p>
          </>
        ) : (
          <>
            <strong>退款凭证待补</strong>
            <p>退款记录已经成立；实际完成非现金退款后，在这里追加凭证。</p>
          </>
        )}
        {signature ? (
          <Link href={`/api/refund-evidence/${signature.fileId}`}>已签字退款签收单 · {signature.originalName}</Link>
        ) : (
          <strong>签字后的退款签收单待回传（可选）</strong>
        )}
      </div>
      {requiresProof && !proof && canUpload ? (
        <form action={action} className="document-toolbar refund-proof-upload">
          <input name="operation" type="hidden" value="append_refund_proof" />
          <input name="businessOrderId" type="hidden" value={businessOrderId} />
          <input name="refundId" type="hidden" value={refundId} />
          <label>
            上传实际退款凭证
            <input accept="image/jpeg,image/png,image/webp,application/pdf" aria-label="上传实际退款凭证" name="proof" required type="file" />
          </label>
          <button type="submit">上传退款凭证</button>
        </form>
      ) : null}
      {!signature && canUpload ? (
        <form action={action} className="document-toolbar refund-proof-upload">
          <input name="operation" type="hidden" value="append_refund_signed_acknowledgement" />
          <input name="businessOrderId" type="hidden" value={businessOrderId} />
          <input name="refundId" type="hidden" value={refundId} />
          <label>
            上传签字后的退款签收单
            <input accept="image/jpeg,image/png,image/webp,application/pdf" aria-label="上传签字后的退款签收单" name="signedAcknowledgement" required type="file" />
          </label>
          <button type="submit">上传签收单</button>
        </form>
      ) : null}
    </section>
  );
}

export default async function RefundAcknowledgementPage({ params, searchParams }: {
  params: Promise<{ businessOrderId: string; refundId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await connection();
  const [session, route, query] = await Promise.all([currentSession(), params, searchParams]);
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
    const canUpload = hasPermission(
      viewer.role,
      "sensitive_operations.execute",
      viewer.delegatedPermissions,
    );
    return (
      <main className="document-page refund-document">
        <nav className="document-toolbar"><Link href={`/business-orders/${businessOrderId}`}>返回 Business Order</Link><PrintButton /></nav>
        {query.success ? <p className="success-message">{query.success}</p> : null}
        {query.error ? <p className="error-message">{query.error}</p> : null}
        <header className="document-header"><div><p>Whole Hearted Car Service Limited</p><h1>退款说明与客户签收单</h1><small>Refund Explanation and Customer Acknowledgement</small></div><div><strong>{refund.refundNo}</strong><span>Business Order: {order.orderNo}</span></div></header>
        <section className="document-facts"><span>客户 / Customer<strong>{order.payer.displayName}</strong></span><span>车辆 / Vehicle<strong>{order.vehicle.plate} · {order.vehicle.description}</strong></span><span>退款时间 / Time<strong>{refund.refundedAt.toLocaleString("zh-CN", { timeZone: "America/Jamaica", hour12: false })}</strong></span><span>退款方式 / Method<strong>{refund.paymentMethodLabelZh}{refund.paymentMethodLabelEn ? ` / ${refund.paymentMethodLabelEn}` : ""}</strong></span></section>
        <section className="refund-amount-box"><span>退款金额 / Refund amount</span><strong>{money(refund.amountMinor)}</strong></section>
        <section className="document-section"><h2>退款说明 / Explanation</h2><p>{refund.reason}</p><p><strong>原客户单据：</strong>{refund.originalDocumentStatus === "returned" ? "原单已交回 / Original document returned" : "原单无法交回 / Original document unavailable"}</p>{refund.originalDocumentNote ? <p><strong>说明：</strong>{refund.originalDocumentNote}</p> : null}</section>
        <RefundEvidenceSection action={businessOrderFinanceAction} businessOrderId={businessOrderId} canUpload={canUpload} evidence={refund.evidence} refundId={refund.id} requiresProof={refund.paymentMethodCode !== "cash"} />
        <section className="refund-acknowledgement"><p>本人确认已经收到上述退款，并确认本单所述退款部分的客户服务关系已经终结。</p><p>I confirm receipt of the refund above and acknowledge that the customer service relationship for the refunded portion is concluded.</p><div><span>客户签名 / Customer signature<strong>________________________</strong></span><span>日期 / Date<strong>________________________</strong></span></div></section>
        <footer className="document-footer"><span>本页同时作为退款说明与客户签收证明，不另行拆分单据。</span><span>{refund.refundNo}</span></footer>
      </main>
    );
  } finally {
    await runtime.close();
  }
}
