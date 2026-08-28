import { describe, expect, it } from "vitest";
import { RecordDeletionError } from "@formal/modules/record-deletion/record-deletion-errors";
import { createRecordDeletionExecuteApiHandler } from "@formal/app/api/record-deletions/execute/route";

const body = {
  root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
  selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
  reasonCode: "test_data",
  reasonNote: null,
  confirmationRecordNo: "VEH-202608-0004",
  previewFingerprint: "a".repeat(64),
  requestId: "delete-route-1",
};

describe("record deletion execute route", () => {
  it("returns the deletion result without exposing server details", async () => {
    const handler = createRecordDeletionExecuteApiHandler({
      readSession: async () => ({ account: { id: 41 } }),
      execute: async (input) => ({
        requestId: input.requestId,
        root: input.root,
        deletedRecords: input.selectedRecords,
        dependentCounts: {},
        releasedIdentityKinds: ["plate"],
        fileCleanupPending: 0,
      }),
    });
    const response = await handler(new Request("http://localhost/api/record-deletions/execute", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Vitest" },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deletedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
    });
  });

  it("returns a stale-preview conflict with its request number", async () => {
    const handler = createRecordDeletionExecuteApiHandler({
      readSession: async () => ({ account: { id: 41 } }),
      execute: async () => {
        throw new RecordDeletionError(
          "DELETION_PREVIEW_STALE",
          409,
          "删除范围已经变化，请重新检查后确认",
        );
      },
    });
    const response = await handler(new Request("http://localhost/api/record-deletions/execute", {
      method: "POST",
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "删除范围已经变化，请重新检查后确认",
      code: "DELETION_PREVIEW_STALE",
      requestId: body.requestId,
    });
  });
});
