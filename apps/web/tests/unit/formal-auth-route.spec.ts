import { expect, test } from "@playwright/test";
import { createFormalLoginAdapter } from "../../src/app/api/formal/auth/login/route";

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
  expect(response.headers.get("location")).toBe("http://127.0.0.1:3220/");
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
    "http://127.0.0.1:3220/login?error=invalid_credentials",
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
  expect(response.headers.get("location")).toBe("http://127.0.0.1:3220/mechanic");
  expect(response.headers.get("set-cookie")).toContain("wh_session=");
});
