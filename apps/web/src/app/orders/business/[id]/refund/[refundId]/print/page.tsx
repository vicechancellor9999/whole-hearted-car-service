import { Suspense } from "react";
import { FormalRefundAcknowledgementPrintSheet } from "@/components/orders/formal-refund-acknowledgement-print";

export const dynamic = "force-dynamic";

export default function RefundReceiptPrintPage({
  params,
}: {
  params: { id: string; refundId: string };
}) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-soft">加载退款单…</div>}>
      <FormalRefundAcknowledgementPrintSheet orderId={Number(params.id)} refundId={Number(params.refundId)} />
    </Suspense>
  );
}
