import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormalInspectionCreateDialog } from "../../src/components/orders/formal-inspection-create-dialog";
import { createFormalInspectionReport } from "../../src/lib/api/formal-inspections";

// Exercise the real creation API adapter; only the network and unrelated
// vehicle editor/master-data loading are isolated.
vi.mock("../../src/lib/api/formal-master-data", () => ({ fetchFormalMasterData: vi.fn().mockResolvedValue({ teams: [{ id: 3, name: "车间一组", isActive: true }], staff: [] }) }));
vi.mock("../../src/components/customers/form-dialogs", () => ({ VehicleFormDialog: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps the draft and provides a separate verification route after an unconfirmed creation response", async () => {
  const requests = vi.fn().mockResolvedValue(new Response('{"id":', { status: 201 }));
  vi.stubGlobal("fetch", requests);
  const created = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} sourceBusinessOrderId={12} onClose={vi.fn()} onCreated={created} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  fireEvent.change(summary, { target: { value: "不要丢失的检查内容" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  expect((await screen.findByRole("alert")).textContent).toContain("无法确认");
  const link = screen.getByRole("link", { name: "打开检查结果列表核对（新标签页）" });
  expect(link.getAttribute("href")).toBe("/orders/inspections");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(summary.value).toBe("不要丢失的检查内容");
  expect(summary.matches(":disabled")).toBe(false);
  expect(created).not.toHaveBeenCalled();
  expect(screen.queryByText("检查结果已创建")).toBeNull();
  expect(requests).toHaveBeenCalledTimes(1);
});

it.each(["headers", "body"])("releases a creation waiting for %s after 30 seconds without losing its draft or retrying", async (phase) => {
  let finish!: (value: unknown) => void;
  const deferred = new Promise(resolve => { finish = resolve; });
  const network = vi.fn().mockImplementation(() => phase === "headers" ? deferred : Promise.resolve({ ok: true, json: () => deferred }));
  vi.stubGlobal("fetch", network);
  const created = vi.fn();
  const track = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} sourceBusinessOrderId={12} onBackgroundStatus={track} onClose={vi.fn()} onCreated={created} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  fireEvent.change(summary, { target: { value: "等待超时也要保留" } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole("alert").textContent).toContain("超时");
  expect(summary.value).toBe("等待超时也要保留");
  expect(summary.matches(":disabled")).toBe(false);
  expect(screen.getByRole("link", { name: "打开检查结果列表核对（新标签页）" }).getAttribute("target")).toBe("_blank");
  expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unconfirmed", draft: expect.objectContaining({ summaryZh: "等待超时也要保留", sourceBusinessOrderId: 12 }) }));
  const init = network.mock.calls[0][1] as RequestInit;
  expect(init.signal?.aborted).toBe(true);
  const report = { id: 91, reportNo: "IR-91", vehicleId: 8, inspectionTeamId: 3, sourceBusinessOrderId: 12, summaryZh: "等待超时也要保留", actualInspectorStaffMemberId: null, specialCaseNotesZh: null };
  await act(async () => { finish(phase === "headers" ? new Response(JSON.stringify(report), { status: 201 }) : report); });
  expect(created).not.toHaveBeenCalled();
  expect(screen.queryByText("检查结果已创建")).toBeNull();
  expect(network).toHaveBeenCalledTimes(1);
});

const submitted = { vehicleId: 8, sourceBusinessOrderId: 12, inspectionTeamId: 3, actualInspectorStaffMemberId: 4, summaryZh: " 检查异响 ", specialCaseNotesZh: " 需要路试 " };
const saved = { id: 91, reportNo: "IR-91", ...submitted, summaryZh: "检查异响", specialCaseNotesZh: "需要路试" };
it.each([
  { summaryZh: "其他检查" },
  { actualInspectorStaffMemberId: 9 },
  { specialCaseNotesZh: null },
])("does not confirm a creation whose returned work differs from the submission: %j", async (changed) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...saved, ...changed }), { status: 201 })));
  await expect(createFormalInspectionReport(submitted)).rejects.toThrow("无法确认");
});
it("accepts server-trimmed creation content with its original mechanic and notes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 })));
  await expect(createFormalInspectionReport(submitted)).resolves.toMatchObject(saved);
});
it("accepts server NFKC normalization and empty optional values", async () => {
  const normalized = { ...saved, summaryZh: "检查ABC", actualInspectorStaffMemberId: null, specialCaseNotesZh: null };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(normalized), { status: 201 })));
  await expect(createFormalInspectionReport({ ...submitted, summaryZh: " 检查ＡＢＣ ", actualInspectorStaffMemberId: null, specialCaseNotesZh: " " })).resolves.toMatchObject(normalized);
});
