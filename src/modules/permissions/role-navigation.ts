import type { AccountRole } from "@formal/modules/auth/auth-service";
import { hasPermission } from "@formal/modules/permissions/permissions";

export type NavigationItem = Readonly<{
  label: string;
  href: string;
}>;

const navigationItems = [
  {
    label: "经营概览",
    href: "/dashboard",
    permission: "pc.dashboard.read",
  },
  {
    label: "Business Order",
    href: "/business-orders",
    permission: "business.read.all",
  },
  {
    label: "Inspection Report",
    href: "/inspection-reports",
    permission: "business.read.all",
  },
  {
    label: "绩效管理",
    href: "/performance",
    permission: "pc.dashboard.read",
  },
  {
    label: "客户档案",
    href: "/customers",
    permission: "customer_vehicle.read",
  },
  {
    label: "公司账户",
    href: "/companies",
    permission: "customer_vehicle.read",
  },
  {
    label: "车辆档案",
    href: "/vehicles",
    permission: "customer_vehicle.read",
  },
  {
    label: "基础资料",
    href: "/master-data",
    permission: "master_data.read",
  },
  {
    label: "员工管理",
    href: "/employees",
    permission: "master_data.read",
  },
  {
    label: "账号管理",
    href: "/settings/accounts",
    permission: "accounts.manage",
  },
  {
    label: "审计记录",
    href: "/settings/audit",
    permission: "audit.read",
  },
] as const;

export function getRoleNavigation(role: AccountRole): NavigationItem[] {
  return navigationItems
    .filter((item) => hasPermission(role, item.permission))
    .map(({ label, href }) => ({ label, href }));
}
