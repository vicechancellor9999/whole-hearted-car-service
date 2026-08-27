import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.search;
  return forwardFormalBackend(request, `/api/inspection-reports${query}`, "none");
}

export async function POST(request: Request): Promise<Response> {
  return forwardFormalBackend(request, "/api/inspection-reports", "json");
}
