ALTER TABLE "repair_round_events" DROP CONSTRAINT "repair_round_events_assignment_complete";--> statement-breakpoint
ALTER TABLE "repair_round_events" ADD CONSTRAINT "repair_round_events_assignment_complete" CHECK ("repair_round_events"."event_type"::text not in ('assigned', 'assignment_withdrawn', 'team_responsibility_transferred')
          or ("repair_round_events"."team_id" is not null
              and ("repair_round_events"."event_type"::text <> 'assigned'
                   or "repair_round_events"."customer_confirmed_without_payment" = true)));--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_repair_round_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_round_id bigint;
BEGIN
  PERFORM set_config('whole_hearted.repair_event_projection', 'on', true);

  IF NEW.event_type::text = 'assigned' THEN
    UPDATE repair_rounds
    SET assigned_team_id = NEW.team_id,
        status = 'assigned',
        updated_at = NEW.occurred_at,
        version = version + 1
    WHERE id = NEW.repair_round_id
      AND status = 'waiting_assignment'
      AND assigned_team_id IS NULL
    RETURNING id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'assignment_withdrawn' THEN
    UPDATE repair_rounds AS round
    SET assigned_team_id = NULL,
        status = 'waiting_assignment',
        updated_at = NEW.occurred_at,
        version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.assigned_team_id = NEW.team_id
      AND round.status IN ('assigned', 'in_repair', 'return_pending_review')
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'team_responsibility_transferred' THEN
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
        JOIN repair_teams AS source_team ON source_team.id = retirement.source_team_id
        JOIN repair_teams AS replacement_team ON replacement_team.id = retirement.replacement_team_id
        WHERE retirement.source_team_id = round.assigned_team_id
          AND retirement.replacement_team_id = NEW.team_id
          AND retirement.retired_by = NEW.actor_account_id
          AND retirement.retired_at = NEW.occurred_at
          AND source_team.is_active = false
          AND replacement_team.is_active = true
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'accepted' THEN
    UPDATE repair_rounds
    SET status = 'in_repair', updated_at = NEW.occurred_at, version = version + 1
    WHERE id = NEW.repair_round_id
      AND status = 'assigned'
      AND assigned_team_id = NEW.team_id
    RETURNING id INTO changed_round_id;
  ELSIF NEW.event_type::text IN ('intake_mileage_recorded', 'intake_photo_linked') THEN
    UPDATE repair_rounds
    SET updated_at = NEW.occurred_at, version = version + 1
    WHERE id = NEW.repair_round_id AND status = 'in_repair'
    RETURNING id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'work_return_submitted' THEN
    UPDATE repair_rounds AS round
    SET status = 'return_pending_review', updated_at = NEW.occurred_at, version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'in_repair'
      AND EXISTS (
        SELECT 1 FROM repair_round_work_returns AS work_return
        WHERE work_return.id = NEW.work_return_id AND work_return.repair_round_id = round.id
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'work_return_rejected' THEN
    UPDATE repair_rounds AS round
    SET status = 'in_repair', updated_at = NEW.occurred_at, version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'return_pending_review'
      AND EXISTS (
        SELECT 1 FROM repair_round_work_returns AS work_return
        WHERE work_return.id = NEW.work_return_id AND work_return.repair_round_id = round.id
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'work_return_approved' THEN
    UPDATE repair_rounds AS round
    SET updated_at = NEW.occurred_at, version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'return_pending_review'
      AND EXISTS (
        SELECT 1 FROM repair_round_work_returns AS work_return
        WHERE work_return.id = NEW.work_return_id AND work_return.repair_round_id = round.id
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'formally_handed_off' THEN
    UPDATE repair_rounds AS round
    SET status = 'formally_handed_off', updated_at = NEW.occurred_at, version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'return_pending_review'
      AND EXISTS (
        SELECT 1
        FROM formal_handoffs AS handoff
        LEFT JOIN formal_handoff_cancellations AS cancellation ON cancellation.formal_handoff_id = handoff.id
        WHERE handoff.id = NEW.formal_handoff_id
          AND handoff.repair_round_id = round.id
          AND handoff.handed_off_by = NEW.actor_account_id
          AND handoff.handed_off_at = NEW.occurred_at
          AND cancellation.id IS NULL
      )
    RETURNING round.id INTO changed_round_id;
  ELSIF NEW.event_type::text = 'formal_handoff_cancelled' THEN
    UPDATE repair_rounds AS round
    SET status = 'return_pending_review', updated_at = NEW.occurred_at, version = round.version + 1
    WHERE round.id = NEW.repair_round_id
      AND round.status = 'formally_handed_off'
      AND EXISTS (
        SELECT 1
        FROM formal_handoffs AS handoff
        JOIN formal_handoff_cancellations AS cancellation ON cancellation.formal_handoff_id = handoff.id
        WHERE handoff.id = NEW.formal_handoff_id
          AND handoff.repair_round_id = round.id
          AND cancellation.cancelled_by = NEW.actor_account_id
          AND cancellation.cancelled_at = NEW.occurred_at
          AND cancellation.reason = NEW.note
          AND handoff.id = (
            SELECT max(latest.id) FROM formal_handoffs AS latest
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
