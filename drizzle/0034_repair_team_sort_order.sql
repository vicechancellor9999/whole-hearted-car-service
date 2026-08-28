ALTER TABLE "repair_teams" ADD COLUMN "sort_order" integer;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY id) - 1 AS position
  FROM repair_teams
)
UPDATE repair_teams
SET sort_order = ordered.position
FROM ordered
WHERE repair_teams.id = ordered.id;
--> statement-breakpoint
ALTER TABLE "repair_teams" ALTER COLUMN "sort_order" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "repair_teams" ALTER COLUMN "sort_order" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "repair_teams" ADD CONSTRAINT "repair_teams_sort_nonnegative" CHECK ("repair_teams"."sort_order" >= 0);
--> statement-breakpoint
DROP INDEX IF EXISTS "repair_teams_active_idx";
--> statement-breakpoint
CREATE INDEX "repair_teams_active_idx" ON "repair_teams" USING btree ("is_active", "sort_order", "id");
