export type RevenueRange = "day" | "week" | "month" | "year" | "all";

export const REVENUE_VIEW_RANGES = [
  { id: "day", label: "今日" },
  { id: "week", label: "本周" },
  { id: "month", label: "本月" },
  { id: "year", label: "本年" },
] as const;

export type RevenueViewRange = typeof REVENUE_VIEW_RANGES[number]["id"];

export function normalizeRevenueViewRange(value: string | null | undefined): RevenueViewRange {
  return REVENUE_VIEW_RANGES.some((range) => range.id === value)
    ? value as RevenueViewRange
    : "day";
}

export function isRevenueViewRange(value: string | null | undefined): value is RevenueViewRange {
  return REVENUE_VIEW_RANGES.some((range) => range.id === value);
}

export type RevenueTransactionKind = "payment" | "refund";

export interface RevenueTransaction {
  id: string;
  date: string;
  method: string;
  kind: RevenueTransactionKind;
  amountJmd: number;
  /** Legacy composition hints. Live cash reporting does not infer a payment's charge category. */
  laborValueJmd?: number;
  partsValueJmd?: number;
}

export interface RevenueEvent {
  id: string;
  date: string;
  method: string;
  kind: RevenueTransactionKind;
  total: number;
  labor: number;
  parts: number;
}

export interface RevenueMethodSummary {
  method: string;
  total: number;
  paymentCount: number;
}

export interface RevenuePeriodRow {
  key: string;
  label: string;
  total: number;
  labor: number;
  parts: number;
  paymentCount: number;
  refundCount: number;
  grossPaidJmd: number;
  cashRefundedJmd: number;
  netPaidJmd: number;
  methods: RevenueMethodSummary[];
}

export type RevenueComparisonDirection = "up" | "down" | "steady";

export interface RevenueSummary {
  total: number;
  labor: number;
  parts: number;
  paymentCount: number;
  refundCount: number;
  grossPaidJmd: number;
  cashRefundedJmd: number;
  netPaidJmd: number;
  previousMonthOperatingAverage: number;
  comparison: {
    direction: RevenueComparisonDirection;
    percent: number;
  };
  methods: RevenueMethodSummary[];
}

export interface RevenueDetailResponse {
  asOfDate: string;
  timeZone: "America/Jamaica";
  range: RevenueRange;
  summary: RevenueSummary;
  rows: RevenuePeriodRow[];
}

export interface BuildRevenueDetailOptions {
  asOfDate: string;
  timeZone: "America/Jamaica";
}
