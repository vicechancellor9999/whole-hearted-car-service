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

type RefundProofSession = { account: { id: number } };
type RouteContext = { params: Promise<{ businessOrderId: string; refundId: string }> };
type AppendProofInput = {
  businessOrderId: number;
  refundId: number;
  proof: StoredRefundUpload;
  context: BusinessOrderActionContext;
};

type RefundProofApiDependencies = {
  readSession(): Promise<RefundProofSession | null>;
  appendRefundProof(input: AppendProofInput): Promise<unknown>;
  storeUpload(file: File): Promise<StoredRefundUpload>;
  removeUpload(storageKey: string): Promise<void>;
};

export function createRefundProofApiHandler(dependencies: RefundProofApiDependencies) {
  return async function refundProofApiHandler(request: Request, context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const route = await context.params;
    const businessOrderId = positiveRouteId(route.businessOrderId);
    const refundId = positiveRouteId(route.refundId);
    if (!businessOrderId || !refundId) {
      return NextResponse.json({ error: "Business Order 或退款编号无效" }, { status: 400 });
    }
    let proof: StoredRefundUpload | null = null;
    try {
      const formData = await request.formData();
      const proofFile = formData.get("proof");
      if (!isRefundUploadFile(proofFile)) {
        throw new Error("请选择实际退款凭证");
      }
      proof = await dependencies.storeUpload(proofFile);
      const result = await dependencies.appendRefundProof({
        businessOrderId,
        refundId,
        proof,
        context: apiActionContext(request, session.account.id),
      });
      proof = null;
      return NextResponse.json(result);
    } catch (error) {
      if (proof) await dependencies.removeUpload(proof.storageKey).catch(() => undefined);
      return businessApiError(error, "退款凭证上传失败");
    }
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createRefundProofApiHandler({
      readSession: currentSession,
      appendRefundProof: (input) => runtime.payments.appendRefundProof(input),
      storeUpload: storeRefundUpload,
      removeUpload: removeStoredRefundUpload,
    })(request, context);
  } finally {
    await runtime.close();
  }
}
