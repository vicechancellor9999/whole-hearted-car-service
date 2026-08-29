ALTER TABLE "inspection_reports"
  ADD COLUMN "inspection_team_id" bigint,
  ADD COLUMN "special_case_notes_zh" text,
  ALTER COLUMN "actual_inspector_staff_member_id" DROP NOT NULL,
  DROP CONSTRAINT "inspection_reports_submission_complete";
--> statement-breakpoint
UPDATE "inspection_reports" AS report
SET "inspection_team_id" = coalesce(
  (SELECT round."assigned_team_id"
   FROM "repair_rounds" AS round
   WHERE round."id" = report."source_repair_round_id"),
  (SELECT inspector."current_team_id"
   FROM "staff_members" AS inspector
   WHERE inspector."id" = report."actual_inspector_staff_member_id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "inspection_reports" WHERE "inspection_team_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot determine submitting team for every existing Inspection Report';
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "inspection_reports"
  ALTER COLUMN "inspection_team_id" SET NOT NULL,
  ADD CONSTRAINT "inspection_reports_inspection_team_id_repair_teams_id_fk"
    FOREIGN KEY ("inspection_team_id") REFERENCES "repair_teams"("id")
    ON DELETE restrict ON UPDATE no action,
  ADD CONSTRAINT "inspection_reports_special_notes_nonempty"
    CHECK ("special_case_notes_zh" is null or length(btrim("special_case_notes_zh")) > 0),
  ADD CONSTRAINT "inspection_reports_submission_complete"
    CHECK (("status" = 'draft' and "submitted_at" is null and "submitted_by" is null)
      or ("status" = 'submitted' and "submitted_at" is not null and "submitted_by" is not null));
--> statement-breakpoint
CREATE INDEX "inspection_reports_team_created_idx"
  ON "inspection_reports" ("inspection_team_id", "created_at");
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

  IF NOT EXISTS (
    SELECT 1 FROM repair_teams
    WHERE id = NEW.inspection_team_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Inspection Report submitting team is invalid';
  END IF;

  IF NEW.actual_inspector_staff_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff_members
    WHERE id = NEW.actual_inspector_staff_member_id
      AND status = 'active'
      AND current_team_id = NEW.inspection_team_id
  ) THEN
    RAISE EXCEPTION 'Inspection Report inspector does not belong to submitting team';
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
  IF NOT (
    OLD.status = 'draft'
    AND NEW.status = 'submitted'
    AND NEW.submitted_at IS NOT NULL
    AND NEW.submitted_by IS NOT NULL
    AND NEW.version = OLD.version + 1
  ) THEN
    RAISE EXCEPTION 'invalid Inspection Report submission';
  END IF;
  RETURN NEW;
END;
$$;
