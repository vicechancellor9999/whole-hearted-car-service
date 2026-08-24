import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { identityPrimaryKey } from "@/db/schema/common";

export const accountRole = pgEnum("account_role", [
  "super_admin",
  "front_desk",
  "owner",
  "mechanic",
]);

export const staffAccounts = pgTable(
  "staff_accounts",
  {
    id: identityPrimaryKey(),
    displayName: text("display_name").notNull(),
    normalizedUsername: text("normalized_username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: accountRole("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    sessionEpoch: integer("session_epoch").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }).references(
      (): AnyPgColumn => staffAccounts.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("staff_accounts_normalized_username_uq").on(
      table.normalizedUsername,
    ),
    index("staff_accounts_created_by_idx").on(table.createdBy),
    check("staff_accounts_session_epoch_positive", sql`${table.sessionEpoch} >= 1`),
    check("staff_accounts_version_positive", sql`${table.version} >= 1`),
    check(
      "staff_accounts_normalized_username_nonempty",
      sql`length(btrim(${table.normalizedUsername})) > 0`,
    ),
  ],
);

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type NewStaffAccount = typeof staffAccounts.$inferInsert;
