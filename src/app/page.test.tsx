import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("formal system home page", () => {
  it("gives staff a clear route into the formal system", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "Whole Hearted 正式管理系统" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
