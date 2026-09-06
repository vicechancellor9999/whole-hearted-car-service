import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormalBusinessOrderProblemDescription } from "../../src/components/orders/formal-business-order-problem-description";
import type { FormalBusinessOrderProblemDescriptionContext } from "../../src/lib/api/formal-business-orders";

const locale = vi.hoisted(() => ({ language: "zh" }));
vi.mock("../../src/lib/i18n/language", () => ({ useI18n: () => ({ language: locale.language }) }));

const context: FormalBusinessOrderProblemDescriptionContext = {
  original: { contentZh: "创建时车辆异响", contentEn: null, sourceType: "creation", sourceReferenceId: null, confirmedBy: 1, confirmedByName: "Test", confirmedAt: "2026-09-01T12:00:00Z" },
  current: null, currentRound: null, currentRoundHistory: [],
  businessOrderHistory: [{ id: 8, versionNo: 1, contentZh: "此前记录的检查范围", contentEn: null, sourceType: "creation", sourceReferenceId: null, changeReason: "初次登记", createdBy: 1, createdByName: "Test", createdAt: "2026-09-01T12:00:00Z" }],
};
afterEach(cleanup);
beforeEach(() => { locale.language = "zh"; });

it("shows a pending description and keeps original/history accessible when current content is empty", () => {
  render(<FormalBusinessOrderProblemDescription businessOrderId={7} context={context} canWrite onSaved={vi.fn()} />);
  expect(screen.getByText("当前问题描述待补")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看问题历史" }));
  expect(screen.getByText("创建时车辆异响")).toBeTruthy();
  expect(screen.getByText("此前记录的检查范围")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "修改问题描述" }));
  expect(screen.getByRole("dialog", { name: "修改整张业务单问题描述" })).toBeTruthy();
});

it("does not hide the empty state or history from a read-only user and offers no edit action", () => {
  render(<FormalBusinessOrderProblemDescription businessOrderId={7} context={context} canWrite={false} onSaved={vi.fn()} />);
  expect(screen.getByText("当前问题描述待补")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看问题历史" }));
  expect(screen.getByText("此前记录的检查范围")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /修改/ })).toBeNull();
});

it("preserves untranslated historical evidence in English instead of claiming it was never entered", () => {
  locale.language = "en";
  render(<FormalBusinessOrderProblemDescription businessOrderId={7} context={context} canWrite={false} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "View problem history" }));
  expect(screen.getByText("创建时车辆异响")).toBeTruthy();
  expect(screen.getByText("此前记录的检查范围")).toBeTruthy();
  expect(screen.queryByText("Not entered at creation")).toBeNull();
});
