import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Dialog } from "../../src/components/ui/dialog";

afterEach(() => { cleanup(); document.body.removeAttribute("tabindex"); });

it("returns focus to the remaining dialog when the child opened after its trigger lost focus", async () => {
  const view = (child: boolean) => <>
    <Dialog open title="检查草稿" onClose={() => {}}><input aria-label="检查内容" /></Dialog>
    {child ? <Dialog open title="车辆资料" onClose={() => {}}><input aria-label="车牌" /></Dialog> : null}
  </>;
  const rendered = render(view(false));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭检查草稿" })));
  // A disabled async launch button can lose focus before the child portal mounts.
  document.body.tabIndex = -1;
  document.body.focus();
  rendered.rerender(view(true));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭车辆资料" })));
  rendered.rerender(view(false));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭检查草稿" })));
  expect(document.body.style.overflow).toBe("hidden");
});
