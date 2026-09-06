ALTER TABLE "inspection_reports"
ADD COLUMN "current_workspace_version_no" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "inspection_reports"
ADD CONSTRAINT "inspection_reports_workspace_version_nonnegative"
CHECK ("current_workspace_version_no" >= 0);
--> statement-breakpoint
CREATE TABLE "inspection_report_workspace_versions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (
    sequence name "inspection_report_workspace_versions_id_seq"
    INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1
  ),
  "inspection_report_id" bigint NOT NULL,
  "version_no" integer NOT NULL,
  "organized_content" jsonb NOT NULL,
  "quotation" jsonb NOT NULL,
  "source" text NOT NULL,
  "change_reason" text NOT NULL,
  "created_by" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inspection_report_workspace_version_positive" CHECK ("version_no" >= 1),
  CONSTRAINT "inspection_report_workspace_organized_object" CHECK (jsonb_typeof("organized_content") = 'object'),
  CONSTRAINT "inspection_report_workspace_quotation_object" CHECK (jsonb_typeof("quotation") = 'object'),
  CONSTRAINT "inspection_report_workspace_quotation_status" CHECK ("quotation"->>'status' in ('pending', 'entered', 'not_quoted')),
  CONSTRAINT "inspection_report_workspace_source" CHECK ("source" in ('manual', 'ai')),
  CONSTRAINT "inspection_report_workspace_reason_nonempty" CHECK (length(btrim("change_reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "inspection_report_workspace_versions"
ADD CONSTRAINT "inspection_report_workspace_versions_report_fk"
FOREIGN KEY ("inspection_report_id") REFERENCES "public"."inspection_reports"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inspection_report_workspace_versions"
ADD CONSTRAINT "inspection_report_workspace_versions_created_by_fk"
FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_report_workspace_versions_report_version_uq"
ON "inspection_report_workspace_versions" ("inspection_report_id", "version_no");
--> statement-breakpoint
CREATE INDEX "inspection_report_workspace_versions_report_created_idx"
ON "inspection_report_workspace_versions" ("inspection_report_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_inspection_report_workspace_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inspection Report workspace versions are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inspection_report_workspace_versions_append_only
BEFORE UPDATE OR DELETE ON inspection_report_workspace_versions
FOR EACH ROW EXECUTE FUNCTION reject_inspection_report_workspace_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_inspection_report_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.report_no, NEW.vehicle_id, NEW.source_business_order_id,
    NEW.source_repair_round_id, NEW.correction_of_report_id,
    NEW.correction_reason, NEW.summary_zh, NEW.summary_en,
    NEW.inspection_team_id, NEW.actual_inspector_staff_member_id,
    NEW.special_case_notes_zh, NEW.paper_photo_file_id,
    NEW.created_at, NEW.created_by
  ) IS DISTINCT FROM ROW(
    OLD.report_no, OLD.vehicle_id, OLD.source_business_order_id,
    OLD.source_repair_round_id, OLD.correction_of_report_id,
    OLD.correction_reason, OLD.summary_zh, OLD.summary_en,
    OLD.inspection_team_id, OLD.actual_inspector_staff_member_id,
    OLD.special_case_notes_zh, OLD.paper_photo_file_id,
    OLD.created_at, OLD.created_by
  ) THEN
    RAISE EXCEPTION 'Inspection Report content is immutable; append a correction instead';
  END IF;

  IF NEW.status = OLD.status
     AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
     AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by
     AND NEW.current_workspace_version_no = OLD.current_workspace_version_no + 1
     AND NEW.version = OLD.version + 1
     AND EXISTS (
       SELECT 1 FROM inspection_report_workspace_versions
       WHERE inspection_report_id = OLD.id
         AND version_no = NEW.current_workspace_version_no
     ) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft'
     AND NEW.status = 'submitted'
     AND NEW.submitted_at IS NOT NULL
     AND NEW.submitted_by IS NOT NULL
     AND NEW.current_workspace_version_no = OLD.current_workspace_version_no
     AND NEW.version = OLD.version + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'submitted Inspection Report is immutable';
  END IF;
  RAISE EXCEPTION 'invalid Inspection Report update';
END;
$$;
