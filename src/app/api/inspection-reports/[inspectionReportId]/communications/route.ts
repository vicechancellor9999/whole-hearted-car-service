import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ inspectionReportId: string }> };

function positiveRouteId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const inspectionReportId = positiveRouteId((await context.params).inspectionReportId);
  if (!inspectionReportId) return NextResponse.json({ error: "Inspection Report 编号无效" }, { status: 400 });
  const body = await request.json().catch(() => null) as { channel?: unknown; targetContact?: unknown; noteOrReply?: unknown; status?: unknown; eventKind?: unknown } | null;
  if (!body || typeof body.channel !== "string" || typeof body.targetContact !== "string") {
    return NextResponse.json({ error: "通知内容无效" }, { status: 400 });
  }
  const runtime = createBusinessOrderRuntime();
  try {
    const communication = await runtime.inspectionReports.recordInspectionReportCommunication({
      inspectionReportId,
      channel: body.channel as "sms" | "email" | "whatsapp",
      targetContact: body.targetContact,
      noteOrReply: typeof body.noteOrReply === "string" ? body.noteOrReply : null,
      status: body.status === "confirmed" || body.status === "not_delivered" ? body.status : "initiated",
      eventKind: body.eventKind === "reply" || body.eventKind === "status_correction" ? body.eventKind : "notification",
      context: {
        actorAccountId: session.account.id,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    });
    return NextResponse.json(communication, { status: 201 });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "通知记录失败" }, { status });
  } finally {
    await runtime.close();
  }
}
