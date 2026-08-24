import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@/db/schema/accounts";
import { identityPrimaryKey } from "@/db/schema/common";

export const dictionaryCategory = pgEnum("dictionary_category", [
  "payment_method",
  "charge_unit",
  "staff_position",
]);

export const employmentStatus = pgEnum("employment_status", [
  "active",
  "inactive",
]);

export const dictionaryItems = pgTable(
  "dictionary_items",
  {
    id: identityPrimaryKey(),
    category: dictionaryCategory("category").notNull(),
    code: text("code").notNull(),
    labelZh: text("label_zh").notNull(),
    labelEn: text("label_en"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("dictionary_items_category_code_uq").on(
      table.category,
      table.code,
    ),
    index("dictionary_items_active_sort_idx").on(
      table.category,
      table.isActive,
      table.sortOrder,
    ),
    check(
      "dictionary_items_code_normalized",
      sql`${table.code} ~ '^[a-z0-9][a-z0-9._-]*$'`,
    ),
    check(
      "dictionary_items_label_zh_nonempty",
      sql`length(btrim(${table.labelZh})) > 0`,
    ),
    check("dictionary_items_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check("dictionary_items_version_positive", sql`${table.version} >= 1`),
  ],
);

export const repairTeams = pgTable(
  "repair_teams",
  {
    id: identityPrimaryKey(),
    teamNo: text("team_no").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("repair_teams_team_no_uq").on(table.teamNo),
    uniqueIndex("repair_teams_normalized_name_uq").on(table.normalizedName),
    index("repair_teams_active_idx").on(table.isActive, table.name),
    check(
      "repair_teams_team_no_format",
      sql`${table.teamNo} ~ '^TEAM-[0-9]{6}-[0-9]{4}$'`,
    ),
    check(
      "repair_teams_name_nonempty",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "repair_teams_normalized_name_nonempty",
      sql`length(btrim(${table.normalizedName})) > 0`,
    ),
    check("repair_teams_version_positive", sql`${table.version} >= 1`),
  ],
);

export const repairTeamRetirements = pgTable(
  "repair_team_retirements",
  {
    sourceTeamId: bigint("source_team_id", { mode: "number" })
      .notNull()
      .references(() => repairTeams.id, { onDelete: "restrict" }),
    replacementTeamId: bigint("replacement_team_id", { mode: "number" }).references(
      () => repairTeams.id,
      { onDelete: "restrict" },
    ),
    reason: text("reason").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    retiredBy: bigint("retired_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceTeamId],
      name: "repair_team_retirements_pk",
    }),
    index("repair_team_retirements_replacement_idx").on(
      table.replacementTeamId,
    ),
    check(
      "repair_team_retirements_not_self",
      sql`${table.replacementTeamId} is null or ${table.sourceTeamId} <> ${table.replacementTeamId}`,
    ),
    check(
      "repair_team_retirements_reason_nonempty",
      sql`length(btrim(${table.reason})) > 0`,
    ),
  ],
);

export const staffMembers = pgTable(
  "staff_members",
  {
    id: identityPrimaryKey(),
    staffNo: text("staff_no").notNull(),
    fullName: text("full_name").notNull(),
    normalizedPhone: text("normalized_phone"),
    accountId: bigint("account_id", { mode: "number" }).references(
      () => staffAccounts.id,
      { onDelete: "restrict" },
    ),
    positionItemId: bigint("position_item_id", { mode: "number" })
      .notNull()
      .references(() => dictionaryItems.id, { onDelete: "restrict" }),
    currentTeamId: bigint("current_team_id", { mode: "number" }).references(
      () => repairTeams.id,
      { onDelete: "restrict" },
    ),
    status: employmentStatus("status").notNull().default("active"),
    hiredOn: date("hired_on", { mode: "string" }).notNull(),
    leftOn: date("left_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("staff_members_staff_no_uq").on(table.staffNo),
    uniqueIndex("staff_members_account_id_uq").on(table.accountId),
    uniqueIndex("staff_members_normalized_phone_uq").on(table.normalizedPhone),
    index("staff_members_current_team_idx").on(table.currentTeamId, table.status),
    index("staff_members_position_idx").on(table.positionItemId, table.status),
    check(
      "staff_members_staff_no_format",
      sql`${table.staffNo} ~ '^STAFF-[0-9]{6}-[0-9]{4}$'`,
    ),
    check(
      "staff_members_name_nonempty",
      sql`length(btrim(${table.fullName})) > 0`,
    ),
    check(
      "staff_members_dates_valid",
      sql`${table.leftOn} is null or ${table.leftOn} >= ${table.hiredOn}`,
    ),
    check("staff_members_version_positive", sql`${table.version} >= 1`),
  ],
);

export const staffTeamAssignmentVersions = pgTable(
  "staff_team_assignment_versions",
  {
    staffMemberId: bigint("staff_member_id", { mode: "number" })
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    effectiveMonth: date("effective_month", { mode: "string" }).notNull(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => repairTeams.id, { onDelete: "restrict" }),
    setBy: bigint("set_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.staffMemberId, table.effectiveMonth],
      name: "staff_team_assignment_versions_pk",
    }),
    index("staff_team_assignment_versions_team_month_idx").on(
      table.teamId,
      table.effectiveMonth,
    ),
    check(
      "staff_team_assignment_versions_month_start",
      sql`${table.effectiveMonth} = date_trunc('month', ${table.effectiveMonth})::date`,
    ),
  ],
);

export const employeeSalaryVersions = pgTable(
  "employee_salary_versions",
  {
    staffMemberId: bigint("staff_member_id", { mode: "number" })
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    effectiveMonth: date("effective_month", { mode: "string" }).notNull(),
    baseSalaryCnyMinor: bigint("base_salary_cny_minor", { mode: "number" })
      .notNull(),
    setBy: bigint("set_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.staffMemberId, table.effectiveMonth],
      name: "employee_salary_versions_pk",
    }),
    index("employee_salary_versions_month_idx").on(table.effectiveMonth),
    check(
      "employee_salary_versions_month_start",
      sql`${table.effectiveMonth} = date_trunc('month', ${table.effectiveMonth})::date`,
    ),
    check(
      "employee_salary_versions_nonnegative",
      sql`${table.baseSalaryCnyMinor} >= 0`,
    ),
  ],
);

export const payrollParameterVersions = pgTable(
  "payroll_parameter_versions",
  {
    effectiveMonth: date("effective_month", { mode: "string" }).primaryKey(),
    commissionRate: numeric("commission_rate", {
      precision: 9,
      scale: 6,
    }).notNull(),
    cnyToJmdRate: numeric("cny_to_jmd_rate", {
      precision: 18,
      scale: 6,
    }).notNull(),
    setBy: bigint("set_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "payroll_parameter_versions_month_start",
      sql`${table.effectiveMonth} = date_trunc('month', ${table.effectiveMonth})::date`,
    ),
    check(
      "payroll_parameter_versions_commission_valid",
      sql`${table.commissionRate} > 0 and ${table.commissionRate} <= 1`,
    ),
    check(
      "payroll_parameter_versions_exchange_positive",
      sql`${table.cnyToJmdRate} > 0`,
    ),
  ],
);

export type DictionaryItem = typeof dictionaryItems.$inferSelect;
export type RepairTeam = typeof repairTeams.$inferSelect;
export type StaffMember = typeof staffMembers.$inferSelect;
