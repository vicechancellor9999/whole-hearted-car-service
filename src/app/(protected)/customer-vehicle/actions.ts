"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import { currentSession } from "@/modules/auth/current-session";
import { requirePermission } from "@/modules/permissions/require-permission";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import {
  CustomerVehicleConflictError,
  CustomerVehicleNotFoundError,
  CustomerVehicleWriteDeniedError,
  type CustomerVehicleActionContext,
} from "@/modules/customer-vehicle/customer-vehicle-service";
import {
  executeCustomerVehicleSubmission,
  parseCustomerVehicleSubmission,
} from "@/app/(protected)/customer-vehicle/submission";
import {
  AttachmentStorageError,
  removeStoredVehicleUpload,
  storeVehicleUpload,
} from "@/modules/customer-vehicle/attachment-storage";

const uploadSubmissionSchema = z.object({
  vehicleId: z.coerce.number().int().positive(),
  kind: z.enum(["photo", "document", "dispute_evidence"]),
  caption: z.string().trim().max(500).optional().transform((value) => value || undefined),
});

export async function customerVehicleAction(formData: FormData): Promise<never> {
  const [session, requestHeaders] = await Promise.all([currentSession(), headers()]);
  const actor = requirePermission(session, "customer_vehicle.write");
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: CustomerVehicleActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createCustomerVehicleRuntime();
  let destination: "/customers" | "/companies" | "/vehicles" = "/customers";
  let message = "操作已完成";
  let error: string | null = null;
  let uploadedStorageKey: string | null = null;
  const operation = String(formData.get("operation") ?? "");
  try {
    if (operation === "upload_attachment") {
      const fields = uploadSubmissionSchema.parse(Object.fromEntries(formData.entries()));
      const file = formData.get("file");
      if (!(file instanceof File)) throw new AttachmentStorageError("请选择附件文件");
      const stored = await storeVehicleUpload(file);
      uploadedStorageKey = stored.storageKey;
      await runtime.service.registerVehicleAttachment({
        vehicleId: fields.vehicleId,
        kind: fields.kind,
        caption: fields.caption,
        ...stored,
        context,
      });
      uploadedStorageKey = null;
      destination = "/vehicles";
      message = "车辆附件已上传并归档";
    } else {
      const result = await executeCustomerVehicleSubmission(
        parseCustomerVehicleSubmission(formData), runtime.service, context,
      );
      destination = result.destination;
      message = result.message;
    }
  } catch (caught) {
    if (uploadedStorageKey) {
      await removeStoredVehicleUpload(uploadedStorageKey).catch(() => undefined);
      uploadedStorageKey = null;
    }
    error = toPublicError(caught);
    destination = operation.includes("company") || operation.endsWith("_contact")
      ? "/companies"
      : operation.includes("vehicle") || operation.includes("owner") || operation.includes("dispute")
        ? "/vehicles"
        : "/customers";
  } finally {
    await runtime.close();
  }
  revalidatePath("/customers");
  revalidatePath("/companies");
  revalidatePath("/vehicles");
  const query = new URLSearchParams(error ? { error } : { success: message });
  redirect(`${destination}?${query.toString()}`);
}

function toPublicError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "提交内容不完整或无效";
  if (error instanceof AttachmentStorageError) return error.message;
  if (error instanceof CustomerVehicleConflictError ||
      error instanceof CustomerVehicleNotFoundError ||
      error instanceof CustomerVehicleWriteDeniedError) return error.message;
  return "操作失败，请重试";
}
