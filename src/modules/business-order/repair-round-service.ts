import { createHash } from "node:crypto";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import { formallyHandOffRoundInTransaction } from "@formal/modules/business-order/formal-handoff-service";
import { toBusinessMonthKey } from "@formal/lib/time";

type RepairRoundStatus =
  | "waiting_assignment"
  | "assigned"
  | "in_repair"
  | "return_pending_review"
  | "formally_handed_off";

type RepairRoundSource = "initial" | "after_sales";
type WorkReturnSource = "electronic" | "paper";
type WorkReturnAttachmentPurpose = "paper_return" | "service_photo";

export type WorkReturnItemResult = {
  chargeItemId: string;
  category: "labor" | "part" | "other";
  labelZh: string;
  labelEn?: string | null;
  result: "completed" | "not_completed";
  note?: string | null;
};

export type WorkReturnDetails = {
  id: number;
  submissionNo: number;
  submissionSource: WorkReturnSource;
  workSummary: string | null;
  exceptionSummary: string | null;
  itemResults: WorkReturnItemResult[];
  actualStaffMemberId: number | null;
  actualStaffName: string | null;
  submittedBy: number;
  submittedByName: string;
  submittedAt: Date;
  attachments: Array<{
    id: number;
    purpose: WorkReturnAttachmentPurpose;
    originalName: string;
    mediaType: string;
  }>;
  review: null | {
    result: "approved" | "rejected";
    reason: string | null;
    reviewerAccountId: number;
    reviewerName: string;
    reviewedAt: Date;
  };
};

export type MechanicWorkOrderSummary = {
  businessOrderId: number;
  orderNo: string;
  status: RepairRoundStatus;
  vehicle: { plate: string; description: string; vin: string | null };
  repairRound: {
    id: number;
    roundNo: number;
    assignedTeamId: number;
    assignedTeamName: string;
    version: number;
  };
  latestRejectionReason: string | null;
};

export type MechanicWorkOrderDetail = MechanicWorkOrderSummary & {
  intakeMileageKm: number | null;
  intakePhotoFileIds: number[];
  workItems: Array<{
    id: string;
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    quantity: string;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice";
    contentZh: string | null;
    contentEn: string | null;
  }>;
  latestWorkReturn: WorkReturnDetails | null;
};

type RepairRoundRow = {
  id: number;
  business_order_id: number;
  round_no: number;
  source: RepairRoundSource;
  after_sales_issue: string | null;
  performance_draft_minor: number | null;
  status: RepairRoundStatus;
  assigned_team_id: number | null;
  vehicle_id: number;
  business_order_version: number;
  voided_at: Date | null;
  created_at: Date;
  created_by: number;
  updated_at: Date;
  version: number;
};

export type CurrentRepairRound = {
  id: number;
  businessOrderId: number;
  roundNo: number;
  source: RepairRoundSource;
  afterSalesIssue: string | null;
  performanceDraftMinor: number | null;
  status: RepairRoundStatus;
  assignedTeamId: number | null;
  intakeMileageKm: number | null;
  intakePhotoFileIds: number[];
  latestWorkReturnId: number | null;
  approvedWorkReturnId: number | null;
  latestWorkReturn?: WorkReturnDetails | null;
  version: number;
};

export type RepairRoundHistoryRecord = {
  id: number;
  businessOrderId: number;
  roundNo: number;
  source: RepairRoundSource;
  afterSalesIssue: string | null;
  performanceDraftMinor: number | null;
  status: RepairRoundStatus;
  assignedTeamId: number | null;
  createdAt: Date;
  createdBy: number;
  updatedAt: Date;
  version: number;
  events: Array<{
    id: number;
    eventType: string;
    teamId: number | null;
    workReturnId: number | null;
    note: string | null;
    actorAccountId: number;
    occurredAt: Date;
  }>;
  formalHandoffs: Array<{
    id: number;
    handoffNo: number;
    performanceMinor: number;
    jamaicaMonth: string;
    handedOffAt: Date;
    cancelledAt: Date | null;
    performanceAdjustmentAllowed: boolean;
    performanceAdjustmentUnavailableReason: "cancelled" | "closed_month" | null;
  }>;
};

export type BusinessOrderAuditTrailRecord = {
  id: number;
  occurredAt: Date;
  actorAccountId: number | null;
  actorDisplayName: string | null;
  actorUsername: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type AfterSalesRoundDeletionBlocker = {
  code:
    | "BUSINESS_ORDER_VOIDED"
    | "PREVIOUS_ROUND_NOT_FORMALLY_HANDED_OFF"
    | "PREVIOUS_ROUND_HAS_NO_ACTIVE_HANDOFF"
    | "ACTIVE_FORMAL_HANDOFF_EXISTS"
    | "INSPECTION_REPORTS_EXIST"
    | "DOCUMENT_SNAPSHOTS_EXIST";
  label: string;
  recordNos?: string[];
};

export type AfterSalesRoundDeletionPreview = {
  eligible: boolean;
  recordNo: string;
  repairRoundId: number;
  roundNo: number;
  repairRoundVersion: number;
  performanceDraftMinor: number | null;
  counts: {
    events: number;
    workReturns: number;
    workReturnAttachments: number;
    mileageRecords: number;
    intakePhotos: number;
    formalHandoffs: number;
    formalHandoffCancellations: number;
    inspectionReports: number;
    documentSnapshots: number;
    problemVersions: number;
  };
  blockers: AfterSalesRoundDeletionBlocker[];
  previewFingerprint: string;
};

export type DeleteInvalidAfterSalesRoundResult = {
  cancelled: true;
  deletedRoundNo: number;
  restoredRoundNo: number;
};

export class RepairRoundValidationError extends Error {
  readonly status = 422;
  readonly code = "repair_round_validation";

  constructor(message: string) {
    super(message);
    this.name = "RepairRoundValidationError";
  }
}

export class RepairRoundNotFoundError extends Error {
  readonly status = 404;
  readonly code = "repair_round_not_found";

  constructor(message = "当前维修轮次不存在") {
    super(message);
    this.name = "RepairRoundNotFoundError";
  }
}

export class RepairRoundReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "repair_round_read_denied";

  constructor() {
    super("当前账号不能查看这次维修");
    this.name = "RepairRoundReadDeniedError";
  }
}

export class RepairRoundWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "repair_round_write_denied";

  constructor() {
    super("当前账号不能执行这项维修操作");
    this.name = "RepairRoundWriteDeniedError";
  }
}

export class RepairRoundService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async getCurrentRound(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<CurrentRepairRound> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const rounds = await selectCurrentRound(this.database, businessOrderId);
    const round = rounds[0];
    if (!round) throw new RepairRoundNotFoundError();
    await requireRoundReader(this.database, input.viewerAccountId, round);

    const mileage = await this.database.query<{ odometer_km: number }>(
      `select odometer_km from vehicle_mileage_records
       where repair_round_id = $1 limit 1`,
      [round.id],
    );
    const photos = await this.database.query<{ file_id: number }>(
      `select file_id from repair_round_intake_photos
       where repair_round_id = $1 order by linked_at, file_id`,
      [round.id],
    );
    const workReturns = await this.database.query<{
      id: number;
      submission_no: number;
      submission_source: WorkReturnSource;
      work_summary: string | null;
      exception_summary: string | null;
      item_results: WorkReturnItemResult[] | string;
      actual_staff_member_id: number | null;
      actual_staff_name: string | null;
      submitted_by: number;
      submitted_by_name: string;
      submitted_at: Date;
    }>(
      `select work_return.id, work_return.submission_no,
              work_return.submission_source, work_return.work_summary,
              work_return.exception_summary, work_return.item_results,
              work_return.actual_staff_member_id,
              staff.full_name as actual_staff_name,
              work_return.submitted_by,
              submitter.display_name as submitted_by_name,
              work_return.submitted_at
       from repair_round_work_returns as work_return
       join staff_accounts as submitter on submitter.id = work_return.submitted_by
       left join staff_members as staff on staff.id = work_return.actual_staff_member_id
       where work_return.repair_round_id = $1
       order by work_return.submission_no desc limit 1`,
      [round.id],
    );
    const latestWorkReturn = workReturns[0];
    const reviews = latestWorkReturn
      ? await this.database.query<{
          event_type: "work_return_approved" | "work_return_rejected";
          note: string | null;
          actor_account_id: number;
          actor_display_name: string;
          occurred_at: Date;
        }>(
          `select event.event_type, event.note, event.actor_account_id,
                  reviewer.display_name as actor_display_name, event.occurred_at
           from repair_round_events as event
           join staff_accounts as reviewer on reviewer.id = event.actor_account_id
           where event.repair_round_id = $1 and event.work_return_id = $2
             and event.event_type in ('work_return_rejected', 'work_return_approved')
           order by event.occurred_at desc, event.id desc limit 1`,
          [round.id, latestWorkReturn.id],
        )
      : [];
    const workReturnAttachments = latestWorkReturn
      ? await this.database.query<{
          id: number;
          purpose: WorkReturnAttachmentPurpose;
          original_name: string;
          media_type: string;
        }>(
          `select attachment.id, link.purpose, file.original_name, file.media_type
           from repair_round_work_return_attachments as link
           join business_order_attachments as attachment on attachment.id = link.attachment_id
           join stored_files as file on file.id = attachment.file_id
           where link.work_return_id = $1
           order by attachment.linked_at, attachment.id`,
          [latestWorkReturn.id],
        )
      : [];
    const latestReview = reviews[0];
    const latestWorkReturnDetails: WorkReturnDetails | null = latestWorkReturn
      ? {
          id: Number(latestWorkReturn.id),
          submissionNo: latestWorkReturn.submission_no,
          submissionSource: latestWorkReturn.submission_source,
          workSummary: latestWorkReturn.work_summary,
          exceptionSummary: latestWorkReturn.exception_summary,
          itemResults: normalizeItemResults(latestWorkReturn.item_results),
          actualStaffMemberId: nullableNumber(latestWorkReturn.actual_staff_member_id),
          actualStaffName: latestWorkReturn.actual_staff_name,
          submittedBy: Number(latestWorkReturn.submitted_by),
          submittedByName: latestWorkReturn.submitted_by_name,
          submittedAt: new Date(latestWorkReturn.submitted_at),
          attachments: workReturnAttachments.map((attachment) => ({
            id: Number(attachment.id),
            purpose: attachment.purpose,
            originalName: attachment.original_name,
            mediaType: attachment.media_type,
          })),
          review: latestReview
            ? {
                result: latestReview.event_type === "work_return_approved" ? "approved" : "rejected",
                reason: latestReview.note,
                reviewerAccountId: Number(latestReview.actor_account_id),
                reviewerName: latestReview.actor_display_name,
                reviewedAt: new Date(latestReview.occurred_at),
              }
            : null,
        }
      : null;
    return {
      id: Number(round.id),
      businessOrderId: Number(round.business_order_id),
      roundNo: round.round_no,
      source: round.source,
      afterSalesIssue: round.after_sales_issue,
      performanceDraftMinor: nullableNumber(round.performance_draft_minor),
      status: round.status,
      assignedTeamId: nullableNumber(round.assigned_team_id),
      intakeMileageKm: mileage[0] ? Number(mileage[0].odometer_km) : null,
      intakePhotoFileIds: photos.map((photo) => Number(photo.file_id)),
      latestWorkReturnId: latestWorkReturn ? Number(latestWorkReturn.id) : null,
      approvedWorkReturnId: latestReview?.event_type === "work_return_approved"
        ? Number(latestWorkReturn?.id)
        : null,
      latestWorkReturn: latestWorkReturnDetails,
      version: round.version,
    };
  }

  async listMechanicWorkOrders(input: {
    viewerAccountId: number;
  }): Promise<{ items: MechanicWorkOrderSummary[] }> {
    const actor = await requireMechanicIdentity(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      business_order_id: number;
      order_no: string;
      status: RepairRoundStatus;
      vehicle_plate_snapshot: string;
      vehicle_description_snapshot: string;
      vehicle_vin_snapshot: string | null;
      repair_round_id: number;
      round_no: number;
      assigned_team_id: number;
      assigned_team_name: string;
      repair_round_version: number;
      latest_rejection_reason: string | null;
    }>(
      `select business_order.id as business_order_id, business_order.order_no,
              repair_round.status, business_order.vehicle_plate_snapshot,
              business_order.vehicle_description_snapshot,
              business_order.vehicle_vin_snapshot,
              repair_round.id as repair_round_id, repair_round.round_no,
              repair_round.assigned_team_id,
              team.name as assigned_team_name,
              repair_round.version as repair_round_version,
              (
                select event.note
                from repair_round_events as event
                join repair_round_work_returns as work_return
                  on work_return.id = event.work_return_id
                where event.repair_round_id = repair_round.id
                  and event.event_type = 'work_return_rejected'
                  and work_return.submission_no = (
                    select max(candidate.submission_no)
                    from repair_round_work_returns as candidate
                    where candidate.repair_round_id = repair_round.id
                  )
                order by event.occurred_at desc, event.id desc limit 1
              ) as latest_rejection_reason
       from repair_rounds as repair_round
       join business_orders as business_order
         on business_order.id = repair_round.business_order_id
        and business_order.current_repair_round_no = repair_round.round_no
       join repair_teams as team on team.id = repair_round.assigned_team_id
       where repair_round.assigned_team_id = $1
         and repair_round.status in ('assigned', 'in_repair', 'return_pending_review')
         and business_order.voided_at is null
       order by business_order.updated_at desc, business_order.id desc`,
      [actor.teamId],
    );
    return { items: rows.map(mapMechanicWorkOrderSummary) };
  }

  async getMechanicWorkOrder(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<MechanicWorkOrderDetail> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const actor = await requireMechanicIdentity(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      business_order_id: number;
      order_no: string;
      status: RepairRoundStatus;
      vehicle_plate_snapshot: string;
      vehicle_description_snapshot: string;
      vehicle_vin_snapshot: string | null;
      repair_round_id: number;
      round_no: number;
      assigned_team_id: number;
      assigned_team_name: string;
      repair_round_version: number;
      latest_rejection_reason: string | null;
      current_charge_version_id: number;
    }>(
      `select business_order.id as business_order_id, business_order.order_no,
              repair_round.status, business_order.vehicle_plate_snapshot,
              business_order.vehicle_description_snapshot,
              business_order.vehicle_vin_snapshot,
              repair_round.id as repair_round_id, repair_round.round_no,
              repair_round.assigned_team_id,
              team.name as assigned_team_name,
              repair_round.version as repair_round_version,
              charge.id as current_charge_version_id,
              (
                select event.note from repair_round_events as event
                join repair_round_work_returns as work_return on work_return.id = event.work_return_id
                where event.repair_round_id = repair_round.id
                  and event.event_type = 'work_return_rejected'
                  and work_return.submission_no = (
                    select max(candidate.submission_no)
                    from repair_round_work_returns as candidate
                    where candidate.repair_round_id = repair_round.id
                  )
                order by event.occurred_at desc, event.id desc limit 1
              ) as latest_rejection_reason
       from business_orders as business_order
       join repair_rounds as repair_round
         on repair_round.business_order_id = business_order.id
        and repair_round.round_no = business_order.current_repair_round_no
       join repair_teams as team on team.id = repair_round.assigned_team_id
       join business_order_charge_versions as charge
         on charge.business_order_id = business_order.id
        and charge.version_no = business_order.current_charge_version_no
       where business_order.id = $1 and business_order.voided_at is null
         and repair_round.assigned_team_id = $2
       limit 1`,
      [businessOrderId, actor.teamId],
    );
    const row = rows[0];
    if (!row) throw new RepairRoundReadDeniedError();
    const [currentRound, items, notes] = await Promise.all([
      this.getCurrentRound({ businessOrderId, viewerAccountId: input.viewerAccountId }),
      this.database.query<{
        id: number;
        kind: "labor" | "part" | "other";
        name_zh: string;
        name_en: string | null;
        description_zh: string | null;
        description_en: string | null;
        quantity: string;
      }>(
        `select id, kind, name_zh, name_en, description_zh, description_en,
                quantity::text as quantity
         from business_order_charge_items
         where charge_version_id = $1 order by sort_order, id`,
        [row.current_charge_version_id],
      ),
      this.database.query<{
        kind: "customer_concern" | "work_instruction" | "liability_notice";
        content_zh: string | null;
        content_en: string | null;
      }>(
        `select kind, content_zh, content_en from business_order_notes
         where charge_version_id = $1 and kind <> 'internal'
         order by sort_order, id`,
        [row.current_charge_version_id],
      ),
    ]);
    return {
      ...mapMechanicWorkOrderSummary(row),
      intakeMileageKm: currentRound.intakeMileageKm,
      intakePhotoFileIds: currentRound.intakePhotoFileIds,
      workItems: items.map((item) => ({
        id: String(item.id),
        kind: item.kind,
        nameZh: item.name_zh,
        nameEn: item.name_en,
        descriptionZh: item.description_zh,
        descriptionEn: item.description_en,
        quantity: item.quantity,
      })),
      notes: notes.map((note) => ({
        kind: note.kind,
        contentZh: note.content_zh,
        contentEn: note.content_en,
      })),
      latestWorkReturn: currentRound.latestWorkReturn ?? null,
    };
  }

  async startAfterSalesRound(input: {
    businessOrderId: number;
    expectedBusinessOrderVersion: number;
    issue: string;
    context: BusinessOrderActionContext;
  }): Promise<CurrentRepairRound> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(
      input.expectedBusinessOrderVersion,
      "Business Order 版本",
    );
    const issue = nonempty(input.issue, "售后问题");
    const now = input.context.now ?? new Date();

    await this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const current = await lockCurrentRound(transaction, businessOrderId);
      if (current.voided_at) {
        throw new RepairRoundValidationError("已作废的 Business Order 不能发起售后维修");
      }
      if (current.business_order_version !== expectedVersion) {
        throw new RepairRoundValidationError("Business Order 已发生变化，请刷新后重试");
      }
      if (current.status !== "formally_handed_off") {
        throw new RepairRoundValidationError("只有当前维修轮次正式交单后才能发起售后维修");
      }
      const activeHandoff = await transaction.query<{ id: number }>(
        `select handoff.id
         from formal_handoffs as handoff
         left join formal_handoff_cancellations as cancellation
           on cancellation.formal_handoff_id = handoff.id
         where handoff.repair_round_id = $1 and cancellation.id is null
         limit 1`,
        [current.id],
      );
      if (!activeHandoff[0]) {
        throw new RepairRoundValidationError("当前维修轮次没有有效正式交单");
      }

      const nextRoundNo = current.round_no + 1;
      await transaction.query(
        `insert into repair_rounds
          (business_order_id, round_no, source, after_sales_issue, status,
           assigned_team_id, performance_draft_minor,
           created_at, created_by, updated_at, version)
         values ($1, $2, 'after_sales', $3, 'waiting_assignment',
                 null, 0, $4, $5, $4, 1)`,
        [businessOrderId, nextRoundNo, issue, now, input.context.actorAccountId],
      );
      await transaction.query(
        "select set_config('whole_hearted.repair_event_projection', 'on', true)",
      );
      const updated = await transaction.query<{ id: number }>(
        `update business_orders
         set current_repair_round_no = $2,
             status = 'waiting_assignment', updated_at = $3,
             version = version + 1
         where id = $1 and version = $4
         returning id`,
        [businessOrderId, nextRoundNo, now, expectedVersion],
      );
      if (!updated[0]) {
        throw new RepairRoundValidationError("Business Order 已发生变化，请刷新后重试");
      }
      await audit(
        transaction,
        input.context,
        now,
        "business_order.after_sales_round_started",
        businessOrderId,
        { roundNo: nextRoundNo, issue },
      );
    });

    return this.getCurrentRound({
      businessOrderId,
      viewerAccountId: input.context.actorAccountId,
    });
  }

  async cancelAfterSalesRound(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    context: BusinessOrderActionContext;
  }): Promise<{ cancelled: true }> {
    const result = await this.deleteAfterSalesRound({
      businessOrderId: input.businessOrderId,
      expectedRepairRoundVersion: input.expectedRepairRoundVersion,
      context: input.context,
      requireEmptyRound: true,
      reasonCode: "input_error",
      auditEventType: "business_order.after_sales_round_cancelled",
    });
    return { cancelled: result.cancelled };
  }

  async getAfterSalesRoundDeletionPreview(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<AfterSalesRoundDeletionPreview | null> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const current = (await selectCurrentRound(this.database, businessOrderId))[0];
    if (!current) throw new RepairRoundNotFoundError();
    await requireRoundReader(this.database, input.viewerAccountId, current);
    if (current.source !== "after_sales" || current.round_no <= 1) return null;
    return loadAfterSalesRoundDeletionPreview(this.database, businessOrderId, current);
  }

  async deleteInvalidAfterSalesRound(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    previewFingerprint: string;
    reasonCode: "duplicate" | "input_error" | "test_data" | "other";
    reasonNote: string;
    confirmationRecordNo: string;
    context: BusinessOrderActionContext;
  }): Promise<DeleteInvalidAfterSalesRoundResult> {
    const previewFingerprint = nonempty(input.previewFingerprint, "删除预览指纹");
    const confirmationRecordNo = nonempty(input.confirmationRecordNo, "确认记录号").toUpperCase();
    const reasonNote = input.reasonNote.normalize("NFKC").trim() || null;
    const reasonCode = validAfterSalesRoundDeletionReasonCode(input.reasonCode);
    if (reasonCode === "other" && !reasonNote) {
      throw new RepairRoundValidationError("请选择其他原因时填写删除原因说明");
    }
    if (!/^[a-f0-9]{64}$/.test(previewFingerprint)) {
      throw new RepairRoundValidationError("删除预览指纹无效");
    }
    return this.deleteAfterSalesRound({
      businessOrderId: input.businessOrderId,
      expectedRepairRoundVersion: input.expectedRepairRoundVersion,
      context: input.context,
      requireEmptyRound: false,
      previewFingerprint,
      confirmationRecordNo,
      reasonCode,
      reasonNote: reasonNote ?? undefined,
      auditEventType: "business_order.invalid_after_sales_round_deleted",
    });
  }

  private async deleteAfterSalesRound(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    context: BusinessOrderActionContext;
    requireEmptyRound: boolean;
    previewFingerprint?: string;
    confirmationRecordNo?: string;
    reasonCode: "duplicate" | "input_error" | "test_data" | "other";
    reasonNote?: string;
    auditEventType: string;
  }): Promise<DeleteInvalidAfterSalesRoundResult> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const requestId = nonempty(input.context.requestId, "删除请求编号");
    const now = input.context.now ?? new Date();
    const payloadHash = afterSalesRoundDeletionPayloadHash({
      businessOrderId,
      expectedVersion,
      actorAccountId: input.context.actorAccountId,
      requireEmptyRound: input.requireEmptyRound,
      previewFingerprint: input.previewFingerprint ?? null,
      confirmationRecordNo: input.confirmationRecordNo ?? null,
      reasonCode: input.reasonCode,
      reasonNote: input.reasonNote ?? null,
    });

    return this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      await transaction.query("select pg_advisory_xact_lock(hashtext($1))", [
        `after-sales-round-deletion:${requestId}`,
      ]);
      const prior = await transaction.query<{
        actor_account_id: number;
        payload_hash: string;
        result: DeleteInvalidAfterSalesRoundResult | string;
      }>(
        `select actor_account_id, payload_hash, result
         from record_deletion_receipts where request_id = $1 for update`,
        [requestId],
      );
      if (prior[0]) {
        if (Number(prior[0].actor_account_id) !== input.context.actorAccountId
            || prior[0].payload_hash !== payloadHash) {
          throw new RepairRoundValidationError("删除请求编号已用于其他操作");
        }
        return parseAfterSalesRoundDeletionResult(prior[0].result);
      }

      const current = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(current, expectedVersion);
      if (current.source !== "after_sales" || current.round_no <= 1) {
        throw new RepairRoundValidationError("只有当前售后维修轮次可以删除");
      }
      const preview = await loadAfterSalesRoundDeletionPreview(transaction, businessOrderId, current);
      if (input.requireEmptyRound) {
        requireEmptyAfterSalesRound(preview, current);
      } else {
        if (input.previewFingerprint !== preview.previewFingerprint) {
          throw new RepairRoundValidationError("删除预览已经过期，请刷新后重试");
        }
        if (input.confirmationRecordNo !== preview.recordNo) {
          throw new RepairRoundValidationError("确认记录号与当前售后轮次不一致");
        }
        if (!preview.eligible) {
          throw new RepairRoundValidationError("当前售后轮次不满足受控删除条件");
        }
      }

      const result: DeleteInvalidAfterSalesRoundResult = {
        cancelled: true,
        deletedRoundNo: current.round_no,
        restoredRoundNo: current.round_no - 1,
      };
      await transaction.query(
        `insert into record_deletion_receipts
          (request_id, actor_account_id, payload_hash, root_kind, root_record_no,
           reason_code, result, created_at)
         values ($1, $2, $3, 'repair_round', $4, $5, $6::jsonb, $7)`,
        [
          requestId,
          input.context.actorAccountId,
          payloadHash,
          preview.recordNo,
          input.reasonCode,
          JSON.stringify(result),
          now,
        ],
      );
      await transaction.query("select set_config('app.record_deletion_request_id', $1, true)", [
        requestId,
      ]);
      await authorizeAfterSalesRoundDeletionRows(transaction, requestId, current.id);
      await transaction.query(
        "select set_config('whole_hearted.repair_event_projection', 'on', true)",
      );
      const updated = await transaction.query<{ id: number }>(
        `update business_orders
         set current_repair_round_no = $2,
             status = 'formally_handed_off', updated_at = $3,
             version = version + 1
         where id = $1 and version = $4 and current_repair_round_no = $5
         returning id`,
        [businessOrderId, result.restoredRoundNo, now, current.business_order_version, current.round_no],
      );
      if (!updated[0]) {
        throw new RepairRoundValidationError("Business Order 已发生变化，请刷新后重试");
      }
      await deleteAfterSalesRoundFacts(transaction, current.id, expectedVersion);
      await writeAuditEvent(transaction, {
        occurredAt: now,
        actorAccountId: input.context.actorAccountId,
        eventType: input.auditEventType,
        objectType: "business_order",
        objectId: String(businessOrderId),
        reason: input.reasonNote
          ? `${input.reasonCode}: ${input.reasonNote}`
          : input.reasonCode,
        after: {
          businessOrderId,
          cancelledRoundNo: current.round_no,
          previousRoundNo: result.restoredRoundNo,
          issue: current.after_sales_issue,
          deletionMode: input.requireEmptyRound ? "legacy_empty_round" : "authorized_invalid_round",
          reasonCode: input.reasonCode,
          reasonNoteProvided: Boolean(input.reasonNote),
          previewFingerprint: preview.previewFingerprint,
          deletedFactCounts: preview.counts,
        },
        requestId: input.context.requestId,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
      return result;
    });
  }

  async setPerformanceDraft(input: {
    businessOrderId: number;
    expectedRepairRoundId: number;
    expectedRepairRoundVersion: number;
    performanceValue: string;
    context: BusinessOrderActionContext;
  }): Promise<CurrentRepairRound> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedRoundId = positiveId(input.expectedRepairRoundId, "绩效草稿目标维修轮次，请刷新后重新核对");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const performanceDraftMinor = parseSignedMoney(input.performanceValue, "绩效草稿");
    const now = input.context.now ?? new Date();

    await this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const current = await lockCurrentRound(transaction, businessOrderId);
      if (Number(current.id) !== expectedRoundId) {
        throw new RepairRoundValidationError("维修轮次已变化，请保留草稿并核对最新记录后重新调整");
      }
      if (current.voided_at) {
        throw new RepairRoundValidationError("已作废的 Business Order 不能修改绩效草稿");
      }
      requireRoundVersion(current, expectedVersion);
      if (current.status === "formally_handed_off") {
        throw new RepairRoundValidationError("正式交单后的维修轮次不能修改绩效草稿");
      }

      await transaction.query(
        "select set_config('whole_hearted.repair_event_projection', 'on', true)",
      );
      const updated = await transaction.query<{ id: number }>(
        `update repair_rounds
         set performance_draft_minor = $1,
             updated_at = $2,
             version = version + 1
         where id = $3 and version = $4
         returning id`,
        [performanceDraftMinor, now, current.id, expectedVersion],
      );
      if (!updated[0]) {
        throw new RepairRoundValidationError("维修轮次已被其他操作修改，请刷新后重试");
      }
      await writeAuditEvent(transaction, {
        occurredAt: now,
        actorAccountId: input.context.actorAccountId,
        eventType: "business_order.performance_draft_set",
        objectType: "business_order",
        objectId: String(businessOrderId),
        before: {
          businessOrderId,
          repairRoundId: Number(current.id),
          repairRoundNo: current.round_no,
          performanceDraftMinor: nullableNumber(current.performance_draft_minor),
        },
        after: {
          businessOrderId,
          repairRoundId: Number(current.id),
          repairRoundNo: current.round_no,
          performanceDraftMinor,
        },
        requestId: input.context.requestId,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
    });

    return this.getCurrentRound({
      businessOrderId,
      viewerAccountId: input.context.actorAccountId,
    });
  }

  async listRepairRounds(input: {
    businessOrderId: number;
    viewerAccountId: number;
    now?: Date;
  }): Promise<RepairRoundHistoryRecord[]> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const currentRows = await selectCurrentRound(this.database, businessOrderId);
    const current = currentRows[0];
    if (!current) throw new RepairRoundNotFoundError();
    await requireRoundReader(this.database, input.viewerAccountId, current);

    const rounds = await this.database.query<RepairRoundRow>(
      `select repair_round.id, repair_round.business_order_id,
              repair_round.round_no, repair_round.source,
              repair_round.after_sales_issue, repair_round.performance_draft_minor,
              repair_round.status,
              repair_round.assigned_team_id, repair_round.created_at,
              repair_round.created_by, repair_round.updated_at,
              repair_round.version, business_order.vehicle_id,
              business_order.version as business_order_version,
              business_order.voided_at
       from repair_rounds as repair_round
       join business_orders as business_order
         on business_order.id = repair_round.business_order_id
       where repair_round.business_order_id = $1
       order by repair_round.round_no, repair_round.id`,
      [businessOrderId],
    );
    const events = await this.database.query<{
      id: number;
      repair_round_id: number;
      event_type: string;
      team_id: number | null;
      work_return_id: number | null;
      note: string | null;
      actor_account_id: number;
      occurred_at: Date;
    }>(
      `select event.id, event.repair_round_id, event.event_type,
              event.team_id, event.work_return_id, event.note,
              event.actor_account_id, event.occurred_at
       from repair_round_events as event
       join repair_rounds as repair_round on repair_round.id = event.repair_round_id
       where repair_round.business_order_id = $1
       order by repair_round.round_no, event.occurred_at, event.id`,
      [businessOrderId],
    );
    const handoffs = await this.database.query<{
      id: number;
      repair_round_id: number;
      handoff_no: number;
      performance_minor: number;
      jamaica_month: string | Date;
      handed_off_at: Date;
      cancelled_at: Date | null;
    }>(
      `select handoff.id, handoff.repair_round_id, handoff.handoff_no,
              handoff.performance_minor, handoff.jamaica_month,
              handoff.handed_off_at, cancellation.cancelled_at
       from formal_handoffs as handoff
       left join formal_handoff_cancellations as cancellation
         on cancellation.formal_handoff_id = handoff.id
       where handoff.business_order_id = $1
       order by handoff.handoff_no, handoff.id`,
      [businessOrderId],
    );
    const currentJamaicaMonth = toBusinessMonthKey(input.now ?? new Date());

    return rounds.map((round) => ({
      id: Number(round.id),
      businessOrderId: Number(round.business_order_id),
      roundNo: round.round_no,
      source: round.source,
      afterSalesIssue: round.after_sales_issue,
      performanceDraftMinor: nullableNumber(round.performance_draft_minor),
      status: round.status,
      assignedTeamId: nullableNumber(round.assigned_team_id),
      createdAt: new Date(round.created_at),
      createdBy: Number(round.created_by),
      updatedAt: new Date(round.updated_at),
      version: round.version,
      events: events
        .filter((event) => Number(event.repair_round_id) === Number(round.id))
        .map((event) => ({
          id: Number(event.id),
          eventType: event.event_type,
          teamId: nullableNumber(event.team_id),
          workReturnId: nullableNumber(event.work_return_id),
          note: event.note,
          actorAccountId: Number(event.actor_account_id),
          occurredAt: new Date(event.occurred_at),
        })),
      formalHandoffs: handoffs
        .filter((handoff) => Number(handoff.repair_round_id) === Number(round.id))
        .map((handoff) => {
          const jamaicaMonth = normalizeMonth(handoff.jamaica_month);
          const cancelledAt = handoff.cancelled_at === null
            ? null
            : new Date(handoff.cancelled_at);
          const performanceAdjustmentUnavailableReason = cancelledAt
            ? "cancelled" as const
            : jamaicaMonth !== currentJamaicaMonth
              ? "closed_month" as const
              : null;
          return {
            id: Number(handoff.id),
            handoffNo: handoff.handoff_no,
            performanceMinor: Number(handoff.performance_minor),
            jamaicaMonth,
            handedOffAt: new Date(handoff.handed_off_at),
            cancelledAt,
            performanceAdjustmentAllowed: performanceAdjustmentUnavailableReason === null,
            performanceAdjustmentUnavailableReason,
          };
        }),
    }));
  }

  async listAuditTrail(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderAuditTrailRecord[]> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const currentRows = await selectCurrentRound(this.database, businessOrderId);
    const current = currentRows[0];
    if (!current) throw new RepairRoundNotFoundError();
    await requireRoundReader(this.database, input.viewerAccountId, current);

    const rows = await this.database.query<{
      id: number;
      occurred_at: Date;
      actor_account_id: number | null;
      actor_display_name: string | null;
      actor_username: string | null;
      event_type: string;
      object_type: string;
      object_id: string;
      reason: string | null;
      before_state: Record<string, unknown> | string | null;
      after_state: Record<string, unknown> | string | null;
    }>(
      `select event.id, event.occurred_at, event.actor_account_id,
              account.display_name as actor_display_name,
              account.normalized_username as actor_username,
              event.event_type, event.object_type, event.object_id,
              event.reason, event.before_state, event.after_state
       from audit_events as event
       left join staff_accounts as account on account.id = event.actor_account_id
       where (event.object_type = 'business_order' and event.object_id = $1::text)
          or event.before_state ->> 'businessOrderId' = $1::text
          or event.after_state ->> 'businessOrderId' = $1::text
       order by event.occurred_at desc, event.id desc`,
      [businessOrderId],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      occurredAt: new Date(row.occurred_at),
      actorAccountId: nullableNumber(row.actor_account_id),
      actorDisplayName: row.actor_display_name,
      actorUsername: row.actor_username,
      eventType: row.event_type,
      objectType: row.object_type,
      objectId: row.object_id,
      reason: row.reason,
      before: normalizeAuditState(row.before_state),
      after: normalizeAuditState(row.after_state),
    }));
  }

  async assignRound(input: {
    businessOrderId: number;
    expectedBusinessOrderVersion: number;
    teamId: number;
    customerConfirmedWithoutPayment: boolean;
    context: BusinessOrderActionContext;
  }): Promise<{ assigned: boolean }> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedBusinessOrderVersion, "Business Order 版本");
    const teamId = positiveId(input.teamId, "维修班组");
    await requirePcWriter(this.database, input.context.actorAccountId);
    if (!input.customerConfirmedWithoutPayment) return { assigned: false };
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const round = await lockCurrentRound(transaction, businessOrderId);
      if (round.voided_at) {
        throw new RepairRoundValidationError("已作废的 Business Order 不能派单");
      }
      if (round.business_order_version !== expectedVersion) {
        throw new RepairRoundValidationError("Business Order 已发生变化，请刷新后再派单");
      }
      if (round.status !== "waiting_assignment") {
        throw new RepairRoundValidationError("当前维修轮次不是待派单状态");
      }
      const teams = await transaction.query<{ id: number }>(
        "select id from repair_teams where id = $1 and is_active = true limit 1",
        [teamId],
      );
      if (!teams[0]) throw new RepairRoundValidationError("维修班组不存在或已停用");

      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "assigned",
        teamId,
        customerConfirmedWithoutPayment: true,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.round_assigned", businessOrderId, {
        roundNo: round.round_no,
        teamId,
        customerConfirmedWithoutPayment: true,
      });
      return { assigned: true };
    });
  }

  async withdrawAssignment(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    context: BusinessOrderActionContext;
  }): Promise<{ withdrawn: true }> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      await requireSuperAdmin(transaction, input.context.actorAccountId);
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      if (round.status === "waiting_assignment" || round.status === "formally_handed_off") {
        throw new RepairRoundValidationError("只有正式交单前已派出的维修轮次可以撤回");
      }
      if (round.assigned_team_id === null) {
        throw new RepairRoundValidationError("当前维修轮次没有可撤回的维修班组");
      }

      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "assignment_withdrawn",
        teamId: round.assigned_team_id,
        note: "超级管理员撤回派单",
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.round_assignment_withdrawn", businessOrderId, {
        roundNo: round.round_no,
        previousTeamId: round.assigned_team_id,
        previousStatus: round.status,
      });
      return { withdrawn: true };
    });
  }

  async acceptRound(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      if (round.status !== "assigned" || round.assigned_team_id === null) {
        throw new RepairRoundValidationError("当前维修轮次不是待接单状态");
      }
      const staff = await requireAssignedMechanic(
        transaction,
        input.context.actorAccountId,
        round.assigned_team_id,
      );
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "accepted",
        teamId: round.assigned_team_id,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.round_accepted", businessOrderId, {
        roundNo: round.round_no,
        teamId: round.assigned_team_id,
        staffMemberId: staff.id,
      });
    });
  }

  async recordAcceptanceOnBehalf(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    actualStaffMemberId: number;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const actualStaffMemberId = positiveId(input.actualStaffMemberId, "实际维修工");
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      if (round.status !== "assigned" || round.assigned_team_id === null) {
        throw new RepairRoundValidationError("当前维修轮次不是待接单状态");
      }
      await requireActiveTeamStaff(transaction, actualStaffMemberId, round.assigned_team_id);
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "accepted",
        teamId: round.assigned_team_id,
        note: `纸质接单，实际维修工 staff:${actualStaffMemberId}`,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.round_paper_acceptance_recorded", businessOrderId, {
        roundNo: round.round_no,
        teamId: round.assigned_team_id,
        actualStaffMemberId,
      });
    });
  }

  async recordIntakeMileage(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    odometerKm: number;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const odometerKm = nonnegativeInteger(input.odometerKm, "接车里程");
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requireInRepair(round);
      await requireIntakeActor(transaction, input.context.actorAccountId, round.assigned_team_id);
      const existing = await transaction.query<{ id: number }>(
        "select id from vehicle_mileage_records where repair_round_id = $1 limit 1",
        [round.id],
      );
      if (existing[0]) throw new RepairRoundValidationError("本轮接车里程已经记录");
      await transaction.query(
        `insert into vehicle_mileage_records
          (vehicle_id, business_order_id, repair_round_id,
           odometer_km, recorded_by, recorded_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [round.vehicle_id, businessOrderId, round.id, odometerKm,
          input.context.actorAccountId, now],
      );
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "intake_mileage_recorded",
        note: `${odometerKm} km`,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.intake_mileage_recorded", businessOrderId, {
        roundNo: round.round_no,
        odometerKm,
      });
    });
  }

  async attachIntakePhoto(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    fileId: number;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const fileId = positiveId(input.fileId, "照片文件");
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requireInRepair(round);
      await requireIntakeActor(transaction, input.context.actorAccountId, round.assigned_team_id);
      const attachments = await transaction.query<{ file_id: number }>(
        `select candidate.file_id
         from (
           select vehicle_attachment.file_id
           from vehicle_attachments as vehicle_attachment
           where vehicle_attachment.vehicle_id = $1
             and vehicle_attachment.file_id = $2
             and vehicle_attachment.kind = 'photo'
           union all
           select business_attachment.file_id
           from business_order_attachments as business_attachment
           join stored_files as file on file.id = business_attachment.file_id
           where business_attachment.business_order_id = $3
             and business_attachment.file_id = $2
             and business_attachment.category = 'service_photo'
             and file.media_type like 'image/%'
         ) as candidate
         limit 1`,
        [round.vehicle_id, fileId, businessOrderId],
      );
      if (!attachments[0]) {
        throw new RepairRoundValidationError("接车照片必须属于当前车辆或 Business Order");
      }
      await transaction.query(
        `insert into repair_round_intake_photos
          (repair_round_id, file_id, linked_by, linked_at)
         values ($1, $2, $3, $4)`,
        [round.id, fileId, input.context.actorAccountId, now],
      );
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "intake_photo_linked",
        note: `file:${fileId}`,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.intake_photo_linked", businessOrderId, {
        roundNo: round.round_no,
        fileId,
      });
    });
  }

  async submitWorkReturn(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    workSummary?: string;
    exceptionSummary?: string;
    itemResults?: WorkReturnItemResult[];
    attachmentIds?: number[];
    actualStaffMemberId?: number;
    context: BusinessOrderActionContext;
  }): Promise<{ id: number; submissionNo: number }> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const workSummary = optionalText(input.workSummary);
    const exceptionSummary = optionalText(input.exceptionSummary);
    const itemResults = validItemResults(input.itemResults);
    const attachmentIds = uniquePositiveIds(input.attachmentIds ?? []);
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requireInRepair(round);
      if (round.assigned_team_id === null) {
        throw new RepairRoundValidationError("本轮尚未分配维修班组");
      }
      const actualStaffMemberId = await requireReturnSubmitter(
        transaction,
        input.context.actorAccountId,
        input.actualStaffMemberId,
        round.assigned_team_id,
      );
      await requireCompleteElectronicIntake(transaction, round.id);
      await requireWorkReturnAttachments(transaction, {
        businessOrderId,
        attachmentIds,
        purpose: "service_photo",
        required: false,
      });
      const inserted = await insertWorkReturn(transaction, {
        round,
        source: "electronic",
        workSummary,
        exceptionSummary,
        itemResults,
        actualStaffMemberId,
        attachmentIds,
        attachmentPurpose: "service_photo",
        submittedBy: input.context.actorAccountId,
        submittedAt: now,
      });
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "work_return_submitted",
        workReturnId: inserted.id,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.work_return_submitted", businessOrderId, {
        roundNo: round.round_no,
        workReturnId: inserted.id,
        submissionNo: inserted.submissionNo,
        submissionSource: "electronic",
        actualStaffMemberId,
        attachmentIds,
      });
      return inserted;
    });
  }

  async recordPaperWorkReturn(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    actualStaffMemberId?: number;
    attachmentIds: number[];
    workSummary?: string;
    exceptionSummary?: string;
    itemResults?: WorkReturnItemResult[];
    context: BusinessOrderActionContext;
  }): Promise<{ id: number; submissionNo: number }> {
    const command = normalizePaperWorkReturn(input);
    return this.database.transaction((transaction) => recordPaperWorkReturnInTransaction(transaction, command));
  }

  async recordPaperWorkReturnAndFormallyHandOff(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    actualStaffMemberId?: number;
    attachmentIds: number[];
    workSummary?: string;
    exceptionSummary?: string;
    itemResults?: WorkReturnItemResult[];
    performanceValue: string;
    context: BusinessOrderActionContext;
  }) {
    const command = normalizePaperWorkReturn(input);
    return this.database.transaction(async (transaction) => {
      await recordPaperWorkReturnInTransaction(transaction, command);
      const versions = await transaction.query<{ version: number }>(
        `select version from repair_rounds
         where business_order_id = $1
         order by round_no desc limit 1`,
        [command.businessOrderId],
      );
      const projectedVersion = Number(versions[0]?.version);
      if (!Number.isSafeInteger(projectedVersion) || projectedVersion < 1) {
        throw new RepairRoundValidationError("维修轮次状态未能更新");
      }
      return formallyHandOffRoundInTransaction(transaction, {
        businessOrderId: command.businessOrderId,
        expectedRepairRoundVersion: projectedVersion,
        performanceValue: input.performanceValue,
        context: { ...input.context, now: command.now },
      });
    });
  }

  async returnWorkReturn(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    workReturnId: number;
    reason: string;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const workReturnId = positiveId(input.workReturnId, "回单");
    const reason = nonempty(input.reason, "退回原因");
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requirePendingReview(round);
      await requireReviewableReturn(transaction, round.id, workReturnId);
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "work_return_rejected",
        workReturnId,
        note: reason,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.work_return_rejected", businessOrderId, {
        roundNo: round.round_no,
        workReturnId,
        reason,
      });
    });
  }

  async approveWorkReturn(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    workReturnId: number;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const workReturnId = positiveId(input.workReturnId, "回单");
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requirePendingReview(round);
      await requireReviewableReturn(transaction, round.id, workReturnId);
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "work_return_approved",
        workReturnId,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.work_return_approved", businessOrderId, {
        roundNo: round.round_no,
        workReturnId,
      });
    });
  }

  async approveAndFormallyHandOff(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    workReturnId: number;
    performanceValue: string;
    context: BusinessOrderActionContext;
  }) {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const workReturnId = positiveId(input.workReturnId, "回单");
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requirePendingReview(round);
      await requireReviewableReturn(transaction, round.id, workReturnId);
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "work_return_approved",
        workReturnId,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.work_return_approved", businessOrderId, {
        roundNo: round.round_no,
        workReturnId,
      });
      const versions = await transaction.query<{ version: number }>(
        `select version from repair_rounds where id = $1`,
        [round.id],
      );
      const projectedVersion = Number(versions[0]?.version);
      if (!Number.isSafeInteger(projectedVersion) || projectedVersion < 1) {
        throw new RepairRoundValidationError("维修轮次状态未能更新");
      }
      return formallyHandOffRoundInTransaction(transaction, {
        businessOrderId,
        expectedRepairRoundVersion: projectedVersion,
        performanceValue: input.performanceValue,
        context: { ...input.context, now },
      });
    });
  }
}

type PaperWorkReturnCommand = {
  businessOrderId: number;
  expectedVersion: number;
  actualStaffMemberId: number | null;
  attachmentIds: number[];
  workSummary: string | null;
  exceptionSummary: string | null;
  itemResults: WorkReturnItemResult[];
  context: BusinessOrderActionContext;
  now: Date;
};

function normalizePaperWorkReturn(input: {
  businessOrderId: number;
  expectedRepairRoundVersion: number;
  actualStaffMemberId?: number;
  attachmentIds: number[];
  workSummary?: string;
  exceptionSummary?: string;
  itemResults?: WorkReturnItemResult[];
  context: BusinessOrderActionContext;
}): PaperWorkReturnCommand {
  const attachmentIds = uniquePositiveIds(input.attachmentIds);
  return {
    businessOrderId: positiveId(input.businessOrderId, "Business Order"),
    expectedVersion: positiveId(input.expectedRepairRoundVersion, "维修轮次版本"),
    actualStaffMemberId: input.actualStaffMemberId === undefined
      ? null
      : positiveId(input.actualStaffMemberId, "实际维修工"),
    attachmentIds,
    workSummary: optionalText(input.workSummary),
    exceptionSummary: optionalText(input.exceptionSummary),
    itemResults: validItemResults(input.itemResults),
    context: input.context,
    now: input.context.now ?? new Date(),
  };
}

async function recordPaperWorkReturnInTransaction(
  transaction: AuthSqlExecutor,
  command: PaperWorkReturnCommand,
) {
  await requirePcWriter(transaction, command.context.actorAccountId);
  const round = await lockCurrentRound(transaction, command.businessOrderId);
  requireRoundVersion(round, command.expectedVersion);
  requireInRepair(round);
  if (round.assigned_team_id === null) {
    throw new RepairRoundValidationError("本轮尚未分配维修班组");
  }
  if (command.actualStaffMemberId !== null) {
    await requireActiveTeamStaff(transaction, command.actualStaffMemberId, round.assigned_team_id);
  }
  await requireWorkReturnAttachments(transaction, {
    businessOrderId: command.businessOrderId,
    attachmentIds: command.attachmentIds,
    purpose: "paper_return",
    required: false,
  });
  const inserted = await insertWorkReturn(transaction, {
    round,
    source: "paper",
    workSummary: command.workSummary,
    exceptionSummary: command.exceptionSummary,
    itemResults: command.itemResults,
    actualStaffMemberId: command.actualStaffMemberId,
    attachmentIds: command.attachmentIds,
    attachmentPurpose: "paper_return",
    submittedBy: command.context.actorAccountId,
    submittedAt: command.now,
  });
  await insertEvent(transaction, {
    repairRoundId: round.id,
    eventType: "work_return_submitted",
    workReturnId: inserted.id,
    note: "前台录入纸质回单",
    actorAccountId: command.context.actorAccountId,
    occurredAt: command.now,
  });
  await insertEvent(transaction, {
    repairRoundId: round.id,
    eventType: "work_return_approved",
    workReturnId: inserted.id,
    note: "纸质回单已由前台现场核对",
    actorAccountId: command.context.actorAccountId,
    occurredAt: command.now,
  });
  await audit(
    transaction,
    command.context,
    command.now,
    "business_order.paper_work_return_recorded_and_approved",
    command.businessOrderId,
    {
      roundNo: round.round_no,
      workReturnId: inserted.id,
      submissionNo: inserted.submissionNo,
      submissionSource: "paper",
      actualStaffMemberId: command.actualStaffMemberId,
      attachmentIds: command.attachmentIds,
    },
  );
  return inserted;
}

type AfterSalesRoundDeletionCountsRow = {
  events: number;
  work_returns: number;
  work_return_attachments: number;
  mileage_records: number;
  intake_photos: number;
  formal_handoffs: number;
  formal_handoff_cancellations: number;
  active_formal_handoffs: number;
  inspection_reports: number;
  problem_description_versions: number;
};

async function loadAfterSalesRoundDeletionPreview(
  executor: AuthSqlExecutor,
  businessOrderId: number,
  current: RepairRoundRow,
): Promise<AfterSalesRoundDeletionPreview> {
  const order = await executor.query<{ order_no: string }>(
    "select order_no from business_orders where id = $1 limit 1",
    [businessOrderId],
  );
  const counts = await executor.query<AfterSalesRoundDeletionCountsRow>(
    `select
       (select count(*)::integer from repair_round_events where repair_round_id = $1) as events,
       (select count(*)::integer from repair_round_work_returns where repair_round_id = $1) as work_returns,
       (select count(*)::integer from repair_round_work_return_attachments as attachment
          join repair_round_work_returns as work_return on work_return.id = attachment.work_return_id
          where work_return.repair_round_id = $1) as work_return_attachments,
       (select count(*)::integer from vehicle_mileage_records where repair_round_id = $1) as mileage_records,
       (select count(*)::integer from repair_round_intake_photos where repair_round_id = $1) as intake_photos,
       (select count(*)::integer from formal_handoffs where repair_round_id = $1) as formal_handoffs,
       (select count(*)::integer from formal_handoff_cancellations as cancellation
          join formal_handoffs as handoff on handoff.id = cancellation.formal_handoff_id
          where handoff.repair_round_id = $1) as formal_handoff_cancellations,
       (select count(*)::integer from formal_handoffs as handoff
          where handoff.repair_round_id = $1
            and not exists (select 1 from formal_handoff_cancellations as cancellation
                            where cancellation.formal_handoff_id = handoff.id)) as active_formal_handoffs,
       (select count(*)::integer from inspection_reports where source_repair_round_id = $1) as inspection_reports,
       (select count(*)::integer from repair_round_problem_versions where repair_round_id = $1) as problem_description_versions`,
    [current.id],
  );
  const previous = await executor.query<{
    id: number;
    status: RepairRoundStatus;
    has_active_handoff: boolean;
  }>(
    `select previous.id, previous.status,
       exists(
         select 1 from formal_handoffs as handoff
         where handoff.repair_round_id = previous.id
           and not exists (select 1 from formal_handoff_cancellations as cancellation
                           where cancellation.formal_handoff_id = handoff.id)
       ) as has_active_handoff
     from repair_rounds as previous
     where previous.business_order_id = $1 and previous.round_no = $2
     limit 1`,
    [businessOrderId, current.round_no - 1],
  );
  const count = counts[0];
  if (!order[0] || !count) throw new RepairRoundNotFoundError();
  const [inspectionRecords, activeHandoffRecords, documentSnapshotRecords] = await Promise.all([
    executor.query<{ report_no: string }>(
      `select report_no from inspection_reports
       where source_repair_round_id = $1 order by id`,
      [current.id],
    ),
    executor.query<{ handoff_no: number }>(
      `select handoff.handoff_no
       from formal_handoffs as handoff
       where handoff.repair_round_id = $1
         and not exists (
           select 1 from formal_handoff_cancellations as cancellation
           where cancellation.formal_handoff_id = handoff.id
         )
       order by handoff.handoff_no, handoff.id`,
      [current.id],
    ),
    listRepairRoundDocumentSnapshots(executor, current.id),
  ]);
  const normalizedCounts: AfterSalesRoundDeletionPreview["counts"] = {
    events: Number(count.events),
    workReturns: Number(count.work_returns),
    workReturnAttachments: Number(count.work_return_attachments),
    mileageRecords: Number(count.mileage_records),
    intakePhotos: Number(count.intake_photos),
    formalHandoffs: Number(count.formal_handoffs),
    formalHandoffCancellations: Number(count.formal_handoff_cancellations),
    inspectionReports: Number(count.inspection_reports),
    documentSnapshots: documentSnapshotRecords.length,
    problemVersions: Number(count.problem_description_versions),
  };
  const recordNo = `${order[0].order_no}/R${current.round_no}`;
  const blockers: AfterSalesRoundDeletionBlocker[] = [];
  if (current.voided_at) {
    blockers.push({
      code: "BUSINESS_ORDER_VOIDED",
      label: "Business Order 已作废，不能从作废记录中单独删除维修轮次",
    });
  }
  if (previous[0]?.status !== "formally_handed_off") {
    blockers.push({
      code: "PREVIOUS_ROUND_NOT_FORMALLY_HANDED_OFF",
      label: "上一轮不是正式交单状态，无法安全恢复到上一轮",
    });
  } else if (!previous[0].has_active_handoff) {
    blockers.push({
      code: "PREVIOUS_ROUND_HAS_NO_ACTIVE_HANDOFF",
      label: "上一轮没有仍然有效的正式交单，无法安全恢复到上一轮",
    });
  }
  if (Number(count.active_formal_handoffs) > 0) {
    blockers.push({
      code: "ACTIVE_FORMAL_HANDOFF_EXISTS",
      label: "本轮仍有有效正式交单；请先取消正式交单，再删除本轮",
      recordNos: activeHandoffRecords.map((handoff) => `${recordNo}/H${handoff.handoff_no}`),
    });
  }
  if (normalizedCounts.inspectionReports > 0) {
    blockers.push({
      code: "INSPECTION_REPORTS_EXIST",
      label: "本轮仍有关联检查报告；请先在检查结果中处理或删除这些报告",
      recordNos: inspectionRecords.map((record) => record.report_no),
    });
  }
  if (normalizedCounts.documentSnapshots > 0) {
    blockers.push({
      code: "DOCUMENT_SNAPSHOTS_EXIST",
      label: "本轮已经生成不可篡改的正式单据，不能直接删除；请保留本轮并通过更正记录处理",
      recordNos: documentSnapshotRecords,
    });
  }
  const previewFingerprint = afterSalesRoundDeletionPreviewFingerprint({
    recordNo,
    repairRoundId: current.id,
    repairRoundVersion: current.version,
    performanceDraftMinor: nullableNumber(current.performance_draft_minor),
    status: current.status,
    assignedTeamId: nullableNumber(current.assigned_team_id),
    voided: Boolean(current.voided_at),
    previousRoundId: previous[0]?.id ?? null,
    previousRoundStatus: previous[0]?.status ?? null,
    previousRoundHasActiveHandoff: previous[0]?.has_active_handoff ?? false,
    activeFormalHandoffs: Number(count.active_formal_handoffs),
    counts: normalizedCounts,
    blockers,
  });
  return {
    eligible: blockers.length === 0,
    recordNo,
    repairRoundId: Number(current.id),
    roundNo: current.round_no,
    repairRoundVersion: current.version,
    performanceDraftMinor: nullableNumber(current.performance_draft_minor),
    counts: normalizedCounts,
    blockers,
    previewFingerprint,
  };
}

async function listRepairRoundDocumentSnapshots(
  executor: AuthSqlExecutor,
  repairRoundId: number,
): Promise<string[]> {
  const table = await executor.query<{ table_name: string | null }>(
    "select to_regclass('public.business_order_document_snapshots')::text as table_name",
  );
  if (!table[0]?.table_name) return [];
  const records = await executor.query<{ document_no: string }>(
    `select document_no from business_order_document_snapshots
     where repair_round_id = $1 order by id`,
    [repairRoundId],
  );
  return records.map((record) => record.document_no);
}

function requireEmptyAfterSalesRound(
  preview: AfterSalesRoundDeletionPreview,
  current: RepairRoundRow,
) {
  if (current.status !== "waiting_assignment" || current.assigned_team_id !== null) {
    throw new RepairRoundValidationError("只有尚未派单且没有业务记录的售后维修轮次可以直接删除");
  }
  const factCount = preview.counts.events
    + preview.counts.workReturns
    + preview.counts.workReturnAttachments
    + preview.counts.mileageRecords
    + preview.counts.intakePhotos
    + preview.counts.formalHandoffs
    + preview.counts.inspectionReports
    + preview.counts.documentSnapshots
    + preview.counts.problemVersions;
  if (factCount > 0) {
    throw new RepairRoundValidationError("本轮已经产生业务记录，请使用删除预览处理关联记录");
  }
  if (preview.blockers.some((blocker) => blocker.code === "PREVIOUS_ROUND_NOT_FORMALLY_HANDED_OFF")) {
    throw new RepairRoundValidationError("上一轮不是有效交单状态，不能撤销当前轮次");
  }
  if (preview.blockers.some((blocker) => blocker.code === "PREVIOUS_ROUND_HAS_NO_ACTIVE_HANDOFF")) {
    throw new RepairRoundValidationError("上一轮没有有效正式交单，不能撤销当前轮次");
  }
  if (!preview.eligible) {
    throw new RepairRoundValidationError("当前售后轮次不满足受控删除条件");
  }
}

async function authorizeAfterSalesRoundDeletionRows(
  executor: AuthSqlExecutor,
  requestId: string,
  repairRoundId: number,
) {
  const authorize = (tableName: string, rowKey: string) => executor.query(
    `insert into record_deletion_authorized_rows (request_id, table_name, row_key)
     select $1, $2, candidate.row_key
     from (${rowKey}) as candidate(row_key)
     on conflict do nothing`,
    [requestId, tableName, repairRoundId],
  );
  await authorize("repair_round_events", "select id::text as row_key from repair_round_events where repair_round_id = $3");
  await authorize("formal_handoff_cancellations", `select cancellation.id::text as row_key
    from formal_handoff_cancellations as cancellation
    join formal_handoffs as handoff on handoff.id = cancellation.formal_handoff_id
    where handoff.repair_round_id = $3`);
  await authorize("formal_handoffs", "select id::text as row_key from formal_handoffs where repair_round_id = $3");
  await authorize("repair_round_intake_photos", `select repair_round_id::text || ':' || file_id::text as row_key
    from repair_round_intake_photos where repair_round_id = $3`);
  await authorize("vehicle_mileage_records", "select id::text as row_key from vehicle_mileage_records where repair_round_id = $3");
  await authorize("repair_round_work_returns", "select id::text as row_key from repair_round_work_returns where repair_round_id = $3");
  await authorize("repair_round_problem_versions", "select id::text as row_key from repair_round_problem_versions where repair_round_id = $3");
  await authorize("repair_rounds", "select id::text as row_key from repair_rounds where id = $3");
}

async function deleteAfterSalesRoundFacts(
  executor: AuthSqlExecutor,
  repairRoundId: number,
  expectedVersion: number,
) {
  await executor.query(
    `delete from repair_round_work_return_attachments
     where work_return_id in (select id from repair_round_work_returns where repair_round_id = $1)`,
    [repairRoundId],
  );
  await executor.query("delete from repair_round_events where repair_round_id = $1", [repairRoundId]);
  await executor.query(
    `delete from formal_handoff_cancellations where formal_handoff_id in
       (select id from formal_handoffs where repair_round_id = $1)`,
    [repairRoundId],
  );
  await executor.query("delete from formal_handoffs where repair_round_id = $1", [repairRoundId]);
  await executor.query("delete from repair_round_intake_photos where repair_round_id = $1", [repairRoundId]);
  await executor.query("delete from vehicle_mileage_records where repair_round_id = $1", [repairRoundId]);
  await executor.query("delete from repair_round_work_returns where repair_round_id = $1", [repairRoundId]);
  await executor.query("delete from repair_round_problem_versions where repair_round_id = $1", [repairRoundId]);
  const deleted = await executor.query<{ id: number }>(
    "delete from repair_rounds where id = $1 and version = $2 returning id",
    [repairRoundId, expectedVersion],
  );
  if (!deleted[0]) {
    throw new RepairRoundValidationError("维修轮次已被其他操作修改，请刷新后重试");
  }
}

function afterSalesRoundDeletionPreviewFingerprint(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function afterSalesRoundDeletionPayloadHash(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseAfterSalesRoundDeletionResult(
  value: DeleteInvalidAfterSalesRoundResult | string,
): DeleteInvalidAfterSalesRoundResult {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed?.cancelled !== true
      || !Number.isSafeInteger(parsed.deletedRoundNo)
      || !Number.isSafeInteger(parsed.restoredRoundNo)) {
    throw new RepairRoundValidationError("删除回执数据无效");
  }
  return parsed;
}

async function selectCurrentRound(executor: AuthSqlExecutor, businessOrderId: number) {
  return executor.query<RepairRoundRow>(
    `select repair_round.id, repair_round.business_order_id,
            repair_round.round_no, repair_round.source,
            repair_round.after_sales_issue, repair_round.performance_draft_minor,
            repair_round.status,
            repair_round.assigned_team_id, repair_round.version,
            repair_round.created_at, repair_round.created_by,
            repair_round.updated_at,
            business_order.vehicle_id,
            business_order.version as business_order_version,
            business_order.voided_at
     from business_orders as business_order
     join repair_rounds as repair_round
       on repair_round.business_order_id = business_order.id
      and repair_round.round_no = business_order.current_repair_round_no
     where business_order.id = $1 limit 1`,
    [businessOrderId],
  );
}

async function lockCurrentRound(executor: AuthSqlExecutor, businessOrderId: number) {
  const rows = await executor.query<RepairRoundRow>(
    `select repair_round.id, repair_round.business_order_id,
            repair_round.round_no, repair_round.source,
            repair_round.after_sales_issue, repair_round.performance_draft_minor,
            repair_round.status,
            repair_round.assigned_team_id, repair_round.version,
            repair_round.created_at, repair_round.created_by,
            repair_round.updated_at,
            business_order.vehicle_id,
            business_order.version as business_order_version,
            business_order.voided_at
     from business_orders as business_order
     join repair_rounds as repair_round
       on repair_round.business_order_id = business_order.id
      and repair_round.round_no = business_order.current_repair_round_no
     where business_order.id = $1 for update`,
    [businessOrderId],
  );
  if (!rows[0]) throw new RepairRoundNotFoundError();
  return rows[0];
}

async function requirePcWriter(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ id: number }>(
    `select id from staff_accounts where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new RepairRoundWriteDeniedError();
}

async function requireMechanicIdentity(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ staff_member_id: number; current_team_id: number | null }>(
    `select member.id as staff_member_id, member.current_team_id
     from staff_accounts as account
     join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true
       and account.role = 'mechanic' limit 1`,
    [accountId],
  );
  const actor = rows[0];
  if (!actor?.current_team_id) throw new RepairRoundReadDeniedError();
  return {
    staffMemberId: Number(actor.staff_member_id),
    teamId: Number(actor.current_team_id),
  };
}

async function requireRoundReader(
  executor: AuthSqlExecutor,
  accountId: number,
  round: RepairRoundRow,
) {
  const rows = await executor.query<{ role: string; current_team_id: number | null }>(
    `select account.role, member.current_team_id
     from staff_accounts as account
     left join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true limit 1`,
    [accountId],
  );
  const actor = rows[0];
  if (!actor) throw new RepairRoundReadDeniedError();
  if (["super_admin", "front_desk", "owner"].includes(actor.role)) return;
  if (
    actor.role === "mechanic" &&
    round.assigned_team_id !== null &&
    Number(actor.current_team_id) === Number(round.assigned_team_id)
  ) return;
  throw new RepairRoundReadDeniedError();
}

async function requireAssignedMechanic(
  executor: AuthSqlExecutor,
  accountId: number,
  teamId: number,
) {
  const rows = await executor.query<{ id: number }>(
    `select member.id
     from staff_accounts as account
     join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true
       and account.role = 'mechanic' and member.current_team_id = $2
     limit 1`,
    [accountId, teamId],
  );
  if (!rows[0]) throw new RepairRoundValidationError("只有本维修班组成员可以接单");
  return { id: Number(rows[0].id) };
}

async function requireIntakeActor(
  executor: AuthSqlExecutor,
  accountId: number,
  teamId: number | null,
) {
  const rows = await executor.query<{ role: string; current_team_id: number | null }>(
    `select account.role, member.current_team_id
     from staff_accounts as account
     left join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true limit 1`,
    [accountId],
  );
  const actor = rows[0];
  if (actor?.role === "super_admin") return;
  if (
    actor?.role === "mechanic" && teamId !== null &&
    Number(actor.current_team_id) === Number(teamId)
  ) return;
  throw new RepairRoundWriteDeniedError();
}

async function requireReturnSubmitter(
  executor: AuthSqlExecutor,
  accountId: number,
  actualStaffMemberId: number | undefined,
  teamId: number,
): Promise<number | null> {
  const actors = await executor.query<{
    role: string;
    staff_member_id: number | null;
    current_team_id: number | null;
  }>(
    `select account.role, member.id as staff_member_id, member.current_team_id
     from staff_accounts as account
     left join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true limit 1`,
    [accountId],
  );
  const actor = actors[0];
  if (!actor || !["super_admin", "front_desk", "mechanic"].includes(actor.role)) {
    throw new RepairRoundWriteDeniedError();
  }
  if (actor.role === "mechanic") {
    if (!actor.staff_member_id || Number(actor.current_team_id) !== Number(teamId)) {
      throw new RepairRoundValidationError("只有本维修班组成员可以提交回单");
    }
    if (actualStaffMemberId !== undefined && Number(actor.staff_member_id) !== actualStaffMemberId) {
      throw new RepairRoundValidationError("维修工只能提交自己的回单");
    }
    return Number(actor.staff_member_id);
  }
  if (actualStaffMemberId === undefined) return null;
  const staff = await executor.query<{ id: number }>(
    `select id from staff_members
     where id = $1 and status = 'active' and current_team_id = $2 limit 1`,
    [actualStaffMemberId, teamId],
  );
  if (!staff[0]) throw new RepairRoundValidationError("实际维修工不属于本维修班组");
  return Number(staff[0].id);
}

async function requireActiveTeamStaff(
  executor: AuthSqlExecutor,
  staffMemberId: number,
  teamId: number,
) {
  const rows = await executor.query<{ id: number }>(
    `select id from staff_members
     where id = $1 and status = 'active' and current_team_id = $2 limit 1`,
    [staffMemberId, teamId],
  );
  if (!rows[0]) throw new RepairRoundValidationError("实际维修工不属于本维修班组");
}

async function requireReviewableReturn(
  executor: AuthSqlExecutor,
  repairRoundId: number,
  workReturnId: number,
) {
  const rows = await executor.query<{ id: number }>(
    `select work_return.id
     from repair_round_work_returns as work_return
     where work_return.id = $1 and work_return.repair_round_id = $2
       and work_return.submission_no = (
         select max(submission_no) from repair_round_work_returns
         where repair_round_id = $2
       )
       and not exists (
         select 1 from repair_round_events as event
         where event.repair_round_id = $2
           and event.work_return_id = work_return.id
           and event.event_type in ('work_return_rejected', 'work_return_approved')
       )
     limit 1`,
    [workReturnId, repairRoundId],
  );
  if (!rows[0]) throw new RepairRoundValidationError("当前回单已经处理或不是最新回单");
}

async function requireCompleteElectronicIntake(
  executor: AuthSqlExecutor,
  repairRoundId: number,
) {
  const rows = await executor.query<{ has_mileage: boolean; has_photo: boolean }>(
    `select
       exists(select 1 from vehicle_mileage_records where repair_round_id = $1) as has_mileage,
       exists(select 1 from repair_round_intake_photos where repair_round_id = $1) as has_photo`,
    [repairRoundId],
  );
  if (!rows[0]?.has_mileage || !rows[0]?.has_photo) {
    throw new RepairRoundValidationError("电子回单提交前必须完成接车里程和里程照片");
  }
}

async function requireWorkReturnAttachments(
  executor: AuthSqlExecutor,
  input: {
    businessOrderId: number;
    attachmentIds: number[];
    purpose: WorkReturnAttachmentPurpose;
    required: boolean;
  },
) {
  if (input.attachmentIds.length === 0) {
    if (input.required) throw new RepairRoundValidationError("纸质回单必须上传清晰照片或 PDF");
    return;
  }
  const rows = await executor.query<{ id: number; media_type: string }>(
    `select attachment.id, file.media_type
     from business_order_attachments as attachment
     join stored_files as file on file.id = attachment.file_id
     where attachment.business_order_id = $1
       and attachment.id = any($2::bigint[])
     for share`,
    [input.businessOrderId, input.attachmentIds],
  );
  if (rows.length !== input.attachmentIds.length) {
    throw new RepairRoundValidationError("部分回单附件不属于当前 Business Order");
  }
  const invalid = rows.some((row) => {
    if (input.purpose === "service_photo") return !row.media_type.startsWith("image/");
    return !row.media_type.startsWith("image/") && row.media_type !== "application/pdf";
  });
  if (invalid) throw new RepairRoundValidationError("回单附件只支持图片或 PDF");
}

async function insertWorkReturn(
  executor: AuthSqlExecutor,
  input: {
    round: RepairRoundRow;
    source: WorkReturnSource;
    workSummary: string | null;
    exceptionSummary: string | null;
    itemResults: WorkReturnItemResult[];
    actualStaffMemberId: number | null;
    attachmentIds: number[];
    attachmentPurpose: WorkReturnAttachmentPurpose;
    submittedBy: number;
    submittedAt: Date;
  },
) {
  const counts = await executor.query<{ current_number: number }>(
    `select coalesce(max(submission_no), 0)::integer as current_number
     from repair_round_work_returns where repair_round_id = $1`,
    [input.round.id],
  );
  const submissionNo = Number(counts[0]?.current_number ?? 0) + 1;
  const workReturns = await executor.query<{ id: number }>(
    `insert into repair_round_work_returns
      (repair_round_id, submission_no, submission_source, work_summary,
       exception_summary, item_results, actual_staff_member_id,
       submitted_by, submitted_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     returning id`,
    [input.round.id, submissionNo, input.source, input.workSummary,
      input.exceptionSummary, JSON.stringify(input.itemResults), input.actualStaffMemberId,
      input.submittedBy, input.submittedAt],
  );
  const workReturnId = Number(workReturns[0].id);
  if (input.attachmentIds.length > 0) {
    await executor.query(
      `insert into repair_round_work_return_attachments
        (work_return_id, attachment_id, purpose)
       select $1, attachment_id, $3
       from unnest($2::bigint[]) as attachment_id`,
      [workReturnId, input.attachmentIds, input.attachmentPurpose],
    );
  }
  return { id: workReturnId, submissionNo };
}

async function insertEvent(
  executor: AuthSqlExecutor,
  input: {
    repairRoundId: number;
    eventType:
      | "assigned"
      | "assignment_withdrawn"
      | "accepted"
      | "intake_mileage_recorded"
      | "intake_photo_linked"
      | "work_return_submitted"
      | "work_return_rejected"
      | "work_return_approved";
    teamId?: number;
    workReturnId?: number;
    customerConfirmedWithoutPayment?: boolean;
    note?: string;
    actorAccountId: number;
    occurredAt: Date;
  },
) {
  await executor.query(
    `insert into repair_round_events
      (repair_round_id, event_type, team_id, work_return_id,
       customer_confirmed_without_payment, note,
       actor_account_id, occurred_at)
     values ($1, $2::repair_round_event_type, $3, $4, $5, $6, $7, $8)`,
    [input.repairRoundId, input.eventType, input.teamId ?? null,
      input.workReturnId ?? null, input.customerConfirmedWithoutPayment ?? null,
      input.note ?? null, input.actorAccountId, input.occurredAt],
  );
}

async function requireSuperAdmin(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ id: number }>(
    "select id from staff_accounts where id = $1 and is_active = true and role = 'super_admin' limit 1",
    [accountId],
  );
  if (!rows[0]) throw new RepairRoundWriteDeniedError();
}

async function audit(
  executor: AuthSqlExecutor,
  context: BusinessOrderActionContext,
  occurredAt: Date,
  eventType: string,
  businessOrderId: number,
  after: Record<string, unknown>,
) {
  await writeAuditEvent(executor, {
    occurredAt,
    actorAccountId: context.actorAccountId,
    eventType,
    objectType: "business_order",
    objectId: String(businessOrderId),
    after,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

function requireInRepair(round: RepairRoundRow) {
  if (round.status !== "in_repair") {
    throw new RepairRoundValidationError("只有接单后的维修轮次可以记录接车资料或提交回单");
  }
}

function requirePendingReview(round: RepairRoundRow) {
  if (round.status !== "return_pending_review") {
    throw new RepairRoundValidationError("当前维修轮次没有待审核回单");
  }
}

function requireRoundVersion(round: RepairRoundRow, expectedVersion: number) {
  if (round.version !== expectedVersion) {
    throw new RepairRoundValidationError("维修轮次已被其他操作修改，请刷新后重试");
  }
}

function positiveId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RepairRoundValidationError(`${label}无效`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RepairRoundValidationError(`${label}必须是非负整数`);
  }
  return value;
}

function nonempty(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new RepairRoundValidationError(`${label}不能为空`);
  return normalized;
}

function validAfterSalesRoundDeletionReasonCode(value: string) {
  if (!["duplicate", "input_error", "test_data", "other"].includes(value)) {
    throw new RepairRoundValidationError("删除原因代码无效");
  }
  return value as "duplicate" | "input_error" | "test_data" | "other";
}

function parseSignedMoney(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!/^-?(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new RepairRoundValidationError(`${label}格式不正确，最多保留两位小数`);
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw new RepairRoundValidationError(`${label}超出可处理范围`);
  }
  return negative ? -minor : minor;
}

function optionalText(value: string | undefined) {
  const normalized = value?.normalize("NFKC").trim();
  return normalized || null;
}

function uniquePositiveIds(values: number[]) {
  if (!Array.isArray(values)) throw new RepairRoundValidationError("附件列表无效");
  const normalized = [...new Set(values.map((value) => positiveId(value, "附件")))];
  if (normalized.length !== values.length) throw new RepairRoundValidationError("附件不能重复");
  return normalized;
}

function validItemResults(value: WorkReturnItemResult[] | undefined): WorkReturnItemResult[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) {
    throw new RepairRoundValidationError("施工项目结果无效");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new RepairRoundValidationError("施工项目结果无效");
    }
    const chargeItemId = nonempty(String(item.chargeItemId ?? ""), "收费项目");
    if (!(["labor", "part", "other"] as const).includes(item.category)) {
      throw new RepairRoundValidationError("收费项目分类无效");
    }
    if (!(["completed", "not_completed"] as const).includes(item.result)) {
      throw new RepairRoundValidationError("施工结果无效");
    }
    return {
      chargeItemId,
      category: item.category,
      labelZh: nonempty(String(item.labelZh ?? ""), "收费项目名称"),
      labelEn: optionalText(item.labelEn ?? undefined),
      result: item.result,
      note: optionalText(item.note ?? undefined),
    };
  });
}

function normalizeItemResults(value: WorkReturnItemResult[] | string): WorkReturnItemResult[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as WorkReturnItemResult[] : [];
  } catch {
    return [];
  }
}

function nullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

function normalizeMonth(value: string | Date) {
  return typeof value === "string"
    ? value.slice(0, 7)
    : value.toISOString().slice(0, 7);
}

function normalizeAuditState(
  value: Record<string, unknown> | string | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function mapMechanicWorkOrderSummary(row: {
  business_order_id: number;
  order_no: string;
  status: RepairRoundStatus;
  vehicle_plate_snapshot: string;
  vehicle_description_snapshot: string;
  vehicle_vin_snapshot: string | null;
  repair_round_id: number;
  round_no: number;
  assigned_team_id: number;
  assigned_team_name: string;
  repair_round_version: number;
  latest_rejection_reason: string | null;
}): MechanicWorkOrderSummary {
  return {
    businessOrderId: Number(row.business_order_id),
    orderNo: row.order_no,
    status: row.status,
    vehicle: {
      plate: row.vehicle_plate_snapshot,
      description: row.vehicle_description_snapshot,
      vin: row.vehicle_vin_snapshot,
    },
    repairRound: {
      id: Number(row.repair_round_id),
      roundNo: row.round_no,
      assignedTeamId: Number(row.assigned_team_id),
      assignedTeamName: row.assigned_team_name,
      version: row.repair_round_version,
    },
    latestRejectionReason: row.latest_rejection_reason,
  };
}
