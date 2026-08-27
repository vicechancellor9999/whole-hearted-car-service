import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

type RouteContext = {
  params: Promise<{ businessOrderId: string; documentId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { businessOrderId, documentId } = await context.params;
  return forwardFormalBackend(
    request,
    `/api/business-orders/${encodeURIComponent(businessOrderId)}/documents/${encodeURIComponent(documentId)}`,
    "none",
  );
}
