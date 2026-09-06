import { expect, it, vi } from "vitest";
import { createRecordDeletionResultApiHandler } from "@formal/app/api/record-deletions/result/route";
const url = "http://localhost/api/record-deletions/result?requestId=delete-result-1";
it("requires authentication without reading receipts", async () => {
  const readResult = vi.fn();
  const response = await createRecordDeletionResultApiHandler({ readSession: async () => null, readResult })(new Request(url));
  expect(response.status).toBe(401); expect(readResult).not.toHaveBeenCalled();
});
it("reports an absent receipt as unconfirmed and scopes the read to the session account", async () => {
  const readResult = vi.fn().mockResolvedValue(null);
  const response = await createRecordDeletionResultApiHandler({ readSession: async () => ({ account: { id: 9 } }), readResult })(new Request(url + "&actorAccountId=2"));
  expect(await response.json()).toEqual({ requestId: "delete-result-1", status: "unconfirmed", result: null });
  expect(readResult).toHaveBeenCalledWith({ requestId: "delete-result-1", actorAccountId: 9 });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("returns a committed receipt without invoking deletion", async () => {
  const root = { kind: "inspection_report", recordNo: "IR-20260905-0009" };
  const result = { requestId: "delete-result-1", root, deletedRecords: [root], dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 };
  const response = await createRecordDeletionResultApiHandler({ readSession: async () => ({ account: { id: 9 } }), readResult: vi.fn().mockResolvedValue(result) })(new Request(url));
  expect(await response.json()).toEqual({ requestId: "delete-result-1", status: "completed", result });
});
it.each(["", "short", "invalid%2Fid"])("rejects invalid request id %s before lookup", async requestId => {
  const readResult = vi.fn();
  const response = await createRecordDeletionResultApiHandler({ readSession: async () => ({ account: { id: 9 } }), readResult })(new Request(`http://localhost/api/record-deletions/result?requestId=${requestId}`));
  expect(response.status).toBe(400); expect(readResult).not.toHaveBeenCalled();
});
