import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readRoundDeletionAttempt, saveRoundDeletionAttempt, clearRoundDeletionAttempt, type RoundDeletionAttempt } from "../../src/lib/orders/round-deletion-storage";

const attempt = (): RoundDeletionAttempt => ({ accountId: 1, businessOrderId: 7, roundId: 21, roundNo: 2, createdAt: Date.now(), status: "pending", input: { action: "delete_invalid_after_sales", repairRoundVersion: 8, previewFingerprint: "a".repeat(64), reasonCode: "test_data", reasonNote: "QA", confirmationRecordNo: "QA/R2", requestId: "original-request-2" } });
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("recovers pending as unconfirmed, preserving the full original input only for the same account and order", () => {
  const original = attempt();
  expect(saveRoundDeletionAttempt(original)).toBe(true);
  expect(readRoundDeletionAttempt(1, 7).attempt).toEqual({ ...original, status: "unconfirmed" });
  expect(readRoundDeletionAttempt(2, 7).attempt).toBeNull();
  expect(readRoundDeletionAttempt(1, 8).attempt).toBeNull();
});

it("cannot replace a request with another scope or reason, and late responses cannot resurrect dismissed requests", () => {
  const original = attempt();
  saveRoundDeletionAttempt(original);
  expect(saveRoundDeletionAttempt({ ...original, input: { ...original.input, reasonNote: "different" } })).toBe(false);
  expect(clearRoundDeletionAttempt({ ...original, input: { ...original.input, requestId: "another-request" } })).toBe(false);
  expect(clearRoundDeletionAttempt(original)).toBe(true);
  expect(saveRoundDeletionAttempt({ ...original, status: "completed" }, true)).toBe(true);
  expect(readRoundDeletionAttempt(1, 7).attempt).toBeNull();
});

it("expires recovery after 24 hours and rejects data bound to the wrong account or malformed input", () => {
  vi.useFakeTimers();
  const original = attempt(); saveRoundDeletionAttempt(original);
  vi.advanceTimersByTime(86_400_000);
  expect(readRoundDeletionAttempt(1, 7).attempt).toBeNull();
  sessionStorage.setItem("wh:round-deletion:v1:2:7", JSON.stringify({ ...original, createdAt: Date.now() }));
  expect(readRoundDeletionAttempt(2, 7)).toEqual({ attempt: null, available: false });
  sessionStorage.setItem("wh:round-deletion:v1:1:7", "{");
  expect(readRoundDeletionAttempt(1, 7)).toEqual({ attempt: null, available: false });
});

it("reports failed writes and cleanup without silently removing the persisted reminder", () => {
  const original = attempt(); saveRoundDeletionAttempt(original);
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(saveRoundDeletionAttempt({ ...original, status: "completed" })).toBe(false);
  expect(clearRoundDeletionAttempt(original)).toBe(false);
  expect(readRoundDeletionAttempt(1, 7).attempt?.input).toEqual(original.input);
  failure.mockRestore();
  expect(clearRoundDeletionAttempt(original)).toBe(true);
  expect(readRoundDeletionAttempt(1, 7).attempt).toBeNull();
});
