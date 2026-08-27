import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

type RouteContext = { params: Promise<{ businessOrderId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { businessOrderId } = await context.params;
  return forwardFormalBackend(
    request,
    `/api/business-orders/${encodeURIComponent(businessOrderId)}/refunds`,
    "form",
  );
}
