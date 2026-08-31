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
CREATE OR REPLACE FUNCTION reject_problem_description_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'business_order_problem_originals' THEN
      row_key := OLD.business_order_id::text;
    ELSE
      row_key := OLD.id::text;
    END IF;
    IF record_deletion_row_authorized(TG_TABLE_NAME, row_key) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'problem description facts are append-only';
END;
$$;
