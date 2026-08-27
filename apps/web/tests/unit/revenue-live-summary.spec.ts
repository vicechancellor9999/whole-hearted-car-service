import { expect, test } from "@playwright/test";
import { buildRevenueDetail } from "../../src/lib/revenue/calculations";
import type { RevenueTransaction } from "../../src/lib/revenue/types";

const payment = (id: string, date: string, amountJmd: number, method = "现金"): RevenueTransaction => ({
  id,
  date,
  method,
  kind: "payment",
  amountJmd,
});

const refund = (id: string, date: string, amountJmd: number, method = "现金"): RevenueTransaction => ({
  id,
  date,
  method,
  kind: "refund",
  amountJmd,
});

test("经营收入按同一批逐笔收退款事实汇总本周净收款", () => {
  const detail = buildRevenueDetail([
    payment("pay-mon", "2026-08-17", 10_000),
    payment("pay-wed", "2026-08-19", 8_000, "银行转账"),
    refund("refund-wed", "2026-08-19", 3_000),
    payment("previous-week", "2026-08-16", 99_000),
  ], "week", { asOfDate: "2026-08-20", timeZone: "America/Jamaica" });

  expect(detail.summary).toMatchObject({
    grossPaidJmd: 18_000,
    cashRefundedJmd: 3_000,
    netPaidJmd: 15_000,
    paymentCount: 2,
    refundCount: 1,
  });
  expect(detail.rows.find((row) => row.key === "2026-08-19")).toMatchObject({
    grossPaidJmd: 8_000,
    cashRefundedJmd: 3_000,
    netPaidJmd: 5_000,
    paymentCount: 1,
    refundCount: 1,
  });
});

test("经营收入支持本月按日和本年按月查看", () => {
  const transactions = [
    payment("july", "2026-07-31", 10_000),
    payment("aug", "2026-08-02", 20_000),
    refund("aug-refund", "2026-08-03", 5_000),
  ];

  const month = buildRevenueDetail(transactions, "month", {
    asOfDate: "2026-08-24",
    timeZone: "America/Jamaica",
  });
  const year = buildRevenueDetail(transactions, "year", {
    asOfDate: "2026-08-24",
    timeZone: "America/Jamaica",
  });

  expect(month.rows).toHaveLength(24);
  expect(month.summary.netPaidJmd).toBe(15_000);
  expect(year.rows).toHaveLength(8);
  expect(year.rows.at(-2)).toMatchObject({ key: "2026-07", netPaidJmd: 10_000 });
  expect(year.rows.at(-1)).toMatchObject({ key: "2026-08", netPaidJmd: 15_000 });
});
