import { NextResponse } from "next/server";
import {
  apiActionContext,
  businessApiError,
  positiveRouteId,
} from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import type {
  BusinessOrderActionContext,
  ProblemDescriptionSource,
} from "@formal/modules/business-order/business-order-service";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string }> };
type Session = { account: { id: number } };

type ProblemDescriptionApiDependencies = {
  readSession(): Promise<Session | null>;
  appendProblemDescriptionVersion(input: {
    businessOrderId: number;
    repairRoundId?: number | null;
    scope: "business_order" | "repair_round";
    expectedVersion: number;
    contentZh?: string | null;
    contentEn?: string | null;
    reason: string;
    sourceType?: ProblemDescriptionSource;
    sourceReferenceId?: number | null;
    context: BusinessOrderActionContext;
  }): Promise<unknown>;
  getProblemDescriptionContext(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<unknown>;
};

export function createBusinessOrderProblemDescriptionsApiHandler(
  dependencies: ProblemDescriptionApiDependencies,
) {
  return async function businessOrderProblemDescriptionsApiHandler(
    request: Request,
    routeContext: RouteContext,
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const businessOrderId = positiveRouteId(
      (await routeContext.params).businessOrderId,
    );
    if (!businessOrderId) {
      return NextResponse.json(
        { error: "Business Order 编号无效" },
        { status: 400 },
      );
    }

    try {
      const body = await request.json() as Record<string, unknown>;
      const result = await dependencies.appendProblemDescriptionVersion({
        businessOrderId,
        repairRoundId: body.repairRoundId == null
          ? null
          : Number(body.repairRoundId),
        scope: body.scope as "business_order" | "repair_round",
        expectedVersion: Number(body.expectedVersion),
        contentZh: typeof body.contentZh === "string" ? body.contentZh : null,
        contentEn: typeof body.contentEn === "string" ? body.contentEn : null,
        reason: typeof body.reason === "string" ? body.reason : "",
        sourceType: (body.sourceType ?? "manual") as ProblemDescriptionSource,
        sourceReferenceId: body.sourceReferenceId == null
          ? null
          : Number(body.sourceReferenceId),
        context: apiActionContext(request, session.account.id),
      });
      return NextResponse.json(result);
    } catch (error) {
      if (errorStatus(error) === 409) {
        const current = await dependencies.getProblemDescriptionContext({
          businessOrderId,
          viewerAccountId: session.account.id,
        });
        return NextResponse.json(
          {
            error: error instanceof Error
              ? error.message
              : "Business Order 已被其他操作修改，请刷新后重试",
            current,
          },
          { status: 409 },
        );
      }
      return businessApiError(error, "问题描述保存失败");
    }
  };
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  return Number((error as { status: unknown }).status);
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderProblemDescriptionsApiHandler({
      readSession: currentSession,
      appendProblemDescriptionVersion: (input) => (
        runtime.service.appendProblemDescriptionVersion(input)
      ),
      getProblemDescriptionContext: (input) => (
        runtime.service.getProblemDescriptionContext(input)
      ),
    })(request, context);
  } finally {
    await runtime.close();
  }
}
