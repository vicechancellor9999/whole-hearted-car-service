import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string; documentId: string; revisionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = await context.params;
  const businessOrderId = positiveRouteId(params.businessOrderId);
  const documentId = positiveRouteId(params.documentId);
  const revisionId = positiveRouteId(params.revisionId);
  if (!businessOrderId || !documentId || !revisionId) return NextResponse.json({ error: "打印文件路径无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try {
    const detail = await runtime.documents.getDocumentDetail({ documentId, viewerAccountId: session.account.id });
    if (detail.document.businessOrderId !== businessOrderId) return NextResponse.json({ error: "打印文档不存在" }, { status: 404 });
    const file = await runtime.documents.getRevisionFile({ documentId, revisionId, viewerAccountId: session.account.id });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    const safeName = file.originalName.replaceAll(/["\r\n]/g, "_");
    return new Response(file.bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(file.sizeBytes),
        "content-disposition": `${disposition}; filename="${safeName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return businessApiError(error, "打印文件读取失败");
  } finally {
    await runtime.close();
  }
}
