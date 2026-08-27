import type {
  OrderAssignment,
  OrderOperationsStage,
  OrderTeamId,
} from "./inspection-types";

const OPERATIONS_STAGES: readonly OrderOperationsStage[] = [
  "inspection_awaiting_dispatch",
  "inspection_awaiting_acceptance",
  "inspection_in_progress",
  "inspection_awaiting_frontdesk",
  "quote_awaiting_customer",
  "quote_accepted_awaiting_order",
  "repair_awaiting_dispatch",
  "repair_awaiting_acceptance",
  "repair_in_progress",
  "blocked",
  "returned_awaiting_frontdesk",
  "awaiting_formal_handover",
  "submitted_awaiting_collection",
  "vehicle_collected",
];

const TEAM_IDS: readonly OrderTeamId[] = ["t1", "t2", "t3", "t4"];

export interface OperationsDocumentRecord {
  id: string;
  vehicleId: string;
  stage: OrderOperationsStage;
}

export interface OrdersTeamWorkload {
  teamId: OrderTeamId;
  inspectionAwaiting: number;
  inspectionInProgress: number;
  repairAwaiting: number;
  repairInProgress: number;
  blocked: number;
  returnedAwaitingFrontdesk: number;
  activeTotal: number;
}

export interface OrdersOperationsOverview {
  businessDate: string;
  firstInspectionDistribution: {
    distinctOrdinaryVehicles: number;
    t1: number;
    t2: number;
    difference: number;
  };
  workloads: OrdersTeamWorkload[];
  processCounts: Record<OrderOperationsStage, number>;
}

function assertBusinessDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("运营概览业务日必须使用 YYYY-MM-DD");
  const [, year, month, day] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    throw new Error("运营概览业务日无效");
  }
}

function jamaicaBusinessDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`派组时间无效：${value}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}

function emptyProcessCounts(): Record<OrderOperationsStage, number> {
  return Object.fromEntries(OPERATIONS_STAGES.map((stage) => [stage, 0])) as Record<
    OrderOperationsStage,
    number
  >;
}

function buildProcessCounts(
  records: readonly OperationsDocumentRecord[],
): Record<OrderOperationsStage, number> {
  const counts = emptyProcessCounts();
  const seen = new Map<string, OperationsDocumentRecord>();
  for (const record of records) {
    const existing = seen.get(record.id);
    if (existing) {
      if (existing.vehicleId !== record.vehicleId || existing.stage !== record.stage) {
        throw new Error(`单据 ${record.id} 存在冲突的运营阶段`);
      }
      continue;
    }
    if (!OPERATIONS_STAGES.includes(record.stage)) {
      throw new Error(`单据 ${record.id} 的运营阶段无效`);
    }
    seen.set(record.id, record);
    counts[record.stage] += 1;
  }
  return counts;
}

function sourceInspectionEqual(
  left: OrderAssignment["sourceInspection"],
  right: OrderAssignment["sourceInspection"],
): boolean {
  if (!left || !right) return left === right;
  return left.submissionId === right.submissionId
    && left.inspectionReportNo === right.inspectionReportNo
    && left.inspectorId === right.inspectorId
    && left.inspectorName === right.inspectorName
    && left.inspectorTeamId === right.inspectorTeamId
    && left.submittedAt === right.submittedAt;
}

function reassignmentHistoryEqual(
  left: OrderAssignment["reassignmentHistory"],
  right: OrderAssignment["reassignmentHistory"],
): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined
      && entry.fromTeamId === other.fromTeamId
      && entry.toTeamId === other.toTeamId
      && entry.reason === other.reason
      && entry.actor.id === other.actor.id
      && entry.actor.name === other.actor.name
      && entry.changedAt === other.changedAt;
  });
}

function assignmentsEqual(left: OrderAssignment, right: OrderAssignment): boolean {
  return left.vehicleId === right.vehicleId
    && left.documentId === right.documentId
    && left.kind === right.kind
    && left.vehiclePool === right.vehiclePool
    && left.teamId === right.teamId
    && left.status === right.status
    && left.assignedAt === right.assignedAt
    && left.acceptedAt === right.acceptedAt
    && left.completedAt === right.completedAt
    && left.submittedAt === right.submittedAt
    && left.firstAssignedTeamId === right.firstAssignedTeamId
    && left.firstAssignedAt === right.firstAssignedAt
    && sourceInspectionEqual(left.sourceInspection, right.sourceInspection)
    && reassignmentHistoryEqual(left.reassignmentHistory, right.reassignmentHistory);
}

function uniqueCurrentAssignments(assignments: readonly OrderAssignment[]): OrderAssignment[] {
  const byTask = new Map<string, OrderAssignment>();
  for (const assignment of assignments) {
    const taskKey = `${assignment.kind}:${assignment.documentId}`;
    const existing = byTask.get(taskKey);
    if (!existing) {
      byTask.set(taskKey, assignment);
      continue;
    }
    if (!assignmentsEqual(existing, assignment)) {
      throw new Error(`作业任务 ${taskKey} 存在重复且冲突的当前 assignment`);
    }
  }
  return [...byTask.values()];
}

function buildFirstInspectionDistribution(
  assignments: readonly OrderAssignment[],
  businessDate: string,
): OrdersOperationsOverview["firstInspectionDistribution"] {
  const firstByVehicle = new Map<
    string,
    { teamId: "t1" | "t2"; assignedAt: number }
  >();

  for (const assignment of assignments) {
    if (assignment.kind !== "inspection" || assignment.vehiclePool !== "ordinary") continue;
    if (assignment.firstAssignedTeamId !== "t1" && assignment.firstAssignedTeamId !== "t2") continue;
    if (jamaicaBusinessDate(assignment.firstAssignedAt) !== businessDate) continue;
    const assignedAt = Date.parse(assignment.firstAssignedAt);
    const existing = firstByVehicle.get(assignment.vehicleId);
    if (!existing || assignedAt < existing.assignedAt) {
      firstByVehicle.set(assignment.vehicleId, {
        teamId: assignment.firstAssignedTeamId,
        assignedAt,
      });
    } else if (
      assignedAt === existing.assignedAt
      && assignment.firstAssignedTeamId !== existing.teamId
    ) {
      throw new Error(`车辆 ${assignment.vehicleId} 的首次派检班组冲突`);
    }
  }

  let t1 = 0;
  let t2 = 0;
  for (const assignment of firstByVehicle.values()) {
    if (assignment.teamId === "t1") t1 += 1;
    else t2 += 1;
  }
  return {
    distinctOrdinaryVehicles: t1 + t2,
    t1,
    t2,
    difference: Math.abs(t1 - t2),
  };
}

function emptyWorkload(teamId: OrderTeamId): OrdersTeamWorkload {
  return {
    teamId,
    inspectionAwaiting: 0,
    inspectionInProgress: 0,
    repairAwaiting: 0,
    repairInProgress: 0,
    blocked: 0,
    returnedAwaitingFrontdesk: 0,
    activeTotal: 0,
  };
}

function buildWorkloads(assignments: readonly OrderAssignment[]): OrdersTeamWorkload[] {
  const byTeam = new Map(TEAM_IDS.map((teamId) => [teamId, emptyWorkload(teamId)]));
  for (const assignment of assignments) {
    const workload = byTeam.get(assignment.teamId);
    if (!workload) throw new Error(`作业任务 ${assignment.id} 的班组无效`);
    if (assignment.status === "blocked") {
      workload.blocked += 1;
    } else if (assignment.status === "returned") {
      workload.returnedAwaitingFrontdesk += 1;
    } else if (assignment.status === "awaiting_acceptance") {
      if (assignment.kind === "inspection") workload.inspectionAwaiting += 1;
      else workload.repairAwaiting += 1;
    } else if (assignment.status === "in_progress") {
      if (assignment.kind === "inspection") workload.inspectionInProgress += 1;
      else workload.repairInProgress += 1;
    }
  }

  return TEAM_IDS.map((teamId) => {
    const workload = byTeam.get(teamId)!;
    return {
      ...workload,
      activeTotal: workload.inspectionAwaiting
        + workload.inspectionInProgress
        + workload.repairAwaiting
        + workload.repairInProgress,
    };
  });
}

export function buildOrdersOperationsOverview(
  records: readonly OperationsDocumentRecord[],
  assignments: readonly OrderAssignment[],
  businessDate: string,
): OrdersOperationsOverview {
  assertBusinessDate(businessDate);
  const currentAssignments = uniqueCurrentAssignments(assignments);
  return {
    businessDate,
    firstInspectionDistribution: buildFirstInspectionDistribution(
      currentAssignments,
      businessDate,
    ),
    workloads: buildWorkloads(currentAssignments),
    processCounts: buildProcessCounts(records),
  };
}
