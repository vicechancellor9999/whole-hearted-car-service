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
import { staffAccounts } from "@/db/schema/accounts";
import {
  businessOrderChargeVersions,
  businessOrders,
} from "@/db/schema/business-order";
import { identityPrimaryKey } from "@/db/schema/common";
import type { ReceiptRenderSnapshot } from "@/db/schema/payment";
import { repairRounds } from "@/db/schema/repair-round";

type OfficeArchiveRenderSnapshot = {
  version: 1;
  kind: "office_archive";
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
  | OfficeArchiveRenderSnapshot
  | MechanicWorkRenderSnapshot;

export const businessOrderDocumentKind = pgEnum(
  "business_order_document_kind",
  ["office_archive", "mechanic_work"],
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
      sql`(${table.kind} = 'office_archive'
            and ${table.documentNo} ~ '^OFF-[0-9]{8}-[0-9]{4}$')
          or (${table.kind} = 'mechanic_work'
            and ${table.documentNo} ~ '^MEC-[0-9]{8}-[0-9]{4}$')`,
    ),
    check(
      "business_order_document_snapshots_source_shape",
      sql`(${table.kind} = 'office_archive'
            and ${table.repairRoundId} is null
            and ${table.repairRoundNo} is null)
          or (${table.kind} = 'mechanic_work'
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

export type BusinessOrderDocumentSnapshot =
  typeof businessOrderDocumentSnapshots.$inferSelect;
