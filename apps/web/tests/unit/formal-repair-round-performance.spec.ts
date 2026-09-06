import { expect, test } from "@playwright/test";
import { displayedRepairRoundPerformanceMinor } from "../../src/lib/orders/repair-round-performance";

test("persisted repair-round performance draft wins, including zero and negative values", () => {
  expect(displayedRepairRoundPerformanceMinor({
    roundNo: 2,
    performanceDraftMinor: 0,
    laborSubtotalMinor: 125_000,
  })).toBe(0);
  expect(displayedRepairRoundPerformanceMinor({
    roundNo: 1,
    performanceDraftMinor: -1_234,
    laborSubtotalMinor: 125_000,
  })).toBe(-1_234);
});

test("a legacy first repair round without a draft defaults to the labor subtotal", () => {
  expect(displayedRepairRoundPerformanceMinor({
    roundNo: 1,
    performanceDraftMinor: null,
    laborSubtotalMinor: 125_000,
  })).toBe(125_000);
});

test("a later repair round without a draft defaults to zero instead of whole-order labor", () => {
  expect(displayedRepairRoundPerformanceMinor({
    roundNo: 2,
    performanceDraftMinor: null,
    laborSubtotalMinor: 125_000,
  })).toBe(0);
});

test("legacy payloads that omit a performance draft use the same round fallback", () => {
  expect(displayedRepairRoundPerformanceMinor({
    roundNo: 2,
    performanceDraftMinor: undefined,
    laborSubtotalMinor: 125_000,
  })).toBe(0);
});
