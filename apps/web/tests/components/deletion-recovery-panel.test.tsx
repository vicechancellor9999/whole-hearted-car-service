import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeletionRecoveryPanel } from "../../src/components/shared/deletion-recovery-panel";
import { forgetDeletionAttempt, readDeletionAttempts, rememberDeletionAttempt } from "../../src/lib/record-deletion-recovery";
import type { RecordDeletionExecuteInput } from "../../../../src/modules/record-deletion/record-deletion-types";

const input: RecordDeletionExecuteInput = { root: { kind: "inspection_report", recordNo: "IR-20260905-0009" }, selectedRecords: [{ kind: "inspection_report", recordNo: "IR-20260905-0009" }], reasonCode: "test_data", reasonNote: null, confirmationRecordNo: "IR-20260905-0009", previewFingerprint: "a".repeat(64), requestId: "delete:recovery-9" };
const completed = { requestId: input.requestId, status: "completed", result: { requestId: input.requestId, root: input.root, deletedRecords: input.selectedRecords, dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 } };
let accountId = 1;
let receipt: () => Promise<Response>;
let requests: Array<{ url: string; method: string }>;
beforeEach(() => {
  sessionStorage.clear(); accountId = 1; requests = [];
  receipt = async () => Response.json(completed);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET" });
    return url.includes("auth/session") ? Response.json({ account: { id: accountId, role: "super_admin" } }) : receipt();
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("recovers independently of the removed detail page and confirms only from a GET receipt", async () => {
  rememberDeletionAttempt(1, input);
  render(<DeletionRecoveryPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /删除进度/ }));
  expect(screen.getByText(input.root.recordNo)).toBeTruthy();
  expect(screen.queryByText("删除已完成")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "只查询结果" }));
  await screen.findByText("删除已完成");
  expect(screen.getByRole("link", { name: "核对列表" }).getAttribute("href")).toBe("/orders/inspections");
  expect(requests.every(request => request.method === "GET")).toBe(true);
  expect(requests.filter(request => request.url.includes("/result?"))).toEqual([{ url: "/api/formal/record-deletions/result?requestId=delete%3Arecovery-9", method: "GET" }]);
  fireEvent.click(screen.getByRole("button", { name: "已核对，移除此提示" }));
  expect(readDeletionAttempts(1).entries).toEqual([]);
});

it("keeps unconfirmed entries and offers a fresh query rather than a destructive action", async () => {
  rememberDeletionAttempt(1, input);
  receipt = async () => Response.json({ requestId: input.requestId, status: "unconfirmed", result: null });
  render(<DeletionRecoveryPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /删除进度/ }));
  fireEvent.click(screen.getByRole("button", { name: "只查询结果" }));
  await screen.findByText(/尚未找到已完成的删除回执/);
  expect(screen.getByRole("button", { name: "只查询结果" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
  expect(readDeletionAttempts(1).entries).toHaveLength(1);
});

it("hides another account's entries and rejects late reads from an earlier account cycle", async () => {
  rememberDeletionAttempt(1, input);
  let resolve!: (value: Response) => void;
  receipt = () => new Promise(done => { resolve = done; });
  render(<DeletionRecoveryPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /删除进度/ }));
  fireEvent.click(screen.getByRole("button", { name: "只查询结果" }));
  await act(async () => {});
  accountId = 2;
  await act(async () => window.dispatchEvent(new Event("wh:formal-session-changed")));
  expect(screen.queryByText(input.root.recordNo)).toBeNull();
  await act(async () => resolve(Response.json(completed)));
  expect(screen.queryByText("删除已完成")).toBeNull();
  expect(readDeletionAttempts(1).entries).toHaveLength(1);
});

it("retains an entry when storage cleanup fails and allows cleanup to be retried", async () => {
  rememberDeletionAttempt(1, input);
  render(<DeletionRecoveryPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /删除进度/ }));
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "已核对，移除此提示" }));
  await screen.findByText(/提示清理失败/);
  expect(readDeletionAttempts(1).entries).toHaveLength(1);
  fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "已核对，移除此提示" }));
  expect(readDeletionAttempts(1).entries).toEqual([]);
});

it("rejects changed retry payloads, wrong-account storage and expired recovery notes", () => {
  expect(rememberDeletionAttempt(1, input)).toBe(true);
  expect(rememberDeletionAttempt(1, { ...input, reasonCode: "input_error" })).toBe(false);
  expect(readDeletionAttempts(1).entries[0].input.reasonCode).toBe("test_data");
  expect(readDeletionAttempts(2).entries).toEqual([]);
  sessionStorage.setItem("wh:deletion-recovery:v1:2", sessionStorage.getItem("wh:deletion-recovery:v1:1")!);
  expect(readDeletionAttempts(2)).toEqual({ entries: [], available: false });
  const entry = { accountId: 1, input, createdAt: Date.now() - 86_400_001 };
  sessionStorage.setItem("wh:deletion-recovery:v1:1", JSON.stringify([entry]));
  expect(readDeletionAttempts(1).entries).toEqual([]);
  sessionStorage.setItem("wh:deletion-recovery:v1:1", "bad-json");
  expect(forgetDeletionAttempt(1, input.requestId)).toBe(false);
});

it("keeps identical original requests even when property ordering differs", () => {
  rememberDeletionAttempt(1, input);
  const same = Object.fromEntries(Object.entries(input).reverse()) as RecordDeletionExecuteInput;
  expect(rememberDeletionAttempt(1, same)).toBe(true);
  expect(readDeletionAttempts(1).entries).toHaveLength(1);
});
