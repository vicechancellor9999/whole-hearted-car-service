import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get("range") ?? "week";
  return forwardFormalBackend(request, `/api/revenue?range=${encodeURIComponent(range)}`, "none");
}
