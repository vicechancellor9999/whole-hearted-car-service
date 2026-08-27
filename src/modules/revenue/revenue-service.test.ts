import { describe, expect, it } from "vitest";
import type { AuthSqlDatabase } from "@/modules/auth/session-repository";
import { RevenueService } from "@/modules/revenue/revenue-service";

type TransactionRow = {
  id: number;
  kind: "payment" | "refund";
  amount_minor: number;
  occurred_at: Date;
  method_label: string;
};

function revenueDatabase(transactions: TransactionRow[]): AuthSqlDatabase {
  return {
    async query<Row extends Record<string, unknown>>(text: string) {
      if (text.includes("from staff_accounts")) return [{ id: 1 }] as unknown as Row[];
      if (text.includes("from business_order_payments as payment")) {
        return transactions as unknown as Row[];
      }
      throw new Error(`unexpected revenue query: ${text}`);
    },
    async transaction(callback) {
      return callback(this);
    },
  };
}

describe("RevenueService", () => {
  it("reports net collections from independent payments and refunds without labor or parts allocation", async () => {
    const service = new RevenueService(revenueDatabase([
      { id: 1, kind: "payment", amount_minor: 100_000, occurred_at: new Date("2026-08-26T05:00:00Z"), method_label: "现金" },
      { id: 2, kind: "payment", amount_minor: 25_000, occurred_at: new Date("2026-08-26T15:00:00Z"), method_label: "刷卡" },
      { id: 3, kind: "refund", amount_minor: 30_000, occurred_at: new Date("2026-08-26T16:00:00Z"), method_label: "现金" },
      { id: 4, kind: "payment", amount_minor: 50_000, occurred_at: new Date("2026-08-26T19:00:00Z"), method_label: "现金" },
    ]));

    const detail = await service.getDetail({
      viewerAccountId: 1,
      range: "day",
      now: new Date("2026-08-26T18:00:00Z"),
    });

    expect(detail.summary).toMatchObject({
      total: 950,
      grossPaidJmd: 1250,
      cashRefundedJmd: 300,
      netPaidJmd: 950,
      paymentCount: 2,
      refundCount: 1,
      labor: 0,
      parts: 0,
      methods: [
        { method: "现金", total: 700, paymentCount: 2 },
        { method: "刷卡", total: 250, paymentCount: 1 },
      ],
    });
    expect(detail.rows).toEqual([
      expect.objectContaining({
        label: "今日",
        total: 950,
        grossPaidJmd: 1250,
        cashRefundedJmd: 300,
        netPaidJmd: 950,
        labor: 0,
        parts: 0,
      }),
    ]);
  });

  it("uses the Jamaica business-day boundary for the today range", async () => {
    const service = new RevenueService(revenueDatabase([
      { id: 1, kind: "payment", amount_minor: 90_000, occurred_at: new Date("2026-08-26T04:59:59Z"), method_label: "现金" },
      { id: 2, kind: "payment", amount_minor: 10_000, occurred_at: new Date("2026-08-26T05:00:00Z"), method_label: "现金" },
    ]));

    const detail = await service.getDetail({
      viewerAccountId: 1,
      range: "day",
      now: new Date("2026-08-26T15:00:00Z"),
    });

    expect(detail.summary).toMatchObject({ grossPaidJmd: 100, netPaidJmd: 100, paymentCount: 1 });
  });
});
