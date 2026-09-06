import { afterEach, expect, it, vi } from "vitest";
import { withRequestDeadline } from "../../src/lib/api/request-deadline";
import { fetchFormalRepairRounds, runFormalRepairRoundAction } from "../../src/lib/api/formal-business-orders";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["headers", "body"])("releases an unconfirmed repair-round deletion with stalled %s without resending", async (stage) => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const network = vi.fn().mockImplementation(() => stage === "headers" ? pending : Promise.resolve({ ok: true, json: () => pending }));
  vi.stubGlobal("fetch", network);
  const input = { action: "delete_invalid_after_sales", repairRoundVersion: 8, previewFingerprint: "qa-fingerprint", reasonCode: "test_data", reasonNote: "invalid round", confirmationRecordNo: "QA/R3", requestId: "qa-original-delete" };
  const request = runFormalRepairRoundAction(7, input);
  let state = "pending";
  let message = "";
  void request.then(() => { state = "success"; }, error => { state = "unconfirmed"; message = error.message; });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state).toBe("unconfirmed");
  expect(message).toContain("结果尚未确认");
  expect(network.mock.calls[0][1].signal.aborted).toBe(true);
  expect(network.mock.calls[0][1].headers["x-request-id"]).toBe("qa-original-delete");
  expect(JSON.parse(network.mock.calls[0][1].body)).toEqual({ action: "delete_invalid_after_sales", repairRoundVersion: 8, previewFingerprint: "qa-fingerprint", reasonCode: "test_data", reasonNote: "invalid round", confirmationRecordNo: "QA/R3" });
  finish(stage === "headers" ? Response.json({ result: "late" }) : { result: "late" });
  await vi.advanceTimersByTimeAsync(1);
  expect(state).toBe("unconfirmed");
  expect(network).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the deadline after success and after a synchronous operation error", async () => {
  vi.useFakeTimers();
  await expect(withRequestDeadline(async () => 42, 100, "deadline")).resolves.toBe(42);
  expect(vi.getTimerCount()).toBe(0);
  await expect(withRequestDeadline(() => { throw new Error("connection"); }, 100, "deadline")).rejects.toThrow("connection");
  expect(vi.getTimerCount()).toBe(0);
});

it("reports the deadline instead of an abort listener error and does not retry", async () => {
  vi.useFakeTimers();
  const operation = vi.fn((signal: AbortSignal) => new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const result = withRequestDeadline(operation, 100, "result unknown");
  const assertion = expect(result).rejects.toThrow("result unknown");
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
  expect(operation).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("also bounds a response whose headers arrive but whose JSON body never completes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }));
  const assertion = expect(fetchFormalRepairRounds(7)).rejects.toThrow("读取超时");
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("uses the same bounded request for formal performance adjustment without dropping its version or reason", async () => {
  vi.useFakeTimers();
  const network = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", network);
  const assertion = expect(runFormalRepairRoundAction(7, { action: "adjust_formal_handoff_performance", repairRoundVersion: 3, formalHandoffId: 45, performanceValue: "1250", reason: "纠正", requestId: "qa-request" })).rejects.toThrow("结果尚未确认");
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  const [url, init] = network.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/formal/business-orders/7/rounds");
  expect(JSON.parse(init.body as string)).toEqual({ action: "adjust_formal_handoff_performance", repairRoundVersion: 3, formalHandoffId: 45, performanceValue: "1250", reason: "纠正" });
  expect(init.headers).toMatchObject({ "x-request-id": "qa-request" });
  expect(init.signal?.aborted).toBe(true);
  expect(network).toHaveBeenCalledTimes(1);
});
