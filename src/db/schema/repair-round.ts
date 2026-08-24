import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@/db/schema/accounts";
import {
  businessOrders,
  businessOrderStatus,
} from "@/db/schema/business-order";
import { identityPrimaryKey } from "@/db/schema/common";
import {
  storedFiles,
  vehicles,
} from "@/db/schema/customer-vehicle";
import {
  repairTeams,
  staffMembers,
} from "@/db/schema/master-data";

export const repairRoundSource = pgEnum("repair_round_source", [
  "initial",
  "after_sales",
]);

export const repairRoundEventType = pgEnum("repair_round_event_type", [
  "assigned",
  "team_responsibility_transferred",
  "accepted",
  "intake_mileage_recorded",
  "intake_photo_linked",
  "work_return_submitted",
  "work_return_rejected",
  "work_return_approved",
  "formally_handed_off",
  "formal_handoff_cancelled",
]);

export const repairRounds = pgTable(
  "repair_rounds",
  {
    id: identityPrimaryKey(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    roundNo: integer("round_no").notNull(),
    source: repairRoundSource("source").notNull().default("initial"),
    afterSalesIssue: text("after_sales_issue"),
    status: businessOrderStatus("status").notNull().default("waiting_assignment"),
    assignedTeamId: bigint("assigned_team_id", { mode: "number" }).references(
      () => repairTeams.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("repair_rounds_order_round_uq").on(
      table.businessOrderId,
      table.roundNo,
    ),
    index("repair_rounds_team_status_idx").on(table.assignedTeamId, table.status),
    check("repair_rounds_round_positive", sql`${table.roundNo} >= 1`),
    check(
      "repair_rounds_source_issue_valid",
      sql`(${table.source} = 'initial' and ${table.roundNo} = 1 and ${table.afterSalesIssue} is null)
          or (${table.source} = 'after_sales' and ${table.roundNo} >= 2
              and length(btrim(${table.afterSalesIssue})) > 0)`,
    ),
    check("repair_rounds_version_positive", sql`${table.version} >= 1`),
  ],
);

export const repairRoundWorkReturns = pgTable(
  "repair_round_work_returns",
  {
    id: identityPrimaryKey(),
    repairRoundId: bigint("repair_round_id", { mode: "number" })
      .notNull()
      .references(() => repairRounds.id, { onDelete: "restrict" }),
    submissionNo: integer("submission_no").notNull(),
    workSummary: text("work_summary").notNull(),
    actualStaffMemberId: bigint("actual_staff_member_id", { mode: "number" })
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    submittedBy: bigint("submitted_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("repair_round_work_returns_round_submission_uq").on(
      table.repairRoundId,
      table.submissionNo,
    ),
    check(
      "repair_round_work_returns_submission_positive",
      sql`${table.submissionNo} >= 1`,
    ),
    check(
      "repair_round_work_returns_summary_nonempty",
      sql`length(btrim(${table.workSummary})) > 0`,
    ),
  ],
);

export const repairRoundEvents = pgTable(
  "repair_round_events",
  {
    id: identityPrimaryKey(),
    repairRoundId: bigint("repair_round_id", { mode: "number" })
      .notNull()
      .references(() => repairRounds.id, { onDelete: "restrict" }),
    eventType: repairRoundEventType("event_type").notNull(),
    teamId: bigint("team_id", { mode: "number" }).references(
      () => repairTeams.id,
      { onDelete: "restrict" },
    ),
    workReturnId: bigint("work_return_id", { mode: "number" }).references(
      () => repairRoundWorkReturns.id,
      { onDelete: "restrict" },
    ),
    formalHandoffId: bigint("formal_handoff_id", { mode: "number" }),
    customerConfirmedWithoutPayment: boolean("customer_confirmed_without_payment"),
    note: text("note"),
    actorAccountId: bigint("actor_account_id", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("repair_round_events_round_time_idx").on(
      table.repairRoundId,
      table.occurredAt,
    ),
    check(
      "repair_round_events_assignment_complete",
      sql`${table.eventType} not in ('assigned', 'team_responsibility_transferred')
          or (${table.teamId} is not null
              and (${table.eventType} <> 'assigned'
                   or ${table.customerConfirmedWithoutPayment} = true))`,
    ),
    check(
      "repair_round_events_work_return_link",
      sql`${table.eventType} not in ('work_return_submitted', 'work_return_rejected', 'work_return_approved')
          or ${table.workReturnId} is not null`,
    ),
    check(
      "repair_round_events_rejection_reason",
      sql`${table.eventType} <> 'work_return_rejected'
          or length(btrim(${table.note})) > 0`,
    ),
    check(
      "repair_round_events_formal_handoff_link",
      sql`(${table.eventType} in ('formally_handed_off', 'formal_handoff_cancelled')
           and ${table.formalHandoffId} is not null)
          or (${table.eventType} not in ('formally_handed_off', 'formal_handoff_cancelled')
              and ${table.formalHandoffId} is null)`,
    ),
  ],
);

export const vehicleMileageRecords = pgTable(
  "vehicle_mileage_records",
  {
    id: identityPrimaryKey(),
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    businessOrderId: bigint("business_order_id", { mode: "number" }).references(
      () => businessOrders.id,
      { onDelete: "restrict" },
    ),
    repairRoundId: bigint("repair_round_id", { mode: "number" }).references(
      () => repairRounds.id,
      { onDelete: "restrict" },
    ),
    odometerKm: integer("odometer_km").notNull(),
    recordedBy: bigint("recorded_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("vehicle_mileage_records_round_uq")
      .on(table.repairRoundId)
      .where(sql`${table.repairRoundId} is not null`),
    index("vehicle_mileage_records_vehicle_time_idx").on(
      table.vehicleId,
      table.recordedAt,
    ),
    check(
      "vehicle_mileage_records_odometer_nonnegative",
      sql`${table.odometerKm} >= 0`,
    ),
    check(
      "vehicle_mileage_records_round_has_order",
      sql`${table.repairRoundId} is null or ${table.businessOrderId} is not null`,
    ),
  ],
);

export const repairRoundIntakePhotos = pgTable(
  "repair_round_intake_photos",
  {
    repairRoundId: bigint("repair_round_id", { mode: "number" })
      .notNull()
      .references(() => repairRounds.id, { onDelete: "restrict" }),
    fileId: bigint("file_id", { mode: "number" })
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    linkedBy: bigint("linked_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.repairRoundId, table.fileId],
      name: "repair_round_intake_photos_pk",
    }),
    index("repair_round_intake_photos_file_idx").on(table.fileId),
  ],
);

export type RepairRound = typeof repairRounds.$inferSelect;
