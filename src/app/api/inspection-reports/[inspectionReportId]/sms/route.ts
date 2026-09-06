import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import { apiActionContext, businessApiError } from "@formal/app/api/business-orders/api-helpers";
import { createInspectionSmsGatewayFromEnv } from "@formal/modules/inspection-report/sms-gateway";

type RouteContext = { params: Promise<{ inspectionReportId: string }> };

function positiveRouteId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const inspectionReportId = positiveRouteId((await context.params).inspectionReportId);
  if (!inspectionReportId) {
    return NextResponse.json({ error: "Inspection Report 编号无效" }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as {
    targetContact?: unknown;
    message?: unknown;
  } | null;
  const targetContact = typeof body?.targetContact === "string" ? body.targetContact.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!targetContact || !message || message.length > 1500) {
    return NextResponse.json({ error: "短信号码或内容无效" }, { status: 400 });
  }

  const runtime = createBusinessOrderRuntime();
  try {
    await runtime.inspectionReports.getInspectionReport({
      inspectionReportId,
      viewerAccountId: session.account.id,
    });
    const provider = await createInspectionSmsGatewayFromEnv().send({
      to: targetContact,
      message,
    });
    const communication = await runtime.inspectionReports.recordInspectionReportCommunication({
      inspectionReportId,
      channel: "sms",
      targetContact,
      noteOrReply: provider.providerReference
        ? `短信接口已接受发送 · ${provider.providerReference}`
        : "短信接口已接受发送",
      status: "initiated",
      context: apiActionContext(request, session.account.id),
    });
    return NextResponse.json({ communication, providerReference: provider.providerReference }, { status: 201 });
  } catch (error) {
    return businessApiError(error, "短信发送失败");
  } finally {
    await runtime.close();
  }
}
