import { z } from "zod";

export const recordKinds = [
  "personal_customer",
  "company_customer",
  "vehicle",
  "business_order",
  "inspection_report",
] as const;

export type RecordKind = (typeof recordKinds)[number];
export type DeletionReasonCode = "duplicate" | "input_error" | "test_data" | "other";
export type ReleasedIdentityKind = "phone" | "trn" | "plate" | "vin";

export type RecordLocator = {
  kind: RecordKind;
  recordNo: string;
};

export type RecordReference = RecordLocator & {
  version: number;
};

export type DeletionBlocker = {
  code: string;
  label: string;
  linkedRecord: RecordLocator | null;
};

export type RecordDeletionPreview = {
  eligible: boolean;
  rootRecord: RecordReference;
  selectableLinkedRecords: RecordReference[];
  dependentCounts: Record<string, number>;
  releasedIdentityKinds: ReleasedIdentityKind[];
  blockers: DeletionBlocker[];
  previewFingerprint: string;
};

export type RecordDeletionPreviewInput = {
  root: RecordLocator;
  selectedRecords: RecordLocator[];
};

export type RecordDeletionExecuteInput = {
  root: RecordLocator;
  selectedRecords: RecordLocator[];
  reasonCode: DeletionReasonCode;
  reasonNote: string | null;
  confirmationRecordNo: string;
  previewFingerprint: string;
  requestId: string;
};

export type RecordDeletionResult = {
  requestId: string;
  root: RecordLocator;
  deletedRecords: RecordLocator[];
  dependentCounts: Record<string, number>;
  releasedIdentityKinds: ReleasedIdentityKind[];
  fileCleanupPending: number;
};

const normalizedRecordNo = (pattern: RegExp, message: string) => z.string()
  .transform((value) => value.normalize("NFKC").trim().toUpperCase())
  .pipe(z.string().regex(pattern, message));

const recordLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("personal_customer"),
    recordNo: normalizedRecordNo(/^CUST-[0-9]{6}-[0-9]{4}$/, "客户编号格式无效"),
  }),
  z.object({
    kind: z.literal("company_customer"),
    recordNo: normalizedRecordNo(/^COMP-[0-9]{6}-[0-9]{4}$/, "公司客户编号格式无效"),
  }),
  z.object({
    kind: z.literal("vehicle"),
    recordNo: normalizedRecordNo(/^VEH-[0-9]{6}-[0-9]{4}$/, "车辆编号格式无效"),
  }),
  z.object({
    kind: z.literal("business_order"),
    recordNo: normalizedRecordNo(/^KGN-WH-[0-9]{13}$/, "业务单编号格式无效"),
  }),
  z.object({
    kind: z.literal("inspection_report"),
    recordNo: normalizedRecordNo(/^IR-[0-9]{8}-[0-9]{4}$/, "检查单编号格式无效"),
  }),
]);

const selectedRecordsSchema = z.array(recordLocatorSchema).max(20, "一次最多选择 20 条关联记录");

const previewInputSchema = z.object({
  root: recordLocatorSchema,
  selectedRecords: selectedRecordsSchema.optional().default([]),
}).superRefine((value, context) => addDuplicateIssues(value.selectedRecords, context));

const optionalReasonNote = z.string().max(1_000, "删除原因说明不能超过 1000 个字符")
  .optional()
  .nullable()
  .transform((value) => value?.normalize("NFKC").trim() || null);

const executeInputSchema = z.object({
  root: recordLocatorSchema,
  selectedRecords: selectedRecordsSchema.min(1, "请选择要删除的记录"),
  reasonCode: z.enum(["duplicate", "input_error", "test_data", "other"]),
  reasonNote: optionalReasonNote,
  confirmationRecordNo: z.string().transform(
    (value) => value.normalize("NFKC").trim().toUpperCase(),
  ),
  previewFingerprint: z.string().regex(/^[0-9a-f]{64}$/, "删除预览已失效，请重新检查"),
  requestId: z.string().trim().min(8).max(128).regex(
    /^[A-Za-z0-9._:-]+$/,
    "删除请求编号格式无效",
  ),
}).superRefine((value, context) => {
  addDuplicateIssues(value.selectedRecords, context);
  if (value.reasonCode === "other" && !value.reasonNote) {
    context.addIssue({ code: "custom", path: ["reasonNote"], message: "请输入删除原因说明" });
  }
  if (value.confirmationRecordNo !== value.root.recordNo) {
    context.addIssue({
      code: "custom",
      path: ["confirmationRecordNo"],
      message: "确认编号与当前记录不一致",
    });
  }
  if (!value.selectedRecords.some((record) => recordKey(record) === recordKey(value.root))) {
    context.addIssue({ code: "custom", path: ["selectedRecords"], message: "删除范围必须包含当前记录" });
  }
});

export function parseDeletionPreviewInput(value: unknown): RecordDeletionPreviewInput {
  return previewInputSchema.parse(value);
}

export function parseDeletionExecuteInput(value: unknown): RecordDeletionExecuteInput {
  return executeInputSchema.parse(value);
}

function addDuplicateIssues(
  records: RecordLocator[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const key = recordKey(record);
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["selectedRecords", index],
        message: "删除范围存在重复记录",
      });
    }
    seen.add(key);
  }
}

function recordKey(record: RecordLocator): string {
  return `${record.kind}:${record.recordNo}`;
}
