import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request): Promise<Response> {
  return forwardFormalBackend(request, "/api/master-data", "none");
}

export async function POST(request: Request): Promise<Response> {
  return forwardFormalBackend(request, "/api/master-data", "json");
}
