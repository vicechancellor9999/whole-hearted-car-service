import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import {
  businessOrderChargeVersions,
  businessOrders,
} from "@formal/db/schema/business-order";
import { identityPrimaryKey } from "@formal/db/schema/common";
import { repairTeams } from "@formal/db/schema/master-data";
import { repairRounds } from "@formal/db/schema/repair-round";

export type FormalHandoffChargeSnapshot = {
  totals: {
    grossMinor: number;
    lineDiscountMinor: number;
    laborDiscountMinor: number;
    partDiscountMinor: number;
    otherDiscountMinor: number;
    categoryDiscountMinor: number;
    wholeOrderDiscountMinor: number;
    totalDueMinor: number;
    includedGctMinor: number;
  };
  items: Array<{
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    unitItemId: number;
    quantity: string;
    unitPriceMinor: number;
    pendingQuote?: boolean;
    itemDiscountMinor: number;
    subtotalMinor: number;
    sortOrder: number;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice" | "internal";
    contentZh: string | null;
    contentEn: string | null;
    sortOrder: number;
  }>;
};

export const formalHandoffs = pgTable(
  "formal_handoffs",
  {
    id: identityPrimaryKey(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    handoffNo: integer("handoff_no").notNull(),
    repairRoundId: bigint("repair_round_id", { mode: "number" })
      .notNull()
      .references(() => repairRounds.id, { onDelete: "restrict" }),
    repairRoundNo: integer("repair_round_no").notNull(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => repairTeams.id, { onDelete: "restrict" }),
    performanceMinor: bigint("performance_minor", { mode: "number" }).notNull(),
    jamaicaMonth: date("jamaica_month", { mode: "string" }).notNull(),
    chargeVersionId: bigint("charge_version_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderChargeVersions.id, { onDelete: "restrict" }),
    chargeVersionNo: integer("charge_version_no").notNull(),
    grossMinor: bigint("gross_minor", { mode: "number" }).notNull(),
    lineDiscountMinor: bigint("line_discount_minor", { mode: "number" }).notNull(),
    laborDiscountMinor: bigint("labor_discount_minor", { mode: "number" }).notNull(),
    partDiscountMinor: bigint("part_discount_minor", { mode: "number" }).notNull(),
    otherDiscountMinor: bigint("other_discount_minor", { mode: "number" }).notNull(),
    categoryDiscountMinor: bigint("category_discount_minor", { mode: "number" }).notNull(),
    wholeOrderDiscountMinor: bigint("whole_order_discount_minor", { mode: "number" }).notNull(),
    totalDueMinor: bigint("total_due_minor", { mode: "number" }).notNull(),
    includedGctMinor: bigint("included_gct_minor", { mode: "number" }).notNull(),
    chargeSnapshot: jsonb("charge_snapshot").$type<FormalHandoffChargeSnapshot>().notNull(),
    handedOffAt: timestamp("handed_off_at", { withTimezone: true }).notNull(),
    handedOffBy: bigint("handed_off_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    correctsFormalHandoffId: bigint("corrects_formal_handoff_id", { mode: "number" })
      .references((): AnyPgColumn => formalHandoffs.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("formal_handoffs_order_no_uq").on(
      table.businessOrderId,
      table.handoffNo,
    ),
    index("formal_handoffs_round_time_idx").on(
      table.repairRoundId,
      table.handedOffAt,
    ),
    index("formal_handoffs_month_team_idx").on(
      table.jamaicaMonth,
      table.teamId,
    ),
    uniqueIndex("formal_handoffs_correction_source_uq").on(
      table.correctsFormalHandoffId,
    ),
    check("formal_handoffs_no_positive", sql`${table.handoffNo} >= 1`),
    check("formal_handoffs_round_no_positive", sql`${table.repairRoundNo} >= 1`),
    check("formal_handoffs_charge_version_positive", sql`${table.chargeVersionNo} >= 1`),
    check(
      "formal_handoffs_month_first_day",
      sql`extract(day from ${table.jamaicaMonth}) = 1`,
    ),
    check(
      "formal_handoffs_amounts_nonnegative",
      sql`${table.grossMinor} >= 0
          and ${table.lineDiscountMinor} >= 0
          and ${table.laborDiscountMinor} >= 0
          and ${table.partDiscountMinor} >= 0
          and ${table.otherDiscountMinor} >= 0
          and ${table.categoryDiscountMinor} >= 0
          and ${table.wholeOrderDiscountMinor} >= 0
          and ${table.totalDueMinor} >= 0
          and ${table.includedGctMinor} >= 0`,
    ),
    check(
      "formal_handoffs_category_discount_total",
      sql`${table.categoryDiscountMinor} = ${table.laborDiscountMinor}
          + ${table.partDiscountMinor} + ${table.otherDiscountMinor}`,
    ),
    check(
      "formal_handoffs_amount_conservation",
      sql`${table.totalDueMinor} = ${table.grossMinor} - ${table.lineDiscountMinor}
          - ${table.categoryDiscountMinor} - ${table.wholeOrderDiscountMinor}`,
    ),
    check(
      "formal_handoffs_gct_within_total",
      sql`${table.includedGctMinor} <= ${table.totalDueMinor}`,
    ),
  ],
);

export const formalHandoffCancellations = pgTable(
  "formal_handoff_cancellations",
  {
    id: identityPrimaryKey(),
    formalHandoffId: bigint("formal_handoff_id", { mode: "number" })
      .notNull()
      .references(() => formalHandoffs.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    jamaicaMonth: date("jamaica_month", { mode: "string" }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull(),
    cancelledBy: bigint("cancelled_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("formal_handoff_cancellations_handoff_uq").on(
      table.formalHandoffId,
    ),
    index("formal_handoff_cancellations_month_idx").on(table.jamaicaMonth),
    check(
      "formal_handoff_cancellations_reason_nonempty",
      sql`length(btrim(${table.reason})) > 0`,
    ),
    check(
      "formal_handoff_cancellations_month_first_day",
      sql`extract(day from ${table.jamaicaMonth}) = 1`,
    ),
  ],
);

export type FormalHandoff = typeof formalHandoffs.$inferSelect;
export type FormalHandoffCancellation =
  typeof formalHandoffCancellations.$inferSelect;
