import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request): Promise<Response> {
  return forwardFormalBackend(request, "/api/dashboard", "none");
}
