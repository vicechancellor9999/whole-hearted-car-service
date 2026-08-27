import { expect, test } from "@playwright/test";
import {
  filterLedgerItemsForJamaicaDay,
  netCashReceived,
} from "../../src/components/payments/payments-workspace";

const records = [
  { kind: "payment", amountJmd: 8_000, occurredAt: "2026-08-24T14:00:00.000Z" },
  { kind: "refund", cashRefundJmd: 2_500, occurredAt: "2026-08-24T16:00:00.000Z" },
  { kind: "payment", amountJmd: 4_000, occurredAt: "2026-08-23T16:00:00.000Z" },
] as const;

test("今日净收款明细只使用牙买加当天发生的独立记录", () => {
  const today = filterLedgerItemsForJamaicaDay(
    records,
    new Date("2026-08-24T20:00:00.000Z"),
  );

  expect(today).toHaveLength(2);
  expect(netCashReceived(today)).toBe(5_500);
});
