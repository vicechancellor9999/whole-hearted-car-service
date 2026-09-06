import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { BusinessOrderService } from "@formal/modules/business-order/business-order-service";
import {
  FormalHandoffService,
  FormalHandoffValidationError,
  FormalHandoffWriteDeniedError,
} from "@formal/modules/business-order/formal-handoff-service";
import {
  RepairRoundService,
  RepairRoundValidationError,
} from "@formal/modules/business-order/repair-round-service";

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
  "0018_business_order_number_format.sql",
  "0019_repair_assignment_withdrawal.sql",
  "0021_optional_work_return_details.sql",
  "0020_repair_assignment_withdrawal_projection.sql",
  "0027_record_deletion_runtime.sql",
  "0028_record_deletion_authorization.sql",
  "0029_record_deletion_primary_guard.sql",
  "0040_business_order_problem_descriptions.sql",
  "0041_problem_description_record_deletion.sql",
  "0043_repair_round_performance_draft.sql",
  "0044_invalid_repair_round_deletion.sql",
  "0046_repair_round_performance_guard.sql",
  "0047_formal_handoff_performance_corrections.sql",
  "0049_business_order_categories.sql",
  "0051_business_order_pending_quotes.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));
const attachmentMigrationPath = resolve(process.cwd(), "drizzle/0032_business_order_attachments.sql");
const workReturnClosureMigrationPath = resolve(process.cwd(), "drizzle/0038_work_return_review_closure.sql");

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

async function completeIntake(businessOrderId: number) {
  await repairRounds.recordIntakeMileage({
    businessOrderId,
    expectedRepairRoundVersion: await roundVersion(businessOrderId),
    odometerKm: 84_200,
    context: context(mechanicAccountId, "record-intake-mileage", "2026-08-24T14:03:10Z"),
  });
  const file = await database.query<{ id: number }>(
    `insert into stored_files
      (storage_key, original_name, media_type, size_bytes, sha256_hex,
       uploaded_by, uploaded_at)
     values ($1, '里程照片.jpg', 'image/jpeg', 100, $2, $3, $4)
     returning id`,
    [`vehicle-files/intake-${businessOrderId}.jpg`, "d".repeat(64), mechanicAccountId,
      new Date("2026-08-24T14:03:20Z")],
  );
  await database.query(
    `insert into vehicle_attachments
      (vehicle_id, file_id, kind, caption, linked_by, linked_at)
     values ($1, $2, 'photo', '接车里程照片', $3, $4)`,
    [vehicleId, file.rows[0].id, mechanicAccountId, new Date("2026-08-24T14:03:20Z")],
  );
  await repairRounds.attachIntakePhoto({
    businessOrderId,
    expectedRepairRoundVersion: await roundVersion(businessOrderId),
    fileId: Number(file.rows[0].id),
    context: context(mechanicAccountId, "attach-intake-photo", "2026-08-24T14:03:30Z"),
  });
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
  await completeIntake(order.id);
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
  await repairRounds.setPerformanceDraft({
    businessOrderId: order.id,
    expectedRepairRoundId: (await repairRounds.getCurrentRound({ businessOrderId: order.id, viewerAccountId: adminId })).id,
    expectedRepairRoundVersion: await roundVersion(order.id),
    performanceValue: "20000",
    context: context(frontDeskId, "set-performance-draft", "2026-08-24T14:05:30Z"),
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
    await database.exec(`
      create table business_order_messages (
        id bigint primary key generated always as identity,
        business_order_id bigint not null references business_orders(id) on delete restrict
      );
    `);
    for (const path of [attachmentMigrationPath, workReturnClosureMigrationPath]) {
      const migration = await readFile(path, "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await database.exec(statement);
      }
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

  it("allows handoff with pending prices while freezing their explicit status", async () => {
    const { order } = await createApprovedOrder();
    const current = await businessOrders.getBusinessOrder({ businessOrderId: order.id, viewerAccountId: frontDeskId });
    await businessOrders.replaceChargeVersion({
      businessOrderId: order.id, expectedBusinessOrderVersion: current.version,
      reason: "记录待报价", laborDiscount: "0", partDiscount: "0", otherDiscount: "0", wholeOrderDiscount: "0", notes: [],
      items: [
        { kind: "labor", nameZh: "诊断", unitItemId: hourUnitId, quantity: "1", unitPrice: "20000", itemDiscount: "0" },
        { kind: "part", nameZh: "待报价配件", unitItemId: hourUnitId, quantity: "1", unitPrice: "", itemDiscount: "0", pendingQuote: true },
      ], context: context(frontDeskId, "pending-handoff-charge", "2026-08-24T15:00:00Z"),
    });
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id, expectedRepairRoundVersion: await roundVersion(order.id), performanceValue: "20000",
      context: context(frontDeskId, "pending-handoff", "2026-08-24T15:30:00Z"),
    });
    expect(handoff.chargeSnapshot.items[0]).not.toHaveProperty("pendingQuote");
    expect(handoff.chargeSnapshot.items[1]).toMatchObject({ pendingQuote: true, unitPriceMinor: 0 });
    expect(handoff.performanceMinor).toBe(2000000);
  });

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
          wholeOrderDiscountMinor: 0,
          totalDueMinor: 1_700_000,
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
        totals: expect.objectContaining({ totalDueMinor: 1_700_000 }),
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
    await repairRounds.setPerformanceDraft({
      businessOrderId: order.id,
      expectedRepairRoundId: (await repairRounds.getCurrentRound({ businessOrderId: order.id, viewerAccountId: adminId })).id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "-20000",
      context: context(adminId, "set-negative-performance", "2026-09-01T15:29:00Z"),
    });
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "-20000",
      context: context(adminId, "handoff-negative", "2026-09-01T15:30:00Z"),
    });
    await expect(formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: order.id,
      formalHandoffId: handoff.id,
      reason: "交单内容录入错误",
      context: context(frontDeskId, "late-cancel", "2026-10-01T05:01:00Z"),
    })).rejects.toBeInstanceOf(FormalHandoffValidationError);

    const cancellation = await formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: order.id,
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
      businessOrderId: order.id,
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

  it("does not cancel a handoff that belongs to another Business Order", async () => {
    const { order: handoffOrder } = await createApprovedOrder();
    const { order: otherOrder } = await createApprovedOrder();
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: handoffOrder.id,
      expectedRepairRoundVersion: await roundVersion(handoffOrder.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-for-other-order-cancel", "2026-09-01T15:30:00Z"),
    });

    await expect(formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: otherOrder.id,
      formalHandoffId: handoff.id + 10_000,
      reason: "不存在的交单",
      context: context(frontDeskId, "unknown-handoff-cancel", "2026-09-02T14:59:00Z"),
    })).rejects.toMatchObject({ status: 404, code: "formal_handoff_not_found" });
    await expect(formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: otherOrder.id,
      formalHandoffId: handoff.id,
      reason: "不应取消其他订单的交单",
      context: context(frontDeskId, "wrong-order-cancel", "2026-09-02T15:00:00Z"),
    })).rejects.toMatchObject({ status: 404, code: "formal_handoff_not_found" });

    await expect(formalHandoffs.listFormalHandoffs({
      businessOrderId: handoffOrder.id,
      viewerAccountId: ownerId,
    })).resolves.toEqual([expect.objectContaining({
      id: handoff.id,
      cancellation: null,
    })]);
    await expect(repairRounds.getCurrentRound({
      businessOrderId: handoffOrder.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({ status: "formally_handed_off" });
    const cancellations = await database.query<{ count: number }>(
      "select count(*)::integer as count from formal_handoff_cancellations",
    );
    expect(cancellations.rows[0]).toEqual({ count: 0 });
  });

  it("does not cancel a first-round handoff after an after-sales round becomes current", async () => {
    const { order } = await createApprovedOrder();
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "first-round-handoff-before-after-sales", "2026-09-01T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    const afterSalesRound = await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "客户反馈异响",
      context: context(frontDeskId, "start-after-sales-before-first-cancel", "2026-09-02T15:00:00Z"),
    });

    await expect(formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: order.id,
      formalHandoffId: handoff.id,
      reason: "不应取消已被售后轮次替代的交单",
      context: context(frontDeskId, "cancel-noncurrent-first-handoff", "2026-09-03T15:00:00Z"),
    })).rejects.toBeInstanceOf(FormalHandoffValidationError);

    await expect(formalHandoffs.listFormalHandoffs({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toEqual([expect.objectContaining({ id: handoff.id, cancellation: null })]);
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({
      id: afterSalesRound.id,
      status: "waiting_assignment",
    });
    const cancellations = await database.query<{ count: number }>(
      "select count(*)::integer as count from formal_handoff_cancellations",
    );
    expect(cancellations.rows[0]).toEqual({ count: 0 });
  });

  it("allows exactly one concurrent same-month cancellation", async () => {
    const { order } = await createApprovedOrder();
    const handoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-concurrent-cancel", "2026-09-01T15:30:00Z"),
    });

    const results = await Promise.allSettled([
      formalHandoffs.cancelFormalHandoffInSameMonth({
        businessOrderId: order.id,
        formalHandoffId: handoff.id,
        reason: "第一次并发取消",
        context: context(frontDeskId, "concurrent-cancel-one", "2026-09-02T15:00:00Z"),
      }),
      formalHandoffs.cancelFormalHandoffInSameMonth({
        businessOrderId: order.id,
        formalHandoffId: handoff.id,
        reason: "第二次并发取消",
        context: context(frontDeskId, "concurrent-cancel-two", "2026-09-02T15:00:00Z"),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(FormalHandoffValidationError) });
    const cancellations = await database.query<{ count: number }>(
      "select count(*)::integer as count from formal_handoff_cancellations",
    );
    expect(cancellations.rows[0]).toEqual({ count: 1 });
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
      businessOrderId: order.id,
      formalHandoffId: first.id,
      reason: "需要重新确认绩效值",
      context: context(frontDeskId, "cancel-first", "2026-09-02T15:00:00Z"),
    });
    await repairRounds.setPerformanceDraft({
      businessOrderId: order.id,
      expectedRepairRoundId: (await repairRounds.getCurrentRound({ businessOrderId: order.id, viewerAccountId: adminId })).id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "18000",
      context: context(frontDeskId, "set-second-performance", "2026-09-03T14:59:00Z"),
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

  it("starts an independent after-sales repair round while preserving the first round and handoff", async () => {
    const { order } = await createApprovedOrder();
    const firstHandoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "first-round-handoff", "2026-08-24T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });

    const secondRound = await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "客户反馈维修后异响仍然存在",
      context: context(frontDeskId, "start-after-sales", "2026-09-05T15:00:00Z"),
    });

    expect(secondRound).toMatchObject({
      businessOrderId: order.id,
      roundNo: 2,
      source: "after_sales",
      afterSalesIssue: "客户反馈维修后异响仍然存在",
      performanceDraftMinor: 0,
      status: "waiting_assignment",
      assignedTeamId: null,
    });
    const history = await repairRounds.listRepairRounds({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      roundNo: 1,
      source: "initial",
      afterSalesIssue: null,
      formalHandoffs: [{
        id: firstHandoff.id,
        performanceMinor: 2_000_000,
        jamaicaMonth: "2026-08",
        cancelledAt: null,
      }],
    });
    expect(history[1]).toMatchObject({
      roundNo: 2,
      source: "after_sales",
      afterSalesIssue: "客户反馈维修后异响仍然存在",
      performanceDraftMinor: 0,
      formalHandoffs: [],
    });
    await expect(formalHandoffs.listFormalHandoffs({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toEqual([expect.objectContaining({ id: firstHandoff.id })]);
  });

  it("rejects a later-round handoff when an old client resubmits the whole-order labor value", async () => {
    const { order } = await createApprovedOrder();
    await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "first-round-before-mismatch", "2026-08-24T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "售后复查",
      context: context(frontDeskId, "start-later-round-mismatch", "2026-08-25T15:00:00Z"),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: (await businessOrders.getBusinessOrder({
        businessOrderId: order.id,
        viewerAccountId: adminId,
      })).version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "assign-later-round-mismatch", "2026-08-25T15:01:00Z"),
    });
    await repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      context: context(mechanicAccountId, "accept-later-round-mismatch", "2026-08-25T15:02:00Z"),
    });
    await repairRounds.recordPaperWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      attachmentIds: [],
      workSummary: "售后复查完成",
      context: context(frontDeskId, "return-later-round-mismatch", "2026-08-25T15:03:00Z"),
    });

    await expect(formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-later-round-mismatch", "2026-08-25T15:05:00Z"),
    })).rejects.toThrow(/本轮绩效/);

    const active = await database.query<{ count: number }>(
      `select count(*)::int as count
       from formal_handoffs as handoff
       left join formal_handoff_cancellations as cancellation
         on cancellation.formal_handoff_id = handoff.id
       where handoff.business_order_id = $1 and cancellation.id is null`,
      [order.id],
    );
    expect(active.rows).toEqual([{ count: 1 }]);
  });

  it("rejects a mismatched performance fact inserted outside the service", async () => {
    const { order } = await createApprovedOrder();
    const first = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-direct-bypass", "2026-08-24T15:30:00Z"),
    });
    await formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: order.id,
      formalHandoffId: first.id,
      reason: "测试数据库绩效约束",
      context: context(frontDeskId, "cancel-before-direct-bypass", "2026-08-25T15:30:00Z"),
    });

    await expect(database.query(
      `insert into formal_handoffs
        (business_order_id, handoff_no, repair_round_id, repair_round_no,
         team_id, performance_minor, jamaica_month, charge_version_id,
         charge_version_no, gross_minor, line_discount_minor,
         labor_discount_minor, part_discount_minor, other_discount_minor,
         category_discount_minor, whole_order_discount_minor, total_due_minor,
         included_gct_minor, charge_snapshot, handed_off_at, handed_off_by)
       select business_order_id, handoff_no + 1, repair_round_id, repair_round_no,
              team_id, 999, jamaica_month, charge_version_id,
              charge_version_no, gross_minor, line_discount_minor,
              labor_discount_minor, part_discount_minor, other_discount_minor,
              category_discount_minor, whole_order_discount_minor, total_due_minor,
              included_gct_minor, charge_snapshot, $2, handed_off_by
       from formal_handoffs
       where id = $1`,
      [first.id, new Date("2026-08-26T15:30:00Z")],
    )).rejects.toThrow(/performance does not match repair round/);
  });

  it("adjusts a handed-off round in the same month by preserving the old fact and creating a replacement", async () => {
    const { order } = await createApprovedOrder();
    const first = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-performance-adjustment", "2026-08-24T15:30:00Z"),
    });

    const replacement = await formalHandoffs.adjustFormalHandoffPerformanceInSameMonth({
      businessOrderId: order.id,
      formalHandoffId: first.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "18000",
      reason: "本轮绩效录入错误",
      context: context(frontDeskId, "adjust-handed-off-performance", "2026-08-25T15:30:00Z"),
    });

    expect(replacement).toMatchObject({
      handoffNo: 2,
      repairRoundId: first.repairRoundId,
      repairRoundNo: first.repairRoundNo,
      performanceMinor: 1_800_000,
      cancellation: null,
    });
    const facts = await formalHandoffs.listFormalHandoffs({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    });
    expect(facts).toEqual([
      expect.objectContaining({
        id: first.id,
        performanceMinor: 2_000_000,
        cancellation: expect.objectContaining({ reason: "绩效调整:本轮绩效录入错误" }),
      }),
      expect.objectContaining({
        id: replacement.id,
        performanceMinor: 1_800_000,
        cancellation: null,
      }),
    ]);
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({
      status: "formally_handed_off",
      performanceDraftMinor: 1_800_000,
    });
    const audits = await database.query<{
      event_type: string;
      before_state: { performanceMinor: number } | null;
      after_state: { performanceMinor: number } | null;
      reason: string | null;
    }>(
      `select event_type, before_state, after_state, reason
       from audit_events
       where request_id = 'adjust-handed-off-performance'
       order by id`,
    );
    expect(audits.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "business_order.formal_handoff_cancelled" }),
      expect.objectContaining({
        event_type: "business_order.performance_adjusted",
        before_state: expect.objectContaining({ performanceMinor: 2_000_000 }),
        after_state: expect.objectContaining({ performanceMinor: 1_800_000 }),
        reason: "本轮绩效录入错误",
      }),
      expect.objectContaining({ event_type: "business_order.formally_handed_off" }),
    ]));
  });

  it("adjusts an earlier round without changing its frozen charges or the current round workflow", async () => {
    const { order, charges } = await createApprovedOrder();
    const first = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-r1-before-historical-adjustment", "2026-08-24T15:30:00Z"),
    });

    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    const changedCharges = await businessOrders.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      reason: "第二轮开始前调整整单收费",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "0",
      items: [{
        kind: "labor",
        nameZh: "售后复查",
        nameEn: "After-sales inspection",
        unitItemId: hourUnitId,
        quantity: "1",
        unitPrice: "30000",
        itemDiscount: "0",
      }],
      notes: [{
        kind: "work_instruction",
        contentZh: "这是第二轮使用的新收费说明。",
        contentEn: "This charge note belongs to the second round.",
      }],
      context: context(frontDeskId, "change-charges-before-r2", "2026-08-25T15:00:00Z"),
    });
    expect(changedCharges.versionNo).not.toBe(charges.versionNo);

    const secondRound = await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: changedCharges.businessOrderVersion,
      issue: "客户反馈需要复查",
      context: context(frontDeskId, "start-r2-before-r1-adjustment", "2026-08-26T15:00:00Z"),
    });
    const roundsBefore = await repairRounds.listRepairRounds({
      businessOrderId: order.id,
      viewerAccountId: adminId,
      now: new Date("2026-08-27T15:00:00Z"),
    });
    const firstRoundBefore = roundsBefore.find((round) => round.roundNo === 1);
    if (!firstRoundBefore) throw new Error("第一轮维修不存在");
    expect(firstRoundBefore.formalHandoffs.find((handoff) => !handoff.cancelledAt)).toMatchObject({
      id: first.id,
      performanceAdjustmentAllowed: true,
      performanceAdjustmentUnavailableReason: null,
    });
    const closedMonthHistory = await repairRounds.listRepairRounds({
      businessOrderId: order.id,
      viewerAccountId: adminId,
      now: new Date("2026-09-01T05:00:00Z"),
    });
    expect(closedMonthHistory.find((round) => round.roundNo === 1)?.formalHandoffs.find((handoff) => !handoff.cancelledAt)).toMatchObject({
      id: first.id,
      performanceAdjustmentAllowed: false,
      performanceAdjustmentUnavailableReason: "closed_month",
    });
    const currentRoundBefore = await repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });

    const replacement = await formalHandoffs.adjustFormalHandoffPerformanceInSameMonth({
      businessOrderId: order.id,
      formalHandoffId: first.id,
      expectedRepairRoundVersion: firstRoundBefore.version,
      performanceValue: "18000",
      reason: "第一轮绩效录入错误",
      context: context(frontDeskId, "adjust-r1-after-r2-started", "2026-08-27T15:00:00Z"),
    });

    expect(replacement).toMatchObject({
      repairRoundId: first.repairRoundId,
      repairRoundNo: 1,
      performanceMinor: 1_800_000,
      chargeVersionId: first.chargeVersionId,
      chargeVersionNo: first.chargeVersionNo,
      chargeSnapshot: first.chargeSnapshot,
    });
    const frozenAmounts = await database.query<Record<string, number>>(
      `select gross_minor, line_discount_minor, labor_discount_minor,
              part_discount_minor, other_discount_minor,
              category_discount_minor, whole_order_discount_minor,
              total_due_minor, included_gct_minor
       from formal_handoffs
       where id in ($1, $2)
       order by id`,
      [first.id, replacement.id],
    );
    expect(frozenAmounts.rows).toHaveLength(2);
    expect(frozenAmounts.rows[1]).toEqual(frozenAmounts.rows[0]);

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      id: secondRound.id,
      roundNo: 2,
      status: currentRoundBefore.status,
      version: currentRoundBefore.version,
      performanceDraftMinor: currentRoundBefore.performanceDraftMinor,
    });
    const activePerformance = await database.query<{ total: number; count: number }>(
      `select coalesce(sum(handoff.performance_minor), 0)::int as total,
              count(*)::int as count
       from formal_handoffs as handoff
       left join formal_handoff_cancellations as cancellation
         on cancellation.formal_handoff_id = handoff.id
       where handoff.business_order_id = $1
         and cancellation.id is null`,
      [order.id],
    );
    expect(activePerformance.rows).toEqual([{ total: 1_800_000, count: 1 }]);
  });

  it("cancels an empty after-sales round created by mistake and restores the handed-off round", async () => {
    const { order } = await createApprovedOrder();
    await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-cancel-after-sales", "2026-08-24T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    const secondRound = await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "误触创建",
      context: context(frontDeskId, "start-after-sales-to-cancel", "2026-08-25T15:00:00Z"),
    });

    await expect(repairRounds.cancelAfterSalesRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: secondRound.version,
      context: context(frontDeskId, "cancel-empty-after-sales", "2026-08-25T15:01:00Z"),
    })).resolves.toEqual({ cancelled: true });

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({ roundNo: 1, status: "formally_handed_off" });
    await expect(repairRounds.listRepairRounds({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toHaveLength(1);
    const audits = await database.query<{ event_type: string }>(
      "select event_type from audit_events where request_id = 'cancel-empty-after-sales'",
    );
    expect(audits.rows).toEqual([{ event_type: "business_order.after_sales_round_cancelled" }]);
  });

  it("does not cancel an after-sales round after it has been assigned", async () => {
    const { order } = await createApprovedOrder();
    await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-noncancellable-after-sales", "2026-08-24T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    const secondRound = await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "真实售后问题",
      context: context(frontDeskId, "start-after-sales-before-assignment", "2026-08-25T15:00:00Z"),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: (await businessOrders.getBusinessOrder({
        businessOrderId: order.id,
        viewerAccountId: adminId,
      })).version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "assign-after-sales", "2026-08-25T15:01:00Z"),
    });

    await expect(repairRounds.cancelAfterSalesRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: secondRound.version + 1,
      context: context(frontDeskId, "cancel-assigned-after-sales", "2026-08-25T15:02:00Z"),
    })).rejects.toBeInstanceOf(RepairRoundValidationError);
  });

  it("previews and permanently deletes a fully-invalidated after-sales chain, then restores the prior round", async () => {
    const { order } = await createApprovedOrder();
    await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-invalid-chain", "2026-08-24T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    await repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "误建测试轮次",
      context: context(frontDeskId, "start-invalid-chain", "2026-08-25T15:00:00Z"),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: (await businessOrders.getBusinessOrder({
        businessOrderId: order.id,
        viewerAccountId: adminId,
      })).version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "assign-invalid-chain", "2026-08-25T15:01:00Z"),
    });
    await repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      context: context(mechanicAccountId, "accept-invalid-chain", "2026-08-25T15:02:00Z"),
    });
    await repairRounds.recordPaperWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      attachmentIds: [],
      workSummary: "测试回单",
      context: context(frontDeskId, "return-invalid-chain", "2026-08-25T15:03:00Z"),
    });
    await repairRounds.setPerformanceDraft({
      businessOrderId: order.id,
      expectedRepairRoundId: (await repairRounds.getCurrentRound({ businessOrderId: order.id, viewerAccountId: adminId })).id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "54400",
      context: context(frontDeskId, "set-invalid-chain-performance", "2026-08-25T15:04:00Z"),
    });
    const invalidHandoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "54400",
      context: context(frontDeskId, "handoff-invalid-chain", "2026-08-25T15:05:00Z"),
    });
    await formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: order.id,
      formalHandoffId: invalidHandoff.id,
      reason: "整轮测试数据无效",
      context: context(frontDeskId, "cancel-invalid-chain-handoff", "2026-08-25T15:06:00Z"),
    });
    const preview = await repairRounds.getAfterSalesRoundDeletionPreview({
      businessOrderId: order.id,
      viewerAccountId: frontDeskId,
    });
    if (!preview) throw new Error("售后轮次删除预览不存在");
    expect(preview).toMatchObject({
      eligible: true,
      recordNo: `${handedOffOrder.orderNo}/R2`,
      roundNo: 2,
      counts: {
        workReturns: 1,
        formalHandoffs: 1,
        formalHandoffCancellations: 1,
      },
      blockers: [],
    });
    expect(preview.counts.events).toBeGreaterThanOrEqual(6);

    await expect(repairRounds.deleteInvalidAfterSalesRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: preview.repairRoundVersion,
      previewFingerprint: preview.previewFingerprint,
      reasonCode: "test_data",
      reasonNote: "误建后完成的整条测试链路",
      confirmationRecordNo: preview.recordNo,
      context: context(frontDeskId, "delete-invalid-after-sales-chain", "2026-08-25T15:08:00Z"),
    })).resolves.toMatchObject({ cancelled: true, deletedRoundNo: 2, restoredRoundNo: 1 });

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({ roundNo: 1, status: "formally_handed_off" });
    const counts = await database.query<Record<string, number>>(
      `select
         (select count(*)::int from repair_rounds where business_order_id = $1 and round_no = 2) as rounds,
         (select count(*)::int from repair_round_events where repair_round_id = $2) as events,
         (select count(*)::int from repair_round_work_returns where repair_round_id = $2) as returns,
         (select count(*)::int from formal_handoffs where repair_round_id = $2) as handoffs`,
      [order.id, invalidHandoff.repairRoundId],
    );
    expect(counts.rows[0]).toMatchObject({ rounds: 0, events: 0, returns: 0, handoffs: 0 });
    const retainedPerformance = await database.query<{
      handoff_count: number;
      performance_minor: number;
    }>(
      `select count(*)::int as handoff_count,
              coalesce(sum(performance_minor), 0)::int as performance_minor
       from formal_handoffs where business_order_id = $1`,
      [order.id],
    );
    expect(retainedPerformance.rows).toEqual([{
      handoff_count: 1,
      performance_minor: 2_000_000,
    }]);
    const receipt = await database.query<{ root_kind: string; root_record_no: string }>(
      `select root_kind, root_record_no from record_deletion_receipts
       where request_id = 'delete-invalid-after-sales-chain'`,
    );
    expect(receipt.rows).toEqual([{
      root_kind: "repair_round",
      root_record_no: `${handedOffOrder.orderNo}/R2`,
    }]);
    const auditReason = await database.query<{ reason: string | null }>(
      `select reason from audit_events
       where request_id = 'delete-invalid-after-sales-chain'
         and event_type = 'business_order.invalid_after_sales_round_deleted'`,
    );
    expect(auditReason.rows).toEqual([{
      reason: "test_data: 误建后完成的整条测试链路",
    }]);
  });

  it("requires an active formal handoff and a nonempty issue before starting after-sales", async () => {
    const { order } = await createApprovedOrder();
    const approvedOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    await expect(repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: approvedOrder.version,
      issue: "售后问题",
      context: context(frontDeskId, "after-sales-before-handoff", "2026-08-24T15:00:00Z"),
    })).rejects.toBeInstanceOf(RepairRoundValidationError);

    await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await roundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "handoff-before-invalid-after-sales", "2026-08-24T15:30:00Z"),
    });
    const handedOffOrder = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    await expect(repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "   ",
      context: context(frontDeskId, "empty-after-sales-issue", "2026-08-24T16:00:00Z"),
    })).rejects.toBeInstanceOf(RepairRoundValidationError);
    await expect(repairRounds.startAfterSalesRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: handedOffOrder.version,
      issue: "客户反馈异响",
      context: context(ownerId, "owner-start-after-sales", "2026-08-24T16:01:00Z"),
    })).rejects.toMatchObject({ status: 403 });
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
      businessOrderId: order.id,
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
