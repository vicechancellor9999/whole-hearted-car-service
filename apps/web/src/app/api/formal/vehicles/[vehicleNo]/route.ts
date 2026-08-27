const FORMAL_BACKEND_ORIGIN = process.env.FORMAL_BACKEND_ORIGIN ?? "http://127.0.0.1:3211";

async function forward(
  request: Request,
  vehicleNo: string,
  method: "GET" | "PATCH",
): Promise<Response> {
  const backendResponse = await fetch(
    `${FORMAL_BACKEND_ORIGIN}/api/vehicles/${encodeURIComponent(vehicleNo)}`,
    {
      method,
      headers: {
        ...(method === "PATCH" ? { "content-type": "application/json" } : {}),
        cookie: request.headers.get("cookie") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "Whole Hearted Web",
        "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      ...(method === "PATCH" ? { body: await request.text() } : {}),
      cache: "no-store",
    },
  );
  return new Response(await backendResponse.text(), {
    status: backendResponse.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ vehicleNo: string }> },
): Promise<Response> {
  const { vehicleNo } = await context.params;
  return forward(request, vehicleNo, "GET");
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ vehicleNo: string }> },
): Promise<Response> {
  const { vehicleNo } = await context.params;
  return forward(request, vehicleNo, "PATCH");
}
