import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import { businessApiError } from "@formal/app/api/business-orders/api-helpers";

export async function GET(
  _request: Request,
  context: { params: Promise<{ businessOrderId: string }> },
): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { businessOrderId } = await context.params;
  const runtime = createBusinessOrderRuntime();
  try {
    return NextResponse.json(await runtime.repairRounds.getMechanicWorkOrder({
      businessOrderId: Number(businessOrderId),
      viewerAccountId: session.account.id,
    }));
  } catch (error) {
    return businessApiError(error, "维修任务读取失败");
  } finally {
    await runtime.close();
  }
}
