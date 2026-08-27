import { expect, test } from "@playwright/test";
import {
  REVENUE_VIEW_RANGES,
  normalizeRevenueViewRange,
} from "../../src/lib/revenue/types";

test("the formal revenue view exposes today, week, month, and year with a day fallback", () => {
  expect(REVENUE_VIEW_RANGES).toEqual([
    { id: "day", label: "今日" },
    { id: "week", label: "本周" },
    { id: "month", label: "本月" },
    { id: "year", label: "本年" },
  ]);
  expect(normalizeRevenueViewRange("day")).toBe("day");
  expect(normalizeRevenueViewRange("week")).toBe("week");
  expect(normalizeRevenueViewRange("quarter")).toBe("day");
  expect(normalizeRevenueViewRange(null)).toBe("day");
});
