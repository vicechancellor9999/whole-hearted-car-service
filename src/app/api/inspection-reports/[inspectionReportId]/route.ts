import { NextResponse } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ inspectionReportId: string }> };

function positiveRouteId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const inspectionReportId = positiveRouteId((await context.params).inspectionReportId);
  if (!inspectionReportId) return NextResponse.json({ error: "Inspection Report 编号无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try {
    const [item, communications] = await Promise.all([
      runtime.inspectionReports.getInspectionReport({ inspectionReportId, viewerAccountId: session.account.id }),
      runtime.inspectionReports.listInspectionReportCommunications({ inspectionReportId, viewerAccountId: session.account.id }),
    ]);
    return NextResponse.json({ ...item, communications });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inspection Report 读取失败" }, { status });
  } finally {
    await runtime.close();
  }
}
