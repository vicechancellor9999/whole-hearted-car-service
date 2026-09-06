import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormalInspectionReportDetailView } from "../../src/components/orders/formal-inspection-report-detail";
import { inspectionDetailFixture } from "../fixtures/inspection-detail";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("../../src/components/shared/record-delete-dialog", () => ({ RecordDeleteButton: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the edited report after a truncated save, retries latest-version read, and adopts a confirmed version without another write", async () => {
  const initial = structuredClone(inspectionDetailFixture);
  initial.report.version = 1;
  initial.workspace.versionNo = 0;
  initial.workspace.source = "original";
  const confirmed = structuredClone(inspectionDetailFixture);
  confirmed.workspace.organized.summaryEn = "My retained draft";
  let reads = 0;
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; return new Response('{"report":'); }
    reads++;
    return new Response(reads === 1 ? JSON.stringify(initial) : reads === 2 ? "{}" : JSON.stringify(confirmed));
  }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  fireEvent.change(screen.getByRole("textbox", { name: "英文检查结论" }), { target: { value: "My retained draft" } });
  fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  expect((await screen.findByRole("alert")).textContent).toContain("核对最新版本");
  expect(screen.getByText("My retained draft")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "IR-20260905-0009" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "核对最新版本" }));
  const dialog = await screen.findByRole("dialog", { name: "核对报告版本" });
  expect((await within(dialog).findByRole("alert")).textContent).toContain("重新读取");
  fireEvent.click(within(dialog).getByRole("button", { name: "重新读取最新版本" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "使用最新版本作为草稿" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("My retained draft")).toBeTruthy();
  expect(screen.getByText("整理版本 V1")).toBeTruthy();
  expect(writes).toBe(1);
});
