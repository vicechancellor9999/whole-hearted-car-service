import { describe, expect, it } from "vitest";
import { getRoleNavigation } from "@formal/modules/permissions/role-navigation";

describe("role navigation", () => {
  it("shows account management only to a super administrator", () => {
    expect(getRoleNavigation("super_admin")).toEqual([
      { label: "经营概览", href: "/dashboard" },
      { label: "Business Order", href: "/business-orders" },
      { label: "Inspection Report", href: "/inspection-reports" },
      { label: "绩效管理", href: "/performance" },
      { label: "客户档案", href: "/customers" },
      { label: "公司账户", href: "/companies" },
      { label: "车辆档案", href: "/vehicles" },
      { label: "基础资料", href: "/master-data" },
      { label: "员工管理", href: "/employees" },
      { label: "账号管理", href: "/settings/accounts" },
      { label: "审计记录", href: "/settings/audit" },
    ]);
    expect(getRoleNavigation("front_desk")).toEqual([
      { label: "经营概览", href: "/dashboard" },
      { label: "Business Order", href: "/business-orders" },
      { label: "Inspection Report", href: "/inspection-reports" },
      { label: "绩效管理", href: "/performance" },
      { label: "客户档案", href: "/customers" },
      { label: "公司账户", href: "/companies" },
      { label: "车辆档案", href: "/vehicles" },
      { label: "基础资料", href: "/master-data" },
      { label: "员工管理", href: "/employees" },
    ]);
    expect(getRoleNavigation("owner")).toEqual([
      { label: "经营概览", href: "/dashboard" },
      { label: "Business Order", href: "/business-orders" },
      { label: "Inspection Report", href: "/inspection-reports" },
      { label: "绩效管理", href: "/performance" },
      { label: "客户档案", href: "/customers" },
      { label: "公司账户", href: "/companies" },
      { label: "车辆档案", href: "/vehicles" },
      { label: "基础资料", href: "/master-data" },
      { label: "员工管理", href: "/employees" },
      { label: "审计记录", href: "/settings/audit" },
    ]);
  });

  it("does not expose PC navigation to a mechanic", () => {
    expect(getRoleNavigation("mechanic")).toEqual([]);
  });
});
