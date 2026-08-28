import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { storedFiles } from "@formal/db/schema/customer-vehicle";
import { staffAccounts } from "@formal/db/schema/accounts";
import {
  businessOrderChargeVersions,
  businessOrders,
} from "@formal/db/schema/business-order";
import { identityPrimaryKey } from "@formal/db/schema/common";
import type { ReceiptRenderSnapshot } from "@formal/db/schema/payment";
import { repairRounds } from "@formal/db/schema/repair-round";

type OfficeArchiveRenderSnapshot = {
  version: 1;
  kind: "office_archive";
  presentation?: "office_english_primary_v1";
  businessOrder: ReceiptRenderSnapshot["businessOrder"];
  charges: ReceiptRenderSnapshot["charges"];
  transactions: ReceiptRenderSnapshot["transactions"];
  totals: {
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
    balanceMinor: number;
  };
  approval: {
    statementZh: string;
    statementEn: string;
  };
};

type CustomerCopyRenderSnapshot = {
  version: 1;
  kind: "customer_copy";
  businessOrder: ReceiptRenderSnapshot["businessOrder"];
  charges: ReceiptRenderSnapshot["charges"];
  transactions: ReceiptRenderSnapshot["transactions"];
  totals: {
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
    balanceMinor: number;
  };
  approval: {
    statementZh: string;
    statementEn: string;
  };
};

type MechanicWorkRenderSnapshot = {
  version: 1;
  kind: "mechanic_work";
  businessOrder: {
    id: number;
    orderNo: string;
  };
  vehicle: {
    plate: string;
    description: string;
    vin: string | null;
  };
  repairRound: {
    id: number;
    roundNo: number;
    teamName: string | null;
  };
  workItems: Array<{
    kind: "labor" | "part" | "other";
    nameZh: string;
    descriptionZh: string | null;
    unitLabelZh: string;
    quantity: string;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice";
    contentZh: string;
  }>;
};

export type BusinessOrderDocumentRenderSnapshot =
  | CustomerCopyRenderSnapshot
  | OfficeArchiveRenderSnapshot
  | MechanicWorkRenderSnapshot;

export const businessOrderDocumentKind = pgEnum(
  "business_order_document_kind",
  ["customer_copy", "office_archive", "mechanic_work"],
);

export const businessOrderDocumentSnapshots = pgTable(
  "business_order_document_snapshots",
  {
    id: identityPrimaryKey(),
    documentNo: text("document_no").notNull(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    kind: businessOrderDocumentKind("kind").notNull(),
    chargeVersionId: bigint("charge_version_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderChargeVersions.id, { onDelete: "restrict" }),
    chargeVersionNo: integer("charge_version_no").notNull(),
    repairRoundId: bigint("repair_round_id", { mode: "number" }).references(
      () => repairRounds.id,
      { onDelete: "restrict" },
    ),
    repairRoundNo: integer("repair_round_no"),
    renderSnapshot: jsonb("render_snapshot")
      .$type<BusinessOrderDocumentRenderSnapshot>()
      .notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    generatedBy: bigint("generated_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("business_order_document_snapshots_no_uq").on(table.documentNo),
    index("business_order_document_snapshots_order_time_idx").on(
      table.businessOrderId,
      table.generatedAt,
    ),
    index("business_order_document_snapshots_round_idx").on(table.repairRoundId),
    check(
      "business_order_document_snapshots_no_kind",
      sql`(${table.kind}::text = 'customer_copy'
            and ${table.documentNo} ~ '^CUS-[0-9]{8}-[0-9]{4}$')
          or (${table.kind}::text = 'office_archive'
            and ${table.documentNo} ~ '^OFF-[0-9]{8}-[0-9]{4}$')
          or (${table.kind}::text = 'mechanic_work'
            and ${table.documentNo} ~ '^MEC-[0-9]{8}-[0-9]{4}$')`,
    ),
    check(
      "business_order_document_snapshots_source_shape",
      sql`(${table.kind}::text in ('customer_copy', 'office_archive')
            and ${table.repairRoundId} is null
            and ${table.repairRoundNo} is null)
          or (${table.kind}::text = 'mechanic_work'
            and ${table.repairRoundId} is not null
            and ${table.repairRoundNo} >= 1)`,
    ),
    check(
      "business_order_document_snapshots_charge_version_positive",
      sql`${table.chargeVersionNo} >= 1`,
    ),
    check(
      "business_order_document_snapshots_snapshot_object",
      sql`jsonb_typeof(${table.renderSnapshot}) = 'object'
          and ${table.renderSnapshot}->>'version' = '1'
          and ${table.renderSnapshot}->>'kind' = ${table.kind}::text`,
    ),
  ],
);

export const businessOrderDocumentRevisions = pgTable(
  "business_order_document_revisions",
  {
    id: identityPrimaryKey(),
    documentSnapshotId: bigint("document_snapshot_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderDocumentSnapshots.id, { onDelete: "restrict" }),
    revisionNo: integer("revision_no").notNull(),
    fieldOverrides: jsonb("field_overrides").$type<Record<string, string>>().notNull().default({}),
    rendererVersion: text("renderer_version").notNull(),
    fileId: bigint("file_id", { mode: "number" })
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    contentSha256: text("content_sha256").notNull(),
    englishFileId: bigint("english_file_id", { mode: "number" })
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    englishContentSha256: text("english_content_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("business_order_document_revisions_snapshot_no_uq").on(table.documentSnapshotId, table.revisionNo),
    uniqueIndex("business_order_document_revisions_file_uq").on(table.fileId),
    uniqueIndex("business_order_document_revisions_english_file_uq")
      .on(table.englishFileId)
      .where(sql`${table.englishFileId} is not null`),
    index("business_order_document_revisions_snapshot_time_idx").on(table.documentSnapshotId, table.createdAt, table.id),
    check("business_order_document_revisions_revision_positive", sql`${table.revisionNo} >= 1`),
    check("business_order_document_revisions_overrides_object", sql`jsonb_typeof(${table.fieldOverrides}) = 'object'`),
    check("business_order_document_revisions_renderer_nonempty", sql`length(btrim(${table.rendererVersion})) > 0`),
    check("business_order_document_revisions_sha256_format", sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("business_order_document_revisions_english_pair", sql`(${table.englishFileId} is null) = (${table.englishContentSha256} is null)`),
    check("business_order_document_revisions_english_sha256_format", sql`${table.englishContentSha256} is null or ${table.englishContentSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type BusinessOrderDocumentSnapshot =
  typeof businessOrderDocumentSnapshots.$inferSelect;
export type BusinessOrderDocumentRevision =
  typeof businessOrderDocumentRevisions.$inferSelect;
