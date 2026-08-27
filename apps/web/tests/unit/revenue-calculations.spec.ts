import { expect, test } from "@playwright/test";
import {
  allocateRevenueTransaction,
  buildRevenueComposition,
  buildRevenueDetail,
} from "../../src/lib/revenue/calculations";
import type { RevenueTransaction } from "../../src/lib/revenue/types";

const transaction = (
  input: Partial<RevenueTransaction> & Pick<RevenueTransaction, "id" | "date" | "amountJmd">,
): RevenueTransaction => ({
  method: "刷卡",
  kind: "payment",
  laborValueJmd: 2,
  partsValueJmd: 1,
  ...input,
});

test("收款按工时和配件成交占比分摊且金额严格守恒", () => {
  const allocated = allocateRevenueTransaction(transaction({
    id: "pay-1",
    date: "2026-08-08",
    amountJmd: 101,
  }));

  expect(allocated).toMatchObject({ total: 101, labor: 67, parts: 34 });
  expect(allocated.labor + allocated.parts).toBe(allocated.total);
});

test("退款作为负收入参与分摊并保持工时加配件等于净额", () => {
  const allocated = allocateRevenueTransaction(transaction({
    id: "refund-1",
    date: "2026-08-08",
    kind: "refund",
    amountJmd: 100,
  }));

  expect(allocated).toMatchObject({ total: -100, labor: -67, parts: -33 });
  expect(allocated.labor + allocated.parts).toBe(allocated.total);
});

test("日收入汇总包含净收款、方式、上月营业日均及方向比较", () => {
  const transactions: RevenueTransaction[] = [
    transaction({ id: "july-1", date: "2026-07-01", amountJmd: 1_000 }),
    transaction({ id: "july-2", date: "2026-07-02", amountJmd: 3_000 }),
    transaction({
      id: "today-card",
      date: "2026-08-08",
      amountJmd: 1_000,
      laborValueJmd: 3,
      partsValueJmd: 1,
    }),
    transaction({
      id: "today-refund",
      date: "2026-08-08",
      kind: "refund",
      amountJmd: 200,
      laborValueJmd: 3,
      partsValueJmd: 1,
    }),
  ];

  const detail = buildRevenueDetail(transactions, "day", {
    asOfDate: "2026-08-08",
    timeZone: "America/Jamaica",
  });

  expect(detail).toMatchObject({
    asOfDate: "2026-08-08",
    timeZone: "America/Jamaica",
    range: "day",
    summary: {
      total: 800,
      labor: 600,
      parts: 200,
      paymentCount: 1,
      refundCount: 1,
      previousMonthOperatingAverage: 2_000,
      comparison: { direction: "down", percent: 60 },
      methods: [{ method: "刷卡", total: 800, paymentCount: 2 }],
    },
    rows: [{
      key: "2026-08-08",
      label: "今日",
      total: 800,
      labor: 600,
      parts: 200,
      paymentCount: 1,
      refundCount: 1,
      methods: [{ method: "刷卡", total: 800, paymentCount: 2 }],
    }],
  });
  expect(detail.summary.labor + detail.summary.parts).toBe(detail.summary.total);
});

test("年范围按月份聚合且每行工时配件严格守恒", () => {
  const detail = buildRevenueDetail([
    transaction({ id: "july", date: "2026-07-31", amountJmd: 900 }),
    transaction({ id: "aug-card", date: "2026-08-08", amountJmd: 300 }),
    transaction({
      id: "aug-cash",
      date: "2026-08-08",
      method: "现金",
      amountJmd: 150,
      laborValueJmd: 0,
      partsValueJmd: 1,
    }),
  ], "year", { asOfDate: "2026-08-08", timeZone: "America/Jamaica" });

  expect(detail.rows.map((row) => ({ key: row.key, total: row.total }))).toEqual([
    { key: "2026-01", total: 0 },
    { key: "2026-02", total: 0 },
    { key: "2026-03", total: 0 },
    { key: "2026-04", total: 0 },
    { key: "2026-05", total: 0 },
    { key: "2026-06", total: 0 },
    { key: "2026-07", total: 900 },
    { key: "2026-08", total: 450 },
  ]);
  expect(detail.rows.every((row) => row.labor + row.parts === row.total)).toBe(true);
});

test("周范围固定返回周一到周日七行并为无流水日期补零", () => {
  const detail = buildRevenueDetail([
    transaction({ id: "sat", date: "2026-08-08", amountJmd: 325 }),
  ], "week", { asOfDate: "2026-08-08", timeZone: "America/Jamaica" });

  expect(detail.rows.map((row) => row.key)).toEqual([
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
    "2026-08-07", "2026-08-08", "2026-08-09",
  ]);
  expect(detail.rows.map((row) => row.label)).toEqual([
    "周一", "周二", "周三", "周四", "周五", "周六", "周日",
  ]);
  expect(detail.rows.map((row) => row.total)).toEqual([0, 0, 0, 0, 0, 325, 0]);
  expect(detail.summary.total).toBe(325);
  expect(detail.rows.every((row) => row.labor + row.parts === row.total)).toBe(true);
});

test("月范围固定返回一日至统计日八行且零流水行方法为空", () => {
  const detail = buildRevenueDetail([
    transaction({ id: "first", date: "2026-08-01", amountJmd: 100 }),
    transaction({ id: "eighth", date: "2026-08-08", amountJmd: 200 }),
  ], "month", { asOfDate: "2026-08-08", timeZone: "America/Jamaica" });

  expect(detail.rows).toHaveLength(8);
  expect(detail.rows[0]).toMatchObject({ key: "2026-08-01", total: 100 });
  expect(detail.rows[7]).toMatchObject({ key: "2026-08-08", total: 200 });
  expect(detail.rows.slice(1, 7).every((row) =>
    row.total === 0 && row.paymentCount === 0 && row.methods.length === 0)).toBe(true);
  expect(detail.summary.total).toBe(300);
});

test("同一收款方式的退款抵扣净额但保留两笔流水计数", () => {
  const detail = buildRevenueDetail([
    transaction({ id: "pay", date: "2026-08-08", amountJmd: 1_000 }),
    transaction({ id: "refund", date: "2026-08-08", kind: "refund", amountJmd: 200 }),
  ], "day", { asOfDate: "2026-08-08", timeZone: "America/Jamaica" });

  expect(detail.summary.methods).toEqual([
    { method: "刷卡", total: 800, paymentCount: 2 },
  ]);
  expect(detail.rows[0].methods).toEqual(detail.summary.methods);
});

test("计算边界拒绝非法收入统计范围", () => {
  expect(() => buildRevenueDetail([], "quarter" as never, {
    asOfDate: "2026-08-08",
    timeZone: "America/Jamaica",
  })).toThrow(/收入统计范围无效/);
});

test("出现负分项或非正净额时构成图切换为退款冲减表达", () => {
  expect(buildRevenueComposition({ total: 50, labor: 100, parts: -50 }))
    .toEqual({ mode: "offset", laborPercent: null, partsPercent: null });
  expect(buildRevenueComposition({ total: -20, labor: -20, parts: 0 }))
    .toEqual({ mode: "offset", laborPercent: null, partsPercent: null });
  expect(buildRevenueComposition({ total: 200, labor: 150, parts: 50 }))
    .toEqual({ mode: "share", laborPercent: 75, partsPercent: 25 });
});
