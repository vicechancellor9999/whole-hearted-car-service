import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { RecordDeleteButton } from "../../src/components/shared/record-delete-dialog";
import { executeFormalRecordDeletion, FormalRecordDeletionApiError, previewFormalRecordDeletion, readFormalRecordDeletionResult } from "../../src/lib/api/formal-record-deletions";
import type { RecordDeletionPreview, RecordDeletionResult } from "../../../../src/modules/record-deletion/record-deletion-types";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../../src/lib/api/formal-record-deletions", async (original) => ({ ...await original<object>(), previewFormalRecordDeletion: vi.fn(), executeFormalRecordDeletion: vi.fn(), readFormalRecordDeletionResult: vi.fn() }));
const root = { kind: "inspection_report" as const, recordNo: "IR-20260905-0009", version: 1 };
const linked = { kind: "inspection_report" as const, recordNo: "IR-20260905-0010", version: 1 };
const preview: RecordDeletionPreview = { eligible: true, rootRecord: root, selectableLinkedRecords: [], dependentCounts: {}, releasedIdentityKinds: [], blockers: [], previewFingerprint: "a".repeat(64) };
beforeEach(() => {
  sessionStorage.clear();
  navigation.push.mockReset(); navigation.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { id: 1, role: "super_admin" } }) }));
  vi.mocked(previewFormalRecordDeletion).mockReset().mockResolvedValue(preview);
  vi.mocked(executeFormalRecordDeletion).mockReset();
  vi.mocked(readFormalRecordDeletionResult).mockReset();
});

it("restores the same uncertain deletion after remount without creating or executing a fresh request", async () => {
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("结果未知"));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("结果未知");
  const original = structuredClone(vi.mocked(executeFormalRecordDeletion).mock.calls[0][0]);
  cleanup();
  render(<RecordDeleteButton record={root} title="删除检查结果" returnTo="/orders/inspections" />);
  fireEvent.click(await screen.findByRole("button", { name: "查看删除进度" }));
  expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
  expect(screen.getByText(`请求编号：${original.requestId}`)).toBeTruthy();
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("仍需核对"));
  fireEvent.click(screen.getByRole("button", { name: "重试同一次删除" }));
  await screen.findByText("仍需核对");
  expect(vi.mocked(executeFormalRecordDeletion).mock.calls[1][0]).toEqual(original);
});

it("hides old-account requests and ignores their late navigation after session changes", async () => {
  let resolveSave!: (result: RecordDeletionResult) => void;
  vi.mocked(executeFormalRecordDeletion).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  const original = vi.mocked(executeFormalRecordDeletion).mock.calls[0][0];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { id: 2, role: "super_admin" } }) }));
  await act(async () => window.dispatchEvent(new Event("wh:formal-session-changed")));
  await screen.findByRole("button", { name: "删除" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => resolveSave({ requestId: original.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 }));
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.queryByText("删除已完成")).toBeNull();
});

it("does not navigate when an old success arrives in the same tick as an account change", async () => {
  let resolveSave!: (result: RecordDeletionResult) => void;
  vi.mocked(executeFormalRecordDeletion).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  const original = vi.mocked(executeFormalRecordDeletion).mock.calls[0][0];
  await act(async () => {
    window.dispatchEvent(new Event("wh:formal-session-changed"));
    resolveSave({ requestId: original.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 });
  });
  expect(navigation.push).not.toHaveBeenCalled();
});

it("offers retryable local recovery when storage is unavailable without resubmitting deletion", async () => {
  await open(); await fillConfirmation();
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("结果未知"));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("结果未知");
  expect(screen.getByText(/删除进度暂存或清理失败/)).toBeTruthy();
  fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "重试本机暂存处理" }));
  expect(screen.queryByText(/删除进度暂存或清理失败/)).toBeNull();
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
});

it.each([{ id: 2, role: "mechanic" }, { role: "super_admin" }])("does not expose deletion for an unverified deletion account %#", async account => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ account })));
  render(<RecordDeleteButton record={root} title="删除检查结果" returnTo="/orders/inspections" />);
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  expect(executeFormalRecordDeletion).not.toHaveBeenCalled();
});

it("checks a committed receipt without retrying deletion or navigating", async () => {
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("结果未知"));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("结果未知");
  const input = vi.mocked(executeFormalRecordDeletion).mock.calls[0][0];
  vi.mocked(readFormalRecordDeletionResult).mockResolvedValueOnce({ requestId: input.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 });
  fireEvent.click(screen.getByRole("button", { name: "只查询删除结果" }));
  await screen.findByText("删除已完成");
  expect(readFormalRecordDeletionResult).toHaveBeenCalledWith(input);
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
  expect(navigation.push).not.toHaveBeenCalled();
});

it("keeps the original request when no committed receipt is found", async () => {
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("结果未知"));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("结果未知");
  vi.mocked(readFormalRecordDeletionResult).mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "只查询删除结果" }));
  await screen.findByText(/尚未找到已完成的删除回执/);
  expect(screen.getByRole("button", { name: "重试同一次删除" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
});

it("ignores a late query after closing and allows a fresh read after reopening", async () => {
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("结果未知"));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("结果未知");
  let resolveOld!: (value: RecordDeletionResult | null) => void;
  vi.mocked(readFormalRecordDeletionResult).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "只查询删除结果" }));
  fireEvent.click(screen.getByRole("button", { name: "正在查询结果…" }));
  expect(readFormalRecordDeletionResult).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "返回记录" }));
  fireEvent.click(screen.getByRole("button", { name: "查看删除进度" }));
  vi.mocked(readFormalRecordDeletionResult).mockRejectedValueOnce(new Error("读取超时"));
  fireEvent.click(screen.getByRole("button", { name: "只查询删除结果" }));
  await screen.findByText("读取超时");
  const input = vi.mocked(executeFormalRecordDeletion).mock.calls[0][0];
  await act(async () => resolveOld({ requestId: input.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 }));
  expect(screen.queryByText("删除已完成")).toBeNull();
  expect(screen.getByText("读取超时")).toBeTruthy();
  expect(screen.getByRole("button", { name: "只查询删除结果" })).toBeTruthy();
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
});

it("invalidates a pending query when execution requires a new preview", async () => {
  let rejectExecute!: (error: Error) => void;
  vi.mocked(executeFormalRecordDeletion).mockImplementationOnce(() => new Promise((_, reject) => { rejectExecute = reject; }));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  let rejectQuery!: (error: Error) => void;
  vi.mocked(readFormalRecordDeletionResult).mockImplementationOnce(() => new Promise((_, reject) => { rejectQuery = reject; }));
  fireEvent.click(screen.getByRole("button", { name: "只查询删除结果" }));
  await act(async () => rejectExecute(new FormalRecordDeletionApiError("资料已变化", "DELETION_PREVIEW_STALE", null, 409)));
  await screen.findByRole("combobox", { name: "删除原因" });
  await act(async () => rejectQuery(new Error("旧查询结果不应覆盖新检查")));
  expect(screen.queryByText("旧查询结果不应覆盖新检查")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("请再次确认");
});

it("retains a pending deletion across closing and reopening without another request or preview", async () => {
  let resolveSave!: (result: RecordDeletionResult) => void;
  vi.mocked(executeFormalRecordDeletion).mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭删除检查结果" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("删除请求尚未返回");
  fireEvent.click(screen.getByRole("button", { name: "查看删除进度" }));
  expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
  expect(previewFormalRecordDeletion).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "返回记录" }));
  const attempt = vi.mocked(executeFormalRecordDeletion).mock.calls[0]![0];
  await act(async () => resolveSave({ requestId: attempt.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("删除已完成");
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看删除结果" }));
  expect(screen.getByRole("link", { name: "返回列表" }).getAttribute("href")).toBe("/orders/inspections");
});

it("retries an uncertain deletion with exactly the original payload after reopening", async () => {
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new Error("连接中断"));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("连接中断");
  const first = structuredClone(vi.mocked(executeFormalRecordDeletion).mock.calls[0]![0]);
  fireEvent.click(screen.getByRole("button", { name: "关闭删除检查结果" }));
  fireEvent.click(screen.getByRole("button", { name: "查看删除进度" }));
  expect(screen.queryByRole("combobox")).toBeNull();
  vi.mocked(executeFormalRecordDeletion).mockResolvedValueOnce({ requestId: first.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 });
  fireEvent.click(screen.getByRole("button", { name: "重试同一次删除" }));
  await screen.findByRole("heading", { name: "删除已完成" });
  expect(vi.mocked(executeFormalRecordDeletion).mock.calls[1]![0]).toEqual(first);
  expect(previewFormalRecordDeletion).toHaveBeenCalledTimes(1);
});

it("keeps confirmed deletion success when navigation fails instead of offering deletion again", async () => {
  navigation.push.mockImplementationOnce(() => { throw new Error("导航失败"); });
  vi.mocked(executeFormalRecordDeletion).mockImplementationOnce(async (input) => ({ requestId: input.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 }));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByRole("heading", { name: "删除已完成" });
  expect(screen.getByRole("link", { name: "返回列表" }).getAttribute("href")).toBe("/orders/inspections");
  expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
  expect(screen.queryByRole("button", { name: "重试同一次删除" })).toBeNull();
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<RecordDeleteButton record={root} title="删除检查结果" returnTo="/orders/inspections" />);
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
}
async function fillConfirmation() {
  fireEvent.change(await screen.findByRole("combobox", { name: "删除原因" }), { target: { value: "test_data" } });
  fireEvent.change(screen.getByRole("textbox", { name: /输入记录编号确认/ }), { target: { value: root.recordNo } });
}

it("retries an initial preview failure in the same window without executing deletion", async () => {
  vi.mocked(previewFormalRecordDeletion).mockRejectedValueOnce(new Error("关联检查暂时不可用"));
  await open();
  await screen.findByText("关联检查暂时不可用");
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联" }));
  await screen.findByRole("combobox", { name: "删除原因" });
  expect(screen.queryByText("关联检查暂时不可用")).toBeNull();
  expect(executeFormalRecordDeletion).not.toHaveBeenCalled();
});

it("closes a pending read and ignores its result after a new preview opens", async () => {
  let resolveOld!: (value: RecordDeletionPreview) => void;
  vi.mocked(previewFormalRecordDeletion).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: "关闭删除检查结果" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await screen.findByRole("combobox", { name: "删除原因" });
  await act(async () => resolveOld({ ...preview, eligible: false, blockers: [{ code: "OLD", label: "旧检查结果", linkedRecord: null }] }));
  expect(screen.queryByText("旧检查结果")).toBeNull();
  expect(screen.getByRole("combobox", { name: "删除原因" })).toBeTruthy();
});

it("requires a new successful preview after linked selection changes, including a failed recheck", async () => {
  vi.mocked(previewFormalRecordDeletion).mockResolvedValue({ ...preview, selectableLinkedRecords: [linked] });
  await open(); await fillConfirmation();
  expect((screen.getByRole("button", { name: "确认删除" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: linked.recordNo }));
  expect((screen.getByRole("button", { name: "确认删除" }) as HTMLButtonElement).disabled).toBe(true);
  vi.mocked(previewFormalRecordDeletion).mockRejectedValueOnce(new Error("重新检查失败"));
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联" }));
  await screen.findByText("重新检查失败");
  expect((screen.getByRole("button", { name: "确认删除" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联" }));
  await screen.findByText("删除原因");
  await act(async () => {});
  expect((screen.getByRole("button", { name: "确认删除" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("textbox", { name: /输入记录编号确认/ }) as HTMLInputElement).value).toBe(root.recordNo);
  expect(executeFormalRecordDeletion).not.toHaveBeenCalled();
});

it("keeps the stale-preview explanation after refresh and retains the user's confirmation", async () => {
  vi.mocked(executeFormalRecordDeletion).mockRejectedValueOnce(new FormalRecordDeletionApiError("资料已变化", "DELETION_PREVIEW_STALE", null, 409));
  await open(); await fillConfirmation();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("请再次确认");
  expect((screen.getByRole("textbox", { name: /输入记录编号确认/ }) as HTMLInputElement).value).toBe(root.recordNo);
  expect(executeFormalRecordDeletion).toHaveBeenCalledTimes(1);
});

it("closes the blocked dialog and opens the existing related-record workspace without deleting", async () => {
  vi.mocked(previewFormalRecordDeletion).mockResolvedValue({ ...preview, eligible: false, blockers: [{ code: "HAS_CUSTOMER_COMMUNICATION", label: "检查单已有客户沟通记录", linkedRecord: root }] });
  function Host() {
    const [reviewing, setReviewing] = useState(false);
    return <><RecordDeleteButton record={root} title="删除检查结果" returnTo="/orders/inspections" onReviewBlockers={() => setReviewing(true)} />{reviewing ? <h2>相关记录工作区</h2> : null}</>;
  }
  render(<Host />);
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await screen.findByText(/检查单已有客户沟通记录/);
  fireEvent.click(screen.getByRole("button", { name: "查看相关记录" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading", { name: "相关记录工作区" })).toBeTruthy();
  expect(executeFormalRecordDeletion).not.toHaveBeenCalled();
});
