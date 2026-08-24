CREATE TYPE "public"."inspection_report_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "inspection_report_findings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inspection_report_findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"inspection_report_id" bigint NOT NULL,
	"finding_zh" text NOT NULL,
	"finding_en" text,
	"recommendation_zh" text,
	"recommendation_en" text,
	"sort_order" integer NOT NULL,
	CONSTRAINT "inspection_report_findings_text_nonempty" CHECK (length(btrim("inspection_report_findings"."finding_zh")) > 0),
	CONSTRAINT "inspection_report_findings_sort_positive" CHECK ("inspection_report_findings"."sort_order" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inspection_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inspection_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"report_no" text NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"source_business_order_id" bigint,
	"source_repair_round_id" bigint,
	"correction_of_report_id" bigint,
	"correction_reason" text,
	"summary_zh" text NOT NULL,
	"summary_en" text,
	"actual_inspector_staff_member_id" bigint NOT NULL,
	"paper_photo_file_id" bigint,
	"status" "inspection_report_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inspection_reports_number_format" CHECK ("inspection_reports"."report_no" ~ '^IR-[0-9]{8}-[0-9]{4}$'),
	CONSTRAINT "inspection_reports_summary_nonempty" CHECK (length(btrim("inspection_reports"."summary_zh")) > 0),
	CONSTRAINT "inspection_reports_correction_complete" CHECK (("inspection_reports"."correction_of_report_id" is null and "inspection_reports"."correction_reason" is null)
          or ("inspection_reports"."correction_of_report_id" is not null
              and length(btrim("inspection_reports"."correction_reason")) > 0)),
	CONSTRAINT "inspection_reports_submission_complete" CHECK (("inspection_reports"."status" = 'draft'
            and "inspection_reports"."submitted_at" is null and "inspection_reports"."submitted_by" is null)
          or ("inspection_reports"."status" = 'submitted'
            and "inspection_reports"."submitted_at" is not null
            and "inspection_reports"."submitted_by" is not null
            and "inspection_reports"."actual_inspector_staff_member_id" is not null)),
	CONSTRAINT "inspection_reports_version_positive" CHECK ("inspection_reports"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "inspection_report_findings" ADD CONSTRAINT "inspection_report_findings_inspection_report_id_inspection_reports_id_fk" FOREIGN KEY ("inspection_report_id") REFERENCES "public"."inspection_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_source_business_order_id_business_orders_id_fk" FOREIGN KEY ("source_business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_source_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("source_repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_correction_of_report_id_inspection_reports_id_fk" FOREIGN KEY ("correction_of_report_id") REFERENCES "public"."inspection_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_actual_inspector_staff_member_id_staff_members_id_fk" FOREIGN KEY ("actual_inspector_staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_paper_photo_file_id_stored_files_id_fk" FOREIGN KEY ("paper_photo_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_submitted_by_staff_accounts_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_report_findings_report_sort_uq" ON "inspection_report_findings" USING btree ("inspection_report_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_reports_report_no_uq" ON "inspection_reports" USING btree ("report_no");--> statement-breakpoint
CREATE INDEX "inspection_reports_vehicle_created_idx" ON "inspection_reports" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "inspection_reports_source_order_idx" ON "inspection_reports" USING btree ("source_business_order_id");--> statement-breakpoint
CREATE INDEX "inspection_reports_source_round_idx" ON "inspection_reports" USING btree ("source_repair_round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_reports_correction_idx" ON "inspection_reports" USING btree ("correction_of_report_id") WHERE "inspection_reports"."correction_of_report_id" is not null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_inspection_report_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'draft'
     OR NEW.submitted_at IS NOT NULL
     OR NEW.submitted_by IS NOT NULL
     OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'Inspection Report must be created as a draft';
  END IF;

  IF NEW.source_business_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_orders
    WHERE id = NEW.source_business_order_id
      AND vehicle_id = NEW.vehicle_id
  ) THEN
    RAISE EXCEPTION 'Inspection Report source Business Order belongs to another vehicle';
  END IF;

  IF NEW.source_repair_round_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM repair_rounds AS round
    JOIN business_orders AS business_order
      ON business_order.id = round.business_order_id
    WHERE round.id = NEW.source_repair_round_id
      AND business_order.vehicle_id = NEW.vehicle_id
      AND (NEW.source_business_order_id IS NULL
           OR business_order.id = NEW.source_business_order_id)
  ) THEN
    RAISE EXCEPTION 'Inspection Report source repair round is inconsistent';
  END IF;

  IF NEW.correction_of_report_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inspection_reports AS original
    WHERE original.id = NEW.correction_of_report_id
      AND original.vehicle_id = NEW.vehicle_id
      AND original.status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'Inspection Report correction target is invalid';
  END IF;

  IF NEW.paper_photo_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM vehicle_attachments
    WHERE vehicle_id = NEW.vehicle_id
      AND file_id = NEW.paper_photo_file_id
  ) THEN
    RAISE EXCEPTION 'Inspection Report paper photo must be archived on the vehicle';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inspection_reports_link_guard
BEFORE INSERT ON inspection_reports
FOR EACH ROW
EXECUTE FUNCTION validate_inspection_report_links();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_inspection_report_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'submitted Inspection Report is immutable';
  END IF;
  IF ROW(
    NEW.report_no, NEW.vehicle_id, NEW.source_business_order_id,
    NEW.source_repair_round_id, NEW.correction_of_report_id,
    NEW.correction_reason, NEW.summary_zh, NEW.summary_en,
    NEW.actual_inspector_staff_member_id, NEW.paper_photo_file_id,
    NEW.created_at, NEW.created_by
  ) IS DISTINCT FROM ROW(
    OLD.report_no, OLD.vehicle_id, OLD.source_business_order_id,
    OLD.source_repair_round_id, OLD.correction_of_report_id,
    OLD.correction_reason, OLD.summary_zh, OLD.summary_en,
    OLD.actual_inspector_staff_member_id, OLD.paper_photo_file_id,
    OLD.created_at, OLD.created_by
  ) THEN
    RAISE EXCEPTION 'Inspection Report content is immutable; append a correction instead';
  END IF;
  IF NOT (
    OLD.status = 'draft'
    AND NEW.status = 'submitted'
    AND NEW.submitted_at IS NOT NULL
    AND NEW.submitted_by IS NOT NULL
    AND NEW.version = OLD.version + 1
    AND EXISTS (
      SELECT 1 FROM inspection_report_findings
      WHERE inspection_report_id = OLD.id
    )
  ) THEN
    RAISE EXCEPTION 'invalid Inspection Report submission';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inspection_reports_update_guard
BEFORE UPDATE ON inspection_reports
FOR EACH ROW
EXECUTE FUNCTION guard_inspection_report_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_inspection_report_finding_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status inspection_report_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status
    FROM inspection_reports
    WHERE id = NEW.inspection_report_id
    FOR UPDATE;
    IF parent_status = 'draft' THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Inspection Report findings are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inspection_report_findings_insert_guard
BEFORE INSERT ON inspection_report_findings
FOR EACH ROW
EXECUTE FUNCTION guard_inspection_report_finding_change();
--> statement-breakpoint
CREATE TRIGGER inspection_report_findings_append_only
BEFORE UPDATE OR DELETE ON inspection_report_findings
FOR EACH ROW
EXECUTE FUNCTION guard_inspection_report_finding_change();
