import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import { businessOrders } from "@formal/db/schema/business-order";
import { identityPrimaryKey } from "@formal/db/schema/common";
import { repairRounds } from "@formal/db/schema/repair-round";

export const problemDescriptionSource = pgEnum("problem_description_source", [
  "creation",
  "manual",
  "customer_concern",
  "inspection_report",
  "ai_suggestion",
  "migration",
]);

export type ProblemDescriptionSource =
  (typeof problemDescriptionSource.enumValues)[number];

const contentPresent = (contentZh: unknown, contentEn: unknown) =>
  sql`coalesce(length(btrim(${contentZh})), 0)
      + coalesce(length(btrim(${contentEn})), 0) > 0`;

const sourceReferenceValid = (sourceType: unknown, sourceReferenceId: unknown) =>
  sql`((${sourceType} in ('customer_concern', 'inspection_report', 'ai_suggestion')
        and ${sourceReferenceId} is not null)
       or (${sourceType} in ('creation', 'manual', 'migration')
           and ${sourceReferenceId} is null))`;

export const businessOrderProblemOriginals = pgTable(
  "business_order_problem_originals",
  {
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .primaryKey()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    contentZh: text("content_zh"),
    contentEn: text("content_en"),
    sourceType: problemDescriptionSource("source_type").notNull(),
    sourceReferenceId: bigint("source_reference_id", { mode: "number" }),
    confirmedBy: bigint("confirmed_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("business_order_problem_originals_confirmed_idx").on(
      table.confirmedAt,
    ),
    check(
      "business_order_problem_originals_source_reference_valid",
      sourceReferenceValid(table.sourceType, table.sourceReferenceId),
    ),
  ],
);

export const businessOrderProblemVersions = pgTable(
  "business_order_problem_versions",
  {
    id: identityPrimaryKey(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    contentZh: text("content_zh"),
    contentEn: text("content_en"),
    sourceType: problemDescriptionSource("source_type").notNull(),
    sourceReferenceId: bigint("source_reference_id", { mode: "number" }),
    changeReason: text("change_reason").notNull(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("business_order_problem_versions_owner_version_uq").on(
      table.businessOrderId,
      table.versionNo,
    ),
    index("business_order_problem_versions_owner_created_idx").on(
      table.businessOrderId,
      table.createdAt,
    ),
    check(
      "business_order_problem_versions_version_positive",
      sql`${table.versionNo} >= 1`,
    ),
    check(
      "business_order_problem_versions_content_present",
      contentPresent(table.contentZh, table.contentEn),
    ),
    check(
      "business_order_problem_versions_reason_nonempty",
      sql`length(btrim(${table.changeReason})) > 0`,
    ),
    check(
      "business_order_problem_versions_source_reference_valid",
      sourceReferenceValid(table.sourceType, table.sourceReferenceId),
    ),
  ],
);

export const repairRoundProblemVersions = pgTable(
  "repair_round_problem_versions",
  {
    id: identityPrimaryKey(),
    repairRoundId: bigint("repair_round_id", { mode: "number" })
      .notNull()
      .references(() => repairRounds.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    contentZh: text("content_zh"),
    contentEn: text("content_en"),
    sourceType: problemDescriptionSource("source_type").notNull(),
    sourceReferenceId: bigint("source_reference_id", { mode: "number" }),
    changeReason: text("change_reason").notNull(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("repair_round_problem_versions_owner_version_uq").on(
      table.repairRoundId,
      table.versionNo,
    ),
    index("repair_round_problem_versions_owner_created_idx").on(
      table.repairRoundId,
      table.createdAt,
    ),
    check(
      "repair_round_problem_versions_version_positive",
      sql`${table.versionNo} >= 1`,
    ),
    check(
      "repair_round_problem_versions_content_present",
      contentPresent(table.contentZh, table.contentEn),
    ),
    check(
      "repair_round_problem_versions_reason_nonempty",
      sql`length(btrim(${table.changeReason})) > 0`,
    ),
    check(
      "repair_round_problem_versions_source_reference_valid",
      sourceReferenceValid(table.sourceType, table.sourceReferenceId),
    ),
  ],
);
