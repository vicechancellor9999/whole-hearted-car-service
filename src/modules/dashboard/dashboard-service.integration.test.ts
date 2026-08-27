import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";
import { DashboardService } from "@formal/modules/dashboard/dashboard-service";
import { RevenueService } from "@formal/modules/revenue/revenue-service";

let source: PGlite | undefined;
let database: AuthSqlDatabase;

beforeEach(async () => {
  database = await dashboardDatabase();
});

afterEach(async () => {
  await source?.close();
  source = undefined;
});

async function dashboardDatabase(): Promise<AuthSqlDatabase> {
  source = new PGlite();
  await source.waitReady;
  await source.exec(`
    create table staff_accounts (id bigint primary key, is_active boolean not null, role text not null);
    create table business_orders (
      id bigint primary key,
      status text not null,
      created_at timestamptz not null,
      voided_at timestamptz,
      current_charge_version_no integer not null
    );
    create table business_order_charge_versions (
      business_order_id bigint not null,
      version_no integer not null,
      total_due_minor bigint not null
    );
    create table business_order_payments (
      id bigint primary key,
      business_order_id bigint not null,
      payment_method_item_id bigint,
      payment_method_code_snapshot text,
      payment_method_label_zh_snapshot text,
      payment_method_label_en_snapshot text,
      amount_minor bigint not null,
      paid_at timestamptz not null
    );
    create table business_order_refunds (
      id bigint primary key,
      business_order_id bigint not null,
      payment_method_item_id bigint,
      payment_method_code_snapshot text,
      payment_method_label_zh_snapshot text,
      payment_method_label_en_snapshot text,
      amount_minor bigint not null,
      refunded_at timestamptz not null
    );
    create table dictionary_items (
      id bigint primary key,
      code text not null,
      label_zh text,
      label_en text
    );
    create table repair_teams (id bigint primary key, name text not null, is_active boolean not null);
    create table staff_members (
      id bigint primary key,
      full_name text not null,
      hired_on date not null,
      left_on date
    );
    create table staff_team_assignment_versions (
      staff_member_id bigint not null,
      effective_month date not null,
      team_id bigint not null
    );
    create table employee_salary_versions (
      staff_member_id bigint not null,
      effective_month date not null,
      base_salary_cny_minor bigint not null
    );
    create table payroll_parameter_versions (
      effective_month date not null,
      commission_rate numeric not null,
      cny_to_jmd_rate numeric not null
    );
    create table formal_handoffs (
      id bigint primary key,
      business_order_id bigint not null,
      handed_off_at timestamptz not null,
      team_id bigint not null,
      jamaica_month date not null,
      performance_minor bigint not null
    );
    create table formal_handoff_cancellations (
      id bigint primary key,
      formal_handoff_id bigint not null
    );

    insert into staff_accounts values (1, true, 'owner');
    insert into dictionary_items values (30, 'cash', '新版现金', 'New cash');
    insert into business_orders values
      (100, 'waiting_assignment', '2026-08-26T10:00:00Z', '2026-08-26T11:00:00Z', 1),
      (200, 'formally_handed_off', '2026-08-26T09:00:00Z', null, 1),
      (300, 'formally_handed_off', '2026-08-26T16:00:00Z', null, 1);
    insert into business_order_charge_versions values
      (100, 1, 0),
      (200, 1, 100000),
      (300, 1, 500000);
    insert into business_order_payments values
      (40, 100, 30, 'cash', '历史现金', 'Historical cash', 100000, '2026-08-26T12:00:00Z'),
      (41, 200, 30, 'cash', '历史现金', 'Historical cash', 20000, '2026-08-26T14:00:00Z'),
      (42, 200, 30, 'cash', '历史现金', 'Historical cash', 50000, '2026-08-26T16:00:00Z');
    insert into business_order_refunds values
      (50, 100, 30, 'cash', '历史现金', 'Historical cash', 30000, '2026-08-26T13:00:00Z'),
      (51, 200, 30, 'cash', '历史现金', 'Historical cash', 5000, '2026-08-26T14:30:00Z'),
      (52, 200, 30, 'cash', '历史现金', 'Historical cash', 10000, '2026-08-26T16:30:00Z');
    insert into repair_teams values
      (1, '活跃但交单已取消组', true),
      (2, '已停用但有有效交单组', false),
      (3, '活跃但只有未来交单组', true),
      (4, '已停用且只有作废单交单组', false);
    insert into formal_handoffs values
      (10, 200, '2026-08-10T15:00:00Z', 1, date '2026-08-01', 120000),
      (11, 200, '2026-08-11T15:00:00Z', 2, date '2026-08-01', 450000),
      (12, 200, '2026-08-26T16:00:00Z', 3, date '2026-08-01', 200000),
      (13, 100, '2026-08-12T15:00:00Z', 4, date '2026-08-01', 900000);
    insert into formal_handoff_cancellations values (20, 10);
  `);

  const database: AuthSqlDatabase = {
    async query<Row extends Record<string, unknown>>(text: string, parameters = []) {
      return (await source!.query<Row>(text, [...parameters])).rows;
    },
    async transaction(callback) {
      return source!.transaction(async (transaction) => callback({
        async query<Row extends Record<string, unknown>>(text: string, parameters = []) {
          return (await transaction.query<Row>(text, [...parameters])).rows;
        },
      }));
    },
  };
  return database;
}

describe("DashboardService database projection", () => {
  it("keeps active zero-performance teams and retired teams with valid current-month handoffs", async () => {
    const service = new DashboardService(database);

    const summary = await service.getSummary({
      viewerAccountId: 1,
      now: new Date("2026-08-26T15:00:00Z"),
    });

    expect(summary.header.targetCompletedAmount).toBe(4500);
    expect(summary.periods[0]).toMatchObject({
      grossPaidJmd: 200,
      cashRefundedJmd: 50,
      netPaidJmd: 150,
      businessOrderCount: 1,
      submittedOrderCount: 0,
    });
    expect(summary.periods[2]).toMatchObject({ submittedOrderCount: 1 });
    const teams = summary.teamPerformance.teams.map((team) => ({
      name: team.name,
      currentAmount: team.currentAmount,
    }));
    expect(teams).toHaveLength(3);
    expect(teams).toEqual(expect.arrayContaining([
      { name: "活跃但交单已取消组", currentAmount: 0 },
      { name: "活跃但只有未来交单组", currentAmount: 0 },
      { name: "已停用但有有效交单组", currentAmount: 4500 },
    ]));
    expect(summary.topCards.find((card) => card.id === "accounts_receivable")).toMatchObject({
      value: 850,
      footerItems: expect.arrayContaining([
        { label: "当前应收", value: "JMD 1,000" },
      ]),
    });

    const revenue = await new RevenueService(database).getDetail({
      viewerAccountId: 1,
      range: "day",
      now: new Date("2026-08-26T15:00:00Z"),
    });
    expect(revenue.summary).toMatchObject({
      grossPaidJmd: 200,
      cashRefundedJmd: 50,
      netPaidJmd: 150,
      methods: [
        { method: "历史现金", total: 150, paymentCount: 2 },
      ],
    });
  });
});
