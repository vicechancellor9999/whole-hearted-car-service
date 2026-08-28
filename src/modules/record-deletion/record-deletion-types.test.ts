import { describe, expect, it } from "vitest";
import {
  parseDeletionExecuteInput,
  parseDeletionPreviewInput,
} from "@formal/modules/record-deletion/record-deletion-types";

describe("record deletion contracts", () => {
  it("normalizes public record numbers before previewing", () => {
    expect(parseDeletionPreviewInput({
      root: { kind: "vehicle", recordNo: " veh-202608-0004 " },
    })).toEqual({
      root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
      selectedRecords: [],
    });
  });

  it("accepts a complete execution request with the root explicitly selected", () => {
    const parsed = parseDeletionExecuteInput({
      root: { kind: "vehicle", recordNo: " veh-202608-0004 " },
      selectedRecords: [{ kind: "vehicle", recordNo: "VEH-202608-0004" }],
      reasonCode: "test_data",
      reasonNote: null,
      confirmationRecordNo: " veh-202608-0004 ",
      previewFingerprint: "a".repeat(64),
      requestId: "delete-123",
    });

    expect(parsed.root.recordNo).toBe("VEH-202608-0004");
    expect(parsed.confirmationRecordNo).toBe("VEH-202608-0004");
  });

  it("rejects duplicate selected records", () => {
    expect(() => parseDeletionExecuteInput({
      root: { kind: "vehicle", recordNo: "VEH-202608-0004" },
      selectedRecords: [
        { kind: "vehicle", recordNo: "VEH-202608-0004" },
        { kind: "vehicle", recordNo: "veh-202608-0004" },
      ],
      reasonCode: "duplicate",
      confirmationRecordNo: "VEH-202608-0004",
      previewFingerprint: "b".repeat(64),
      requestId: "delete-duplicate",
    })).toThrow("删除范围存在重复记录");
  });

  it("requires an explanation for the other reason", () => {
    expect(() => parseDeletionExecuteInput({
      root: { kind: "inspection_report", recordNo: "IR-20260827-0004" },
      selectedRecords: [{ kind: "inspection_report", recordNo: "IR-20260827-0004" }],
      reasonCode: "other",
      reasonNote: "  ",
      confirmationRecordNo: "IR-20260827-0004",
      previewFingerprint: "c".repeat(64),
      requestId: "delete-other",
    })).toThrow("请输入删除原因说明");
  });

  it("requires the confirmed number to match the selected root", () => {
    expect(() => parseDeletionExecuteInput({
      root: { kind: "business_order", recordNo: "KGN-WH-2026082700001" },
      selectedRecords: [{ kind: "business_order", recordNo: "KGN-WH-2026082700001" }],
      reasonCode: "input_error",
      confirmationRecordNo: "KGN-WH-2026082700002",
      previewFingerprint: "d".repeat(64),
      requestId: "delete-confirmation",
    })).toThrow("确认编号与当前记录不一致");
  });
});
