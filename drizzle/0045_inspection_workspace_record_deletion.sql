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
  'inspection_report_workspace_versions',
  'inspection_report_findings'
));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_inspection_report_workspace_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND record_deletion_row_authorized(
      'inspection_report_workspace_versions',
      OLD.id::text
    )
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Inspection Report workspace versions are append-only';
END;
$$;
