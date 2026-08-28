import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import { businessOrders } from "@formal/db/schema/business-order";
import { identityPrimaryKey } from "@formal/db/schema/common";

export const businessOrderMessages = pgTable("business_order_messages", {
  id: identityPrimaryKey(),
  businessOrderId: bigint("business_order_id", { mode: "number" }).notNull().references(() => businessOrders.id, { onDelete: "restrict" }),
  authorAccountId: bigint("author_account_id", { mode: "number" }).notNull().references(() => staffAccounts.id, { onDelete: "restrict" }),
  authorDisplayName: text("author_display_name").notNull(),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
}, (table) => [
  index("business_order_messages_order_time_idx").on(table.businessOrderId, table.createdAt, table.id),
  check("business_order_messages_body_length", sql`length(btrim(${table.body})) between 1 and 4000`),
  check("business_order_messages_version_positive", sql`${table.version} >= 1`),
]);

export const businessOrderMessageMentions = pgTable("business_order_message_mentions", {
  id: identityPrimaryKey(),
  messageId: bigint("message_id", { mode: "number" }).notNull().references(() => businessOrderMessages.id, { onDelete: "restrict" }),
  mentionedAccountId: bigint("mentioned_account_id", { mode: "number" }).notNull().references(() => staffAccounts.id, { onDelete: "restrict" }),
  mentionedAt: timestamp("mentioned_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("business_order_message_mentions_message_account_uq").on(table.messageId, table.mentionedAccountId),
  index("business_order_message_mentions_account_read_idx").on(table.mentionedAccountId, table.readAt, table.mentionedAt),
]);

export const businessOrderMessageRevisions = pgTable("business_order_message_revisions", {
  id: identityPrimaryKey(),
  messageId: bigint("message_id", { mode: "number" }).notNull().references(() => businessOrderMessages.id, { onDelete: "restrict" }),
  replacedVersion: integer("replaced_version").notNull(),
  previousBody: text("previous_body").notNull(),
  editedBy: bigint("edited_by", { mode: "number" }).notNull().references(() => staffAccounts.id, { onDelete: "restrict" }),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_order_message_revisions_message_version_uq").on(table.messageId, table.replacedVersion),
  check("business_order_message_revisions_version_positive", sql`${table.replacedVersion} >= 1`),
]);
