import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import { identityPrimaryKey } from "@formal/db/schema/common";
import {
  companyAccounts,
  companyContacts,
  personalCustomers,
  vehicles,
} from "@formal/db/schema/customer-vehicle";
import { dictionaryItems } from "@formal/db/schema/master-data";

export const businessOrderStatus = pgEnum("business_order_status", [
  "waiting_assignment",
  "assigned",
  "in_repair",
  "return_pending_review",
  "formally_handed_off",
]);

export const businessOrderCategory = pgEnum("business_order_category", [
  "maintenance",
  "repair",
  "inspection",
]);

export const chargeItemKind = pgEnum("charge_item_kind", [
  "labor",
  "part",
  "other",
]);

export const businessOrderNoteKind = pgEnum("business_order_note_kind", [
  "customer_concern",
  "work_instruction",
  "liability_notice",
  "internal",
]);

export const businessOrders = pgTable(
  "business_orders",
  {
    id: identityPrimaryKey(),
    orderNo: text("order_no").notNull(),
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    payerPersonCustomerId: bigint("payer_person_customer_id", {
      mode: "number",
    }).references(() => personalCustomers.id, { onDelete: "restrict" }),
    payerCompanyAccountId: bigint("payer_company_account_id", {
      mode: "number",
    }).references(() => companyAccounts.id, { onDelete: "restrict" }),
    payerCompanyContactId: bigint("payer_company_contact_id", {
      mode: "number",
    }).references(() => companyContacts.id, { onDelete: "restrict" }),
    payerDisplayNameSnapshot: text("payer_display_name_snapshot").notNull(),
    payerPhoneSnapshot: text("payer_phone_snapshot"),
    payerTrnSnapshot: text("payer_trn_snapshot"),
    payerContactNameSnapshot: text("payer_contact_name_snapshot"),
    vehiclePlateSnapshot: text("vehicle_plate_snapshot").notNull(),
    vehicleDescriptionSnapshot: text("vehicle_description_snapshot").notNull(),
    vehicleVinSnapshot: text("vehicle_vin_snapshot"),
    status: businessOrderStatus("status").notNull().default("waiting_assignment"),
    currentChargeVersionNo: integer("current_charge_version_no")
      .notNull()
      .default(0),
    currentRepairRoundNo: integer("current_repair_round_no")
      .notNull()
      .default(1),
    currentProblemDescriptionVersionNo: integer(
      "current_problem_description_version_no",
    )
      .notNull()
      .default(0),
    categories: businessOrderCategory("categories")
      .array()
      .notNull()
      .default(sql`'{}'::business_order_category[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: bigint("voided_by", { mode: "number" }).references(
      () => staffAccounts.id,
      { onDelete: "restrict" },
    ),
    voidReason: text("void_reason"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("business_orders_order_no_uq").on(table.orderNo),
    index("business_orders_vehicle_created_idx").on(
      table.vehicleId,
      table.createdAt,
    ),
    index("business_orders_status_created_idx").on(table.status, table.createdAt),
    index("business_orders_person_payer_idx").on(table.payerPersonCustomerId),
    index("business_orders_company_payer_idx").on(table.payerCompanyAccountId),
    check(
      "business_orders_order_no_format",
      sql`${table.orderNo} ~ '^KGN-WH-[0-9]{13}$'`,
    ),
    check(
      "business_orders_exactly_one_payer",
      sql`num_nonnulls(${table.payerPersonCustomerId}, ${table.payerCompanyAccountId}) = 1`,
    ),
    check(
      "business_orders_company_contact_required",
      sql`(${table.payerCompanyAccountId} is not null and ${table.payerCompanyContactId} is not null)
          or (${table.payerCompanyAccountId} is null and ${table.payerCompanyContactId} is null)`,
    ),
    check(
      "business_orders_snapshots_nonempty",
      sql`length(btrim(${table.payerDisplayNameSnapshot})) > 0
          and length(btrim(${table.vehiclePlateSnapshot})) > 0
          and length(btrim(${table.vehicleDescriptionSnapshot})) > 0`,
    ),
    check(
      "business_orders_current_charge_version_nonnegative",
      sql`${table.currentChargeVersionNo} >= 0`,
    ),
    check(
      "business_orders_current_repair_round_positive",
      sql`${table.currentRepairRoundNo} >= 1`,
    ),
    check(
      "business_orders_current_problem_description_version_nonnegative",
      sql`${table.currentProblemDescriptionVersionNo} >= 0`,
    ),
    check("business_orders_version_positive", sql`${table.version} >= 1`),
    check(
      "business_orders_void_complete",
      sql`num_nonnulls(${table.voidedAt}, ${table.voidedBy}, ${table.voidReason}) in (0, 3)`,
    ),
    check(
      "business_orders_void_reason_nonempty",
      sql`${table.voidReason} is null or length(btrim(${table.voidReason})) > 0`,
    ),
  ],
);

export const businessOrderChargeVersions = pgTable(
  "business_order_charge_versions",
  {
    id: identityPrimaryKey(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    changeReason: text("change_reason").notNull(),
    laborDiscountMinor: bigint("labor_discount_minor", { mode: "number" })
      .notNull()
      .default(0),
    partDiscountMinor: bigint("part_discount_minor", { mode: "number" })
      .notNull()
      .default(0),
    otherDiscountMinor: bigint("other_discount_minor", { mode: "number" })
      .notNull()
      .default(0),
    wholeOrderDiscountMinor: bigint("whole_order_discount_minor", {
      mode: "number",
    })
      .notNull()
      .default(0),
    grossMinor: bigint("gross_minor", { mode: "number" }).notNull(),
    lineDiscountMinor: bigint("line_discount_minor", { mode: "number" })
      .notNull(),
    categoryDiscountMinor: bigint("category_discount_minor", {
      mode: "number",
    }).notNull(),
    totalDueMinor: bigint("total_due_minor", { mode: "number" }).notNull(),
    includedGctMinor: bigint("included_gct_minor", { mode: "number" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("business_order_charge_versions_order_version_uq").on(
      table.businessOrderId,
      table.versionNo,
    ),
    index("business_order_charge_versions_created_idx").on(table.createdAt),
    check(
      "business_order_charge_versions_version_positive",
      sql`${table.versionNo} >= 1`,
    ),
    check(
      "business_order_charge_versions_reason_nonempty",
      sql`length(btrim(${table.changeReason})) > 0`,
    ),
    check(
      "business_order_charge_versions_amounts_nonnegative",
      sql`${table.laborDiscountMinor} >= 0
          and ${table.partDiscountMinor} >= 0
          and ${table.otherDiscountMinor} >= 0
          and ${table.wholeOrderDiscountMinor} >= 0
          and ${table.grossMinor} >= 0
          and ${table.lineDiscountMinor} >= 0
          and ${table.categoryDiscountMinor} >= 0
          and ${table.totalDueMinor} >= 0
          and ${table.includedGctMinor} >= 0`,
    ),
    check(
      "business_order_charge_versions_category_discount_total",
      sql`${table.categoryDiscountMinor} = ${table.laborDiscountMinor}
          + ${table.partDiscountMinor} + ${table.otherDiscountMinor}`,
    ),
    check(
      "business_order_charge_versions_amount_conservation",
      sql`${table.totalDueMinor} = ${table.grossMinor} - ${table.lineDiscountMinor}
          - ${table.categoryDiscountMinor} - ${table.wholeOrderDiscountMinor}`,
    ),
    check(
      "business_order_charge_versions_gct_within_total",
      sql`${table.includedGctMinor} <= ${table.totalDueMinor}`,
    ),
  ],
);

export const businessOrderChargeItems = pgTable(
  "business_order_charge_items",
  {
    id: identityPrimaryKey(),
    chargeVersionId: bigint("charge_version_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderChargeVersions.id, {
        onDelete: "restrict",
      }),
    kind: chargeItemKind("kind").notNull(),
    nameZh: text("name_zh").notNull(),
    nameEn: text("name_en"),
    descriptionZh: text("description_zh"),
    descriptionEn: text("description_en"),
    unitItemId: bigint("unit_item_id", { mode: "number" })
      .notNull()
      .references(() => dictionaryItems.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    pendingQuote: boolean("pending_quote").notNull().default(false),
    itemDiscountMinor: bigint("item_discount_minor", { mode: "number" })
      .notNull()
      .default(0),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("business_order_charge_items_version_sort_uq").on(
      table.chargeVersionId,
      table.sortOrder,
    ),
    index("business_order_charge_items_kind_idx").on(
      table.chargeVersionId,
      table.kind,
    ),
    check(
      "business_order_charge_items_name_nonempty",
      sql`length(btrim(${table.nameZh})) > 0`,
    ),
    check(
      "business_order_charge_items_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
    check(
      "business_order_charge_items_amounts_nonnegative",
      sql`${table.unitPriceMinor} >= 0
          and ${table.itemDiscountMinor} >= 0
          and ${table.subtotalMinor} >= 0`,
    ),
    check(
      "business_order_charge_items_amount_conservation",
      sql`${table.subtotalMinor} = round(${table.quantity} * ${table.unitPriceMinor}) - ${table.itemDiscountMinor}`,
    ),
    check(
      "business_order_charge_items_pending_amounts_zero",
      sql`not ${table.pendingQuote} or (${table.unitPriceMinor} = 0 and ${table.itemDiscountMinor} = 0 and ${table.subtotalMinor} = 0)`,
    ),
    check(
      "business_order_charge_items_sort_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const businessOrderNotes = pgTable(
  "business_order_notes",
  {
    id: identityPrimaryKey(),
    chargeVersionId: bigint("charge_version_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderChargeVersions.id, {
        onDelete: "restrict",
      }),
    kind: businessOrderNoteKind("kind").notNull(),
    contentZh: text("content_zh"),
    contentEn: text("content_en"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("business_order_notes_version_sort_uq").on(
      table.chargeVersionId,
      table.sortOrder,
    ),
    index("business_order_notes_kind_idx").on(table.chargeVersionId, table.kind),
    check(
      "business_order_notes_content_present",
      sql`coalesce(length(btrim(${table.contentZh})), 0)
          + coalesce(length(btrim(${table.contentEn})), 0) > 0`,
    ),
    check(
      "business_order_notes_sort_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export type BusinessOrder = typeof businessOrders.$inferSelect;
export type BusinessOrderChargeVersion =
  typeof businessOrderChargeVersions.$inferSelect;
export type BusinessOrderChargeItem = typeof businessOrderChargeItems.$inferSelect;
