import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";

export async function GET(request: Request, context: { params: Promise<{ inspectionReportId: string }> }): Promise<Response> {
  const { inspectionReportId } = await context.params;
  return forwardFormalBackend(request, `/api/inspection-reports/${encodeURIComponent(inspectionReportId)}`, "none");
}
