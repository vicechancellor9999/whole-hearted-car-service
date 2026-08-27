import { expect, test } from "@playwright/test";
import {
  isQuickOrderCompleted,
  isQuickOrderVoided,
  quickBoChainIndex,
  quickOrderRepairElapsedDays,
  quickOrderRepairOverdueDays,
  suggestEtaDays,
  QUICK_BO_CHAIN_STEPS,
} from "../../src/lib/orders/quick-order-types";

test("最终完结推导：交单+取车+付完全款 三项齐才算已完结（8/18 老板）", () => {
  const base = { status: "submitted" as const, pickedUpAt: null, paidInFullAt: null };
  expect(isQuickOrderCompleted(base)).toBe(false);
  expect(isQuickOrderCompleted({ ...base, pickedUpAt: "2026-08-18T10:00:00Z" })).toBe(false);
  expect(isQuickOrderCompleted({ ...base, paidInFullAt: "2026-08-18T10:00:00Z" })).toBe(false);
  expect(isQuickOrderCompleted({ ...base, pickedUpAt: "2026-08-18T10:00:00Z", paidInFullAt: "2026-08-18T11:00:00Z" })).toBe(true);
  // 未交单即使有取车/付款记录也不算完结
  expect(isQuickOrderCompleted({ status: "returned", pickedUpAt: "2026-08-18T10:00:00Z", paidInFullAt: "2026-08-18T11:00:00Z" })).toBe(false);
});

test("废除标记：废除单=全部数据无效，可恢复（8/18 老板）", () => {
  expect(isQuickOrderVoided({ voidedAt: null })).toBe(false);
  expect(isQuickOrderVoided({ voidedAt: "2026-08-18T10:00:00Z" })).toBe(true);
});

test("箭头链当前段：已完结压最后一段，否则按主链状态", () => {
  expect(QUICK_BO_CHAIN_STEPS.map((s) => s.label)).toEqual(["待派单", "已派单", "维修中", "回单待审核", "已交单", "已完结"]);
  expect(quickBoChainIndex({ status: "pending_assign", pickedUpAt: null, paidInFullAt: null })).toBe(0);
  expect(quickBoChainIndex({ status: "submitted", pickedUpAt: null, paidInFullAt: null })).toBe(4);
  expect(quickBoChainIndex({ status: "submitted", pickedUpAt: "2026-08-18T10:00:00Z", paidInFullAt: "2026-08-18T11:00:00Z" })).toBe(5);
});
test("预计工期：按收费项目/待报价/金额给建议，封顶 30 天（8/18 老板）", () => {
  const item = (pendingQuote: boolean, price: number) => ({ pendingQuote, unitPriceJmd: price, quantity: 1 });
  expect(suggestEtaDays([item(false, 25_000)])).toBe(1);
  expect(suggestEtaDays([item(false, 25_000), item(false, 20_000), item(false, 15_000)])).toBe(2); // 3 项 +1
  expect(suggestEtaDays([item(false, 25_000), item(true, 0)])).toBe(2); // 待报价 +1
  expect(suggestEtaDays([item(false, 60_000), item(false, 50_000)])).toBe(2); // 合计 11 万 +1
  expect(suggestEtaDays(Array.from({ length: 100 }, () => item(false, 10_000)))).toBe(30); // 封顶
});

test("维修中超时：按单反馈的工期算，不是固定天数（8/18 老板）", () => {
  const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString();
  // 小工程工期 1 天 → 4 天没回单已超时 3 天
  const small = { status: "in_repair" as const, acceptedAt: fourDaysAgo, etaDays: 1 };
  expect(quickOrderRepairElapsedDays(small)).toBeGreaterThanOrEqual(4);
  expect(quickOrderRepairOverdueDays(small)).toBeGreaterThanOrEqual(3);
  // 大工程工期 10 天 → 同样 4 天不算超时
  const big = { status: "in_repair" as const, acceptedAt: fourDaysAgo, etaDays: 10 };
  expect(quickOrderRepairOverdueDays(big)).toBe(0);
  // 未接车/未反馈工期/非维修中 → 不算超时
  expect(quickOrderRepairOverdueDays({ status: "in_repair", acceptedAt: null, etaDays: 1 })).toBe(0);
  expect(quickOrderRepairOverdueDays({ status: "in_repair", acceptedAt: fourDaysAgo, etaDays: null })).toBe(0);
  expect(quickOrderRepairOverdueDays({ status: "stalled", acceptedAt: fourDaysAgo, etaDays: 1 })).toBe(0);
});