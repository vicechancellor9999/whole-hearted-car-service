import { NextResponse } from "next/server";
import { POST as formalLogin } from "@formal/app/api/auth/login/route";

type FormalLoginHandler = (request: Request) => Promise<Response>;

export function createFormalLoginAdapter(handler: FormalLoginHandler) {
  return async function formalLoginAdapter(request: Request): Promise<Response> {
    const formalResponse = await handler(request);
    if (!formalResponse.ok) {
      const payload = await formalResponse.json().catch(() => ({
        error: "invalid_credentials",
      })) as { error?: string };
      const error = payload.error === "rate_limited"
        ? "rate_limited"
        : "invalid_credentials";
      return NextResponse.redirect(new URL(`/login?error=${error}`, request.url), 303);
    }

    const payload = await formalResponse.json().catch(() => ({ ok: true })) as { role?: unknown };
    const destination = payload.role === "mechanic" ? "/mechanic" : "/";
    const response = NextResponse.redirect(new URL(destination, request.url), 303);
    const sessionCookie = formalResponse.headers.get("set-cookie");
    if (sessionCookie) response.headers.set("set-cookie", sessionCookie);
    return response;
  };
}

export const POST = createFormalLoginAdapter(formalLogin);
