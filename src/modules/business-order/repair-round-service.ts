import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import { writeAuditEvent } from "@/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";

type RepairRoundStatus =
  | "waiting_assignment"
  | "assigned"
  | "in_repair"
  | "return_pending_review"
  | "formally_handed_off";

type RepairRoundRow = {
  id: number;
  business_order_id: number;
  round_no: number;
  status: RepairRoundStatus;
  assigned_team_id: number | null;
  vehicle_id: number;
  business_order_version: number;
  voided_at: Date | null;
  version: number;
};

export type CurrentRepairRound = {
  id: number;
  businessOrderId: number;
  roundNo: number;
  status: RepairRoundStatus;
  assignedTeamId: number | null;
  intakeMileageKm: number | null;
  intakePhotoFileIds: number[];
  latestWorkReturnId: number | null;
  approvedWorkReturnId: number | null;
  version: number;
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
    workSummary: string;
    actualStaffMemberId: number;
    context: BusinessOrderActionContext;
  }): Promise<{ id: number; submissionNo: number }> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const expectedVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const workSummary = nonempty(input.workSummary, "回单工作内容");
    const actualStaffMemberId = positiveId(input.actualStaffMemberId, "实际维修工");
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const round = await lockCurrentRound(transaction, businessOrderId);
      requireRoundVersion(round, expectedVersion);
      requireInRepair(round);
      if (round.assigned_team_id === null) {
        throw new RepairRoundValidationError("本轮尚未分配维修班组");
      }
      await requireReturnSubmitter(
        transaction,
        input.context.actorAccountId,
        actualStaffMemberId,
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
            repair_round.round_no, repair_round.status,
            repair_round.assigned_team_id, repair_round.version,
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
            repair_round.round_no, repair_round.status,
            repair_round.assigned_team_id, repair_round.version,
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
  actualStaffMemberId: number,
  teamId: number,
) {
  const actors = await executor.query<{ role: string; staff_member_id: number | null }>(
    `select account.role, member.id as staff_member_id
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
  const staff = await executor.query<{ id: number }>(
    `select id from staff_members
     where id = $1 and status = 'active' and current_team_id = $2 limit 1`,
    [actualStaffMemberId, teamId],
  );
  if (!staff[0]) throw new RepairRoundValidationError("实际维修工不属于本维修班组");
  if (
    actor.role === "mechanic" &&
    Number(actor.staff_member_id) !== actualStaffMemberId
  ) {
    throw new RepairRoundValidationError("维修工只能提交自己的回单");
  }
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
