import { describe, expect, it } from "vitest";
import {
  hasPermission,
  permissionMatrix,
  type Permission,
} from "@/modules/permissions/permissions";
import type { AccountRole } from "@/modules/auth/auth-service";

const expected: Record<AccountRole, Record<Permission, boolean>> = {
  super_admin: {
    login: true,
    "pc.dashboard.read": true,
    "business.read.all": true,
    "master_data.write": true,
    "accounts.manage": true,
    "sensitive_operations.execute": true,
    "mechanic.mobile.access": false,
  },
  front_desk: {
    login: true,
    "pc.dashboard.read": true,
    "business.read.all": true,
    "master_data.write": true,
    "accounts.manage": false,
    "sensitive_operations.execute": false,
    "mechanic.mobile.access": false,
  },
  owner: {
    login: true,
    "pc.dashboard.read": true,
    "business.read.all": true,
    "master_data.write": false,
    "accounts.manage": false,
    "sensitive_operations.execute": false,
    "mechanic.mobile.access": false,
  },
  mechanic: {
    login: true,
    "pc.dashboard.read": false,
    "business.read.all": false,
    "master_data.write": false,
    "accounts.manage": false,
    "sensitive_operations.execute": false,
    "mechanic.mobile.access": true,
  },
};

describe("formal role permissions", () => {
  it("matches the confirmed PC and mechanic role matrix", () => {
    expect(permissionMatrix).toEqual(expected);
  });

  it("allows a front desk sensitive operation only after explicit delegation", () => {
    expect(hasPermission("front_desk", "sensitive_operations.execute")).toBe(false);
    expect(
      hasPermission("front_desk", "sensitive_operations.execute", [
        "sensitive_operations.execute",
      ]),
    ).toBe(true);
  });

  it("does not let delegation expand owner or mechanic permissions", () => {
    expect(
      hasPermission("owner", "master_data.write", ["master_data.write"]),
    ).toBe(false);
    expect(
      hasPermission("mechanic", "pc.dashboard.read", ["pc.dashboard.read"]),
    ).toBe(false);
  });
});
