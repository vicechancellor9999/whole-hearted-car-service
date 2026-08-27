import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function POST(request: Request, context: { params: Promise<{ inspectionReportId: string }> }): Promise<Response> {
  const { inspectionReportId } = await context.params;
  return forwardFormalBackend(request, `/api/inspection-reports/${encodeURIComponent(inspectionReportId)}/communications`, "json");
}
