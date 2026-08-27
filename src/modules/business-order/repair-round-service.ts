import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";

type RepairRoundStatus =
  | "waiting_assignment"
  | "assigned"
  | "in_repair"
  | "return_pending_review"
  | "formally_handed_off";

type RepairRoundSource = "initial" | "after_sales";

type RepairRoundRow = {
  id: number;
  business_order_id: number;
  round_no: number;
  source: RepairRoundSource;
  after_sales_issue: string | null;
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
  status: RepairRoundStatus;
  assignedTeamId: number | null;
  intakeMileageKm: number | null;
  intakePhotoFileIds: number[];
  latestWorkReturnId: number | null;
  approvedWorkReturnId: number | null;
  version: number;
};

export type RepairRoundHistoryRecord = {
  id: number;
  businessOrderId: number;
  roundNo: number;
  source: RepairRoundSource;
  afterSalesIssue: string | null;
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
    const workReturns = await this.database.query<{ id: number }>(
      `select id from repair_round_work_returns
       where repair_round_id = $1 order by submission_no desc limit 1`,
      [round.id],
    );
    const approvals = await this.database.query<{ work_return_id: number }>(
      `select work_return_id from repair_round_events
       where repair_round_id = $1 and event_type = 'work_return_approved'
       order by occurred_at desc, id desc limit 1`,
      [round.id],
    );
    return {
      id: Number(round.id),
      businessOrderId: Number(round.business_order_id),
      roundNo: round.round_no,
      source: round.source,
      afterSalesIssue: round.after_sales_issue,
      status: round.status,
      assignedTeamId: nullableNumber(round.assigned_team_id),
      intakeMileageKm: mileage[0] ? Number(mileage[0].odometer_km) : null,
      intakePhotoFileIds: photos.map((photo) => Number(photo.file_id)),
      latestWorkReturnId: workReturns[0] ? Number(workReturns[0].id) : null,
      approvedWorkReturnId: approvals[0]
        ? Number(approvals[0].work_return_id)
        : null,
      version: round.version,
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
           assigned_team_id, created_at, created_by, updated_at, version)
         values ($1, $2, 'after_sales', $3, 'waiting_assignment',
                 null, $4, $5, $4, 1)`,
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
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      await requirePcWriter(transaction, input.context.actorAccountId);
      const current = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(current, expectedVersion);
      if (
        current.source !== "after_sales" ||
        current.round_no <= 1 ||
        current.status !== "waiting_assignment" ||
        current.assigned_team_id !== null
      ) {
        throw new RepairRoundValidationError("只有误建且尚未派单的售后维修轮次可以撤销");
      }

      const facts = await transaction.query<{ fact_count: number }>(
        `select (
           (select count(*) from repair_round_events where repair_round_id = $1) +
           (select count(*) from repair_round_work_returns where repair_round_id = $1) +
           (select count(*) from vehicle_mileage_records where repair_round_id = $1) +
           (select count(*) from repair_round_intake_photos where repair_round_id = $1) +
           (select count(*) from formal_handoffs where repair_round_id = $1) +
           (select count(*) from inspection_reports where source_repair_round_id = $1)
         )::integer as fact_count`,
        [current.id],
      );
      if (Number(facts[0]?.fact_count ?? 0) > 0) {
        throw new RepairRoundValidationError("本轮已经产生实际记录，不能作为误触轮次删除");
      }

      const previousRoundNo = current.round_no - 1;
      const previous = await transaction.query<{ id: number; status: RepairRoundStatus }>(
        `select id, status from repair_rounds
         where business_order_id = $1 and round_no = $2
         limit 1 for update`,
        [businessOrderId, previousRoundNo],
      );
      if (previous[0]?.status !== "formally_handed_off") {
        throw new RepairRoundValidationError("上一轮不是有效交单状态，不能撤销当前轮次");
      }
      const activeHandoff = await transaction.query<{ id: number }>(
        `select handoff.id
         from formal_handoffs as handoff
         left join formal_handoff_cancellations as cancellation
           on cancellation.formal_handoff_id = handoff.id
         where handoff.repair_round_id = $1 and cancellation.id is null
         limit 1`,
        [previous[0].id],
      );
      if (!activeHandoff[0]) {
        throw new RepairRoundValidationError("上一轮没有有效正式交单，不能撤销当前轮次");
      }

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
        [businessOrderId, previousRoundNo, now, current.business_order_version, current.round_no],
      );
      if (!updated[0]) {
        throw new RepairRoundValidationError("Business Order 已发生变化，请刷新后重试");
      }
      const deleted = await transaction.query<{ id: number }>(
        `delete from repair_rounds
         where id = $1 and version = $2
         returning id`,
        [current.id, expectedVersion],
      );
      if (!deleted[0]) {
        throw new RepairRoundValidationError("维修轮次已发生变化，请刷新后重试");
      }
      await audit(
        transaction,
        input.context,
        now,
        "business_order.after_sales_round_cancelled",
        businessOrderId,
        {
          cancelledRoundNo: current.round_no,
          previousRoundNo,
          issue: current.after_sales_issue,
        },
      );
      return { cancelled: true };
    });
  }

  async listRepairRounds(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<RepairRoundHistoryRecord[]> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const currentRows = await selectCurrentRound(this.database, businessOrderId);
    const current = currentRows[0];
    if (!current) throw new RepairRoundNotFoundError();
    await requireRoundReader(this.database, input.viewerAccountId, current);

    const rounds = await this.database.query<RepairRoundRow>(
      `select repair_round.id, repair_round.business_order_id,
              repair_round.round_no, repair_round.source,
              repair_round.after_sales_issue, repair_round.status,
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

    return rounds.map((round) => ({
      id: Number(round.id),
      businessOrderId: Number(round.business_order_id),
      roundNo: round.round_no,
      source: round.source,
      afterSalesIssue: round.after_sales_issue,
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
        .map((handoff) => ({
          id: Number(handoff.id),
          handoffNo: handoff.handoff_no,
          performanceMinor: Number(handoff.performance_minor),
          jamaicaMonth: normalizeMonth(handoff.jamaica_month),
          handedOffAt: new Date(handoff.handed_off_at),
          cancelledAt: handoff.cancelled_at === null
            ? null
            : new Date(handoff.cancelled_at),
        })),
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
        `select file_id from vehicle_attachments
         where vehicle_id = $1 and file_id = $2 and kind = 'photo' limit 1`,
        [round.vehicle_id, fileId],
      );
      if (!attachments[0]) {
        throw new RepairRoundValidationError("接车照片必须先归档到当前车辆档案");
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
    actualStaffMemberId?: number;
    context: BusinessOrderActionContext;
  }): Promise<{ id: number; submissionNo: number }> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const workSummary = input.workSummary?.trim() || null;
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
      const counts = await transaction.query<{ current_number: number }>(
        `select coalesce(max(submission_no), 0)::integer as current_number
         from repair_round_work_returns where repair_round_id = $1`,
        [round.id],
      );
      const submissionNo = Number(counts[0]?.current_number ?? 0) + 1;
      const workReturns = await transaction.query<{ id: number }>(
        `insert into repair_round_work_returns
          (repair_round_id, submission_no, work_summary,
           actual_staff_member_id, submitted_by, submitted_at)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [round.id, submissionNo, workSummary, actualStaffMemberId,
          input.context.actorAccountId, now],
      );
      const workReturnId = Number(workReturns[0].id);
      await insertEvent(transaction, {
        repairRoundId: round.id,
        eventType: "work_return_submitted",
        workReturnId,
        actorAccountId: input.context.actorAccountId,
        occurredAt: now,
      });
      await audit(transaction, input.context, now, "business_order.work_return_submitted", businessOrderId, {
        roundNo: round.round_no,
        workReturnId,
        submissionNo,
        actualStaffMemberId,
      });
      return { id: workReturnId, submissionNo };
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
}

async function selectCurrentRound(executor: AuthSqlExecutor, businessOrderId: number) {
  return executor.query<RepairRoundRow>(
    `select repair_round.id, repair_round.business_order_id,
            repair_round.round_no, repair_round.source,
            repair_round.after_sales_issue, repair_round.status,
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
            repair_round.after_sales_issue, repair_round.status,
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
