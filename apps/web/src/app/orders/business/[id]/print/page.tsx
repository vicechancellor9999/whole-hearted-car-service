import { Suspense } from "react";
import { QuickOrderPrintSheet } from "@/components/orders/quick-order-print";

export default async function QuickOrderPrintRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="p-6 text-sm">读取中…</div>}>
      <QuickOrderPrintSheet orderId={decodeURIComponent(id)} />
    </Suspense>
  );
}
