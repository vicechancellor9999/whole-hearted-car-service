import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
      sql`${table.rootKind} in ('personal_customer', 'company_customer', 'vehicle', 'business_order', 'inspection_report', 'repair_round')`,
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

export const recordDeletionAuthorizedRows = pgTable(
  "record_deletion_authorized_rows",
  {
    requestId: text("request_id")
      .notNull()
      .references(() => recordDeletionReceipts.requestId, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    rowKey: text("row_key").notNull(),
  },
  (table) => [
    primaryKey({
      name: "record_deletion_authorized_rows_pk",
      columns: [table.requestId, table.tableName, table.rowKey],
    }),
    check(
      "record_deletion_authorized_rows_table_valid",
      sql`${table.tableName} in (
        'personal_customers',
        'company_accounts',
        'company_contacts',
        'vehicles',
        'vehicle_owner_history',
        'vehicle_attachments',
        'stored_files',
        'customer_driver_license_records',
        'business_orders',
        'repair_rounds',
        'repair_round_events',
        'repair_round_work_returns',
        'vehicle_mileage_records',
        'repair_round_intake_photos',
        'formal_handoffs',
        'formal_handoff_cancellations',
        'business_order_charge_items',
        'business_order_notes',
        'business_order_charge_versions',
        'business_order_messages',
        'business_order_message_mentions',
        'business_order_message_revisions',
        'business_order_attachments',
        'business_order_problem_originals',
        'business_order_problem_versions',
        'repair_round_problem_versions',
        'inspection_reports',
        'inspection_report_workspace_versions',
        'inspection_report_findings'
      )`,
    ),
    check(
      "record_deletion_authorized_rows_key_nonempty",
      sql`length(btrim(${table.rowKey})) > 0`,
    ),
  ],
);

export type RecordDeletionReceipt = typeof recordDeletionReceipts.$inferSelect;
export type RecordDeletionFileTask = typeof recordDeletionFileTasks.$inferSelect;
export type RecordDeletionAuthorizedRow =
  typeof recordDeletionAuthorizedRows.$inferSelect;
