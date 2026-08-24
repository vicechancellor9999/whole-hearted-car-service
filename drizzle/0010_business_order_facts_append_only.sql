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
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_orders_identity_void_guard
BEFORE UPDATE ON business_orders
FOR EACH ROW
EXECUTE FUNCTION guard_business_order_identity_and_void_fact();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_new_charge_version_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_version integer;
BEGIN
  SELECT current_charge_version_no
  INTO current_version
  FROM business_orders
  WHERE id = NEW.business_order_id;

  IF current_version IS NULL OR NEW.version_no <> current_version + 1 THEN
    RAISE EXCEPTION 'charge version must be the next Business Order version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_charge_versions_sequence_guard
BEFORE INSERT ON business_order_charge_versions
FOR EACH ROW
EXECUTE FUNCTION guard_new_charge_version_sequence();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_unsealed_charge_detail_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_version integer;
  current_version integer;
BEGIN
  SELECT charge.version_no, business_order.current_charge_version_no
  INTO target_version, current_version
  FROM business_order_charge_versions AS charge
  JOIN business_orders AS business_order
    ON business_order.id = charge.business_order_id
  WHERE charge.id = NEW.charge_version_id
  FOR UPDATE OF business_order;

  IF target_version IS NULL OR target_version <= current_version THEN
    RAISE EXCEPTION 'charge version is sealed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_charge_items_sealed_guard
BEFORE INSERT ON business_order_charge_items
FOR EACH ROW
EXECUTE FUNCTION guard_unsealed_charge_detail_insert();
--> statement-breakpoint
CREATE TRIGGER business_order_notes_sealed_guard
BEFORE INSERT ON business_order_notes
FOR EACH ROW
EXECUTE FUNCTION guard_unsealed_charge_detail_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_charge_version_before_seal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_row business_order_charge_versions%ROWTYPE;
  item_gross bigint;
  item_discount bigint;
  labor_net bigint;
  part_net bigint;
  other_net bigint;
  expected_gct bigint;
BEGIN
  IF NEW.current_charge_version_no = OLD.current_charge_version_no THEN
    RETURN NEW;
  END IF;
  IF NEW.current_charge_version_no <> OLD.current_charge_version_no + 1 THEN
    RAISE EXCEPTION 'current charge version must advance by one';
  END IF;

  SELECT * INTO version_row
  FROM business_order_charge_versions
  WHERE business_order_id = NEW.id
    AND version_no = NEW.current_charge_version_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'charge version does not exist';
  END IF;

  SELECT
    COALESCE(SUM(round(quantity * unit_price_minor)), 0)::bigint,
    COALESCE(SUM(item_discount_minor), 0)::bigint,
    COALESCE(SUM(subtotal_minor) FILTER (WHERE kind = 'labor'), 0)::bigint,
    COALESCE(SUM(subtotal_minor) FILTER (WHERE kind = 'part'), 0)::bigint,
    COALESCE(SUM(subtotal_minor) FILTER (WHERE kind = 'other'), 0)::bigint
  INTO item_gross, item_discount, labor_net, part_net, other_net
  FROM business_order_charge_items
  WHERE charge_version_id = version_row.id;

  expected_gct := round(version_row.total_due_minor::numeric * 15 / 115)::bigint;
  IF version_row.gross_minor <> item_gross
     OR version_row.line_discount_minor <> item_discount
     OR version_row.labor_discount_minor > labor_net
     OR version_row.part_discount_minor > part_net
     OR version_row.other_discount_minor > other_net
     OR version_row.included_gct_minor <> expected_gct THEN
    RAISE EXCEPTION 'charge version totals do not match items';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_orders_charge_version_seal_guard
BEFORE UPDATE OF current_charge_version_no ON business_orders
FOR EACH ROW
EXECUTE FUNCTION validate_charge_version_before_seal();
