import { expect, test } from "@playwright/test";
import {
  buildOrdersOperationsOverview,
  type OperationsDocumentRecord,
} from "../../src/lib/orders/operations-overview";
import type { OrderAssignment } from "../../src/lib/orders/inspection-types";

const BUSINESS_DATE = "2026-08-09";

function document(
  id: string,
  stage: OperationsDocumentRecord["stage"],
  vehicleId = `vehicle-${id}`,
): OperationsDocumentRecord {
  return { id, vehicleId, stage };
}

function assignment(id: string, overrides: Partial<OrderAssignment> = {}): OrderAssignment {
  return {
    id,
    vehicleId: `vehicle-${id}`,
    documentId: `document-${id}`,
    kind: "inspection",
    vehiclePool: "ordinary",
    teamId: "t1",
    status: "awaiting_acceptance",
    assignedAt: "2026-08-09T08:00:00-05:00",
    firstAssignedTeamId: "t1",
    firstAssignedAt: "2026-08-09T08:00:00-05:00",
    reassignmentHistory: [],
    ...overrides,
  };
}

test("流程数量返回完整阶段并逐张当前单据计数", () => {
  const records: OperationsDocumentRecord[] = [
    document("inspection-dispatch", "inspection_awaiting_dispatch"),
    document("inspection-acceptance", "inspection_awaiting_acceptance"),
    document("inspection-progress", "inspection_in_progress"),
    document("inspection-frontdesk", "inspection_awaiting_frontdesk"),
    document("quote-customer", "quote_awaiting_customer"),
    document("quote-order", "quote_accepted_awaiting_order"),
    document("repair-dispatch", "repair_awaiting_dispatch"),
    document("repair-acceptance", "repair_awaiting_acceptance"),
    document("repair-progress-a", "repair_in_progress"),
    document("repair-progress-b", "repair_in_progress"),
    document("blocked", "blocked"),
    document("returned", "returned_awaiting_frontdesk"),
    document("formal", "awaiting_formal_handover"),
    document("collection", "submitted_awaiting_collection"),
    document("collected", "vehicle_collected"),
  ];

  expect(buildOrdersOperationsOverview(records, [], BUSINESS_DATE).processCounts).toEqual({
    inspection_awaiting_dispatch: 1,
    inspection_awaiting_acceptance: 1,
    inspection_in_progress: 1,
    inspection_awaiting_frontdesk: 1,
    quote_awaiting_customer: 1,
    quote_accepted_awaiting_order: 1,
    repair_awaiting_dispatch: 1,
    repair_awaiting_acceptance: 1,
    repair_in_progress: 2,
    blocked: 1,
    returned_awaiting_frontdesk: 1,
    awaiting_formal_handover: 1,
    submitted_awaiting_collection: 1,
    vehicle_collected: 1,
  });
});

test("正式交单与实际取车保持两个不同流程阶段", () => {
  const overview = buildOrdersOperationsOverview([
    document("before-formal", "awaiting_formal_handover"),
    document("formally-submitted", "submitted_awaiting_collection"),
    document("actually-collected", "vehicle_collected"),
  ], [], BUSINESS_DATE);

  expect(overview.processCounts.awaiting_formal_handover).toBe(1);
  expect(overview.processCounts.submitted_awaiting_collection).toBe(1);
  expect(overview.processCounts.vehicle_collected).toBe(1);
});

test("今日普通车辆首次派检按牙买加业务日得到 20 辆 10 比 10", () => {
  const assignments = Array.from({ length: 20 }, (_, index) => {
    const teamId = index < 10 ? "t1" : "t2";
    return assignment(`inspection-${index + 1}`, {
      vehicleId: `ordinary-${index + 1}`,
      teamId,
      firstAssignedTeamId: teamId,
      firstAssignedAt: index === 0
        ? "2026-08-10T00:30:00Z"
        : "2026-08-09T09:00:00-05:00",
    });
  });
  assignments.push(assignment("jamaica-previous-day", {
    vehicleId: "previous-day",
    teamId: "t1",
    firstAssignedTeamId: "t1",
    firstAssignedAt: "2026-08-09T04:30:00Z",
  }));

  expect(buildOrdersOperationsOverview([], assignments, BUSINESS_DATE).firstInspectionDistribution)
    .toEqual({
      distinctOrdinaryVehicles: 20,
      t1: 10,
      t2: 10,
      difference: 0,
    });
});

test("同车后续改组、再次检查和检查转维修不改写首次派检且不重复计数", () => {
  const assignments: OrderAssignment[] = [
    assignment("inspection-current", {
      vehicleId: "vehicle-one",
      documentId: "inspection-one",
      teamId: "t2",
      assignedAt: "2026-08-09T11:00:00-05:00",
      firstAssignedTeamId: "t1",
      firstAssignedAt: "2026-08-09T08:00:00-05:00",
    }),
    assignment("inspection-recheck", {
      vehicleId: "vehicle-one",
      documentId: "inspection-two",
      teamId: "t2",
      firstAssignedTeamId: "t2",
      firstAssignedAt: "2026-08-09T12:00:00-05:00",
    }),
    assignment("repair-from-inspection", {
      vehicleId: "vehicle-one",
      documentId: "business-one",
      kind: "repair",
      teamId: "t2",
      firstAssignedTeamId: "t1",
      firstAssignedAt: "2026-08-09T08:00:00-05:00",
    }),
    assignment("inspection-other-vehicle", {
      vehicleId: "vehicle-two",
      documentId: "inspection-three",
      teamId: "t2",
      firstAssignedTeamId: "t2",
      firstAssignedAt: "2026-08-09T09:00:00-05:00",
    }),
  ];

  expect(buildOrdersOperationsOverview([], assignments, BUSINESS_DATE).firstInspectionDistribution)
    .toEqual({
      distinctOrdinaryVehicles: 2,
      t1: 1,
      t2: 1,
      difference: 0,
    });
});

test("工程机械与钣喷分流不进入车间一二组今日普通车辆均衡", () => {
  const assignments: OrderAssignment[] = [
    assignment("ordinary-one", {
      vehicleId: "ordinary-one",
      teamId: "t1",
      firstAssignedTeamId: "t1",
    }),
    assignment("ordinary-two", {
      vehicleId: "ordinary-two",
      teamId: "t2",
      firstAssignedTeamId: "t2",
    }),
    assignment("engineering", {
      vehicleId: "engineering-one",
      vehiclePool: "engineering",
      teamId: "t3",
      firstAssignedTeamId: "t3",
    }),
    assignment("bodywork", {
      vehicleId: "bodywork-one",
      vehiclePool: "bodywork",
      teamId: "t4",
      firstAssignedTeamId: "t4",
    }),
    assignment("ordinary-special-route", {
      vehicleId: "ordinary-three",
      vehiclePool: "ordinary",
      teamId: "t3",
      firstAssignedTeamId: "t3",
    }),
  ];

  expect(buildOrdersOperationsOverview([], assignments, BUSINESS_DATE).firstInspectionDistribution)
    .toEqual({
      distinctOrdinaryVehicles: 2,
      t1: 1,
      t2: 1,
      difference: 0,
    });
});

test("四组当前负载分开统计检查与维修且阻滞回交不进入 active", () => {
  const assignments: OrderAssignment[] = [
    assignment("t1-inspection-awaiting", { teamId: "t1", status: "awaiting_acceptance" }),
    assignment("t1-inspection-progress", { teamId: "t1", status: "in_progress" }),
    assignment("t1-repair-awaiting", {
      kind: "repair", teamId: "t1", status: "awaiting_acceptance",
    }),
    assignment("t1-repair-progress", { kind: "repair", teamId: "t1", status: "in_progress" }),
    assignment("t1-blocked-inspection", { teamId: "t1", status: "blocked" }),
    assignment("t1-blocked-repair", { kind: "repair", teamId: "t1", status: "blocked" }),
    assignment("t1-returned-inspection", { teamId: "t1", status: "returned" }),
    assignment("t1-returned-repair", { kind: "repair", teamId: "t1", status: "returned" }),
    assignment("t1-completed", { kind: "repair", teamId: "t1", status: "completed" }),
    assignment("t2-repair-progress", { kind: "repair", teamId: "t2", status: "in_progress" }),
    assignment("t3-inspection-progress", {
      vehiclePool: "engineering", teamId: "t3", status: "in_progress",
    }),
    assignment("t4-repair-awaiting", {
      kind: "repair", vehiclePool: "bodywork", teamId: "t4", status: "awaiting_acceptance",
    }),
  ];

  expect(buildOrdersOperationsOverview([], assignments, BUSINESS_DATE).workloads).toEqual([
    {
      teamId: "t1",
      inspectionAwaiting: 1,
      inspectionInProgress: 1,
      repairAwaiting: 1,
      repairInProgress: 1,
      blocked: 2,
      returnedAwaitingFrontdesk: 2,
      activeTotal: 4,
    },
    {
      teamId: "t2",
      inspectionAwaiting: 0,
      inspectionInProgress: 0,
      repairAwaiting: 0,
      repairInProgress: 1,
      blocked: 0,
      returnedAwaitingFrontdesk: 0,
      activeTotal: 1,
    },
    {
      teamId: "t3",
      inspectionAwaiting: 0,
      inspectionInProgress: 1,
      repairAwaiting: 0,
      repairInProgress: 0,
      blocked: 0,
      returnedAwaitingFrontdesk: 0,
      activeTotal: 1,
    },
    {
      teamId: "t4",
      inspectionAwaiting: 0,
      inspectionInProgress: 0,
      repairAwaiting: 1,
      repairInProgress: 0,
      blocked: 0,
      returnedAwaitingFrontdesk: 0,
      activeTotal: 1,
    },
  ]);
});

test("完全重复的当前 assignment 只计一次而冲突 assignment 明确报错", () => {
  const original = assignment("duplicate-a", {
    documentId: "same-task",
    teamId: "t1",
    status: "in_progress",
  });
  const duplicate = { ...original, id: "duplicate-b" };
  const deduped = buildOrdersOperationsOverview([], [original, duplicate], BUSINESS_DATE);

  expect(deduped.workloads.find((item) => item.teamId === "t1")?.activeTotal).toBe(1);

  const conflicting = { ...duplicate, id: "conflict", teamId: "t2" as const };
  expect(() => buildOrdersOperationsOverview([], [original, conflicting], BUSINESS_DATE))
    .toThrow(/重复|冲突/);
});

test("同任务的正式交单、检查署名来源或改组审计不同不得静默去重", () => {
  const original = assignment("audit-original", {
    documentId: "audit-task",
    kind: "repair",
    status: "in_progress",
    sourceInspection: {
      submissionId: "submission-1",
      inspectionReportNo: "KGN-WH-IR-2026080919422",
      inspectorId: "mechanic-1",
      inspectorName: "检查人一",
      inspectorTeamId: "t1",
      submittedAt: "2026-08-09T08:30:00-05:00",
    },
  });
  const conflicts: OrderAssignment[] = [
    { ...original, id: "audit-submitted", submittedAt: "2026-08-09T16:00:00-05:00" },
    {
      ...original,
      id: "audit-source",
      sourceInspection: { ...original.sourceInspection!, inspectorId: "mechanic-2" },
    },
    {
      ...original,
      id: "audit-history",
      reassignmentHistory: [{
        fromTeamId: "t1",
        toTeamId: "t2",
        reason: "现场负载调整",
        actor: { id: "frontdesk-1", name: "前台一" },
        changedAt: "2026-08-09T10:00:00-05:00",
      }],
    },
  ];

  for (const conflict of conflicts) {
    expect(() => buildOrdersOperationsOverview([], [original, conflict], BUSINESS_DATE))
      .toThrow(/重复|冲突/);
  }
});

test("完整数据中的隐藏列表行仍进入概览且聚合不修改输入或产生自动派单建议", () => {
  const records = [
    { ...document("visible", "repair_in_progress"), matchesCurrentListFilter: true },
    { ...document("hidden", "repair_in_progress"), matchesCurrentListFilter: false },
  ];
  const assignments = [assignment("hidden-task", {
    teamId: "t2",
    status: "in_progress",
  })];
  const recordsBefore = structuredClone(records);
  const assignmentsBefore = structuredClone(assignments);

  const overview = buildOrdersOperationsOverview(records, assignments, BUSINESS_DATE);

  expect(overview.processCounts.repair_in_progress).toBe(2);
  expect(overview.workloads.find((item) => item.teamId === "t2")?.activeTotal).toBe(1);
  expect(overview.firstInspectionDistribution).not.toHaveProperty("recommendedTeamId");
  expect(overview).not.toHaveProperty("recommendedTeamId");
  expect(records).toEqual(recordsBefore);
  expect(assignments).toEqual(assignmentsBefore);
});
