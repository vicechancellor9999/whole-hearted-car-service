import { describe, expect, it } from "vitest";
import {
  resolveCurrentSession,
  type CurrentSessionReader,
} from "@formal/modules/auth/current-session";

describe("resolveCurrentSession", () => {
  it("does not query the database when the browser has no session cookie", async () => {
    const reader: CurrentSessionReader = {
      getCurrentSession: async () => {
        throw new Error("database must not be queried without a token");
      },
    };

    await expect(resolveCurrentSession(undefined, reader)).resolves.toBeNull();
  });

  it("returns the database-validated account instead of trusting cookie data", async () => {
    const expiresAt = new Date("2026-08-25T12:00:00Z");
    const reader: CurrentSessionReader = {
      getCurrentSession: async (rawToken) =>
        rawToken === "valid-browser-token"
          ? {
              sessionId: 9,
              account: {
                id: 1,
                displayName: "超级管理员",
                role: "super_admin",
                mustChangePassword: false,
                delegatedPermissions: [],
              },
              expiresAt,
            }
          : null,
    };

    await expect(
      resolveCurrentSession("valid-browser-token", reader),
    ).resolves.toEqual({
      sessionId: 9,
      account: {
        id: 1,
        displayName: "超级管理员",
        role: "super_admin",
        mustChangePassword: false,
        delegatedPermissions: [],
      },
      expiresAt,
    });
  });
});
