import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return forwardFormalBackend(request, `/api/performance?month=${encodeURIComponent(month)}`, "none");
}
