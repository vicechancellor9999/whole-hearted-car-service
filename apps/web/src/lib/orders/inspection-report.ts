import type { InspectionSubmission } from "./inspection-types";

export type InspectionReportStatus =
  | "mechanic_submitted"
  | "ai_structured"
  | "awaiting_frontdesk"
  | "returned_for_revision"
  | "approved"
  | "published";

const inspectionSubmissionReferenceBrand: unique symbol = Symbol("inspectionSubmissionReference");

/**
 * A compact immutable pointer to a submission created by
 * createInspectionSubmission. It deliberately excludes mutable result content.
 */
export type InspectionSubmissionReference = Readonly<{
  submissionId: string;
  submissionVersion: number;
  submittedAt: string;
  [inspectionSubmissionReferenceBrand]: true;
}>;

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label}不能为空`);
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${label}必须为有效时间`);
  }
}

function assertFrozenInspectionSubmission(value: unknown): asserts value is InspectionSubmission {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value)) {
    throw new TypeError("检查提交必须是 createInspectionSubmission 生成的冻结对象");
  }
  const submission = value as Partial<InspectionSubmission>;
  assertText(submission.id, "检查提交 ID");
  assertText(submission.inspectionReportNo, "检查报告编号");
  assertText(submission.vehicleId, "车辆 ID");
  assertText(submission.inspectorId, "检查人 ID");
  assertText(submission.inspectorName, "检查人姓名");
  assertTimestamp(submission.submittedAt, "提交时间");
  const sourceVersion = submission.sourceVersion;
  if (typeof sourceVersion !== "number" || !Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
    throw new RangeError("检查提交来源版本必须为正整数");
  }
  if (
    !Array.isArray(submission.suggestedLaborItems)
    || !Array.isArray(submission.suggestedPartItems)
    || !Array.isArray(submission.photos)
    || !Object.isFrozen(submission.suggestedLaborItems)
    || !Object.isFrozen(submission.suggestedPartItems)
    || !Object.isFrozen(submission.photos)
  ) {
    throw new TypeError("检查提交必须保留冻结的项目和照片事实");
  }
}

/** Creates the only constructible IR submission reference from a frozen submission. */
export function createInspectionSubmissionReference(
  submission: InspectionSubmission,
): InspectionSubmissionReference {
  assertFrozenInspectionSubmission(submission);
  const submissionVersion = submission.sourceVersion;
  return Object.freeze({
    submissionId: submission.id,
    submissionVersion,
    submittedAt: submission.submittedAt,
    [inspectionSubmissionReferenceBrand]: true as const,
  });
}

/** Inspection Report is an inspection fact, never a Business Order or Invoice. */
export interface InspectionReport {
  readonly id: string;
  readonly inspectionReportNo: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly status: InspectionReportStatus;
  readonly submissionRef: InspectionSubmissionReference;
  readonly itemIds: ReadonlyArray<string>;
}
