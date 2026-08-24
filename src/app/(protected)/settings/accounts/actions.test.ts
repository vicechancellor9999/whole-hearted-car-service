import { describe, expect, it } from "vitest";
import { parseAccountManagementSubmission } from "@/app/(protected)/settings/accounts/submission";

describe("parseAccountManagementSubmission", () => {
  it("parses the complete new-account form", () => {
    const formData = new FormData();
    formData.set("operation", "create");
    formData.set("displayName", "前台一号");
    formData.set("username", "front.one");
    formData.set("password", "Front desk 2026!");
    formData.set("role", "front_desk");

    expect(parseAccountManagementSubmission(formData)).toEqual({
      operation: "create",
      displayName: "前台一号",
      username: "front.one",
      password: "Front desk 2026!",
      role: "front_desk",
    });
  });

  it("parses explicit on and off values without trusting checkbox presence", () => {
    const active = new FormData();
    active.set("operation", "set_active");
    active.set("accountId", "17");
    active.set("enabled", "false");
    const permission = new FormData();
    permission.set("operation", "set_sensitive_permission");
    permission.set("accountId", "17");
    permission.set("enabled", "true");

    expect(parseAccountManagementSubmission(active)).toEqual({
      operation: "set_active",
      accountId: 17,
      enabled: false,
    });
    expect(parseAccountManagementSubmission(permission)).toEqual({
      operation: "set_sensitive_permission",
      accountId: 17,
      enabled: true,
    });
  });

  it("rejects an unknown role and a non-numeric target account", () => {
    const role = new FormData();
    role.set("operation", "change_role");
    role.set("accountId", "not-an-id");
    role.set("role", "parts_manager");

    expect(() => parseAccountManagementSubmission(role)).toThrow();
  });
});
