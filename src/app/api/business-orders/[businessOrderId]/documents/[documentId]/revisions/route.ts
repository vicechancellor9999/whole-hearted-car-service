import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActionContext, businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string; documentId: string }> };
const revisionSchema = z.object({
  expectedLatestRevisionNo: z.number().int().min(0),
  fieldOverrides: z.record(z.string(), z.string()),
});

async function handle(request: Request, context: RouteContext) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = await context.params;
  const businessOrderId = positiveRouteId(params.businessOrderId);
  const documentId = positiveRouteId(params.documentId);
  if (!businessOrderId || !documentId) return NextResponse.json({ error: "打印文档路径无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try {
    const detail = await runtime.documents.getDocumentDetail({ documentId, viewerAccountId: session.account.id });
    if (detail.document.businessOrderId !== businessOrderId) {
      return NextResponse.json({ error: "打印文档不存在" }, { status: 404 });
    }
    if (request.method === "GET") return NextResponse.json(detail);
    const input = revisionSchema.parse(await request.json());
    const revision = await runtime.documents.createRevision({
      documentId,
      expectedLatestRevisionNo: input.expectedLatestRevisionNo,
      fieldOverrides: input.fieldOverrides,
      context: apiActionContext(request, session.account.id),
    });
    return NextResponse.json(revision, { status: 201 });
  } catch (error) {
    return businessApiError(error, "打印版本操作失败");
  } finally {
    await runtime.close();
  }
}

export function GET(request: Request, context: RouteContext) { return handle(request, context); }
export function POST(request: Request, context: RouteContext) { return handle(request, context); }
