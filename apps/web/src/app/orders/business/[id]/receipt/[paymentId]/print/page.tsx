import { Suspense } from "react";
import { FormalReceiptPrintSheet } from "@/components/orders/formal-business-order-print";

export const dynamic = "force-dynamic";

export default async function PaymentReceiptPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; paymentId: string }>;
  searchParams?: Promise<{ copy?: string }>;
}) {
  const [{ id, paymentId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ copy?: string }>({}),
  ]);
  const copy = resolvedSearchParams.copy === "en" ? "en" : "zh";
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-soft">加载 Receipt…</div>}>
      <FormalReceiptPrintSheet orderId={Number(id)} receiptId={Number(paymentId)} copy={copy} />
    </Suspense>
  );
}
