import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";

export type MonthlyPerformanceHandoff = {
  id: number;
  businessOrderId: number;
  orderNo: string;
  repairRoundNo: number;
  teamId: number;
  teamName: string;
  performanceMinor: number;
  handedOffAt: Date;
  plateDisplay: string;
};

export type MonthlyTeamPerformance = {
  teamId: number;
  teamName: string;
  handoffCount: number;
  cancelledHandoffCount: number;
  performanceMinor: number;
  targetStatus: "not_configured";
  targetPerformanceMinor: null;
  completionRate: null;
};

export type MonthlyPerformanceResult = {
  month: string;
  totalPerformanceMinor: number;
  cancelledHandoffCount: number;
  targetStatus: "not_configured";
  targetPerformanceMinor: null;
  completionRate: null;
  teams: MonthlyTeamPerformance[];
  handoffs: MonthlyPerformanceHandoff[];
};

export class PerformanceValidationError extends Error {
  readonly status = 422;
  readonly code = "performance_validation";

  constructor(message: string) {
    super(message);
    this.name = "PerformanceValidationError";
  }
}

export class PerformanceReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "performance_read_denied";

  constructor() {
    super("当前账号不能查看 PC 绩效统计");
    this.name = "PerformanceReadDeniedError";
  }
}

type PerformanceHandoffRow = {
  id: number;
  business_order_id: number;
  order_no: string;
  repair_round_no: number;
  team_id: number;
  team_name: string;
  performance_minor: number;
  handed_off_at: Date;
  plate_display: string;
};

type PerformanceTeamRow = {
  id: number;
  name: string;
};

type CountRow = {
  team_id: number;
  count: number | string;
};

export class PerformanceService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async getMonthlyPerformance(input: {
    month: string;
    viewerAccountId: number;
  }): Promise<MonthlyPerformanceResult> {
    const month = normalizeMonth(input.month);
    await requirePcReader(this.database, input.viewerAccountId);
    const [rows, teamRows, cancellationRows] = await Promise.all([
      this.database.query<PerformanceHandoffRow>(
      `select handoff.id, handoff.business_order_id, business_order.order_no,
              handoff.repair_round_no, handoff.team_id,
              repair_team.name as team_name, handoff.performance_minor,
              handoff.handed_off_at, vehicle.plate_display
       from formal_handoffs as handoff
       join business_orders as business_order
         on business_order.id = handoff.business_order_id
       join vehicles as vehicle on vehicle.id = business_order.vehicle_id
       join repair_teams as repair_team on repair_team.id = handoff.team_id
       left join formal_handoff_cancellations as cancellation
         on cancellation.formal_handoff_id = handoff.id
       where handoff.jamaica_month = $1::date
         and cancellation.id is null
      order by handoff.handed_off_at, handoff.id`,
      [`${month}-01`],
      ),
      this.database.query<PerformanceTeamRow>(
        `select id, name
         from repair_teams
         where is_active = true
         order by name, id`,
      ),
      this.database.query<CountRow>(
        `select handoff.team_id, count(*) as count
         from formal_handoff_cancellations as cancellation
         join formal_handoffs as handoff on handoff.id = cancellation.formal_handoff_id
         where cancellation.jamaica_month = $1::date
         group by handoff.team_id`,
        [`${month}-01`],
      ),
    ]);
    const handoffs = rows.map((row) => ({
      id: Number(row.id),
      businessOrderId: Number(row.business_order_id),
      orderNo: row.order_no,
      repairRoundNo: row.repair_round_no,
      teamId: Number(row.team_id),
      teamName: row.team_name,
      performanceMinor: Number(row.performance_minor),
      handedOffAt: new Date(row.handed_off_at),
      plateDisplay: row.plate_display,
    }));
    const byTeam = new Map<number, MonthlyTeamPerformance>(teamRows.map((team) => [
      Number(team.id),
      {
        teamId: Number(team.id),
        teamName: team.name,
        handoffCount: 0,
        cancelledHandoffCount: 0,
        performanceMinor: 0,
        targetStatus: "not_configured",
        targetPerformanceMinor: null,
        completionRate: null,
      },
    ]));
    for (const handoff of handoffs) {
      const current = byTeam.get(handoff.teamId);
      if (current) {
        current.handoffCount += 1;
        current.performanceMinor += handoff.performanceMinor;
      } else {
        byTeam.set(handoff.teamId, {
          teamId: handoff.teamId,
          teamName: handoff.teamName,
          handoffCount: 1,
          cancelledHandoffCount: 0,
          performanceMinor: handoff.performanceMinor,
          targetStatus: "not_configured",
          targetPerformanceMinor: null,
          completionRate: null,
        });
      }
    }
    const teams = [...byTeam.values()].sort((left, right) =>
      left.teamName.localeCompare(right.teamName, "zh-CN"));
    for (const row of cancellationRows) {
      const team = byTeam.get(Number(row.team_id));
      if (team) team.cancelledHandoffCount = Number(row.count);
    }
    return {
      month,
      totalPerformanceMinor: handoffs.reduce(
        (total, handoff) => total + handoff.performanceMinor,
        0,
      ),
      cancelledHandoffCount: cancellationRows.reduce((total, row) => total + Number(row.count), 0),
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      completionRate: null,
      teams,
      handoffs,
    };
  }
}

function normalizeMonth(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!match) throw new PerformanceValidationError("月份格式必须为 YYYY-MM");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 9999 || month < 1 || month > 12) {
    throw new PerformanceValidationError("月份无效");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

async function requirePcReader(database: AuthSqlDatabase, accountId: number) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    throw new PerformanceReadDeniedError();
  }
  const rows = await database.query<{ id: number }>(
    `select id from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new PerformanceReadDeniedError();
}
