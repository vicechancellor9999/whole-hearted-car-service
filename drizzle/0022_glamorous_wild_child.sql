CREATE TYPE "public"."inspection_report_communication_channel" AS ENUM('sms', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."inspection_report_communication_status" AS ENUM('initiated', 'confirmed', 'not_delivered');--> statement-breakpoint
CREATE TABLE "inspection_report_communications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inspection_report_communications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"inspection_report_id" bigint NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"source_business_order_id" bigint,
	"channel" "inspection_report_communication_channel" NOT NULL,
	"target_contact" text NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	"initiated_by" bigint NOT NULL,
	"status" "inspection_report_communication_status" DEFAULT 'initiated' NOT NULL,
	"note_or_reply" text,
	CONSTRAINT "inspection_report_communications_target_nonempty" CHECK (length(btrim("inspection_report_communications"."target_contact")) > 0),
	CONSTRAINT "inspection_report_communications_note_nonempty" CHECK ("inspection_report_communications"."note_or_reply" is null or length(btrim("inspection_report_communications"."note_or_reply")) > 0)
);
--> statement-breakpoint
ALTER TABLE "inspection_report_communications" ADD CONSTRAINT "inspection_report_communications_inspection_report_id_inspection_reports_id_fk" FOREIGN KEY ("inspection_report_id") REFERENCES "public"."inspection_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_report_communications" ADD CONSTRAINT "inspection_report_communications_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_report_communications" ADD CONSTRAINT "inspection_report_communications_source_business_order_id_business_orders_id_fk" FOREIGN KEY ("source_business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_report_communications" ADD CONSTRAINT "inspection_report_communications_initiated_by_staff_accounts_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_report_communications_report_time_idx" ON "inspection_report_communications" USING btree ("inspection_report_id","initiated_at");--> statement-breakpoint
CREATE INDEX "inspection_report_communications_vehicle_time_idx" ON "inspection_report_communications" USING btree ("vehicle_id","initiated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_inspection_report_communication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  report_vehicle_id bigint;
  report_source_business_order_id bigint;
BEGIN
  SELECT vehicle_id, source_business_order_id
    INTO report_vehicle_id, report_source_business_order_id
    FROM inspection_reports WHERE id = NEW.inspection_report_id;
  IF NOT FOUND
     OR NEW.vehicle_id <> report_vehicle_id
     OR NEW.source_business_order_id IS DISTINCT FROM report_source_business_order_id THEN
    RAISE EXCEPTION 'Inspection Report communication links must match the report';
  END IF;
  IF NEW.status <> 'initiated' THEN
    RAISE EXCEPTION 'Inspection Report communication may only record an initiated external notification';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER inspection_report_communications_link_guard
BEFORE INSERT ON inspection_report_communications
FOR EACH ROW EXECUTE FUNCTION validate_inspection_report_communication();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_inspection_report_communication_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Inspection Report communication facts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER inspection_report_communications_append_only
BEFORE UPDATE OR DELETE ON inspection_report_communications
FOR EACH ROW EXECUTE FUNCTION guard_inspection_report_communication_update();
