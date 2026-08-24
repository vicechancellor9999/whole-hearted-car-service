ALTER TABLE "repair_round_events" DROP CONSTRAINT "repair_round_events_assignment_complete";--> statement-breakpoint
ALTER TABLE "repair_round_events" DROP CONSTRAINT "repair_round_events_work_return_link";--> statement-breakpoint
ALTER TABLE "repair_round_events" DROP CONSTRAINT "repair_round_events_rejection_reason";--> statement-breakpoint
ALTER TYPE "public"."repair_round_event_type" RENAME TO "repair_round_event_type_old";--> statement-breakpoint
CREATE TYPE "public"."repair_round_event_type" AS ENUM(
	'assigned',
	'team_responsibility_transferred',
	'accepted',
	'intake_mileage_recorded',
	'intake_photo_linked',
	'work_return_submitted',
	'work_return_rejected',
	'work_return_approved',
	'formally_handed_off',
	'formal_handoff_cancelled'
);--> statement-breakpoint
ALTER TABLE "repair_round_events"
	ALTER COLUMN "event_type" TYPE "public"."repair_round_event_type"
	USING "event_type"::text::"public"."repair_round_event_type";--> statement-breakpoint
DROP TYPE "public"."repair_round_event_type_old";--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_assignment_complete" CHECK ("repair_round_events"."event_type" not in ('assigned', 'team_responsibility_transferred')
          or ("repair_round_events"."team_id" is not null
              and ("repair_round_events"."event_type" <> 'assigned'
                   or "repair_round_events"."customer_confirmed_without_payment" = true)));--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_work_return_link" CHECK ("repair_round_events"."event_type" not in ('work_return_submitted', 'work_return_rejected', 'work_return_approved')
          or "repair_round_events"."work_return_id" is not null);--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_rejection_reason" CHECK ("repair_round_events"."event_type" <> 'work_return_rejected'
          or length(btrim("repair_round_events"."note")) > 0);--> statement-breakpoint
CREATE TABLE "formal_handoff_cancellations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "formal_handoff_cancellations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"formal_handoff_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"jamaica_month" date NOT NULL,
	"cancelled_at" timestamp with time zone NOT NULL,
	"cancelled_by" bigint NOT NULL,
	CONSTRAINT "formal_handoff_cancellations_reason_nonempty" CHECK (length(btrim("formal_handoff_cancellations"."reason")) > 0),
	CONSTRAINT "formal_handoff_cancellations_month_first_day" CHECK (extract(day from "formal_handoff_cancellations"."jamaica_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "formal_handoffs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "formal_handoffs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"business_order_id" bigint NOT NULL,
	"handoff_no" integer NOT NULL,
	"repair_round_id" bigint NOT NULL,
	"repair_round_no" integer NOT NULL,
	"team_id" bigint NOT NULL,
	"performance_minor" bigint NOT NULL,
	"jamaica_month" date NOT NULL,
	"charge_version_id" bigint NOT NULL,
	"charge_version_no" integer NOT NULL,
	"gross_minor" bigint NOT NULL,
	"line_discount_minor" bigint NOT NULL,
	"labor_discount_minor" bigint NOT NULL,
	"part_discount_minor" bigint NOT NULL,
	"other_discount_minor" bigint NOT NULL,
	"category_discount_minor" bigint NOT NULL,
	"whole_order_discount_minor" bigint NOT NULL,
	"total_due_minor" bigint NOT NULL,
	"included_gct_minor" bigint NOT NULL,
	"charge_snapshot" jsonb NOT NULL,
	"handed_off_at" timestamp with time zone NOT NULL,
	"handed_off_by" bigint NOT NULL,
	CONSTRAINT "formal_handoffs_no_positive" CHECK ("formal_handoffs"."handoff_no" >= 1),
	CONSTRAINT "formal_handoffs_round_no_positive" CHECK ("formal_handoffs"."repair_round_no" >= 1),
	CONSTRAINT "formal_handoffs_charge_version_positive" CHECK ("formal_handoffs"."charge_version_no" >= 1),
	CONSTRAINT "formal_handoffs_month_first_day" CHECK (extract(day from "formal_handoffs"."jamaica_month") = 1),
	CONSTRAINT "formal_handoffs_amounts_nonnegative" CHECK ("formal_handoffs"."gross_minor" >= 0
          and "formal_handoffs"."line_discount_minor" >= 0
          and "formal_handoffs"."labor_discount_minor" >= 0
          and "formal_handoffs"."part_discount_minor" >= 0
          and "formal_handoffs"."other_discount_minor" >= 0
          and "formal_handoffs"."category_discount_minor" >= 0
          and "formal_handoffs"."whole_order_discount_minor" >= 0
          and "formal_handoffs"."total_due_minor" >= 0
          and "formal_handoffs"."included_gct_minor" >= 0),
	CONSTRAINT "formal_handoffs_category_discount_total" CHECK ("formal_handoffs"."category_discount_minor" = "formal_handoffs"."labor_discount_minor"
          + "formal_handoffs"."part_discount_minor" + "formal_handoffs"."other_discount_minor"),
	CONSTRAINT "formal_handoffs_amount_conservation" CHECK ("formal_handoffs"."total_due_minor" = "formal_handoffs"."gross_minor" - "formal_handoffs"."line_discount_minor"
          - "formal_handoffs"."category_discount_minor" - "formal_handoffs"."whole_order_discount_minor"),
	CONSTRAINT "formal_handoffs_gct_within_total" CHECK ("formal_handoffs"."included_gct_minor" <= "formal_handoffs"."total_due_minor")
);
--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD COLUMN "formal_handoff_id" bigint;--> statement-breakpoint
ALTER TABLE "formal_handoff_cancellations" ADD CONSTRAINT "formal_handoff_cancellations_formal_handoff_id_formal_handoffs_id_fk" FOREIGN KEY ("formal_handoff_id") REFERENCES "public"."formal_handoffs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_handoff_cancellations" ADD CONSTRAINT "formal_handoff_cancellations_cancelled_by_staff_accounts_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_handoffs" ADD CONSTRAINT "formal_handoffs_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_handoffs" ADD CONSTRAINT "formal_handoffs_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_handoffs" ADD CONSTRAINT "formal_handoffs_team_id_repair_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_handoffs" ADD CONSTRAINT "formal_handoffs_charge_version_id_business_order_charge_versions_id_fk" FOREIGN KEY ("charge_version_id") REFERENCES "public"."business_order_charge_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_handoffs" ADD CONSTRAINT "formal_handoffs_handed_off_by_staff_accounts_id_fk" FOREIGN KEY ("handed_off_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "formal_handoff_cancellations_handoff_uq" ON "formal_handoff_cancellations" USING btree ("formal_handoff_id");--> statement-breakpoint
CREATE INDEX "formal_handoff_cancellations_month_idx" ON "formal_handoff_cancellations" USING btree ("jamaica_month");--> statement-breakpoint
CREATE UNIQUE INDEX "formal_handoffs_order_no_uq" ON "formal_handoffs" USING btree ("business_order_id","handoff_no");--> statement-breakpoint
CREATE INDEX "formal_handoffs_round_time_idx" ON "formal_handoffs" USING btree ("repair_round_id","handed_off_at");--> statement-breakpoint
CREATE INDEX "formal_handoffs_month_team_idx" ON "formal_handoffs" USING btree ("jamaica_month","team_id");--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_formal_handoff_link" CHECK (("repair_round_events"."event_type" in ('formally_handed_off', 'formal_handoff_cancelled')
           and "repair_round_events"."formal_handoff_id" is not null)
          or ("repair_round_events"."event_type" not in ('formally_handed_off', 'formal_handoff_cancelled')
              and "repair_round_events"."formal_handoff_id" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_formal_handoff_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_order RECORD;
  current_round RECORD;
  current_charge RECORD;
  expected_handoff_no integer;
  expected_charge_snapshot jsonb;
BEGIN
  SELECT id, current_repair_round_no, current_charge_version_no, voided_at
  INTO current_order
  FROM business_orders
  WHERE id = NEW.business_order_id
  FOR UPDATE;

  SELECT id, business_order_id, round_no, status, assigned_team_id
  INTO current_round
  FROM repair_rounds
  WHERE id = NEW.repair_round_id;

  SELECT id, business_order_id, version_no,
         gross_minor, line_discount_minor,
         labor_discount_minor, part_discount_minor, other_discount_minor,
         category_discount_minor, whole_order_discount_minor,
         total_due_minor, included_gct_minor
  INTO current_charge
  FROM business_order_charge_versions
  WHERE id = NEW.charge_version_id;

  SELECT coalesce(max(handoff_no), 0) + 1
  INTO expected_handoff_no
  FROM formal_handoffs
  WHERE business_order_id = NEW.business_order_id;

  IF current_order.id IS NULL OR current_order.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Business Order does not allow formal handoff';
  END IF;
  IF current_round.id IS NULL
     OR current_round.business_order_id <> NEW.business_order_id
     OR current_round.round_no <> NEW.repair_round_no
     OR current_order.current_repair_round_no <> NEW.repair_round_no
     OR current_round.status <> 'return_pending_review'
     OR current_round.assigned_team_id IS NULL
     OR current_round.assigned_team_id <> NEW.team_id THEN
    RAISE EXCEPTION 'formal handoff must freeze the current approved repair round and team';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM repair_round_work_returns AS work_return
    JOIN repair_round_events AS approval
      ON approval.repair_round_id = work_return.repair_round_id
     AND approval.work_return_id = work_return.id
     AND approval.event_type = 'work_return_approved'
    WHERE work_return.repair_round_id = current_round.id
      AND work_return.submission_no = (
        SELECT max(submission_no)
        FROM repair_round_work_returns
        WHERE repair_round_id = current_round.id
      )
  ) THEN
    RAISE EXCEPTION 'latest work return is not approved';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM formal_handoffs AS handoff
    LEFT JOIN formal_handoff_cancellations AS cancellation
      ON cancellation.formal_handoff_id = handoff.id
    WHERE handoff.repair_round_id = current_round.id
      AND cancellation.id IS NULL
  ) THEN
    RAISE EXCEPTION 'repair round already has an active formal handoff';
  END IF;
  IF NEW.handoff_no <> expected_handoff_no THEN
    RAISE EXCEPTION 'formal handoff number is not the next Business Order fact';
  END IF;
  IF current_charge.id IS NULL
     OR current_charge.business_order_id <> NEW.business_order_id
     OR current_order.current_charge_version_no <> NEW.charge_version_no
     OR current_charge.version_no <> NEW.charge_version_no
     OR ROW(
       current_charge.gross_minor,
       current_charge.line_discount_minor,
       current_charge.labor_discount_minor,
       current_charge.part_discount_minor,
       current_charge.other_discount_minor,
       current_charge.category_discount_minor,
       current_charge.whole_order_discount_minor,
       current_charge.total_due_minor,
       current_charge.included_gct_minor
     ) IS DISTINCT FROM ROW(
       NEW.gross_minor,
       NEW.line_discount_minor,
       NEW.labor_discount_minor,
       NEW.part_discount_minor,
       NEW.other_discount_minor,
       NEW.category_discount_minor,
       NEW.whole_order_discount_minor,
       NEW.total_due_minor,
       NEW.included_gct_minor
     ) THEN
    RAISE EXCEPTION 'formal handoff charge snapshot does not match the current charge version';
  END IF;
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'grossMinor', current_charge.gross_minor,
      'lineDiscountMinor', current_charge.line_discount_minor,
      'laborDiscountMinor', current_charge.labor_discount_minor,
      'partDiscountMinor', current_charge.part_discount_minor,
      'otherDiscountMinor', current_charge.other_discount_minor,
      'categoryDiscountMinor', current_charge.category_discount_minor,
      'wholeOrderDiscountMinor', current_charge.whole_order_discount_minor,
      'totalDueMinor', current_charge.total_due_minor,
      'includedGctMinor', current_charge.included_gct_minor
    ),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind', item.kind,
          'nameZh', item.name_zh,
          'nameEn', item.name_en,
          'descriptionZh', item.description_zh,
          'descriptionEn', item.description_en,
          'unitItemId', item.unit_item_id,
          'quantity', item.quantity::text,
          'unitPriceMinor', item.unit_price_minor,
          'itemDiscountMinor', item.item_discount_minor,
          'subtotalMinor', item.subtotal_minor,
          'sortOrder', item.sort_order
        ) ORDER BY item.sort_order, item.id
      )
      FROM business_order_charge_items AS item
      WHERE item.charge_version_id = current_charge.id
    ), '[]'::jsonb),
    'notes', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind', note.kind,
          'contentZh', note.content_zh,
          'contentEn', note.content_en,
          'sortOrder', note.sort_order
        ) ORDER BY note.sort_order, note.id
      )
      FROM business_order_notes AS note
      WHERE note.charge_version_id = current_charge.id
    ), '[]'::jsonb)
  ) INTO expected_charge_snapshot;
  IF NEW.charge_snapshot IS DISTINCT FROM expected_charge_snapshot THEN
    RAISE EXCEPTION 'formal handoff item and note snapshot does not match the current charge version';
  END IF;
  IF NEW.jamaica_month IS DISTINCT FROM
     date_trunc('month', NEW.handed_off_at AT TIME ZONE 'America/Jamaica')::date THEN
    RAISE EXCEPTION 'formal handoff Jamaica month does not match handoff time';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER formal_handoffs_validate_fact
BEFORE INSERT ON formal_handoffs
FOR EACH ROW
EXECUTE FUNCTION validate_formal_handoff_fact();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_formal_handoff_cancellation_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  handoff RECORD;
BEGIN
  SELECT id, repair_round_id, jamaica_month
  INTO handoff
  FROM formal_handoffs
  WHERE id = NEW.formal_handoff_id
  FOR UPDATE;

  IF handoff.id IS NULL THEN
    RAISE EXCEPTION 'formal handoff does not exist';
  END IF;
  IF NEW.jamaica_month IS DISTINCT FROM handoff.jamaica_month
     OR NEW.jamaica_month IS DISTINCT FROM
        date_trunc('month', NEW.cancelled_at AT TIME ZONE 'America/Jamaica')::date THEN
    RAISE EXCEPTION 'formal handoff can only be cancelled in its Jamaica calendar month';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM repair_rounds
    WHERE id = handoff.repair_round_id
      AND status = 'formally_handed_off'
  ) THEN
    RAISE EXCEPTION 'formal handoff is not currently active';
  END IF;
  IF EXISTS (
    SELECT 1 FROM formal_handoffs AS later
    LEFT JOIN formal_handoff_cancellations AS later_cancellation
      ON later_cancellation.formal_handoff_id = later.id
    WHERE later.repair_round_id = handoff.repair_round_id
      AND later.id <> handoff.id
      AND later_cancellation.id IS NULL
  ) THEN
    RAISE EXCEPTION 'only the current active formal handoff can be cancelled';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER formal_handoff_cancellations_validate_fact
BEFORE INSERT ON formal_handoff_cancellations
FOR EACH ROW
EXECUTE FUNCTION validate_formal_handoff_cancellation_fact();
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
  ELSIF NEW.event_type = 'formally_handed_off' THEN
    UPDATE repair_rounds AS round
    SET status = 'formally_handed_off',
        updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'return_pending_review'
      AND EXISTS (
        SELECT 1
        FROM formal_handoffs AS handoff
        LEFT JOIN formal_handoff_cancellations AS cancellation
          ON cancellation.formal_handoff_id = handoff.id
        WHERE handoff.id = NEW.formal_handoff_id
          AND handoff.repair_round_id = round.id
          AND handoff.handed_off_by = NEW.actor_account_id
          AND handoff.handed_off_at = NEW.occurred_at
          AND cancellation.id IS NULL
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type = 'formal_handoff_cancelled' THEN
    UPDATE repair_rounds AS round
    SET status = 'return_pending_review',
        updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'formally_handed_off'
      AND EXISTS (
        SELECT 1
        FROM formal_handoffs AS handoff
        JOIN formal_handoff_cancellations AS cancellation
          ON cancellation.formal_handoff_id = handoff.id
        WHERE handoff.id = NEW.formal_handoff_id
          AND handoff.repair_round_id = round.id
          AND cancellation.cancelled_by = NEW.actor_account_id
          AND cancellation.cancelled_at = NEW.occurred_at
          AND cancellation.reason = NEW.note
          AND handoff.id = (
            SELECT max(latest.id)
            FROM formal_handoffs AS latest
            WHERE latest.repair_round_id = round.id
          )
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
CREATE OR REPLACE FUNCTION append_formal_handoff_repair_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO repair_round_events
    (repair_round_id, event_type, formal_handoff_id,
     actor_account_id, occurred_at)
  VALUES
    (NEW.repair_round_id, 'formally_handed_off', NEW.id,
     NEW.handed_off_by, NEW.handed_off_at);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER formal_handoffs_append_repair_event
AFTER INSERT ON formal_handoffs
FOR EACH ROW
EXECUTE FUNCTION append_formal_handoff_repair_event();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION append_formal_handoff_cancellation_repair_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_round_id bigint;
BEGIN
  SELECT repair_round_id INTO target_round_id
  FROM formal_handoffs
  WHERE id = NEW.formal_handoff_id;

  INSERT INTO repair_round_events
    (repair_round_id, event_type, formal_handoff_id, note,
     actor_account_id, occurred_at)
  VALUES
    (target_round_id, 'formal_handoff_cancelled', NEW.formal_handoff_id,
     NEW.reason, NEW.cancelled_by, NEW.cancelled_at);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER formal_handoff_cancellations_append_repair_event
AFTER INSERT ON formal_handoff_cancellations
FOR EACH ROW
EXECUTE FUNCTION append_formal_handoff_cancellation_repair_event();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_formal_handoff_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'formal handoff facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER formal_handoffs_append_only
BEFORE UPDATE OR DELETE ON formal_handoffs
FOR EACH ROW
EXECUTE FUNCTION reject_formal_handoff_fact_change();
--> statement-breakpoint
CREATE TRIGGER formal_handoff_cancellations_append_only
BEFORE UPDATE OR DELETE ON formal_handoff_cancellations
FOR EACH ROW
EXECUTE FUNCTION reject_formal_handoff_fact_change();
