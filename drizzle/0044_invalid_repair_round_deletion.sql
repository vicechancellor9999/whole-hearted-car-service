ALTER TABLE "record_deletion_receipts"
DROP CONSTRAINT "record_deletion_receipts_root_kind_valid";
--> statement-breakpoint
ALTER TABLE "record_deletion_receipts"
ADD CONSTRAINT "record_deletion_receipts_root_kind_valid"
CHECK ("root_kind" in (
  'personal_customer',
  'company_customer',
  'vehicle',
  'business_order',
  'inspection_report',
  'repair_round'
));
--> statement-breakpoint
ALTER TABLE "record_deletion_authorized_rows"
DROP CONSTRAINT "record_deletion_authorized_rows_table_valid";
--> statement-breakpoint
ALTER TABLE "record_deletion_authorized_rows"
ADD CONSTRAINT "record_deletion_authorized_rows_table_valid"
CHECK ("table_name" in (
  'personal_customers',
  'company_accounts',
  'company_contacts',
  'vehicles',
  'vehicle_owner_history',
  'vehicle_attachments',
  'stored_files',
  'customer_driver_license_records',
  'business_orders',
  'repair_rounds',
  'repair_round_events',
  'repair_round_work_returns',
  'vehicle_mileage_records',
  'repair_round_intake_photos',
  'formal_handoffs',
  'formal_handoff_cancellations',
  'business_order_charge_items',
  'business_order_notes',
  'business_order_charge_versions',
  'business_order_messages',
  'business_order_message_mentions',
  'business_order_message_revisions',
  'business_order_attachments',
  'business_order_problem_originals',
  'business_order_problem_versions',
  'repair_round_problem_versions',
  'inspection_reports',
  'inspection_report_findings'
));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_repair_round_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'repair_round_intake_photos' THEN
      row_key := OLD.repair_round_id::text || ':' || OLD.file_id::text;
    ELSE
      row_key := OLD.id::text;
    END IF;
    IF record_deletion_row_authorized(TG_TABLE_NAME, row_key) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'repair round facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_formal_handoff_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND record_deletion_row_authorized(TG_TABLE_NAME, OLD.id::text)
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'formal handoff facts are append-only';
END;
$$;
