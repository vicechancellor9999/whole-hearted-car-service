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
    "customer_vehicle.read": true,
    "customer_vehicle.write": true,
    "business_order.write": true,
    "master_data.read": true,
    "master_data.write": true,
    "workforce.manage": true,
    "accounts.manage": true,
    "audit.read": true,
    "sensitive_operations.execute": true,
    "mechanic.mobile.access": false,
  },
  front_desk: {
    login: true,
    "pc.dashboard.read": true,
    "business.read.all": true,
    "customer_vehicle.read": true,
    "customer_vehicle.write": true,
    "business_order.write": true,
    "master_data.read": true,
    "master_data.write": true,
    "workforce.manage": false,
    "accounts.manage": false,
    "audit.read": false,
    "sensitive_operations.execute": false,
    "mechanic.mobile.access": false,
  },
  owner: {
    login: true,
    "pc.dashboard.read": true,
    "business.read.all": true,
    "customer_vehicle.read": true,
    "customer_vehicle.write": false,
    "business_order.write": false,
    "master_data.read": true,
    "master_data.write": false,
    "workforce.manage": false,
    "accounts.manage": false,
    "audit.read": true,
    "sensitive_operations.execute": false,
    "mechanic.mobile.access": false,
  },
  mechanic: {
    login: true,
    "pc.dashboard.read": false,
    "business.read.all": false,
    "customer_vehicle.read": false,
    "customer_vehicle.write": false,
    "business_order.write": false,
    "master_data.read": false,
    "master_data.write": false,
    "workforce.manage": false,
    "accounts.manage": false,
    "audit.read": false,
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

  it("allows only the super administrator and read-only owner to read the full audit", () => {
    const auditPermission = "audit.read" as Permission;
    expect(hasPermission("super_admin", auditPermission)).toBe(true);
    expect(hasPermission("owner", auditPermission)).toBe(true);
    expect(hasPermission("front_desk", auditPermission)).toBe(false);
    expect(hasPermission("mechanic", auditPermission)).toBe(false);
  });

  it("keeps workforce and payroll maintenance with the super administrator", () => {
    expect(hasPermission("super_admin", "workforce.manage")).toBe(true);
    expect(hasPermission("front_desk", "workforce.manage")).toBe(false);
    expect(hasPermission("owner", "workforce.manage")).toBe(false);
    expect(hasPermission("mechanic", "workforce.manage")).toBe(false);
  });
});
