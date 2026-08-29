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
  InspectionReportService,
  InspectionReportValidationError,
} from "@formal/modules/inspection-report/inspection-report-service";

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
  "0016_vehicle_profile_fields.sql",
  "0018_business_order_number_format.sql",
  "0039_inspection_team_intake.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let inspectionReports: InspectionReportService;
let businessOrders: BusinessOrderService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let mechanicAccountId: number;
let mechanicStaffId: number;
let teamId: number;
let anotherTeamId: number;
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
      (display_name, normalized_username, password_hash, role,
       must_change_password)
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
    now: new Date(`2026-08-24T18:${String(minute).padStart(2, "0")}:00Z`),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

describe("InspectionReportService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    mechanicAccountId = await seedAccount("维修工一号", "mechanic.one", "mechanic");
    const position = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, created_by)
       values ('staff_position', 'mechanic', '维修工', $1) returning id`,
      [adminId],
    );
    const team = await database.query<{ id: number }>(
      `insert into repair_teams
        (team_no, name, normalized_name, created_by)
       values ('TEAM-202608-0001', '维修一组', '维修一组', $1) returning id`,
      [adminId],
    );
    teamId = Number(team.rows[0].id);
    const anotherTeam = await database.query<{ id: number }>(
      `insert into repair_teams
        (team_no, name, normalized_name, created_by)
       values ('TEAM-202608-0002', '维修二组', '维修二组', $1) returning id`,
      [adminId],
    );
    anotherTeamId = Number(anotherTeam.rows[0].id);
    const staff = await database.query<{ id: number }>(
      `insert into staff_members
        (staff_no, full_name, account_id, position_item_id, current_team_id,
         hired_on, created_by)
       values ('STAFF-202608-0001', '维修工一号', $1, $2, $3,
               date '2026-08-01', $4) returning id`,
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
    inspectionReports = new InspectionReportService(testDb);
    businessOrders = new BusinessOrderService(testDb);
  });

  afterEach(async () => database.close());

  it("submits an independent report with a vehicle and no Business Order", async () => {
    const draft = await inspectionReports.createInspectionReport({
      vehicleId,
      inspectionTeamId: teamId,
      sourceBusinessOrderId: null,
      sourceRepairRoundId: null,
      actualInspectorStaffMemberId: mechanicStaffId,
      summaryZh: "检查发现发动机支架老化",
      summaryEn: "Engine mount wear found",
      findings: [{
        findingZh: "右前发动机支架开裂",
        findingEn: "Front-right engine mount cracked",
        recommendationZh: "建议更换",
        recommendationEn: "Replacement recommended",
      }],
      context: context(frontDeskId, "req-ir-create", 0),
    });
    const submitted = await inspectionReports.submitInspectionReport({
      inspectionReportId: draft.id,
      expectedVersion: draft.version,
      context: context(frontDeskId, "req-ir-submit", 1),
    });
    expect(submitted).toMatchObject({
      reportNo: "IR-20260824-0001",
      vehicleId,
      sourceBusinessOrderId: null,
      sourceRepairRoundId: null,
      status: "submitted",
      actualInspectorStaffMemberId: mechanicStaffId,
    });
    await expect(inspectionReports.listVehicleInspectionReports({
      vehicleId,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({
      items: [{ id: submitted.id, status: "submitted" }],
      total: 1,
    });
  });

  it("stores the submitting team and allows front desk to leave the mechanic blank", async () => {
    const draft = await inspectionReports.createInspectionReport({
      vehicleId,
      inspectionTeamId: teamId,
      actualInspectorStaffMemberId: null,
      summaryZh: "轮胎磨损,需进一步拆检",
      specialCaseNotesZh: "客户要求先确认配件价格",
      findings: [],
      context: context(frontDeskId, "req-ir-no-inspector", 0),
    });
    const submitted = await inspectionReports.submitInspectionReport({
      inspectionReportId: draft.id,
      expectedVersion: draft.version,
      context: context(frontDeskId, "req-ir-no-inspector-submit", 1),
    });

    expect(submitted).toMatchObject({
      inspectionTeamId: teamId,
      actualInspectorStaffMemberId: null,
      summaryZh: "轮胎磨损,需进一步拆检",
      specialCaseNotesZh: "客户要求先确认配件价格",
      findings: [],
      status: "submitted",
    });
    await expect(inspectionReports.getInspectionReport({
      inspectionReportId: submitted.id,
      viewerAccountId: mechanicAccountId,
    })).resolves.toMatchObject({
      report: { id: submitted.id, inspectionTeamId: teamId },
      teamName: "维修一组",
      inspectorName: null,
    });
  });

  it("rejects a selected mechanic who is not in the submitting team", async () => {
    await expect(inspectionReports.createInspectionReport({
      vehicleId,
      inspectionTeamId: anotherTeamId,
      actualInspectorStaffMemberId: mechanicStaffId,
      summaryZh: "检查结果",
      findings: [],
      context: context(frontDeskId, "req-ir-wrong-team", 0),
    })).rejects.toThrow("维修工不属于所选提交班组");
  });

  it("rejects a report inserted directly as submitted without the submit action", async () => {
    await expect(database.query(
      `insert into inspection_reports
        (report_no, vehicle_id, summary_zh, inspection_team_id,
         actual_inspector_staff_member_id, status,
         created_at, created_by, submitted_at, submitted_by)
       values ('IR-20260824-9999', $1, '绕过提交', $2, $3, 'submitted',
               $4, $5, $4, $5)`,
      [vehicleId, teamId, mechanicStaffId,
        context(adminId, "req-ir-direct-submit", 0).now, adminId],
    )).rejects.toThrow();
  });

  it("keeps a submitted report immutable and appends a correction record", async () => {
    const draft = await inspectionReports.createInspectionReport({
      vehicleId,
      inspectionTeamId: teamId,
      actualInspectorStaffMemberId: mechanicStaffId,
      summaryZh: "初次记录",
      findings: [{ findingZh: "轮胎磨损" }],
      context: context(mechanicAccountId, "req-ir-original-create", 0),
    });
    const original = await inspectionReports.submitInspectionReport({
      inspectionReportId: draft.id,
      expectedVersion: draft.version,
      context: context(mechanicAccountId, "req-ir-original-submit", 1),
    });
    await expect(database.query(
      "update inspection_reports set summary_zh = '覆盖原记录' where id = $1",
      [original.id],
    )).rejects.toThrow();

    const correctionDraft = await inspectionReports.correctInspectionReport({
      originalInspectionReportId: original.id,
      expectedOriginalVersion: original.version,
      correctionReason: "补充轮胎位置",
      summaryZh: "更正记录",
      findings: [{ findingZh: "左前轮胎磨损", recommendationZh: "建议更换" }],
      actualInspectorStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-ir-correct", 2),
    });
    await expect(inspectionReports.correctInspectionReport({
      originalInspectionReportId: original.id,
      expectedOriginalVersion: original.version,
      correctionReason: "重复更正",
      summaryZh: "不应形成分叉",
      findings: [{ findingZh: "重复更正内容" }],
      actualInspectorStaffMemberId: mechanicStaffId,
      context: context(frontDeskId, "req-ir-duplicate-correction", 3),
    })).rejects.toBeInstanceOf(InspectionReportValidationError);
    const correction = await inspectionReports.submitInspectionReport({
      inspectionReportId: correctionDraft.id,
      expectedVersion: correctionDraft.version,
      context: context(frontDeskId, "req-ir-correction-submit", 4),
    });
    expect(correction).toMatchObject({
      correctionOfReportId: original.id,
      correctionReason: "补充轮胎位置",
      status: "submitted",
    });
    const reports = await inspectionReports.listVehicleInspectionReports({
      vehicleId,
      viewerAccountId: adminId,
    });
    expect(reports.items.map((report) => report.id)).toEqual([
      correction.id,
      original.id,
    ]);
  });

  it("does not change Business Order status, charge version or version", async () => {
    const order = await businessOrders.createBusinessOrder({
      vehicleId,
      context: context(frontDeskId, "req-bo-before-ir", 0),
    });
    const round = await database.query<{ id: number }>(
      "select id from repair_rounds where business_order_id = $1 and round_no = 1",
      [order.id],
    );
    const draft = await inspectionReports.createInspectionReport({
      vehicleId,
      inspectionTeamId: teamId,
      sourceBusinessOrderId: order.id,
      sourceRepairRoundId: Number(round.rows[0].id),
      actualInspectorStaffMemberId: mechanicStaffId,
      summaryZh: "独立检查结果",
      findings: [{ findingZh: "刹车片余量偏低" }],
      context: context(frontDeskId, "req-linked-ir-create", 1),
    });
    await inspectionReports.submitInspectionReport({
      inspectionReportId: draft.id,
      expectedVersion: draft.version,
      context: context(frontDeskId, "req-linked-ir-submit", 2),
    });
    await expect(businessOrders.getBusinessOrder({
      businessOrderId: order.id,
      viewerAccountId: adminId,
    })).resolves.toMatchObject({
      status: order.status,
      currentChargeVersionNo: order.currentChargeVersionNo,
      version: order.version,
    });
  });
});
