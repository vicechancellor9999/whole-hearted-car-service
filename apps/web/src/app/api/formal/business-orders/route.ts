import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return forwardFormalBackend(
    request,
    `/api/business-orders${url.search}`,
    "none",
  );
}

export async function POST(request: Request): Promise<Response> {
  return forwardFormalBackend(request, "/api/business-orders", "json");
}
