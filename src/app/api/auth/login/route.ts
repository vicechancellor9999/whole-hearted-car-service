import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId } from "@formal/lib/request-id";
import { createAuthRuntime } from "@formal/modules/auth/auth-runtime";
import type { AuthRequestContext, LoginResult } from "@formal/modules/auth/auth-service";
import { getSessionCookieOptions, type RuntimeMode } from "@formal/modules/auth/session-token";

const loginInputSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(1_024),
});

type LoginApiDependencies = {
  authenticate(input: {
    username: string;
    password: string;
    context: AuthRequestContext;
  }): Promise<LoginResult>;
  cookieName: string;
  mode: RuntimeMode;
};

export function createLoginApiHandler(dependencies: LoginApiDependencies) {
  return async function loginApiHandler(request: Request): Promise<Response> {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
    }

    const parsed = loginInputSchema.safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
    }

    const result = await dependencies.authenticate({
      ...parsed.data,
      context: {
        requestId: request.headers.get("x-request-id") ?? createRequestId(),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: request.headers.get("user-agent"),
      },
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason },
        { status: result.reason === "rate_limited" ? 429 : 401 },
      );
    }

    const response = NextResponse.json({
      ok: true,
      role: result.account.role,
      mustChangePassword: result.account.mustChangePassword,
    });
    response.cookies.set(dependencies.cookieName, result.rawToken, {
      ...getSessionCookieOptions(dependencies.mode),
      expires: result.expiresAt,
    });
    return response;
  };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createAuthRuntime(process.env);
  try {
    return await createLoginApiHandler({
      authenticate: (input) => runtime.service.login(input),
      cookieName: runtime.env.SESSION_COOKIE_NAME,
      mode: runtime.env.NODE_ENV,
    })(request);
  } finally {
    await runtime.close();
  }
}
