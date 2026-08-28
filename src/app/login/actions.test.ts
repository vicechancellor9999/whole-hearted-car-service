import { describe, expect, it } from "vitest";
import {
  handleLoginSubmission,
  type LoginAuthenticator,
} from "@/app/login/actions";

const context = {
  requestId: "req-login-action",
  ipAddress: "127.0.0.1",
  userAgent: "Vitest",
};

describe("handleLoginSubmission", () => {
  it("rejects a missing username or password before authentication", async () => {
    const authenticator: LoginAuthenticator = {
      login: async () => {
        throw new Error("authentication must not run for an invalid form");
      },
    };

    const outcome = await handleLoginSubmission(
      new FormData(),
      authenticator,
      context,
    );

    expect(outcome).toEqual({ kind: "failure", error: "invalid_credentials" });
  });

  it("returns the same public error for invalid credentials", async () => {
    const authenticator: LoginAuthenticator = {
      login: async () => ({ ok: false, reason: "invalid_credentials" }),
    };
    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "Wrong password 2026!");

    const outcome = await handleLoginSubmission(formData, authenticator, context);

    expect(outcome).toEqual({ kind: "failure", error: "invalid_credentials" });
  });

  it("passes a successful session to the cookie boundary", async () => {
    const expiresAt = new Date("2026-08-25T12:00:00Z");
    const authenticator: LoginAuthenticator = {
      login: async () => ({
        ok: true,
        rawToken: "browser-session-token",
        expiresAt,
        account: {
          id: 1,
          displayName: "超级管理员",
          role: "super_admin",
          uiLanguage: "zh",
          mustChangePassword: true,
          delegatedPermissions: [],
        },
      }),
    };
    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "Formal admin 2026!");

    const outcome = await handleLoginSubmission(formData, authenticator, context);

    expect(outcome).toEqual({
      kind: "success",
      rawToken: "browser-session-token",
      expiresAt,
      role: "super_admin",
      mustChangePassword: true,
    });
  });
});
