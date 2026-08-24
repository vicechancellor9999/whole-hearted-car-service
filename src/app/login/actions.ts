"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import type {
  AuthRequestContext,
  LoginResult,
} from "@/modules/auth/auth-service";
import { createAuthRuntime } from "@/modules/auth/auth-runtime";
import { getSessionCookieOptions } from "@/modules/auth/session-token";

const loginFormSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(1_024),
});

export interface LoginAuthenticator {
  login(input: {
    username: string;
    password: string;
    context: AuthRequestContext;
  }): Promise<LoginResult>;
}

export type LoginSubmissionOutcome =
  | {
      kind: "success";
      rawToken: string;
      expiresAt: Date;
      role: "super_admin" | "front_desk" | "owner" | "mechanic";
      mustChangePassword: boolean;
    }
  | { kind: "failure"; error: "invalid_credentials" | "rate_limited" };

export async function handleLoginSubmission(
  formData: FormData,
  authenticator: LoginAuthenticator,
  context: AuthRequestContext,
): Promise<LoginSubmissionOutcome> {
  const parsed = loginFormSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { kind: "failure", error: "invalid_credentials" };
  }

  const result = await authenticator.login({ ...parsed.data, context });
  if (!result.ok) {
    return { kind: "failure", error: result.reason };
  }

  return {
    kind: "success",
    rawToken: result.rawToken,
    expiresAt: result.expiresAt,
    role: result.account.role,
    mustChangePassword: result.account.mustChangePassword,
  };
}

export async function loginAction(formData: FormData): Promise<never> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: AuthRequestContext = {
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createAuthRuntime();
  let outcome: LoginSubmissionOutcome;

  try {
    outcome = await handleLoginSubmission(formData, runtime.service, context);
  } finally {
    await runtime.close();
  }

  if (outcome.kind === "failure") {
    redirect(`/login?error=${outcome.error}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(runtime.env.SESSION_COOKIE_NAME, outcome.rawToken, {
    ...getSessionCookieOptions(runtime.env.NODE_ENV),
    expires: outcome.expiresAt,
  });

  redirect("/dashboard");
}
