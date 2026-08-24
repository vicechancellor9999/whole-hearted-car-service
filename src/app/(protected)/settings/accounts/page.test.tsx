import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountManagementView } from "@/app/(protected)/settings/accounts/page";
import type { ManagedAccount } from "@/modules/accounts/account-service";

const accounts: ManagedAccount[] = [
  {
    id: 1,
    displayName: "超级管理员",
    normalizedUsername: "admin",
    role: "super_admin",
    isActive: true,
    mustChangePassword: false,
    sessionEpoch: 1,
    version: 1,
    delegatedPermissions: [],
  },
  {
    id: 2,
    displayName: "前台一号",
    normalizedUsername: "front.one",
    role: "front_desk",
    isActive: true,
    mustChangePassword: true,
    sessionEpoch: 1,
    version: 2,
    delegatedPermissions: ["sensitive_operations.execute"],
  },
];

describe("AccountManagementView", () => {
  it("exposes every confirmed account lifecycle operation without a delete action", () => {
    render(<AccountManagementView accounts={accounts} />);

    expect(
      screen.getByRole("heading", { name: "账号管理" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新增账号" })).toBeInTheDocument();
    expect(screen.getByLabelText("新账号角色")).toHaveTextContent(
      "超级管理员",
    );
    expect(screen.getByText("front.one")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "保存显示名" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "保存角色" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "强制退出" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "停用账号" })).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "关闭敏感操作权限" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除/ })).not.toBeInTheDocument();
  });
});
