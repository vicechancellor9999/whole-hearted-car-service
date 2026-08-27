export type YearMonth = `${number}-${string}`;
export type PerformanceTeamId = "t1" | "t2" | "t3" | "t4";
export type MonthStatus = "collecting" | "locked";
export type EmploymentCalculationKind =
  | "full_month"
  | "joined_first_month"
  | "left_mid_month";

export interface PerformanceRuleParameters {
  commissionRate: number;
  cnyToJmdRate: number;
  minimumPayableCny: number;
}

export interface AppliedRuleSnapshot extends PerformanceRuleParameters {
  ruleId: string;
  version: string;
}

export interface TeamMemberMonthInput {
  memberId: string;
  employeeNo: string;
  name: string;
  role: string;
  standardSalaryCny: number | null;
  calculationKind: EmploymentCalculationKind;
  prorationRatio?: number;
  prorationBasis?: string;
}

export interface TeamMemberMonthResult extends TeamMemberMonthInput {
  carriedTargetJmd: number | null;
  wageBaseCny: number | null;
  wageBudgetCny: number | null;
  estimatedPayableCny: number | null;
  calculationError?: string;
}

export interface CalculateTeamMonthInput {
  teamId: string;
  teamName: string;
  month: YearMonth;
  status: MonthStatus;
  actualPerformanceJmd: number | null;
  members: TeamMemberMonthInput[];
  rule: AppliedRuleSnapshot;
}

export interface TeamMonthSnapshot {
  teamId: string;
  teamName: string;
  month: YearMonth;
  status: MonthStatus;
  actualPerformanceJmd: number | null;
  teamTargetJmd: number | null;
  completionRate: number | null;
  payrollTotalCny: number | null;
  calculationErrors: string[];
  appliedRule: AppliedRuleSnapshot;
  members: TeamMemberMonthResult[];
}

export interface PerformancePermissions {
  canViewPerformance: boolean;
  canEditSalary: boolean;
  canManageRules: boolean;
}

export interface PerformanceAccessContext {
  actorId: string;
  permissions: PerformancePermissions;
}

export type HistoryComparisonStatus =
  | "up"
  | "down"
  | "unchanged"
  | "insufficient_history";

export interface PerformanceMetricValues {
  completionRate: number | null;
  actualPerformanceJmd: number | null;
  payrollTotalCny: number | null;
}

export interface PerformanceHistoryRow {
  snapshot: TeamMonthSnapshot;
  previousMonthDelta: PerformanceMetricValues;
  historicalAverage: PerformanceMetricValues;
  comparisonStatus: Record<"completion" | "actual" | "payroll", HistoryComparisonStatus>;
}

export interface TeamPerformanceDetailResponse {
  selected: TeamMonthSnapshot;
  currentMonth: YearMonth;
  previousCompleteMonth: YearMonth | null;
  lockedMonths: YearMonth[];
  history: PerformanceHistoryRow[];
  permissions: PerformancePermissions;
}

export interface PerformanceMemberDetail {
  teamId: string;
  selectedMonth: YearMonth;
  member: TeamMemberMonthResult;
  teamCompletionRate: number | null;
  history: Array<{ month: YearMonth; result: TeamMemberMonthResult }>;
  salaryAdjustments: SalaryAdjustmentRecord[];
  permissions: PerformancePermissions;
}

export interface SalaryAdjustmentRecord {
  id: string;
  teamId: PerformanceTeamId;
  memberId: string;
  month: YearMonth;
  fromCny: number;
  toCny: number;
  changedBy: string;
  changedAt: string;
}

export interface UpdateStandardSalaryInput {
  teamId: string;
  memberId: string;
  month: YearMonth;
  newSalaryCny: number;
}

export interface SalaryChangeCalculation {
  input: UpdateStandardSalaryInput;
  changedMemberId: string;
  before: TeamMonthSnapshot;
  after: TeamMonthSnapshot;
}

export interface SalaryChangePreview extends SalaryChangeCalculation {
  previewToken: string;
  sourceRevision: number;
}

export interface SaveStandardSalaryInput extends UpdateStandardSalaryInput {
  previewToken: string;
}

export interface UpdateStandardSalaryResult {
  detail: TeamPerformanceDetailResponse;
  member: PerformanceMemberDetail;
}

export interface MockPerformanceState {
  sourceRevision: number;
  currentMonth: YearMonth;
  previousCompleteMonth: YearMonth;
  currentTeams: Record<PerformanceTeamId, CalculateTeamMonthInput>;
  lockedSnapshots: Record<PerformanceTeamId, Partial<Record<YearMonth, TeamMonthSnapshot>>>;
  salaryAdjustments: SalaryAdjustmentRecord[];
}

export interface PersistedPerformanceEnvelopeV1 {
  schemaVersion: 1;
  state: MockPerformanceState;
}

export type RuleStatus = "draft" | "scheduled" | "active" | "historical";

export interface PerformanceRuleVersion {
  id: string;
  version: string;
  effectiveMonth: YearMonth;
  status: RuleStatus;
  parameters: PerformanceRuleParameters;
  createdBy: string;
  createdAt: string;
  reason: string;
  previewInputHash: string | null;
  previewSourceRevision: number | null;
}

export interface RuleDraftInput {
  commissionRatePercent: number;
  cnyToJmdRate: number;
  effectiveMonth: YearMonth;
  reason: string;
}

export interface RuleImpactCalculation {
  draft: RuleDraftInput;
  parameters: PerformanceRuleParameters;
  teams: Array<{
    teamId: string;
    teamName: string;
    before: TeamMonthSnapshot;
    after: TeamMonthSnapshot;
  }>;
}

export interface RuleImpactPreview extends RuleImpactCalculation {
  previewToken: string;
  inputHash: string;
  sourceRevision: number;
}

export interface SaveRuleDraftInput {
  draft: RuleDraftInput;
  previewToken: string;
}

export interface RuleWorkspaceResponse {
  currentMonth: YearMonth;
  currentRule: PerformanceRuleVersion;
  scheduledRules: PerformanceRuleVersion[];
  historicalRules: PerformanceRuleVersion[];
  draftRules: PerformanceRuleVersion[];
  lockedMonths: YearMonth[];
  permissions: PerformancePermissions;
}

export interface MockPerformanceStateV2 extends MockPerformanceState {
  ruleVersions: PerformanceRuleVersion[];
}

export interface PersistedPerformanceEnvelopeV2 {
  schemaVersion: 2;
  state: MockPerformanceStateV2;
}
