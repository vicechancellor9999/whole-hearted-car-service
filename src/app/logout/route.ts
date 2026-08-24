import { cookies } from "next/headers";
import { createRequestId } from "@/lib/request-id";
import { parseAppEnv } from "@/lib/env";
import { createAuthRuntime } from "@/modules/auth/auth-runtime";

type LogoutDependencies = {
  readRawToken(): Promise<string | null>;
  revokeSession(rawToken: string): Promise<void>;
  clearSessionCookie(): Promise<void>;
};

export function createLogoutHandler(dependencies: LogoutDependencies) {
  return async function logoutHandler(request: Request): Promise<Response> {
    const rawToken = await dependencies.readRawToken();
    try {
      if (rawToken) {
        await dependencies.revokeSession(rawToken);
      }
    } finally {
      await dependencies.clearSessionCookie();
    }

    return Response.redirect(new URL("/login", request.url), 303);
  };
}

export async function POST(request: Request): Promise<Response> {
  const env = parseAppEnv(process.env);
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(env.SESSION_COOKIE_NAME)?.value ?? null;
  const handler = createLogoutHandler({
    readRawToken: async () => rawToken,
    revokeSession: async (token) => {
      const runtime = createAuthRuntime(process.env);
      try {
        await runtime.service.logout({
          rawToken: token,
          context: {
            requestId: request.headers.get("x-request-id") ?? createRequestId(),
            ipAddress:
              request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
              null,
            userAgent: request.headers.get("user-agent"),
          },
        });
      } finally {
        await runtime.close();
      }
    },
    clearSessionCookie: async () => {
      cookieStore.delete(env.SESSION_COOKIE_NAME);
    },
  });

  return handler(request);
}
