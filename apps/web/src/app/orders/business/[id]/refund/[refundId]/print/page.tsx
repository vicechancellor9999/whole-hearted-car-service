import { Suspense } from "react";
import { FormalRefundAcknowledgementPrintSheet } from "@/components/orders/formal-refund-acknowledgement-print";

export const dynamic = "force-dynamic";

export default async function RefundReceiptPrintPage({
  params,
}: {
  params: Promise<{ id: string; refundId: string }>;
}) {
  const { id, refundId } = await params;
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-soft">加载退款单…</div>}>
      <FormalRefundAcknowledgementPrintSheet orderId={Number(id)} refundId={Number(refundId)} />
    </Suspense>
  );
}
