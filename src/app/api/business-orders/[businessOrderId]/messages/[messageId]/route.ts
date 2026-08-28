import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActionContext, businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string; messageId: string }> };
const editSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  mentionedAccountIds: z.array(z.number().int().positive()).max(50).default([]),
  expectedVersion: z.number().int().positive(),
});

export async function PATCH(request: Request, context: RouteContext) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = await context.params;
  const businessOrderId = positiveRouteId(params.businessOrderId);
  const messageId = positiveRouteId(params.messageId);
  if (!businessOrderId || !messageId) return NextResponse.json({ error: "留言编号无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try {
    const input = editSchema.parse(await request.json());
    return NextResponse.json(await runtime.collaboration.editMessage({ businessOrderId, messageId, ...input, context: apiActionContext(request, session.account.id) }));
  } catch (error) { return businessApiError(error, "留言编辑失败"); }
  finally { await runtime.close(); }
}
