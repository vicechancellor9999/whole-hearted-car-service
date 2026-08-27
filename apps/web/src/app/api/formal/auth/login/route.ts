import { NextResponse } from "next/server";

const FORMAL_BACKEND_ORIGIN = process.env.FORMAL_BACKEND_ORIGIN ?? "http://127.0.0.1:3211";

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const backendResponse = await fetch(`${FORMAL_BACKEND_ORIGIN}/api/auth/login`, {
    method: "POST",
    body: formData,
    headers: {
      "user-agent": request.headers.get("user-agent") ?? "Whole Hearted Web",
      "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "127.0.0.1",
      "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
    cache: "no-store",
  });

  if (!backendResponse.ok) {
    const payload = await backendResponse.json().catch(() => ({ error: "invalid_credentials" })) as { error?: string };
    const error = payload.error === "rate_limited" ? "rate_limited" : "invalid_credentials";
    return NextResponse.redirect(new URL(`/login?error=${error}`, request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  const sessionCookie = backendResponse.headers.get("set-cookie");
  if (sessionCookie) response.headers.set("set-cookie", sessionCookie);
  return response;
}
