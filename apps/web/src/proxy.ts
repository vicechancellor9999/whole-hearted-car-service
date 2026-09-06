import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // Public rendering code, not a document or a business-data endpoint.
  if (request.nextUrl.pathname === "/pdf.worker.min.mjs") return NextResponse.next();
  if (request.cookies.has("wh_session")) return NextResponse.next();
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!login|api/formal/auth/login|_next/static|_next/image|favicon.ico|logo-icon.png).*)"],
};
