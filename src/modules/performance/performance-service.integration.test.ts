import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { BusinessOrderService } from "@formal/modules/business-order/business-order-service";
import { FormalHandoffService } from "@formal/modules/business-order/formal-handoff-service";
import { RepairRoundService } from "@formal/modules/business-order/repair-round-service";
import {
  PerformanceReadDeniedError,
  PerformanceService,
  PerformanceValidationError,
} from "@formal/modules/performance/performance-service";

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
  "0014_payments_receipts_refunds.sql",
  "0015_business_order_documents.sql",
  "0016_vehicle_profile_fields.sql",
  "0017_optional_vehicle_plate.sql",
  "0018_business_order_number_format.sql",
  "0019_repair_assignment_withdrawal.sql",
  "0020_repair_assignment_withdrawal_projection.sql",
  "0021_optional_work_return_details.sql",
  "0022_glamorous_wild_child.sql",
  "0023_vehicle_pickup_presence.sql",
  "0024_team_commission_rate_versions.sql",
  "0025_fantastic_dakota_north.sql",
  "0026_customer_driver_license_append_only.sql",
  "0027_record_deletion_runtime.sql",
  "0028_record_deletion_authorization.sql",
  "0029_record_deletion_primary_guard.sql",
  "0030_business_order_customer_copy.sql",
  "0031_business_order_messages.sql",
  "0032_business_order_attachments.sql",
  "0033_record_deletion_collaboration_files.sql",
  "0034_repair_team_sort_order.sql",
  "0035_business_order_document_revisions.sql",
  "0036_business_order_document_english_files.sql",
  "0037_staff_account_ui_language.sql",
  "0038_work_return_review_closure.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let businessOrders: BusinessOrderService;
let repairRounds: RepairRoundService;
let formalHandoffs: FormalHandoffService;
let performance: PerformanceService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let mechanicOneAccountId: number;
let mechanicTwoAccountId: number;
let mechanicOneStaffId: number;
let mechanicTwoStaffId: number;
let teamOneId: number;
let teamTwoId: number;
let vehicleId: number;
let hourUnitId: number;
let cashMethodId: number;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      return (await source.query<Row>(text, [...parameters])).rows;
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
  return Number((await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ($1, $2, 'test-hash', $3::account_role, false)
     returning id`,
    [name, username, role],
  )).rows[0].id);
}

async function currentRoundVersion(businessOrderId: number) {
  return (await repairRounds.getCurrentRound({
    businessOrderId,
    viewerAccountId: adminId,
  })).version;
}

async function completeElectronicIntake(input: {
  businessOrderId: number;
  mechanicAccountId: number;
  requestPrefix: string;
  at: string;
}) {
  await repairRounds.recordIntakeMileage({
    businessOrderId: input.businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(input.businessOrderId),
    odometerKm: 84_200,
    context: context(
      input.mechanicAccountId,
      `${input.requestPrefix}-mileage`,
      input.at,
    ),
  });
  const file = await database.query<{ id: number }>(
    `insert into stored_files
      (storage_key, original_name, media_type, size_bytes, sha256_hex,
       uploaded_by, uploaded_at)
     values ($1, '里程照片.jpg', 'image/jpeg', 100, $2, $3, $4)
     returning id`,
    [`vehicle-files/${input.requestPrefix}-intake.jpg`, "d".repeat(64),
      input.mechanicAccountId, new Date(input.at)],
  );
  await database.query(
    `insert into vehicle_attachments
      (vehicle_id, file_id, kind, caption, linked_by, linked_at)
     values ($1, $2, 'photo', '接车里程照片', $3, $4)`,
    [vehicleId, file.rows[0].id, input.mechanicAccountId, new Date(input.at)],
  );
  await repairRounds.attachIntakePhoto({
    businessOrderId: input.businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(input.businessOrderId),
    fileId: Number(file.rows[0].id),
    context: context(
      input.mechanicAccountId,
      `${input.requestPrefix}-photo`,
      input.at,
    ),
  });
}

async function createApprovedRound(input: {
  teamId: number;
  mechanicAccountId: number;
  mechanicStaffId: number;
  requestPrefix: string;
  createdAt: string;
}) {
  const order = await businessOrders.createBusinessOrder({
    vehicleId,
    context: context(frontDeskId, `${input.requestPrefix}-create`, input.createdAt),
  });
  const charges = await businessOrders.replaceChargeVersion({
    businessOrderId: order.id,
    expectedBusinessOrderVersion: order.version,
    reason: "客户确认收费",
    laborDiscount: "0",
    partDiscount: "0",
    otherDiscount: "0",
    wholeOrderDiscount: "0",
    items: [{
      kind: "labor",
      nameZh: "发动机诊断",
      unitItemId: hourUnitId,
      quantity: "1",
      unitPrice: "20000",
      itemDiscount: "0",
    }],
    notes: [],
    context: context(frontDeskId, `${input.requestPrefix}-charge`, input.createdAt),
  });
  await repairRounds.assignRound({
    businessOrderId: order.id,
    expectedBusinessOrderVersion: charges.businessOrderVersion,
    teamId: input.teamId,
    customerConfirmedWithoutPayment: true,
    context: context(frontDeskId, `${input.requestPrefix}-assign`, input.createdAt),
  });
  await repairRounds.acceptRound({
    businessOrderId: order.id,
    expectedRepairRoundVersion: await currentRoundVersion(order.id),
    context: context(input.mechanicAccountId, `${input.requestPrefix}-accept`, input.createdAt),
  });
  await completeElectronicIntake({
    businessOrderId: order.id,
    mechanicAccountId: input.mechanicAccountId,
    requestPrefix: input.requestPrefix,
    at: input.createdAt,
  });
  const workReturn = await repairRounds.submitWorkReturn({
    businessOrderId: order.id,
    expectedRepairRoundVersion: await currentRoundVersion(order.id),
    workSummary: "维修工作完成",
    actualStaffMemberId: input.mechanicStaffId,
    context: context(input.mechanicAccountId, `${input.requestPrefix}-return`, input.createdAt),
  });
  await repairRounds.approveWorkReturn({
    businessOrderId: order.id,
    expectedRepairRoundVersion: await currentRoundVersion(order.id),
    workReturnId: workReturn.id,
    context: context(frontDeskId, `${input.requestPrefix}-approve`, input.createdAt),
  });
  return order;
}

async function approveCurrentAfterSalesRound(input: {
  businessOrderId: number;
  teamId: number;
  mechanicAccountId: number;
  mechanicStaffId: number;
  requestPrefix: string;
  at: string;
}) {
  const order = await businessOrders.getBusinessOrder({
    businessOrderId: input.businessOrderId,
    viewerAccountId: adminId,
  });
  await repairRounds.startAfterSalesRound({
    businessOrderId: input.businessOrderId,
    expectedBusinessOrderVersion: order.version,
    issue: "客户反馈原问题仍然存在",
    context: context(frontDeskId, `${input.requestPrefix}-start`, input.at),
  });
  const afterSalesOrder = await businessOrders.getBusinessOrder({
    businessOrderId: input.businessOrderId,
    viewerAccountId: adminId,
  });
  await repairRounds.assignRound({
    businessOrderId: input.businessOrderId,
    expectedBusinessOrderVersion: afterSalesOrder.version,
    teamId: input.teamId,
    customerConfirmedWithoutPayment: true,
    context: context(frontDeskId, `${input.requestPrefix}-assign`, input.at),
  });
  await repairRounds.acceptRound({
    businessOrderId: input.businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(input.businessOrderId),
    context: context(input.mechanicAccountId, `${input.requestPrefix}-accept`, input.at),
  });
  await completeElectronicIntake({
    businessOrderId: input.businessOrderId,
    mechanicAccountId: input.mechanicAccountId,
    requestPrefix: input.requestPrefix,
    at: input.at,
  });
  const workReturn = await repairRounds.submitWorkReturn({
    businessOrderId: input.businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(input.businessOrderId),
    workSummary: "售后维修处理完成",
    actualStaffMemberId: input.mechanicStaffId,
    context: context(input.mechanicAccountId, `${input.requestPrefix}-return`, input.at),
  });
  await repairRounds.approveWorkReturn({
    businessOrderId: input.businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(input.businessOrderId),
    workReturnId: workReturn.id,
    context: context(frontDeskId, `${input.requestPrefix}-approve`, input.at),
  });
}

describe("PerformanceService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    mechanicOneAccountId = await seedAccount("维修一组成员", "mechanic.one", "mechanic");
    mechanicTwoAccountId = await seedAccount("维修二组成员", "mechanic.two", "mechanic");
    const dictionary = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, label_en, created_by)
       values
        ('charge_unit', 'hour', '工时', 'hour', $1),
        ('payment_method', 'cash', '现金', 'Cash', $1),
        ('staff_position', 'mechanic', '维修工', 'Mechanic', $1)
       returning id`,
      [adminId],
    );
    hourUnitId = Number(dictionary.rows[0].id);
    cashMethodId = Number(dictionary.rows[1].id);
    const positionId = Number(dictionary.rows[2].id);
    const teams = await database.query<{ id: number }>(
      `insert into repair_teams
        (team_no, name, normalized_name, created_by)
       values
        ('TEAM-202608-0001', '维修一组', '维修一组', $1),
        ('TEAM-202608-0002', '维修二组', '维修二组', $1)
       returning id`,
      [adminId],
    );
    teamOneId = Number(teams.rows[0].id);
    teamTwoId = Number(teams.rows[1].id);
    const staff = await database.query<{ id: number }>(
      `insert into staff_members
        (staff_no, full_name, account_id, position_item_id, current_team_id,
         hired_on, created_by)
       values
        ('STAFF-202608-0001', '维修一组成员', $1, $3, $4, date '2026-08-01', $6),
        ('STAFF-202608-0002', '维修二组成员', $2, $3, $5, date '2026-08-01', $6)
       returning id`,
      [mechanicOneAccountId, mechanicTwoAccountId, positionId,
        teamOneId, teamTwoId, adminId],
    );
    mechanicOneStaffId = Number(staff.rows[0].id);
    mechanicTwoStaffId = Number(staff.rows[1].id);
    const customerId = Number((await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', $1)
       returning id`,
      [adminId],
    )).rows[0].id);
    vehicleId = Number((await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, make, model,
         current_person_customer_id, created_by)
       values ('VEH-202608-0001', '7012 AB', '7012AB', 'Honda', 'CR-V', $1, $2)
       returning id`,
      [customerId, adminId],
    )).rows[0].id);
    const testDb = testDatabase(database);
    businessOrders = new BusinessOrderService(testDb);
    repairRounds = new RepairRoundService(testDb);
    formalHandoffs = new FormalHandoffService(testDb);
    performance = new PerformanceService(testDb);
  });

  afterEach(async () => database.close());

  it("sums effective handoffs by Jamaica month and team across after-sales rounds", async () => {
    const order = await createApprovedRound({
      teamId: teamOneId,
      mechanicAccountId: mechanicOneAccountId,
      mechanicStaffId: mechanicOneStaffId,
      requestPrefix: "round-one",
      createdAt: "2026-08-24T15:00:00Z",
    });
    await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      performanceValue: "20000",
      context: context(frontDeskId, "august-handoff", "2026-08-31T15:00:00Z"),
    });
    await approveCurrentAfterSalesRound({
      businessOrderId: order.id,
      teamId: teamTwoId,
      mechanicAccountId: mechanicTwoAccountId,
      mechanicStaffId: mechanicTwoStaffId,
      requestPrefix: "round-two",
      at: "2026-09-02T15:00:00Z",
    });
    const septemberHandoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      performanceValue: "-20000",
      context: context(frontDeskId, "september-handoff", "2026-09-03T15:00:00Z"),
    });

    const cancelledOrder = await createApprovedRound({
      teamId: teamOneId,
      mechanicAccountId: mechanicOneAccountId,
      mechanicStaffId: mechanicOneStaffId,
      requestPrefix: "cancelled-round",
      createdAt: "2026-09-04T15:00:00Z",
    });
    const cancelledHandoff = await formalHandoffs.formallyHandOffRound({
      businessOrderId: cancelledOrder.id,
      expectedRepairRoundVersion: await currentRoundVersion(cancelledOrder.id),
      performanceValue: "5000",
      context: context(frontDeskId, "cancelled-handoff", "2026-09-04T16:00:00Z"),
    });
    await formalHandoffs.cancelFormalHandoffInSameMonth({
      businessOrderId: cancelledOrder.id,
      formalHandoffId: cancelledHandoff.id,
      reason: "当月重新确认绩效",
      context: context(frontDeskId, "cancel-handoff", "2026-09-05T15:00:00Z"),
    });

    await database.query(
      `insert into business_order_refunds
        (refund_no, business_order_id, payment_method_item_id,
         payment_method_code_snapshot, payment_method_label_zh_snapshot,
         payment_method_label_en_snapshot, amount_minor, reason,
         original_document_status, refunded_at, recorded_by)
       values ('RFD-20260906-0001', $1, $2, 'cash', '现金', 'Cash',
               300000, '客户退款', 'returned', $3, $4)`,
      [order.id, cashMethodId, new Date("2026-09-06T15:00:00Z"), adminId],
    );

    await expect(performance.getMonthlyPerformance({
      month: "2026-08",
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({
      month: "2026-08",
      totalPerformanceMinor: 2_000_000,
      cancelledHandoffCount: 0,
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      completionRate: null,
      teams: expect.arrayContaining([expect.objectContaining({
        teamId: teamOneId,
        teamName: "维修一组",
        handoffCount: 1,
        cancelledHandoffCount: 0,
        performanceMinor: 2_000_000,
        targetStatus: "not_configured",
        targetPerformanceMinor: null,
        completionRate: null,
        targetMissingReasons: ["缺少 2026-08 绩效参数"],
      }), expect.objectContaining({
        teamId: teamTwoId,
        teamName: "维修二组",
        handoffCount: 0,
        cancelledHandoffCount: 0,
        performanceMinor: 0,
        targetStatus: "not_configured",
        targetPerformanceMinor: null,
        completionRate: null,
        targetMissingReasons: ["缺少 2026-08 绩效参数"],
      })]),
    });
    const september = await performance.getMonthlyPerformance({
      month: "2026-09",
      viewerAccountId: ownerId,
    });
    expect(september).toMatchObject({
      month: "2026-09",
      totalPerformanceMinor: -2_000_000,
      cancelledHandoffCount: 1,
      targetStatus: "not_configured",
    });
    expect(september.teams).toEqual(expect.arrayContaining([expect.objectContaining({
        teamId: teamTwoId,
        teamName: "维修二组",
        handoffCount: 1,
        cancelledHandoffCount: 0,
        performanceMinor: -2_000_000,
      })]));
    expect(september.teams).toEqual(expect.arrayContaining([expect.objectContaining({
      teamId: teamOneId,
      cancelledHandoffCount: 1,
    })]));
    expect(september.handoffs).toEqual([expect.objectContaining({
      id: septemberHandoff.id,
      businessOrderId: order.id,
      repairRoundNo: 2,
      teamId: teamTwoId,
      performanceMinor: -2_000_000,
      plateDisplay: "7012 AB",
    })]);
  });

  it("validates the month and keeps mechanic accounts out of the PC performance view", async () => {
    await expect(performance.getMonthlyPerformance({
      month: "2026-13",
      viewerAccountId: ownerId,
    })).rejects.toBeInstanceOf(PerformanceValidationError);
    await expect(performance.getMonthlyPerformance({
      month: "2026-08",
      viewerAccountId: mechanicOneAccountId,
    })).rejects.toBeInstanceOf(PerformanceReadDeniedError);
  });

  it("uses the latest effective payroll, salary and team versions to calculate monthly targets", async () => {
    await database.query(
      `insert into staff_team_assignment_versions
        (staff_member_id, effective_month, team_id, set_by)
       values ($1, date '2026-08-01', $3, $5),
              ($2, date '2026-08-01', $4, $5)`,
      [mechanicOneStaffId, mechanicTwoStaffId, teamOneId, teamTwoId, adminId],
    );
    await database.query(
      `insert into employee_salary_versions
        (staff_member_id, effective_month, base_salary_cny_minor, set_by)
       values ($1, date '2026-08-01', 200000, $3),
              ($2, date '2026-08-01', 100000, $3)`,
      [mechanicOneStaffId, mechanicTwoStaffId, adminId],
    );
    await database.query(
      `insert into payroll_parameter_versions
        (effective_month, commission_rate, cny_to_jmd_rate, set_by)
       values (date '2026-07-01', 0.25, 22, $1)`,
      [adminId],
    );

    const august = await performance.getMonthlyPerformance({
      month: "2026-08",
      viewerAccountId: ownerId,
    });

    expect(august).toMatchObject({
      targetStatus: "configured",
      targetPerformanceMinor: 26_400_000,
      completionRate: 0,
      targetMissingReasons: [],
      teams: expect.arrayContaining([expect.objectContaining({
        teamId: teamOneId,
        targetStatus: "configured",
        targetPerformanceMinor: 17_600_000,
        completionRate: 0,
        targetMissingReasons: [],
      }), expect.objectContaining({
        teamId: teamTwoId,
        targetStatus: "configured",
        targetPerformanceMinor: 8_800_000,
        completionRate: 0,
        targetMissingReasons: [],
      })]),
    });
  });

  it("uses a team special rate until a later version restores the whole-shop default", async () => {
    await database.query(
      `insert into staff_team_assignment_versions
        (staff_member_id, effective_month, team_id, set_by)
       values ($1, date '2026-08-01', $3, $5),
              ($2, date '2026-08-01', $4, $5)`,
      [mechanicOneStaffId, mechanicTwoStaffId, teamOneId, teamTwoId, adminId],
    );
    await database.query(
      `insert into employee_salary_versions
        (staff_member_id, effective_month, base_salary_cny_minor, set_by)
       values ($1, date '2026-08-01', 200000, $3),
              ($2, date '2026-08-01', 100000, $3)`,
      [mechanicOneStaffId, mechanicTwoStaffId, adminId],
    );
    await database.query(
      `insert into payroll_parameter_versions
        (effective_month, commission_rate, cny_to_jmd_rate, set_by)
       values (date '2026-07-01', 0.25, 22, $1)`,
      [adminId],
    );
    await database.query(
      `insert into team_commission_rate_versions
        (team_id, effective_month, commission_rate, set_by)
       values ($1, date '2026-08-01', 0.20, $2),
              ($1, date '2026-09-01', null, $2)`,
      [teamTwoId, adminId],
    );

    const august = await performance.getMonthlyPerformance({
      month: "2026-08",
      viewerAccountId: ownerId,
    });
    const september = await performance.getMonthlyPerformance({
      month: "2026-09",
      viewerAccountId: ownerId,
    });

    expect(august).toMatchObject({
      targetPerformanceMinor: 28_600_000,
      teams: expect.arrayContaining([expect.objectContaining({
        teamId: teamTwoId,
        targetPerformanceMinor: 11_000_000,
      })]),
    });
    expect(september).toMatchObject({
      targetPerformanceMinor: 26_400_000,
      teams: expect.arrayContaining([expect.objectContaining({
        teamId: teamTwoId,
        targetPerformanceMinor: 8_800_000,
      })]),
    });
  });

  it("returns the named member when an effective salary is missing", async () => {
    await database.query(
      `insert into staff_team_assignment_versions
        (staff_member_id, effective_month, team_id, set_by)
       values ($1, date '2026-08-01', $2, $3)`,
      [mechanicOneStaffId, teamOneId, adminId],
    );
    await database.query(
      `insert into payroll_parameter_versions
        (effective_month, commission_rate, cny_to_jmd_rate, set_by)
       values (date '2026-08-01', 0.25, 22, $1)`,
      [adminId],
    );

    await expect(performance.getMonthlyPerformance({
      month: "2026-08",
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      completionRate: null,
      targetMissingReasons: ["维修一组：维修一组成员缺少月标准工资"],
      teams: expect.arrayContaining([expect.objectContaining({
        teamId: teamOneId,
        targetStatus: "not_configured",
        targetMissingReasons: ["维修一组：维修一组成员缺少月标准工资"],
      })]),
    });
  });
});
