import { NextResponse } from "next/server";
import { POST as formalLogout } from "@formal/app/api/auth/logout/route";

type FormalLogoutHandler = (request: Request) => Promise<Response>;

export function createFormalLogoutAdapter(handler: FormalLogoutHandler) {
  return async function formalLogoutAdapter(request: Request): Promise<Response> {
    const formalResponse = await handler(request);
    const response = NextResponse.redirect(new URL("/login", request.url), 303);
    const expiredCookie = formalResponse.headers.get("set-cookie");
    if (expiredCookie) response.headers.set("set-cookie", expiredCookie);
    return response;
  };
}

export const POST = createFormalLogoutAdapter(formalLogout);
