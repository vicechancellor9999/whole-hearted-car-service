import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import { businessOrders } from "@formal/db/schema/business-order";
import { businessOrderMessages } from "@formal/db/schema/business-order-message";
import { identityPrimaryKey } from "@formal/db/schema/common";
import { storedFiles } from "@formal/db/schema/customer-vehicle";

export const businessOrderAttachments = pgTable("business_order_attachments", {
  id: identityPrimaryKey(),
  businessOrderId: bigint("business_order_id", { mode: "number" })
    .notNull()
    .references(() => businessOrders.id, { onDelete: "restrict" }),
  fileId: bigint("file_id", { mode: "number" })
    .notNull()
    .references(() => storedFiles.id, { onDelete: "restrict" }),
  category: text("category").notNull(),
  caption: text("caption"),
  messageId: bigint("message_id", { mode: "number" })
    .references(() => businessOrderMessages.id, { onDelete: "restrict" }),
  linkedBy: bigint("linked_by", { mode: "number" })
    .notNull()
    .references(() => staffAccounts.id, { onDelete: "restrict" }),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_order_attachments_file_uq").on(table.fileId),
  index("business_order_attachments_order_time_idx").on(table.businessOrderId, table.linkedAt, table.id),
  index("business_order_attachments_message_idx").on(table.messageId),
  check("business_order_attachments_category_valid", sql`${table.category} in ('customer_signature', 'service_photo', 'financial_evidence', 'other')`),
  check("business_order_attachments_caption_length", sql`${table.caption} is null or length(btrim(${table.caption})) between 1 and 500`),
]);
