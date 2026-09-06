import { z } from "zod";
import type { FormalRepairRoundWorkspace } from "./formal-business-orders";

const integer = z.number().int().refine(Number.isSafeInteger);
const id = integer.refine((value) => value > 0);
const text = z.string().nullable();
const status = z.enum(["waiting_assignment", "assigned", "in_repair", "return_pending_review", "formally_handed_off"]);
const round = z.object({
  id, businessOrderId: id, roundNo: id, version: id, status,
  source: z.enum(["initial", "after_sales"]), afterSalesIssue: text,
  performanceDraftMinor: integer.nullable(), assignedTeamId: id.nullable(),
}).passthrough();
const workReturn = z.object({
  id, submissionNo: id, submissionSource: z.enum(["electronic", "paper"]), workSummary: text, exceptionSummary: text,
  actualStaffMemberId: id.nullable(), actualStaffName: text, submittedBy: id, submittedByName: z.string(), submittedAt: z.string(),
  itemResults: z.array(z.object({ chargeItemId: z.string(), category: z.enum(["labor", "part", "other"]), labelZh: z.string(), labelEn: text.optional(), result: z.enum(["completed", "not_completed"]), note: text.optional() }).passthrough()),
  attachments: z.array(z.object({ id, purpose: z.enum(["paper_return", "service_photo"]), originalName: z.string(), mediaType: z.string() }).passthrough()),
  review: z.object({ result: z.enum(["approved", "rejected"]), reason: text, reviewerAccountId: id, reviewerName: z.string(), reviewedAt: z.string() }).passthrough().nullable(),
}).passthrough();
const currentRound = round.extend({
  intakeMileageKm: integer.nonnegative().nullable(), intakePhotoFileIds: z.array(id),
  latestWorkReturnId: id.nullable(), approvedWorkReturnId: id.nullable(), latestWorkReturn: workReturn.nullable(),
});
const handoff = z.object({
  id, handoffNo: id, performanceMinor: integer, jamaicaMonth: z.string(), handedOffAt: z.string(), cancelledAt: text,
  performanceAdjustmentAllowed: z.boolean(), performanceAdjustmentUnavailableReason: z.enum(["cancelled", "closed_month"]).nullable(),
}).passthrough();
const count = integer.nonnegative();
const deletion = z.object({
  eligible: z.boolean(), recordNo: z.string(), repairRoundId: id, roundNo: id, repairRoundVersion: id,
  performanceDraftMinor: integer.nullable(), previewFingerprint: z.string(),
  counts: z.object({ events: count, workReturns: count, workReturnAttachments: count, mileageRecords: count, intakePhotos: count, formalHandoffs: count, formalHandoffCancellations: count, problemVersions: count, inspectionReports: count, documentSnapshots: count }),
  blockers: z.array(z.object({ code: z.string(), label: z.string(), recordNos: z.array(z.string()).optional() })),
});
const workspace = z.object({
  current: currentRound, afterSalesRoundDeletion: deletion.nullable(),
  // History records deliberately omit the current round's intake/work-return projection.
  history: z.array(round.extend({
    createdAt: z.string(), createdBy: id, updatedAt: z.string(), formalHandoffs: z.array(handoff),
    events: z.array(z.object({ id, eventType: z.string(), teamId: id.nullable(), workReturnId: id.nullable(), note: text, actorAccountId: id, occurredAt: z.string() }).passthrough()),
  })),
  auditTrail: z.array(z.object({
    id, occurredAt: z.string(), actorAccountId: id.nullable(), actorDisplayName: text, actorUsername: text,
    eventType: z.string(), objectType: z.string(), objectId: z.string(), reason: text,
    before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()).nullable(),
  }).passthrough()),
}).passthrough();

function invalidResponse(english: boolean): Error {
  return new Error(english ? "The performance response could not be verified. Your draft is retained; check the latest records before retrying." : "绩效响应无法核实，草稿已保留；请先核对最新记录，再决定是否重试。");
}

export function assertPerformanceWorkspace(value: unknown, businessOrderId: number, english: boolean): asserts value is FormalRepairRoundWorkspace {
  const parsed = workspace.safeParse(value);
  if (!parsed.success || parsed.data.current.businessOrderId !== businessOrderId
    || parsed.data.history.some((entry) => entry.businessOrderId !== businessOrderId)
    || (parsed.data.afterSalesRoundDeletion && parsed.data.afterSalesRoundDeletion.repairRoundId !== parsed.data.current.id)) throw invalidResponse(english);
}

export function assertPerformanceSaveResponse(value: unknown, expected: {
  businessOrderId: number; roundId: number; roundVersion: number; handoffId: number | null; performanceValue: string;
}, english: boolean): asserts value is FormalRepairRoundWorkspace & { result: unknown } {
  assertPerformanceWorkspace(value, expected.businessOrderId, english);
  const normalized = expected.performanceValue.normalize("NFKC").trim();
  if (!/^-?(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw invalidResponse(english);
  const [whole, fraction = ""] = normalized.replace(/^-/, "").split(".");
  const minor = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) * (normalized.startsWith("-") ? -1 : 1);
  if (!Number.isSafeInteger(minor)) throw invalidResponse(english);
  const result = (value as FormalRepairRoundWorkspace & { result?: unknown }).result;
  if (expected.handoffId === null) {
    const parsed = currentRound.safeParse(result);
    if (!parsed.success || parsed.data.id !== expected.roundId || parsed.data.businessOrderId !== expected.businessOrderId
      || parsed.data.version <= expected.roundVersion || parsed.data.performanceDraftMinor !== minor
      || value.current.id !== expected.roundId || value.current.version < parsed.data.version || value.current.performanceDraftMinor !== minor) throw invalidResponse(english);
    return;
  }
  const parsed = z.object({ id, businessOrderId: id, repairRoundId: id, correctsFormalHandoffId: id, performanceMinor: integer, cancellation: z.null() }).safeParse(result);
  if (!parsed.success) throw invalidResponse(english);
  const target = value.history.find((entry) => entry.id === expected.roundId);
  const replacement = target?.formalHandoffs.find((entry) => entry.id === parsed.data.id);
  const original = target?.formalHandoffs.find((entry) => entry.id === expected.handoffId);
  if (parsed.data.businessOrderId !== expected.businessOrderId || parsed.data.repairRoundId !== expected.roundId
    || parsed.data.correctsFormalHandoffId !== expected.handoffId || parsed.data.performanceMinor !== minor
    || !target || target.version <= expected.roundVersion || !original?.cancelledAt
    || !replacement || replacement.cancelledAt !== null || replacement.performanceMinor !== minor) throw invalidResponse(english);
}
