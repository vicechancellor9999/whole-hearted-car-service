import { describe, expect, it } from "vitest";
import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";
import { DashboardService } from "@formal/modules/dashboard/dashboard-service";

type OrderRow = {
  id: number;
  status: string;
  created_at: Date;
  total_due_minor: number;
  total_paid_minor: number;
  total_refunded_minor: number;
};

function dashboardDatabase(input: {
  orders: OrderRow[];
  transactions?: Array<{ kind: "payment" | "refund"; amount_minor: number; occurred_at: Date }>;
  handoffs?: Array<{ handed_off_at: Date }>;
  teams?: Array<{ id: number; name: string; performance_minor: number }>;
  queries?: string[];
}): AuthSqlDatabase {
  return {
    async query<Row extends Record<string, unknown>>(text: string) {
      input.queries?.push(text);
      if (text.includes("set transaction isolation level")) return [] as Row[];
      if (text.includes("from staff_accounts")) return [{ id: 1 }] as unknown as Row[];
      if (text.includes("from repair_teams as team")) return (input.teams ?? []) as unknown as Row[];
      if (text.includes("from business_orders as business_order") && text.includes("left join business_order_charge_versions")) {
        return input.orders as unknown as Row[];
      }
      if (text.includes("from business_order_payments as payment") && text.includes("union all")) {
        return (input.transactions ?? []) as unknown as Row[];
      }
      if (text.includes("from formal_handoffs as handoff") && text.includes("from repair_teams") === false) {
        return (input.handoffs ?? []) as unknown as Row[];
      }
      throw new Error(`unexpected dashboard query: ${text}`);
    },
    async transaction(callback) {
      return callback(this);
    },
  };
}

function card(summary: Awaited<ReturnType<DashboardService["getSummary"]>>, id: string) {
  return [...summary.topCards, ...summary.bottomCards].find((item) => item.id === id);
}

describe("DashboardService", () => {
  it("uses period payments minus refunds for the today card and opens the day detail", async () => {
    const service = new DashboardService(dashboardDatabase({
      orders: [
        { id: 1, status: "waiting_assignment", created_at: new Date("2026-08-26T10:00:00Z"), total_due_minor: 0, total_paid_minor: 0, total_refunded_minor: 0 },
        { id: 2, status: "waiting_assignment", created_at: new Date("2026-08-27T05:00:00Z"), total_due_minor: 0, total_paid_minor: 0, total_refunded_minor: 0 },
      ],
      transactions: [
        { kind: "payment", amount_minor: 100_000, occurred_at: new Date("2026-08-26T05:00:00Z") },
        { kind: "payment", amount_minor: 25_000, occurred_at: new Date("2026-08-26T14:00:00Z") },
        { kind: "refund", amount_minor: 30_000, occurred_at: new Date("2026-08-26T14:30:00Z") },
        { kind: "payment", amount_minor: 999_999, occurred_at: new Date("2026-08-27T05:00:00Z") },
      ],
      handoffs: [
        { handed_off_at: new Date("2026-08-26T13:00:00Z") },
        { handed_off_at: new Date("2026-08-27T05:00:00Z") },
      ],
    }));

    const summary = await service.getSummary({
      viewerAccountId: 1,
      now: new Date("2026-08-26T15:00:00Z"),
    });

    expect(summary.periods[0]).toMatchObject({
      range: "day",
      grossPaidJmd: 1250,
      cashRefundedJmd: 300,
      netPaidJmd: 950,
      businessOrderCount: 1,
      submittedOrderCount: 1,
    });
    expect(card(summary, "today_revenue")).toMatchObject({
      href: "/revenue?range=day",
      value: 950,
      breakdownItems: [
        { label: "今日收款", value: "JMD 1,250" },
        { label: "今日退款", value: "JMD 300" },
      ],
      footerItems: [
        { label: "收款记录", value: "2 笔" },
        { label: "退款记录", value: "1 笔" },
      ],
    });
  });

  it("returns an explicit unconfigured target state instead of a false zero-percent target", async () => {
    const service = new DashboardService(dashboardDatabase({
      orders: [],
      teams: [{ id: 7, name: "机修一组", performance_minor: 320_000 }],
    }));

    const summary = await service.getSummary({
      viewerAccountId: 1,
      now: new Date("2026-08-26T15:00:00Z"),
    });

    expect(summary.header).toMatchObject({
      targetStatus: "not_configured",
      targetCompletionRate: null,
      targetCompletedAmount: 3200,
      targetTotalAmount: null,
    });
    expect(summary.teamPerformance.teams).toEqual([expect.objectContaining({
      id: "7",
      currentAmount: 3200,
      targetStatus: "not_configured",
      completionRate: null,
      targetAmount: null,
    })]);
  });

  it("projects active repair orders and pending review work from formal order status", async () => {
    const service = new DashboardService(dashboardDatabase({
      orders: [
        { id: 1, status: "waiting_assignment", created_at: new Date("2026-08-26T10:00:00Z"), total_due_minor: 0, total_paid_minor: 0, total_refunded_minor: 0 },
        { id: 2, status: "in_repair", created_at: new Date("2026-08-26T11:00:00Z"), total_due_minor: 0, total_paid_minor: 0, total_refunded_minor: 0 },
        { id: 3, status: "return_pending_review", created_at: new Date("2026-08-26T12:00:00Z"), total_due_minor: 0, total_paid_minor: 0, total_refunded_minor: 0 },
        { id: 4, status: "formally_handed_off", created_at: new Date("2026-08-26T13:00:00Z"), total_due_minor: 0, total_paid_minor: 0, total_refunded_minor: 0 },
      ],
    }));

    const summary = await service.getSummary({
      viewerAccountId: 1,
      now: new Date("2026-08-26T15:00:00Z"),
    });

    expect(card(summary, "vehicles_stuck")).toMatchObject({
      title: "在厂业务单",
      subtitle: "当前未正式交单的 Business Order",
      value: 3,
    });
    expect(card(summary, "internal_tasks")).toMatchObject({
      title: "待审核回单",
      subtitle: "当前等待前台审核的维修回单",
      value: 1,
    });
  });

  it("keeps current-month handoff performance for a team retired after the handoff", async () => {
    const queries: string[] = [];
    const service = new DashboardService(dashboardDatabase({
      orders: [],
      teams: [{ id: 9, name: "已停用维修组", performance_minor: 450_000 }],
      queries,
    }));

    const summary = await service.getSummary({
      viewerAccountId: 1,
      now: new Date("2026-08-26T15:00:00Z"),
    });

    expect(summary.header.targetCompletedAmount).toBe(4500);
    expect(summary.teamPerformance.teams).toEqual([
      expect.objectContaining({ id: "9", name: "已停用维修组", currentAmount: 4500 }),
    ]);
    expect(queries.find((query) => query.includes("from repair_teams as team")))
      .toMatch(/team\.is_active\s*=\s*true\s+or\s+handoff\.id\s+is\s+not\s+null/i);
    expect(queries[0]).toMatch(/set transaction isolation level repeatable read read only/i);
  });
});
