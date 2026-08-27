import { describe, expect, it, vi } from "vitest";
import { createLoginApiHandler } from "@formal/app/api/auth/login/route";

describe("POST /api/auth/login", () => {
  it("creates a host-wide session cookie without exposing the raw token", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      ok: true,
      rawToken: "server-only-session-token",
      expiresAt: new Date("2026-08-24T22:00:00.000Z"),
      account: {
        id: 1,
        displayName: "超级管理员",
        role: "super_admin",
        mustChangePassword: false,
        delegatedPermissions: [],
      },
    });
    const POST = createLoginApiHandler({
      authenticate,
      cookieName: "wh_session",
      mode: "development",
    });
    const form = new FormData();
    form.set("username", "admin");
    form.set("password", "correct password");

    const response = await POST(new Request("http://localhost/api/auth/login", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("wh_session=server-only-session-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await response.json()).toEqual({
      ok: true,
      role: "super_admin",
      mustChangePassword: false,
    });
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({
      username: "admin",
      password: "correct password",
    }));
  });

  it("uses clear HTTP statuses for invalid and rate-limited credentials", async () => {
    const invalid = createLoginApiHandler({
      authenticate: vi.fn().mockResolvedValue({ ok: false, reason: "invalid_credentials" }),
      cookieName: "wh_session",
      mode: "test",
    });
    const limited = createLoginApiHandler({
      authenticate: vi.fn().mockResolvedValue({ ok: false, reason: "rate_limited" }),
      cookieName: "wh_session",
      mode: "test",
    });
    const form = () => {
      const value = new FormData();
      value.set("username", "admin");
      value.set("password", "wrong");
      return value;
    };

    const invalidResponse = await invalid(new Request("http://localhost/api/auth/login", { method: "POST", body: form() }));
    const limitedResponse = await limited(new Request("http://localhost/api/auth/login", { method: "POST", body: form() }));

    expect(invalidResponse.status).toBe(401);
    expect(limitedResponse.status).toBe(429);
    await expect(invalidResponse.json()).resolves.toEqual({ ok: false, error: "invalid_credentials" });
    await expect(limitedResponse.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
  });
});
