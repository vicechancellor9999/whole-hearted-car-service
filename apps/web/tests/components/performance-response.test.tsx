import { expect, it } from "vitest";
import { assertPerformanceSaveResponse, assertPerformanceWorkspace } from "../../src/lib/api/formal-performance-response";

const current = { id: 22, businessOrderId: 7, roundNo: 3, source: "after_sales", afterSalesIssue: null, performanceDraftMinor: null, status: "waiting_assignment", assignedTeamId: null, version: 1, intakeMileageKm: null, intakePhotoFileIds: [], latestWorkReturnId: null, approvedWorkReturnId: null, latestWorkReturn: null };
const handoff = { id: 45, handoffNo: 1, performanceMinor: -50000, jamaicaMonth: "2026-09", handedOffAt: "2026-09-05T12:00:00Z", cancelledAt: "2026-09-05T13:00:00Z", performanceAdjustmentAllowed: false, performanceAdjustmentUnavailableReason: "cancelled" };
const result = { id: 46, businessOrderId: 7, repairRoundId: 21, correctsFormalHandoffId: 45, performanceMinor: 125000, cancellation: null };
function correctedHistory() {
  return { current, afterSalesRoundDeletion: null, auditTrail: [], history: [{ id: 21, businessOrderId: 7, roundNo: 2, source: "after_sales", afterSalesIssue: null, performanceDraftMinor: 125000, status: "formally_handed_off", assignedTeamId: null, version: 4, createdAt: "2026-09-05T12:00:00Z", createdBy: 1, updatedAt: "2026-09-05T13:00:00Z", events: [], formalHandoffs: [handoff, { ...handoff, id: 46, handoffNo: 2, performanceMinor: 125000, cancelledAt: null, performanceAdjustmentAllowed: true, performanceAdjustmentUnavailableReason: null }] }], result };
}
const expected = { businessOrderId: 7, roundId: 21, roundVersion: 1, handoffId: 45, performanceValue: "1250" };

it("accepts a corrected historical handoff without requiring it to be the current round", () => {
  expect(() => assertPerformanceSaveResponse(correctedHistory(), expected, false)).not.toThrow();
});

it.each(["missing current", "broken history", "broken audit", "missing intake photos", "wrong history owner", "bad work return", "wrong deletion round"])("rejects an unsafe workspace: %s", (fault) => {
  const value: Record<string, unknown> = structuredClone(correctedHistory());
  if (fault === "missing current") delete value.current;
  if (fault === "broken history") value.history = {};
  if (fault === "broken audit") value.auditTrail = [{ id: 1 }];
  if (fault === "missing intake photos") delete (value.current as Record<string, unknown>).intakePhotoFileIds;
  if (fault === "wrong history owner") (value.history as { businessOrderId: number }[])[0].businessOrderId = 999;
  if (fault === "bad work return") (value.current as Record<string, unknown>).latestWorkReturn = { id: 1 };
  if (fault === "wrong deletion round") value.afterSalesRoundDeletion = { repairRoundId: 999 };
  expect(() => assertPerformanceWorkspace(value, 7, false)).toThrow(/核对/);
});

it.each(["old still active", "replacement cancelled", "wrong correction", "wrong result amount", "wrong target", "unchanged version"])("does not confirm a mismatched replacement: %s", (fault) => {
  const value = structuredClone(correctedHistory());
  if (fault === "old still active") value.history[0].formalHandoffs[0].cancelledAt = null;
  if (fault === "replacement cancelled") value.history[0].formalHandoffs[1].cancelledAt = "2026-09-05T14:00:00Z";
  if (fault === "wrong correction") value.result.correctsFormalHandoffId = 999;
  if (fault === "wrong result amount") value.result.performanceMinor = 125001;
  if (fault === "wrong target") value.result.repairRoundId = 22;
  if (fault === "unchanged version") value.history[0].version = 1;
  expect(() => assertPerformanceSaveResponse(value, expected, true)).toThrow(/check/);
});
