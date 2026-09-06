import { expect, test } from "@playwright/test";
import {
  executeFormalRecordDeletion,
  previewFormalRecordDeletion,
} from "../../src/lib/api/formal-record-deletions";
import type { RecordDeletionExecuteInput } from "../../../../src/modules/record-deletion/record-deletion-types";

const deletionInput: RecordDeletionExecuteInput = { root: { kind: "inspection_report", recordNo: "IR-20260905-0009" }, selectedRecords: [{ kind: "inspection_report", recordNo: "IR-20260905-0009" }], reasonCode: "test_data", reasonNote: null, confirmationRecordNo: "IR-20260905-0009", previewFingerprint: "a".repeat(64), requestId: "delete-response-9" };
const deletionResult = { requestId: "delete-response-9", root: deletionInput.root, deletedRecords: deletionInput.selectedRecords, dependentCounts: {}, releasedIdentityKinds: [], fileCleanupPending: 0 };

for (const [name, result] of [
  ["empty object", {}],
  ["another request", { ...deletionResult, requestId: "delete-other-9" }],
  ["another root", { ...deletionResult, root: { ...deletionInput.root, recordNo: "IR-20260905-0010" } }],
  ["incomplete deleted scope", { ...deletionResult, deletedRecords: [] }],
] as const) {
  test(`does not confirm deletion from ${name}`, async () => {
    await expect(executeFormalRecordDeletion(deletionInput, async () => Response.json(result))).rejects.toMatchObject({ code: "DELETION_RESULT_UNCONFIRMED", requestId: "delete-response-9" });
  });
}

test("record deletion client posts preview and execute payloads to formal endpoints", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    requests.push(request);
    return Response.json(request.url.endsWith("/preview") ? {
      eligible: true,
      rootRecord: { kind: "vehicle", recordNo: "VEH-202608-0004", version: 1 },
      selectableLinkedRecords: [],
      dependentCounts: {},
      releasedIdentityKinds: ["plate"],
      blockers: [],
      previewFingerprint: "a".repeat(64),
    } : {
      requestId: "delete-client-1",
      root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
      deletedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
      dependentCounts: {},
      releasedIdentityKinds: ["plate"],
      fileCleanupPending: 0,
    });
  };

  const preview = await previewFormalRecordDeletion({
    root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
    selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
  }, fetcher);
  await executeFormalRecordDeletion({
    root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
    selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
    reasonCode: "test_data",
    reasonNote: null,
    confirmationRecordNo: "VEH-202608-0004",
    previewFingerprint: preview.previewFingerprint,
    requestId: "delete-client-1",
  }, fetcher);

  expect(requests.map((request) => request.url)).toEqual([
    "http://localhost/api/formal/record-deletions/preview",
    "http://localhost/api/formal/record-deletions/execute",
  ]);
  expect(requests.every((request) => request.method === "POST")).toBe(true);
});

test("record deletion client preserves the formal error code and request number", async () => {
  await expect(previewFormalRecordDeletion({
    root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
    selectedRecords: [],
  }, async () => Response.json({
    error: "当前账号没有删除记录的权限",
    code: "RECORD_DELETE_DENIED",
    requestId: "delete-denied-1",
  }, { status: 403 }))).rejects.toMatchObject({
    message: "当前账号没有删除记录的权限",
    code: "RECORD_DELETE_DENIED",
    requestId: "delete-denied-1",
  });
});
