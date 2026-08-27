import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

type RouteContext = { params: Promise<{ businessOrderId: string }> };

async function forward(request: Request, context: RouteContext, body: "none" | "json") {
  const { businessOrderId } = await context.params;
  return forwardFormalBackend(
    request,
    `/api/business-orders/${encodeURIComponent(businessOrderId)}/documents`,
    body,
  );
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return forward(request, context, "none");
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return forward(request, context, "json");
}
