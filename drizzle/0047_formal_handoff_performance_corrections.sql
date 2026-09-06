ALTER TABLE "formal_handoffs"
ADD COLUMN "corrects_formal_handoff_id" bigint;
--> statement-breakpoint
ALTER TABLE "formal_handoffs"
ADD CONSTRAINT "formal_handoffs_corrects_formal_handoff_id_fk"
FOREIGN KEY ("corrects_formal_handoff_id")
REFERENCES "public"."formal_handoffs"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "formal_handoffs_correction_source_uq"
ON "formal_handoffs" USING btree ("corrects_formal_handoff_id");
--> statement-breakpoint
DROP TRIGGER "formal_handoffs_validate_fact" ON "formal_handoffs";
--> statement-breakpoint
CREATE TRIGGER "formal_handoffs_validate_initial_fact"
BEFORE INSERT ON "formal_handoffs"
FOR EACH ROW
WHEN (NEW.corrects_formal_handoff_id IS NULL)
EXECUTE FUNCTION validate_formal_handoff_fact();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_formal_handoff_performance_correction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_order RECORD;
  target_round RECORD;
  source_handoff RECORD;
  source_cancellation RECORD;
  expected_handoff_no integer;
BEGIN
  SELECT id, voided_at
  INTO current_order
  FROM business_orders
  WHERE id = NEW.business_order_id
  FOR UPDATE;

  SELECT id, business_order_id, round_no, status, assigned_team_id
  INTO target_round
  FROM repair_rounds
  WHERE id = NEW.repair_round_id;

  SELECT *
  INTO source_handoff
  FROM formal_handoffs
  WHERE id = NEW.corrects_formal_handoff_id
  FOR UPDATE;

  SELECT formal_handoff_id, jamaica_month, cancelled_at, cancelled_by
  INTO source_cancellation
  FROM formal_handoff_cancellations
  WHERE formal_handoff_id = NEW.corrects_formal_handoff_id;

  SELECT coalesce(max(handoff_no), 0) + 1
  INTO expected_handoff_no
  FROM formal_handoffs
  WHERE business_order_id = NEW.business_order_id;

  IF current_order.id IS NULL OR current_order.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Business Order does not allow formal handoff correction';
  END IF;
  IF source_handoff.id IS NULL OR source_cancellation.formal_handoff_id IS NULL THEN
    RAISE EXCEPTION 'performance correction must replace a cancelled formal handoff';
  END IF;
  IF target_round.id IS NULL
     OR target_round.business_order_id <> NEW.business_order_id
     OR target_round.round_no <> NEW.repair_round_no
     OR target_round.status <> 'return_pending_review'
     OR target_round.assigned_team_id IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'performance correction repair round is not ready';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM formal_handoffs AS handoff
    LEFT JOIN formal_handoff_cancellations AS cancellation
      ON cancellation.formal_handoff_id = handoff.id
    WHERE handoff.repair_round_id = NEW.repair_round_id
      AND cancellation.id IS NULL
  ) THEN
    RAISE EXCEPTION 'repair round already has an active formal handoff';
  END IF;
  IF NEW.handoff_no <> expected_handoff_no THEN
    RAISE EXCEPTION 'formal handoff number is not the next Business Order fact';
  END IF;
  IF ROW(
       NEW.business_order_id,
       NEW.repair_round_id,
       NEW.repair_round_no,
       NEW.team_id,
       NEW.jamaica_month,
       NEW.charge_version_id,
       NEW.charge_version_no,
       NEW.gross_minor,
       NEW.line_discount_minor,
       NEW.labor_discount_minor,
       NEW.part_discount_minor,
       NEW.other_discount_minor,
       NEW.category_discount_minor,
       NEW.whole_order_discount_minor,
       NEW.total_due_minor,
       NEW.included_gct_minor,
       NEW.charge_snapshot
     ) IS DISTINCT FROM ROW(
       source_handoff.business_order_id,
       source_handoff.repair_round_id,
       source_handoff.repair_round_no,
       source_handoff.team_id,
       source_handoff.jamaica_month,
       source_handoff.charge_version_id,
       source_handoff.charge_version_no,
       source_handoff.gross_minor,
       source_handoff.line_discount_minor,
       source_handoff.labor_discount_minor,
       source_handoff.part_discount_minor,
       source_handoff.other_discount_minor,
       source_handoff.category_discount_minor,
       source_handoff.whole_order_discount_minor,
       source_handoff.total_due_minor,
       source_handoff.included_gct_minor,
       source_handoff.charge_snapshot
     ) THEN
    RAISE EXCEPTION 'performance correction must preserve the frozen handoff snapshot';
  END IF;
  IF source_cancellation.jamaica_month IS DISTINCT FROM NEW.jamaica_month
     OR source_cancellation.cancelled_at IS DISTINCT FROM NEW.handed_off_at
     OR source_cancellation.cancelled_by IS DISTINCT FROM NEW.handed_off_by THEN
    RAISE EXCEPTION 'performance correction must follow its cancellation fact';
  END IF;
  IF NEW.jamaica_month IS DISTINCT FROM
     date_trunc('month', NEW.handed_off_at AT TIME ZONE 'America/Jamaica')::date THEN
    RAISE EXCEPTION 'formal handoff Jamaica month does not match handoff time';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "formal_handoffs_validate_correction_fact"
BEFORE INSERT ON "formal_handoffs"
FOR EACH ROW
WHEN (NEW.corrects_formal_handoff_id IS NOT NULL)
EXECUTE FUNCTION validate_formal_handoff_performance_correction();
