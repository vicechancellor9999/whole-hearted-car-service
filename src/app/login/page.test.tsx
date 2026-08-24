import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  it("shows only the credentials needed to enter the formal system", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("img", {
      name: "Whole Hearted Car Service Logo",
    })).toHaveAttribute("src", expect.stringContaining("brand-logo-wh-512.png"));
    expect(screen.getByRole("heading", { name: "登录正式系统" })).toBeInTheDocument();
    expect(screen.getByLabelText("登录名")).toHaveAttribute("name", "username");
    expect(screen.getByLabelText("密码")).toHaveAttribute("name", "password");
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /注册/ })).not.toBeInTheDocument();
  });

  it("does not distinguish a wrong password from a disabled account", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ error: "invalid_credentials" }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("登录名或密码不正确");
  });

  it("shows a temporary lock message after too many failures", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ error: "rate_limited" }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录尝试过多，请 15 分钟后再试",
    );
  });
});
