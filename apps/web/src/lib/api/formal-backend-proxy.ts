type BodyMode = "none" | "json" | "form";
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function forwardFormalBackend(
  request: Request,
  path: string,
  bodyMode: BodyMode,
  fetcher: FetchLike = fetch,
): Promise<Response> {
  const origin = process.env.FORMAL_BACKEND_ORIGIN ?? "http://127.0.0.1:3211";
  const headers = new Headers({
    cookie: request.headers.get("cookie") ?? "",
    "user-agent": request.headers.get("user-agent") ?? "Whole Hearted Web",
    "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "127.0.0.1",
    "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
  });
  let body: BodyInit | undefined;
  if (bodyMode === "json") {
    headers.set("content-type", "application/json");
    body = await request.text();
  } else if (bodyMode === "form") {
    body = await request.formData();
  }
  const backendResponse = await fetcher(`${origin}${path}`, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });
  return new Response(await backendResponse.arrayBuffer(), {
    status: backendResponse.status,
    headers: {
      "content-type": backendResponse.headers.get("content-type")
        ?? "application/json; charset=utf-8",
    },
  });
}
