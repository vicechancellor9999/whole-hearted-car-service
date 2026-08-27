import { NextResponse } from "next/server";
import { apiActionContext, businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";

type PaymentSession = { account: { id: number } };
type RouteContext = { params: Promise<{ businessOrderId: string }> };
type PaymentInput = {
  businessOrderId: number;
  amount: string;
  paymentMethodItemId: number;
  note?: string;
  context: BusinessOrderActionContext;
};

type PaymentApiDependencies = {
  readSession(): Promise<PaymentSession | null>;
  recordPayment(input: PaymentInput): Promise<unknown>;
};

export function createBusinessOrderPaymentApiHandler(dependencies: PaymentApiDependencies) {
  return async function businessOrderPaymentApiHandler(request: Request, context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    try {
      const body = await request.json() as Record<string, unknown>;
      const result = await dependencies.recordPayment({
        businessOrderId,
        amount: typeof body.amount === "string" ? body.amount : "",
        paymentMethodItemId: Number(body.paymentMethodItemId),
        note: typeof body.note === "string" ? body.note : undefined,
        context: apiActionContext(request, session.account.id),
      });
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return businessApiError(error, "收款登记失败");
    }
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderPaymentApiHandler({
      readSession: currentSession,
      recordPayment: (input) => runtime.payments.recordPayment(input),
    })(request, context);
  } finally {
    await runtime.close();
  }
}
