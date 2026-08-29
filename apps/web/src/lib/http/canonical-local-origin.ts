export function localOriginRedirects() {
  return [3220, 3210].map((port) => ({
    source: "/:path*",
    has: [{ type: "header" as const, key: "host", value: `localhost:${port}` }],
    destination: `http://127.0.0.1:${port}/:path*`,
    permanent: false,
  }));
}
