import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { staffAccounts } from "@/db/schema/accounts";
import { businessOrders } from "@/db/schema/business-order";
import { identityPrimaryKey } from "@/db/schema/common";
import { vehicles } from "@/db/schema/customer-vehicle";

export const vehiclePickupNotices = pgTable("vehicle_pickup_notices", {
  id: identityPrimaryKey(), vehicleId: bigint("vehicle_id", { mode: "number" }).notNull().references(() => vehicles.id, { onDelete: "restrict" }),
  originBusinessOrderId: bigint("origin_business_order_id", { mode: "number" }).notNull().references(() => businessOrders.id, { onDelete: "restrict" }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull(), notifiedBy: bigint("notified_by", { mode: "number" }).notNull().references(() => staffAccounts.id, { onDelete: "restrict" }),
  dailyRateMinor: bigint("daily_rate_minor", { mode: "number" }).notNull(), freeDays: integer("free_days").notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }), pausedByBusinessOrderId: bigint("paused_by_business_order_id", { mode: "number" }).references(() => businessOrders.id, { onDelete: "restrict" }), pausedAccruedMinor: bigint("paused_accrued_minor", { mode: "number" }),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }), pickedUpBy: bigint("picked_up_by", { mode: "number" }).references(() => staffAccounts.id, { onDelete: "restrict" }),
}, (table) => [
  uniqueIndex("vehicle_pickup_notices_origin_uq").on(table.originBusinessOrderId), uniqueIndex("vehicle_pickup_notices_one_active_vehicle_uq").on(table.vehicleId).where(sql`${table.pickedUpAt} is null`), index("vehicle_pickup_notices_pending_idx").on(table.vehicleId, table.notifiedAt),
  check("vehicle_pickup_notices_rate_positive", sql`${table.dailyRateMinor} > 0 and ${table.freeDays} >= 0`), check("vehicle_pickup_notices_pause_complete", sql`num_nonnulls(${table.pausedAt}, ${table.pausedByBusinessOrderId}, ${table.pausedAccruedMinor}) in (0, 3)`),
]);
