import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@/app/api/business-orders/api-helpers";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";

type FinanceSession = { account: { id: number } };
type RouteContext = { params: Promise<{ businessOrderId: string }> };

type FinanceApiDependencies = {
  readSession(): Promise<FinanceSession | null>;
  getLedger(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
};

export function createBusinessOrderFinanceApiHandler(dependencies: FinanceApiDependencies) {
  return async function businessOrderFinanceApiHandler(context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    try {
      return NextResponse.json({
        ledger: await dependencies.getLedger({
          businessOrderId,
          viewerAccountId: session.account.id,
        }),
      });
    } catch (error) {
      return businessApiError(error, "收付款记录读取失败");
    }
  };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderFinanceApiHandler({
      readSession: currentSession,
      getLedger: (input) => runtime.payments.getBusinessOrderLedger(input),
    })(context);
  } finally {
    await runtime.close();
  }
}
