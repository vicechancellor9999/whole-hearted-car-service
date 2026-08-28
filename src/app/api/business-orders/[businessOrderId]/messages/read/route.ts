import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string }> };
export async function POST(_request: Request, context: RouteContext) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const businessOrderId = positiveRouteId((await context.params).businessOrderId);
  if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
  const runtime = createBusinessOrderRuntime();
  try { return NextResponse.json(await runtime.collaboration.markMentionsRead({ businessOrderId, accountId: session.account.id })); }
  catch (error) { return businessApiError(error, "提及已读状态更新失败"); }
  finally { await runtime.close(); }
}
