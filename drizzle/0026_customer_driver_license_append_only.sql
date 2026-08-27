CREATE FUNCTION "enforce_customer_driver_license_record_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
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
--> statement-breakpoint
CREATE TRIGGER "customer_driver_license_records_append_only"
BEFORE UPDATE OR DELETE ON "customer_driver_license_records"
FOR EACH ROW
EXECUTE FUNCTION "enforce_customer_driver_license_record_history"();
