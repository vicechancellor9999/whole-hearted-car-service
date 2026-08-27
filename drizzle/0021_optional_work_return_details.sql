ALTER TABLE "repair_round_work_returns"
  ALTER COLUMN "work_summary" DROP NOT NULL;

ALTER TABLE "repair_round_work_returns"
  ALTER COLUMN "actual_staff_member_id" DROP NOT NULL;

ALTER TABLE "repair_round_work_returns"
  DROP CONSTRAINT IF EXISTS "repair_round_work_returns_summary_nonempty";

ALTER TABLE "repair_round_work_returns"
  ADD CONSTRAINT "repair_round_work_returns_summary_nonempty"
  CHECK ("work_summary" IS NULL OR length(btrim("work_summary")) > 0);
