import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@/modules/auth/session-repository";
import { BusinessOrderService } from "@/modules/business-order/business-order-service";
import {
  RepairRoundService,
  RepairRoundValidationError,
} from "@/modules/business-order/repair-round-service";
import { MasterDataService } from "@/modules/master-data/master-data-service";

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
].map((name) => resolve(process.cwd(), "drizzle", name));

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

describe("RepairRoundService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
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
      workSummary: "已完成诊断并更换支架",
      actualStaffMemberId: mechanicStaffId,
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
});
