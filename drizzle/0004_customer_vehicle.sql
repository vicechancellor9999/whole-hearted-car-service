CREATE TYPE "public"."vehicle_attachment_kind" AS ENUM('photo', 'document', 'dispute_evidence');--> statement-breakpoint
CREATE TABLE "company_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_no" text NOT NULL,
	"legal_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"trn" text,
	"phone" text,
	"email" text,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "company_accounts_company_no_format" CHECK ("company_accounts"."company_no" ~ '^COMP-[0-9]{6}-[0-9]{4}$'),
	CONSTRAINT "company_accounts_name_nonempty" CHECK (length(btrim("company_accounts"."legal_name")) > 0),
	CONSTRAINT "company_accounts_normalized_name_nonempty" CHECK (length(btrim("company_accounts"."normalized_name")) > 0),
	CONSTRAINT "company_accounts_trn_nonempty" CHECK ("company_accounts"."trn" is null or length(btrim("company_accounts"."trn")) > 0),
	CONSTRAINT "company_accounts_version_positive" CHECK ("company_accounts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" bigint NOT NULL,
	"personal_customer_id" bigint NOT NULL,
	"job_title" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"can_sign" boolean DEFAULT false NOT NULL,
	"receives_invoice" boolean DEFAULT false NOT NULL,
	"receives_collection" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "company_contacts_version_positive" CHECK ("company_contacts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "personal_customers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "personal_customers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_no" text NOT NULL,
	"full_name" text NOT NULL,
	"normalized_phone" text,
	"whatsapp" text,
	"email" text,
	"address" text,
	"trn" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "personal_customers_customer_no_format" CHECK ("personal_customers"."customer_no" ~ '^CUST-[0-9]{6}-[0-9]{4}$'),
	CONSTRAINT "personal_customers_name_nonempty" CHECK (length(btrim("personal_customers"."full_name")) > 0),
	CONSTRAINT "personal_customers_identity_present" CHECK ("personal_customers"."trn" is not null or "personal_customers"."normalized_phone" is not null),
	CONSTRAINT "personal_customers_phone_nonempty" CHECK ("personal_customers"."normalized_phone" is null or length(btrim("personal_customers"."normalized_phone")) > 0),
	CONSTRAINT "personal_customers_trn_nonempty" CHECK ("personal_customers"."trn" is null or length(btrim("personal_customers"."trn")) > 0),
	CONSTRAINT "personal_customers_version_positive" CHECK ("personal_customers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stored_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256_hex" text NOT NULL,
	"uploaded_by" bigint NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_names_nonempty" CHECK (length(btrim("stored_files"."storage_key")) > 0 and length(btrim("stored_files"."original_name")) > 0),
	CONSTRAINT "stored_files_media_type_nonempty" CHECK (length(btrim("stored_files"."media_type")) > 0),
	CONSTRAINT "stored_files_size_nonnegative" CHECK ("stored_files"."size_bytes" >= 0),
	CONSTRAINT "stored_files_sha256_format" CHECK ("stored_files"."sha256_hex" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "vehicle_attachments" (
	"vehicle_id" bigint NOT NULL,
	"file_id" bigint NOT NULL,
	"kind" "vehicle_attachment_kind" NOT NULL,
	"caption" text,
	"linked_by" bigint NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_attachments_pk" PRIMARY KEY("vehicle_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_disputes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_disputes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_note" text NOT NULL,
	"opened_by" bigint NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_note" text,
	"resolved_by" bigint,
	CONSTRAINT "vehicle_disputes_open_note_nonempty" CHECK (length(btrim("vehicle_disputes"."opened_note")) > 0),
	CONSTRAINT "vehicle_disputes_resolution_complete" CHECK (num_nonnulls("vehicle_disputes"."resolved_at", "vehicle_disputes"."resolved_note", "vehicle_disputes"."resolved_by") in (0, 3)),
	CONSTRAINT "vehicle_disputes_resolution_note_nonempty" CHECK ("vehicle_disputes"."resolved_note" is null or length(btrim("vehicle_disputes"."resolved_note")) > 0),
	CONSTRAINT "vehicle_disputes_dates_valid" CHECK ("vehicle_disputes"."resolved_at" is null or "vehicle_disputes"."resolved_at" >= "vehicle_disputes"."opened_at")
);
--> statement-breakpoint
CREATE TABLE "vehicle_owner_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_owner_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint NOT NULL,
	"person_customer_id" bigint,
	"company_account_id" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text,
	"changed_by" bigint NOT NULL,
	CONSTRAINT "vehicle_owner_history_exactly_one_owner" CHECK (num_nonnulls("vehicle_owner_history"."person_customer_id", "vehicle_owner_history"."company_account_id") = 1),
	CONSTRAINT "vehicle_owner_history_dates_valid" CHECK ("vehicle_owner_history"."ended_at" is null or "vehicle_owner_history"."ended_at" >= "vehicle_owner_history"."started_at")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_no" text NOT NULL,
	"plate_display" text NOT NULL,
	"normalized_plate" text NOT NULL,
	"vin" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"model_year" integer,
	"color" text,
	"current_person_customer_id" bigint,
	"current_company_account_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "vehicles_vehicle_no_format" CHECK ("vehicles"."vehicle_no" ~ '^VEH-[0-9]{6}-[0-9]{4}$'),
	CONSTRAINT "vehicles_plate_nonempty" CHECK (length(btrim("vehicles"."plate_display")) > 0 and length(btrim("vehicles"."normalized_plate")) > 0),
	CONSTRAINT "vehicles_make_model_nonempty" CHECK (length(btrim("vehicles"."make")) > 0 and length(btrim("vehicles"."model")) > 0),
	CONSTRAINT "vehicles_exactly_one_current_owner" CHECK (num_nonnulls("vehicles"."current_person_customer_id", "vehicles"."current_company_account_id") = 1),
	CONSTRAINT "vehicles_model_year_valid" CHECK ("vehicles"."model_year" is null or "vehicles"."model_year" between 1886 and 2200),
	CONSTRAINT "vehicles_version_positive" CHECK ("vehicles"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "company_accounts" ADD CONSTRAINT "company_accounts_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_id_company_accounts_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_personal_customer_id_personal_customers_id_fk" FOREIGN KEY ("personal_customer_id") REFERENCES "public"."personal_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_customers" ADD CONSTRAINT "personal_customers_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_staff_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_attachments" ADD CONSTRAINT "vehicle_attachments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_attachments" ADD CONSTRAINT "vehicle_attachments_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_attachments" ADD CONSTRAINT "vehicle_attachments_linked_by_staff_accounts_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_disputes" ADD CONSTRAINT "vehicle_disputes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_disputes" ADD CONSTRAINT "vehicle_disputes_opened_by_staff_accounts_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_disputes" ADD CONSTRAINT "vehicle_disputes_resolved_by_staff_accounts_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_owner_history" ADD CONSTRAINT "vehicle_owner_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_owner_history" ADD CONSTRAINT "vehicle_owner_history_person_customer_id_personal_customers_id_fk" FOREIGN KEY ("person_customer_id") REFERENCES "public"."personal_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_owner_history" ADD CONSTRAINT "vehicle_owner_history_company_account_id_company_accounts_id_fk" FOREIGN KEY ("company_account_id") REFERENCES "public"."company_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_owner_history" ADD CONSTRAINT "vehicle_owner_history_changed_by_staff_accounts_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_current_person_customer_id_personal_customers_id_fk" FOREIGN KEY ("current_person_customer_id") REFERENCES "public"."personal_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_current_company_account_id_company_accounts_id_fk" FOREIGN KEY ("current_company_account_id") REFERENCES "public"."company_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_accounts_company_no_uq" ON "company_accounts" USING btree ("company_no");--> statement-breakpoint
CREATE UNIQUE INDEX "company_accounts_normalized_name_uq" ON "company_accounts" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "company_accounts_trn_uq" ON "company_accounts" USING btree ("trn");--> statement-breakpoint
CREATE UNIQUE INDEX "company_contacts_company_person_uq" ON "company_contacts" USING btree ("company_id","personal_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_contacts_one_active_primary_uq" ON "company_contacts" USING btree ("company_id") WHERE "company_contacts"."is_primary" = true and "company_contacts"."is_active" = true;--> statement-breakpoint
CREATE INDEX "company_contacts_person_idx" ON "company_contacts" USING btree ("personal_customer_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_customers_customer_no_uq" ON "personal_customers" USING btree ("customer_no");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_customers_normalized_phone_uq" ON "personal_customers" USING btree ("normalized_phone");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_customers_trn_uq" ON "personal_customers" USING btree ("trn");--> statement-breakpoint
CREATE INDEX "personal_customers_name_idx" ON "personal_customers" USING btree ("full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_storage_key_uq" ON "stored_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "stored_files_sha256_idx" ON "stored_files" USING btree ("sha256_hex");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_attachments_file_uq" ON "vehicle_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "vehicle_attachments_vehicle_kind_idx" ON "vehicle_attachments" USING btree ("vehicle_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_disputes_one_open_uq" ON "vehicle_disputes" USING btree ("vehicle_id") WHERE "vehicle_disputes"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "vehicle_disputes_opened_idx" ON "vehicle_disputes" USING btree ("opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_owner_history_one_current_uq" ON "vehicle_owner_history" USING btree ("vehicle_id") WHERE "vehicle_owner_history"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "vehicle_owner_history_person_idx" ON "vehicle_owner_history" USING btree ("person_customer_id");--> statement-breakpoint
CREATE INDEX "vehicle_owner_history_company_idx" ON "vehicle_owner_history" USING btree ("company_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vehicle_no_uq" ON "vehicles" USING btree ("vehicle_no");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_normalized_plate_uq" ON "vehicles" USING btree ("normalized_plate");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_uq" ON "vehicles" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "vehicles_person_owner_idx" ON "vehicles" USING btree ("current_person_customer_id");--> statement-breakpoint
CREATE INDEX "vehicles_company_owner_idx" ON "vehicles" USING btree ("current_company_account_id");--> statement-breakpoint
CREATE INDEX "vehicles_make_model_idx" ON "vehicles" USING btree ("make","model");