import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

type RouteContext = {
  params: Promise<{ businessOrderId: string; receiptId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { businessOrderId, receiptId } = await context.params;
  return forwardFormalBackend(
    request,
    `/api/business-orders/${encodeURIComponent(businessOrderId)}/receipts/${encodeURIComponent(receiptId)}`,
    "none",
  );
}
