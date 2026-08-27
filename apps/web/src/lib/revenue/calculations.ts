import type {
  BuildRevenueDetailOptions,
  RevenueDetailResponse,
  RevenueEvent,
  RevenueMethodSummary,
  RevenuePeriodRow,
  RevenueRange,
  RevenueSummary,
  RevenueTransaction,
} from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REVENUE_RANGES: RevenueRange[] = ["day", "week", "month", "year", "all"];

export function buildRevenueComposition(
  summary: Pick<RevenueSummary, "total" | "labor" | "parts">,
): {
  mode: "share" | "offset";
  laborPercent: number | null;
  partsPercent: number | null;
} {
  if (summary.total <= 0 || summary.labor < 0 || summary.parts < 0) {
    return { mode: "offset", laborPercent: null, partsPercent: null };
  }
  const total = summary.labor + summary.parts;
  if (total <= 0) return { mode: "share", laborPercent: 0, partsPercent: 0 };
  const laborPercent = Math.round(summary.labor / total * 100);
  return { mode: "share", laborPercent, partsPercent: 100 - laborPercent };
}

export function allocateRevenueTransaction(transaction: RevenueTransaction): RevenueEvent {
  if (!DATE_PATTERN.test(transaction.date)) throw new Error("收入流水日期无效");
  if (![transaction.amountJmd, transaction.laborValueJmd ?? 0, transaction.partsValueJmd ?? 0]
    .every(Number.isFinite)) throw new Error("收入流水金额无效");

  const total = (transaction.kind === "refund" ? -1 : 1) * Math.abs(transaction.amountJmd);
  const laborValue = Math.max(0, transaction.laborValueJmd ?? 1);
  const partsValue = Math.max(0, transaction.partsValueJmd ?? 0);
  const pricedTotal = laborValue + partsValue;
  const labor = pricedTotal === 0 ? 0 : Math.round(total * laborValue / pricedTotal);

  return {
    id: transaction.id,
    date: transaction.date,
    method: transaction.method.trim() || "其他方式",
    kind: transaction.kind,
    total,
    labor,
    parts: total - labor,
  };
}

function previousMonthKey(asOfDate: string): string {
  const date = new Date(`${asOfDate}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1, 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfWeek(asOfDate: string): string {
  const date = new Date(`${asOfDate}T12:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

function inSelectedRange(event: RevenueEvent, range: RevenueRange, asOfDate: string): boolean {
  if (event.date > asOfDate) return false;
  if (range === "all") return true;
  if (range === "day") return event.date === asOfDate;
  if (range === "month") return event.date.startsWith(asOfDate.slice(0, 7));
  if (range === "year") return event.date.startsWith(asOfDate.slice(0, 4));
  const weekStart = startOfWeek(asOfDate);
  return event.date >= weekStart && event.date <= asOfDate;
}

function periodKey(event: RevenueEvent, range: RevenueRange): string {
  if (range === "year") return event.date.slice(0, 7);
  if (range === "all") return event.date.slice(0, 4);
  return event.date;
}

function periodLabel(key: string, range: RevenueRange, asOfDate: string): string {
  if (range === "day") return key === asOfDate ? "今日" : key;
  if (range === "week") {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
      [new Date(`${key}T12:00:00Z`).getUTCDay()];
  }
  if (range === "year") return `${Number(key.slice(5))}月`;
  if (range === "all") return `${key}年`;
  return key.slice(5);
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function expectedPeriodKeys(
  events: RevenueEvent[],
  range: RevenueRange,
  asOfDate: string,
): string[] {
  if (range === "day") return [asOfDate];
  if (range === "week") {
    const first = startOfWeek(asOfDate);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }
  if (range === "month") {
    const day = Number(asOfDate.slice(8, 10));
    return Array.from(
      { length: day },
      (_, index) => `${asOfDate.slice(0, 8)}${String(index + 1).padStart(2, "0")}`,
    );
  }
  if (range === "year") {
    const month = Number(asOfDate.slice(5, 7));
    return Array.from(
      { length: month },
      (_, index) => `${asOfDate.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`,
    );
  }
  return [...new Set(events
    .filter((event) => event.date <= asOfDate)
    .map((event) => event.date.slice(0, 4)))].sort();
}

function summarizeMethods(events: RevenueEvent[]): RevenueMethodSummary[] {
  const methods = new Map<string, RevenueMethodSummary>();
  for (const event of events) {
    const current = methods.get(event.method) ?? {
      method: event.method,
      total: 0,
      paymentCount: 0,
    };
    current.total += event.total;
    current.paymentCount += 1;
    methods.set(event.method, current);
  }
  return [...methods.values()].sort((left, right) =>
    right.total - left.total || left.method.localeCompare(right.method, "zh-CN"));
}

function summarizeRow(
  key: string,
  range: RevenueRange,
  asOfDate: string,
  events: RevenueEvent[],
): RevenuePeriodRow {
  const total = events.reduce((sum, event) => sum + event.total, 0);
  const labor = events.reduce((sum, event) => sum + event.labor, 0);
  const grossPaidJmd = events.reduce((sum, event) => (
    sum + (event.kind === "payment" ? Math.abs(event.total) : 0)
  ), 0);
  const cashRefundedJmd = events.reduce((sum, event) => (
    sum + (event.kind === "refund" ? Math.abs(event.total) : 0)
  ), 0);
  return {
    key,
    label: periodLabel(key, range, asOfDate),
    total,
    labor,
    parts: total - labor,
    paymentCount: events.filter((event) => event.kind === "payment").length,
    refundCount: events.filter((event) => event.kind === "refund").length,
    grossPaidJmd,
    cashRefundedJmd,
    netPaidJmd: grossPaidJmd - cashRefundedJmd,
    methods: summarizeMethods(events),
  };
}

function selectedRows(
  events: RevenueEvent[],
  range: RevenueRange,
  asOfDate: string,
): RevenuePeriodRow[] {
  const selected = events.filter((event) => inSelectedRange(event, range, asOfDate));
  const groups = new Map<string, RevenueEvent[]>();
  for (const event of selected) {
    const key = periodKey(event, range);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return expectedPeriodKeys(events, range, asOfDate)
    .map((key) => summarizeRow(key, range, asOfDate, groups.get(key) ?? []));
}

function previousOperatingAverage(events: RevenueEvent[], asOfDate: string): number {
  const month = previousMonthKey(asOfDate);
  const days = new Map<string, number>();
  for (const event of events.filter((entry) => entry.date.startsWith(`${month}-`))) {
    days.set(event.date, (days.get(event.date) ?? 0) + event.total);
  }
  if (days.size === 0) return 0;
  return Math.round([...days.values()].reduce((sum, total) => sum + total, 0) / days.size);
}

export function buildRevenueDetail(
  transactions: RevenueTransaction[],
  range: RevenueRange,
  options: BuildRevenueDetailOptions,
): RevenueDetailResponse {
  if (!REVENUE_RANGES.includes(range)) throw new Error("收入统计范围无效");
  if (!DATE_PATTERN.test(options.asOfDate)) throw new Error("统计日期无效");
  const events = transactions.map(allocateRevenueTransaction);
  const rows = selectedRows(events, range, options.asOfDate);
  const selectedEvents = events.filter((event) => inSelectedRange(event, range, options.asOfDate));
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const labor = rows.reduce((sum, row) => sum + row.labor, 0);
  const average = previousOperatingAverage(events, options.asOfDate);
  const differencePercent = average === 0 ? 0 : (total - average) / average * 100;

  return {
    asOfDate: options.asOfDate,
    timeZone: options.timeZone,
    range,
    summary: {
      total,
      labor,
      parts: total - labor,
      paymentCount: selectedEvents.filter((event) => event.kind === "payment").length,
      refundCount: selectedEvents.filter((event) => event.kind === "refund").length,
      grossPaidJmd: selectedEvents.reduce((sum, event) => (
        sum + (event.kind === "payment" ? Math.abs(event.total) : 0)
      ), 0),
      cashRefundedJmd: selectedEvents.reduce((sum, event) => (
        sum + (event.kind === "refund" ? Math.abs(event.total) : 0)
      ), 0),
      netPaidJmd: total,
      previousMonthOperatingAverage: average,
      comparison: {
        direction: differencePercent > 0 ? "up" : differencePercent < 0 ? "down" : "steady",
        percent: Number(Math.abs(differencePercent).toFixed(1)),
      },
      methods: summarizeMethods(selectedEvents),
    },
    rows,
  };
}
