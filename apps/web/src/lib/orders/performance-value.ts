import { ORDER_TEAMS } from "./types";
import { loadTeams } from "../teams/team-dictionary";
import type {
  BusinessOrder,
  OrdersPerformanceSummary,
  TeamOrdersPerformanceSummary,
} from "./business-order-types";
import type { QuickOrder } from "./quick-order-types";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPerformanceSummaryMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负安全整数`);
}

/**
 * 整单绩效值默认值 = 已确认工时费合计（1:1）。
 * 绩效值是独立指标，默认与工时一样多，可人工调整（8/18 老板定）。
 * 0.25（提成比例）只用于算应结工资，不在这里。
 * 纯函数：只读已确认项目的 chargeLines，不碰执行/财务状态。
 */
export function computeDefaultPerformanceValue(
  order: Pick<BusinessOrder, "items">,
): number {
  let laborJmd = 0;
  for (const item of order.items) {
    for (const line of item.chargeLines) {
      if (line.category !== "labor") continue;
      const amount = line.unitPriceJmd * line.quantity;
      assertMoney(amount, "工时费金额");
      laborJmd += amount;
      assertMoney(laborJmd, "工时费合计");
    }
  }
  return laborJmd;
}

type MutableTeamSummary = {
  -readonly [K in keyof TeamOrdersPerformanceSummary]: TeamOrdersPerformanceSummary[K];
};

function emptyTeamSummary(teamId: TeamOrdersPerformanceSummary["teamId"]): MutableTeamSummary {
  const team = ORDER_TEAMS.find((candidate) => candidate.id === teamId);
  return {
    teamId,
    teamName: team?.name ?? teamId,
    countedOrderCount: 0,
    countedValueJmd: 0,
    pendingOrderCount: 0,
    pendingValueJmd: 0,
  };
}

/**
 * 绩效页汇总：已计入 = performanceCountedAt 落在查询月份内的工单；
 * 待计入 = 当前 performanceCountedAt 仍为 null 的工单（不限月份）。
 * 金额口径为"已正式交单绩效值"，归属班组取工单当前负责班组，不涉及个人。
 */
export function summarizeBusinessOrderPerformance(
  orders: ReadonlyArray<Pick<BusinessOrder, "executionTeamId" | "performanceValueJmd" | "performanceCountedAt">>,
  month: string,
): OrdersPerformanceSummary {
  if (!isPerformanceSummaryMonth(month)) throw new Error("汇总月份格式无效");
  const byTeam = ORDER_TEAMS.map((team) => emptyTeamSummary(team.id));
  let countedOrderCount = 0;
  let countedValueJmd = 0;
  let pendingOrderCount = 0;
  let pendingValueJmd = 0;
  for (const order of orders) {
    assertMoney(order.performanceValueJmd, "整单绩效值");
    const teamSummary = byTeam.find((candidate) => candidate.teamId === order.executionTeamId)
      ?? emptyTeamSummary(order.executionTeamId);
    if (!byTeam.includes(teamSummary)) byTeam.push(teamSummary);
    const counted = order.performanceCountedAt !== null
      && order.performanceCountedAt.slice(0, 7) === month;
    if (order.performanceCountedAt === null) {
      pendingOrderCount += 1;
      pendingValueJmd += order.performanceValueJmd;
      teamSummary.pendingOrderCount += 1;
      teamSummary.pendingValueJmd += order.performanceValueJmd;
    } else if (counted) {
      countedOrderCount += 1;
      countedValueJmd += order.performanceValueJmd;
      teamSummary.countedOrderCount += 1;
      teamSummary.countedValueJmd += order.performanceValueJmd;
    }
  }
  return {
    month,
    counted: { orderCount: countedOrderCount, totalValueJmd: countedValueJmd },
    pending: { orderCount: pendingOrderCount, totalValueJmd: pendingValueJmd },
    byTeam,
  };
}

/**
 * 新 BO（快速工单）绩效汇总：
 * 已计入 = submittedAt 落在查询月份内（交单时间决定归属月，8/16 定）；
 * 待计入 = 尚未交单（不限月份）；归属班组取当前 teamId，未派组的不归入任何班组桶。
 */
export function summarizeQuickOrderPerformance(
  orders: ReadonlyArray<Pick<QuickOrder, "teamId" | "performanceValueJmd" | "submittedAt" | "orderKind" | "voidedAt"> & Partial<Pick<QuickOrder, "statusHistory">>>,
  month: string,
): OrdersPerformanceSummary {
  if (!isPerformanceSummaryMonth(month)) throw new Error("汇总月份格式无效");
  // 班组来自字典（8/20 老板：后期可加班组/改班组名）
  const byTeam = loadTeams().map((team) => emptyTeamSummary(team.id));
  let countedOrderCount = 0;
  let countedValueJmd = 0;
  let pendingOrderCount = 0;
  let pendingValueJmd = 0;
  for (const order of orders) {
    // 废除单：所有数据无效、不参与任何计算（2026-08-18 老板）
    if (order.voidedAt !== null) continue;
    // 旧演示结构中的售后单不计；新规则的售后直接在原 Business Order 内追加交单轮次。
    if (order.orderKind === "aftersales") continue;
    if (!Number.isSafeInteger(order.performanceValueJmd)) throw new Error("整单绩效值必须为安全整数");
    const submissionFacts = (order.statusHistory ?? []).filter((event) => (
      event.to === "submitted"
      && event.cancelledAt === undefined
      && event.teamId !== undefined
      && event.teamId !== null
      && event.performanceValueJmd !== undefined
    ));
    if (submissionFacts.length > 0) {
      for (const fact of submissionFacts) {
        if (fact.at.slice(0, 7) !== month || fact.teamId === null || fact.teamId === undefined) continue;
        if (!Number.isSafeInteger(fact.performanceValueJmd)) throw new Error("交单轮次绩效值必须为安全整数");
        const teamSummary = byTeam.find((candidate) => candidate.teamId === fact.teamId) ?? emptyTeamSummary(fact.teamId);
        if (!byTeam.includes(teamSummary)) byTeam.push(teamSummary);
        countedOrderCount += 1;
        countedValueJmd += fact.performanceValueJmd ?? 0;
        teamSummary.countedOrderCount += 1;
        teamSummary.countedValueJmd += fact.performanceValueJmd ?? 0;
      }
      // 已开始下一轮但尚未交单时，当前轮次继续显示为待计入。
      if (order.submittedAt === null && order.teamId !== null) {
        const teamSummary = byTeam.find((candidate) => candidate.teamId === order.teamId) ?? emptyTeamSummary(order.teamId);
        if (!byTeam.includes(teamSummary)) byTeam.push(teamSummary);
        pendingOrderCount += 1;
        pendingValueJmd += order.performanceValueJmd;
        teamSummary.pendingOrderCount += 1;
        teamSummary.pendingValueJmd += order.performanceValueJmd;
      }
      continue;
    }
    if (order.teamId === null) continue;
    const teamSummary = order.teamId
      ? byTeam.find((candidate) => candidate.teamId === order.teamId) ?? emptyTeamSummary(order.teamId)
      : null;
    if (teamSummary && !byTeam.includes(teamSummary)) byTeam.push(teamSummary);
    if (order.submittedAt === null) {
      pendingOrderCount += 1;
      pendingValueJmd += order.performanceValueJmd;
      if (teamSummary) {
        teamSummary.pendingOrderCount += 1;
        teamSummary.pendingValueJmd += order.performanceValueJmd;
      }
    } else if (order.submittedAt.slice(0, 7) === month) {
      countedOrderCount += 1;
      countedValueJmd += order.performanceValueJmd;
      if (teamSummary) {
        teamSummary.countedOrderCount += 1;
        teamSummary.countedValueJmd += order.performanceValueJmd;
      }
    }
  }
  return {
    month,
    counted: { orderCount: countedOrderCount, totalValueJmd: countedValueJmd },
    pending: { orderCount: pendingOrderCount, totalValueJmd: pendingValueJmd },
    byTeam,
  };
}
