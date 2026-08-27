import type { LinkedOperationsState } from "./mock-orders";
import {
  selectQuickOrderFinancialLedger,
  selectQuickOrderFinancialReadModel,
} from "./mock-quick-orders";
import type { PerformanceAccessContext } from "../performance/types";
import type { TeamDefinition } from "../teams/team-dictionary";
import type {
  DashboardMetricCard,
  DashboardPeriodRange,
  DashboardPeriodSummary,
  DashboardSummary,
} from "../types";

function jmd(value: number): string {
  return `JMD ${value.toLocaleString("en-US")}`;
}

function jamaicaDate(nowMs: number): { dateLabel: string; dateTime: string; monthLabel: string } {
  const date = new Date(nowMs);
  return {
    dateLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Jamaica",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date),
    dateTime: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Jamaica",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date),
    monthLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Jamaica",
      year: "numeric",
      month: "long",
    }).format(date),
  };
}

function jamaicaDayKey(value: number | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function periodStartKey(nowMs: number, range: DashboardPeriodRange): string {
  const today = jamaicaDayKey(nowMs);
  if (range === "day") return today;
  if (range === "month") return `${today.slice(0, 7)}-01`;
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start.toISOString().slice(0, 10);
}

/**
 * Pure dashboard projection. Every displayed count and amount comes from the
 * same current BO/payment/refund/parking state used by the operational pages.
 */
export function selectMockLiveDashboard(
  state: LinkedOperationsState,
  nowMs: number,
  access: PerformanceAccessContext = {
    actorId: "unit-superadmin",
    permissions: { canViewPerformance: true, canEditSalary: false, canManageRules: false },
  },
  teams: ReadonlyArray<TeamDefinition> = [],
): DashboardSummary {
  if (!access.permissions.canViewPerformance) throw new Error("无权查看经营概览");

  const ledger = selectQuickOrderFinancialLedger(state, nowMs);
  const financials = state.quickOrders.map((order) => (
    selectQuickOrderFinancialReadModel(state, order.id, nowMs)
  ));
  const active = financials.filter((item) => item.order.voidedAt === null);
  const submitted = active.filter((item) => item.order.status === "submitted");
  const stalled = active.filter((item) => item.order.status === "stalled");
  const paidNotPickedUp = active.filter((item) => (
    item.ledger.grossPaidJmd > 0 && item.order.pickedUpAt === null
  ));
  const dueOrders = active.filter((item) => item.ledger.balanceJmd > 0);
  const overpaidOrders = active.filter((item) => item.ledger.balanceJmd < 0);
  const openParking = state.parkingCases.filter((parking) => parking.pickupDate === undefined);
  const dates = jamaicaDate(nowMs);
  const periodDefinitions: ReadonlyArray<{ range: DashboardPeriodRange; label: string }> = [
    { range: "day", label: "今日" },
    { range: "week", label: "本周" },
    { range: "month", label: "本月" },
  ];
  const periods: DashboardPeriodSummary[] = periodDefinitions.map(({ range, label }) => {
    const startKey = periodStartKey(nowMs, range);
    const items = ledger.items.filter((item) => jamaicaDayKey(item.occurredAt) >= startKey);
    const grossPaidJmd = items.reduce((sum, item) => (
      sum + (item.kind === "payment" ? item.amountJmd : 0)
    ), 0);
    const cashRefundedJmd = items.reduce((sum, item) => (
      sum + (item.kind === "refund" ? item.cashRefundJmd : 0)
    ), 0);
    const orders = state.quickOrders.filter((order) => (
      order.voidedAt === null && jamaicaDayKey(order.createdAt) >= startKey
    ));
    return {
      range,
      label,
      grossPaidJmd,
      cashRefundedJmd,
      netPaidJmd: grossPaidJmd - cashRefundedJmd,
      businessOrderCount: orders.length,
      submittedOrderCount: state.quickOrders.filter((order) => (
        order.voidedAt === null
        && order.submittedAt !== null
        && jamaicaDayKey(order.submittedAt) >= startKey
      )).length,
    };
  });
  const today = periods[0]!;
  const todayStartKey = periodStartKey(nowMs, "day");
  const todayItems = ledger.items.filter((item) => jamaicaDayKey(item.occurredAt) >= todayStartKey);
  const paymentCount = todayItems.filter((item) => item.kind === "payment").length;
  const refundCount = todayItems.filter((item) => item.kind === "refund").length;

  const topCards: DashboardMetricCard[] = [
    {
      id: "today_revenue",
      href: "/revenue?range=week",
      title: "今日营业收入",
      subtitle: "今日逐笔收款 − 今日逐笔现金退款",
      value: today.netPaidJmd,
      valuePrefix: "JMD ",
      breakdownItems: [
        { label: "今日收款", value: jmd(today.grossPaidJmd) },
        { label: "今日现金退款", value: jmd(today.cashRefundedJmd) },
      ],
      footerItems: [
        { label: "收款记录", value: `${paymentCount} 笔` },
        { label: "退款记录", value: `${refundCount} 笔` },
      ],
      size: "large",
      icon: "Banknote",
      iconColor: "#10b981",
      iconBg: "#ecfdf5",
      tone: "green",
    },
    {
      id: "accounts_receivable",
      href: "/payments",
      title: "应收账款",
      subtitle: "当前有效 Business Order 的未结余额",
      value: ledger.totals.activeBalanceJmd,
      valuePrefix: "JMD ",
      footerItems: [
        { label: "待收 Business Order", value: `${dueOrders.length} 单` },
        { label: "当前应收", value: jmd(ledger.totals.activeReceivableJmd) },
        { label: "计算来源", value: "Business Order 与逐笔收退款" },
      ],
      size: "medium",
      icon: "CreditCard",
      iconColor: "#ef4444",
      iconBg: "#fef2f2",
      tone: "rose",
    },
    {
      id: "vehicles_today",
      href: "/orders/business",
      title: "接车数量",
      subtitle: "今日新增 Business Order",
      value: today.businessOrderCount,
      valueSuffix: "单",
      size: "small",
      icon: "Car",
      iconColor: "#3b82f6",
      iconBg: "#eff6ff",
      tone: "blue",
    },
    {
      id: "vehicles_stuck",
      href: "/orders/business",
      title: "在厂车辆滞留预警",
      subtitle: "当前停滞或等待处理",
      value: stalled.length,
      valueSuffix: "单",
      size: "small",
      icon: "AlertTriangle",
      iconColor: "#ef4444",
      iconBg: "#fef2f2",
      tone: "rose",
    },
  ];

  const bottomCards: DashboardMetricCard[] = [
    {
      id: "completed_labor",
      href: "/orders/business",
      title: "完工工时产值与绩效",
      subtitle: "本月正式交单记录",
      value: periods[2]!.submittedOrderCount,
      valueSuffix: "单",
      footerItems: [
        { label: "全部有效 Business Order", value: `${active.length} 单` },
        { label: "尚未交单", value: `${active.length - submitted.length} 单` },
      ],
      size: "small",
      icon: "Wrench",
      iconColor: "#7a5af8",
      iconBg: "#f4f0ff",
      tone: "purple",
    },
    {
      id: "prepaid_incomplete",
      href: "/payments",
      title: "预收未完工订单",
      subtitle: "已有收款且尚未记录取车",
      value: paidNotPickedUp.length,
      valueSuffix: "单",
      footerItems: [
        { label: "累计收款", value: jmd(ledger.totals.grossPaidJmd) },
        { label: "累计现金退款", value: jmd(ledger.totals.cashRefundedJmd) },
      ],
      size: "small",
      icon: "Package",
      iconColor: "#0ea5e9",
      iconBg: "#f0f9ff",
      tone: "amber",
    },
    {
      id: "internal_tasks",
      href: "/parking",
      title: "内部协同事项",
      subtitle: "尚未完成实际取车",
      value: openParking.length,
      valueSuffix: "项",
      footerItems: [
        { label: "全部停车记录", value: `${state.parkingCases.length} 项` },
        { label: "已完成", value: `${state.parkingCases.length - openParking.length} 项` },
      ],
      size: "small",
      icon: "Users",
      iconColor: "#f59e0b",
      iconBg: "#fffbeb",
      tone: "amber",
    },
    {
      id: "risk_alerts",
      href: "/payments",
      title: "运营风险提醒",
      subtitle: "由现有记录实时计算",
      value: dueOrders.length + stalled.length + openParking.length + overpaidOrders.length,
      valueSuffix: "项",
      footerItems: [
        { label: "待收 Business Order", value: `${dueOrders.length} 项` },
        { label: "停滞 Business Order", value: `${stalled.length} 项` },
        { label: "多收款 Business Order", value: `${overpaidOrders.length} 项` },
      ],
      size: "small",
      icon: "ShieldAlert",
      iconColor: "#ef4444",
      iconBg: "#fef2f2",
      tone: "rose",
    },
  ];

  return {
    header: {
      breadcrumb: "门店经营 · 实时数据",
      title: "经营概览",
      subtitle: "每日、每周、每月汇总当前 Business Order、逐笔收款、逐笔退款与停车记录；新增或修改记录后立即重算。",
      dateLabel: dates.dateLabel,
      dateTime: dates.dateTime,
      targetStatus: "not_configured",
      targetCompletionRate: null,
      targetCompletedAmount: 0,
      targetTotalAmount: null,
    },
    teamPerformance: {
      title: "维修班组与绩效",
      dateRange: dates.monthLabel,
      hint: "班组和员工由超级管理员维护，新增后这里显示绩效。",
      actionText: "查看绩效",
      teams: teams.map((team, index) => ({
        id: team.id,
        name: team.name,
        targetStatus: "not_configured",
        completionRate: null,
        currentAmount: 0,
        targetAmount: null,
        color: ["#465fff", "#10b981", "#f59e0b", "#8b5cf6"][index % 4]!,
      })),
    },
    periods,
    topCards,
    bottomCards,
  };
}
