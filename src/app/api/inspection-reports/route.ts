import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type InspectionReportsApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  list(input: {
    viewerAccountId: number;
    page?: number;
    sourceBusinessOrderId?: number;
    search?: string;
  }): Promise<unknown>;
  create?(input: {
    vehicleId: number;
    sourceBusinessOrderId?: number | null;
    inspectionTeamId: number;
    actualInspectorStaffMemberId?: number | null;
    summaryZh: string;
    specialCaseNotesZh?: string | null;
    findings: Array<{ findingZh: string; recommendationZh?: string | null }>;
    context: { actorAccountId: number; requestId: string; ipAddress: string | null; userAgent: string | null };
  }): Promise<unknown>;
};

function positiveQuery(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function createInspectionReportsApiHandler(dependencies: InspectionReportsApiDependencies) {
  return async function inspectionReportsApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    try {
      if (request.method === "POST") {
        const body = await request.json().catch(() => null) as {
          vehicleId?: unknown;
          sourceBusinessOrderId?: unknown;
          inspectionTeamId?: unknown;
          actualInspectorStaffMemberId?: unknown;
          summaryZh?: unknown;
          specialCaseNotesZh?: unknown;
          findings?: unknown;
        } | null;
        const inspectorId = body?.actualInspectorStaffMemberId;
        if (!body
          || !Number.isSafeInteger(body.vehicleId) || Number(body.vehicleId) <= 0
          || !Number.isSafeInteger(body.inspectionTeamId) || Number(body.inspectionTeamId) <= 0
          || typeof body.summaryZh !== "string" || !body.summaryZh.trim()
          || (inspectorId != null && (!Number.isSafeInteger(inspectorId) || Number(inspectorId) <= 0))
          || (body.specialCaseNotesZh != null && typeof body.specialCaseNotesZh !== "string")
          || (body.findings != null && !Array.isArray(body.findings))
          || !dependencies.create) {
          return NextResponse.json({ error: "Inspection Report 创建内容无效" }, { status: 400 });
        }
        const report = await dependencies.create({
          vehicleId: Number(body.vehicleId),
          sourceBusinessOrderId: Number.isSafeInteger(body.sourceBusinessOrderId)
            ? Number(body.sourceBusinessOrderId)
            : null,
          inspectionTeamId: Number(body.inspectionTeamId),
          actualInspectorStaffMemberId: inspectorId == null ? null : Number(inspectorId),
          summaryZh: body.summaryZh,
          specialCaseNotesZh: typeof body.specialCaseNotesZh === "string" ? body.specialCaseNotesZh : null,
          findings: (body.findings ?? []) as Array<{ findingZh: string; recommendationZh?: string | null }>,
          context: {
            actorAccountId: session.account.id,
            requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
            ipAddress: request.headers.get("x-forwarded-for"),
            userAgent: request.headers.get("user-agent"),
          },
        });
        return NextResponse.json(report, { status: 201 });
      }
      return NextResponse.json(await dependencies.list({
        viewerAccountId: session.account.id,
        ...(positiveQuery(url.searchParams.get("page")) ? { page: positiveQuery(url.searchParams.get("page")) } : {}),
        ...(positiveQuery(url.searchParams.get("sourceBusinessOrderId"))
          ? { sourceBusinessOrderId: positiveQuery(url.searchParams.get("sourceBusinessOrderId")) }
          : {}),
        ...(url.searchParams.get("search") ? { search: url.searchParams.get("search") ?? undefined } : {}),
      }));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 400;
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Inspection Report 查询失败",
      }, { status: Number.isInteger(status) ? status : 400 });
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createInspectionReportsApiHandler({
      readSession: currentSession,
      list: (input) => runtime.inspectionReports.listInspectionReports(input),
      create: (input) => runtime.inspectionReports.createInspectionReport(input),
    })(request);
  } finally {
    await runtime.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createInspectionReportsApiHandler({
      readSession: currentSession,
      list: (input) => runtime.inspectionReports.listInspectionReports(input),
      create: (input) => runtime.inspectionReports.createInspectionReport(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
