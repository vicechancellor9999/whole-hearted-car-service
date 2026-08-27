import { Suspense } from "react";
import { FormalReceiptPrintSheet } from "@/components/orders/formal-business-order-print";

export const dynamic = "force-dynamic";

export default function PaymentReceiptPrintPage({
  params,
  searchParams,
}: {
  params: { id: string; paymentId: string };
  searchParams?: { copy?: string };
}) {
  const copy = searchParams?.copy === "en" ? "en" : "zh";
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-soft">加载 Receipt…</div>}>
      <FormalReceiptPrintSheet orderId={Number(params.id)} receiptId={Number(params.paymentId)} copy={copy} />
    </Suspense>
  );
}
