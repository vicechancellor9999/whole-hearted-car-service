import { FormalBusinessOrderDetailView } from "@/components/orders/formal-business-order-detail";

export default async function BusinessOrderDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const businessOrderId = Number(id);
  if (!Number.isSafeInteger(businessOrderId) || businessOrderId < 1) {
    return <div className="p-6 text-sm font-semibold text-rose-600">Business Order 编号无效。</div>;
  }
  return <FormalBusinessOrderDetailView businessOrderId={businessOrderId} />;
}
