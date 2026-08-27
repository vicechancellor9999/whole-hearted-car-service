import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createPaymentRuntime } from "@formal/modules/payment/payment-runtime";

type RouteContext = {
  params: Promise<{ businessOrderId: string; receiptId: string }>;
};

type ReceiptApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getReceipt(input: { receiptId: number; viewerAccountId: number }): Promise<unknown>;
};

export function createReceiptApiHandler(dependencies: ReceiptApiDependencies) {
  return async function receiptApiHandler(context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const route = await context.params;
    const businessOrderId = positiveRouteId(route.businessOrderId);
    const receiptId = positiveRouteId(route.receiptId);
    if (!businessOrderId || !receiptId) {
      return NextResponse.json({ error: "Receipt 路径无效" }, { status: 400 });
    }
    try {
      const receipt = await dependencies.getReceipt({
        receiptId,
        viewerAccountId: session.account.id,
      }) as { businessOrderId?: number };
      if (receipt.businessOrderId !== businessOrderId) {
        return NextResponse.json({ error: "Receipt 不存在" }, { status: 404 });
      }
      return NextResponse.json(receipt);
    } catch (error) {
      return businessApiError(error, "Receipt 读取失败");
    }
  };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const runtime = createPaymentRuntime();
  try {
    return await createReceiptApiHandler({
      readSession: currentSession,
      getReceipt: (input) => runtime.service.getReceipt(input),
    })(context);
  } finally {
    await runtime.close();
  }
}
