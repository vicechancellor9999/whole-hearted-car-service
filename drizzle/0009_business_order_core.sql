CREATE TYPE "public"."business_order_note_kind" AS ENUM('customer_concern', 'work_instruction', 'liability_notice', 'internal');--> statement-breakpoint
CREATE TYPE "public"."business_order_status" AS ENUM('waiting_assignment', 'assigned', 'in_repair', 'return_pending_review', 'formally_handed_off');--> statement-breakpoint
CREATE TYPE "public"."charge_item_kind" AS ENUM('labor', 'part', 'other');--> statement-breakpoint
CREATE TABLE "business_order_charge_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_order_charge_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"charge_version_id" bigint NOT NULL,
	"kind" charge_item_kind NOT NULL,
	"name_zh" text NOT NULL,
	"name_en" text,
	"description_zh" text,
	"description_en" text,
	"unit_item_id" bigint NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"item_discount_minor" bigint DEFAULT 0 NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "business_order_charge_items_name_nonempty" CHECK (length(btrim("business_order_charge_items"."name_zh")) > 0),
	CONSTRAINT "business_order_charge_items_quantity_positive" CHECK ("business_order_charge_items"."quantity" > 0),
	CONSTRAINT "business_order_charge_items_amounts_nonnegative" CHECK ("business_order_charge_items"."unit_price_minor" >= 0
          and "business_order_charge_items"."item_discount_minor" >= 0
          and "business_order_charge_items"."subtotal_minor" >= 0),
	CONSTRAINT "business_order_charge_items_amount_conservation" CHECK ("business_order_charge_items"."subtotal_minor" = round("business_order_charge_items"."quantity" * "business_order_charge_items"."unit_price_minor") - "business_order_charge_items"."item_discount_minor"),
	CONSTRAINT "business_order_charge_items_sort_nonnegative" CHECK ("business_order_charge_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "business_order_charge_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_order_charge_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"business_order_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"change_reason" text NOT NULL,
	"labor_discount_minor" bigint DEFAULT 0 NOT NULL,
	"part_discount_minor" bigint DEFAULT 0 NOT NULL,
	"other_discount_minor" bigint DEFAULT 0 NOT NULL,
	"whole_order_discount_minor" bigint DEFAULT 0 NOT NULL,
	"gross_minor" bigint NOT NULL,
	"line_discount_minor" bigint NOT NULL,
	"category_discount_minor" bigint NOT NULL,
	"total_due_minor" bigint NOT NULL,
	"included_gct_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	CONSTRAINT "business_order_charge_versions_version_positive" CHECK ("business_order_charge_versions"."version_no" >= 1),
	CONSTRAINT "business_order_charge_versions_reason_nonempty" CHECK (length(btrim("business_order_charge_versions"."change_reason")) > 0),
	CONSTRAINT "business_order_charge_versions_amounts_nonnegative" CHECK ("business_order_charge_versions"."labor_discount_minor" >= 0
          and "business_order_charge_versions"."part_discount_minor" >= 0
          and "business_order_charge_versions"."other_discount_minor" >= 0
          and "business_order_charge_versions"."whole_order_discount_minor" >= 0
          and "business_order_charge_versions"."gross_minor" >= 0
          and "business_order_charge_versions"."line_discount_minor" >= 0
          and "business_order_charge_versions"."category_discount_minor" >= 0
          and "business_order_charge_versions"."total_due_minor" >= 0
          and "business_order_charge_versions"."included_gct_minor" >= 0),
	CONSTRAINT "business_order_charge_versions_category_discount_total" CHECK ("business_order_charge_versions"."category_discount_minor" = "business_order_charge_versions"."labor_discount_minor"
          + "business_order_charge_versions"."part_discount_minor" + "business_order_charge_versions"."other_discount_minor"),
	CONSTRAINT "business_order_charge_versions_amount_conservation" CHECK ("business_order_charge_versions"."total_due_minor" = "business_order_charge_versions"."gross_minor" - "business_order_charge_versions"."line_discount_minor"
          - "business_order_charge_versions"."category_discount_minor" - "business_order_charge_versions"."whole_order_discount_minor"),
	CONSTRAINT "business_order_charge_versions_gct_within_total" CHECK ("business_order_charge_versions"."included_gct_minor" <= "business_order_charge_versions"."total_due_minor")
);
--> statement-breakpoint
CREATE TABLE "business_order_notes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_order_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"charge_version_id" bigint NOT NULL,
	"kind" "business_order_note_kind" NOT NULL,
	"content_zh" text,
	"content_en" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "business_order_notes_content_present" CHECK (coalesce(length(btrim("business_order_notes"."content_zh")), 0)
          + coalesce(length(btrim("business_order_notes"."content_en")), 0) > 0),
	CONSTRAINT "business_order_notes_sort_nonnegative" CHECK ("business_order_notes"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "business_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_no" text NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"payer_person_customer_id" bigint,
	"payer_company_account_id" bigint,
	"payer_company_contact_id" bigint,
	"payer_display_name_snapshot" text NOT NULL,
	"payer_phone_snapshot" text,
	"payer_trn_snapshot" text,
	"payer_contact_name_snapshot" text,
	"vehicle_plate_snapshot" text NOT NULL,
	"vehicle_description_snapshot" text NOT NULL,
	"vehicle_vin_snapshot" text,
	"status" "business_order_status" DEFAULT 'waiting_assignment' NOT NULL,
	"current_charge_version_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"void_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "business_orders_order_no_format" CHECK ("business_orders"."order_no" ~ '^BO-[0-9]{8}-[0-9]{4}$'),
	CONSTRAINT "business_orders_exactly_one_payer" CHECK (num_nonnulls("business_orders"."payer_person_customer_id", "business_orders"."payer_company_account_id") = 1),
	CONSTRAINT "business_orders_company_contact_required" CHECK (("business_orders"."payer_company_account_id" is not null and "business_orders"."payer_company_contact_id" is not null)
          or ("business_orders"."payer_company_account_id" is null and "business_orders"."payer_company_contact_id" is null)),
	CONSTRAINT "business_orders_snapshots_nonempty" CHECK (length(btrim("business_orders"."payer_display_name_snapshot")) > 0
          and length(btrim("business_orders"."vehicle_plate_snapshot")) > 0
          and length(btrim("business_orders"."vehicle_description_snapshot")) > 0),
	CONSTRAINT "business_orders_current_charge_version_nonnegative" CHECK ("business_orders"."current_charge_version_no" >= 0),
	CONSTRAINT "business_orders_version_positive" CHECK ("business_orders"."version" >= 1),
	CONSTRAINT "business_orders_void_complete" CHECK (num_nonnulls("business_orders"."voided_at", "business_orders"."voided_by", "business_orders"."void_reason") in (0, 3)),
	CONSTRAINT "business_orders_void_reason_nonempty" CHECK ("business_orders"."void_reason" is null or length(btrim("business_orders"."void_reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "business_order_charge_items" ADD CONSTRAINT "business_order_charge_items_charge_version_id_business_order_charge_versions_id_fk" FOREIGN KEY ("charge_version_id") REFERENCES "public"."business_order_charge_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_charge_items" ADD CONSTRAINT "business_order_charge_items_unit_item_id_dictionary_items_id_fk" FOREIGN KEY ("unit_item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_charge_versions" ADD CONSTRAINT "business_order_charge_versions_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_charge_versions" ADD CONSTRAINT "business_order_charge_versions_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_notes" ADD CONSTRAINT "business_order_notes_charge_version_id_business_order_charge_versions_id_fk" FOREIGN KEY ("charge_version_id") REFERENCES "public"."business_order_charge_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_payer_person_customer_id_personal_customers_id_fk" FOREIGN KEY ("payer_person_customer_id") REFERENCES "public"."personal_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_payer_company_account_id_company_accounts_id_fk" FOREIGN KEY ("payer_company_account_id") REFERENCES "public"."company_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_payer_company_contact_id_company_contacts_id_fk" FOREIGN KEY ("payer_company_contact_id") REFERENCES "public"."company_contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_voided_by_staff_accounts_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_charge_items_version_sort_uq" ON "business_order_charge_items" USING btree ("charge_version_id","sort_order");--> statement-breakpoint
CREATE INDEX "business_order_charge_items_kind_idx" ON "business_order_charge_items" USING btree ("charge_version_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_charge_versions_order_version_uq" ON "business_order_charge_versions" USING btree ("business_order_id","version_no");--> statement-breakpoint
CREATE INDEX "business_order_charge_versions_created_idx" ON "business_order_charge_versions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_notes_version_sort_uq" ON "business_order_notes" USING btree ("charge_version_id","sort_order");--> statement-breakpoint
CREATE INDEX "business_order_notes_kind_idx" ON "business_order_notes" USING btree ("charge_version_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "business_orders_order_no_uq" ON "business_orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "business_orders_vehicle_created_idx" ON "business_orders" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "business_orders_status_created_idx" ON "business_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "business_orders_person_payer_idx" ON "business_orders" USING btree ("payer_person_customer_id");--> statement-breakpoint
CREATE INDEX "business_orders_company_payer_idx" ON "business_orders" USING btree ("payer_company_account_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_business_order_company_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payer_company_account_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM company_contacts
       WHERE id = NEW.payer_company_contact_id
         AND company_id = NEW.payer_company_account_id
         AND is_active = true
     ) THEN
    RAISE EXCEPTION 'company contact does not belong to payer'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_orders_company_contact_guard
BEFORE INSERT OR UPDATE OF payer_company_account_id, payer_company_contact_id
ON business_orders
FOR EACH ROW
EXECUTE FUNCTION validate_business_order_company_contact();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_business_order_charge_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'charge facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_charge_versions_append_only
BEFORE UPDATE OR DELETE ON business_order_charge_versions
FOR EACH ROW
EXECUTE FUNCTION reject_business_order_charge_fact_change();
--> statement-breakpoint
CREATE TRIGGER business_order_charge_items_append_only
BEFORE UPDATE OR DELETE ON business_order_charge_items
FOR EACH ROW
EXECUTE FUNCTION reject_business_order_charge_fact_change();
--> statement-breakpoint
CREATE TRIGGER business_order_notes_append_only
BEFORE UPDATE OR DELETE ON business_order_notes
FOR EACH ROW
EXECUTE FUNCTION reject_business_order_charge_fact_change();
