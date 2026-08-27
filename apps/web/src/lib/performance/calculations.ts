import type {
  AppliedRuleSnapshot,
  CalculateTeamMonthInput,
  HistoryComparisonStatus,
  PerformanceHistoryRow,
  PerformanceMetricValues,
  PerformanceRuleVersion,
  PerformanceRuleParameters,
  RuleDraftInput,
  RuleImpactCalculation,
  SalaryChangeCalculation,
  TeamMemberMonthInput,
  TeamMemberMonthResult,
  TeamMonthSnapshot,
} from "./types";

export type RuleDraftErrors = Partial<Record<keyof RuleDraftInput, string>>;

/**
 * 应结工资提成比例（0.25 = 25%）由绩效规则 commissionRate 配置（mock 默认 0.25）。
 * 绩效值默认 = 工时合计（1:1），与提成比例无关（8/18 老板定）。
 */

export function validateRuleDraftSyntax(input: RuleDraftInput): RuleDraftErrors {
  const errors: RuleDraftErrors = {};
  if (
    !Number.isFinite(input.commissionRatePercent)
    || input.commissionRatePercent <= 0
    || input.commissionRatePercent > 100
  ) errors.commissionRatePercent = "工时费提成比例必须大于 0 且不超过 100";
  if (!Number.isFinite(input.cnyToJmdRate) || input.cnyToJmdRate <= 0) {
    errors.cnyToJmdRate = "人民币汇率必须大于 0";
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.effectiveMonth)) {
    errors.effectiveMonth = "生效月份格式无效";
  }
  if (!input.reason.trim()) errors.reason = "变更原因不能为空";
  return errors;
}

export function validateRuleEffectiveMonth(
  input: RuleDraftInput,
  context: { currentMonth: string; lockedMonths: string[] },
): RuleDraftErrors {
  const errors = validateRuleDraftSyntax(input);
  if (!errors.effectiveMonth && context.lockedMonths.includes(input.effectiveMonth)) {
    errors.effectiveMonth = "已锁定月份不能生效";
  } else if (!errors.effectiveMonth && input.effectiveMonth < context.currentMonth) {
    errors.effectiveMonth = "过去月份不能生效";
  }
  return errors;
}

export function resolveRuleForMonth(
  versions: PerformanceRuleVersion[],
  month: string,
): PerformanceRuleVersion | undefined {
  return versions
    .filter((rule) => rule.status !== "draft" && rule.effectiveMonth <= month)
    .slice()
    .sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth))[0];
}

export function normalizeRuleStatuses(
  versions: PerformanceRuleVersion[],
  currentMonth: string,
): PerformanceRuleVersion[] {
  const effective = versions
    .filter((rule) => rule.status !== "draft" && rule.effectiveMonth <= currentMonth)
    .slice()
    .sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth))[0];
  return versions.map((rule) => {
    if (rule.status === "draft") return { ...rule };
    if (rule.id === effective?.id) return { ...rule, status: "active" };
    if (rule.effectiveMonth > currentMonth) return { ...rule, status: "scheduled" };
    return { ...rule, status: "historical" };
  });
}

export function previewRuleImpact(
  teamInputs: CalculateTeamMonthInput[],
  draft: RuleDraftInput,
): RuleImpactCalculation {
  const errors = validateRuleDraftSyntax(draft);
  if (Object.keys(errors).length > 0) throw new Error(Object.values(errors).join("；"));
  const normalizedDraft: RuleDraftInput = { ...draft, reason: draft.reason.trim() };
  const parameters = {
    commissionRate: normalizedDraft.commissionRatePercent / 100,
    cnyToJmdRate: normalizedDraft.cnyToJmdRate,
    minimumPayableCny: 0,
  };
  return {
    draft: normalizedDraft,
    parameters,
    teams: teamInputs.map((input) => {
      const before = calculateTeamMonth(input);
      const after = calculateTeamMonth({
        ...input,
        members: input.members.map((member) => ({ ...member })),
        rule: {
          ruleId: "rule-preview",
          version: "预览",
          ...parameters,
        },
      });
      return { teamId: input.teamId, teamName: input.teamName, before, after };
    }),
  };
}

function requiredProrationRatio(member: TeamMemberMonthInput): number {
  if (
    member.prorationRatio === undefined ||
    !Number.isFinite(member.prorationRatio) ||
    member.prorationRatio < 0 ||
    member.prorationRatio > 1
  ) {
    throw new Error(`成员 ${member.memberId} 的工资折算比例无效`);
  }
  return member.prorationRatio;
}

export function calculateCarriedTargetJmd(
  member: TeamMemberMonthInput,
  rule: PerformanceRuleParameters,
): number | null {
  assertValidRule(rule);
  if (member.standardSalaryCny === null) return null;
  if (member.calculationKind === "joined_first_month") return 0;
  const fullTarget = member.standardSalaryCny / rule.commissionRate * rule.cnyToJmdRate;
  if (member.calculationKind === "left_mid_month") {
    return fullTarget * requiredProrationRatio(member);
  }
  return fullTarget;
}

function validateRule(rule: PerformanceRuleParameters): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(rule.commissionRate) || rule.commissionRate <= 0) {
    errors.push("佣金比例必须大于 0");
  }
  if (!Number.isFinite(rule.cnyToJmdRate) || rule.cnyToJmdRate <= 0) {
    errors.push("人民币兑牙买加元汇率必须大于 0");
  }
  return errors;
}

function assertValidRule(rule: PerformanceRuleParameters): void {
  const errors = validateRule(rule);
  if (errors.length > 0) throw new Error(errors.join("；"));
}

function memberBase(member: TeamMemberMonthInput): number | null {
  if (member.standardSalaryCny === null) return null;
  if (member.calculationKind === "full_month") return member.standardSalaryCny;
  return member.standardSalaryCny * requiredProrationRatio(member);
}

function emptyMetrics(): PerformanceMetricValues {
  return { completionRate: null, actualPerformanceJmd: null, payrollTotalCny: null };
}

function metricValues(snapshot: TeamMonthSnapshot): PerformanceMetricValues {
  return {
    completionRate: snapshot.completionRate,
    actualPerformanceJmd: snapshot.actualPerformanceJmd,
    payrollTotalCny: snapshot.payrollTotalCny,
  };
}

function averageMetrics(snapshots: TeamMonthSnapshot[]): PerformanceMetricValues {
  const average = (values: Array<number | null>): number | null => {
    const available = values.filter((value): value is number => value !== null);
    return available.length === 0
      ? null
      : available.reduce((total, value) => total + value, 0) / available.length;
  };
  return {
    completionRate: average(snapshots.map((snapshot) => snapshot.completionRate)),
    actualPerformanceJmd: average(snapshots.map((snapshot) => snapshot.actualPerformanceJmd)),
    payrollTotalCny: average(snapshots.map((snapshot) => snapshot.payrollTotalCny)),
  };
}

function metricDelta(
  current: PerformanceMetricValues,
  previous: PerformanceMetricValues | null,
): PerformanceMetricValues {
  if (previous === null) return emptyMetrics();
  const difference = (currentValue: number | null, previousValue: number | null): number | null => (
    currentValue === null || previousValue === null ? null : currentValue - previousValue
  );
  return {
    completionRate: difference(current.completionRate, previous.completionRate),
    actualPerformanceJmd: difference(current.actualPerformanceJmd, previous.actualPerformanceJmd),
    payrollTotalCny: difference(current.payrollTotalCny, previous.payrollTotalCny),
  };
}

function comparisonStatus(delta: number | null): HistoryComparisonStatus {
  if (delta === null) return "insufficient_history";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "unchanged";
}

export function calculateTeamMonth(input: CalculateTeamMonthInput): TeamMonthSnapshot {
  const ruleErrors = validateRule(input.rule);
  const errors = [...ruleErrors];
  const hasActualPerformance = input.actualPerformanceJmd !== null
    && Number.isFinite(input.actualPerformanceJmd);
  if (!hasActualPerformance) {
    errors.push("实际业绩缺失");
  }
  if (input.members.length === 0) errors.push("班组成员缺失");

  const members: TeamMemberMonthResult[] = input.members.map((member) => {
    let calculationError: string | undefined;
    let carriedTargetJmd: number | null = null;
    let wageBaseCny: number | null = null;
    try {
      if (member.standardSalaryCny === null) {
        calculationError = `成员 ${member.memberId} 缺少标准工资`;
        errors.push(calculationError);
      } else if (ruleErrors.length === 0) {
        carriedTargetJmd = calculateCarriedTargetJmd(member, input.rule);
        wageBaseCny = memberBase(member);
      }
    } catch (error) {
      calculationError = error instanceof Error ? error.message : String(error);
      errors.push(calculationError);
    }
    return {
      ...member,
      carriedTargetJmd,
      wageBaseCny,
      wageBudgetCny: null,
      estimatedPayableCny: null,
      ...(calculationError ? { calculationError } : {}),
    };
  });

  const canCalculateTarget = ruleErrors.length === 0
    && input.members.length > 0
    && members.every((member) => member.carriedTargetJmd !== null);
  const teamTargetJmd = canCalculateTarget
    ? members.reduce((total, member) => total + (member.carriedTargetJmd ?? 0), 0)
    : null;
  const completionRate = teamTargetJmd === null || !hasActualPerformance || input.actualPerformanceJmd === null
    ? null
    : teamTargetJmd === 0
      ? null
      : input.actualPerformanceJmd / teamTargetJmd;

  if (teamTargetJmd === 0) errors.push("班组指标为 0，无法计算完成率");

  const calculatedMembers = members.map((member) => {
    if (member.wageBaseCny === null) return member;
    const wageBudgetCny = member.calculationKind === "joined_first_month"
      ? member.wageBaseCny
      : completionRate === null
        ? null
        : member.wageBaseCny * completionRate;
    return {
      ...member,
      wageBudgetCny,
      estimatedPayableCny: wageBudgetCny === null
        ? null
        : Math.max(input.rule.minimumPayableCny, wageBudgetCny),
    };
  });

  const payrollTotalCny = canCalculateTarget && hasActualPerformance && calculatedMembers.every(
    (member) => member.estimatedPayableCny !== null,
  )
    ? calculatedMembers.reduce((total, member) => total + (member.estimatedPayableCny ?? 0), 0)
    : null;

  return {
    teamId: input.teamId,
    teamName: input.teamName,
    month: input.month,
    status: input.status,
    actualPerformanceJmd: input.actualPerformanceJmd,
    teamTargetJmd,
    completionRate,
    payrollTotalCny,
    calculationErrors: errors,
    appliedRule: input.rule,
    members: calculatedMembers,
  };
}

export function previewSalaryChange(
  snapshot: TeamMonthSnapshot,
  memberId: string,
  newSalaryCny: number,
): SalaryChangeCalculation {
  if (snapshot.status === "locked") {
    throw new Error("月份已锁定，不能预览工资调整");
  }
  if (!Number.isFinite(newSalaryCny)) {
    throw new Error("新标准工资无效");
  }

  let memberFound = false;
  const members = snapshot.members.map((member): TeamMemberMonthInput => {
    if (member.memberId === memberId) memberFound = true;
    return {
      memberId: member.memberId,
      employeeNo: member.employeeNo,
      name: member.name,
      role: member.role,
      standardSalaryCny: member.memberId === memberId ? newSalaryCny : member.standardSalaryCny,
      calculationKind: member.calculationKind,
      ...(member.prorationRatio === undefined ? {} : { prorationRatio: member.prorationRatio }),
      ...(member.prorationBasis === undefined ? {} : { prorationBasis: member.prorationBasis }),
    };
  });
  if (!memberFound) throw new Error(`成员 ${memberId} 不存在`);

  const calculationInput: CalculateTeamMonthInput = {
    teamId: snapshot.teamId,
    teamName: snapshot.teamName,
    month: snapshot.month,
    status: snapshot.status,
    actualPerformanceJmd: snapshot.actualPerformanceJmd,
    members,
    rule: { ...snapshot.appliedRule },
  };
  return {
    input: {
      teamId: snapshot.teamId,
      memberId,
      month: snapshot.month,
      newSalaryCny,
    },
    changedMemberId: memberId,
    before: snapshot,
    after: calculateTeamMonth(calculationInput),
  };
}

export function buildHistoryComparisons(snapshots: TeamMonthSnapshot[]): PerformanceHistoryRow[] {
  const locked = snapshots
    .filter((snapshot) => snapshot.status === "locked")
    .slice()
    .sort((left, right) => left.month.localeCompare(right.month));

  return locked.map((snapshot, index) => {
    const earlierLocked = locked.slice(0, index);
    const previous = earlierLocked.at(-1);
    const currentValues = metricValues(snapshot);
    const previousMonthDelta = metricDelta(
      currentValues,
      previous === undefined ? null : metricValues(previous),
    );
    return {
      snapshot,
      previousMonthDelta,
      historicalAverage: averageMetrics(earlierLocked),
      comparisonStatus: {
        completion: comparisonStatus(previousMonthDelta.completionRate),
        actual: comparisonStatus(previousMonthDelta.actualPerformanceJmd),
        payroll: comparisonStatus(previousMonthDelta.payrollTotalCny),
      },
    };
  });
}
