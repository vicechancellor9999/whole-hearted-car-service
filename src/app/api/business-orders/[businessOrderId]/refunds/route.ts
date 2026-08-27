import { NextResponse } from "next/server";
import { apiActionContext, businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";

type RefundSession = { account: { id: number } };
type RouteContext = { params: Promise<{ businessOrderId: string }> };
type RefundInput = {
  businessOrderId: number;
  amount: string;
  paymentMethodItemId: number;
  reason: string;
  originalDocumentStatus: "returned" | "unavailable";
  originalDocumentNote?: string;
  context: BusinessOrderActionContext;
};

type RefundApiDependencies = {
  readSession(): Promise<RefundSession | null>;
  recordRefund(input: RefundInput): Promise<unknown>;
};

export function createBusinessOrderRefundApiHandler(dependencies: RefundApiDependencies) {
  return async function businessOrderRefundApiHandler(request: Request, context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    try {
      const formData = await request.formData();
      const originalDocumentStatus = String(formData.get("originalDocumentStatus") ?? "");
      if (originalDocumentStatus !== "returned" && originalDocumentStatus !== "unavailable") {
        throw new Error("原单处理情况不正确");
      }
      const result = await dependencies.recordRefund({
        businessOrderId,
        amount: String(formData.get("amount") ?? ""),
        paymentMethodItemId: Number(formData.get("paymentMethodItemId")),
        reason: String(formData.get("reason") ?? ""),
        originalDocumentStatus,
        originalDocumentNote: String(formData.get("originalDocumentNote") ?? ""),
        context: apiActionContext(request, session.account.id),
      });
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return businessApiError(error, "退款记录生成失败");
    }
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderRefundApiHandler({
      readSession: currentSession,
      recordRefund: (input) => runtime.payments.recordRefund(input),
    })(request, context);
  } finally {
    await runtime.close();
  }
}
