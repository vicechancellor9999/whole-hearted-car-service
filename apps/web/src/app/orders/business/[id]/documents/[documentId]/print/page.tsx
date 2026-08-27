import { Suspense } from "react";
import { FormalBusinessOrderDocumentPrintSheet } from "@/components/orders/formal-business-order-print";

export const dynamic = "force-dynamic";

export default function BusinessOrderDocumentPrintPage({
  params,
}: {
  params: { id: string; documentId: string };
}) {
  return <Suspense fallback={<div className="p-8 text-sm">加载打印文档…</div>}><FormalBusinessOrderDocumentPrintSheet orderId={Number(params.id)} documentId={Number(params.documentId)} /></Suspense>;
}
