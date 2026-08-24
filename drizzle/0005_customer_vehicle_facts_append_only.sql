CREATE FUNCTION "guard_vehicle_owner_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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
CREATE TRIGGER "vehicle_owner_history_guard"
BEFORE UPDATE OR DELETE ON "vehicle_owner_history"
FOR EACH ROW
EXECUTE FUNCTION "guard_vehicle_owner_history"();
--> statement-breakpoint
CREATE FUNCTION "guard_vehicle_disputes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD.resolved_at IS NULL
		AND OLD.resolved_note IS NULL
		AND OLD.resolved_by IS NULL
		AND NEW.resolved_at IS NOT NULL
		AND NEW.resolved_note IS NOT NULL
		AND NEW.resolved_by IS NOT NULL
		AND NEW.id IS NOT DISTINCT FROM OLD.id
		AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
		AND NEW.opened_at IS NOT DISTINCT FROM OLD.opened_at
		AND NEW.opened_note IS NOT DISTINCT FROM OLD.opened_note
		AND NEW.opened_by IS NOT DISTINCT FROM OLD.opened_by
	THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'vehicle dispute facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "vehicle_disputes_guard"
BEFORE UPDATE OR DELETE ON "vehicle_disputes"
FOR EACH ROW
EXECUTE FUNCTION "guard_vehicle_disputes"();
--> statement-breakpoint
CREATE FUNCTION "reject_vehicle_file_fact_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'vehicle attachment facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "stored_files_append_only"
BEFORE UPDATE OR DELETE ON "stored_files"
FOR EACH ROW
EXECUTE FUNCTION "reject_vehicle_file_fact_mutation"();
--> statement-breakpoint
CREATE TRIGGER "vehicle_attachments_append_only"
BEFORE UPDATE OR DELETE ON "vehicle_attachments"
FOR EACH ROW
EXECUTE FUNCTION "reject_vehicle_file_fact_mutation"();
