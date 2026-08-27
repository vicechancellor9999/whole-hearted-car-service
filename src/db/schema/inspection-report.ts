import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { staffAccounts } from "@/db/schema/accounts";
import { businessOrders } from "@/db/schema/business-order";
import { identityPrimaryKey } from "@/db/schema/common";
import { storedFiles, vehicles } from "@/db/schema/customer-vehicle";
import { staffMembers } from "@/db/schema/master-data";
import { repairRounds } from "@/db/schema/repair-round";

export const inspectionReportStatus = pgEnum("inspection_report_status", [
  "draft",
  "submitted",
]);

export const inspectionReportCommunicationChannel = pgEnum(
  "inspection_report_communication_channel",
  ["sms", "email", "whatsapp"],
);

export const inspectionReportCommunicationStatus = pgEnum(
  "inspection_report_communication_status",
  ["initiated", "confirmed", "not_delivered"],
);

export const inspectionReports = pgTable(
  "inspection_reports",
  {
    id: identityPrimaryKey(),
    reportNo: text("report_no").notNull(),
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    sourceBusinessOrderId: bigint("source_business_order_id", { mode: "number" })
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    sourceRepairRoundId: bigint("source_repair_round_id", { mode: "number" })
      .references(() => repairRounds.id, { onDelete: "restrict" }),
    correctionOfReportId: bigint("correction_of_report_id", { mode: "number" })
      .references((): AnyPgColumn => inspectionReports.id, { onDelete: "restrict" }),
    correctionReason: text("correction_reason"),
    summaryZh: text("summary_zh").notNull(),
    summaryEn: text("summary_en"),
    actualInspectorStaffMemberId: bigint("actual_inspector_staff_member_id", {
      mode: "number",
    }).notNull().references(() => staffMembers.id, { onDelete: "restrict" }),
    paperPhotoFileId: bigint("paper_photo_file_id", { mode: "number" })
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    status: inspectionReportStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: bigint("submitted_by", { mode: "number" })
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("inspection_reports_report_no_uq").on(table.reportNo),
    index("inspection_reports_vehicle_created_idx").on(
      table.vehicleId,
      table.createdAt,
    ),
    index("inspection_reports_source_order_idx").on(table.sourceBusinessOrderId),
    index("inspection_reports_source_round_idx").on(table.sourceRepairRoundId),
    uniqueIndex("inspection_reports_correction_idx")
      .on(table.correctionOfReportId)
      .where(sql`${table.correctionOfReportId} is not null`),
    check(
      "inspection_reports_number_format",
      sql`${table.reportNo} ~ '^IR-[0-9]{8}-[0-9]{4}$'`,
    ),
    check(
      "inspection_reports_summary_nonempty",
      sql`length(btrim(${table.summaryZh})) > 0`,
    ),
    check(
      "inspection_reports_correction_complete",
      sql`(${table.correctionOfReportId} is null and ${table.correctionReason} is null)
          or (${table.correctionOfReportId} is not null
              and length(btrim(${table.correctionReason})) > 0)`,
    ),
    check(
      "inspection_reports_submission_complete",
      sql`(${table.status} = 'draft'
            and ${table.submittedAt} is null and ${table.submittedBy} is null)
          or (${table.status} = 'submitted'
            and ${table.submittedAt} is not null
            and ${table.submittedBy} is not null
            and ${table.actualInspectorStaffMemberId} is not null)`,
    ),
    check("inspection_reports_version_positive", sql`${table.version} >= 1`),
  ],
);

export const inspectionReportFindings = pgTable(
  "inspection_report_findings",
  {
    id: identityPrimaryKey(),
    inspectionReportId: bigint("inspection_report_id", { mode: "number" })
      .notNull()
      .references(() => inspectionReports.id, { onDelete: "restrict" }),
    findingZh: text("finding_zh").notNull(),
    findingEn: text("finding_en"),
    recommendationZh: text("recommendation_zh"),
    recommendationEn: text("recommendation_en"),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("inspection_report_findings_report_sort_uq").on(
      table.inspectionReportId,
      table.sortOrder,
    ),
    check(
      "inspection_report_findings_text_nonempty",
      sql`length(btrim(${table.findingZh})) > 0`,
    ),
    check(
      "inspection_report_findings_sort_positive",
      sql`${table.sortOrder} >= 1`,
    ),
  ],
);

/** Immutable customer-contact facts. An external link only creates `initiated`; it never claims delivery. */
export const inspectionReportCommunications = pgTable(
  "inspection_report_communications",
  {
    id: identityPrimaryKey(),
    inspectionReportId: bigint("inspection_report_id", { mode: "number" })
      .notNull()
      .references(() => inspectionReports.id, { onDelete: "restrict" }),
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    sourceBusinessOrderId: bigint("source_business_order_id", { mode: "number" })
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    channel: inspectionReportCommunicationChannel("channel").notNull(),
    targetContact: text("target_contact").notNull(),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }).notNull(),
    initiatedBy: bigint("initiated_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    status: inspectionReportCommunicationStatus("status").notNull().default("initiated"),
    noteOrReply: text("note_or_reply"),
  },
  (table) => [
    index("inspection_report_communications_report_time_idx").on(
      table.inspectionReportId,
      table.initiatedAt,
    ),
    index("inspection_report_communications_vehicle_time_idx").on(
      table.vehicleId,
      table.initiatedAt,
    ),
    check(
      "inspection_report_communications_target_nonempty",
      sql`length(btrim(${table.targetContact})) > 0`,
    ),
    check(
      "inspection_report_communications_note_nonempty",
      sql`${table.noteOrReply} is null or length(btrim(${table.noteOrReply})) > 0`,
    ),
  ],
);

export type InspectionReport = typeof inspectionReports.$inferSelect;
