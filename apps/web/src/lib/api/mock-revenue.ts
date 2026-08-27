import { buildRevenueDetail } from "../revenue/calculations";
import { selectQuickOrderFinancialLedger } from "./mock-quick-orders";
import type { LinkedOperationsState } from "./mock-orders";
import type {
  RevenueDetailResponse,
  RevenueRange,
  RevenueTransaction,
} from "../revenue/types";

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

export function selectLiveRevenueDetail(
  state: LinkedOperationsState,
  range: RevenueRange,
  nowMs: number,
): RevenueDetailResponse {
  const transactions: RevenueTransaction[] = selectQuickOrderFinancialLedger(state, nowMs).items
    .filter((item) => item.kind === "payment" || item.cashRefundJmd > 0)
    .map((item) => ({
      id: item.id,
      date: jamaicaDayKey(item.occurredAt),
      method: item.method?.trim() || "其他方式",
      kind: item.kind,
      amountJmd: item.kind === "payment" ? item.amountJmd : item.cashRefundJmd,
    }));
  return buildRevenueDetail(transactions, range, {
    asOfDate: jamaicaDayKey(nowMs),
    timeZone: "America/Jamaica",
  });
}

export interface MockRevenueFaults {
  delayMs?: { revenueRead?: number };
  failNext?: { revenueRead?: string };
}

export type MockRevenueE2EScenario =
  | MockRevenueFaults
  | "slow-revenue-read"
  | "revenue-read-failure-once";

let browserScenario: MockRevenueE2EScenario | undefined;
let readFailureConsumed = false;

function rawScenario(): MockRevenueE2EScenario | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as Window & {
    __WH_REVENUE_TEST_SCENARIO__?: MockRevenueE2EScenario;
  };
  return browser.__WH_REVENUE_TEST_SCENARIO__;
}

function scenarioFaults(): MockRevenueFaults {
  const scenario = rawScenario();
  if (scenario !== browserScenario) {
    browserScenario = scenario;
    readFailureConsumed = false;
  }
  if (scenario === "slow-revenue-read") return { delayMs: { revenueRead: 1_500 } };
  if (scenario === "revenue-read-failure-once") {
    return { failNext: { revenueRead: "可重试收入读取故障" } };
  }
  return scenario ?? {};
}

export function getMockRevenueReadDelay(): number {
  return Math.max(0, scenarioFaults().delayMs?.revenueRead ?? 0);
}

export function getMockRevenueDetail(
  state: LinkedOperationsState,
  range: RevenueRange,
  nowMs: number,
): RevenueDetailResponse {
  const message = scenarioFaults().failNext?.revenueRead;
  if (message && !readFailureConsumed) {
    readFailureConsumed = true;
    throw new Error(message);
  }
  return selectLiveRevenueDetail(state, range, nowMs);
}
