import { Suspense } from "react";
import { FormalBusinessOrderDocumentPrintSheet } from "@/components/orders/formal-business-order-print";

export const dynamic = "force-dynamic";

export default async function BusinessOrderDocumentPrintPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  return <Suspense fallback={<div className="p-8 text-sm">加载打印文档…</div>}><FormalBusinessOrderDocumentPrintSheet orderId={Number(id)} documentId={Number(documentId)} /></Suspense>;
}
