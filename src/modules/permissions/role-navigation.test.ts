import { describe, expect, it } from "vitest";
import { getRoleNavigation } from "@/modules/permissions/role-navigation";

describe("role navigation", () => {
  it("shows account management only to a super administrator", () => {
    expect(getRoleNavigation("super_admin")).toEqual([
      { label: "工作台", href: "/dashboard" },
      { label: "账号管理", href: "/settings/accounts" },
      { label: "审计记录", href: "/settings/audit" },
    ]);
    expect(getRoleNavigation("front_desk")).toEqual([
      { label: "工作台", href: "/dashboard" },
    ]);
    expect(getRoleNavigation("owner")).toEqual([
      { label: "工作台", href: "/dashboard" },
      { label: "审计记录", href: "/settings/audit" },
    ]);
  });

  it("does not expose PC navigation to a mechanic", () => {
    expect(getRoleNavigation("mechanic")).toEqual([]);
  });
});
