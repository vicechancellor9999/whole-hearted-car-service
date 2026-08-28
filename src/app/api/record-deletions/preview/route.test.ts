import { describe, expect, it, vi } from "vitest";
import { RecordDeletionError } from "@formal/modules/record-deletion/record-deletion-errors";
import { createRecordDeletionPreviewApiHandler } from "@formal/app/api/record-deletions/preview/route";

const requestBody = {
  root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
  selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
};

describe("record deletion preview route", () => {
  it("uses the signed-in account and returns the preview", async () => {
    const preview = vi.fn(async () => ({
      eligible: true,
      rootRecord: { ...requestBody.root, version: 1 },
      selectableLinkedRecords: [],
      dependentCounts: {},
      releasedIdentityKinds: ["plate"],
      blockers: [],
      previewFingerprint: "a".repeat(64),
    }));
    const handler = createRecordDeletionPreviewApiHandler({
      readSession: async () => ({ account: { id: 23 } }),
      preview,
    });
    const response = await handler(new Request("http://localhost/api/record-deletions/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eligible: true });
    expect(preview).toHaveBeenCalledWith({ ...requestBody, actorAccountId: 23 });
  });

  it("returns sanitized permission and validation failures", async () => {
    const denied = createRecordDeletionPreviewApiHandler({
      readSession: async () => ({ account: { id: 31 } }),
      preview: async () => {
        throw new RecordDeletionError("RECORD_DELETE_DENIED", 403, "无删除权限");
      },
    });
    const deniedResponse = await denied(new Request("http://localhost/api/record-deletions/preview", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }));
    expect(deniedResponse.status).toBe(403);
    expect(await deniedResponse.json()).toEqual({
      error: "无删除权限",
      code: "RECORD_DELETE_DENIED",
    });

    const invalid = createRecordDeletionPreviewApiHandler({
      readSession: async () => ({ account: { id: 31 } }),
      preview: vi.fn(),
    });
    const invalidResponse = await invalid(new Request("http://localhost/api/record-deletions/preview", {
      method: "POST",
      body: JSON.stringify({ root: { kind: "vehicle", recordNo: "bad" } }),
    }));
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({ code: "INVALID_DELETION_REQUEST" });
  });
});
