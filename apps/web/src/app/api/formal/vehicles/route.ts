const FORMAL_BACKEND_ORIGIN = process.env.FORMAL_BACKEND_ORIGIN ?? "http://127.0.0.1:3211";

export async function POST(request: Request): Promise<Response> {
  const backendResponse = await fetch(`${FORMAL_BACKEND_ORIGIN}/api/vehicles`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "user-agent": request.headers.get("user-agent") ?? "Whole Hearted Web",
      "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
    body: await request.text(),
    cache: "no-store",
  });
  return new Response(await backendResponse.text(), {
    status: backendResponse.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
