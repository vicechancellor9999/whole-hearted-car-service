ALTER TABLE "record_deletion_authorized_rows" DROP CONSTRAINT "record_deletion_authorized_rows_table_valid";--> statement-breakpoint
ALTER TABLE "record_deletion_authorized_rows" ADD CONSTRAINT "record_deletion_authorized_rows_table_valid" CHECK ("record_deletion_authorized_rows"."table_name" in (
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
        'inspection_reports',
        'inspection_report_findings'
      ));
--> statement-breakpoint
CREATE FUNCTION "guard_record_deletion_primary_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF record_deletion_row_authorized(TG_TABLE_NAME, OLD.id::text) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'formal record deletion authorization required'
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "personal_customers"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "company_accounts"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "company_contacts"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "vehicles"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "business_orders"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "repair_rounds"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
--> statement-breakpoint
CREATE TRIGGER "record_deletion_primary_delete_guard"
BEFORE DELETE ON "inspection_reports"
FOR EACH ROW EXECUTE FUNCTION "guard_record_deletion_primary_delete"();
