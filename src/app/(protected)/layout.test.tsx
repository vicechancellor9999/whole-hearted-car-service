import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CurrentSession } from "@/modules/auth/auth-service";
import { ProtectedShell } from "@/app/(protected)/layout";

function session(
  role: CurrentSession["account"]["role"],
  displayName: string,
): CurrentSession {
  return {
    sessionId: 1,
    account: {
      id: 1,
      displayName,
      role,
      mustChangePassword: false,
    },
    expiresAt: new Date("2026-08-25T12:00:00Z"),
  };
}

describe("ProtectedShell", () => {
  it("marks the owner workspace read-only and hides management navigation", () => {
    render(
      <ProtectedShell session={session("owner", "老板")}>
        <p>经营数据</p>
      </ProtectedShell>,
    );

    expect(screen.getByText("全部业务只读")).toBeInTheDocument();
    expect(screen.getByText("经营数据")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "账号管理" })).not.toBeInTheDocument();
  });

  it("shows account management to the super administrator", () => {
    render(
      <ProtectedShell session={session("super_admin", "超级管理员")}>
        <p>系统内容</p>
      </ProtectedShell>,
    );

    expect(screen.getByRole("link", { name: "账号管理" })).toHaveAttribute(
      "href",
      "/settings/accounts",
    );
  });

  it("blocks a mechanic from seeing any PC child content", () => {
    render(
      <ProtectedShell session={session("mechanic", "维修工")}>
        <p>不应显示的 PC 数据</p>
      </ProtectedShell>,
    );

    expect(screen.getByRole("heading", { name: "此账号不提供 PC 网页端" })).toBeInTheDocument();
    expect(screen.queryByText("不应显示的 PC 数据")).not.toBeInTheDocument();
  });
});
