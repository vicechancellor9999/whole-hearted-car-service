import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiActionContext,
  businessApiError,
  positiveRouteId,
} from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string }> };
type DocumentApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  listDocuments(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  generateOfficeArchive(input: {
    businessOrderId: number;
    context: BusinessOrderActionContext;
  }): Promise<unknown>;
  generateMechanicWorkCopy(input: {
    businessOrderId: number;
    context: BusinessOrderActionContext;
  }): Promise<unknown>;
};

const generateSchema = z.object({
  kind: z.enum(["office_archive", "mechanic_work"]),
});

export function createBusinessOrderDocumentsApiHandler(dependencies: DocumentApiDependencies) {
  return async function businessOrderDocumentsApiHandler(
    request: Request,
    context: RouteContext,
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) {
      return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    }
    try {
      if (request.method === "GET") {
        const documents = await dependencies.listDocuments({
          businessOrderId,
          viewerAccountId: session.account.id,
        });
        return NextResponse.json(documents);
      }
      const input = generateSchema.parse(await request.json());
      const actionInput = {
        businessOrderId,
        context: apiActionContext(request, session.account.id),
      };
      const document = input.kind === "office_archive"
        ? await dependencies.generateOfficeArchive(actionInput)
        : await dependencies.generateMechanicWorkCopy(actionInput);
      return NextResponse.json(document, { status: 201 });
    } catch (error) {
      return businessApiError(error, "打印文档操作失败");
    }
  };
}

async function handle(request: Request, context: RouteContext) {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderDocumentsApiHandler({
      readSession: currentSession,
      listDocuments: (input) => runtime.documents.listForBusinessOrder(input),
      generateOfficeArchive: (input) => runtime.documents.generateOfficeArchive(input),
      generateMechanicWorkCopy: (input) => runtime.documents.generateMechanicWorkCopy(input),
    })(request, context);
  } finally {
    await runtime.close();
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}
