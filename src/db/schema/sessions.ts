import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@/db/schema/accounts";
import { identityPrimaryKey } from "@/db/schema/common";

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: identityPrimaryKey(),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    sessionEpoch: integer("session_epoch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_uq").on(table.tokenHash),
    index("auth_sessions_account_id_idx").on(table.accountId),
    index("auth_sessions_active_account_idx")
      .on(table.accountId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    check("auth_sessions_session_epoch_positive", sql`${table.sessionEpoch} >= 1`),
    check("auth_sessions_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
    check("auth_sessions_last_seen_after_creation", sql`${table.lastSeenAt} >= ${table.createdAt}`),
    check(
      "auth_sessions_revoked_after_creation",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
