"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import { currentSession } from "@/modules/auth/current-session";
import {
  BusinessOrderDocumentConflictError,
  BusinessOrderDocumentNotFoundError,
  BusinessOrderDocumentWriteDeniedError,
} from "@/modules/business-order/business-order-document-service";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import { requirePermission } from "@/modules/permissions/require-permission";

const positiveId = z.coerce.number().int().positive();

export async function businessOrderDocumentAction(formData: FormData): Promise<never> {
  const [session, requestHeaders] = await Promise.all([currentSession(), headers()]);
  const actor = requirePermission(session, "business_order.write");
  const businessOrderId = positiveId.parse(formData.get("businessOrderId"));
  const operation = z.enum([
    "generate_office_archive",
    "generate_mechanic_work",
  ]).parse(formData.get("operation"));
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: BusinessOrderActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createBusinessOrderRuntime();
  let documentId: number | null = null;
  let error: string | null = null;
  try {
    const document = operation === "generate_office_archive"
      ? await runtime.documents.generateOfficeArchive({ businessOrderId, context })
      : await runtime.documents.generateMechanicWorkCopy({ businessOrderId, context });
    documentId = document.id;
  } catch (caught) {
    error = toPublicError(caught);
  } finally {
    await runtime.close();
  }

  const detailPath = `/business-orders/${businessOrderId}`;
  revalidatePath(detailPath);
  if (error || documentId === null) {
    redirect(`${detailPath}?error=${encodeURIComponent(error ?? "生成打印文档失败")}`);
  }
  redirect(`${detailPath}/documents/${documentId}`);
}

function toPublicError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "打印文档操作不完整";
  }
  if (
    error instanceof BusinessOrderDocumentConflictError ||
    error instanceof BusinessOrderDocumentNotFoundError ||
    error instanceof BusinessOrderDocumentWriteDeniedError
  ) {
    return error.message;
  }
  return "生成打印文档失败，请刷新后重试";
}
