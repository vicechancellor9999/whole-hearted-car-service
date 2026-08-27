import { toBusinessDateKey } from "@/lib/time";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@/modules/auth/session-repository";

const DAILY_RATE_MINOR = 250_000;
const FREE_DAYS = 2;

export type VehiclePresenceContext = { actorAccountId: number; requestId: string; now?: Date };

type NoticeRow = {
  id: number; vehicle_id: number; origin_business_order_id: number; order_no: string;
  plate_display: string; payer_display_name_snapshot: string; notified_at: Date;
  paused_at: Date | null; paused_accrued_minor: number | null; picked_up_at: Date | null;
};

export class VehiclePresenceValidationError extends Error { readonly status = 422; }
export class VehiclePresenceReadDeniedError extends Error { readonly status = 403; constructor() { super("当前账号不能查看待取车车辆"); } }
export class VehiclePresenceWriteDeniedError extends Error { readonly status = 403; constructor() { super("当前账号不能操作待取车流程"); } }

export class VehiclePresenceService {
  constructor(private readonly database: AuthSqlDatabase) {}

  describeNotice(input: { noticeId: number; notifiedAt: Date; pausedAt: Date | null; pausedAccruedMinor: number | null; pickedUpAt: Date | null }) {
    if (input.pickedUpAt) return { noticeId: input.noticeId, status: "picked_up" as const, accruedParkingMinor: 0, frontDeskDecisionRequired: false };
    if (input.pausedAt) return {
      noticeId: input.noticeId,
      status: "parking_paused_needs_front_desk_decision" as const,
      accruedParkingMinor: input.pausedAccruedMinor ?? 0,
      frontDeskDecisionRequired: true,
    };
    return { noticeId: input.noticeId, status: "waiting_pickup" as const, accruedParkingMinor: null, frontDeskDecisionRequired: false };
  }

  async list(input: { viewerAccountId: number; now?: Date }) {
    await requireReader(this.database, input.viewerAccountId);
    const now = input.now ?? new Date();
    const [candidateRows, noticeRows] = await Promise.all([
      this.database.query<NoticeRow>(candidateSql),
      this.database.query<NoticeRow>(noticeSql),
    ]);
    return {
      asOf: now,
      items: [
        ...candidateRows.map((row) => ({
          kind: "candidate" as const, vehicleId: Number(row.vehicle_id), businessOrderId: Number(row.origin_business_order_id),
          orderNo: row.order_no, plateDisplay: row.plate_display, customerName: row.payer_display_name_snapshot,
        })),
        ...noticeRows.map((row) => ({
          kind: "notice" as const, vehicleId: Number(row.vehicle_id), businessOrderId: Number(row.origin_business_order_id),
          orderNo: row.order_no, plateDisplay: row.plate_display, customerName: row.payer_display_name_snapshot,
          notifiedAt: new Date(row.notified_at), pausedAt: row.paused_at ? new Date(row.paused_at) : null,
          ...this.describeNotice({ noticeId: Number(row.id), notifiedAt: new Date(row.notified_at), pausedAt: row.paused_at ? new Date(row.paused_at) : null, pausedAccruedMinor: row.paused_accrued_minor === null ? null : Number(row.paused_accrued_minor), pickedUpAt: row.picked_up_at }),
        })),
      ],
    };
  }

  async createPickupNotice(input: { vehicleId: number; context: VehiclePresenceContext }) {
    if (!Number.isSafeInteger(input.vehicleId) || input.vehicleId < 1) throw new VehiclePresenceValidationError("车辆无效");
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const candidates = await transaction.query<{ business_order_id: number; formal_handoff_id: number }>(candidateForVehicleSql, [input.vehicleId]);
      const candidate = candidates[0];
      if (!candidate) throw new VehiclePresenceValidationError("该车辆尚无可通知的正式交单");
      const active = await transaction.query<{ id: number }>(activeOrderSql, [input.vehicleId, candidate.business_order_id]);
      if (active[0]) throw new VehiclePresenceValidationError("该车辆仍有进行中的 Business Order，不能通知取车");
      const rows = await transaction.query<{ id: number }>(
        `insert into vehicle_pickup_notices
          (vehicle_id, origin_business_order_id, notified_at, notified_by, daily_rate_minor, free_days)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [input.vehicleId, candidate.business_order_id, now, input.context.actorAccountId, DAILY_RATE_MINOR, FREE_DAYS],
      );
      if (!rows[0]) throw new VehiclePresenceValidationError("待取车通知未能写入");
      return { noticeId: Number(rows[0].id) };
    });
  }

  async recordPickup(input: { noticeId: number; context: VehiclePresenceContext }) {
    if (!Number.isSafeInteger(input.noticeId) || input.noticeId < 1) throw new VehiclePresenceValidationError("待取车通知无效");
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const rows = await transaction.query<{ id: number }>(
        `update vehicle_pickup_notices set picked_up_at = $2, picked_up_by = $3
         where id = $1 and picked_up_at is null returning id`,
        [input.noticeId, now, input.context.actorAccountId],
      );
      if (!rows[0]) throw new VehiclePresenceValidationError("待取车记录不存在或已取车");
      return { noticeId: input.noticeId, pickedUpAt: now };
    });
  }
}

async function requireReader(database: AuthSqlExecutor, accountId: number) {
  const rows = await database.query<{ id: number }>(`select id from staff_accounts where id = $1 and is_active = true and role in ('super_admin', 'front_desk', 'owner')`, [accountId]);
  if (!rows[0]) throw new VehiclePresenceReadDeniedError();
}
async function requireWriter(database: AuthSqlExecutor, accountId: number) {
  const rows = await database.query<{ id: number }>(`select id from staff_accounts where id = $1 and is_active = true and role in ('super_admin', 'front_desk')`, [accountId]);
  if (!rows[0]) throw new VehiclePresenceWriteDeniedError();
}

const candidateSql = `select distinct on (business_order.vehicle_id)
  business_order.id as origin_business_order_id, business_order.vehicle_id, business_order.order_no,
  business_order.payer_display_name_snapshot, vehicle.plate_display, handoff.id as formal_handoff_id
 from business_orders as business_order
 join vehicles as vehicle on vehicle.id = business_order.vehicle_id
 join formal_handoffs as handoff on handoff.business_order_id = business_order.id
 left join formal_handoff_cancellations as cancellation on cancellation.formal_handoff_id = handoff.id
 where business_order.status = 'formally_handed_off' and business_order.voided_at is null and cancellation.id is null
   and not exists (select 1 from vehicle_pickup_notices as notice where notice.origin_business_order_id = business_order.id)
   and not exists (select 1 from business_orders as active where active.vehicle_id = business_order.vehicle_id and active.id <> business_order.id and active.voided_at is null and active.status <> 'formally_handed_off')
 order by business_order.vehicle_id, handoff.handed_off_at desc, handoff.id desc`;
const noticeSql = `select notice.id, notice.vehicle_id, notice.origin_business_order_id, business_order.order_no,
  business_order.payer_display_name_snapshot, vehicle.plate_display, notice.notified_at, notice.paused_at, notice.paused_accrued_minor, notice.picked_up_at
 from vehicle_pickup_notices as notice join business_orders as business_order on business_order.id = notice.origin_business_order_id
 join vehicles as vehicle on vehicle.id = notice.vehicle_id where notice.picked_up_at is null order by notice.notified_at desc, notice.id desc`;
const candidateForVehicleSql = candidateSql.replace(
  "\n order by business_order.vehicle_id",
  "\n   and business_order.vehicle_id = $1\n order by business_order.vehicle_id",
);
const activeOrderSql = `select id from business_orders as active where active.vehicle_id = $1 and active.id <> $2 and active.voided_at is null and active.status <> 'formally_handed_off' limit 1`;

export function parkingAccrualAt(notifiedAt: Date, endAt: Date): number {
  const start = Date.parse(toBusinessDateKey(notifiedAt));
  const end = Date.parse(toBusinessDateKey(endAt));
  return Math.max(0, Math.round((end - start) / 86_400_000) - FREE_DAYS) * DAILY_RATE_MINOR;
}
