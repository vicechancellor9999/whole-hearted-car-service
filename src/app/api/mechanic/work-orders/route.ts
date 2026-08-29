import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import { businessApiError } from "@formal/app/api/business-orders/api-helpers";

export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const runtime = createBusinessOrderRuntime();
  try {
    return NextResponse.json(await runtime.repairRounds.listMechanicWorkOrders({
      viewerAccountId: session.account.id,
    }));
  } catch (error) {
    return businessApiError(error, "维修任务读取失败");
  } finally {
    await runtime.close();
  }
}
