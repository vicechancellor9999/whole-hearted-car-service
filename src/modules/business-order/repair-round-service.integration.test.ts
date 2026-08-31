import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { BusinessOrderService } from "@formal/modules/business-order/business-order-service";
import {
  RepairRoundService,
  RepairRoundReadDeniedError,
  RepairRoundValidationError,
  RepairRoundWriteDeniedError,
} from "@formal/modules/business-order/repair-round-service";
import { MasterDataService } from "@formal/modules/master-data/master-data-service";

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
  "0040_business_order_problem_descriptions.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));
const attachmentMigrationPath = resolve(process.cwd(), "drizzle/0032_business_order_attachments.sql");
const workReturnClosureMigrationPath = resolve(process.cwd(), "drizzle/0038_work_return_review_closure.sql");

let database: PGlite;
let businessOrders: BusinessOrderService;
let repairRounds: RepairRoundService;
let masterData: MasterDataService;
let adminId: number;
let frontDeskId: number;
let mechanicAccountId: number;
let otherMechanicAccountId: number;
let mechanicStaffId: number;
let teamId: number;
let otherTeamId: number;
let vehicleId: number;

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

function context(actorAccountId: number, requestId: string, minute = 0) {
  return {
    actorAccountId,
    requestId,
    now: new Date(`2026-08-24T15:${String(minute).padStart(2, "0")}:00Z`),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

async function currentRoundVersion(businessOrderId: number) {
  const round = await repairRounds.getCurrentRound({
    businessOrderId,
    viewerAccountId: adminId,
  });
  return round.version;
}

async function completeIntake(businessOrderId: number, minute: number) {
  await repairRounds.recordIntakeMileage({
    businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(businessOrderId),
    odometerKm: 84_200 + minute,
    context: context(mechanicAccountId, `req-mileage-${businessOrderId}`, minute),
  });
  const file = await database.query<{ id: number }>(
    `insert into stored_files
      (storage_key, original_name, media_type, size_bytes, sha256_hex,
       uploaded_by, uploaded_at)
     values ($1, '里程照片.jpg', 'image/jpeg', 100, $2, $3, $4)
     returning id`,
    [`vehicle-files/intake-${businessOrderId}.jpg`, "d".repeat(64), mechanicAccountId,
      context(mechanicAccountId, `seed-intake-${businessOrderId}`, minute).now],
  );
  await database.query(
    `insert into vehicle_attachments
      (vehicle_id, file_id, kind, caption, linked_by, linked_at)
     values ($1, $2, 'photo', '接车里程照片', $3, $4)`,
    [vehicleId, file.rows[0].id, mechanicAccountId,
      context(mechanicAccountId, `seed-intake-${businessOrderId}`, minute).now],
  );
  await repairRounds.attachIntakePhoto({
    businessOrderId,
    expectedRepairRoundVersion: await currentRoundVersion(businessOrderId),
    fileId: Number(file.rows[0].id),
    context: context(mechanicAccountId, `req-photo-${businessOrderId}`, minute),
  });
}

describe("RepairRoundService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
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
    mechanicAccountId = await seedAccount("维修工一号", "mechanic.one", "mechanic");
    otherMechanicAccountId = await seedAccount("维修工二号", "mechanic.two", "mechanic");
    const position = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, created_by)
       values ('staff_position', 'mechanic', '维修工', $1) returning id`,
      [adminId],
    );
    const teams = await database.query<{ id: number }>(
      `insert into repair_teams
        (team_no, name, normalized_name, created_by)
       values
        ('TEAM-202608-0001', '维修一组', '维修一组', $1),
        ('TEAM-202608-0002', '维修二组', '维修二组', $1)
       returning id`,
      [adminId],
    );
    teamId = Number(teams.rows[0].id);
    otherTeamId = Number(teams.rows[1].id);
    const staff = await database.query<{ id: number }>(
      `insert into staff_members
        (staff_no, full_name, account_id, position_item_id, current_team_id,
         hired_on, created_by)
       values
        ('STAFF-202608-0001', '维修工一号', $1, $3, $4, date '2026-08-01', $6),
        ('STAFF-202608-0002', '维修工二号', $2, $3, $5, date '2026-08-01', $6)
       returning id`,
      [mechanicAccountId, otherMechanicAccountId, position.rows[0].id,
        teamId, otherTeamId, adminId],
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
    masterData = new MasterDataService(testDb);
  });

  afterEach(async () => database.close());

  it("creates round one and returns without any facts when unpaid assignment is not confirmed", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create", 0),
    });
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      roundNo: 1,
      status: "waiting_assignment",
      assignedTeamId: null,
    });
    await expect(repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: false,
      context: context(frontDeskId, "req-return-without-confirmation", 1),
    })).resolves.toEqual({ assigned: false });
    const events = await database.query<{ event_type: string }>(
      `select event_type from repair_round_events
       where repair_round_id = (select id from repair_rounds where business_order_id = $1)`,
      [order.id],
    );
    expect(events.rows).toEqual([]);
    const audits = await database.query<{ id: number }>(
      "select id from audit_events where request_id = 'req-return-without-confirmation'",
    );
    expect(audits.rows).toEqual([]);
  });

  it("rejects intake records until the assigned team has accepted the round", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-intake", 0),
    });
    await expect(repairRounds.recordIntakeMileage({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      odometerKm: 84_200,
      context: context(adminId, "req-intake-too-early", 1),
    })).rejects.toBeInstanceOf(RepairRoundValidationError);
    const mileage = await database.query<{ id: number }>(
      "select id from vehicle_mileage_records where business_order_id = $1",
      [order.id],
    );
    expect(mileage.rows).toEqual([]);
  });

  it("lets the front desk record a paper acceptance for a mechanic in the assigned team", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-paper-acceptance", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-before-paper-acceptance", 1),
    });

    await repairRounds.recordAcceptanceOnBehalf({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-paper-acceptance", 2),
    });

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({ status: "in_repair", assignedTeamId: teamId });
    const events = await database.query<{
      event_type: string;
      actor_account_id: number;
      note: string;
    }>(
      `select event_type, actor_account_id, note
       from repair_round_events
       where repair_round_id = (select id from repair_rounds where business_order_id = $1)
       order by id`,
      [order.id],
    );
    expect(events.rows.at(-1)).toEqual({
      event_type: "accepted",
      actor_account_id: frontDeskId,
      note: `纸质接单，实际维修工 staff:${mechanicStaffId}`,
    });
    const audits = await database.query<{ after_state: { actualStaffMemberId: number } }>(
      "select after_state from audit_events where request_id = 'req-paper-acceptance'",
    );
    expect(audits.rows[0]?.after_state.actualStaffMemberId).toBe(mechanicStaffId);
  });

  it("rejects a stale repair-round version before writing a new fact", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-stale-write", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-before-stale-write", 1),
    });
    const assigned = await repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    await repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: assigned.version,
      context: context(mechanicAccountId, "req-accept-before-stale-write", 2),
    });
    await expect(repairRounds.recordIntakeMileage({
      businessOrderId: order.id,
      expectedRepairRoundVersion: assigned.version,
      odometerKm: 84_200,
      context: context(adminId, "req-stale-mileage", 3),
    } as Parameters<RepairRoundService["recordIntakeMileage"]>[0] & {
      expectedRepairRoundVersion: number;
    })).rejects.toThrow();
    const mileage = await database.query<{ id: number }>(
      "select id from vehicle_mileage_records where business_order_id = $1",
      [order.id],
    );
    expect(mileage.rows).toEqual([]);
  });

  it("moves unfinished responsibility to the replacement team without rewriting assignment history", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-team-retire", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-before-team-retire", 1),
    });
    await masterData.retireRepairTeam({
      teamId,
      replacementTeamId: otherTeamId,
      reason: "维修班组合并",
      context: context(adminId, "req-retire-assigned-team", 2),
    });

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({ assignedTeamId: otherTeamId });
    const events = await database.query<{ event_type: string; team_id: number }>(
      `select event_type, team_id from repair_round_events
       where repair_round_id = (select id from repair_rounds where business_order_id = $1)
       order by id`,
      [order.id],
    );
    expect(events.rows).toEqual([
      { event_type: "assigned", team_id: teamId },
      { event_type: "team_responsibility_transferred", team_id: otherTeamId },
    ]);
  });

  it("rejects a responsibility-transfer fact that omits the replacement team", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-invalid-transfer", 0),
    });
    await expect(database.query(
      `insert into repair_round_events
        (repair_round_id, event_type, actor_account_id, occurred_at)
       values (
         (select id from repair_rounds where business_order_id = $1),
         'team_responsibility_transferred', $2, $3
       )`,
      [order.id, adminId, context(adminId, "req-invalid-transfer", 1).now],
    )).rejects.toThrow();
  });

  it("withdraws an accepted assignment without erasing intake facts and allows reassignment", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-withdraw", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-before-withdraw", 1),
    });
    await repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(mechanicAccountId, "req-accept-before-withdraw", 2),
    });
    await repairRounds.recordIntakeMileage({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      odometerKm: 84_200,
      context: context(adminId, "req-mileage-before-withdraw", 3),
    });

    await repairRounds.withdrawAssignment({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(adminId, "req-withdraw-assignment", 4),
    });

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      status: "waiting_assignment",
      assignedTeamId: null,
      intakeMileageKm: 84_200,
    });
    const beforeReassignment = await businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    expect(beforeReassignment.status).toBe("waiting_assignment");
    const history = await repairRounds.listRepairRounds({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    expect(history[0].events.map((event) => [event.eventType, event.teamId])).toEqual([
      ["assigned", teamId],
      ["accepted", teamId],
      ["intake_mileage_recorded", null],
      ["assignment_withdrawn", teamId],
    ]);

    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: beforeReassignment.version,
      teamId: otherTeamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-reassign-after-withdraw", 5),
    });
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      status: "assigned",
      assignedTeamId: otherTeamId,
      intakeMileageKm: 84_200,
    });
  });

  it("does not allow front desk to withdraw an accepted assignment", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-denied-withdraw", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-before-denied-withdraw", 1),
    });

    await expect(repairRounds.withdrawAssignment({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(frontDeskId, "req-denied-withdraw", 2),
    })).rejects.toBeInstanceOf(RepairRoundWriteDeniedError);
  });

  it("rejects direct repair-round status updates that have no event fact", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-direct-status", 0),
    });
    await expect(database.query(
      `update repair_rounds
       set status = 'assigned', assigned_team_id = $2,
           updated_at = $3, version = version + 1
       where business_order_id = $1`,
      [order.id, teamId, context(adminId, "req-direct-status", 1).now],
    )).rejects.toThrow();
  });

  it("rejects direct Business Order status updates that have no repair-round event", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-direct-order-status", 0),
    });
    await expect(database.query(
      `update business_orders
       set status = 'assigned', updated_at = $2, version = version + 1
       where id = $1`,
      [order.id, context(adminId, "req-direct-order-status", 1).now],
    )).rejects.toThrow();
  });

  it("rejects a direct Business Order current-round pointer change", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-direct-round-pointer", 0),
    });
    await expect(database.query(
      `update business_orders
       set current_repair_round_no = 2,
           updated_at = $2, version = version + 1
       where id = $1`,
      [order.id, context(adminId, "req-direct-round-pointer", 1).now],
    )).rejects.toThrow();
  });

  it("rejects an unpaid assignment event without customer confirmation", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-before-unconfirmed-event", 0),
    });
    await expect(database.query(
      `insert into repair_round_events
        (repair_round_id, event_type, team_id,
         customer_confirmed_without_payment, actor_account_id, occurred_at)
       values (
         (select id from repair_rounds where business_order_id = $1),
         'assigned', $2, false, $3, $4
       )`,
      [order.id, teamId, adminId,
        context(adminId, "req-unconfirmed-assignment-event", 1).now],
    )).rejects.toThrow();
  });

  it("keeps assignment, acceptance, intake, returns, rejection and approval as separate facts", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-flow", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign", 1),
    });
    await expect(repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(otherMechanicAccountId, "req-wrong-team", 2),
    })).rejects.toBeInstanceOf(RepairRoundValidationError);
    await repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(mechanicAccountId, "req-accept", 3),
    });
    await repairRounds.recordIntakeMileage({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      odometerKm: 84_200,
      context: context(adminId, "req-mileage", 4),
    });
    const file = await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex,
         uploaded_by, uploaded_at)
       values ('vehicle-files/2026/08/intake.jpg', '接车照片.jpg', 'image/jpeg',
               100, $1, $2, $3) returning id`,
      ["a".repeat(64), mechanicAccountId, context(mechanicAccountId, "seed", 5).now],
    );
    await database.query(
      `insert into vehicle_attachments
        (vehicle_id, file_id, kind, caption, linked_by, linked_at)
       values ($1, $2, 'photo', '第 1 轮接车照片', $3, $4)`,
      [vehicleId, file.rows[0].id, mechanicAccountId,
        context(mechanicAccountId, "seed", 5).now],
    );
    await repairRounds.attachIntakePhoto({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      fileId: Number(file.rows[0].id),
      context: context(mechanicAccountId, "req-photo", 5),
    });
    const firstReturn = await repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(frontDeskId, "req-return-1", 6),
    });
    await repairRounds.returnWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workReturnId: firstReturn.id,
      reason: "缺少试车结果",
      context: context(frontDeskId, "req-reject", 7),
    });
    const secondReturn = await repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workSummary: "补充试车结果：异响已消失",
      actualStaffMemberId: mechanicStaffId,
      context: context(mechanicAccountId, "req-return-2", 8),
    });
    await repairRounds.approveWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workReturnId: secondReturn.id,
      context: context(adminId, "req-approve", 9),
    });

    const round = await repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    expect(round).toMatchObject({
      roundNo: 1,
      assignedTeamId: teamId,
      status: "return_pending_review",
      intakeMileageKm: 84_200,
      intakePhotoFileIds: [Number(file.rows[0].id)],
      latestWorkReturnId: secondReturn.id,
      approvedWorkReturnId: secondReturn.id,
    });
    const events = await database.query<{ event_type: string; occurred_at: Date }>(
      `select event_type, occurred_at from repair_round_events
       where repair_round_id = $1 order by occurred_at, id`,
      [round.id],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "assigned",
      "accepted",
      "intake_mileage_recorded",
      "intake_photo_linked",
      "work_return_submitted",
      "work_return_rejected",
      "work_return_submitted",
      "work_return_approved",
    ]);
    expect(events.rows[0].occurred_at).toEqual(context(frontDeskId, "x", 1).now);
  });

  it("requires both intake mileage and an intake photo before an electronic work return", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-electronic-return", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-electronic-return", 1),
    });
    await repairRounds.acceptRound({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      context: context(mechanicAccountId, "req-accept-electronic-return", 2),
    });

    await expect(repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workSummary: "完成维修并试车",
      context: context(mechanicAccountId, "req-return-without-intake", 3),
    })).rejects.toThrow("接车里程和里程照片");

    await repairRounds.recordIntakeMileage({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      odometerKm: 84_210,
      context: context(mechanicAccountId, "req-mileage-electronic-return", 4),
    });
    await expect(repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workSummary: "完成维修并试车",
      context: context(mechanicAccountId, "req-return-without-photo", 5),
    })).rejects.toThrow("接车里程和里程照片");
  });

  it("does not project an approval from an older submission onto the latest return", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-latest-review", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-latest-review", 1),
    });
    await repairRounds.recordAcceptanceOnBehalf({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-accept-latest-review", 2),
    });
    await completeIntake(order.id, 3);
    const first = await repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-first-latest-review", 4),
    });
    await repairRounds.approveWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workReturnId: first.id,
      context: context(frontDeskId, "req-approve-first-latest-review", 5),
    });
    const round = await repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    const newer = await database.query<{ id: number }>(
      `insert into repair_round_work_returns
        (repair_round_id, submission_no, work_summary, actual_staff_member_id,
         submitted_by, submitted_at)
       values ($1, 2, '补交的新回单', $2, $3, $4)
       returning id`,
      [round.id, mechanicStaffId, frontDeskId, context(frontDeskId, "seed-new-return", 6).now],
    );
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      latestWorkReturnId: Number(newer.rows[0].id),
      approvedWorkReturnId: null,
    });
  });

  it("records a paper return and its approval as one front-desk transaction", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-paper-return", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-paper-return", 1),
    });
    await repairRounds.recordAcceptanceOnBehalf({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-accept-paper-return", 2),
    });
    const file = await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex,
         uploaded_by, uploaded_at)
       values ('business-order-files/paper-return.jpg', '纸质回单.jpg', 'image/jpeg',
               200, $1, $2, $3)
       returning id`,
      ["c".repeat(64), frontDeskId, context(frontDeskId, "seed-paper-return", 3).now],
    );
    const attachment = await database.query<{ id: number }>(
      `insert into business_order_attachments
        (business_order_id, file_id, category, caption, linked_by, linked_at)
       values ($1, $2, 'other', '纸质维修回单', $3, $4)
       returning id`,
      [order.id, file.rows[0].id, frontDeskId, context(frontDeskId, "seed-paper-return", 3).now],
    );

    const service = repairRounds as RepairRoundService & {
      recordPaperWorkReturn(input: {
        businessOrderId: number;
        expectedRepairRoundVersion: number;
        actualStaffMemberId: number;
        attachmentIds: number[];
        workSummary?: string;
        context: ReturnType<typeof context>;
      }): Promise<{ id: number; submissionNo: number }>;
    };
    const result = await service.recordPaperWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      attachmentIds: [Number(attachment.rows[0].id)],
      workSummary: "前台录入纸质回单",
      context: context(frontDeskId, "req-paper-return", 3),
    });
    const facts = await database.query<{ event_type: string; work_return_id: number }>(
      `select event_type, work_return_id from repair_round_events
       where work_return_id = $1 order by id`,
      [result.id],
    );
    expect(facts.rows.map((row) => row.event_type)).toEqual([
      "work_return_submitted",
      "work_return_approved",
    ]);
    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      latestWorkReturnId: result.id,
      approvedWorkReturnId: result.id,
    });
  });

  it("records a paper return and formally hands off in one atomic action", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-paper-handoff", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-paper-handoff", 1),
    });
    await repairRounds.recordAcceptanceOnBehalf({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-accept-paper-handoff", 2),
    });
    const file = await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex,
         uploaded_by, uploaded_at)
       values ('business-order-files/paper-handoff.jpg', '纸质回单.jpg', 'image/jpeg',
               200, $1, $2, $3)
       returning id`,
      ["e".repeat(64), frontDeskId, context(frontDeskId, "seed-paper-handoff", 3).now],
    );
    const attachment = await database.query<{ id: number }>(
      `insert into business_order_attachments
        (business_order_id, file_id, category, caption, linked_by, linked_at)
       values ($1, $2, 'other', '纸质维修回单', $3, $4)
       returning id`,
      [order.id, file.rows[0].id, frontDeskId, context(frontDeskId, "seed-paper-handoff", 3).now],
    );
    const service = repairRounds as RepairRoundService & {
      recordPaperWorkReturnAndFormallyHandOff(input: {
        businessOrderId: number;
        expectedRepairRoundVersion: number;
        actualStaffMemberId: number;
        attachmentIds: number[];
        performanceValue: string;
        context: ReturnType<typeof context>;
      }): Promise<{ id: number }>;
    };

    await expect(service.recordPaperWorkReturnAndFormallyHandOff({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      attachmentIds: [Number(attachment.rows[0].id)],
      performanceValue: "19900",
      context: context(frontDeskId, "req-paper-handoff", 4),
    })).resolves.toMatchObject({ id: expect.any(Number) });

    const round = await repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    });
    expect(round).toMatchObject({ status: "formally_handed_off" });
    const events = await database.query<{ event_type: string }>(
      `select event_type from repair_round_events where repair_round_id = $1 order by id`,
      [round.id],
    );
    expect(events.rows.map((row) => row.event_type).slice(-3)).toEqual([
      "work_return_submitted",
      "work_return_approved",
      "formally_handed_off",
    ]);
  });

  it("approves an electronic return and formally hands off in one atomic action", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-combined-handoff", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-combined-handoff", 1),
    });
    await repairRounds.recordAcceptanceOnBehalf({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-accept-combined-handoff", 2),
    });
    await completeIntake(order.id, 3);
    const workReturn = await repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      workSummary: "维修完成并完成试车",
      context: context(mechanicAccountId, "req-submit-combined-handoff", 4),
    });
    const service = repairRounds as RepairRoundService & {
      approveAndFormallyHandOff(input: {
        businessOrderId: number;
        expectedRepairRoundVersion: number;
        workReturnId: number;
        performanceValue: string;
        context: ReturnType<typeof context>;
      }): Promise<{ id: number }>;
    };

    await expect(service.approveAndFormallyHandOff({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workReturnId: workReturn.id,
      performanceValue: "19900",
      context: context(frontDeskId, "req-combined-handoff", 5),
    })).resolves.toMatchObject({ id: expect.any(Number) });

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      status: "formally_handed_off",
      approvedWorkReturnId: workReturn.id,
    });
    const handoffs = await database.query<{ performance_minor: number }>(
      `select performance_minor from formal_handoffs where business_order_id = $1`,
      [order.id],
    );
    expect(handoffs.rows).toEqual([{ performance_minor: 1_990_000 }]);
  });

  it("rolls back return approval when the combined formal handoff is invalid", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-combined-rollback", 0),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-combined-rollback", 1),
    });
    await repairRounds.recordAcceptanceOnBehalf({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-accept-combined-rollback", 2),
    });
    await completeIntake(order.id, 3);
    const workReturn = await repairRounds.submitWorkReturn({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      actualStaffMemberId: mechanicStaffId,
      context: context(mechanicAccountId, "req-submit-combined-rollback", 4),
    });
    const service = repairRounds as RepairRoundService & {
      approveAndFormallyHandOff(input: {
        businessOrderId: number;
        expectedRepairRoundVersion: number;
        workReturnId: number;
        performanceValue: string;
        context: ReturnType<typeof context>;
      }): Promise<unknown>;
    };

    await expect(service.approveAndFormallyHandOff({
      businessOrderId: order.id,
      expectedRepairRoundVersion: await currentRoundVersion(order.id),
      workReturnId: workReturn.id,
      performanceValue: "not-money",
      context: context(frontDeskId, "req-combined-rollback", 5),
    })).rejects.toThrow();

    await expect(repairRounds.getCurrentRound({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      status: "return_pending_review",
      approvedWorkReturnId: null,
    });
    const handoffs = await database.query<{ total: number }>(
      `select count(*)::integer as total from formal_handoffs where business_order_id = $1`,
      [order.id],
    );
    expect(handoffs.rows[0]?.total).toBe(0);
  });

  it("gives a mechanic only assigned work facts without payer or price data", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-create-mechanic-portal", 0),
    });
    const unit = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, created_by)
       values ('charge_unit', 'hour', '工时', $1)
       returning id`,
      [adminId],
    );
    const charges = await businessOrders.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      reason: "维修工入口测试",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "0",
      items: [{
        kind: "labor",
        nameZh: "检查发动机",
        nameEn: "Inspect engine",
        descriptionZh: "读取故障码",
        unitItemId: Number(unit.rows[0].id),
        quantity: "1",
        unitPrice: "10000",
        itemDiscount: "0",
      }],
      notes: [{
        kind: "work_instruction",
        contentZh: "检查后拍照",
        contentEn: "Take photos after inspection",
      }],
      context: context(frontDeskId, "req-charges-mechanic-portal", 1),
    });
    await repairRounds.assignRound({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: charges.businessOrderVersion,
      teamId,
      customerConfirmedWithoutPayment: true,
      context: context(frontDeskId, "req-assign-mechanic-portal", 2),
    });

    const service = repairRounds as RepairRoundService & {
      listMechanicWorkOrders(input: { viewerAccountId: number }): Promise<{ items: unknown[] }>;
      getMechanicWorkOrder(input: { businessOrderId: number; viewerAccountId: number }): Promise<Record<string, unknown>>;
    };
    const list = await service.listMechanicWorkOrders({ viewerAccountId: mechanicAccountId });
    expect(list.items).toEqual([expect.objectContaining({ businessOrderId: order.id, status: "assigned" })]);
    const detail = await service.getMechanicWorkOrder({
      businessOrderId: order.id,
      viewerAccountId: mechanicAccountId,
    });
    expect(detail).toMatchObject({
      businessOrderId: order.id,
      vehicle: { plate: "7012 AB", description: "Honda CR-V" },
      workItems: [expect.objectContaining({ nameZh: "检查发动机", nameEn: "Inspect engine" })],
      notes: [expect.objectContaining({ contentZh: "检查后拍照" })],
    });
    expect(detail).not.toHaveProperty("payer");
    expect((detail.workItems as Array<Record<string, unknown>>)[0]).not.toHaveProperty("unitPriceMinor");
    await expect(service.getMechanicWorkOrder({
      businessOrderId: order.id,
      viewerAccountId: otherMechanicAccountId,
    })).rejects.toBeInstanceOf(RepairRoundReadDeniedError);
  });
});
