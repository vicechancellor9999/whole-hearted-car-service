const FORMAL_BACKEND_ORIGIN = process.env.FORMAL_BACKEND_ORIGIN ?? "http://127.0.0.1:3211";

export async function GET(
  request: Request,
  context: { params: { fileId: string } },
): Promise<Response> {
  const backendResponse = await fetch(
    `${FORMAL_BACKEND_ORIGIN}/api/vehicle-attachments/${encodeURIComponent(context.params.fileId)}`,
    {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "Whole Hearted Web",
        "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      cache: "no-store",
    },
  );
  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "content-type": backendResponse.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": backendResponse.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
