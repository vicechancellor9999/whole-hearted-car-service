import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecordDeleteButton } from "../../src/components/shared/record-delete-dialog";
import { readDeletionAttempts } from "../../src/lib/record-deletion-recovery";
import type { RecordDeletionExecuteInput } from "../../../../src/modules/record-deletion/record-deletion-types";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const root = { kind: "inspection_report" as const, recordNo: "IR-20260905-0009", version: 1 };
const preview = { eligible: true, rootRecord: root, selectableLinkedRecords: [], dependentCounts: {}, releasedIdentityKinds: [], blockers: [], previewFingerprint: "a".repeat(64) };
beforeEach(() => { sessionStorage.clear(); navigation.push.mockReset(); navigation.refresh.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("unlocks original-request recovery after a stalled deletion and ignores its late success", async () => {
  let resolveLate!: (response: Response) => void;
  let submitted!: RecordDeletionExecuteInput;
  let executions = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("auth/session")) return Response.json({ account: { id: 1, role: "super_admin" } });
    if (url.endsWith("/preview")) return Response.json(preview);
    executions += 1; submitted = JSON.parse(init?.body as string);
    return new Promise<Response>(resolve => { resolveLate = resolve; });
  }));
  render(<RecordDeleteButton record={root} title="删除检查结果" returnTo="/orders/inspections" />);
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "删除原因" }), { target: { value: "test_data" } });
  fireEvent.change(screen.getByRole("textbox", { name: /输入记录编号确认/ }), { target: { value: root.recordNo } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole("button", { name: "重试同一次删除" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "只查询删除结果" })).toBeTruthy();
  expect(screen.getByText(/结果尚未确认/)).toBeTruthy();
  expect(readDeletionAttempts(1).entries[0].input).toEqual(submitted);
  await act(async () => resolveLate(Response.json({ requestId: submitted.requestId, root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 })));
  expect(screen.queryByText("删除已完成")).toBeNull();
  expect(navigation.push).not.toHaveBeenCalled();
  expect(executions).toBe(1);
});

it("releases a stalled preview for a fresh read without executing deletion", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("auth/session")) return Response.json({ account: { id: 1, role: "super_admin" } });
    if (!url.endsWith("/preview")) throw new Error("Unexpected write");
    reads += 1;
    return reads === 1 ? new Promise<Response>(() => {}) : Response.json(preview);
  }));
  render(<RecordDeleteButton record={root} title="删除检查结果" returnTo="/orders/inspections" />);
  const button = await screen.findByRole("button", { name: "删除" });
  vi.useFakeTimers(); fireEvent.click(button);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByText(/关联检查超时/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("combobox", { name: "删除原因" })).toBeTruthy();
  expect(reads).toBe(2);
  expect(readDeletionAttempts(1).entries).toEqual([]);
});
