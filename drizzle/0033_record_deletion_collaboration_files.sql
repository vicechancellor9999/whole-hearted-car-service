ALTER TABLE "record_deletion_authorized_rows" DROP CONSTRAINT "record_deletion_authorized_rows_table_valid";
--> statement-breakpoint
ALTER TABLE "record_deletion_authorized_rows" ADD CONSTRAINT "record_deletion_authorized_rows_table_valid" CHECK ("table_name" in (
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
  'inspection_reports',
  'inspection_report_findings'
));
