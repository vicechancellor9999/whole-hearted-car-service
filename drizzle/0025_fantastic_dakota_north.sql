CREATE TYPE "public"."customer_license_status" AS ENUM('pending_verification', 'verified', 'needs_reverification');--> statement-breakpoint
CREATE TYPE "public"."customer_license_subject_type" AS ENUM('individual_customer', 'organization_primary_contact');--> statement-breakpoint
CREATE TABLE "customer_driver_license_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_driver_license_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject_type" "customer_license_subject_type" NOT NULL,
	"personal_customer_id" bigint,
	"company_account_id" bigint,
	"company_contact_id" bigint,
	"file_id" bigint NOT NULL,
	"document_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" text NOT NULL,
	"document_address" text NOT NULL,
	"status" "customer_license_status" NOT NULL,
	"verified_by" bigint,
	"verified_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by" bigint,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_driver_license_records_subject_valid" CHECK ((
        "customer_driver_license_records"."subject_type" = 'individual_customer'
        and "customer_driver_license_records"."personal_customer_id" is not null
        and "customer_driver_license_records"."company_account_id" is null
        and "customer_driver_license_records"."company_contact_id" is null
      ) or (
        "customer_driver_license_records"."subject_type" = 'organization_primary_contact'
        and "customer_driver_license_records"."company_account_id" is not null
        and (
          ("customer_driver_license_records"."company_contact_id" is null and "customer_driver_license_records"."personal_customer_id" is null)
          or ("customer_driver_license_records"."company_contact_id" is not null and "customer_driver_license_records"."personal_customer_id" is not null)
        )
      )),
	CONSTRAINT "customer_driver_license_records_profile_nonempty" CHECK (length(btrim("customer_driver_license_records"."document_name")) > 0 and length(btrim("customer_driver_license_records"."document_address")) > 0),
	CONSTRAINT "customer_driver_license_records_sex_valid" CHECK ("customer_driver_license_records"."sex" in ('M', 'F')),
	CONSTRAINT "customer_driver_license_records_verification_complete" CHECK ((
        "customer_driver_license_records"."status" = 'verified'
        and "customer_driver_license_records"."verified_by" is not null
        and "customer_driver_license_records"."verified_at" is not null
      ) or (
        "customer_driver_license_records"."status" <> 'verified'
        and "customer_driver_license_records"."verified_by" is null
        and "customer_driver_license_records"."verified_at" is null
      )),
	CONSTRAINT "customer_driver_license_records_supersession_complete" CHECK (num_nonnulls("customer_driver_license_records"."superseded_at", "customer_driver_license_records"."superseded_by") in (0, 2)),
	CONSTRAINT "customer_driver_license_records_dates_valid" CHECK (("customer_driver_license_records"."verified_at" is null or "customer_driver_license_records"."verified_at" >= "customer_driver_license_records"."created_at")
          and ("customer_driver_license_records"."superseded_at" is null or "customer_driver_license_records"."superseded_at" >= "customer_driver_license_records"."created_at")),
	CONSTRAINT "customer_driver_license_records_version_positive" CHECK ("customer_driver_license_records"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "customer_phone_registry" (
	"normalized_phone" text PRIMARY KEY NOT NULL,
	"owner_kind" "customer_account_kind" NOT NULL,
	"owner_id" bigint NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_phone_registry_format" CHECK ("customer_phone_registry"."normalized_phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "customer_phone_registry_owner_positive" CHECK ("customer_phone_registry"."owner_id" > 0)
);
--> statement-breakpoint
CREATE FUNCTION "normalize_customer_phone_registry_value"("raw_phone" text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
	trimmed_phone text := btrim(raw_phone);
	digits text;
	normalized_phone text;
BEGIN
	IF trimmed_phone = '' THEN
		RETURN NULL;
	END IF;
	IF left(trimmed_phone, 2) = '00' THEN
		digits := regexp_replace(substring(trimmed_phone from 3), '[^0-9]', '', 'g');
	ELSE
		digits := regexp_replace(trimmed_phone, '[^0-9]', '', 'g');
	END IF;
	IF digits = '' THEN
		RETURN NULL;
	END IF;
	normalized_phone := '+' || digits;
	IF normalized_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
		RAISE EXCEPTION 'customer phone cannot be normalized' USING ERRCODE = '23514';
	END IF;
	RETURN normalized_phone;
END;
$$;
--> statement-breakpoint
WITH "phone_candidates" AS (
	SELECT 'person'::customer_account_kind AS owner_kind,
		"id" AS owner_id,
		"created_at" AS registered_at,
		"normalize_customer_phone_registry_value"("phone_value") AS normalized_phone
	FROM "personal_customers"
	CROSS JOIN LATERAL (VALUES ("normalized_phone"), ("whatsapp")) AS phones("phone_value")
	WHERE "phone_value" IS NOT NULL AND btrim("phone_value") <> ''
	UNION ALL
	SELECT 'company'::customer_account_kind AS owner_kind,
		"id" AS owner_id,
		"created_at" AS registered_at,
		"normalize_customer_phone_registry_value"("phone") AS normalized_phone
	FROM "company_accounts"
	WHERE "phone" IS NOT NULL AND btrim("phone") <> ''
)
INSERT INTO "customer_phone_registry" ("normalized_phone", "owner_kind", "owner_id", "registered_at")
SELECT normalized_phone, owner_kind, owner_id, min(registered_at)
FROM "phone_candidates"
WHERE normalized_phone IS NOT NULL
GROUP BY normalized_phone, owner_kind, owner_id;
--> statement-breakpoint
CREATE FUNCTION "sync_personal_customer_phone_registry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		DELETE FROM customer_phone_registry
		WHERE owner_kind = 'person' AND owner_id = OLD.id;
		RETURN OLD;
	END IF;
	DELETE FROM customer_phone_registry
	WHERE owner_kind = 'person' AND owner_id = NEW.id;
	INSERT INTO customer_phone_registry (normalized_phone, owner_kind, owner_id)
	SELECT normalized_phone, 'person', NEW.id
	FROM (
		SELECT DISTINCT normalize_customer_phone_registry_value(phone_value) AS normalized_phone
		FROM (VALUES (NEW.normalized_phone), (NEW.whatsapp)) AS phones(phone_value)
		WHERE phone_value IS NOT NULL AND btrim(phone_value) <> ''
	) AS normalized
	WHERE normalized_phone IS NOT NULL;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "sync_company_customer_phone_registry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		DELETE FROM customer_phone_registry
		WHERE owner_kind = 'company' AND owner_id = OLD.id;
		RETURN OLD;
	END IF;
	DELETE FROM customer_phone_registry
	WHERE owner_kind = 'company' AND owner_id = NEW.id;
	IF NEW.phone IS NOT NULL AND btrim(NEW.phone) <> '' THEN
		INSERT INTO customer_phone_registry (normalized_phone, owner_kind, owner_id)
		VALUES (normalize_customer_phone_registry_value(NEW.phone), 'company', NEW.id);
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "personal_customers_phone_registry_sync"
AFTER INSERT OR UPDATE OR DELETE ON "personal_customers"
FOR EACH ROW
EXECUTE FUNCTION "sync_personal_customer_phone_registry"();
--> statement-breakpoint
CREATE TRIGGER "company_accounts_phone_registry_sync"
AFTER INSERT OR UPDATE OR DELETE ON "company_accounts"
FOR EACH ROW
EXECUTE FUNCTION "sync_company_customer_phone_registry"();
--> statement-breakpoint
ALTER TABLE "personal_customers" DROP CONSTRAINT "personal_customers_identity_present";--> statement-breakpoint
ALTER TABLE "personal_customers" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "personal_customers" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_personal_customer_id_personal_customers_id_fk" FOREIGN KEY ("personal_customer_id") REFERENCES "public"."personal_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_company_account_id_company_accounts_id_fk" FOREIGN KEY ("company_account_id") REFERENCES "public"."company_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_company_contact_id_company_contacts_id_fk" FOREIGN KEY ("company_contact_id") REFERENCES "public"."company_contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_verified_by_staff_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_superseded_by_staff_accounts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_driver_license_records" ADD CONSTRAINT "customer_driver_license_records_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_driver_license_records_file_uq" ON "customer_driver_license_records" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_driver_license_records_person_current_uq" ON "customer_driver_license_records" USING btree ("personal_customer_id") WHERE "customer_driver_license_records"."subject_type" = 'individual_customer' and "customer_driver_license_records"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_driver_license_records_company_current_uq" ON "customer_driver_license_records" USING btree ("company_account_id") WHERE "customer_driver_license_records"."subject_type" = 'organization_primary_contact' and "customer_driver_license_records"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "customer_driver_license_records_contact_idx" ON "customer_driver_license_records" USING btree ("company_contact_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_phone_registry_owner_idx" ON "customer_phone_registry" USING btree ("owner_kind","owner_id");--> statement-breakpoint
ALTER TABLE "personal_customers" ADD CONSTRAINT "personal_customers_gender_valid" CHECK ("personal_customers"."gender" is null or "personal_customers"."gender" in ('M', 'F'));
