import {
  buildHistoryComparisons,
  calculateTeamMonth,
  normalizeRuleStatuses,
  previewRuleImpact,
  previewSalaryChange,
  resolveRuleForMonth,
  validateRuleDraftSyntax,
  validateRuleEffectiveMonth,
} from "../performance/calculations";
import { migratePerformanceEnvelope } from "../performance/migrations";
import type {
  CalculateTeamMonthInput,
  MockPerformanceState,
  MockPerformanceStateV2,
  PerformanceAccessContext,
  PerformanceMemberDetail,
  PerformancePermissions,
  PerformanceRuleVersion,
  PerformanceTeamId,
  PersistedPerformanceEnvelopeV1,
  PersistedPerformanceEnvelopeV2,
  RuleDraftInput,
  RuleImpactPreview,
  RuleWorkspaceResponse,
  SalaryChangePreview,
  SaveRuleDraftInput,
  SaveStandardSalaryInput,
  TeamMemberMonthInput,
  TeamMonthSnapshot,
  TeamPerformanceDetailResponse,
  UpdateStandardSalaryInput,
  UpdateStandardSalaryResult,
  YearMonth,
} from "../performance/types";

const STORAGE_KEY = "wh_performance_mock_v1";
const CURRENT_MONTH = "2026-08" as YearMonth;
const PREVIOUS_COMPLETE_MONTH = "2026-07" as YearMonth;

const ACTIVE_RULE = {
  ruleId: "rule-v1",
  version: "V1",
  commissionRate: 0.25,
  cnyToJmdRate: 23,
  minimumPayableCny: 0,
};

const TEAM_SALARIES: Record<PerformanceTeamId, number[]> = {
  t1: [12_000, 14_000, 16_000, 14_000],
  t2: [18_000, 20_000, 16_000],
  t3: [14_000, 16_000, 20_000],
  t4: [12_000, 18_000],
};

const T1_ROSTER: TeamMemberMonthInput[] = [
  { memberId: "EMP-UAT-040", employeeNo: "WH-0040", name: "余咸生", role: "组长", standardSalaryCny: 12_000 },
  { memberId: "EMP-UAT-041", employeeNo: "WH-0041", name: "余一鹤", role: "组员", standardSalaryCny: 14_000 },
  { memberId: "EMP-UAT-042", employeeNo: "WH-0042", name: "翁雄", role: "组员", standardSalaryCny: 16_000 },
  { memberId: "EMP-UAT-056", employeeNo: "WH-0056", name: "王林", role: "组员", standardSalaryCny: 14_000 },
].map((member) => ({ ...member, calculationKind: "full_month" }));

const TEAM_NAMES: Record<PerformanceTeamId, string> = {
  t1: "车间一组",
  t2: "车间二组",
  t3: "工程机械组",
  t4: "钣金喷漆组",
};

const TEAM_COLORS: Record<PerformanceTeamId, string> = {
  t1: "#465fff",
  t2: "#7a5af8",
  t3: "#d97706",
  t4: "#059669",
};

const JULY_ACTUAL: Record<PerformanceTeamId, number> = { t1: 163_000, t2: 177_500, t3: 0, t4: 0 };
const AUGUST_ACTUAL: Record<PerformanceTeamId, number> = { t1: 58_000, t2: 64_500, t3: 0, t4: 0 };
const LOCKED_ACTUALS: Record<PerformanceTeamId, number[]> = {
  t1: [198_000, 225_000, 207_000, 240_000, 218_000, 210_000, 255_000, 188_000, 302_000, 246_000, 285_000, 163_000],
  t2: [205_000, 238_000, 220_000, 252_000, 229_000, 218_000, 264_000, 196_000, 315_000, 255_000, 296_000, 177_500],
  t3: [0, 45_000, 0, 80_000, 65_000, 0, 90_000, 75_000, 110_000, 0, 40_000, 0],
  t4: [88_000, 72_000, 95_000, 110_000, 105_000, 120_000, 98_000, 130_000, 115_000, 140_000, 90_000, 0],
};
const LOCKED_MONTHS = [
  "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
  "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
] as YearMonth[];

type MockPerformanceOperation =
  | "teamRead"
  | "salaryPreview"
  | "salarySave"
  | "rulePreview"
  | "ruleSave"
  | "ruleActivate";
export interface MockPerformanceFaults {
  failNext?: Partial<Record<MockPerformanceOperation, string>>;
  delayMs?: Partial<Record<MockPerformanceOperation, number>>;
  dataScenario?:
    | "emptyHistory"
    | "missingStandardSalary"
    | "missingRuleTeam"
    | "missingRuleMemberSalary"
    | "missingRuleActual";
}

export type MockPerformanceE2EScenario =
  | "rule-save-failure-once"
  | "rule-activate-failure-once"
  | "missing-rule-team"
  | "missing-rule-member-salary"
  | "missing-rule-actual";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PreviewRegistryEntry {
  normalizedInput: UpdateStandardSalaryInput;
  sourceRevision: number;
}

interface RulePreviewRegistryEntry {
  normalizedDraft: RuleDraftInput;
  inputHash: string;
  sourceRevision: number;
}

export interface DashboardPerformanceSummary {
  targetCompletionRate: number;
  targetCompletedAmount: number;
  targetTotalAmount: number;
  teams: Array<{
    id: PerformanceTeamId;
    name: string;
    completionRate: number;
    currentAmount: number;
    targetAmount: number;
    color: string;
  }>;
}

export interface MockPerformanceStore {
  exportEnvelope(): PersistedPerformanceEnvelopeV2;
  team(access: PerformanceAccessContext, teamId: string, month?: string): TeamPerformanceDetailResponse;
  member(
    access: PerformanceAccessContext,
    teamId: string,
    memberId: string,
    month: string,
  ): PerformanceMemberDetail;
  previewSalary(access: PerformanceAccessContext, input: UpdateStandardSalaryInput): SalaryChangePreview;
  updateSalary(access: PerformanceAccessContext, input: SaveStandardSalaryInput): UpdateStandardSalaryResult;
  getRuleWorkspace(access: PerformanceAccessContext): RuleWorkspaceResponse;
  previewRule(access: PerformanceAccessContext, input: RuleDraftInput): Promise<RuleImpactPreview>;
  saveRuleDraft(access: PerformanceAccessContext, input: SaveRuleDraftInput): PerformanceRuleVersion;
  activateRule(access: PerformanceAccessContext, ruleId: string): RuleWorkspaceResponse;
  dashboardPerformance(access: PerformanceAccessContext): DashboardPerformanceSummary;
  getDelay(operation: MockPerformanceOperation): number;
}

export interface CreateMockPerformanceStoreOptions {
  initialState?: MockPerformanceState;
  storage?: StorageLike;
  faults?: MockPerformanceFaults;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function syntheticRoster(teamId: Exclude<PerformanceTeamId, "t1">): TeamMemberMonthInput[] {
  return TEAM_SALARIES[teamId].map((standardSalaryCny, index) => ({
    memberId: `EMP-UAT-${teamId.toUpperCase()}-${String(index + 1).padStart(2, "0")}`,
    employeeNo: `UAT-${teamId.toUpperCase()}-${String(index + 1).padStart(2, "0")}`,
    name: `Synthetic UAT ${TEAM_NAMES[teamId]}成员${index + 1}`,
    role: index === 0 ? "组长（Synthetic UAT）" : "组员（Synthetic UAT）",
    standardSalaryCny,
    calculationKind: "full_month",
  }));
}

function membersFor(teamId: PerformanceTeamId): TeamMemberMonthInput[] {
  return clone(teamId === "t1" ? T1_ROSTER : syntheticRoster(teamId));
}

function buildLockedSnapshotV1(teamId: PerformanceTeamId, month: YearMonth): TeamMonthSnapshot {
  const index = LOCKED_MONTHS.indexOf(month);
  if (index < 0) throw new Error(`V1 锁定月份不存在：${month}`);
  return calculateTeamMonth({
    teamId,
    teamName: TEAM_NAMES[teamId],
    month,
    status: "locked",
    actualPerformanceJmd: month === PREVIOUS_COMPLETE_MONTH
      ? JULY_ACTUAL[teamId]
      : LOCKED_ACTUALS[teamId][index],
    members: membersFor(teamId),
    rule: clone(ACTIVE_RULE),
  });
}

export function buildMockPerformanceStateV1(): MockPerformanceState {
  const currentTeams = {} as Record<PerformanceTeamId, CalculateTeamMonthInput>;
  const lockedSnapshots = {} as MockPerformanceState["lockedSnapshots"];
  for (const teamId of Object.keys(TEAM_NAMES) as PerformanceTeamId[]) {
    currentTeams[teamId] = {
      teamId,
      teamName: TEAM_NAMES[teamId],
      month: CURRENT_MONTH,
      status: "collecting",
      actualPerformanceJmd: AUGUST_ACTUAL[teamId],
      members: membersFor(teamId),
      rule: clone(ACTIVE_RULE),
    };
    lockedSnapshots[teamId] = {};
    for (const month of LOCKED_MONTHS) {
      lockedSnapshots[teamId][month] = buildLockedSnapshotV1(teamId, month);
    }
  }
  return {
    sourceRevision: 1,
    currentMonth: CURRENT_MONTH,
    previousCompleteMonth: PREVIOUS_COMPLETE_MONTH,
    currentTeams,
    lockedSnapshots,
    salaryAdjustments: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isYearMonth(value: unknown): value is YearMonth {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameFiniteNumber(left: unknown, right: number): boolean {
  return isFiniteNumber(left) && Math.abs(left - right) < 1e-9;
}

function isRule(value: unknown): boolean {
  return isRecord(value)
    && typeof value.ruleId === "string"
    && value.ruleId.length > 0
    && typeof value.version === "string"
    && value.version.length > 0
    && typeof value.commissionRate === "number"
    && Number.isFinite(value.commissionRate)
    && value.commissionRate > 0
    && typeof value.cnyToJmdRate === "number"
    && Number.isFinite(value.cnyToJmdRate)
    && value.cnyToJmdRate > 0
    && typeof value.minimumPayableCny === "number"
    && Number.isFinite(value.minimumPayableCny)
    && value.minimumPayableCny >= 0;
}

function isMember(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    typeof value.memberId !== "string"
    || typeof value.employeeNo !== "string"
    || typeof value.name !== "string"
    || typeof value.role !== "string"
    || !["full_month", "joined_first_month", "left_mid_month"].includes(value.calculationKind as string)
    || !isFiniteNumberOrNull(value.standardSalaryCny)
  ) return false;
  if (value.standardSalaryCny !== null && value.standardSalaryCny <= 0) return false;
  if (value.prorationRatio !== undefined && (
    typeof value.prorationRatio !== "number"
    || !Number.isFinite(value.prorationRatio)
    || value.prorationRatio < 0
    || value.prorationRatio > 1
  )) return false;
  if (value.calculationKind !== "full_month" && (
    value.prorationRatio === undefined
    || typeof value.prorationBasis !== "string"
    || value.prorationBasis.trim().length === 0
  )) return false;
  return true;
}

function isSnapshot(value: unknown, teamId: PerformanceTeamId, month: YearMonth): boolean {
  if (!isRecord(value)) return false;
  if (
    value.teamId !== teamId
    || value.teamName !== TEAM_NAMES[teamId]
    || value.month !== month
    || value.status !== "locked"
    || !isFiniteNumberOrNull(value.actualPerformanceJmd)
    || !isFiniteNumberOrNull(value.teamTargetJmd)
    || !isFiniteNumberOrNull(value.completionRate)
    || !isFiniteNumberOrNull(value.payrollTotalCny)
    || !Array.isArray(value.calculationErrors)
    || !value.calculationErrors.every((error) => typeof error === "string")
    || !isRule(value.appliedRule)
    || !Array.isArray(value.members)
    || value.members.length === 0
    || !value.members.every(isMember)
  ) return false;
  if (!value.members.every((member) => {
    if (!isRecord(member)) return false;
    return isFiniteNumberOrNull(member.carriedTargetJmd)
      && isFiniteNumberOrNull(member.wageBaseCny)
      && isFiniteNumberOrNull(member.wageBudgetCny)
      && isFiniteNumberOrNull(member.estimatedPayableCny)
      && (member.calculationError === undefined || typeof member.calculationError === "string");
  })) return false;

  // This demo has no historical error-state contract: each locked snapshot must be a
  // complete V1 calculation, not a partially populated record that merely has valid shapes.
  if (
    value.calculationErrors.length !== 0
    || !isFiniteNumber(value.actualPerformanceJmd)
    || !sameRule(value.appliedRule, ACTIVE_RULE)
  ) return false;
  const expected = buildLockedSnapshotV1(teamId, month);
  if (
    expected.calculationErrors.length !== 0
    || !sameFiniteNumber(value.actualPerformanceJmd, expected.actualPerformanceJmd!)
    || !sameFiniteNumber(value.teamTargetJmd, expected.teamTargetJmd!)
    || !sameFiniteNumber(value.completionRate, expected.completionRate!)
    || !sameFiniteNumber(value.payrollTotalCny, expected.payrollTotalCny!)
    || value.members.length !== expected.members.length
  ) return false;
  return value.members.every((member, index) => {
    if (!isRecord(member)) return false;
    const expectedMember = expected.members[index];
    return member.memberId === expectedMember.memberId
      && member.employeeNo === expectedMember.employeeNo
      && member.name === expectedMember.name
      && member.role === expectedMember.role
      && member.standardSalaryCny === expectedMember.standardSalaryCny
      && member.calculationKind === expectedMember.calculationKind
      && member.prorationRatio === expectedMember.prorationRatio
      && member.prorationBasis === expectedMember.prorationBasis
      && member.calculationError === undefined
      && sameFiniteNumber(member.carriedTargetJmd, expectedMember.carriedTargetJmd!)
      && sameFiniteNumber(member.wageBaseCny, expectedMember.wageBaseCny!)
      && sameFiniteNumber(member.wageBudgetCny, expectedMember.wageBudgetCny!)
      && sameFiniteNumber(member.estimatedPayableCny, expectedMember.estimatedPayableCny!);
  });
}

function sameRule(value: unknown, expected: typeof ACTIVE_RULE): boolean {
  return isRecord(value)
    && value.ruleId === expected.ruleId
    && value.version === expected.version
    && value.commissionRate === expected.commissionRate
    && value.cnyToJmdRate === expected.cnyToJmdRate
    && value.minimumPayableCny === expected.minimumPayableCny;
}

function isSalaryAdjustment(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && typeof value.teamId === "string"
    && value.teamId in TEAM_NAMES
    && typeof value.memberId === "string"
    && isYearMonth(value.month)
    && typeof value.fromCny === "number"
    && Number.isFinite(value.fromCny)
    && typeof value.toCny === "number"
    && Number.isFinite(value.toCny)
    && typeof value.changedBy === "string"
    && typeof value.changedAt === "string";
}

type PersistedMutableStateV1 = Omit<MockPerformanceState, "lockedSnapshots"> & {
  lockedSnapshots: unknown;
};

function hasValidMutableStateV1(value: unknown): value is {
  schemaVersion: 1;
  state: PersistedMutableStateV1;
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.state)) return false;
  const state = value.state;
  if (
    !Number.isInteger(state.sourceRevision)
    || (state.sourceRevision as number) < 1
    || state.currentMonth !== CURRENT_MONTH
    || state.previousCompleteMonth !== PREVIOUS_COMPLETE_MONTH
    || !isRecord(state.currentTeams)
    || !Array.isArray(state.salaryAdjustments)
    || !state.salaryAdjustments.every(isSalaryAdjustment)
  ) return false;
  const currentTeams = state.currentTeams as Record<string, unknown>;
  return (Object.keys(TEAM_NAMES) as PerformanceTeamId[]).every((teamId) => {
    const current = currentTeams[teamId];
    return isRecord(current)
      && current.teamId === teamId
      && current.teamName === TEAM_NAMES[teamId]
      && current.month === state.currentMonth
      && current.status === "collecting"
      && isFiniteNumberOrNull(current.actualPerformanceJmd)
      && Array.isArray(current.members)
      && current.members.length > 0
      && current.members.every(isMember)
      && isRule(current.rule);
  });
}

function hasValidLockedSnapshotsV1(value: unknown): value is MockPerformanceState["lockedSnapshots"] {
  if (!isRecord(value)) return false;
  return (Object.keys(TEAM_NAMES) as PerformanceTeamId[]).every((teamId) => {
    const snapshots = value[teamId];
    return isRecord(snapshots)
      && Object.keys(snapshots).length === LOCKED_MONTHS.length
      && LOCKED_MONTHS.every((month) => isSnapshot(snapshots[month], teamId, month));
  });
}

function loadState(storage?: StorageLike): MockPerformanceStateV2 {
  const seed = (): MockPerformanceStateV2 => migratePerformanceEnvelope({
    schemaVersion: 1,
    state: buildMockPerformanceStateV1(),
  }).state;
  if (!storage) return seed();
  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (!serialized) return seed();
    const parsed: unknown = JSON.parse(serialized);
    if (isRecord(parsed) && parsed.schemaVersion === 2 && isRecord(parsed.state)) {
      const v1Shape = { schemaVersion: 1, state: parsed.state };
      if (!hasValidMutableStateV1(v1Shape) || !Array.isArray(parsed.state.ruleVersions)) return seed();
      const ruleVersions = parsed.state.ruleVersions as PerformanceRuleVersion[];
      if (ruleVersions.length === 0 || !ruleVersions.every(isRuleVersion)) return seed();
      const lockedSnapshots = hasValidLockedSnapshotsV1(parsed.state.lockedSnapshots)
        ? parsed.state.lockedSnapshots
        : buildMockPerformanceStateV1().lockedSnapshots;
      return clone({
        ...parsed.state,
        lockedSnapshots,
        ruleVersions: normalizeRuleStatuses(ruleVersions, parsed.state.currentMonth as string),
      } as MockPerformanceStateV2);
    }
    if (!hasValidMutableStateV1(parsed)) return seed();
    const lockedSnapshots = hasValidLockedSnapshotsV1(parsed.state.lockedSnapshots)
      ? parsed.state.lockedSnapshots
      : buildMockPerformanceStateV1().lockedSnapshots;
    const migrated = migratePerformanceEnvelope({
      schemaVersion: 1,
      state: clone({ ...parsed.state, lockedSnapshots }) as MockPerformanceState,
    });
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch (error) {
      throw new Error(`绩效数据迁移失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return migrated.state;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("绩效数据迁移失败")) throw error;
    return seed();
  }
}

function isRuleVersion(value: unknown): value is PerformanceRuleVersion {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.version === "string"
    && isYearMonth(value.effectiveMonth)
    && ["draft", "scheduled", "active", "historical"].includes(value.status as string)
    && isRecord(value.parameters)
    && isFiniteNumber(value.parameters.commissionRate)
    && value.parameters.commissionRate > 0
    && isFiniteNumber(value.parameters.cnyToJmdRate)
    && value.parameters.cnyToJmdRate > 0
    && isFiniteNumber(value.parameters.minimumPayableCny)
    && typeof value.createdBy === "string"
    && typeof value.createdAt === "string"
    && typeof value.reason === "string";
}

function createToken(): string {
  const random = globalThis.crypto;
  if (typeof random?.randomUUID === "function") return random.randomUUID();
  const bytes = new Uint8Array(24);
  random?.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertView(access: PerformanceAccessContext): void {
  if (!access?.permissions?.canViewPerformance) throw new Error("无权查看绩效");
}

function assertEdit(access: PerformanceAccessContext): void {
  assertView(access);
  if (!access.permissions.canEditSalary) throw new Error("无权修改标准工资");
}

function assertManageRules(access: PerformanceAccessContext): void {
  assertView(access);
  if (!access.permissions.canManageRules) throw new Error("无权管理绩效规则");
}

function assertTeamId(teamId: string): asserts teamId is PerformanceTeamId {
  if (!(teamId in TEAM_NAMES)) throw new Error("班组不存在");
}

function validateSalaryInput(state: MockPerformanceState, input: UpdateStandardSalaryInput): PerformanceTeamId {
  assertTeamId(input.teamId);
  const current = state.currentTeams[input.teamId];
  if (input.month !== state.currentMonth || current.status !== "collecting") {
    throw new Error("月份已锁定，不能修改标准工资");
  }
  if (!current.members.some((member) => member.memberId === input.memberId)) {
    throw new Error("成员不属于班组");
  }
  if (!Number.isFinite(input.newSalaryCny) || input.newSalaryCny <= 0 || input.newSalaryCny > 1_000_000) {
    throw new Error("标准工资金额无效");
  }
  return input.teamId;
}

function detailFromState(
  state: MockPerformanceState,
  teamId: PerformanceTeamId,
  month: YearMonth,
  permissions: PerformancePermissions,
): TeamPerformanceDetailResponse {
  const selected = month === state.currentMonth
    ? calculateTeamMonth(state.currentTeams[teamId])
    : state.lockedSnapshots[teamId][month];
  if (!selected) throw new Error("未找到该月份绩效快照");
  const snapshots = Object.values(state.lockedSnapshots[teamId]) as TeamMonthSnapshot[];
  return {
    selected: clone(selected),
    currentMonth: state.currentMonth,
    previousCompleteMonth: state.previousCompleteMonth,
    lockedMonths: snapshots.map((snapshot) => snapshot.month).sort(),
    history: buildHistoryComparisons(snapshots),
    permissions: clone(permissions),
  };
}

function memberFromState(
  state: MockPerformanceState,
  teamId: PerformanceTeamId,
  memberId: string,
  month: YearMonth,
  permissions: PerformancePermissions,
): PerformanceMemberDetail {
  const detail = detailFromState(state, teamId, month, permissions);
  const member = detail.selected.members.find((entry) => entry.memberId === memberId);
  if (!member) throw new Error("成员不属于班组");
  return {
    teamId,
    selectedMonth: month,
    member: clone(member),
    teamCompletionRate: detail.selected.completionRate,
    history: detail.history.map((row) => {
      const historyMember = row.snapshot.members.find((entry) => entry.memberId === memberId);
      if (!historyMember) throw new Error("历史快照成员不完整");
      return { month: row.snapshot.month, result: clone(historyMember) };
    }),
    salaryAdjustments: clone(state.salaryAdjustments.filter(
      (entry) => entry.teamId === teamId && entry.memberId === memberId,
    )),
    permissions: clone(permissions),
  };
}

export function createMockPerformanceStore(
  { initialState, storage, faults = {} }: CreateMockPerformanceStoreOptions = {},
): MockPerformanceStore {
  let state: MockPerformanceStateV2 = initialState
    ? migratePerformanceEnvelope({ schemaVersion: 1, state: clone(initialState) }).state
    : loadState(storage);
  const previews = new Map<string, PreviewRegistryEntry>();
  const rulePreviews = new Map<string, RulePreviewRegistryEntry>();
  const failNext = { ...faults.failNext };

  if (faults.dataScenario === "emptyHistory") {
    state = { ...state, lockedSnapshots: { t1: {}, t2: {}, t3: {}, t4: {} } };
  }
  if (faults.dataScenario === "missingStandardSalary") {
    state.currentTeams.t1.members[0] = { ...state.currentTeams.t1.members[0], standardSalaryCny: null };
  }
  if (faults.dataScenario === "missingRuleMemberSalary") {
    state.currentTeams.t1.members[0] = { ...state.currentTeams.t1.members[0], standardSalaryCny: null };
  }
  if (faults.dataScenario === "missingRuleActual") {
    state.currentTeams.t1.actualPerformanceJmd = null;
  }

  const takeFault = (operation: MockPerformanceOperation): void => {
    const message = failNext[operation];
    if (message !== undefined) {
      delete failNext[operation];
      throw new Error(message);
    }
  };
  const persist = (nextState: MockPerformanceStateV2): void => {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, state: nextState }));
  };
  const team = (
    access: PerformanceAccessContext,
    teamId: string,
    requestedMonth?: string,
  ): TeamPerformanceDetailResponse => {
    assertView(access);
    takeFault("teamRead");
    assertTeamId(teamId);
    return detailFromState(state, teamId, (requestedMonth ?? state.currentMonth) as YearMonth, access.permissions);
  };

  const lockedMonths = (): YearMonth[] => Array.from(new Set(
    (Object.keys(state.lockedSnapshots) as PerformanceTeamId[]).flatMap(
      (teamId) => Object.keys(state.lockedSnapshots[teamId]) as YearMonth[],
    ),
  )).sort();

  const normalizedDraft = (input: RuleDraftInput): RuleDraftInput => ({
    commissionRatePercent: input.commissionRatePercent,
    cnyToJmdRate: input.cnyToJmdRate,
    effectiveMonth: input.effectiveMonth,
    reason: input.reason.trim(),
  });

  const assertValidRuleDraft = (input: RuleDraftInput): RuleDraftInput => {
    const normalized = normalizedDraft(input);
    const errors = validateRuleEffectiveMonth(normalized, {
      currentMonth: state.currentMonth,
      lockedMonths: lockedMonths(),
    });
    if (Object.keys(errors).length > 0) throw new Error(Object.values(errors).join("；"));
    return normalized;
  };

  const getRuleWorkspace = (access: PerformanceAccessContext): RuleWorkspaceResponse => {
    assertView(access);
    const versions = normalizeRuleStatuses(state.ruleVersions, state.currentMonth);
    const currentRule = resolveRuleForMonth(versions, state.currentMonth);
    if (!currentRule) throw new Error("当前月份未找到可用规则");
    return {
      currentMonth: state.currentMonth,
      currentRule: clone(currentRule),
      scheduledRules: clone(versions.filter((rule) => rule.status === "scheduled")
        .sort((left, right) => left.effectiveMonth.localeCompare(right.effectiveMonth))),
      historicalRules: clone(versions.filter((rule) => rule.status === "historical")
        .sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth))),
      draftRules: clone(versions.filter((rule) => rule.status === "draft")),
      lockedMonths: lockedMonths(),
      permissions: clone(access.permissions),
    };
  };

  return {
    exportEnvelope: () => ({ schemaVersion: 2, state: clone(state) }),
    team,
    member: (access, teamId, memberId, month) => {
      assertView(access);
      takeFault("teamRead");
      assertTeamId(teamId);
      return memberFromState(state, teamId, memberId, month as YearMonth, access.permissions);
    },
    previewSalary: (access, input) => {
      assertEdit(access);
      const teamId = validateSalaryInput(state, input);
      takeFault("salaryPreview");
      const selected = detailFromState(state, teamId, input.month, access.permissions).selected;
      const calculation = previewSalaryChange(selected, input.memberId, input.newSalaryCny);
      const normalizedInput = clone(calculation.input);
      const previewToken = createToken();
      previews.set(previewToken, { normalizedInput, sourceRevision: state.sourceRevision });
      return { ...calculation, input: normalizedInput, previewToken, sourceRevision: state.sourceRevision };
    },
    updateSalary: (access, input) => {
      assertEdit(access);
      const teamId = validateSalaryInput(state, input);
      takeFault("salarySave");
      const preview = previews.get(input.previewToken);
      if (!preview) throw new Error("请先预览或预览凭证无效，请重新预览");
      const { previewToken: _previewToken, ...update } = input;
      const sameInput = JSON.stringify(preview.normalizedInput) === JSON.stringify(update);
      if (!sameInput) throw new Error("预览内容已变化，请重新预览");
      if (preview.sourceRevision !== state.sourceRevision) throw new Error("源数据已变化，请重新预览");

      const existingMember = state.currentTeams[teamId].members.find(
        (member) => member.memberId === input.memberId,
      )!;
      if (existingMember.standardSalaryCny === input.newSalaryCny) {
        previews.delete(input.previewToken);
        return {
          detail: detailFromState(state, teamId, input.month, access.permissions),
          member: memberFromState(state, teamId, input.memberId, input.month, access.permissions),
        };
      }

      const nextState = clone(state);
      const teamInput = nextState.currentTeams[teamId];
      const memberIndex = teamInput.members.findIndex((member) => member.memberId === input.memberId);
      const oldSalary = teamInput.members[memberIndex].standardSalaryCny;
      teamInput.members[memberIndex] = { ...teamInput.members[memberIndex], standardSalaryCny: input.newSalaryCny };
      nextState.sourceRevision += 1;
      nextState.salaryAdjustments.push({
        id: `salary-${nextState.sourceRevision}-${input.memberId}`,
        teamId,
        memberId: input.memberId,
        month: input.month,
        fromCny: oldSalary ?? 0,
        toCny: input.newSalaryCny,
        changedBy: access.actorId,
        changedAt: "2026-08-09T00:00:00.000Z",
      });
      persist(nextState);
      state = nextState;
      previews.delete(input.previewToken);
      return {
        detail: detailFromState(state, teamId, input.month, access.permissions),
        member: memberFromState(state, teamId, input.memberId, input.month, access.permissions),
      };
    },
    getRuleWorkspace,
    previewRule: async (access, input) => {
      assertManageRules(access);
      const draft = assertValidRuleDraft(input);
      takeFault("rulePreview");
      if (faults.dataScenario === "missingRuleTeam") {
        throw new Error("四个班组数据不完整");
      }
      const teamInputs = (Object.keys(TEAM_NAMES) as PerformanceTeamId[]).map((teamId) => state.currentTeams[teamId]);
      if (teamInputs.length !== 4 || teamInputs.some((team) => !team)) {
        throw new Error("四个班组数据不完整");
      }
      if (teamInputs.some((team) => team.members.some((member) => member.standardSalaryCny === null))) {
        throw new Error("成员工资数据不完整");
      }
      if (teamInputs.some((team) => team.actualPerformanceJmd === null)) {
        throw new Error("实际绩效数据不完整");
      }
      const calculation = previewRuleImpact(teamInputs, draft);
      if (calculation.teams.length !== 4) throw new Error("四个班组数据不完整");
      const sourceRevision = state.sourceRevision;
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ draft, sourceRevision })),
      );
      const inputHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const previewToken = createToken();
      rulePreviews.set(previewToken, { normalizedDraft: draft, inputHash, sourceRevision });
      return { ...calculation, previewToken, inputHash, sourceRevision };
    },
    saveRuleDraft: (access, input) => {
      assertManageRules(access);
      const draft = assertValidRuleDraft(input.draft);
      takeFault("ruleSave");
      const preview = rulePreviews.get(input.previewToken);
      if (!preview) throw new Error("请先生成有效预览");
      if (JSON.stringify(preview.normalizedDraft) !== JSON.stringify(draft)) {
        throw new Error("预览已失效，请重新预览");
      }
      if (preview.sourceRevision !== state.sourceRevision) throw new Error("源数据已变化，请重新预览");
      if (state.ruleVersions.some((rule) => rule.status !== "draft" && rule.effectiveMonth === draft.effectiveMonth)) {
        throw new Error("生效月份已存在规则");
      }
      const nextNumber = Math.max(1, ...state.ruleVersions.map((rule) => Number(rule.version.replace(/^V/, "")) || 0)) + 1;
      const saved: PerformanceRuleVersion = {
        id: `rule-v${nextNumber}`,
        version: `V${nextNumber}`,
        effectiveMonth: draft.effectiveMonth,
        status: "draft",
        parameters: {
          commissionRate: draft.commissionRatePercent / 100,
          cnyToJmdRate: draft.cnyToJmdRate,
          minimumPayableCny: 0,
        },
        createdBy: access.actorId === "emp-001" ? "LiJian" : access.actorId,
        createdAt: "2026-08-09T09:00:00-05:00",
        reason: draft.reason,
        previewInputHash: preview.inputHash,
        previewSourceRevision: preview.sourceRevision,
      };
      const nextState = clone(state);
      nextState.ruleVersions.push(saved);
      persist(nextState);
      state = nextState;
      rulePreviews.delete(input.previewToken);
      return clone(saved);
    },
    activateRule: (access, ruleId) => {
      assertManageRules(access);
      takeFault("ruleActivate");
      const rule = state.ruleVersions.find((item) => item.id === ruleId);
      if (!rule || rule.status !== "draft") throw new Error("规则草稿不存在");
      const draft = assertValidRuleDraft({
        commissionRatePercent: rule.parameters.commissionRate * 100,
        cnyToJmdRate: rule.parameters.cnyToJmdRate,
        effectiveMonth: rule.effectiveMonth,
        reason: rule.reason,
      });
      if (!rule.previewInputHash || rule.previewSourceRevision === null) {
        throw new Error("未生成四组影响预览，不能启用");
      }
      if (rule.previewSourceRevision !== state.sourceRevision) throw new Error("源数据已变化，请重新预览");
      if (state.ruleVersions.some((item) => item.id !== rule.id && item.status !== "draft" && item.effectiveMonth === draft.effectiveMonth)) {
        throw new Error("生效月份已存在规则");
      }
      const nextState = clone(state);
      const index = nextState.ruleVersions.findIndex((item) => item.id === rule.id);
      nextState.ruleVersions[index] = {
        ...nextState.ruleVersions[index],
        status: draft.effectiveMonth === state.currentMonth ? "active" : "scheduled",
      };
      nextState.ruleVersions = normalizeRuleStatuses(nextState.ruleVersions, state.currentMonth);
      if (draft.effectiveMonth === state.currentMonth) {
        for (const teamId of Object.keys(TEAM_NAMES) as PerformanceTeamId[]) {
          nextState.currentTeams[teamId].rule = {
            ruleId: rule.id,
            version: rule.version,
            ...rule.parameters,
          };
        }
      }
      nextState.sourceRevision += 1;
      persist(nextState);
      state = nextState;
      return getRuleWorkspace(access);
    },
    dashboardPerformance: (access) => {
      assertView(access);
      takeFault("teamRead");
      const teams = (Object.keys(TEAM_NAMES) as PerformanceTeamId[]).map((teamId) => {
        const selected = detailFromState(state, teamId, state.currentMonth, access.permissions).selected;
        if (selected.teamTargetJmd === null || selected.calculationErrors.length > 0) {
          throw new Error(`班组 ${TEAM_NAMES[teamId]} 绩效计算不完整：${selected.calculationErrors.join("；")}`);
        }
        const currentAmount = selected.actualPerformanceJmd;
        const targetAmount = selected.teamTargetJmd;
        if (currentAmount === null) throw new Error(`班组 ${TEAM_NAMES[teamId]} 实际绩效缺失`);
        return {
          id: teamId,
          name: TEAM_NAMES[teamId],
          completionRate: targetAmount === 0 ? 0 : Number((currentAmount / targetAmount * 100).toFixed(1)),
          currentAmount,
          targetAmount,
          color: TEAM_COLORS[teamId],
        };
      });
      const targetCompletedAmount = teams.reduce((sum, team) => sum + team.currentAmount, 0);
      const targetTotalAmount = teams.reduce((sum, team) => sum + team.targetAmount, 0);
      return {
        teams,
        targetCompletedAmount,
        targetTotalAmount,
        targetCompletionRate: targetTotalAmount === 0
          ? 0
          : Number((targetCompletedAmount / targetTotalAmount * 100).toFixed(1)),
      };
    },
    getDelay: (operation) => faults.delayMs?.[operation] ?? 0,
  };
}

let browserStore: MockPerformanceStore | undefined;
let browserStorage: StorageLike | undefined;
let browserScenario:
  | MockPerformanceFaults
  | MockPerformanceFaults["dataScenario"]
  | MockPerformanceE2EScenario
  | undefined;

export function getMockPerformanceStore(): MockPerformanceStore {
  const browser = typeof window === "undefined" ? undefined : window as Window & {
    __WH_PERFORMANCE_TEST_SCENARIO__?:
      | MockPerformanceFaults
      | MockPerformanceFaults["dataScenario"]
      | MockPerformanceE2EScenario;
  };
  const storage = browser?.localStorage;
  const scenario = browser?.__WH_PERFORMANCE_TEST_SCENARIO__;
  if (browserStore && browserStorage === storage && browserScenario === scenario) return browserStore;
  const faults: MockPerformanceFaults | undefined = scenario === "rule-save-failure-once"
    ? { failNext: { ruleSave: "可重试规则保存故障" } }
    : scenario === "rule-activate-failure-once"
      ? { failNext: { ruleActivate: "可重试规则启用故障" } }
      : scenario === "missing-rule-team"
        ? { dataScenario: "missingRuleTeam" }
        : scenario === "missing-rule-member-salary"
          ? { dataScenario: "missingRuleMemberSalary" }
          : scenario === "missing-rule-actual"
            ? { dataScenario: "missingRuleActual" }
            : typeof scenario === "string"
              ? { dataScenario: scenario }
              : scenario;
  browserStore = createMockPerformanceStore({ storage, faults });
  browserStorage = storage;
  browserScenario = scenario;
  return browserStore;
}

export function getMockTeamPerformanceDetail(
  access: PerformanceAccessContext,
  teamId: string,
  month?: string,
): TeamPerformanceDetailResponse {
  return getMockPerformanceStore().team(access, teamId, month);
}

export function getMockMemberDetail(
  access: PerformanceAccessContext,
  teamId: string,
  memberId: string,
  month: string,
): PerformanceMemberDetail {
  return getMockPerformanceStore().member(access, teamId, memberId, month);
}

export function previewMockSalaryChange(
  access: PerformanceAccessContext,
  input: UpdateStandardSalaryInput,
): SalaryChangePreview {
  return getMockPerformanceStore().previewSalary(access, input);
}

export function updateMockStandardSalary(
  access: PerformanceAccessContext,
  input: SaveStandardSalaryInput,
): UpdateStandardSalaryResult {
  return getMockPerformanceStore().updateSalary(access, input);
}

export function getMockDashboardPerformance(access: PerformanceAccessContext): DashboardPerformanceSummary {
  return getMockPerformanceStore().dashboardPerformance(access);
}
