import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import {
  calculateCompletionRate,
  readPerformanceTargets,
  type PerformanceTargetResult,
} from "@formal/modules/performance/performance-target";

type OrderLedgerRow = {
  id: number;
  status: string;
  created_at: Date;
  total_due_minor: number;
  total_paid_minor: number;
  total_refunded_minor: number;
};
type TransactionRow = { kind: "payment" | "refund"; amount_minor: number; occurred_at: Date };
type HandoffRow = { handed_off_at: Date };
type TeamRow = { id: number; name: string; performance_minor: number };

export class DashboardReadDeniedError extends Error {
  readonly status = 403;
  constructor() {
    super("当前账号不能查看经营概览");
    this.name = "DashboardReadDeniedError";
  }
}

export class DashboardService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async getSummary(input: { viewerAccountId: number; now?: Date }) {
    const now = input.now ?? new Date();
    const month = jamaicaMonth(now);
    return this.database.transaction(async (snapshot) => {
      await snapshot.query("set transaction isolation level repeatable read read only");
      await requireReader(snapshot, input.viewerAccountId);
      const [orders, transactions, handoffs, teams, targets] = await Promise.all([
        snapshot.query<OrderLedgerRow>(
        `select business_order.id, business_order.status, business_order.created_at,
                coalesce(charge.total_due_minor, 0)::bigint as total_due_minor,
                coalesce(payment.total_paid_minor, 0)::bigint as total_paid_minor,
                coalesce(refund.total_refunded_minor, 0)::bigint as total_refunded_minor
         from business_orders as business_order
         left join business_order_charge_versions as charge
           on charge.business_order_id = business_order.id
          and charge.version_no = business_order.current_charge_version_no
         left join lateral (
           select coalesce(sum(amount_minor), 0)::bigint as total_paid_minor
           from business_order_payments
           where business_order_id = business_order.id and paid_at <= $1
         ) as payment on true
         left join lateral (
           select coalesce(sum(amount_minor), 0)::bigint as total_refunded_minor
           from business_order_refunds
           where business_order_id = business_order.id and refunded_at <= $1
         ) as refund on true
         where business_order.voided_at is null and business_order.created_at <= $1
         order by business_order.created_at, business_order.id`,
          [now],
        ),
        snapshot.query<TransactionRow>(
        `select 'payment'::text as kind, payment.amount_minor,
                payment.paid_at as occurred_at
         from business_order_payments as payment
         join business_orders as business_order
           on business_order.id = payment.business_order_id
         where business_order.voided_at is null and payment.paid_at <= $1
         union all
         select 'refund'::text as kind, refund.amount_minor,
                refund.refunded_at as occurred_at
         from business_order_refunds as refund
         join business_orders as business_order
           on business_order.id = refund.business_order_id
         where business_order.voided_at is null and refund.refunded_at <= $1
         order by occurred_at`,
          [now],
        ),
        snapshot.query<HandoffRow>(
        `select handoff.handed_off_at
         from formal_handoffs as handoff
         join business_orders as business_order
           on business_order.id = handoff.business_order_id
         where business_order.voided_at is null
           and handoff.handed_off_at <= $1
           and not exists (
             select 1 from formal_handoff_cancellations as cancellation
             where cancellation.formal_handoff_id = handoff.id
           )`,
          [now],
        ),
        snapshot.query<TeamRow>(
        `select team.id, team.name,
                coalesce(sum(handoff.performance_minor), 0)::bigint as performance_minor
         from repair_teams as team
         left join formal_handoffs as handoff
           on handoff.team_id = team.id
          and handoff.jamaica_month = $1::date
          and handoff.handed_off_at <= $2
          and exists (
            select 1 from business_orders as business_order
            where business_order.id = handoff.business_order_id
              and business_order.voided_at is null
          )
          and not exists (
            select 1 from formal_handoff_cancellations as cancellation
            where cancellation.formal_handoff_id = handoff.id
          )
         where team.is_active = true or handoff.id is not null
         group by team.id, team.name
         order by team.name, team.id`,
          [`${month}-01`, now],
        ),
        readPerformanceTargets(snapshot, month),
      ]);
      return projectDashboard({ now, orders, transactions, handoffs, teams, targets });
    });
  }
}

function projectDashboard(input: {
  now: Date;
  orders: OrderLedgerRow[];
  transactions: TransactionRow[];
  handoffs: HandoffRow[];
  teams: TeamRow[];
  targets: PerformanceTargetResult;
}) {
  const month = jamaicaMonth(input.now);
  const periods = (["day", "week", "month"] as const).map((range) => {
    const start = periodStart(input.now, range);
    const transactionRows = input.transactions.filter((row) => (
      row.occurred_at >= start && row.occurred_at <= input.now
    ));
    const paidMinor = transactionRows
      .filter((row) => row.kind === "payment")
      .reduce((sum, row) => sum + Number(row.amount_minor), 0);
    const refundedMinor = transactionRows
      .filter((row) => row.kind === "refund")
      .reduce((sum, row) => sum + Number(row.amount_minor), 0);
    return {
      range,
      label: range === "day" ? "今日" : range === "week" ? "本周" : "本月",
      grossPaidJmd: toJmd(paidMinor),
      cashRefundedJmd: toJmd(refundedMinor),
      netPaidJmd: toJmd(paidMinor - refundedMinor),
      businessOrderCount: input.orders.filter((order) => (
        order.created_at >= start && order.created_at <= input.now
      )).length,
      submittedOrderCount: input.handoffs.filter((handoff) => (
        handoff.handed_off_at >= start && handoff.handed_off_at <= input.now
      )).length,
    };
  });
  const today = periods[0]!;
  const receivableOrders = input.orders.filter((order) => (
    order.status === "formally_handed_off"
    || Number(order.total_paid_minor) > 0
    || Number(order.total_refunded_minor) > 0
  ));
  const currentReceivableMinor = receivableOrders.reduce((sum, order) => sum + Number(order.total_due_minor), 0);
  const currentBalanceMinor = receivableOrders.reduce((sum, order) => (
    sum + Number(order.total_due_minor) - Number(order.total_paid_minor) + Number(order.total_refunded_minor)
  ), 0);
  const dueOrders = receivableOrders.filter((order) => (
    Number(order.total_due_minor) - Number(order.total_paid_minor) + Number(order.total_refunded_minor) > 0
  ));
  const overpaidOrders = receivableOrders.filter((order) => (
    Number(order.total_due_minor) - Number(order.total_paid_minor) + Number(order.total_refunded_minor) < 0
  ));
  const activeRepairOrders = input.orders.filter((order) => order.status !== "formally_handed_off");
  const pendingReviewOrders = activeRepairOrders.filter((order) => (
    order.status === "return_pending_review"
  ));
  const monthHandoffCount = periods[2]!.submittedOrderCount;
  const date = jamaicaDate(input.now);
  const currentMonthPerformanceMinor = input.teams.reduce(
    (sum, team) => sum + Number(team.performance_minor),
    0,
  );
  const jmd = (minor: number) => `JMD ${toJmd(minor).toLocaleString("en-US")}`;
  const common = {
    header: {
      breadcrumb: "门店经营 · 实时数据",
      title: "经营概览",
      subtitle: "每日、每周、每月汇总正式 Business Order、逐笔收款、逐笔退款与绩效事实；新增或修改后立即重算。",
      dateLabel: date.dateLabel,
      dateTime: date.dateTime,
      targetStatus: input.targets.targetStatus,
      targetCompletionRate: input.targets.targetStatus === "configured"
        ? calculateCompletionRate(
          currentMonthPerformanceMinor,
          input.targets.targetPerformanceMinor ?? 0,
        )
        : null,
      targetCompletedAmount: toJmd(currentMonthPerformanceMinor),
      targetTotalAmount: input.targets.targetPerformanceMinor === null
        ? null
        : toJmd(input.targets.targetPerformanceMinor),
      targetMissingReasons: input.targets.targetMissingReasons,
    },
    teamPerformance: {
      title: "维修班组与绩效",
      dateRange: date.monthLabel,
      hint: "目标按员工月标准工资、工时费提成比例和汇率自动计算。",
      actionText: "查看绩效",
      teams: input.teams.map((team, index) => {
        const target = dashboardTeamTarget(input.targets, month, Number(team.id));
        const performanceMinor = Number(team.performance_minor);
        return {
          id: String(team.id),
          name: team.name,
          targetStatus: target.targetStatus,
          completionRate: target.targetStatus === "configured"
            ? calculateCompletionRate(performanceMinor, target.targetPerformanceMinor ?? 0)
            : null,
          currentAmount: toJmd(performanceMinor),
          targetAmount: target.targetPerformanceMinor === null
            ? null
            : toJmd(target.targetPerformanceMinor),
          targetMissingReasons: target.targetMissingReasons,
          color: ["#465fff", "#10b981", "#f59e0b", "#8b5cf6"][index % 4]!,
        };
      }),
    },
    periods,
  };
  return {
    ...common,
    topCards: [{
      id: "today_revenue", href: "/revenue?range=day", title: "今日营业收入",
      subtitle: "今日逐笔收款 − 今日逐笔退款", value: today.netPaidJmd,
      valuePrefix: "JMD ", breakdownItems: [
        { label: "今日收款", value: jmd(today.grossPaidJmd * 100) },
        { label: "今日退款", value: jmd(today.cashRefundedJmd * 100) },
      ], footerItems: [
        { label: "收款记录", value: `${input.transactions.filter((row) => row.kind === "payment" && row.occurred_at >= periodStart(input.now, "day") && row.occurred_at <= input.now).length} 笔` },
        { label: "退款记录", value: `${input.transactions.filter((row) => row.kind === "refund" && row.occurred_at >= periodStart(input.now, "day") && row.occurred_at <= input.now).length} 笔` },
      ], size: "large", icon: "Banknote", iconColor: "#10b981", iconBg: "#ecfdf5", tone: "green",
    }, {
      id: "accounts_receivable", href: "/payments", title: "应收账款",
      subtitle: "当前正式 Business Order 的未结余额", value: toJmd(currentBalanceMinor),
      valuePrefix: "JMD ", footerItems: [
        { label: "待收 Business Order", value: `${dueOrders.length} 单` },
        { label: "当前应收", value: jmd(currentReceivableMinor) },
        { label: "计算来源", value: "正式 Business Order 与逐笔收退款" },
      ], size: "medium", icon: "CreditCard", iconColor: "#ef4444", iconBg: "#fef2f2", tone: "rose",
    }, {
      id: "vehicles_today", href: "/orders/business", title: "接车数量",
      subtitle: "今日新增 Business Order", value: today.businessOrderCount, valueSuffix: "单",
      size: "small", icon: "Car", iconColor: "#3b82f6", iconBg: "#eff6ff", tone: "blue",
    }, {
      id: "vehicles_stuck", href: "/orders/business", title: "在厂业务单",
      subtitle: "当前未正式交单的 Business Order", value: activeRepairOrders.length, valueSuffix: "单",
      footerItems: [
        { label: "待审核回单", value: `${pendingReviewOrders.length} 单` },
        { label: "口径", value: "不含已正式交单" },
      ],
      size: "small", icon: "AlertTriangle", iconColor: "#ef4444", iconBg: "#fef2f2", tone: "rose",
    }],
    bottomCards: [{
      id: "completed_labor", href: "/performance", title: "完工工时产值与绩效",
      subtitle: "本月有效正式交单记录", value: monthHandoffCount, valueSuffix: "单",
      footerItems: [
        { label: "本月班组绩效", value: jmd(currentMonthPerformanceMinor) },
        { label: "有效 Business Order", value: `${input.orders.length} 单` },
      ], size: "small", icon: "Wrench", iconColor: "#7a5af8", iconBg: "#f4f0ff", tone: "purple",
    }, {
      id: "prepaid_incomplete", href: "/payments", title: "预收未完工订单",
      subtitle: "已有收款且尚未正式交单", value: input.orders.filter((order) => Number(order.total_paid_minor) > 0 && order.status !== "formally_handed_off").length,
      valueSuffix: "单", footerItems: [
        { label: "累计收款", value: jmd(input.orders.reduce((sum, order) => sum + Number(order.total_paid_minor), 0)) },
        { label: "累计退款", value: jmd(input.orders.reduce((sum, order) => sum + Number(order.total_refunded_minor), 0)) },
      ], size: "small", icon: "Package", iconColor: "#0ea5e9", iconBg: "#f0f9ff", tone: "amber",
    }, {
      id: "internal_tasks", href: "/orders/business", title: "待审核回单",
      subtitle: "当前等待前台审核的维修回单", value: pendingReviewOrders.length, valueSuffix: "单",
      footerItems: [{ label: "来自", value: "正式维修轮次状态" }], size: "small", icon: "Users",
      iconColor: "#f59e0b", iconBg: "#fffbeb", tone: "amber",
    }, {
      id: "risk_alerts", href: "/payments", title: "运营风险提醒",
      subtitle: "由正式业务记录实时计算", value: dueOrders.length + overpaidOrders.length, valueSuffix: "项",
      footerItems: [
        { label: "待收 Business Order", value: `${dueOrders.length} 项` },
        { label: "多收款 Business Order", value: `${overpaidOrders.length} 项` },
      ], size: "small", icon: "ShieldAlert", iconColor: "#ef4444", iconBg: "#fef2f2", tone: "rose",
    }],
  };
}

function dashboardTeamTarget(
  targets: PerformanceTargetResult,
  month: string,
  teamId: number,
) {
  const target = targets.teams.find((item) => item.teamId === teamId);
  if (target) return target;
  const parameterReason = `缺少 ${month} 绩效参数`;
  const parameterMissing = targets.targetMissingReasons.includes(parameterReason);
  return {
    teamId,
    teamName: "",
    targetStatus: parameterMissing ? "not_configured" as const : "configured" as const,
    targetPerformanceMinor: parameterMissing ? null : 0,
    targetMissingReasons: parameterMissing ? [parameterReason] : [],
  };
}

function toJmd(valueMinor: number) {
  return valueMinor / 100;
}

function jamaicaDay(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

function jamaicaMonth(value: Date) {
  return jamaicaDay(value).slice(0, 7);
}

function periodStart(now: Date, range: "day" | "week" | "month") {
  const today = jamaicaDay(now);
  const [year, month, day] = today.split("-").map(Number);
  const offsetHours = -5;
  const start = new Date(Date.UTC(year!, month! - 1, day!, -offsetHours));
  if (range === "month") start.setUTCDate(1);
  if (range === "week") {
    const jamaicaWeekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
    start.setUTCDate(start.getUTCDate() - ((jamaicaWeekday + 6) % 7));
  }
  return start;
}

function jamaicaDate(now: Date) {
  return {
    dateLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Jamaica", year: "numeric", month: "long", day: "numeric",
    }).format(now),
    dateTime: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Jamaica", weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(now),
    monthLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Jamaica", year: "numeric", month: "long",
    }).format(now),
  };
}

async function requireReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ id: number }>(
    `select id from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new DashboardReadDeniedError();
}
