"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import { currentSession } from "@/modules/auth/current-session";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";
import {
  PaymentConflictError,
  PaymentNotFoundError,
  PaymentValidationError,
  PaymentWriteDeniedError,
} from "@/modules/payment/payment-service";
import { createPaymentRuntime } from "@/modules/payment/payment-runtime";
import {
  RefundAttachmentStorageError,
  isRefundUploadFile,
  removeStoredRefundUpload,
  storeRefundUpload,
  type StoredRefundUpload,
} from "@/modules/payment/refund-attachment-storage";
import { requirePermission } from "@/modules/permissions/require-permission";

const positiveId = z.coerce.number().int().positive();

export async function businessOrderFinanceAction(formData: FormData): Promise<never> {
  const [session, requestHeaders] = await Promise.all([currentSession(), headers()]);
  const operation = String(formData.get("operation") ?? "");
  const actor = requirePermission(
    session,
    operation === "record_refund" ||
      operation === "append_refund_proof" ||
      operation === "append_refund_signed_acknowledgement"
      ? "sensitive_operations.execute"
      : "business_order.write",
  );
  const businessOrderId = positiveId.parse(formData.get("businessOrderId"));
  let destination = `/business-orders/${businessOrderId}`;
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: BusinessOrderActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createPaymentRuntime();
  let proof: StoredRefundUpload | null = null;
  let signedAcknowledgement: StoredRefundUpload | null = null;
  let message = "操作已完成";
  let error: string | null = null;
  try {
    if (operation === "record_payment") {
      const result = await runtime.service.recordPayment({
        businessOrderId,
        amount: String(formData.get("amount") ?? ""),
        paymentMethodItemId: positiveId.parse(formData.get("paymentMethodItemId")),
        note: String(formData.get("note") ?? ""),
        context,
      });
      message = `收款已登记，Receipt ${result.receipt.receiptNo} 已生成`;
    } else if (operation === "record_refund") {
      const result = await runtime.service.recordRefund({
        businessOrderId,
        amount: String(formData.get("amount") ?? ""),
        paymentMethodItemId: positiveId.parse(formData.get("paymentMethodItemId")),
        reason: String(formData.get("reason") ?? ""),
        originalDocumentStatus: z.enum(["returned", "unavailable"]).parse(
          formData.get("originalDocumentStatus"),
        ),
        originalDocumentNote: String(formData.get("originalDocumentNote") ?? ""),
        context,
      });
      destination = `/business-orders/${businessOrderId}/refunds/${result.id}`;
      message = `退款 ${result.refundNo} 已生成；请打印退款签收单交客户手写签字，签字件可稍后回传`;
    } else if (operation === "append_refund_proof") {
      const refundId = positiveId.parse(formData.get("refundId"));
      const proofFile = formData.get("proof");
      if (!isRefundUploadFile(proofFile)) {
        throw new RefundAttachmentStorageError("请选择实际退款凭证");
      }
      proof = await storeRefundUpload(proofFile);
      const result = await runtime.service.appendRefundProof({
        businessOrderId,
        refundId,
        proof,
        context,
      });
      proof = null;
      destination = `/business-orders/${businessOrderId}/refunds/${refundId}`;
      message = `退款 ${result.refundNo} 的凭证已归档，之后不能替换`;
    } else if (operation === "append_refund_signed_acknowledgement") {
      const refundId = positiveId.parse(formData.get("refundId"));
      const signedFile = formData.get("signedAcknowledgement");
      if (!isRefundUploadFile(signedFile)) {
        throw new RefundAttachmentStorageError("请选择签字后的退款签收单");
      }
      signedAcknowledgement = await storeRefundUpload(signedFile);
      const result = await runtime.service.appendRefundSignedAcknowledgement({
        businessOrderId,
        refundId,
        signedAcknowledgement,
        context,
      });
      signedAcknowledgement = null;
      destination = `/business-orders/${businessOrderId}/refunds/${refundId}`;
      message = `退款 ${result.refundNo} 的签字签收单已归档，之后不能替换`;
    } else {
      throw new PaymentValidationError("未知收付款操作");
    }
  } catch (caught) {
    for (const upload of [proof, signedAcknowledgement]) {
      if (upload) {
        await removeStoredRefundUpload(upload.storageKey).catch(() => undefined);
      }
    }
    error = toPublicError(caught);
  } finally {
    await runtime.close();
  }
  revalidatePath(`/business-orders/${businessOrderId}`);
  revalidatePath(destination);
  const query = new URLSearchParams(error ? { error } : { success: message });
  redirect(`${destination}?${query.toString()}`);
}

function toPublicError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "提交内容不完整或无效";
  }
  if (
    error instanceof PaymentConflictError ||
    error instanceof PaymentNotFoundError ||
    error instanceof PaymentValidationError ||
    error instanceof PaymentWriteDeniedError ||
    error instanceof RefundAttachmentStorageError
  ) return error.message;
  return "收付款操作失败，请刷新后重试";
}
