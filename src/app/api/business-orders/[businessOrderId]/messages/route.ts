import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActionContext, businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string }> };
const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  mentionedAccountIds: z.array(z.number().int().positive()).max(50).default([]),
});

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const businessOrderId = positiveRouteId((await context.params).businessOrderId);
  if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try {
    return NextResponse.json(await runtime.collaboration.listMessages({ businessOrderId, viewerAccountId: session.account.id }));
  } catch (error) { return businessApiError(error, "留言读取失败"); }
  finally { await runtime.close(); }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const businessOrderId = positiveRouteId((await context.params).businessOrderId);
  if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try {
    const input = messageSchema.parse(await request.json());
    const message = await runtime.collaboration.createMessage({ businessOrderId, ...input, context: apiActionContext(request, session.account.id) });
    return NextResponse.json(message, { status: 201 });
  } catch (error) { return businessApiError(error, "留言发布失败"); }
  finally { await runtime.close(); }
}
