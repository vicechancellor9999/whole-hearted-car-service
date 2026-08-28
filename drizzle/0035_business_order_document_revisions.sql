CREATE TABLE "business_order_document_revisions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "document_snapshot_id" bigint NOT NULL,
  "revision_no" integer NOT NULL,
  "field_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "renderer_version" text NOT NULL,
  "file_id" bigint NOT NULL,
  "content_sha256" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "created_by" bigint NOT NULL,
  CONSTRAINT "business_order_document_revisions_revision_positive" CHECK ("revision_no" >= 1),
  CONSTRAINT "business_order_document_revisions_overrides_object" CHECK (jsonb_typeof("field_overrides") = 'object'),
  CONSTRAINT "business_order_document_revisions_renderer_nonempty" CHECK (length(btrim("renderer_version")) > 0),
  CONSTRAINT "business_order_document_revisions_sha256_format" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "business_order_document_revisions" ADD CONSTRAINT "business_order_document_revisions_snapshot_fk" FOREIGN KEY ("document_snapshot_id") REFERENCES "business_order_document_snapshots"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "business_order_document_revisions" ADD CONSTRAINT "business_order_document_revisions_file_fk" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "business_order_document_revisions" ADD CONSTRAINT "business_order_document_revisions_creator_fk" FOREIGN KEY ("created_by") REFERENCES "staff_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_document_revisions_snapshot_no_uq" ON "business_order_document_revisions" ("document_snapshot_id", "revision_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_document_revisions_file_uq" ON "business_order_document_revisions" ("file_id");
--> statement-breakpoint
CREATE INDEX "business_order_document_revisions_snapshot_time_idx" ON "business_order_document_revisions" ("document_snapshot_id", "created_at", "id");
--> statement-breakpoint
CREATE TRIGGER business_order_document_revisions_append_only
BEFORE UPDATE OR DELETE ON business_order_document_revisions
FOR EACH ROW
EXECUTE FUNCTION reject_business_order_document_change();
