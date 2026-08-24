import type { AccountRole } from "@/modules/auth/auth-service";

export type Permission =
  | "login"
  | "pc.dashboard.read"
  | "business.read.all"
  | "master_data.write"
  | "accounts.manage"
  | "sensitive_operations.execute"
  | "mechanic.mobile.access";

export const permissionMatrix: Record<
  AccountRole,
  Record<Permission, boolean>
> = {
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

const frontDeskDelegatablePermissions = new Set<Permission>([
  "sensitive_operations.execute",
]);

export function hasPermission(
  role: AccountRole,
  permission: Permission,
  delegatedPermissions: readonly Permission[] = [],
): boolean {
  if (permissionMatrix[role][permission]) return true;
  return (
    role === "front_desk" &&
    frontDeskDelegatablePermissions.has(permission) &&
    delegatedPermissions.includes(permission)
  );
}
