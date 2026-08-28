import type { AccountRole } from "@formal/modules/auth/auth-service";

export type Permission =
  | "login"
  | "pc.dashboard.read"
  | "business.read.all"
  | "customer_vehicle.read"
  | "customer_vehicle.write"
  | "business_order.write"
  | "business_order.collaborate"
  | "record.delete"
  | "master_data.read"
  | "master_data.write"
  | "workforce.manage"
  | "accounts.manage"
  | "audit.read"
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
    "customer_vehicle.read": true,
    "customer_vehicle.write": true,
    "business_order.write": true,
    "business_order.collaborate": true,
    "record.delete": true,
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
    "business_order.collaborate": true,
    "record.delete": true,
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
    "business_order.collaborate": true,
    "record.delete": false,
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
    "business_order.collaborate": true,
    "record.delete": false,
    "master_data.read": false,
    "master_data.write": false,
    "workforce.manage": false,
    "accounts.manage": false,
    "audit.read": false,
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
