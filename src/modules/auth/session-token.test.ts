import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  getSessionCookieOptions,
  hashSessionToken,
} from "@formal/modules/auth/session-token";

const pepper = "0123456789abcdef0123456789abcdef";

describe("database session tokens", () => {
  it("generates a thirty-two-byte random token", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(second).not.toBe(first);
  });

  it("creates a stable non-reversible database value using the server pepper", () => {
    const rawToken = "browser-only-session-token";

    const tokenHash = hashSessionToken(rawToken, pepper);

    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(rawToken);
    expect(hashSessionToken(rawToken, pepper)).toBe(tokenHash);
    expect(
      hashSessionToken(rawToken, "fedcba9876543210fedcba9876543210"),
    ).not.toBe(tokenHash);
  });

  it("uses a host-wide secure cookie contract", () => {
    expect(getSessionCookieOptions("production", new Date("2026-08-25T00:00:00Z"))).toEqual(
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: new Date("2026-08-25T12:00:00.000Z"),
      },
    );
    expect(
      getSessionCookieOptions("development", new Date("2026-08-25T00:00:00Z"))
        .secure,
    ).toBe(false);
  });
});
