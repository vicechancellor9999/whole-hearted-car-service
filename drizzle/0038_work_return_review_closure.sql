ALTER TABLE "repair_round_work_returns"
  ADD COLUMN "submission_source" text DEFAULT 'electronic' NOT NULL,
  ADD COLUMN "exception_summary" text,
  ADD COLUMN "item_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD CONSTRAINT "repair_round_work_returns_source_valid"
    CHECK ("submission_source" in ('electronic', 'paper')),
  ADD CONSTRAINT "repair_round_work_returns_exception_nonempty"
    CHECK ("exception_summary" is null or length(btrim("exception_summary")) > 0),
  ADD CONSTRAINT "repair_round_work_returns_item_results_array"
    CHECK (jsonb_typeof("item_results") = 'array');
--> statement-breakpoint
CREATE TABLE "repair_round_work_return_attachments" (
  "work_return_id" bigint NOT NULL REFERENCES "repair_round_work_returns"("id") ON DELETE restrict,
  "attachment_id" bigint NOT NULL REFERENCES "business_order_attachments"("id") ON DELETE restrict,
  "purpose" text NOT NULL,
  CONSTRAINT "repair_round_work_return_attachments_pk" PRIMARY KEY ("work_return_id", "attachment_id"),
  CONSTRAINT "repair_round_work_return_attachments_purpose_valid"
    CHECK ("purpose" in ('paper_return', 'service_photo'))
);
--> statement-breakpoint
CREATE INDEX "repair_round_work_return_attachments_attachment_idx"
  ON "repair_round_work_return_attachments" ("attachment_id");
