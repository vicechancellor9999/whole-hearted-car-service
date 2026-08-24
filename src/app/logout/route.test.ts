import { describe, expect, it } from "vitest";
import { createLogoutHandler } from "@/app/logout/route";

describe("POST /logout", () => {
  it("revokes the database session, clears the cookie and returns to login", async () => {
    const effects = { revokedToken: null as string | null, cookieCleared: false };
    const POST = createLogoutHandler({
      readRawToken: async () => "browser-session-token",
      revokeSession: async (rawToken) => {
        effects.revokedToken = rawToken;
      },
      clearSessionCookie: async () => {
        effects.cookieCleared = true;
      },
    });

    const response = await POST(new Request("http://localhost/logout", { method: "POST" }));

    expect(effects).toEqual({
      revokedToken: "browser-session-token",
      cookieCleared: true,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("still clears an invalid or missing browser cookie", async () => {
    const effects = { cookieCleared: false };
    const POST = createLogoutHandler({
      readRawToken: async () => null,
      revokeSession: async () => {
        throw new Error("there is no session to revoke");
      },
      clearSessionCookie: async () => {
        effects.cookieCleared = true;
      },
    });

    await POST(new Request("http://localhost/logout", { method: "POST" }));

    expect(effects.cookieCleared).toBe(true);
  });
});
