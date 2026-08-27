import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/request-id";
import { createAuthRuntime } from "@/modules/auth/auth-runtime";
import type { AuthRequestContext } from "@/modules/auth/auth-service";

type LogoutApiDependencies = {
  rawToken: string | null;
  revokeSession(rawToken: string, context: AuthRequestContext): Promise<void>;
  cookieName: string;
};

export function createLogoutApiHandler(dependencies: LogoutApiDependencies) {
  return async function logoutApiHandler(request: Request): Promise<Response> {
    if (dependencies.rawToken) {
      await dependencies.revokeSession(dependencies.rawToken, {
        requestId: request.headers.get("x-request-id") ?? createRequestId(),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: request.headers.get("user-agent"),
      });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(dependencies.cookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
    return response;
  };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createAuthRuntime(process.env);
  const rawToken = (await cookies()).get(runtime.env.SESSION_COOKIE_NAME)?.value ?? null;
  try {
    return await createLogoutApiHandler({
      rawToken,
      revokeSession: (token, context) => runtime.service.logout({ rawToken: token, context }),
      cookieName: runtime.env.SESSION_COOKIE_NAME,
    })(request);
  } finally {
    await runtime.close();
  }
}
