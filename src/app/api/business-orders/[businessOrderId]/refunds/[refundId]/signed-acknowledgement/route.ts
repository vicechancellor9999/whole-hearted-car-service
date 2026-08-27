import { NextResponse } from "next/server";
import { apiActionContext, businessApiError, positiveRouteId } from "@/app/api/business-orders/api-helpers";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";
import {
  isRefundUploadFile,
  removeStoredRefundUpload,
  storeRefundUpload,
  type StoredRefundUpload,
} from "@/modules/payment/refund-attachment-storage";

type RefundAcknowledgementSession = { account: { id: number } };
type RouteContext = { params: Promise<{ businessOrderId: string; refundId: string }> };
type AppendSignedAcknowledgementInput = {
  businessOrderId: number;
  refundId: number;
  signedAcknowledgement: StoredRefundUpload;
  context: BusinessOrderActionContext;
};

type RefundSignedAcknowledgementApiDependencies = {
  readSession(): Promise<RefundAcknowledgementSession | null>;
  appendRefundSignedAcknowledgement(input: AppendSignedAcknowledgementInput): Promise<unknown>;
  storeUpload(file: File): Promise<StoredRefundUpload>;
  removeUpload(storageKey: string): Promise<void>;
};

export function createRefundSignedAcknowledgementApiHandler(
  dependencies: RefundSignedAcknowledgementApiDependencies,
) {
  return async function refundSignedAcknowledgementApiHandler(
    request: Request,
    context: RouteContext,
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const route = await context.params;
    const businessOrderId = positiveRouteId(route.businessOrderId);
    const refundId = positiveRouteId(route.refundId);
    if (!businessOrderId || !refundId) {
      return NextResponse.json({ error: "Business Order 或退款编号无效" }, { status: 400 });
    }
    let signedAcknowledgement: StoredRefundUpload | null = null;
    try {
      const formData = await request.formData();
      const file = formData.get("signedAcknowledgement");
      if (!isRefundUploadFile(file)) throw new Error("请选择签字后的退款签收单");
      signedAcknowledgement = await dependencies.storeUpload(file);
      const result = await dependencies.appendRefundSignedAcknowledgement({
        businessOrderId,
        refundId,
        signedAcknowledgement,
        context: apiActionContext(request, session.account.id),
      });
      signedAcknowledgement = null;
      return NextResponse.json(result);
    } catch (error) {
      if (signedAcknowledgement) {
        await dependencies.removeUpload(signedAcknowledgement.storageKey).catch(() => undefined);
      }
      return businessApiError(error, "退款签收单上传失败");
    }
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createRefundSignedAcknowledgementApiHandler({
      readSession: currentSession,
      appendRefundSignedAcknowledgement: (input) =>
        runtime.payments.appendRefundSignedAcknowledgement(input),
      storeUpload: storeRefundUpload,
      removeUpload: removeStoredRefundUpload,
    })(request, context);
  } finally {
    await runtime.close();
  }
}
