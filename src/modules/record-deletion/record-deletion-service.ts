import { createHash } from "node:crypto";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import {
  deletionPreviewStale,
  deletionRequestConflict,
  RecordDeletionError,
  recordDeleteDenied,
  recordDeleteBlocked,
  recordNotFound,
} from "@formal/modules/record-deletion/record-deletion-errors";
import {
  evaluateDeletionGraph,
  type BusinessOrderDeletionFact,
  type CustomerDeletionFact,
  type DeletionFacts,
  type InspectionReportDeletionFact,
  type RecordDeletionFact,
  type VehicleDeletionFact,
} from "@formal/modules/record-deletion/record-deletion-policy";
import type {
  RecordDeletionPreview,
  RecordDeletionExecuteInput,
  RecordDeletionResult,
  RecordKind,
  RecordLocator,
  RecordReference,
  ReleasedIdentityKind,
} from "@formal/modules/record-deletion/record-deletion-types";

export type PreviewDeletionInput = {
  root: RecordLocator;
  selectedRecords?: RecordLocator[];
  actorAccountId: number;
};

export type RecordDeletionActionContext = {
  actorAccountId: number;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ResolvedRecord = RecordReference & { id: number };
type LoadedFact = { fact: RecordDeletionFact; linked: ResolvedRecord[] };

type CustomerRow = {
  id: number;
  record_no: string;
  version: number;
  phone_value: string | null;
  trn: string | null;
};

type VehicleRow = {
  id: number;
  record_no: string;
  version: number;
  normalized_plate: string | null;
  vin: string | null;
};

type OrderRow = {
  id: number;
  record_no: string;
  version: number;
  status: BusinessOrderDeletionFact["status"];
};

type InspectionRow = {
  id: number;
  record_no: string;
  version: number;
  status: InspectionReportDeletionFact["status"];
};

export class RecordDeletionService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async preview(input: PreviewDeletionInput): Promise<RecordDeletionPreview> {
    await requireRecordDeletePermission(this.database, input.actorAccountId);
    const root = await resolveRecord(this.database, input.root);
    if (!root) throw recordNotFound();

    const selectedLocators = input.selectedRecords?.length
      ? input.selectedRecords
      : [input.root];
    const selected = await Promise.all(
      selectedLocators.map((locator) => resolveRecord(this.database, locator)),
    );
    const facts = await loadDeletionFacts(
      this.database,
      root,
      selected.filter((record): record is ResolvedRecord => record !== null),
    );

    return evaluateDeletionGraph(root, selectedLocators, facts);
  }

  async execute(
    input: RecordDeletionExecuteInput & RecordDeletionActionContext,
  ): Promise<RecordDeletionResult> {
    const payloadHash = deletionPayloadHash(input);
    try {
      return await this.database.transaction(async (transaction) => {
        const actor = await requireRecordDeletePermission(
          transaction,
          input.actorAccountId,
        );
        await transaction.query(
          `select pg_advisory_xact_lock(hashtext($1))`,
          [`record-deletion:${input.requestId}`],
        );
        const prior = await transaction.query<{
          actor_account_id: number;
          payload_hash: string;
          result: RecordDeletionResult | string;
        }>(
          `select actor_account_id, payload_hash, result
           from record_deletion_receipts
           where request_id = $1
           for update`,
          [input.requestId],
        );
        if (prior[0]) {
          if (Number(prior[0].actor_account_id) !== input.actorAccountId
              || prior[0].payload_hash !== payloadHash) {
            throw deletionRequestConflict();
          }
          return parseDeletionResult(prior[0].result);
        }

        const root = await resolveRecord(transaction, input.root, true);
        if (!root) throw recordNotFound();
        const selected = await Promise.all(
          input.selectedRecords.map((locator) => resolveRecord(transaction, locator, true)),
        );
        if (selected.some((record) => record === null)) throw deletionPreviewStale();
        const selectedRecords = selected as ResolvedRecord[];
        const facts = await loadDeletionFacts(transaction, root, selectedRecords);
        const preview = evaluateDeletionGraph(root, input.selectedRecords, facts);
        if (preview.previewFingerprint !== input.previewFingerprint) {
          throw withDeletionBlockerCodes(
            deletionPreviewStale(),
            preview.blockers.map((blocker) => blocker.code),
          );
        }
        if (!preview.eligible) {
          throw withDeletionBlockerCodes(
            recordDeleteBlocked(),
            preview.blockers.map((blocker) => blocker.code),
          );
        }

        const provisional: RecordDeletionResult = {
          requestId: input.requestId,
          root: input.root,
          deletedRecords: [],
          dependentCounts: {},
          releasedIdentityKinds: [],
          fileCleanupPending: 0,
        };
        await transaction.query(
          `insert into record_deletion_receipts
            (request_id, actor_account_id, payload_hash, root_kind,
             root_record_no, reason_code, result, created_at)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            input.requestId,
            input.actorAccountId,
            payloadHash,
            input.root.kind,
            input.root.recordNo,
            input.reasonCode,
            JSON.stringify(provisional),
            input.now ?? new Date(),
          ],
        );
        await transaction.query(
          `select set_config('app.record_deletion_request_id', $1, true)`,
          [input.requestId],
        );

        const fileCleanupPending = await deleteSelectedGraph(
          transaction,
          selectedRecords,
          input.requestId,
        );
        const result: RecordDeletionResult = {
          requestId: input.requestId,
          root: input.root,
          deletedRecords: input.selectedRecords,
          dependentCounts: preview.dependentCounts,
          releasedIdentityKinds: preview.releasedIdentityKinds,
          fileCleanupPending,
        };
        await writeAuditEvent(transaction, {
          occurredAt: input.now,
          actorAccountId: input.actorAccountId,
          eventType: "record.deleted",
          objectType: input.root.kind,
          objectId: input.root.recordNo,
          reason: input.reasonCode,
          after: {
            actorRole: actor.role,
            reasonNoteProvided: input.reasonNote !== null,
            previewFingerprint: input.previewFingerprint,
            deletedRecordCount: input.selectedRecords.length,
            deletedRecords: input.selectedRecords.map((record) => ({
              kind: record.kind,
              recordNo: record.recordNo,
            })),
            dependentCounts: preview.dependentCounts,
            fileCleanupPending,
          },
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
        await transaction.query(
          `update record_deletion_receipts set result = $2::jsonb where request_id = $1`,
          [input.requestId, JSON.stringify(result)],
        );
        return result;
      });
    } catch (error) {
      await this.writeRejectionAudit(input, error);
      throw error;
    }
  }

  private async writeRejectionAudit(
    input: RecordDeletionExecuteInput & RecordDeletionActionContext,
    error: unknown,
  ): Promise<void> {
    const actor = await readDeleteActor(this.database, input.actorAccountId);
    if (!actor) return;
    try {
      await writeAuditEvent(this.database, {
        occurredAt: input.now,
        actorAccountId: input.actorAccountId,
        eventType: "record.deletion_rejected",
        objectType: input.root.kind,
        objectId: input.root.recordNo,
        after: {
          actorRole: actor.role,
          blockerCodes: rejectionCodes(error),
        },
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
    } catch {
      // Preserve the original deletion error if the separate audit write fails.
    }
  }
}

async function requireRecordDeletePermission(
  executor: AuthSqlExecutor,
  actorAccountId: number,
): Promise<{ role: string }> {
  const actor = await readDeleteActor(executor, actorAccountId);
  if (!actor?.allowed) throw recordDeleteDenied();
  return actor;
}

async function readDeleteActor(
  executor: AuthSqlExecutor,
  actorAccountId: number,
): Promise<{ role: string; allowed: boolean } | null> {
  const rows = await executor.query<{ role: string; allowed: boolean }>(
    `select role::text as role,
            (is_active and role in ('super_admin', 'front_desk')) as allowed
     from staff_accounts
     where id = $1
     limit 1`,
    [actorAccountId],
  );
  return rows[0] ?? null;
}

function withDeletionBlockerCodes(
  error: RecordDeletionError,
  blockerCodes: string[],
): RecordDeletionError {
  Object.assign(error, { deletionBlockerCodes: blockerCodes });
  return error;
}

function rejectionCodes(error: unknown): string[] {
  const primary = error instanceof RecordDeletionError
    ? error.code
    : "RECORD_DELETE_FAILED";
  const attached = typeof error === "object" && error !== null
    && "deletionBlockerCodes" in error
    && Array.isArray(error.deletionBlockerCodes)
    ? error.deletionBlockerCodes.filter(
      (code): code is string => typeof code === "string",
    )
    : [];
  return [...new Set([primary, ...attached])];
}

async function resolveRecord(
  executor: AuthSqlExecutor,
  locator: RecordLocator,
  lock = false,
): Promise<ResolvedRecord | null> {
  let rows: Array<CustomerRow | VehicleRow | OrderRow | InspectionRow>;
  switch (locator.kind) {
    case "personal_customer":
      rows = await executor.query<CustomerRow>(
        `select id, customer_no as record_no, version,
                normalized_phone as phone_value, trn
         from personal_customers where customer_no = $1 limit 1${lock ? " for update" : ""}`,
        [locator.recordNo],
      );
      break;
    case "company_customer":
      rows = await executor.query<CustomerRow>(
        `select id, company_no as record_no, version, phone as phone_value, trn
         from company_accounts where company_no = $1 limit 1${lock ? " for update" : ""}`,
        [locator.recordNo],
      );
      break;
    case "vehicle":
      rows = await executor.query<VehicleRow>(
        `select id, vehicle_no as record_no, version, normalized_plate, vin
         from vehicles where vehicle_no = $1 limit 1${lock ? " for update" : ""}`,
        [locator.recordNo],
      );
      break;
    case "business_order":
      rows = await executor.query<OrderRow>(
        `select id, order_no as record_no, version, status
         from business_orders where order_no = $1 limit 1${lock ? " for update" : ""}`,
        [locator.recordNo],
      );
      break;
    case "inspection_report":
      rows = await executor.query<InspectionRow>(
        `select id, report_no as record_no, version, status
         from inspection_reports where report_no = $1 limit 1${lock ? " for update" : ""}`,
        [locator.recordNo],
      );
      break;
  }
  const row = rows[0];
  return row
    ? {
        id: Number(row.id),
        kind: locator.kind,
        recordNo: row.record_no,
        version: Number(row.version),
      }
    : null;
}

async function loadDeletionFacts(
  executor: AuthSqlExecutor,
  root: ResolvedRecord,
  selected: ResolvedRecord[],
): Promise<DeletionFacts> {
  const queue = dedupeResolved([root, ...selected]);
  const loaded = new Map<string, RecordDeletionFact>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || loaded.has(recordKey(current))) continue;
    const result = await loadFact(executor, current);
    loaded.set(recordKey(current), result.fact);
    for (const linked of result.linked) {
      if (!loaded.has(recordKey(linked))) queue.push(linked);
    }
  }

  return { root, records: [...loaded.values()] };
}

async function loadFact(
  executor: AuthSqlExecutor,
  record: ResolvedRecord,
): Promise<LoadedFact> {
  switch (record.kind) {
    case "personal_customer":
    case "company_customer":
      return loadCustomerFact(
        executor,
        record as ResolvedRecord & {
          kind: "personal_customer" | "company_customer";
        },
      );
    case "vehicle":
      return loadVehicleFact(executor, record);
    case "business_order":
      return loadBusinessOrderFact(executor, record);
    case "inspection_report":
      return loadInspectionFact(executor, record);
  }
}

async function loadCustomerFact(
  executor: AuthSqlExecutor,
  record: ResolvedRecord & {
    kind: "personal_customer" | "company_customer";
  },
): Promise<LoadedFact> {
  const personal = record.kind === "personal_customer";
  const linkedVehicles = await executor.query<VehicleRow>(
    `select distinct vehicle.id, vehicle.vehicle_no as record_no,
            vehicle.version, vehicle.normalized_plate, vehicle.vin
     from vehicles as vehicle
     where vehicle.${personal ? "current_person_customer_id" : "current_company_account_id"} = $1
        or exists (
          select 1 from vehicle_owner_history as history
          where history.vehicle_id = vehicle.id
            and history.${personal ? "person_customer_id" : "company_account_id"} = $1
        )
     order by id`,
    [record.id],
  );
  const linkedCustomers = personal
    ? await executor.query<CustomerRow>(
        `select company.id, company.company_no as record_no, company.version,
                company.phone as phone_value, company.trn
         from company_contacts as contact
         join company_accounts as company on company.id = contact.company_id
         where contact.personal_customer_id = $1
         order by company.id`,
        [record.id],
      )
    : await executor.query<CustomerRow>(
        `select person.id, person.customer_no as record_no, person.version,
                person.normalized_phone as phone_value, person.trn
         from company_contacts as contact
         join personal_customers as person on person.id = contact.personal_customer_id
         where contact.company_id = $1
         order by person.id`,
        [record.id],
      );
  const counts = await executor.query<{
    external_business_fact_count: number;
    license_count: number;
    contact_count: number;
  }>(
    `select
       (select count(*)::int from business_orders
        where ${personal ? "payer_person_customer_id" : "payer_company_account_id"} = $1)
         as external_business_fact_count,
       (select count(*)::int from customer_driver_license_records
        where ${personal ? "personal_customer_id" : "company_account_id"} = $1)
         as license_count,
       (select count(*)::int from company_contacts
        where ${personal ? "personal_customer_id" : "company_id"} = $1)
         as contact_count`,
    [record.id],
  );
  const identity = await readReleasedCustomerIdentities(executor, record);
  const linked = [
    ...linkedVehicles.map((row) => resolved(row, "vehicle")),
    ...linkedCustomers.map((row) => resolved(
      row,
      personal ? "company_customer" : "personal_customer",
    )),
  ];
  const count = counts[0];
  const dependentCounts: Record<string, number> = {
    customer_driver_license_records: Number(count?.license_count ?? 0),
  };
  if (!personal) dependentCounts.company_contacts = Number(count?.contact_count ?? 0);

  const fact: CustomerDeletionFact = {
    kind: record.kind,
    reference: reference(record),
    linkedPrimaryRecords: linked.map(reference),
    dependentCounts,
    releasedIdentityKinds: identity,
    externalBusinessFactCount: Number(count?.external_business_fact_count ?? 0),
  };
  return { fact, linked };
}

async function readReleasedCustomerIdentities(
  executor: AuthSqlExecutor,
  record: ResolvedRecord,
): Promise<ReleasedIdentityKind[]> {
  const personal = record.kind === "personal_customer";
  const rows = await executor.query<{ phone_value: string | null; trn: string | null }>(
    `select ${personal ? "normalized_phone" : "phone"} as phone_value, trn
     from ${personal ? "personal_customers" : "company_accounts"}
     where id = $1`,
    [record.id],
  );
  const result: ReleasedIdentityKind[] = [];
  if (rows[0]?.phone_value) result.push("phone");
  if (rows[0]?.trn) result.push("trn");
  return result;
}

async function loadVehicleFact(
  executor: AuthSqlExecutor,
  record: ResolvedRecord,
): Promise<LoadedFact> {
  const orders = await executor.query<OrderRow>(
    `select id, order_no as record_no, version, status
     from business_orders where vehicle_id = $1 order by id`,
    [record.id],
  );
  const inspections = await executor.query<InspectionRow>(
    `select id, report_no as record_no, version, status
     from inspection_reports where vehicle_id = $1 order by id`,
    [record.id],
  );
  const counts = await executor.query<Record<string, number>>(
    `select
       (select count(*)::int from vehicle_disputes where vehicle_id = $1) as dispute_count,
       (select count(*)::int from vehicle_pickup_notices where vehicle_id = $1) as presence_fact_count,
       (select count(*)::int from vehicle_pickup_notices where vehicle_id = $1 and picked_up_at is null) as parking_fact_count,
       (select count(*)::int from vehicle_mileage_records as mileage
        join repair_rounds as round on round.id = mileage.repair_round_id
        join business_orders as business_order on business_order.id = round.business_order_id
        where business_order.vehicle_id = $1) as mileage_record_count,
       ((select count(*)::int from repair_round_events as event
         join repair_rounds as round on round.id = event.repair_round_id
         join business_orders as business_order on business_order.id = round.business_order_id
         where business_order.vehicle_id = $1)
        +
        (select count(*)::int from repair_round_work_returns as work_return
         join repair_rounds as round on round.id = work_return.repair_round_id
         join business_orders as business_order on business_order.id = round.business_order_id
         where business_order.vehicle_id = $1)) as repair_fact_count,
       (select count(*)::int from vehicle_owner_history where vehicle_id = $1) as owner_history_count,
       (select count(*)::int from vehicle_attachments where vehicle_id = $1) as attachment_count`,
    [record.id],
  );
  const vehicle = await executor.query<{
    normalized_plate: string | null;
    vin: string | null;
  }>(`select normalized_plate, vin from vehicles where id = $1`, [record.id]);
  const released: ReleasedIdentityKind[] = [];
  if (vehicle[0]?.normalized_plate) released.push("plate");
  if (vehicle[0]?.vin) released.push("vin");
  const linked = [
    ...orders.map((row) => resolved(row, "business_order")),
    ...inspections.map((row) => resolved(row, "inspection_report")),
  ];
  const count = counts[0] ?? {};
  const fact: VehicleDeletionFact = {
    kind: "vehicle",
    reference: reference(record),
    linkedPrimaryRecords: linked.map(reference),
    dependentCounts: {
      vehicle_owner_history: numberAt(count, "owner_history_count"),
      vehicle_attachments: numberAt(count, "attachment_count"),
    },
    releasedIdentityKinds: released,
    disputeCount: numberAt(count, "dispute_count"),
    presenceFactCount: numberAt(count, "presence_fact_count"),
    mileageRecordCount: numberAt(count, "mileage_record_count"),
    repairFactCount: numberAt(count, "repair_fact_count"),
    parkingFactCount: numberAt(count, "parking_fact_count"),
  };
  return { fact, linked };
}

async function loadBusinessOrderFact(
  executor: AuthSqlExecutor,
  record: ResolvedRecord,
): Promise<LoadedFact> {
  const row = await executor.query<OrderRow>(
    `select id, order_no as record_no, version, status
     from business_orders where id = $1`,
    [record.id],
  );
  const inspections = await executor.query<InspectionRow>(
    `select id, report_no as record_no, version, status
     from inspection_reports where source_business_order_id = $1 order by id`,
    [record.id],
  );
  const counts = await executor.query<Record<string, number>>(
    `select
       (select count(*)::int from repair_rounds where business_order_id = $1) as repair_round_count,
       (select count(*)::int from repair_rounds where business_order_id = $1 and source = 'after_sales') as after_sales_round_count,
       (select count(*)::int from repair_round_events as event join repair_rounds as round on round.id = event.repair_round_id where round.business_order_id = $1) as event_count,
       (select count(*)::int from repair_round_work_returns as work_return join repair_rounds as round on round.id = work_return.repair_round_id where round.business_order_id = $1) as work_return_count,
       (select count(*)::int from vehicle_mileage_records as mileage join repair_rounds as round on round.id = mileage.repair_round_id where round.business_order_id = $1) as mileage_count,
       (select count(*)::int from repair_round_intake_photos as photo join repair_rounds as round on round.id = photo.repair_round_id where round.business_order_id = $1) as intake_photo_count,
       (select count(*)::int from business_order_payments where business_order_id = $1) as payment_count,
       (select count(*)::int from business_order_refunds where business_order_id = $1) as refund_count,
       (select count(*)::int from payment_receipts where business_order_id = $1) as receipt_count,
       (select count(*)::int from business_order_document_snapshots where business_order_id = $1) as document_count,
       (select count(*)::int from formal_handoffs where business_order_id = $1) as handoff_count,
       (select count(*)::int from vehicle_pickup_notices where origin_business_order_id = $1 or paused_by_business_order_id = $1) as pickup_count,
       (select count(*)::int from vehicle_pickup_notices where (origin_business_order_id = $1 or paused_by_business_order_id = $1) and picked_up_at is null) as parking_count,
       (select count(*)::int from business_order_charge_versions where business_order_id = $1) as charge_version_count,
       (select count(*)::int from business_order_charge_items as item join business_order_charge_versions as charge on charge.id = item.charge_version_id where charge.business_order_id = $1) as charge_item_count,
       (select count(*)::int from business_order_notes as note join business_order_charge_versions as charge on charge.id = note.charge_version_id where charge.business_order_id = $1) as note_count`,
    [record.id],
  );
  const count = counts[0] ?? {};
  const linked = inspections.map((inspection) => resolved(inspection, "inspection_report"));
  const fact: BusinessOrderDeletionFact = {
    kind: "business_order",
    reference: reference(record),
    linkedPrimaryRecords: linked.map(reference),
    dependentCounts: {
      repair_rounds: numberAt(count, "repair_round_count"),
      business_order_charge_versions: numberAt(count, "charge_version_count"),
      business_order_charge_items: numberAt(count, "charge_item_count"),
      business_order_notes: numberAt(count, "note_count"),
    },
    releasedIdentityKinds: [],
    status: row[0]?.status ?? "waiting_assignment",
    repairRoundCount: numberAt(count, "repair_round_count"),
    afterSalesRoundCount: numberAt(count, "after_sales_round_count"),
    assignmentOrRepairEventCount: numberAt(count, "event_count"),
    workReturnCount: numberAt(count, "work_return_count"),
    mileageRecordCount: numberAt(count, "mileage_count"),
    intakePhotoCount: numberAt(count, "intake_photo_count"),
    paymentCount: numberAt(count, "payment_count"),
    refundCount: numberAt(count, "refund_count"),
    receiptCount: numberAt(count, "receipt_count"),
    documentCount: numberAt(count, "document_count"),
    handoffCount: numberAt(count, "handoff_count"),
    pickupOrDepartureCount: numberAt(count, "pickup_count"),
    parkingFactCount: numberAt(count, "parking_count"),
  };
  return { fact, linked };
}

async function loadInspectionFact(
  executor: AuthSqlExecutor,
  record: ResolvedRecord,
): Promise<LoadedFact> {
  const rows = await executor.query<InspectionRow & { paper_photo_file_id: number | null }>(
    `select id, report_no as record_no, version, status, paper_photo_file_id
     from inspection_reports where id = $1`,
    [record.id],
  );
  const counts = await executor.query<Record<string, number>>(
    `select
       (select count(*)::int from inspection_report_findings where inspection_report_id = $1) as finding_count,
       (select count(*)::int from inspection_report_communications where inspection_report_id = $1) as communication_count,
       (select count(*)::int from inspection_reports where correction_of_report_id = $1) +
       (select count(*)::int from inspection_reports where id = $1 and correction_of_report_id is not null) as correction_count`,
    [record.id],
  );
  const count = counts[0] ?? {};
  const fact: InspectionReportDeletionFact = {
    kind: "inspection_report",
    reference: reference(record),
    linkedPrimaryRecords: [],
    dependentCounts: {
      inspection_report_findings: numberAt(count, "finding_count"),
      inspection_paper_photo_files: rows[0]?.paper_photo_file_id ? 1 : 0,
    },
    releasedIdentityKinds: [],
    status: rows[0]?.status ?? "draft",
    communicationCount: numberAt(count, "communication_count"),
    correctionLinkCount: numberAt(count, "correction_count"),
    formalDocumentReferenceCount: 0,
  };
  return { fact, linked: [] };
}

function resolved(
  row: CustomerRow | VehicleRow | OrderRow | InspectionRow,
  kind: RecordKind,
): ResolvedRecord {
  return {
    id: Number(row.id),
    kind,
    recordNo: row.record_no,
    version: Number(row.version),
  };
}

function reference(record: ResolvedRecord): RecordReference {
  return {
    kind: record.kind,
    recordNo: record.recordNo,
    version: record.version,
  };
}

function dedupeResolved(records: ResolvedRecord[]): ResolvedRecord[] {
  return [...new Map(records.map((record) => [recordKey(record), record])).values()];
}

function recordKey(record: RecordLocator): string {
  return `${record.kind}:${record.recordNo}`;
}

function numberAt(row: Record<string, number>, key: string): number {
  return Number(row[key] ?? 0);
}

function deletionPayloadHash(
  input: RecordDeletionExecuteInput & RecordDeletionActionContext,
): string {
  const payload = {
    actorAccountId: input.actorAccountId,
    root: input.root,
    selectedRecords: [...input.selectedRecords].sort((left, right) =>
      recordKey(left).localeCompare(recordKey(right))),
    reasonCode: input.reasonCode,
    reasonNote: input.reasonNote,
    confirmationRecordNo: input.confirmationRecordNo,
    previewFingerprint: input.previewFingerprint,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function parseDeletionResult(value: RecordDeletionResult | string): RecordDeletionResult {
  return typeof value === "string"
    ? JSON.parse(value) as RecordDeletionResult
    : value;
}

async function deleteSelectedGraph(
  transaction: AuthSqlExecutor,
  records: ResolvedRecord[],
  requestId: string,
): Promise<number> {
  const inspectionIds = idsFor(records, "inspection_report");
  const orderIds = idsFor(records, "business_order");
  const vehicleIds = idsFor(records, "vehicle");
  const personalCustomerIds = idsFor(records, "personal_customer");
  const companyCustomerIds = idsFor(records, "company_customer");
  const candidateFileIds = new Set<number>();

  if (inspectionIds.length > 0) {
    const paperFiles = await transaction.query<{ file_id: number }>(
      `select paper_photo_file_id as file_id
       from inspection_reports
       where id = any($1::bigint[]) and paper_photo_file_id is not null`,
      [inspectionIds],
    );
    paperFiles.forEach((row) => candidateFileIds.add(Number(row.file_id)));
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "inspection_report_findings",
      `select id::text from inspection_report_findings
       where inspection_report_id = any($2::bigint[])`,
      [inspectionIds],
    );
    await transaction.query(
      `delete from inspection_report_findings
       where inspection_report_id = any($1::bigint[])`,
      [inspectionIds],
    );
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "inspection_reports",
      `select id::text from inspection_reports
       where id = any($2::bigint[])`,
      [inspectionIds],
    );
    await transaction.query(
      `delete from inspection_reports where id = any($1::bigint[])`,
      [inspectionIds],
    );
  }

  if (orderIds.length > 0) {
    for (const [tableName, source] of [
      [
        "business_order_charge_items",
        `select item.id::text
         from business_order_charge_items as item
         join business_order_charge_versions as charge
           on charge.id = item.charge_version_id
         where charge.business_order_id = any($2::bigint[])`,
      ],
      [
        "business_order_notes",
        `select note.id::text
         from business_order_notes as note
         join business_order_charge_versions as charge
           on charge.id = note.charge_version_id
         where charge.business_order_id = any($2::bigint[])`,
      ],
      [
        "business_order_charge_versions",
        `select id::text from business_order_charge_versions
         where business_order_id = any($2::bigint[])`,
      ],
    ] as const) {
      await authorizeRowsFromQuery(
        transaction,
        requestId,
        tableName,
        source,
        [orderIds],
      );
    }
    await transaction.query(
      `delete from business_order_charge_items
       where charge_version_id in (
         select id from business_order_charge_versions
         where business_order_id = any($1::bigint[])
       )`,
      [orderIds],
    );
    await transaction.query(
      `delete from business_order_notes
       where charge_version_id in (
         select id from business_order_charge_versions
         where business_order_id = any($1::bigint[])
       )`,
      [orderIds],
    );
    await transaction.query(
      `delete from business_order_charge_versions
       where business_order_id = any($1::bigint[])`,
      [orderIds],
    );
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "repair_rounds",
      `select id::text from repair_rounds
       where business_order_id = any($2::bigint[])`,
      [orderIds],
    );
    await transaction.query(
      `delete from repair_rounds where business_order_id = any($1::bigint[])`,
      [orderIds],
    );
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "business_orders",
      `select id::text from business_orders
       where id = any($2::bigint[])`,
      [orderIds],
    );
    await transaction.query(
      `delete from business_orders where id = any($1::bigint[])`,
      [orderIds],
    );
  }

  if (vehicleIds.length > 0) {
    const attachmentFiles = await transaction.query<{ file_id: number }>(
      `select file_id from vehicle_attachments
       where vehicle_id = any($1::bigint[])`,
      [vehicleIds],
    );
    attachmentFiles.forEach((row) => candidateFileIds.add(Number(row.file_id)));
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "vehicle_attachments",
      `select vehicle_id::text || ':' || file_id::text
       from vehicle_attachments where vehicle_id = any($2::bigint[])`,
      [vehicleIds],
    );
    await transaction.query(
      `delete from vehicle_attachments where vehicle_id = any($1::bigint[])`,
      [vehicleIds],
    );
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "vehicle_owner_history",
      `select id::text from vehicle_owner_history
       where vehicle_id = any($2::bigint[])`,
      [vehicleIds],
    );
    await transaction.query(
      `delete from vehicle_owner_history where vehicle_id = any($1::bigint[])`,
      [vehicleIds],
    );
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "vehicles",
      `select id::text from vehicles where id = any($2::bigint[])`,
      [vehicleIds],
    );
    await transaction.query(
      `delete from vehicles where id = any($1::bigint[])`,
      [vehicleIds],
    );
  }

  if (personalCustomerIds.length > 0 || companyCustomerIds.length > 0) {
    const licenseParameters = [personalCustomerIds, companyCustomerIds];
    const licenseFiles = await transaction.query<{ file_id: number }>(
      `select file_id from customer_driver_license_records
       where personal_customer_id = any($1::bigint[])
          or company_account_id = any($2::bigint[])`,
      licenseParameters,
    );
    licenseFiles.forEach((row) => candidateFileIds.add(Number(row.file_id)));
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "customer_driver_license_records",
      `select id::text from customer_driver_license_records
       where personal_customer_id = any($2::bigint[])
          or company_account_id = any($3::bigint[])`,
      licenseParameters,
    );
    await transaction.query(
      `delete from customer_driver_license_records
       where personal_customer_id = any($1::bigint[])
          or company_account_id = any($2::bigint[])`,
      licenseParameters,
    );
    await authorizeRowsFromQuery(
      transaction,
      requestId,
      "company_contacts",
      `select id::text from company_contacts
       where personal_customer_id = any($2::bigint[])
          or company_id = any($3::bigint[])`,
      licenseParameters,
    );
    await transaction.query(
      `delete from company_contacts
       where personal_customer_id = any($1::bigint[])
          or company_id = any($2::bigint[])`,
      licenseParameters,
    );
    if (personalCustomerIds.length > 0) {
      await authorizeRowsFromQuery(
        transaction,
        requestId,
        "personal_customers",
        `select id::text from personal_customers
         where id = any($2::bigint[])`,
        [personalCustomerIds],
      );
      await transaction.query(
        `delete from personal_customers where id = any($1::bigint[])`,
        [personalCustomerIds],
      );
    }
    if (companyCustomerIds.length > 0) {
      await authorizeRowsFromQuery(
        transaction,
        requestId,
        "company_accounts",
        `select id::text from company_accounts
         where id = any($2::bigint[])`,
        [companyCustomerIds],
      );
      await transaction.query(
        `delete from company_accounts where id = any($1::bigint[])`,
        [companyCustomerIds],
      );
    }
  }

  if (candidateFileIds.size === 0) return 0;
  const orphanFiles = await transaction.query<{ id: number; storage_key: string }>(
    `select file.id, file.storage_key
     from stored_files as file
     where file.id = any($1::bigint[])
       and not exists (select 1 from vehicle_attachments where file_id = file.id)
       and not exists (select 1 from customer_driver_license_records where file_id = file.id)
       and not exists (select 1 from repair_round_intake_photos where file_id = file.id)
       and not exists (select 1 from refund_evidence_files where file_id = file.id)
       and not exists (select 1 from inspection_reports where paper_photo_file_id = file.id)
     order by file.id`,
    [[...candidateFileIds]],
  );
  for (const file of orphanFiles) {
    await transaction.query(
      `insert into record_deletion_file_tasks (storage_key)
       values ($1)
       on conflict do nothing`,
      [file.storage_key],
    );
    await transaction.query(
      `insert into record_deletion_authorized_rows
        (request_id, table_name, row_key)
       values ($1, 'stored_files', $2)
       on conflict do nothing`,
      [requestId, String(file.id)],
    );
  }
  if (orphanFiles.length > 0) {
    await transaction.query(
      `delete from stored_files where id = any($1::bigint[])`,
      [orphanFiles.map((file) => Number(file.id))],
    );
  }
  return orphanFiles.length;
}

async function authorizeRowsFromQuery(
  transaction: AuthSqlExecutor,
  requestId: string,
  tableName: string,
  rowKeyQuery: string,
  parameters: readonly unknown[],
): Promise<void> {
  await transaction.query(
    `insert into record_deletion_authorized_rows
      (request_id, table_name, row_key)
     select $1, $${parameters.length + 2}, scoped.row_key
     from (${rowKeyQuery}) as scoped(row_key)
     on conflict do nothing`,
    [requestId, ...parameters, tableName],
  );
}

function idsFor(records: ResolvedRecord[], kind: RecordKind): number[] {
  return records
    .filter((record) => record.kind === kind)
    .map((record) => record.id);
}
