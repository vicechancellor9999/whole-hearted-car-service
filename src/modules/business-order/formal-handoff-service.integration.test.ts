import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import { BusinessOrderService } from "@/modules/business-order/business-order-service";
import {
  FormalHandoffService,
  FormalHandoffValidationError,
  FormalHandoffWriteDeniedError,
} from "@/modules/business-order/formal-handoff-service";
import { RepairRoundService } from "@/modules/business-order/repair-round-service";

const migrationPaths = [
  "0000_foundation.sql",
  "0001_account_permissions.sql",
  "0002_master_data.sql",
  "0003_master_data_facts_append_only.sql",
  "0004_customer_vehicle.sql",
  "0005_customer_vehicle_facts_append_only.sql",
  "0006_customer_identity_rule.sql",
  "0007_customer_trn_registry.sql",
  "0008_customer_trn_registry_sync.sql",
  "0009_business_order_core.sql",
  "0010_business_order_facts_append_only.sql",
  "0011_repair_rounds.sql",
  "0012_inspection_reports.sql",
  "0013_formal_handoffs.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let businessOrders: BusinessOrderService;
let repairRounds: RepairRoundService;
let formalHandoffs: FormalHandoffService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let mechanicAccountId: number;
let mechanicStaffId: number;
let teamId: number;
let vehicleId: number;
let hourUnitId: number;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      const result = await source.query<Row>(text, [...parameters]);
      return result.rows;
    },
  };
}

function testDatabase(source: PGlite): AuthSqlDatabase {
  return {
    ...executor(source),
    transaction(callback) {
      return source.transaction((transaction) => callback(executor(transaction)));
    },
  };
}

function context(actorAccountId: number, requestId: string, at: string) {
  return {
    actorAccountId,
    requestId,
    now: new Date(at),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

async function seedAccount(name: string, username: string, role: string) {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ($1, $2, 'test-hash', $3::account_role, false)
     returning id`,
    [name, username, role],
  );
  return Number(result.rows[0].id);
}

async function roundVersion(businessOrderId: number) {
  return (await repairRounds.getCurrentRound({
    businessOrderId,
    viewerAccountId: adminId,
  })).version;
}

async function createApprovedOrder() {
  const order = await businessOrders.createBusinessOrder({
    vehicleId,
    context: context(frontDeskId, "create-order", "2026-08-24T14:00:00Z"),
  });
  const charges = await businessOrders.replaceChargeVersion({
    businessOrderId: order.id,
    expectedBusinessOrderVersion: order.version,
    reason: "客户确认收费",
    laborDiscount: "1000",
    partDiscount: "0",
    otherDiscount: "0",
    wholeOrderDiscount: "500",
    items: [{
      kind: "labor",
      nameZh: "发动机诊断",
      nameEn: "Engine diagnosis",
      unitItemId: hourUnitId,
      quantity: "2",
      unitPrice: "10000",
      itemDiscount: "2000",
    }],
    notes: [{
      kind: "liability_notice",
      contentZh: "客户已知悉诊断范围。",
      contentEn: "The customer acknowledges the diagnostic scope.",
    }],
    context: context(frontDeskId, "set-charges", "2026-08-24T14:01:00Z"),
  });
  await repairRounds.assignRound({
    businessOrderId: order.id,
    expectedBusinessOrderVersion: charges.businessOrderVersion,
    teamId,
    customerConfirmedWithoutPayment: true,
    context: context(frontDeskId, "assign", "2026-08-24T14:02:00Z"),
  });
  await repairRounds.acceptRound({
    businessOrderId: order.id,
    expectedRepairRoundVersion: await roundVersion(order.id),
    context: context(mechanicAccountId, "accept", "2026-08-24T14:03:00Z"),
  });
  const workReturn = await repairRounds.submitWorkReturn({
    businessOrderId: order.id,
    expectedRepairRoundVersion: await roundVersion(order.id),
    workSummary: "完成发动机诊断",
    actualStaffMemberId: mechanicStaffId,
    context: context(mechanicAccountId, "return", "2026-08-24T14:04:00Z"),
  });
  await repairRounds.approveWorkReturn({
    businessOrderId: order.id,
    expectedRepairRoundVersion: await roundVersion(order.id),
    workReturnId: workReturn.id,
    context: context(frontDeskId, "approve", "2026-08-24T14:05:00Z"),
  });
  return { order, charges };
}

describe("FormalHandoffService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    mechanicAccountId = await seedAccount("维修工", "mechanic", "mechanic");
    const units = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, label_en, created_by)
       values ('charge_unit', 'hour', '工时', 'hour', $1)
       returning id`,
      [adminId],
    );
    hourUnitId = Number(units.rows[0].id);
    const position = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, created_by)
       values ('staff_position', 'mechanic', '维修工', $1) returning id`,
      [adminId],
    );
    const teams = await database.query<{ id: number }>(
      `insert into repair_teams
        (team_no, name, normalized_name, created_by)
       values ('TEAM-202608-0001', '维修一组', '维修一组', $1)
       returning id`,
      [adminId],
    );
    teamId = Number(teams.rows[0].id);
    const staff = await database.query<{ id: number }>(
      `insert into staff_members
        (staff_no, full_name, account_id, position_item_id, current_team_id,
         hired_on, created_by)
       values ('STAFF-202608-0001', '维修工', $1, $2, $3,
               date '2026-08-01', $4)
       returning id`,
      [mechanicAccountId, position.rows[0].id, teamId, adminId],
    );
    mechanicStaffId = Number(staff.rows[0].id);
    const person = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', $1)
       returning id`,
      [adminId],
    );
    const vehicle = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [person.rows[0].id, adminId],
    );
    vehicleId = Number(vehicle.rows[0].id);
    const testDb = testDatabase(database);
    businessOrders = new BusinessOrderService(testDb);
    repairRounds = new RepairRoundService(testDb);
    formalHandoffs = new FormalHandoffService(testDb);
  });

  afterEach(async () => database.close());

  it("freezes the approved round, team, performance and current charge snapshot", async () => {
    const { order, charges } = await createApprovedOrder();
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff", "2026-09-01T15:30:00Z"),
    });

    expect(handoff).toMatchObject({
      handoffNo: 1,
      businessOrderId: order.id,
      repairRoundNo: 1,
      teamId,
      performanceMinor: 2_000_000,
      jamaicaMonth: "2026-09",
      chargeVersionNo: charges.versionNo,
      chargeSnapshot: {
        totals: {
          grossMinor: 2_000_000,
          lineDiscountMinor: 200_000,
          laborDiscountMinor: 100_000,
          wholeOrderDiscountMinor: 50_000,
          totalDueMinor: 1_650_000,
        },
        items: [expect.objectContaining({ nameZh: "发动机诊断" })],
        notes: [expect.objectContaining({ contentZh: "客户已知悉诊断范围。" })],
      },
    });
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({ status: "formally_handed_off" });

    const latestOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    await businessOrders.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: latestOrder.version,
      reason: "交单后新增收费项目",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "0",
      items: [],
      notes: [],
      context: context(frontDeskId, "change-after-handoff", "2026-09-01T04:40:00Z"),
    });
    await expect(formalHandoffs.listFormalHandoffs({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toEqual([expect.objectContaining({
      id: handoff.id,
      chargeVersionNo: charges.versionNo,
      chargeSnapshot: expect.objectContaining({
        totals: expect.objectContaining({ totalDueMinor: 1_650_000 }),
      }),
    })]);
  });

  it("rejects formal handoff until the latest work return is approved", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "create-unapproved", "2026-08-24T14:00:00Z"),
    });
    await expect(formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "0",
      context: context(frontDeskId, "handoff-unapproved", "2026-08-24T14:01:00Z"),
    })).rejects.toBeInstanceOf(FormalHandoffValidationError);
  });

  it("cancels only an active handoff in the same Jamaica month and keeps both facts", async () => {
    const { order } = await createApprovedOrder();
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "-20000",
      context: context(adminId, "handoff-negative", "2026-09-01T15:30:00Z"),
    });
    await expect(formalHandoffs.cancelFormalHandoffInSameMonth({
      formalHandoffId: handoff.id,
      reason: "交单内容录入错误",
      context: context(frontDeskId, "late-cancel", "2026-10-01T05:01:00Z"),
    })).rejects.toBeInstanceOf(FormalHandoffValidationError);

    const cancellation = await formalHandoffs.cancelFormalHandoffInSameMonth({
      formalHandoffId: handoff.id,
      reason: "交单内容录入错误",
      context: context(frontDeskId, "same-month-cancel", "2026-09-20T15:00:00Z"),
    });
    expect(cancellation).toMatchObject({
      formalHandoffId: handoff.id,
      reason: "交单内容录入错误",
      jamaicaMonth: "2026-09",
    });
    await expect(formalHandoffs.cancelFormalHandoffInSameMonth({
      formalHandoffId: handoff.id,
      reason: "重复取消",
      context: context(adminId, "duplicate-cancel", "2026-09-21T15:00:00Z"),
    })).rejects.toBeInstanceOf(FormalHandoffValidationError);

    const facts = await database.query<{ handoffs: number; cancellations: number }>(
      `select
         (select count(*)::integer from formal_handoffs) as handoffs,
         (select count(*)::integer from formal_handoff_cancellations) as cancellations`,
    );
    expect(facts.rows[0]).toEqual({ handoffs: 1, cancellations: 1 });
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({ status: "return_pending_review" });
    await expect(database.query(
      `insert into repair_round_events
        (repair_round_id, event_type, formal_handoff_id,
         actor_account_id, occurred_at)
       values ($1, 'formally_handed_off', $2, $3, $4)`,
      [handoff.repairRoundId, handoff.id, handoff.handedOffBy,
        handoff.handedOffAt],
    )).rejects.toThrow(/repair round event does not match the current state/);
  });

  it("creates a new handoff fact after same-month cancellation", async () => {
    const { order } = await createApprovedOrder();
    const first = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "first-handoff", "2026-09-01T15:30:00Z"),
    });
    await formalHandoffs.cancelFormalHandoffInSameMonth({
      formalHandoffId: first.id,
      reason: "需要重新确认绩效值",
      context: context(frontDeskId, "cancel-first", "2026-09-02T15:00:00Z"),
    });
    const second = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "18000",
      context: context(frontDeskId, "second-handoff", "2026-09-03T15:00:00Z"),
    });
    expect(second).toMatchObject({
      handoffNo: 2,
      performanceMinor: 1_800_000,
    });
    expect(second.id).not.toBe(first.id);
  });

  it("keeps the owner read-only and rejects direct changes to handoff facts", async () => {
    const { order } = await createApprovedOrder();
    await expect(formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(ownerId, "owner-handoff", "2026-09-01T15:30:00Z"),
    })).rejects.toBeInstanceOf(FormalHandoffWriteDeniedError);

    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "immutable-handoff", "2026-09-01T15:30:00Z"),
    });
    await expect(database.query(
      "update formal_handoffs set performance_minor = 0 where id = $1",
      [handoff.id],
    )).rejects.toThrow(/formal handoff facts are append-only/);
    await expect(database.query(
      "delete from formal_handoffs where id = $1",
      [handoff.id],
    )).rejects.toThrow(/formal handoff facts are append-only/);
  });

  it("rejects a forged charge snapshot even after the prior handoff is cancelled", async () => {
    const { order } = await createApprovedOrder();
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-forgery", "2026-09-01T15:30:00Z"),
    });
    await formalHandoffs.cancelFormalHandoffInSameMonth({
      formalHandoffId: handoff.id,
      reason: "测试收费快照防篡改",
      context: context(frontDeskId, "cancel-before-forgery", "2026-09-02T15:00:00Z"),
    });
    await expect(database.query(
      `insert into formal_handoffs
        (business_order_id, handoff_no, repair_round_id, repair_round_no,
         team_id, performance_minor, jamaica_month,
         charge_version_id, charge_version_no,
         gross_minor, line_discount_minor,
         labor_discount_minor, part_discount_minor, other_discount_minor,
         category_discount_minor, whole_order_discount_minor,
         total_due_minor, included_gct_minor, charge_snapshot,
         handed_off_at, handed_off_by)
       select business_order_id, 2, repair_round_id, repair_round_no,
              team_id, performance_minor, jamaica_month,
              charge_version_id, charge_version_no,
              gross_minor, line_discount_minor,
              labor_discount_minor, part_discount_minor, other_discount_minor,
              category_discount_minor, whole_order_discount_minor,
              total_due_minor, included_gct_minor, '{}'::jsonb,
              timestamp with time zone '2026-09-03T15:00:00Z', $2
       from formal_handoffs where id = $1`,
      [handoff.id, frontDeskId],
    )).rejects.toThrow(/item and note snapshot does not match/);
  });
});
