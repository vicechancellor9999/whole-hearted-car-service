"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import { currentSession } from "@/modules/auth/current-session";
import {
  MasterDataConflictError,
  MasterDataManagementDeniedError,
  MasterDataNotFoundError,
  type MasterDataActionContext,
  TeamReplacementRequiredError,
} from "@/modules/master-data/master-data-service";
import { createMasterDataRuntime } from "@/modules/master-data/master-data-runtime";
import { requirePermission } from "@/modules/permissions/require-permission";
import {
  executeMasterDataSubmission,
  parseMasterDataSubmission,
} from "@/app/(protected)/master-data/submission";

export async function masterDataAction(formData: FormData): Promise<never> {
  const [session, requestHeaders] = await Promise.all([currentSession(), headers()]);
  const actor = requirePermission(session, "workforce.manage");
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: MasterDataActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createMasterDataRuntime();
  const operation = String(formData.get("operation") ?? "");
  let destination: "/master-data" | "/employees" =
    operation === "create_mechanic" || operation === "set_salary"
      ? "/employees"
      : "/master-data";
  let success: string | null = null;
  let error: string | null = null;

  try {
    const result = await executeMasterDataSubmission(
      parseMasterDataSubmission(formData),
      runtime.service,
      context,
    );
    destination = result.destination;
    success = result.message;
  } catch (caught) {
    error = toPublicMasterDataError(caught);
  } finally {
    await runtime.close();
  }

  revalidatePath("/master-data");
  revalidatePath("/employees");
  const query = new URLSearchParams(
    error ? { error } : { success: success ?? "操作已完成" },
  );
  redirect(`${destination}?${query.toString()}`);
}

function toPublicMasterDataError(error: unknown): string {
  if (error instanceof z.ZodError) return "提交内容不完整或无效";
  if (
    error instanceof MasterDataConflictError ||
    error instanceof MasterDataNotFoundError ||
    error instanceof MasterDataManagementDeniedError ||
    error instanceof TeamReplacementRequiredError
  ) {
    return error.message;
  }
  if (error instanceof Error && /密码|金额|原因/.test(error.message)) {
    return error.message;
  }
  return "操作失败，请重试";
}
