import { afterEach, expect, it, vi } from "vitest";
import { executeFormalRecordDeletion, previewFormalRecordDeletion, readFormalRecordDeletionResult } from "../../src/lib/api/formal-record-deletions";
import type { RecordDeletionExecuteInput } from "../../../../src/modules/record-deletion/record-deletion-types";

const input: RecordDeletionExecuteInput = { root: { kind: "inspection_report", recordNo: "IR-20260905-0009" }, selectedRecords: [{ kind: "inspection_report", recordNo: "IR-20260905-0009" }], reasonCode: "test_data", reasonNote: null, confirmationRecordNo: "IR-20260905-0009", previewFingerprint: "a".repeat(64), requestId: "delete:receipt-9" };
const result = { requestId: input.requestId, root: input.root, deletedRecords: input.selectedRecords, dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 };
const completed = { requestId: input.requestId, status: "completed", result };
afterEach(() => vi.useRealTimers());

it("only GETs the original receipt, uncached, with no deletion payload", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(completed));
  await expect(readFormalRecordDeletionResult(input, fetcher)).resolves.toEqual(result);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/formal/record-deletions/result?requestId=delete%3Areceipt-9", { method: "GET", credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) });
});

it("treats absent receipts as unconfirmed rather than failed deletions", async () => {
  await expect(readFormalRecordDeletionResult(input, async () => Response.json({ requestId: input.requestId, status: "unconfirmed", result: null }))).resolves.toBeNull();
});

it.each([
  {},
  { ...completed, requestId: "another-request" },
  { ...completed, status: "unconfirmed" },
  { ...completed, result: null },
  { ...completed, result: { ...result, requestId: "another-request" } },
  { ...completed, result: { ...result, root: { ...input.root, recordNo: "OTHER" } } },
  { ...completed, result: { ...result, deletedRecords: [] } },
  { ...completed, result: { ...result, deletedRecords: [null] } },
  { ...completed, result: { ...result, fileCleanupPending: -1 } },
])("rejects incomplete or mismatched receipt %#", async (payload) => {
  await expect(readFormalRecordDeletionResult(input, async () => Response.json(payload))).rejects.toThrow();
});

it("exposes permission errors without retrying a write", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "当前账号没有权限" }, { status: 403 }));
  await expect(readFormalRecordDeletionResult(input, fetcher)).rejects.toThrow("当前账号没有权限");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["headers", "body"])("bounds stalled %s and ignores late success", async (stage) => {
  vi.useFakeTimers();
  let resolveLate!: (value: unknown) => void;
  const pending = new Promise(resolve => { resolveLate = resolve; });
  const fetcher = vi.fn().mockImplementation(() => stage === "headers" ? pending : Promise.resolve({ ok: true, json: () => pending }));
  const request = readFormalRecordDeletionResult(input, fetcher);
  const assertion = expect(request).rejects.toThrow("删除结果查询超时");
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  resolveLate(stage === "headers" ? Response.json(completed) : completed);
  await vi.advanceTimersByTimeAsync(1);
  await expect(request).rejects.toThrow("删除结果查询超时");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  ["preview", "headers", 15_000], ["preview", "body", 15_000],
  ["execute", "headers", 30_000], ["execute", "body", 30_000],
] as const)("bounds %s stalled %s and never retries it", async (operation, stage, deadline) => {
  vi.useFakeTimers();
  let resolveLate!: (value: unknown) => void;
  const pending = new Promise(resolve => { resolveLate = resolve; });
  const fetcher = vi.fn().mockImplementation(() => stage === "headers" ? pending : Promise.resolve({ ok: true, json: () => pending }));
  const request = operation === "execute" ? executeFormalRecordDeletion(input, fetcher) : previewFormalRecordDeletion(input, fetcher);
  let state = "pending";
  let message = "";
  void request.then(() => { state = "success"; }, error => { state = "error"; message = error.message; });
  await vi.advanceTimersByTimeAsync(deadline);
  expect(state).toBe("error");
  expect(message).toContain(operation === "execute" ? "结果尚未确认" : "关联检查超时");
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  resolveLate(stage === "headers" ? Response.json(result) : result);
  await vi.advanceTimersByTimeAsync(1);
  expect(state).toBe("error");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
  expect(vi.getTimerCount()).toBe(0);
});
