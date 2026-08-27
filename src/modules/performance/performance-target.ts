import type { AuthSqlExecutor } from "@formal/modules/auth/session-repository";

export type PerformanceTargetStatus = "configured" | "not_configured";

export type PerformanceTargetMember = {
  teamId: number;
  teamName: string;
  memberId: number;
  memberName: string;
  salaryCnyMinor: number | null;
};

export type TeamPerformanceTarget = {
  teamId: number;
  teamName: string;
  targetStatus: PerformanceTargetStatus;
  targetPerformanceMinor: number | null;
  targetMissingReasons: string[];
};

export type PerformanceTargetResult = {
  targetStatus: PerformanceTargetStatus;
  targetPerformanceMinor: number | null;
  targetMissingReasons: string[];
  teams: TeamPerformanceTarget[];
};

type PayrollParameterRow = {
  commission_rate: string;
  cny_to_jmd_rate: string;
};

type TeamCommissionRateRow = {
  team_id: number;
  commission_rate: string | null;
};

type PerformanceTargetMemberRow = {
  team_id: number;
  team_name: string;
  member_id: number;
  member_name: string;
  salary_cny_minor: number | null;
};

export async function readPerformanceTargets(
  database: AuthSqlExecutor,
  month: string,
): Promise<PerformanceTargetResult> {
  const [parameterRows, teamCommissionRateRows, memberRows] = await Promise.all([
    database.query<PayrollParameterRow>(
      `select commission_rate::text, cny_to_jmd_rate::text
       from payroll_parameter_versions
       where effective_month <= $1::date
       order by effective_month desc
       limit 1`,
      [`${month}-01`],
    ),
    database.query<TeamCommissionRateRow>(
      `select distinct on (team_id) team_id, commission_rate::text
       from team_commission_rate_versions
       where effective_month <= $1::date
       order by team_id, effective_month desc`,
      [`${month}-01`],
    ),
    database.query<PerformanceTargetMemberRow>(
      `select assignment.team_id, team.name as team_name,
              member.id as member_id, member.full_name as member_name,
              salary.base_salary_cny_minor as salary_cny_minor
       from staff_members as member
       join lateral (
         select version.team_id
         from staff_team_assignment_versions as version
         where version.staff_member_id = member.id
           and version.effective_month <= $1::date
         order by version.effective_month desc
         limit 1
       ) as assignment on true
       join repair_teams as team on team.id = assignment.team_id
       left join lateral (
         select version.base_salary_cny_minor
         from employee_salary_versions as version
         where version.staff_member_id = member.id
           and version.effective_month <= $1::date
         order by version.effective_month desc
         limit 1
       ) as salary on true
       where member.hired_on < ($1::date + interval '1 month')::date
         and (member.left_on is null or member.left_on >= $1::date)
       order by assignment.team_id, member.id`,
      [`${month}-01`],
    ),
  ]);
  const parameter = parameterRows[0];
  const teamCommissionRates = Object.fromEntries(
    teamCommissionRateRows
      .filter((row) => row.commission_rate !== null)
      .map((row) => [Number(row.team_id), Number(row.commission_rate)]),
  );
  return calculatePerformanceTargets({
    month,
    commissionRate: parameter ? Number(parameter.commission_rate) : null,
    cnyToJmdRate: parameter ? Number(parameter.cny_to_jmd_rate) : null,
    teamCommissionRates,
    members: memberRows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      memberId: Number(row.member_id),
      memberName: row.member_name,
      salaryCnyMinor: row.salary_cny_minor === null
        ? null
        : Number(row.salary_cny_minor),
    })),
  });
}

export function calculateCompletionRate(
  actualPerformanceMinor: number,
  targetPerformanceMinor: number,
): number | null {
  if (targetPerformanceMinor <= 0) return null;
  return Math.round(actualPerformanceMinor / targetPerformanceMinor * 10_000) / 100;
}

export function calculatePerformanceTargets(input: {
  month: string;
  commissionRate: number | null;
  cnyToJmdRate: number | null;
  teamCommissionRates?: Readonly<Record<number, number>>;
  members: PerformanceTargetMember[];
}): PerformanceTargetResult {
  const parameterMissing = input.commissionRate === null
    || input.cnyToJmdRate === null
    || !Number.isFinite(input.commissionRate)
    || !Number.isFinite(input.cnyToJmdRate)
    || input.commissionRate <= 0
    || input.cnyToJmdRate <= 0;
  const parameterReason = `缺少 ${input.month} 绩效参数`;
  const groupedMembers = new Map<number, PerformanceTargetMember[]>();
  for (const member of input.members) {
    const group = groupedMembers.get(member.teamId) ?? [];
    group.push(member);
    groupedMembers.set(member.teamId, group);
  }

  const teams = [...groupedMembers.entries()]
    .map(([teamId, members]) => {
      const teamName = members[0]?.teamName ?? String(teamId);
      if (parameterMissing) {
        return {
          teamId,
          teamName,
          targetStatus: "not_configured" as const,
          targetPerformanceMinor: null,
          targetMissingReasons: [parameterReason],
        };
      }
      const missingReasons = members
        .filter((member) => member.salaryCnyMinor === null)
        .map((member) => `${teamName}：${member.memberName}缺少月标准工资`);
      if (missingReasons.length > 0) {
        return {
          teamId,
          teamName,
          targetStatus: "not_configured" as const,
          targetPerformanceMinor: null,
          targetMissingReasons: missingReasons,
        };
      }
      const targetPerformanceMinor = members.reduce((sum, member) => {
        const salary = member.salaryCnyMinor!;
        const commissionRate = input.teamCommissionRates?.[teamId]
          ?? input.commissionRate!;
        if (!Number.isSafeInteger(salary) || salary < 0) {
          throw new RangeError(`${teamName}：${member.memberName}月标准工资无效`);
        }
        return sum + Math.round(salary / commissionRate * input.cnyToJmdRate!);
      }, 0);
      if (!Number.isSafeInteger(targetPerformanceMinor)) {
        throw new RangeError(`${teamName}绩效目标超出安全范围`);
      }
      return {
        teamId,
        teamName,
        targetStatus: "configured" as const,
        targetPerformanceMinor,
        targetMissingReasons: [],
      };
    })
    .sort((left, right) => left.teamId - right.teamId);

  const targetMissingReasons = [...new Set(teams.flatMap((team) => team.targetMissingReasons))];
  const targetStatus = parameterMissing || targetMissingReasons.length > 0
    ? "not_configured"
    : "configured";
  return {
    targetStatus,
    targetPerformanceMinor: targetStatus === "configured"
      ? teams.reduce((sum, team) => sum + (team.targetPerformanceMinor ?? 0), 0)
      : null,
    targetMissingReasons: parameterMissing && teams.length === 0
      ? [parameterReason]
      : targetMissingReasons,
    teams,
  };
}
