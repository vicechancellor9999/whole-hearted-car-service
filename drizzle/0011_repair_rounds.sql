CREATE TYPE "public"."repair_round_event_type" AS ENUM('assigned', 'team_responsibility_transferred', 'accepted', 'intake_mileage_recorded', 'intake_photo_linked', 'work_return_submitted', 'work_return_rejected', 'work_return_approved');--> statement-breakpoint
CREATE TYPE "public"."repair_round_source" AS ENUM('initial', 'after_sales');--> statement-breakpoint
CREATE TABLE "repair_round_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repair_round_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repair_round_id" bigint NOT NULL,
	"event_type" "repair_round_event_type" NOT NULL,
	"team_id" bigint,
	"work_return_id" bigint,
	"customer_confirmed_without_payment" boolean,
	"note" text,
	"actor_account_id" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_round_events_assignment_complete" CHECK ("repair_round_events"."event_type" not in ('assigned', 'team_responsibility_transferred')
          or ("repair_round_events"."team_id" is not null
              and ("repair_round_events"."event_type" <> 'assigned'
                   or "repair_round_events"."customer_confirmed_without_payment" = true))),
	CONSTRAINT "repair_round_events_work_return_link" CHECK ("repair_round_events"."event_type" not in ('work_return_submitted', 'work_return_rejected', 'work_return_approved')
          or "repair_round_events"."work_return_id" is not null),
	CONSTRAINT "repair_round_events_rejection_reason" CHECK ("repair_round_events"."event_type" <> 'work_return_rejected'
          or length(btrim("repair_round_events"."note")) > 0)
);
--> statement-breakpoint
CREATE TABLE "repair_round_intake_photos" (
	"repair_round_id" bigint NOT NULL,
	"file_id" bigint NOT NULL,
	"linked_by" bigint NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_round_intake_photos_pk" PRIMARY KEY("repair_round_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "repair_round_work_returns" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repair_round_work_returns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repair_round_id" bigint NOT NULL,
	"submission_no" integer NOT NULL,
	"work_summary" text NOT NULL,
	"actual_staff_member_id" bigint NOT NULL,
	"submitted_by" bigint NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_round_work_returns_submission_positive" CHECK ("repair_round_work_returns"."submission_no" >= 1),
	CONSTRAINT "repair_round_work_returns_summary_nonempty" CHECK (length(btrim("repair_round_work_returns"."work_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "repair_rounds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repair_rounds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"business_order_id" bigint NOT NULL,
	"round_no" integer NOT NULL,
	"source" "repair_round_source" DEFAULT 'initial' NOT NULL,
	"after_sales_issue" text,
	"status" "business_order_status" DEFAULT 'waiting_assignment' NOT NULL,
	"assigned_team_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "repair_rounds_round_positive" CHECK ("repair_rounds"."round_no" >= 1),
	CONSTRAINT "repair_rounds_source_issue_valid" CHECK (("repair_rounds"."source" = 'initial' and "repair_rounds"."round_no" = 1 and "repair_rounds"."after_sales_issue" is null)
          or ("repair_rounds"."source" = 'after_sales' and "repair_rounds"."round_no" >= 2
              and length(btrim("repair_rounds"."after_sales_issue")) > 0)),
	CONSTRAINT "repair_rounds_version_positive" CHECK ("repair_rounds"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "vehicle_mileage_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_mileage_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint NOT NULL,
	"business_order_id" bigint,
	"repair_round_id" bigint,
	"odometer_km" integer NOT NULL,
	"recorded_by" bigint NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_mileage_records_odometer_nonnegative" CHECK ("vehicle_mileage_records"."odometer_km" >= 0),
	CONSTRAINT "vehicle_mileage_records_round_has_order" CHECK ("vehicle_mileage_records"."repair_round_id" is null or "vehicle_mileage_records"."business_order_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "business_orders" ADD COLUMN "current_repair_round_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_team_id_repair_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_work_return_id_repair_round_work_returns_id_fk" FOREIGN KEY ("work_return_id") REFERENCES "public"."repair_round_work_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_actor_account_id_staff_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_intake_photos" ADD CONSTRAINT "repair_round_intake_photos_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_intake_photos" ADD CONSTRAINT "repair_round_intake_photos_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_intake_photos" ADD CONSTRAINT "repair_round_intake_photos_linked_by_staff_accounts_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_work_returns" ADD CONSTRAINT "repair_round_work_returns_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_work_returns" ADD CONSTRAINT "repair_round_work_returns_actual_staff_member_id_staff_members_id_fk" FOREIGN KEY ("actual_staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_round_work_returns" ADD CONSTRAINT "repair_round_work_returns_submitted_by_staff_accounts_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_rounds" ADD CONSTRAINT "repair_rounds_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_rounds" ADD CONSTRAINT "repair_rounds_assigned_team_id_repair_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_rounds" ADD CONSTRAINT "repair_rounds_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_mileage_records" ADD CONSTRAINT "vehicle_mileage_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_mileage_records" ADD CONSTRAINT "vehicle_mileage_records_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_mileage_records" ADD CONSTRAINT "vehicle_mileage_records_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_mileage_records" ADD CONSTRAINT "vehicle_mileage_records_recorded_by_staff_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_round_events_round_time_idx" ON "repair_round_events" USING btree ("repair_round_id","occurred_at");--> statement-breakpoint
CREATE INDEX "repair_round_intake_photos_file_idx" ON "repair_round_intake_photos" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_round_work_returns_round_submission_uq" ON "repair_round_work_returns" USING btree ("repair_round_id","submission_no");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_rounds_order_round_uq" ON "repair_rounds" USING btree ("business_order_id","round_no");--> statement-breakpoint
CREATE INDEX "repair_rounds_team_status_idx" ON "repair_rounds" USING btree ("assigned_team_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_mileage_records_round_uq" ON "vehicle_mileage_records" USING btree ("repair_round_id") WHERE "vehicle_mileage_records"."repair_round_id" is not null;--> statement-breakpoint
CREATE INDEX "vehicle_mileage_records_vehicle_time_idx" ON "vehicle_mileage_records" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_current_repair_round_positive" CHECK ("business_orders"."current_repair_round_no" >= 1);
--> statement-breakpoint
INSERT INTO repair_rounds
  (business_order_id, round_no, source, status,
   created_at, created_by, updated_at, version)
SELECT business_order.id, 1, 'initial', business_order.status,
       business_order.created_at, business_order.created_by,
       business_order.updated_at, 1
FROM business_orders AS business_order
ON CONFLICT (business_order_id, round_no) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_business_order_identity_and_void_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.order_no,
    NEW.vehicle_id,
    NEW.payer_person_customer_id,
    NEW.payer_company_account_id,
    NEW.payer_company_contact_id,
    NEW.payer_display_name_snapshot,
    NEW.payer_phone_snapshot,
    NEW.payer_trn_snapshot,
    NEW.payer_contact_name_snapshot,
    NEW.vehicle_plate_snapshot,
    NEW.vehicle_description_snapshot,
    NEW.vehicle_vin_snapshot,
    NEW.created_at,
    NEW.created_by
  ) IS DISTINCT FROM ROW(
    OLD.order_no,
    OLD.vehicle_id,
    OLD.payer_person_customer_id,
    OLD.payer_company_account_id,
    OLD.payer_company_contact_id,
    OLD.payer_display_name_snapshot,
    OLD.payer_phone_snapshot,
    OLD.payer_trn_snapshot,
    OLD.payer_contact_name_snapshot,
    OLD.vehicle_plate_snapshot,
    OLD.vehicle_description_snapshot,
    OLD.vehicle_vin_snapshot,
    OLD.created_at,
    OLD.created_by
  ) THEN
    RAISE EXCEPTION 'Business Order identity snapshots are immutable';
  END IF;

  IF OLD.voided_at IS NOT NULL
     AND ROW(NEW.voided_at, NEW.voided_by, NEW.void_reason)
         IS DISTINCT FROM ROW(OLD.voided_at, OLD.voided_by, OLD.void_reason) THEN
    RAISE EXCEPTION 'Business Order void fact is append-only';
  END IF;

  IF ROW(NEW.status, NEW.current_repair_round_no)
     IS DISTINCT FROM ROW(OLD.status, OLD.current_repair_round_no)
     AND current_setting('whole_hearted.repair_event_projection', true)
         IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Business Order repair state can only be projected from a repair round event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_repair_round_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('whole_hearted.repair_event_projection', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'repair round state can only be projected from an event fact';
  END IF;
  IF ROW(
    NEW.business_order_id, NEW.round_no, NEW.source,
    NEW.after_sales_issue, NEW.created_at, NEW.created_by
  ) IS DISTINCT FROM ROW(
    OLD.business_order_id, OLD.round_no, OLD.source,
    OLD.after_sales_issue, OLD.created_at, OLD.created_by
  ) THEN
    RAISE EXCEPTION 'repair round identity facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_rounds_update_guard
BEFORE UPDATE ON repair_rounds
FOR EACH ROW
EXECUTE FUNCTION guard_repair_round_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_current_repair_round_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE business_orders
    SET status = NEW.status,
        updated_at = NEW.updated_at,
        version = version + 1
    WHERE id = NEW.business_order_id
      AND current_repair_round_no = NEW.round_no;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_rounds_sync_current_status
AFTER UPDATE OF status ON repair_rounds
FOR EACH ROW
EXECUTE FUNCTION sync_current_repair_round_status();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_repair_round_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_round_id bigint;
BEGIN
  PERFORM set_config('whole_hearted.repair_event_projection', 'on', true);

  IF NEW.event_type = 'assigned' THEN
    UPDATE repair_rounds
    SET assigned_team_id = NEW.team_id,
        status = 'assigned',
        updated_at = NEW.occurred_at,
        version = version + 1
    WHERE id = NEW.repair_round_id
      AND status = 'waiting_assignment'
      AND assigned_team_id IS NULL
    RETURNING id INTO changed_round_id;
  ELSIF NEW.event_type = 'team_responsibility_transferred' THEN
    UPDATE repair_rounds AS round
    SET assigned_team_id = NEW.team_id,
        updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.assigned_team_id IS NOT NULL
      AND round.status <> 'formally_handed_off'
      AND EXISTS (
        SELECT 1
        FROM repair_team_retirements AS retirement
        JOIN repair_teams AS source_team
          ON source_team.id = retirement.source_team_id
        JOIN repair_teams AS replacement_team
          ON replacement_team.id = retirement.replacement_team_id
        WHERE retirement.source_team_id = round.assigned_team_id
          AND retirement.replacement_team_id = NEW.team_id
          AND retirement.retired_by = NEW.actor_account_id
          AND retirement.retired_at = NEW.occurred_at
          AND source_team.is_active = false
          AND replacement_team.is_active = true
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type = 'accepted' THEN
    UPDATE repair_rounds
    SET status = 'in_repair',
        updated_at = NEW.occurred_at,
        version = version + 1
    WHERE id = NEW.repair_round_id
      AND status = 'assigned'
      AND assigned_team_id = NEW.team_id
    RETURNING id INTO changed_round_id;
  ELSIF NEW.event_type IN ('intake_mileage_recorded', 'intake_photo_linked') THEN
    UPDATE repair_rounds
    SET updated_at = NEW.occurred_at,
        version = version + 1
    WHERE id = NEW.repair_round_id
      AND status = 'in_repair'
    RETURNING id INTO changed_round_id;
  ELSIF NEW.event_type = 'work_return_submitted' THEN
    UPDATE repair_rounds AS round
    SET status = 'return_pending_review',
        updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'in_repair'
      AND EXISTS (
        SELECT 1 FROM repair_round_work_returns AS work_return
        WHERE work_return.id = NEW.work_return_id
          AND work_return.repair_round_id = round.id
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type = 'work_return_rejected' THEN
    UPDATE repair_rounds AS round
    SET status = 'in_repair',
        updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'return_pending_review'
      AND EXISTS (
        SELECT 1 FROM repair_round_work_returns AS work_return
        WHERE work_return.id = NEW.work_return_id
          AND work_return.repair_round_id = round.id
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type = 'work_return_approved' THEN
    UPDATE repair_rounds AS round
    SET updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'return_pending_review'
      AND EXISTS (
        SELECT 1 FROM repair_round_work_returns AS work_return
        WHERE work_return.id = NEW.work_return_id
          AND work_return.repair_round_id = round.id
      )
    RETURNING round.id INTO changed_round_id;
  END IF;

  IF changed_round_id IS NULL THEN
    RAISE EXCEPTION 'repair round event does not match the current state';
  END IF;
  PERFORM set_config('whole_hearted.repair_event_projection', 'off', true);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_round_events_project_state
AFTER INSERT ON repair_round_events
FOR EACH ROW
EXECUTE FUNCTION project_repair_round_event();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION transfer_open_repair_round_responsibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  retirement RECORD;
  moved_round RECORD;
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false THEN
    SELECT replacement_team_id, reason, retired_at, retired_by
    INTO retirement
    FROM repair_team_retirements
    WHERE source_team_id = NEW.id;

    IF retirement.replacement_team_id IS NULL AND EXISTS (
      SELECT 1 FROM repair_rounds
      WHERE assigned_team_id = NEW.id
        AND status <> 'formally_handed_off'
    ) THEN
      RAISE EXCEPTION '该班组仍负责未完成维修轮次，必须选择一个现存维修班组继承';
    END IF;

    IF retirement.replacement_team_id IS NOT NULL THEN
      FOR moved_round IN
        SELECT id FROM repair_rounds
        WHERE assigned_team_id = NEW.id
          AND status <> 'formally_handed_off'
        FOR UPDATE
      LOOP
        INSERT INTO repair_round_events
          (repair_round_id, event_type, team_id, note,
           actor_account_id, occurred_at)
        VALUES
          (moved_round.id, 'team_responsibility_transferred',
           retirement.replacement_team_id, retirement.reason,
           retirement.retired_by, retirement.retired_at);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_teams_transfer_open_rounds
AFTER UPDATE OF is_active ON repair_teams
FOR EACH ROW
EXECUTE FUNCTION transfer_open_repair_round_responsibility();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_repair_round_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'repair round facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_round_events_append_only
BEFORE UPDATE OR DELETE ON repair_round_events
FOR EACH ROW
EXECUTE FUNCTION reject_repair_round_fact_change();
--> statement-breakpoint
CREATE TRIGGER repair_round_work_returns_append_only
BEFORE UPDATE OR DELETE ON repair_round_work_returns
FOR EACH ROW
EXECUTE FUNCTION reject_repair_round_fact_change();
--> statement-breakpoint
CREATE TRIGGER vehicle_mileage_records_append_only
BEFORE UPDATE OR DELETE ON vehicle_mileage_records
FOR EACH ROW
EXECUTE FUNCTION reject_repair_round_fact_change();
--> statement-breakpoint
CREATE TRIGGER repair_round_intake_photos_append_only
BEFORE UPDATE OR DELETE ON repair_round_intake_photos
FOR EACH ROW
EXECUTE FUNCTION reject_repair_round_fact_change();
