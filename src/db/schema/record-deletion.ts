import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import { identityPrimaryKey } from "@formal/db/schema/common";
import type { RecordDeletionResult } from "@formal/modules/record-deletion/record-deletion-types";

export const recordDeletionReceipts = pgTable(
  "record_deletion_receipts",
  {
    requestId: text("request_id").primaryKey(),
    actorAccountId: bigint("actor_account_id", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    payloadHash: text("payload_hash").notNull(),
    rootKind: text("root_kind").notNull(),
    rootRecordNo: text("root_record_no").notNull(),
    reasonCode: text("reason_code").notNull(),
    result: jsonb("result").$type<RecordDeletionResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("record_deletion_receipts_actor_created_idx").on(
      table.actorAccountId,
      table.createdAt,
    ),
    check(
      "record_deletion_receipts_request_nonempty",
      sql`length(btrim(${table.requestId})) > 0`,
    ),
    check(
      "record_deletion_receipts_payload_hash_format",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "record_deletion_receipts_root_kind_valid",
      sql`${table.rootKind} in ('personal_customer', 'company_customer', 'vehicle', 'business_order', 'inspection_report')`,
    ),
    check(
      "record_deletion_receipts_root_record_nonempty",
      sql`length(btrim(${table.rootRecordNo})) > 0`,
    ),
    check(
      "record_deletion_receipts_reason_valid",
      sql`${table.reasonCode} in ('duplicate', 'input_error', 'test_data', 'other')`,
    ),
  ],
);

export const recordDeletionFileTasks = pgTable(
  "record_deletion_file_tasks",
  {
    id: identityPrimaryKey(),
    storageKey: text("storage_key").notNull(),
    state: text("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("record_deletion_file_tasks_incomplete_storage_uq")
      .on(table.storageKey)
      .where(sql`${table.state} <> 'completed'`),
    index("record_deletion_file_tasks_state_created_idx").on(
      table.state,
      table.createdAt,
    ),
    check(
      "record_deletion_file_tasks_storage_nonempty",
      sql`length(btrim(${table.storageKey})) > 0`,
    ),
    check(
      "record_deletion_file_tasks_state_valid",
      sql`${table.state} in ('pending', 'failed', 'completed')`,
    ),
    check(
      "record_deletion_file_tasks_attempt_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "record_deletion_file_tasks_completion_complete",
      sql`(${table.state} = 'completed' and ${table.completedAt} is not null)
          or (${table.state} <> 'completed' and ${table.completedAt} is null)`,
    ),
    check(
      "record_deletion_file_tasks_error_complete",
      sql`(${table.state} = 'failed' and length(btrim(${table.lastErrorCode})) > 0)
          or (${table.state} <> 'failed' and ${table.lastErrorCode} is null)`,
    ),
  ],
);

export type RecordDeletionReceipt = typeof recordDeletionReceipts.$inferSelect;
export type RecordDeletionFileTask = typeof recordDeletionFileTasks.$inferSelect;
