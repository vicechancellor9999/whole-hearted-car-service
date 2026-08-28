CREATE TABLE "record_deletion_authorized_rows" (
	"request_id" text NOT NULL,
	"table_name" text NOT NULL,
	"row_key" text NOT NULL,
	CONSTRAINT "record_deletion_authorized_rows_pk" PRIMARY KEY("request_id","table_name","row_key"),
	CONSTRAINT "record_deletion_authorized_rows_table_valid" CHECK ("record_deletion_authorized_rows"."table_name" in (
        'vehicle_owner_history',
        'vehicle_attachments',
        'stored_files',
        'customer_driver_license_records',
        'business_order_charge_items',
        'business_order_notes',
        'business_order_charge_versions',
        'inspection_report_findings'
      )),
	CONSTRAINT "record_deletion_authorized_rows_key_nonempty" CHECK (length(btrim("record_deletion_authorized_rows"."row_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "record_deletion_authorized_rows" ADD CONSTRAINT "record_deletion_authorized_rows_request_id_record_deletion_receipts_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."record_deletion_receipts"("request_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION "record_deletion_row_authorized"(
	"authorized_table_name" text,
	"authorized_row_key" text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM record_deletion_authorized_rows
		WHERE request_id = current_setting('app.record_deletion_request_id', true)
			AND table_name = authorized_table_name
			AND row_key = authorized_row_key
	);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_vehicle_owner_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE'
		AND record_deletion_row_authorized('vehicle_owner_history', OLD.id::text)
	THEN
		RETURN OLD;
	END IF;
	IF TG_OP = 'UPDATE'
		AND OLD.ended_at IS NULL
		AND NEW.ended_at IS NOT NULL
		AND NEW.id IS NOT DISTINCT FROM OLD.id
		AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
		AND NEW.person_customer_id IS NOT DISTINCT FROM OLD.person_customer_id
		AND NEW.company_account_id IS NOT DISTINCT FROM OLD.company_account_id
		AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
		AND NEW.reason IS NOT DISTINCT FROM OLD.reason
		AND NEW.changed_by IS NOT DISTINCT FROM OLD.changed_by
	THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'vehicle ownership facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_vehicle_file_fact_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	row_key text;
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF TG_TABLE_NAME = 'stored_files' THEN
			row_key := OLD.id::text;
		ELSIF TG_TABLE_NAME = 'vehicle_attachments' THEN
			row_key := OLD.vehicle_id::text || ':' || OLD.file_id::text;
		END IF;
		IF row_key IS NOT NULL
			AND record_deletion_row_authorized(TG_TABLE_NAME, row_key)
		THEN
			RETURN OLD;
		END IF;
	END IF;
	RAISE EXCEPTION 'vehicle attachment facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_business_order_charge_fact_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE'
		AND record_deletion_row_authorized(TG_TABLE_NAME, OLD.id::text)
	THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'charge facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_inspection_report_finding_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	parent_status inspection_report_status;
BEGIN
	IF TG_OP = 'DELETE'
		AND record_deletion_row_authorized('inspection_report_findings', OLD.id::text)
	THEN
		RETURN OLD;
	END IF;
	IF TG_OP = 'INSERT' THEN
		SELECT status INTO parent_status
		FROM inspection_reports
		WHERE id = NEW.inspection_report_id
		FOR UPDATE;
		IF parent_status = 'draft' THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'Inspection Report findings are append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_customer_driver_license_record_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF record_deletion_row_authorized(
			'customer_driver_license_records', OLD.id::text
		) THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'customer driver license records cannot be deleted' USING ERRCODE = '23514';
	END IF;

	IF OLD.superseded_at IS NULL
		AND OLD.superseded_by IS NULL
		AND NEW.superseded_at IS NOT NULL
		AND NEW.superseded_by IS NOT NULL
		AND ROW(
			OLD.id, OLD.subject_type, OLD.personal_customer_id, OLD.company_account_id,
			OLD.company_contact_id, OLD.file_id, OLD.document_name, OLD.birth_date,
			OLD.sex, OLD.document_address, OLD.status, OLD.verified_by, OLD.verified_at,
			OLD.created_by, OLD.created_at, OLD.version
		) IS NOT DISTINCT FROM ROW(
			NEW.id, NEW.subject_type, NEW.personal_customer_id, NEW.company_account_id,
			NEW.company_contact_id, NEW.file_id, NEW.document_name, NEW.birth_date,
			NEW.sex, NEW.document_address, NEW.status, NEW.verified_by, NEW.verified_at,
			NEW.created_by, NEW.created_at, NEW.version
		) THEN
		RETURN NEW;
	END IF;

	IF OLD.superseded_at IS NULL
		AND NEW.superseded_at IS NULL
		AND OLD.status <> 'needs_reverification'
		AND NEW.status = 'needs_reverification'
		AND NEW.verified_by IS NULL
		AND NEW.verified_at IS NULL
		AND NEW.version = OLD.version + 1
		AND ROW(
			OLD.id, OLD.subject_type, OLD.personal_customer_id, OLD.company_account_id,
			OLD.company_contact_id, OLD.file_id, OLD.document_name, OLD.birth_date,
			OLD.sex, OLD.document_address, OLD.superseded_by, OLD.created_by, OLD.created_at
		) IS NOT DISTINCT FROM ROW(
			NEW.id, NEW.subject_type, NEW.personal_customer_id, NEW.company_account_id,
			NEW.company_contact_id, NEW.file_id, NEW.document_name, NEW.birth_date,
			NEW.sex, NEW.document_address, NEW.superseded_by, NEW.created_by, NEW.created_at
		) THEN
		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'customer driver license records are append-only' USING ERRCODE = '23514';
END;
$$;
