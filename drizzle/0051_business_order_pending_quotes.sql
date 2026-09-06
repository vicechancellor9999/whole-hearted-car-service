-- Historical rows keep their recorded amounts and are not inferred to be pending.
alter table business_order_charge_items
  add column pending_quote boolean not null default false;
--> statement-breakpoint
alter table business_order_charge_items
  add constraint business_order_charge_items_pending_amounts_zero
  check (not pending_quote or
    (unit_price_minor = 0 and item_discount_minor = 0 and subtotal_minor = 0));
--> statement-breakpoint
-- Preserve the legacy snapshot shape for known prices while validating pending facts.
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
        ) || CASE WHEN item.pending_quote THEN jsonb_build_object('pendingQuote', true) ELSE '{}'::jsonb END
        ORDER BY item.sort_order, item.id
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
