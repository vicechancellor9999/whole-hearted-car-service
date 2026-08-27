import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";

export type RevenueRange = "day" | "week" | "month" | "year" | "all";

type TransactionRow = {
  id: number;
  kind: "payment" | "refund";
  amount_minor: number;
  occurred_at: Date | string;
  method_label: string;
};

type RevenueEvent = {
  id: string;
  date: string;
  occurredAt: Date;
  method: string;
  kind: "payment" | "refund";
  amountJmd: number;
};

export class RevenueReadDeniedError extends Error {
  readonly status = 403;
  constructor() {
    super("当前账号不能查看经营收款分析");
    this.name = "RevenueReadDeniedError";
  }
}

export class RevenueService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async getDetail(input: { viewerAccountId: number; range: RevenueRange; now?: Date }) {
    await requireReader(this.database, input.viewerAccountId);
    const now = input.now ?? new Date();
    const rows = await this.database.query<TransactionRow>(
      `select payment.id, 'payment'::text as kind, payment.amount_minor,
              payment.paid_at as occurred_at,
              coalesce(payment.payment_method_label_zh_snapshot,
                       payment.payment_method_label_en_snapshot,
                       payment.payment_method_code_snapshot,
                       method.label_zh, method.label_en, method.code,
                       '其他方式') as method_label
       from business_order_payments as payment
       join business_orders as business_order
         on business_order.id = payment.business_order_id
       left join dictionary_items as method on method.id = payment.payment_method_item_id
       where business_order.voided_at is null and payment.paid_at <= $1
       union all
       select refund.id, 'refund'::text as kind, refund.amount_minor,
              refund.refunded_at as occurred_at,
              coalesce(refund.payment_method_label_zh_snapshot,
                       refund.payment_method_label_en_snapshot,
                       refund.payment_method_code_snapshot,
                       method.label_zh, method.label_en, method.code,
                       '其他方式') as method_label
       from business_order_refunds as refund
       join business_orders as business_order
         on business_order.id = refund.business_order_id
       left join dictionary_items as method on method.id = refund.payment_method_item_id
       where business_order.voided_at is null and refund.refunded_at <= $1
       order by occurred_at, id`,
      [now],
    );
    const events = rows.map((row) => {
      const occurredAt = parseOccurredAt(row.occurred_at);
      return {
        id: `${row.kind}-${row.id}`,
        date: jamaicaDay(occurredAt),
        occurredAt,
        method: row.method_label,
        kind: row.kind,
        amountJmd: Number(row.amount_minor) / 100,
      } satisfies RevenueEvent;
    });
    return projectRevenue(events, input.range, now);
  }
}

function projectRevenue(events: RevenueEvent[], range: RevenueRange, asOf: Date) {
  const asOfDate = jamaicaDay(asOf);
  const eligibleEvents = events.filter((event) => event.occurredAt <= asOf);
  const selected = eligibleEvents.filter((event) => inRange(event.date, range, asOfDate));
  const rows = expectedKeys(eligibleEvents, range, asOfDate).map((key) => {
    const periodEvents = selected.filter((event) => periodKey(event.date, range) === key);
    const grossPaidJmd = sum(periodEvents.filter((event) => event.kind === "payment"));
    const cashRefundedJmd = sum(periodEvents.filter((event) => event.kind === "refund"));
    return {
      key,
      label: periodLabel(key, range, asOfDate),
      total: grossPaidJmd - cashRefundedJmd,
      labor: 0,
      parts: 0,
      paymentCount: periodEvents.filter((event) => event.kind === "payment").length,
      refundCount: periodEvents.filter((event) => event.kind === "refund").length,
      grossPaidJmd,
      cashRefundedJmd,
      netPaidJmd: grossPaidJmd - cashRefundedJmd,
      methods: summarizeMethods(periodEvents),
    };
  });
  const grossPaidJmd = sum(selected.filter((event) => event.kind === "payment"));
  const cashRefundedJmd = sum(selected.filter((event) => event.kind === "refund"));
  const netPaidJmd = grossPaidJmd - cashRefundedJmd;
  const previousMonthOperatingAverage = previousMonthAverage(eligibleEvents, asOfDate);
  const delta = previousMonthOperatingAverage === 0
    ? 0
    : (netPaidJmd - previousMonthOperatingAverage) / previousMonthOperatingAverage * 100;
  return {
    asOfDate,
    timeZone: "America/Jamaica" as const,
    range,
    summary: {
      total: netPaidJmd,
      labor: 0,
      parts: 0,
      paymentCount: selected.filter((event) => event.kind === "payment").length,
      refundCount: selected.filter((event) => event.kind === "refund").length,
      grossPaidJmd,
      cashRefundedJmd,
      netPaidJmd,
      previousMonthOperatingAverage,
      comparison: {
        direction: delta > 0 ? "up" as const : delta < 0 ? "down" as const : "steady" as const,
        percent: Number(Math.abs(delta).toFixed(1)),
      },
      methods: summarizeMethods(selected),
    },
    rows,
  };
}

function sum(events: RevenueEvent[]) {
  return events.reduce((total, event) => total + Math.abs(event.amountJmd), 0);
}

function summarizeMethods(events: RevenueEvent[]) {
  const map = new Map<string, { method: string; total: number; paymentCount: number }>();
  for (const event of events) {
    const current = map.get(event.method) ?? { method: event.method, total: 0, paymentCount: 0 };
    current.total += event.kind === "payment" ? event.amountJmd : -event.amountJmd;
    current.paymentCount += 1;
    map.set(event.method, current);
  }
  return [...map.values()].sort((left, right) => right.total - left.total || left.method.localeCompare(right.method, "zh-CN"));
}

function parseOccurredAt(value: Date | string) {
  const occurredAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("收付款发生时间无效");
  }
  return occurredAt;
}

function jamaicaDay(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

function previousMonthKey(asOfDate: string) {
  const date = new Date(`${asOfDate}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1, 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonthAverage(events: RevenueEvent[], asOfDate: string) {
  const month = previousMonthKey(asOfDate);
  const totals = new Map<string, number>();
  for (const event of events.filter((row) => row.date.startsWith(`${month}-`))) {
    totals.set(event.date, (totals.get(event.date) ?? 0) + (event.kind === "payment" ? event.amountJmd : -event.amountJmd));
  }
  return totals.size === 0 ? 0 : Math.round([...totals.values()].reduce((total, value) => total + value, 0) / totals.size);
}

function weekStart(asOfDate: string) {
  const date = new Date(`${asOfDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function inRange(date: string, range: RevenueRange, asOfDate: string) {
  if (date > asOfDate) return false;
  if (range === "all") return true;
  if (range === "day") return date === asOfDate;
  if (range === "month") return date.startsWith(asOfDate.slice(0, 7));
  if (range === "year") return date.startsWith(asOfDate.slice(0, 4));
  return date >= weekStart(asOfDate);
}

function periodKey(date: string, range: RevenueRange) {
  if (range === "year") return date.slice(0, 7);
  if (range === "all") return date.slice(0, 4);
  return date;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function expectedKeys(events: RevenueEvent[], range: RevenueRange, asOfDate: string) {
  if (range === "day") return [asOfDate];
  if (range === "week") return Array.from({ length: 7 }, (_, index) => addDays(weekStart(asOfDate), index));
  if (range === "month") return Array.from({ length: Number(asOfDate.slice(8, 10)) }, (_, index) => `${asOfDate.slice(0, 8)}${String(index + 1).padStart(2, "0")}`);
  if (range === "year") return Array.from({ length: Number(asOfDate.slice(5, 7)) }, (_, index) => `${asOfDate.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`);
  return [...new Set(events.filter((event) => event.date <= asOfDate).map((event) => event.date.slice(0, 4)))].sort();
}

function periodLabel(key: string, range: RevenueRange, asOfDate: string) {
  if (range === "day") return key === asOfDate ? "今日" : key;
  if (range === "week") return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${key}T12:00:00Z`).getUTCDay()]!;
  if (range === "year") return `${Number(key.slice(5))}月`;
  if (range === "all") return `${key}年`;
  return key.slice(5);
}

async function requireReader(database: AuthSqlDatabase, accountId: number) {
  const rows = await database.query<{ id: number }>(
    `select id from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new RevenueReadDeniedError();
}
