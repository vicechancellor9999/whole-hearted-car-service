import { describe, expect, it } from "vitest";
import type { CurrentSession } from "@/modules/auth/auth-service";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  requirePermission,
} from "@/modules/permissions/require-permission";

function session(
  role: CurrentSession["account"]["role"],
  delegatedPermissions: CurrentSession["account"]["delegatedPermissions"] = [],
): CurrentSession {
  return {
    sessionId: 1,
    account: {
      id: 1,
      displayName: "Test account",
      role,
      mustChangePassword: false,
      delegatedPermissions,
    },
    expiresAt: new Date("2026-08-25T12:00:00Z"),
  };
}

describe("requirePermission", () => {
  it("rejects a direct unauthenticated service call with 401", () => {
    expect(() => requirePermission(null, "business.read.all")).toThrow(
      AuthenticationRequiredError,
    );
    try {
      requirePermission(null, "business.read.all");
    } catch (error) {
      expect(error).toMatchObject({ status: 401, code: "authentication_required" });
    }
  });

  it("rejects an owner write even when the page control is bypassed", () => {
    expect(() => requirePermission(session("owner"), "master_data.write")).toThrow(
      AuthorizationDeniedError,
    );
    try {
      requirePermission(session("owner"), "master_data.write");
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: "permission_denied" });
    }
  });

  it("returns the authenticated account when the service permission is present", () => {
    expect(
      requirePermission(session("super_admin"), "accounts.manage"),
    ).toMatchObject({ role: "super_admin" });
  });

  it("accepts an explicitly delegated front desk sensitive permission", () => {
    expect(
      requirePermission(
        session("front_desk", ["sensitive_operations.execute"]),
        "sensitive_operations.execute",
      ),
    ).toMatchObject({ role: "front_desk" });
  });
});
