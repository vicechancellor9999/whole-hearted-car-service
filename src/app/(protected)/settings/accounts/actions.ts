"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import {
  AccountManagementDeniedError,
  AccountNotFoundError,
  type AccountActionContext,
  DelegatedPermissionTargetError,
  DuplicateUsernameError,
  LastActiveSuperAdminError,
} from "@/modules/accounts/account-service";
import { createAccountRuntime } from "@/modules/accounts/account-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { requirePermission } from "@/modules/permissions/require-permission";
import {
  executeAccountManagementSubmission,
  parseAccountManagementSubmission,
} from "@/app/(protected)/settings/accounts/submission";

export async function accountManagementAction(formData: FormData): Promise<never> {
  const [session, requestHeaders] = await Promise.all([
    currentSession(),
    headers(),
  ]);
  const actor = requirePermission(session, "accounts.manage");
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: AccountActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createAccountRuntime();
  let success: string | null = null;
  let error: string | null = null;

  try {
    const submission = parseAccountManagementSubmission(formData);
    success = await executeAccountManagementSubmission(
      submission,
      runtime.service,
      context,
    );
  } catch (caught) {
    error = toPublicAccountActionError(caught);
  } finally {
    await runtime.close();
  }

  revalidatePath("/settings/accounts");
  const query = new URLSearchParams(
    error ? { error } : { success: success ?? "操作已完成" },
  );
  redirect(`/settings/accounts?${query.toString()}`);
}

function toPublicAccountActionError(error: unknown): string {
  if (error instanceof z.ZodError) return "提交内容不完整或无效";
  if (
    error instanceof DuplicateUsernameError ||
    error instanceof LastActiveSuperAdminError ||
    error instanceof DelegatedPermissionTargetError ||
    error instanceof AccountNotFoundError ||
    error instanceof AccountManagementDeniedError
  ) {
    return error.message;
  }
  if (error instanceof Error && error.message === "密码至少需要 12 个字符") {
    return error.message;
  }
  return "操作失败，请重试";
}
