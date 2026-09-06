import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormalBusinessOrderTabs } from "../../src/components/orders/formal-business-order-tabs";

afterEach(cleanup);

it("allows keyboard navigation between workspaces without losing the order or activating a tab prematurely", () => {
  render(<FormalBusinessOrderTabs pathname="/orders/business/1" searchParams={new URLSearchParams("tab=operations&message=10")} active="operations" />);
  const tabs = screen.getAllByRole("tab");
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute("href")).toBe("/orders/business/1?tab=documents");
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(tabs[1], { key: "End" });
  expect(document.activeElement).toBe(tabs[4]);
  fireEvent.keyDown(tabs[4], { key: "ArrowRight" });
  expect(document.activeElement).toBe(tabs[0]);
});
