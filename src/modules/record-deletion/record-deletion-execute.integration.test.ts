import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { RecordDeletionService } from "@formal/modules/record-deletion/record-deletion-service";

const migrationDirectory = resolve(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDirectory)
  .filter((path) => /^\d{4}_.+\.sql$/.test(path))
  .sort()
  .map((path) => resolve(migrationDirectory, path));

let database: PGlite;
let service: RecordDeletionService;
let frontDeskId: number;

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

async function seedFixture(sequence: number) {
  const suffix = String(sequence).padStart(4, "0");
  const account = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ('前台删除', 'front-delete', 'test-hash', 'front_desk', false)
     returning id`,
  );
  frontDeskId = Number(account.rows[0]?.id);
  const customer = await database.query<{ id: number }>(
    `insert into personal_customers
      (customer_no, full_name, normalized_phone, trn, created_by)
     values ($1, '待删除客户', '+18765550101', '123456789', $2)
     returning id`,
    [`CUST-202608-${suffix}`, frontDeskId],
  );
  const customerId = Number(customer.rows[0]?.id);
  const vehicle = await database.query<{ id: number }>(
    `insert into vehicles
      (vehicle_no, plate_display, normalized_plate, vin, make, model,
       current_person_customer_id, created_by)
     values ($1, 'DEL 101', 'DEL101', $2, 'Test', 'Delete', $3, $4)
     returning id`,
    [`VEH-202608-${suffix}`, `VINDELETE${suffix}`, customerId, frontDeskId],
  );
  const vehicleId = Number(vehicle.rows[0]?.id);
  await database.query(
    `insert into vehicle_owner_history
      (vehicle_id, person_customer_id, changed_by)
     values ($1, $2, $3)`,
    [vehicleId, customerId, frontDeskId],
  );
  return {
    customerId,
    customerNo: `CUST-202608-${suffix}`,
    vehicleId,
    vehicleNo: `VEH-202608-${suffix}`,
  };
}

async function seedDraftInspectionWithWorkspace(sequence: number) {
  const fixture = await seedFixture(sequence);
  const team = await database.query<{ id: number }>(
    `insert into repair_teams
      (team_no, name, normalized_name, created_by)
     values ($1, $2, $2, $3)
     returning id`,
    [
      `TEAM-202608-${String(sequence).padStart(4, "0")}`,
      `待删除检查组 ${sequence}`,
      frontDeskId,
    ],
  );
  const reportNo = `IR-20260827-${String(sequence).padStart(4, "0")}`;
  const report = await database.query<{ id: number }>(
    `insert into inspection_reports
      (report_no, vehicle_id, summary_zh, inspection_team_id, created_by)
     values ($1, $2, '误建检查结果', $3, $4)
     returning id`,
    [reportNo, fixture.vehicleId, Number(team.rows[0]?.id), frontDeskId],
  );
  const inspectionReportId = Number(report.rows[0]?.id);
  await database.query(
    `insert into inspection_report_workspace_versions
      (inspection_report_id, version_no, organized_content, quotation,
       source, change_reason, created_by)
     values ($1, 1, $2::jsonb, $3::jsonb, 'ai', 'AI 整理后待确认', $4)`,
    [
      inspectionReportId,
      JSON.stringify({ summaryZh: "误建检查结果", summaryEn: null, findings: [] }),
      JSON.stringify({ status: "pending", noteZh: "价格待补", noteEn: null, lines: [] }),
      frontDeskId,
    ],
  );
  await database.query(
    `update inspection_reports
     set current_workspace_version_no = 1, version = 2
     where id = $1`,
    [inspectionReportId],
  );
  return { ...fixture, inspectionReportId, reportNo };
}

describe("RecordDeletionService execute", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
  });

  beforeEach(async () => {
    await database.exec(
      "truncate table customer_phone_registry, customer_trn_registry, staff_accounts restart identity cascade",
    );
    service = new RecordDeletionService(testDatabase(database));
  });

  afterAll(async () => database.close());

  it("deletes a selected customer and vehicle in reverse dependency order and replays safely", async () => {
    const fixture = await seedFixture(1);
    const selectedRecords = [
      { kind: "personal_customer" as const, recordNo: fixture.customerNo },
      { kind: "vehicle" as const, recordNo: fixture.vehicleNo },
    ];
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root: selectedRecords[0],
      selectedRecords,
    });
    const input = {
      actorAccountId: frontDeskId,
      root: selectedRecords[0],
      selectedRecords,
      reasonCode: "test_data" as const,
      reasonNote: "误建测试记录，电话 +1 876 555 0199，车牌 PRIVATE99",
      confirmationRecordNo: fixture.customerNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-execute-1",
      now: new Date("2026-08-27T15:00:00Z"),
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    };

    const first = await service.execute(input);
    const replay = await service.execute(input);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      requestId: input.requestId,
      deletedRecords: expect.arrayContaining(selectedRecords),
      releasedIdentityKinds: ["phone", "trn", "plate", "vin"],
    });

    const counts = await database.query<{
      customers: number;
      vehicles: number;
      histories: number;
    }>(
      `select
        (select count(*)::int from personal_customers) as customers,
        (select count(*)::int from vehicles) as vehicles,
        (select count(*)::int from vehicle_owner_history) as histories`,
    );
    expect(counts.rows[0]).toMatchObject({ customers: 0, vehicles: 0, histories: 0 });

    await expect(database.query(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, trn, created_by)
       values ('CUST-202608-9001', '复用身份', '+18765550101', '123456789', $1)`,
      [frontDeskId],
    )).resolves.toMatchObject({ affectedRows: 1 });

    const audit = await database.query<{ serialized: string; after_state: Record<string, unknown> }>(
      `select concat_ws(' ', reason, before_state::text, after_state::text) as serialized,
              after_state
       from audit_events where request_id = $1 and event_type = 'record.deleted'`,
      [input.requestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.after_state).toMatchObject({
      actorRole: "front_desk",
      reasonNoteProvided: true,
      previewFingerprint: input.previewFingerprint,
      deletedRecordCount: 2,
    });
    expect(audit.rows[0]?.after_state).not.toHaveProperty("reasonNote");
    expect(audit.rows[0]?.serialized.toLowerCase()).not.toMatch(
      /full_name|phone|trn|plate|vin|address|待删除客户|del101|123456789|876 555 0199|private99/,
    );
  });

  it("deletes a draft inspection together with its authorized workspace versions", async () => {
    const fixture = await seedDraftInspectionWithWorkspace(9);
    const root = { kind: "inspection_report" as const, recordNo: fixture.reportNo };

    await expect(database.query(
      `delete from inspection_report_workspace_versions
       where inspection_report_id = $1`,
      [fixture.inspectionReportId],
    )).rejects.toThrow(/append-only/);

    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
    });
    expect(preview).toMatchObject({
      eligible: true,
      dependentCounts: { inspection_report_workspace_versions: 1 },
    });

    const result = await service.execute({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
      reasonCode: "duplicate",
      reasonNote: null,
      confirmationRecordNo: fixture.reportNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-inspection-workspace-9",
    });
    expect(result.dependentCounts).toMatchObject({
      inspection_report_workspace_versions: 1,
    });

    const remaining = await database.query<{
      reports: number;
      workspaces: number;
      receipts: number;
    }>(
      `select
         (select count(*)::int from inspection_reports where id = $1) as reports,
         (select count(*)::int from inspection_report_workspace_versions
          where inspection_report_id = $1) as workspaces,
         (select count(*)::int from record_deletion_receipts
          where request_id = 'delete-inspection-workspace-9') as receipts`,
      [fixture.inspectionReportId],
    );
    expect(remaining.rows[0]).toEqual({ reports: 0, workspaces: 0, receipts: 1 });
  });

  it("rejects a stale preview without deleting anything", async () => {
    const fixture = await seedFixture(2);
    const root = { kind: "vehicle" as const, recordNo: fixture.vehicleNo };
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
    });
    await database.query(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, vehicle_plate_snapshot,
         vehicle_description_snapshot, created_by)
       values ('KGN-WH-2026082700002', $1, $2, '付款人', 'DEL 101',
               'Test Delete', $3)`,
      [fixture.vehicleId, fixture.customerId, frontDeskId],
    );

    await expect(service.execute({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
      reasonCode: "input_error",
      reasonNote: null,
      confirmationRecordNo: fixture.vehicleNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-stale-2",
    })).rejects.toMatchObject({ code: "DELETION_PREVIEW_STALE", status: 409 });

    const remaining = await database.query<{ count: number }>(
      `select count(*)::int as count from vehicles where id = $1`,
      [fixture.vehicleId],
    );
    expect(Number(remaining.rows[0]?.count)).toBe(1);

    const rejection = await database.query<{ after_state: Record<string, unknown> }>(
      `select after_state from audit_events
       where request_id = 'delete-stale-2'
         and event_type = 'record.deletion_rejected'`,
    );
    expect(rejection.rows).toHaveLength(1);
    expect(rejection.rows[0]?.after_state).toMatchObject({
      actorRole: "front_desk",
    });
    expect(rejection.rows[0]?.after_state.blockerCodes).toEqual(expect.arrayContaining([
      "DELETION_PREVIEW_STALE",
      "HAS_BUSINESS_ORDER",
    ]));
  });

  it("rejects reuse of a request number with a different payload", async () => {
    const fixture = await seedFixture(3);
    const root = { kind: "vehicle" as const, recordNo: fixture.vehicleNo };
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
    });
    const input = {
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
      reasonCode: "duplicate" as const,
      reasonNote: null,
      confirmationRecordNo: fixture.vehicleNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-conflict-3",
    };
    await service.execute(input);
    await expect(service.execute({ ...input, reasonCode: "test_data" }))
      .rejects.toMatchObject({ code: "DELETION_REQUEST_CONFLICT", status: 409 });
  });

  it("surfaces a vehicle linked only through ownership history", async () => {
    const fixture = await seedFixture(4);
    const secondCustomer = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, created_by)
       values ('CUST-202608-0044', '现车主', '+18765550444', $1)
       returning id`,
      [frontDeskId],
    );
    await database.query(
      `update vehicle_owner_history set ended_at = now()
       where vehicle_id = $1 and person_customer_id = $2`,
      [fixture.vehicleId, fixture.customerId],
    );
    await database.query(
      `update vehicles set current_person_customer_id = $2, version = version + 1
       where id = $1`,
      [fixture.vehicleId, Number(secondCustomer.rows[0]?.id)],
    );
    await database.query(
      `insert into vehicle_owner_history
        (vehicle_id, person_customer_id, changed_by)
       values ($1, $2, $3)`,
      [fixture.vehicleId, Number(secondCustomer.rows[0]?.id), frontDeskId],
    );

    const root = { kind: "personal_customer" as const, recordNo: fixture.customerNo };
    const preview = await service.preview({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
    });

    expect(preview.selectableLinkedRecords).toContainEqual({
      kind: "vehicle",
      recordNo: fixture.vehicleNo,
      version: 2,
    });
    expect(preview.blockers).toContainEqual(expect.objectContaining({
      code: "HAS_VEHICLE",
      linkedRecord: { kind: "vehicle", recordNo: fixture.vehicleNo },
    }));
  });

  it("deletes comment-linked Business Order attachments and queues the physical files", async () => {
    const fixture = await seedFixture(5);
    const order = await database.query<{ id: number }>(
      `insert into business_orders
        (order_no, vehicle_id, payer_person_customer_id,
         payer_display_name_snapshot, vehicle_plate_snapshot,
         vehicle_description_snapshot, created_by)
       values ('KGN-WH-2026082700005', $1, $2, '付款人', 'DEL 101',
               'Test Delete', $3)
       returning id`,
      [fixture.vehicleId, fixture.customerId, frontDeskId],
    );
    const orderId = Number(order.rows[0]?.id);
    const round = await database.query<{ id: number }>(
      `insert into repair_rounds
        (business_order_id, round_no, source, status, created_by)
       values ($1, 1, 'initial', 'waiting_assignment', $2)
       returning id`,
      [orderId, frontDeskId],
    );
    const roundId = Number(round.rows[0]?.id);
    await database.query(
      `insert into business_order_problem_originals
        (business_order_id, content_zh, source_type, confirmed_by)
       values ($1, '发动机警告灯亮', 'creation', $2)`,
      [orderId, frontDeskId],
    );
    await database.query(
      `insert into business_order_problem_versions
        (business_order_id, version_no, content_zh, source_type,
         change_reason, created_by)
       values ($1, 1, '发动机警告灯偶发亮起', 'manual', '前台补充', $2)`,
      [orderId, frontDeskId],
    );
    await database.query(
      `update business_orders
       set current_problem_description_version_no = 1
       where id = $1`,
      [orderId],
    );
    await database.query(
      `insert into repair_round_problem_versions
        (repair_round_id, version_no, content_zh, source_type,
         change_reason, created_by)
       values ($1, 1, '本轮检查发动机警告灯', 'manual', '维修班组补充', $2)`,
      [roundId, frontDeskId],
    );
    await database.query(
      `update repair_rounds
       set current_problem_description_version_no = 1
       where id = $1`,
      [roundId],
    );
    const message = await database.query<{ id: number }>(
      `insert into business_order_messages
        (business_order_id, author_account_id, author_display_name, author_role, body)
       values ($1, $2, '前台删除', 'front_desk', '测试评论') returning id`,
      [orderId, frontDeskId],
    );
    const file = await database.query<{ id: number }>(
      `insert into stored_files
        (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by)
       values ('business-order-files/2026/08/delete-me.jpg', 'delete-me.jpg',
               'image/jpeg', 3, $1, $2) returning id`,
      ["a".repeat(64), frontDeskId],
    );
    await database.query(
      `insert into business_order_attachments
        (business_order_id, file_id, category, message_id, linked_by)
       values ($1, $2, 'service_photo', $3, $4)`,
      [orderId, Number(file.rows[0]?.id), Number(message.rows[0]?.id), frontDeskId],
    );

    const root = { kind: "business_order" as const, recordNo: "KGN-WH-2026082700005" };
    const preview = await service.preview({ actorAccountId: frontDeskId, root, selectedRecords: [root] });
    expect(preview.eligible).toBe(true);
    expect(preview.dependentCounts).toMatchObject({
      business_order_messages: 1,
      business_order_attachments: 1,
      business_order_problem_originals: 1,
      business_order_problem_versions: 1,
      repair_round_problem_versions: 1,
    });

    const result = await service.execute({
      actorAccountId: frontDeskId,
      root,
      selectedRecords: [root],
      reasonCode: "test_data",
      reasonNote: null,
      confirmationRecordNo: root.recordNo,
      previewFingerprint: preview.previewFingerprint,
      requestId: "delete-order-attachment-5",
    });

    expect(result.fileCleanupPending).toBe(1);
    const remaining = await database.query<{
      orders: number;
      messages: number;
      attachments: number;
      originals: number;
      orderVersions: number;
      roundVersions: number;
      files: number;
      tasks: number;
    }>(
      `select
        (select count(*)::int from business_orders where id = $1) as orders,
        (select count(*)::int from business_order_messages where business_order_id = $1) as messages,
        (select count(*)::int from business_order_attachments where business_order_id = $1) as attachments,
        (select count(*)::int from business_order_problem_originals where business_order_id = $1) as originals,
        (select count(*)::int from business_order_problem_versions where business_order_id = $1) as "orderVersions",
        (select count(*)::int from repair_round_problem_versions where repair_round_id = $3) as "roundVersions",
        (select count(*)::int from stored_files where id = $2) as files,
        (select count(*)::int from record_deletion_file_tasks where storage_key = 'business-order-files/2026/08/delete-me.jpg') as tasks`,
      [orderId, Number(file.rows[0]?.id), roundId],
    );
    expect(remaining.rows[0]).toEqual({
      orders: 0,
      messages: 0,
      attachments: 0,
      originals: 0,
      orderVersions: 0,
      roundVersions: 0,
      files: 0,
      tasks: 1,
    });
  });
});
