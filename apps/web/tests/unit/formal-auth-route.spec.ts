import { expect, test } from "@playwright/test";
import { createFormalLoginAdapter } from "../../src/app/api/formal/auth/login/route";
import { createFormalLogoutAdapter } from "../../src/app/api/formal/auth/logout/route";

function loginRequest(): Request {
  const formData = new FormData();
  formData.set("username", "candidate-admin");
  formData.set("password", "candidate-password");
  return new Request("http://127.0.0.1:3220/api/formal/auth/login", {
    method: "POST",
    body: formData,
  });
}

test("formal login adapter redirects a successful in-process response and preserves its session cookie", async () => {
  const adapter = createFormalLoginAdapter(async () => new Response(
    JSON.stringify({ ok: true }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "wh_session=candidate-session; Path=/; HttpOnly; SameSite=Lax",
      },
    },
  ));

  const response = await adapter(loginRequest());

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/");
  expect(response.headers.get("set-cookie")).toContain("wh_session=");
});

test("formal login adapter preserves the accepted invalid-credentials redirect", async () => {
  const adapter = createFormalLoginAdapter(async () => Response.json(
    { ok: false, error: "invalid_credentials" },
    { status: 401 },
  ));

  const response = await adapter(loginRequest());

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "/login?error=invalid_credentials",
  );
});

test("formal login sends mechanics to their work-order portal", async () => {
  const adapter = createFormalLoginAdapter(async () => new Response(
    JSON.stringify({ ok: true, role: "mechanic" }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "wh_session=mechanic-session; Path=/; HttpOnly; SameSite=Lax",
      },
    },
  ));

  const response = await adapter(loginRequest());

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/mechanic");
  expect(response.headers.get("set-cookie")).toContain("wh_session=");
});

for (const scenario of [
  { name: "staff login", status: 200, payload: { ok: true, role: "super_admin" }, path: "/" },
  { name: "mechanic login", status: 200, payload: { ok: true, role: "mechanic" }, path: "/mechanic" },
  { name: "invalid login", status: 401, payload: { ok: false, error: "invalid_credentials" }, path: "/login?error=invalid_credentials" },
  { name: "rate limited login", status: 429, payload: { ok: false, error: "rate_limited" }, path: "/login?error=rate_limited" },
]) {
  test(`${scenario.name} stays on the browser origin behind a tunnel`, async () => {
    const adapter = createFormalLoginAdapter(async () => Response.json(scenario.payload, { status: scenario.status }));
    // Next constructs the server-side URL from its internal listener behind a proxy.
    const response = await adapter(new Request("https://localhost:3220/api/formal/auth/login", {
      method: "POST",
      headers: { "x-forwarded-host": "untrusted.example", "x-forwarded-proto": "http" },
    }));
    const location = response.headers.get("location")!;
    expect(response.status).toBe(303);
    expect(location).toBe(scenario.path);
    for (const origin of ["https://garage-test.trycloudflare.com", "http://127.0.0.1:3220"]) {
      expect(new URL(location, `${origin}/api/formal/auth/login`).href).toBe(`${origin}${scenario.path}`);
    }
  });
}

test("logout stays on the browser origin and preserves session expiry", async () => {
  const cookie = "wh_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const adapter = createFormalLogoutAdapter(async () => new Response(null, {
    status: 200,
    headers: { "set-cookie": cookie },
  }));
  const response = await adapter(new Request("https://localhost:3220/api/formal/auth/logout", { method: "POST" }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login");
  expect(response.headers.get("set-cookie")).toBe(cookie);
});
