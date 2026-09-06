import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import { apiActionContext, businessApiError } from "@formal/app/api/business-orders/api-helpers";
import type {
  InspectionReportOrganizedContent,
  InspectionReportQuotation,
} from "@formal/modules/inspection-report/inspection-report-service";

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

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const inspectionReportId = positiveRouteId((await context.params).inspectionReportId);
  if (!inspectionReportId) return NextResponse.json({ error: "Inspection Report 编号无效" }, { status: 400 });
  const body = await request.json().catch(() => null) as {
    expectedVersion?: unknown;
    organized?: unknown;
    quotation?: unknown;
    source?: unknown;
    changeReason?: unknown;
  } | null;
  if (!body || typeof body.organized !== "object" || typeof body.quotation !== "object") {
    return NextResponse.json({ error: "检查报告草稿内容无效" }, { status: 400 });
  }
  const runtime = createBusinessOrderRuntime();
  try {
    const item = await runtime.inspectionReports.updateInspectionReportWorkspace({
      inspectionReportId,
      expectedVersion: Number(body.expectedVersion),
      organized: body.organized as InspectionReportOrganizedContent,
      quotation: body.quotation as InspectionReportQuotation,
      source: body.source === "ai" ? "ai" : "manual",
      changeReason: typeof body.changeReason === "string" ? body.changeReason : "前台更新检查报告草稿",
      context: apiActionContext(request, session.account.id),
    });
    const communications = await runtime.inspectionReports.listInspectionReportCommunications({
      inspectionReportId,
      viewerAccountId: session.account.id,
    });
    return NextResponse.json({ ...item, communications });
  } catch (error) {
    return businessApiError(error, "检查报告草稿保存失败");
  } finally {
    await runtime.close();
  }
}
