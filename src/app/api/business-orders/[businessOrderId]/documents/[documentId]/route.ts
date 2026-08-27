import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = {
  params: Promise<{ businessOrderId: string; documentId: string }>;
};
type DocumentApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getDocument(input: { documentId: number; viewerAccountId: number }): Promise<unknown>;
};

export function createBusinessOrderDocumentApiHandler(dependencies: DocumentApiDependencies) {
  return async function businessOrderDocumentApiHandler(context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const route = await context.params;
    const businessOrderId = positiveRouteId(route.businessOrderId);
    const documentId = positiveRouteId(route.documentId);
    if (!businessOrderId || !documentId) {
      return NextResponse.json({ error: "打印文档路径无效" }, { status: 400 });
    }
    try {
      const document = await dependencies.getDocument({
        documentId,
        viewerAccountId: session.account.id,
      }) as { businessOrderId?: number };
      if (document.businessOrderId !== businessOrderId) {
        return NextResponse.json({ error: "打印文档不存在" }, { status: 404 });
      }
      return NextResponse.json(document);
    } catch (error) {
      return businessApiError(error, "打印文档读取失败");
    }
  };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderDocumentApiHandler({
      readSession: currentSession,
      getDocument: (input) => runtime.documents.getDocument(input),
    })(context);
  } finally {
    await runtime.close();
  }
}
