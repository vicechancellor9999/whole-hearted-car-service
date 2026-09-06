import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readPerformanceDraft, writePerformanceDraft, type PerformanceRecoveryDraft } from "../../src/lib/orders/performance-draft-storage";
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());
const draft = (): PerformanceRecoveryDraft => ({ version: 1, accountId: 1, businessOrderId: 7, updatedAt: Date.now(), target: { roundId: 21, roundNo: 2, roundVersion: 3, performanceMinor: 0, handoffId: null }, value: "1250", reason: "核对", unconfirmed: true });

it("scopes recovery by account and order, retaining original version and unknown submission state", () => {
  const value = draft();
  expect(writePerformanceDraft(1, 7, value)).toBe(true);
  expect(readPerformanceDraft(1, 7)).toEqual(value);
  expect(readPerformanceDraft(2, 7)).toBeNull();
  expect(readPerformanceDraft(1, 8)).toBeNull();
  expect(writePerformanceDraft(2, 7, value)).toBe(false);
});
it.each(["expired", "wrong owner", "invalid shape", "invalid JSON"])("does not restore %s storage", (fault) => {
  const value: Record<string, unknown> = draft();
  if (fault === "expired") value.updatedAt = Date.now() - 86_400_001;
  if (fault === "wrong owner") value.accountId = 2;
  if (fault === "invalid shape") value.target = {};
  sessionStorage.setItem("wh:performance-draft:v1:1:7", fault === "invalid JSON" ? "{" : JSON.stringify(value));
  expect(readPerformanceDraft(1, 7)).toBeNull();
});
it("reports failed writes and tolerates denied browser storage", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  expect(writePerformanceDraft(1, 7, draft())).toBe(false);
  expect(readPerformanceDraft(1, 7)).toBeNull();
});

it("neutralizes a completed draft when removal fails but overwrite is still available", () => {
  writePerformanceDraft(1, 7, draft());
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
  expect(writePerformanceDraft(1, 7, null)).toBe(true);
  expect(readPerformanceDraft(1, 7)).toBeNull();
  expect(sessionStorage.getItem("wh:performance-draft:v1:1:7")).not.toContain("1250");
});
