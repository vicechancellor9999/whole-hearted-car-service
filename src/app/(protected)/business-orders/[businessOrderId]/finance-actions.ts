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
    operation === "record_refund"
      ? "sensitive_operations.execute"
      : "business_order.write",
  );
  const businessOrderId = positiveId.parse(formData.get("businessOrderId"));
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: BusinessOrderActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createPaymentRuntime();
  let proof: StoredRefundUpload | null = null;
  let customerSignature: StoredRefundUpload | null = null;
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
      const proofFile = formData.get("proof");
      if (!(proofFile instanceof File) || proofFile.size === 0) {
        throw new RefundAttachmentStorageError("请选择退款凭证");
      }
      proof = await storeRefundUpload(proofFile);
      const signatureFile = formData.get("customerSignature");
      if (signatureFile instanceof File && signatureFile.size > 0) {
        customerSignature = await storeRefundUpload(signatureFile);
      }
      const result = await runtime.service.recordRefund({
        businessOrderId,
        amount: String(formData.get("amount") ?? ""),
        paymentMethodItemId: positiveId.parse(formData.get("paymentMethodItemId")),
        reason: String(formData.get("reason") ?? ""),
        originalDocumentStatus: z.enum(["returned", "unavailable"]).parse(
          formData.get("originalDocumentStatus"),
        ),
        originalDocumentNote: String(formData.get("originalDocumentNote") ?? ""),
        proof,
        customerSignature,
        context,
      });
      proof = null;
      customerSignature = null;
      message = `退款 ${result.refundNo} 已登记，退款说明与签收单已生成`;
    } else {
      throw new PaymentValidationError("未知收付款操作");
    }
  } catch (caught) {
    for (const upload of [proof, customerSignature]) {
      if (upload) {
        await removeStoredRefundUpload(upload.storageKey).catch(() => undefined);
      }
    }
    error = toPublicError(caught);
  } finally {
    await runtime.close();
  }
  const destination = `/business-orders/${businessOrderId}`;
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
