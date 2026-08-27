import { describe, expect, it } from "vitest";
import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";
import { PaymentService } from "@formal/modules/payment/payment-service";

describe("PaymentService refund eligibility", () => {
  it("rejects a refund for a voided Business Order before writing a refund fact", async () => {
    const queries: string[] = [];
    const database: AuthSqlDatabase = {
      async query<Row extends Record<string, unknown>>(text: string) {
        queries.push(text);
        if (text.includes("from staff_accounts as account")) {
          return [{ role: "super_admin", delegated: false }] as unknown as Row[];
        }
        if (text.includes("from business_orders as business_order")) {
          return [{ id: 42, voided_at: new Date("2026-08-24T13:05:00Z") }] as unknown as Row[];
        }
        throw new Error(`unexpected refund query: ${text}`);
      },
      async transaction(callback) {
        return callback(this);
      },
    };

    await expect(new PaymentService(database).recordRefund({
      businessOrderId: 42,
      amount: "100",
      paymentMethodItemId: 7,
      reason: "不应写入的作废单退款",
      originalDocumentStatus: "returned",
      context: {
        actorAccountId: 1,
        requestId: "refund-after-void",
        now: new Date("2026-08-24T13:10:00Z"),
      },
    })).rejects.toThrow("已作废的 Business Order 不能登记退款");
    expect(queries.some((query) => query.includes("insert into business_order_refunds"))).toBe(false);
  });
});
