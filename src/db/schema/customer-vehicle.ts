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
import { identityPrimaryKey } from "@/db/schema/common";

export const vehicleAttachmentKind = pgEnum("vehicle_attachment_kind", [
  "photo",
  "document",
  "dispute_evidence",
]);

export const customerAccountKind = pgEnum("customer_account_kind", [
  "person",
  "company",
]);

export const customerTrnRegistry = pgTable(
  "customer_trn_registry",
  {
    trn: text("trn").primaryKey(),
    ownerKind: customerAccountKind("owner_kind").notNull(),
    ownerId: bigint("owner_id", { mode: "number" }).notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_trn_registry_owner_uq").on(
      table.ownerKind,
      table.ownerId,
    ),
    check("customer_trn_registry_format", sql`${table.trn} ~ '^[0-9]{9}$'`),
    check("customer_trn_registry_owner_positive", sql`${table.ownerId} > 0`),
  ],
);

export const personalCustomers = pgTable(
  "personal_customers",
  {
    id: identityPrimaryKey(),
    customerNo: text("customer_no").notNull(),
    fullName: text("full_name").notNull(),
    normalizedPhone: text("normalized_phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    address: text("address"),
    trn: text("trn"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("personal_customers_customer_no_uq").on(table.customerNo),
    uniqueIndex("personal_customers_normalized_phone_uq").on(
      table.normalizedPhone,
    ).where(sql`${table.trn} is null`),
    uniqueIndex("personal_customers_trn_uq").on(table.trn),
    index("personal_customers_name_idx").on(table.fullName),
    check(
      "personal_customers_customer_no_format",
      sql`${table.customerNo} ~ '^CUST-[0-9]{6}-[0-9]{4}$'`,
    ),
    check(
      "personal_customers_name_nonempty",
      sql`length(btrim(${table.fullName})) > 0`,
    ),
    check(
      "personal_customers_identity_present",
      sql`${table.trn} is not null or ${table.normalizedPhone} is not null`,
    ),
    check(
      "personal_customers_phone_nonempty",
      sql`${table.normalizedPhone} is null or length(btrim(${table.normalizedPhone})) > 0`,
    ),
    check(
      "personal_customers_trn_nonempty",
      sql`${table.trn} is null or length(btrim(${table.trn})) > 0`,
    ),
    check("personal_customers_version_positive", sql`${table.version} >= 1`),
  ],
);

export const companyAccounts = pgTable(
  "company_accounts",
  {
    id: identityPrimaryKey(),
    companyNo: text("company_no").notNull(),
    legalName: text("legal_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    trn: text("trn"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("company_accounts_company_no_uq").on(table.companyNo),
    uniqueIndex("company_accounts_normalized_name_uq").on(table.normalizedName),
    uniqueIndex("company_accounts_trn_uq").on(table.trn),
    check(
      "company_accounts_company_no_format",
      sql`${table.companyNo} ~ '^COMP-[0-9]{6}-[0-9]{4}$'`,
    ),
    check(
      "company_accounts_name_nonempty",
      sql`length(btrim(${table.legalName})) > 0`,
    ),
    check(
      "company_accounts_normalized_name_nonempty",
      sql`length(btrim(${table.normalizedName})) > 0`,
    ),
    check(
      "company_accounts_trn_nonempty",
      sql`${table.trn} is null or length(btrim(${table.trn})) > 0`,
    ),
    check("company_accounts_version_positive", sql`${table.version} >= 1`),
  ],
);

export const companyContacts = pgTable(
  "company_contacts",
  {
    id: identityPrimaryKey(),
    companyId: bigint("company_id", { mode: "number" })
      .notNull()
      .references(() => companyAccounts.id, { onDelete: "restrict" }),
    personalCustomerId: bigint("personal_customer_id", { mode: "number" })
      .notNull()
      .references(() => personalCustomers.id, { onDelete: "restrict" }),
    jobTitle: text("job_title"),
    isPrimary: boolean("is_primary").notNull().default(false),
    canSign: boolean("can_sign").notNull().default(false),
    receivesInvoice: boolean("receives_invoice").notNull().default(false),
    receivesCollection: boolean("receives_collection").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("company_contacts_company_person_uq").on(
      table.companyId,
      table.personalCustomerId,
    ),
    uniqueIndex("company_contacts_one_active_primary_uq")
      .on(table.companyId)
      .where(sql`${table.isPrimary} = true and ${table.isActive} = true`),
    index("company_contacts_person_idx").on(
      table.personalCustomerId,
      table.isActive,
    ),
    check("company_contacts_version_positive", sql`${table.version} >= 1`),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: identityPrimaryKey(),
    vehicleNo: text("vehicle_no").notNull(),
    plateDisplay: text("plate_display"),
    normalizedPlate: text("normalized_plate"),
    vin: text("vin"),
    engineNumber: text("engine_number"),
    make: text("make").notNull(),
    makeZh: text("make_zh"),
    model: text("model").notNull(),
    modelZh: text("model_zh"),
    modelYear: integer("model_year"),
    color: text("color"),
    bodyType: text("body_type"),
    fuelType: text("fuel_type"),
    engineCc: integer("engine_cc"),
    seating: integer("seating"),
    usage: text("usage"),
    specialNotes: text("special_notes"),
    currentPersonCustomerId: bigint("current_person_customer_id", {
      mode: "number",
    }).references(() => personalCustomers.id, { onDelete: "restrict" }),
    currentCompanyAccountId: bigint("current_company_account_id", {
      mode: "number",
    }).references(() => companyAccounts.id, { onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("vehicles_vehicle_no_uq").on(table.vehicleNo),
    uniqueIndex("vehicles_normalized_plate_uq")
      .on(table.normalizedPlate)
      .where(sql`${table.normalizedPlate} is not null`),
    uniqueIndex("vehicles_vin_uq").on(table.vin),
    index("vehicles_person_owner_idx").on(table.currentPersonCustomerId),
    index("vehicles_company_owner_idx").on(table.currentCompanyAccountId),
    index("vehicles_make_model_idx").on(table.make, table.model),
    check(
      "vehicles_vehicle_no_format",
      sql`${table.vehicleNo} ~ '^VEH-[0-9]{6}-[0-9]{4}$'`,
    ),
    check(
      "vehicles_plate_nonempty",
      sql`(${table.plateDisplay} is null and ${table.normalizedPlate} is null)
          or (length(btrim(${table.plateDisplay})) > 0 and length(btrim(${table.normalizedPlate})) > 0)`,
    ),
    check(
      "vehicles_make_model_nonempty",
      sql`length(btrim(${table.make})) > 0 and length(btrim(${table.model})) > 0`,
    ),
    check(
      "vehicles_exactly_one_current_owner",
      sql`num_nonnulls(${table.currentPersonCustomerId}, ${table.currentCompanyAccountId}) = 1`,
    ),
    check(
      "vehicles_model_year_valid",
      sql`${table.modelYear} is null or ${table.modelYear} between 1886 and 2200`,
    ),
    check(
      "vehicles_engine_cc_valid",
      sql`${table.engineCc} is null or ${table.engineCc} between 1 and 30000`,
    ),
    check(
      "vehicles_seating_valid",
      sql`${table.seating} is null or ${table.seating} between 1 and 200`,
    ),
    check("vehicles_version_positive", sql`${table.version} >= 1`),
  ],
);

export const vehicleOwnerHistory = pgTable(
  "vehicle_owner_history",
  {
    id: identityPrimaryKey(),
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    personCustomerId: bigint("person_customer_id", { mode: "number" }).references(
      () => personalCustomers.id,
      { onDelete: "restrict" },
    ),
    companyAccountId: bigint("company_account_id", { mode: "number" }).references(
      () => companyAccounts.id,
      { onDelete: "restrict" },
    ),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: text("reason"),
    changedBy: bigint("changed_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("vehicle_owner_history_one_current_uq")
      .on(table.vehicleId)
      .where(sql`${table.endedAt} is null`),
    index("vehicle_owner_history_person_idx").on(table.personCustomerId),
    index("vehicle_owner_history_company_idx").on(table.companyAccountId),
    check(
      "vehicle_owner_history_exactly_one_owner",
      sql`num_nonnulls(${table.personCustomerId}, ${table.companyAccountId}) = 1`,
    ),
    check(
      "vehicle_owner_history_dates_valid",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const vehicleDisputes = pgTable(
  "vehicle_disputes",
  {
    id: identityPrimaryKey(),
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    openedNote: text("opened_note").notNull(),
    openedBy: bigint("opened_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedNote: text("resolved_note"),
    resolvedBy: bigint("resolved_by", { mode: "number" }).references(
      () => staffAccounts.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("vehicle_disputes_one_open_uq")
      .on(table.vehicleId)
      .where(sql`${table.resolvedAt} is null`),
    index("vehicle_disputes_opened_idx").on(table.openedAt),
    check(
      "vehicle_disputes_open_note_nonempty",
      sql`length(btrim(${table.openedNote})) > 0`,
    ),
    check(
      "vehicle_disputes_resolution_complete",
      sql`num_nonnulls(${table.resolvedAt}, ${table.resolvedNote}, ${table.resolvedBy}) in (0, 3)`,
    ),
    check(
      "vehicle_disputes_resolution_note_nonempty",
      sql`${table.resolvedNote} is null or length(btrim(${table.resolvedNote})) > 0`,
    ),
    check(
      "vehicle_disputes_dates_valid",
      sql`${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.openedAt}`,
    ),
  ],
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: identityPrimaryKey(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256Hex: text("sha256_hex").notNull(),
    uploadedBy: bigint("uploaded_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stored_files_storage_key_uq").on(table.storageKey),
    index("stored_files_sha256_idx").on(table.sha256Hex),
    check(
      "stored_files_names_nonempty",
      sql`length(btrim(${table.storageKey})) > 0 and length(btrim(${table.originalName})) > 0`,
    ),
    check(
      "stored_files_media_type_nonempty",
      sql`length(btrim(${table.mediaType})) > 0`,
    ),
    check("stored_files_size_nonnegative", sql`${table.sizeBytes} >= 0`),
    check(
      "stored_files_sha256_format",
      sql`${table.sha256Hex} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const vehicleAttachments = pgTable(
  "vehicle_attachments",
  {
    vehicleId: bigint("vehicle_id", { mode: "number" })
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    fileId: bigint("file_id", { mode: "number" })
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    kind: vehicleAttachmentKind("kind").notNull(),
    caption: text("caption"),
    linkedBy: bigint("linked_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.vehicleId, table.fileId],
      name: "vehicle_attachments_pk",
    }),
    uniqueIndex("vehicle_attachments_file_uq").on(table.fileId),
    index("vehicle_attachments_vehicle_kind_idx").on(table.vehicleId, table.kind),
  ],
);

export type PersonalCustomer = typeof personalCustomers.$inferSelect;
export type CompanyAccount = typeof companyAccounts.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
