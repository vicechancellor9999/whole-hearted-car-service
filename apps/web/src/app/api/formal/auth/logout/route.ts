import { POST as formalLogout } from "@formal/app/api/auth/logout/route";

type FormalLogoutHandler = (request: Request) => Promise<Response>;

export function createFormalLogoutAdapter(handler: FormalLogoutHandler) {
  return async function formalLogoutAdapter(request: Request): Promise<Response> {
    const formalResponse = await handler(request);
    // Resolve on the browser's origin rather than the internal reverse-proxy address.
    const response = new Response(null, { status: 303, headers: { location: "/login" } });
    const expiredCookie = formalResponse.headers.get("set-cookie");
    if (expiredCookie) response.headers.set("set-cookie", expiredCookie);
    return response;
  };
}

export const POST = createFormalLogoutAdapter(formalLogout);
