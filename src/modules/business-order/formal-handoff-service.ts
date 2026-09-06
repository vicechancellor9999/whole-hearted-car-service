import type {
  FormalHandoffChargeSnapshot,
} from "@formal/db/schema/formal-handoff";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";

type FormalHandoffRow = {
  id: number;
  business_order_id: number;
  handoff_no: number;
  repair_round_id: number;
  repair_round_no: number;
  team_id: number;
  performance_minor: number;
  jamaica_month: string | Date;
  charge_version_id: number;
  charge_version_no: number;
  gross_minor: number;
  line_discount_minor: number;
  labor_discount_minor: number;
  part_discount_minor: number;
  other_discount_minor: number;
  category_discount_minor: number;
  whole_order_discount_minor: number;
  total_due_minor: number;
  included_gct_minor: number;
  charge_snapshot: FormalHandoffChargeSnapshot | string;
  handed_off_at: Date;
  handed_off_by: number;
  corrects_formal_handoff_id?: number | null;
  cancellation_id?: number | null;
  cancellation_reason?: string | null;
  cancelled_at?: Date | null;
  cancelled_by?: number | null;
};

type FormalHandoffCandidateRow = {
  business_order_id: number;
  business_order_version: number;
  voided_at: Date | null;
  current_charge_version_no: number;
  repair_round_id: number;
  repair_round_no: number;
  repair_round_version: number;
  repair_round_status: string;
  performance_draft_minor: number | null;
  team_id: number | null;
};

type ChargeVersionRow = {
  id: number;
  version_no: number;
  gross_minor: number;
  line_discount_minor: number;
  labor_discount_minor: number;
  part_discount_minor: number;
  other_discount_minor: number;
  category_discount_minor: number;
  whole_order_discount_minor: number;
  total_due_minor: number;
  included_gct_minor: number;
};

export type FormalHandoffRecord = {
  id: number;
  handoffNo: number;
  businessOrderId: number;
  repairRoundId: number;
  repairRoundNo: number;
  teamId: number;
  performanceMinor: number;
  jamaicaMonth: string;
  chargeVersionId: number;
  chargeVersionNo: number;
  chargeSnapshot: FormalHandoffChargeSnapshot;
  handedOffAt: Date;
  handedOffBy: number;
  correctsFormalHandoffId?: number | null;
  cancellation: {
    id: number;
    reason: string;
    cancelledAt: Date;
    cancelledBy: number;
  } | null;
};

export type FormalHandoffCancellationRecord = {
  id: number;
  formalHandoffId: number;
  reason: string;
  jamaicaMonth: string;
  cancelledAt: Date;
  cancelledBy: number;
};

export class FormalHandoffValidationError extends Error {
  readonly status = 422;
  readonly code = "formal_handoff_validation";

  constructor(message: string) {
    super(message);
    this.name = "FormalHandoffValidationError";
  }
}

export class FormalHandoffNotFoundError extends Error {
  readonly status = 404;
  readonly code = "formal_handoff_not_found";

  constructor(message = "正式交单记录不存在") {
    super(message);
    this.name = "FormalHandoffNotFoundError";
  }
}

export class FormalHandoffReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "formal_handoff_read_denied";

  constructor() {
    super("当前账号不能查看正式交单记录");
    this.name = "FormalHandoffReadDeniedError";
  }
}

export class FormalHandoffWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "formal_handoff_write_denied";

  constructor() {
    super("当前账号不能执行正式交单或取消交单");
    this.name = "FormalHandoffWriteDeniedError";
  }
}

export class FormalHandoffService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async formallyHandOffRound(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    performanceValue: string;
    context: BusinessOrderActionContext;
  }): Promise<FormalHandoffRecord> {
    return this.database.transaction((transaction) => formallyHandOffRoundInTransaction(transaction, input));
  }

  async cancelFormalHandoffInSameMonth(input: {
    businessOrderId: number;
    formalHandoffId: number;
    reason: string;
    context: BusinessOrderActionContext;
  }): Promise<FormalHandoffCancellationRecord> {
    return this.database.transaction((transaction) => cancelFormalHandoffInSameMonthInTransaction(
      transaction,
      input,
    ));
  }

  async adjustFormalHandoffPerformanceInSameMonth(input: {
    businessOrderId: number;
    formalHandoffId: number;
    expectedRepairRoundVersion: number;
    performanceValue: string;
    reason: string;
    context: BusinessOrderActionContext;
  }): Promise<FormalHandoffRecord> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    const formalHandoffId = positiveId(input.formalHandoffId, "正式交单记录");
    const expectedRepairRoundVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
    const performanceMinor = parseSignedMoney(input.performanceValue, "本轮绩效");
    const reason = nonempty(input.reason, "绩效调整原因");
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const rows = await transaction.query<FormalHandoffRow & { repair_round_version: number; repair_round_status: string }>(
        `select handoff.*, repair_round.version as repair_round_version,
                repair_round.status as repair_round_status
         from formal_handoffs as handoff
         join repair_rounds as repair_round on repair_round.id = handoff.repair_round_id
         where handoff.id = $1 and handoff.business_order_id = $2
         for update of handoff, repair_round`,
        [formalHandoffId, businessOrderId],
      );
      const handoff = rows[0];
      if (!handoff) throw new FormalHandoffNotFoundError();
      if (handoff.repair_round_version !== expectedRepairRoundVersion) {
        throw new FormalHandoffValidationError("维修轮次已发生变化，请刷新后重试");
      }
      if (handoff.repair_round_status !== "formally_handed_off") {
        throw new FormalHandoffValidationError("只有当前有效正式交单可以调整绩效");
      }
      const previousPerformanceMinor = Number(handoff.performance_minor);
      if (previousPerformanceMinor === performanceMinor) {
        throw new FormalHandoffValidationError("新的本轮绩效与当前值相同");
      }

      await cancelFormalHandoffInSameMonthInTransaction(transaction, {
        businessOrderId,
        formalHandoffId,
        reason: `绩效调整：${reason}`,
        context: { ...input.context, now },
        allowHistoricalRound: true,
      });
      const cancelledRound = await transaction.query<{ id: number; version: number; status: string }>(
        `select id, version, status
         from repair_rounds
         where id = $1
         for update`,
        [handoff.repair_round_id],
      );
      const round = cancelledRound[0];
      if (!round || round.status !== "return_pending_review") {
        throw new FormalHandoffValidationError("取消旧绩效事实后维修轮次状态异常");
      }
      await transaction.query(
        "select set_config('whole_hearted.repair_event_projection', 'on', true)",
      );
      const updated = await transaction.query<{ version: number }>(
        `update repair_rounds
         set performance_draft_minor = $1,
             updated_at = $2,
             version = version + 1
         where id = $3 and version = $4
         returning version`,
        [performanceMinor, now, round.id, round.version],
      );
      const updatedRound = updated[0];
      if (!updatedRound) {
        throw new FormalHandoffValidationError("维修轮次已被其他操作修改，请刷新后重试");
      }

      const counts = await transaction.query<{ current_no: number }>(
        `select coalesce(max(handoff_no), 0)::integer as current_no
         from formal_handoffs where business_order_id = $1`,
        [businessOrderId],
      );
      const handoffNo = Number(counts[0]?.current_no ?? 0) + 1;
      const chargeSnapshot = typeof handoff.charge_snapshot === "string"
        ? JSON.parse(handoff.charge_snapshot) as FormalHandoffChargeSnapshot
        : handoff.charge_snapshot;
      const replacements = await transaction.query<FormalHandoffRow>(
        `insert into formal_handoffs
          (business_order_id, handoff_no, repair_round_id, repair_round_no,
           team_id, performance_minor, jamaica_month,
           charge_version_id, charge_version_no,
           gross_minor, line_discount_minor,
           labor_discount_minor, part_discount_minor, other_discount_minor,
           category_discount_minor, whole_order_discount_minor,
           total_due_minor, included_gct_minor, charge_snapshot,
           handed_off_at, handed_off_by, corrects_formal_handoff_id)
         values
          ($1, $2, $3, $4, $5, $6, $7::date, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb,
           $20, $21, $22)
         returning *`,
        [businessOrderId, handoffNo, handoff.repair_round_id,
          handoff.repair_round_no, handoff.team_id, performanceMinor,
          normalizeMonthDate(handoff.jamaica_month), handoff.charge_version_id,
          handoff.charge_version_no, handoff.gross_minor,
          handoff.line_discount_minor, handoff.labor_discount_minor,
          handoff.part_discount_minor, handoff.other_discount_minor,
          handoff.category_discount_minor, handoff.whole_order_discount_minor,
          handoff.total_due_minor, handoff.included_gct_minor,
          JSON.stringify(chargeSnapshot), now, input.context.actorAccountId,
          formalHandoffId],
      );
      const replacement = replacements[0];
      if (!replacement) {
        throw new FormalHandoffValidationError("绩效更正交单事实未能写入");
      }
      await audit(transaction, input.context, now, {
        eventType: "business_order.performance_adjusted",
        businessOrderId,
        reason,
        before: {
          formalHandoffId,
          repairRoundId: Number(handoff.repair_round_id),
          repairRoundNo: handoff.repair_round_no,
          performanceMinor: previousPerformanceMinor,
        },
        after: {
          formalHandoffId: Number(replacement.id),
          correctsFormalHandoffId: formalHandoffId,
          repairRoundId: Number(handoff.repair_round_id),
          repairRoundNo: handoff.repair_round_no,
          performanceMinor,
          chargeVersionNo: handoff.charge_version_no,
        },
      });
      await audit(transaction, input.context, now, {
        eventType: "business_order.formally_handed_off",
        businessOrderId,
        after: {
          formalHandoffId: Number(replacement.id),
          handoffNo,
          repairRoundNo: handoff.repair_round_no,
          teamId: Number(handoff.team_id),
          performanceMinor,
          jamaicaMonth: normalizeMonthDate(handoff.jamaica_month).slice(0, 7),
          chargeVersionNo: handoff.charge_version_no,
          totalDueMinor: Number(handoff.total_due_minor),
          correctsFormalHandoffId: formalHandoffId,
        },
      });
      return mapHandoff(replacement);
    });
  }

  async listFormalHandoffs(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<FormalHandoffRecord[]> {
    const businessOrderId = positiveId(input.businessOrderId, "Business Order");
    await requireReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<FormalHandoffRow>(
      `select handoff.*,
              cancellation.id as cancellation_id,
              cancellation.reason as cancellation_reason,
              cancellation.cancelled_at,
              cancellation.cancelled_by
       from formal_handoffs as handoff
       left join formal_handoff_cancellations as cancellation
         on cancellation.formal_handoff_id = handoff.id
       where handoff.business_order_id = $1
       order by handoff.handoff_no, handoff.id`,
      [businessOrderId],
    );
    return rows.map(mapHandoff);
  }
}

export async function formallyHandOffRoundInTransaction(
  transaction: AuthSqlExecutor,
  input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    performanceValue: string;
    context: BusinessOrderActionContext;
  },
): Promise<FormalHandoffRecord> {
  const businessOrderId = positiveId(input.businessOrderId, "Business Order");
  const expectedRoundVersion = positiveId(input.expectedRepairRoundVersion, "维修轮次版本");
  const requestedPerformanceMinor = parseSignedMoney(input.performanceValue, "绩效值");
  const now = input.context.now ?? new Date();
  const monthDate = jamaicaMonthDate(now);
  await requireWriter(transaction, input.context.actorAccountId);
  const candidateRows = await transaction.query<FormalHandoffCandidateRow>(
    `select business_order.id as business_order_id,
            business_order.version as business_order_version,
            business_order.voided_at,
            business_order.current_charge_version_no,
            repair_round.id as repair_round_id,
            repair_round.round_no as repair_round_no,
            repair_round.version as repair_round_version,
            repair_round.status as repair_round_status,
            repair_round.performance_draft_minor,
            repair_round.assigned_team_id as team_id
     from business_orders as business_order
     join repair_rounds as repair_round
       on repair_round.business_order_id = business_order.id
      and repair_round.round_no = business_order.current_repair_round_no
     where business_order.id = $1
     for update of business_order, repair_round`,
    [businessOrderId],
  );
  const candidate = candidateRows[0];
  if (!candidate) throw new FormalHandoffNotFoundError("Business Order 或当前维修轮次不存在");
  if (candidate.voided_at) throw new FormalHandoffValidationError("已作废的 Business Order 不能正式交单");
  if (candidate.repair_round_version !== expectedRoundVersion) {
    throw new FormalHandoffValidationError("维修轮次已发生变化，请刷新后重试");
  }
  if (candidate.repair_round_status !== "return_pending_review") {
    throw new FormalHandoffValidationError("只有回单已审核的当前维修轮次可以正式交单");
  }
  if (candidate.team_id === null) throw new FormalHandoffValidationError("当前维修轮次没有维修班组");
  const approved = await transaction.query<{ approved: boolean }>(
    `select true as approved
     from repair_round_work_returns as work_return
     join repair_round_events as approval
       on approval.repair_round_id = work_return.repair_round_id
      and approval.work_return_id = work_return.id
      and approval.event_type = 'work_return_approved'
     where work_return.repair_round_id = $1
       and work_return.submission_no = (
         select max(submission_no) from repair_round_work_returns
         where repair_round_id = $1
       )
     limit 1`,
    [candidate.repair_round_id],
  );
  if (!approved[0]) throw new FormalHandoffValidationError("最新回单尚未审核通过");
  const active = await transaction.query<{ id: number }>(
    `select handoff.id
     from formal_handoffs as handoff
     left join formal_handoff_cancellations as cancellation
       on cancellation.formal_handoff_id = handoff.id
     where handoff.repair_round_id = $1 and cancellation.id is null
     limit 1`,
    [candidate.repair_round_id],
  );
  if (active[0]) throw new FormalHandoffValidationError("当前维修轮次已经正式交单");

  const chargeRows = await transaction.query<ChargeVersionRow>(
    `select id, version_no, gross_minor, line_discount_minor,
            labor_discount_minor, part_discount_minor, other_discount_minor,
            category_discount_minor, whole_order_discount_minor,
            total_due_minor, included_gct_minor
     from business_order_charge_versions
     where business_order_id = $1 and version_no = $2
     limit 1`,
    [businessOrderId, candidate.current_charge_version_no],
  );
  const charge = chargeRows[0];
  if (!charge) throw new FormalHandoffNotFoundError("当前收费版本不存在");
  const chargeSnapshot = await buildChargeSnapshot(transaction, charge);
  const performanceMinor = candidate.performance_draft_minor == null
    ? candidate.repair_round_no === 1
      ? chargeSnapshot.items
        .filter((item) => item.kind === "labor")
        .reduce((sum, item) => sum + item.subtotalMinor, 0)
      : 0
    : Number(candidate.performance_draft_minor);
  if (requestedPerformanceMinor !== performanceMinor) {
    throw new FormalHandoffValidationError("提交的本轮绩效与已保存的本轮绩效不一致，请刷新后重试");
  }
  const counts = await transaction.query<{ current_no: number }>(
    `select coalesce(max(handoff_no), 0)::integer as current_no
     from formal_handoffs where business_order_id = $1`,
    [businessOrderId],
  );
  const handoffNo = Number(counts[0]?.current_no ?? 0) + 1;
  const inserted = await transaction.query<FormalHandoffRow>(
    `insert into formal_handoffs
      (business_order_id, handoff_no, repair_round_id, repair_round_no,
       team_id, performance_minor, jamaica_month,
       charge_version_id, charge_version_no,
       gross_minor, line_discount_minor,
       labor_discount_minor, part_discount_minor, other_discount_minor,
       category_discount_minor, whole_order_discount_minor,
       total_due_minor, included_gct_minor, charge_snapshot,
       handed_off_at, handed_off_by)
     values
      ($1, $2, $3, $4, $5, $6, $7::date, $8, $9,
       $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb,
       $20, $21)
     returning *`,
    [businessOrderId, handoffNo, candidate.repair_round_id,
      candidate.repair_round_no, candidate.team_id, performanceMinor,
      monthDate, charge.id, charge.version_no,
      charge.gross_minor, charge.line_discount_minor,
      charge.labor_discount_minor, charge.part_discount_minor,
      charge.other_discount_minor, charge.category_discount_minor,
      charge.whole_order_discount_minor, charge.total_due_minor,
      charge.included_gct_minor, JSON.stringify(chargeSnapshot), now,
      input.context.actorAccountId],
  );
  const handoff = inserted[0];
  if (!handoff) throw new FormalHandoffValidationError("正式交单未能写入");
  await audit(transaction, input.context, now, {
    eventType: "business_order.formally_handed_off",
    businessOrderId,
    after: {
      formalHandoffId: Number(handoff.id),
      handoffNo,
      repairRoundNo: candidate.repair_round_no,
      teamId: Number(candidate.team_id),
      performanceMinor,
      jamaicaMonth: monthDate.slice(0, 7),
      chargeVersionNo: charge.version_no,
      totalDueMinor: Number(charge.total_due_minor),
    },
  });
  return mapHandoff(handoff);
}

async function buildChargeSnapshot(
  executor: AuthSqlExecutor,
  charge: ChargeVersionRow,
): Promise<FormalHandoffChargeSnapshot> {
  const items = await executor.query<{
    kind: "labor" | "part" | "other";
    name_zh: string;
    name_en: string | null;
    description_zh: string | null;
    description_en: string | null;
    unit_item_id: number;
    quantity: string;
    unit_price_minor: number;
    pending_quote: boolean;
    item_discount_minor: number;
    subtotal_minor: number;
    sort_order: number;
  }>(
    `select kind, name_zh, name_en, description_zh, description_en,
            unit_item_id, quantity::text as quantity, unit_price_minor, pending_quote,
            item_discount_minor, subtotal_minor, sort_order
     from business_order_charge_items
     where charge_version_id = $1
     order by sort_order, id`,
    [charge.id],
  );
  const notes = await executor.query<{
    kind: FormalHandoffChargeSnapshot["notes"][number]["kind"];
    content_zh: string | null;
    content_en: string | null;
    sort_order: number;
  }>(
    `select kind, content_zh, content_en, sort_order
     from business_order_notes
     where charge_version_id = $1
     order by sort_order, id`,
    [charge.id],
  );
  return {
    totals: {
      grossMinor: Number(charge.gross_minor),
      lineDiscountMinor: Number(charge.line_discount_minor),
      laborDiscountMinor: Number(charge.labor_discount_minor),
      partDiscountMinor: Number(charge.part_discount_minor),
      otherDiscountMinor: Number(charge.other_discount_minor),
      categoryDiscountMinor: Number(charge.category_discount_minor),
      wholeOrderDiscountMinor: Number(charge.whole_order_discount_minor),
      totalDueMinor: Number(charge.total_due_minor),
      includedGctMinor: Number(charge.included_gct_minor),
    },
    items: items.map((item) => ({
      kind: item.kind,
      nameZh: item.name_zh,
      nameEn: item.name_en,
      descriptionZh: item.description_zh,
      descriptionEn: item.description_en,
      unitItemId: Number(item.unit_item_id),
      quantity: item.quantity,
      unitPriceMinor: Number(item.unit_price_minor),
      ...(item.pending_quote ? { pendingQuote: true } : {}),
      itemDiscountMinor: Number(item.item_discount_minor),
      subtotalMinor: Number(item.subtotal_minor),
      sortOrder: item.sort_order,
    })),
    notes: notes.map((note) => ({
      kind: note.kind,
      contentZh: note.content_zh,
      contentEn: note.content_en,
      sortOrder: note.sort_order,
    })),
  };
}

async function requireWriter(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ id: number }>(
    `select id from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new FormalHandoffWriteDeniedError();
}

async function requireReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ id: number }>(
    `select id from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new FormalHandoffReadDeniedError();
}

async function audit(
  executor: AuthSqlExecutor,
  context: BusinessOrderActionContext,
  occurredAt: Date,
  input: {
    eventType: string;
    businessOrderId: number;
    reason?: string;
    before?: Record<string, unknown>;
    after: Record<string, unknown>;
  },
) {
  await writeAuditEvent(executor, {
    occurredAt,
    actorAccountId: context.actorAccountId,
    eventType: input.eventType,
    objectType: "business_order",
    objectId: String(input.businessOrderId),
    reason: input.reason,
    before: input.before,
    after: input.after,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

async function cancelFormalHandoffInSameMonthInTransaction(
  transaction: AuthSqlExecutor,
  input: {
    businessOrderId: number;
    formalHandoffId: number;
    reason: string;
    context: BusinessOrderActionContext;
    allowHistoricalRound?: boolean;
  },
): Promise<FormalHandoffCancellationRecord> {
  const businessOrderId = positiveId(input.businessOrderId, "Business Order");
  const formalHandoffId = positiveId(input.formalHandoffId, "正式交单记录");
  const reason = nonempty(input.reason, "取消原因");
  const now = input.context.now ?? new Date();
  const cancellationMonth = jamaicaMonthDate(now);
  await requireWriter(transaction, input.context.actorAccountId);
  const rows = await transaction.query<FormalHandoffRow>(
    `select handoff.*
     from formal_handoffs as handoff
     where handoff.id = $1
       and handoff.business_order_id = $2
     for update of handoff`,
    [formalHandoffId, businessOrderId],
  );
  const handoff = rows[0];
  if (!handoff) throw new FormalHandoffNotFoundError();
  const cancellations = await transaction.query<{ id: number }>(
    `select id from formal_handoff_cancellations
     where formal_handoff_id = $1
     limit 1`,
    [formalHandoffId],
  );
  if (cancellations[0]) {
    throw new FormalHandoffValidationError("这次正式交单已经取消");
  }
  const handoffMonth = normalizeMonthDate(handoff.jamaica_month);
  if (handoffMonth !== cancellationMonth) {
    throw new FormalHandoffValidationError("只能在正式交单发生的牙买加自然月内取消");
  }
  const currentOrders = await transaction.query<{ current_repair_round_no: number }>(
    `select current_repair_round_no
     from business_orders
     where id = $1
     for update`,
    [businessOrderId],
  );
  if (!input.allowHistoricalRound
      && currentOrders[0]?.current_repair_round_no !== handoff.repair_round_no) {
    throw new FormalHandoffValidationError("这次正式交单已不是当前有效交单");
  }
  const inserted = await transaction.query<{
    id: number;
    formal_handoff_id: number;
    reason: string;
    jamaica_month: string | Date;
    cancelled_at: Date;
    cancelled_by: number;
  }>(
    `insert into formal_handoff_cancellations
      (formal_handoff_id, reason, jamaica_month, cancelled_at, cancelled_by)
     values ($1, $2, $3::date, $4, $5)
     returning *`,
    [formalHandoffId, reason, cancellationMonth, now,
      input.context.actorAccountId],
  );
  const cancellation = inserted[0];
  if (!cancellation) {
    throw new FormalHandoffValidationError("取消交单事实未能写入");
  }
  await audit(transaction, input.context, now, {
    eventType: "business_order.formal_handoff_cancelled",
    businessOrderId: Number(handoff.business_order_id),
    reason,
    after: {
      formalHandoffId,
      handoffNo: handoff.handoff_no,
      jamaicaMonth: cancellationMonth.slice(0, 7),
    },
  });
  return {
    id: Number(cancellation.id),
    formalHandoffId: Number(cancellation.formal_handoff_id),
    reason: cancellation.reason,
    jamaicaMonth: normalizeMonthDate(cancellation.jamaica_month).slice(0, 7),
    cancelledAt: new Date(cancellation.cancelled_at),
    cancelledBy: Number(cancellation.cancelled_by),
  };
}

function mapHandoff(row: FormalHandoffRow): FormalHandoffRecord {
  const snapshot = typeof row.charge_snapshot === "string"
    ? JSON.parse(row.charge_snapshot) as FormalHandoffChargeSnapshot
    : row.charge_snapshot;
  return {
    id: Number(row.id),
    handoffNo: row.handoff_no,
    businessOrderId: Number(row.business_order_id),
    repairRoundId: Number(row.repair_round_id),
    repairRoundNo: row.repair_round_no,
    teamId: Number(row.team_id),
    performanceMinor: Number(row.performance_minor),
    jamaicaMonth: normalizeMonthDate(row.jamaica_month).slice(0, 7),
    chargeVersionId: Number(row.charge_version_id),
    chargeVersionNo: row.charge_version_no,
    chargeSnapshot: snapshot,
    handedOffAt: new Date(row.handed_off_at),
    handedOffBy: Number(row.handed_off_by),
    correctsFormalHandoffId: row.corrects_formal_handoff_id == null
      ? null
      : Number(row.corrects_formal_handoff_id),
    cancellation: row.cancellation_id == null
      ? null
      : {
          id: Number(row.cancellation_id),
          reason: row.cancellation_reason ?? "",
          cancelledAt: new Date(row.cancelled_at as Date),
          cancelledBy: Number(row.cancelled_by),
        },
  };
}

function jamaicaMonthDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new FormalHandoffValidationError("无法确定牙买加交单月份");
  }
  return `${year}-${month}-01`;
}

function normalizeMonthDate(value: string | Date) {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function parseSignedMoney(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!/^-?(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new FormalHandoffValidationError(`${label}格式不正确，最多保留两位小数`);
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw new FormalHandoffValidationError(`${label}超出可处理范围`);
  }
  return negative ? -minor : minor;
}

function positiveId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new FormalHandoffValidationError(`${label}无效`);
  }
  return value;
}

function nonempty(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new FormalHandoffValidationError(`${label}不能为空`);
  return normalized;
}
