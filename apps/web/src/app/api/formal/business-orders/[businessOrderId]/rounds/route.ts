import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

async function forward(request: Request, params: Promise<{ businessOrderId: string }>, body: "none" | "json") {
  const { businessOrderId } = await params;
  return forwardFormalBackend(request, `/api/business-orders/${encodeURIComponent(businessOrderId)}/rounds`, body);
}

export async function GET(request: Request, context: { params: Promise<{ businessOrderId: string }> }) { return forward(request, context.params, "none"); }
export async function POST(request: Request, context: { params: Promise<{ businessOrderId: string }> }) { return forward(request, context.params, "json"); }
