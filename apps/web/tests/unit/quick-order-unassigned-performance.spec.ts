import { expect, test } from "@playwright/test";
import { summarizeQuickOrderPerformance } from "../../src/lib/orders/performance-value";

test("没有维修班组的 Business Order 不计入任何班组或门店绩效", () => {
  const summary = summarizeQuickOrderPerformance([{
    teamId: null,
    performanceValueJmd: 9_000,
    submittedAt: "2026-07-21T16:20:00-05:00",
    orderKind: "normal",
    voidedAt: null,
  }], "2026-07");

  expect(summary.counted).toEqual({ orderCount: 0, totalValueJmd: 0 });
  expect(summary.byTeam.every((team) => team.countedValueJmd === 0)).toBe(true);
});
