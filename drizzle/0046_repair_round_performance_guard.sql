SELECT set_config('whole_hearted.repair_event_projection', 'on', true);
--> statement-breakpoint
WITH active_handoffs AS (
  SELECT DISTINCT ON (handoff.repair_round_id)
         handoff.repair_round_id,
         handoff.performance_minor
  FROM formal_handoffs AS handoff
  LEFT JOIN formal_handoff_cancellations AS cancellation
    ON cancellation.formal_handoff_id = handoff.id
  WHERE cancellation.id IS NULL
  ORDER BY handoff.repair_round_id, handoff.id DESC
)
UPDATE repair_rounds AS round
SET performance_draft_minor = active.performance_minor
FROM active_handoffs AS active
WHERE round.id = active.repair_round_id
  AND round.performance_draft_minor IS NULL;
--> statement-breakpoint
UPDATE repair_rounds
SET performance_draft_minor = 0
WHERE round_no >= 2
  AND performance_draft_minor IS NULL;
--> statement-breakpoint
SELECT set_config('whole_hearted.repair_event_projection', 'off', true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_formal_handoff_performance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_round RECORD;
  expected_performance_minor bigint;
BEGIN
  SELECT round_no, performance_draft_minor
  INTO target_round
  FROM repair_rounds
  WHERE id = NEW.repair_round_id;

  IF target_round.round_no IS NULL THEN
    RAISE EXCEPTION 'formal handoff repair round does not exist';
  END IF;

  IF target_round.performance_draft_minor IS NOT NULL THEN
    expected_performance_minor := target_round.performance_draft_minor;
  ELSIF target_round.round_no = 1 THEN
    SELECT coalesce(sum(item.subtotal_minor), 0)::bigint
    INTO expected_performance_minor
    FROM business_order_charge_items AS item
    WHERE item.charge_version_id = NEW.charge_version_id
      AND item.kind = 'labor';
  ELSE
    expected_performance_minor := 0;
  END IF;

  IF NEW.performance_minor IS DISTINCT FROM expected_performance_minor THEN
    RAISE EXCEPTION 'formal handoff performance does not match repair round draft';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER formal_handoffs_validate_performance
BEFORE INSERT ON formal_handoffs
FOR EACH ROW
EXECUTE FUNCTION validate_formal_handoff_performance();
