export type FormalRole = "super_admin" | "front_desk" | "owner" | "mechanic";

export type FormalDelegatedPermission = "sensitive_operations.execute";

export type FormalNavigationKey =
  | "dashboard"
  | "workbench"
  | "business_orders"
  | "inspection_reports"
  | "master_data"
  | "employees"
  | "performance"
  | "payments"
  | "parking"
  | "customers"
  | "vehicles"
  | "settings";

export type FormalPcPolicy = Readonly<{
  pcAccess: boolean;
  readOnly: boolean;
  canExecuteSensitiveOperations: boolean;
}>;

const frontendRoleByFormalRole: Record<FormalRole, string> = {
  super_admin: "superadmin",
  front_desk: "frontdesk_admin",
  owner: "owner_readonly",
  mechanic: "mechanic",
};

const navigationByRole: Record<FormalRole, readonly FormalNavigationKey[]> = {
  super_admin: [
    "dashboard",
    "workbench",
    "business_orders",
    "inspection_reports",
    "master_data",
    "employees",
    "performance",
    "payments",
    "parking",
    "customers",
    "vehicles",
    "settings",
  ],
  front_desk: [
    "dashboard",
    "workbench",
    "business_orders",
    "inspection_reports",
    "master_data",
    "payments",
    "parking",
    "customers",
    "vehicles",
  ],
  owner: [
    "dashboard",
    "workbench",
    "business_orders",
    "inspection_reports",
    "master_data",
    "employees",
    "performance",
    "payments",
    "parking",
    "customers",
    "vehicles",
  ],
  mechanic: [],
};

export function getVisibleNavigationKeys(role: FormalRole): FormalNavigationKey[] {
  return [...navigationByRole[role]];
}

export function getFormalPcPolicy(
  role: FormalRole,
  delegatedPermissions: readonly FormalDelegatedPermission[] = [],
): FormalPcPolicy {
  return {
    pcAccess: role !== "mechanic",
    readOnly: role === "owner",
    canExecuteSensitiveOperations:
      role === "super_admin" ||
      (role === "front_desk" && delegatedPermissions.includes("sensitive_operations.execute")),
  };
}

export function isFormalIdentityConsistent(
  identity: Readonly<{ id: string; name: string; role: string }>,
  formal: Readonly<{
    accountId: number;
    role: FormalRole;
    delegatedPermissions: readonly FormalDelegatedPermission[];
  }>,
): boolean {
  return identity.id === `account-${formal.accountId}`
    && identity.name.trim().length > 0
    && identity.role === frontendRoleByFormalRole[formal.role];
}

export function getMockBusinessActor<Actor extends Readonly<{
  id: string;
  name: string;
  role: string;
}>>(
  identity: Actor,
  formal?: Readonly<{
    accountId: number;
    role: FormalRole;
    delegatedPermissions: readonly FormalDelegatedPermission[];
  }>,
): Actor | Readonly<{ id: "emp-001"; name: "超级管理员"; role: "superadmin" }> {
  if (formal?.role === "super_admin" && isFormalIdentityConsistent(identity, formal)) {
    return { id: "emp-001", name: "超级管理员", role: "superadmin" };
  }
  return identity;
}
