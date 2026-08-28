ALTER TABLE "business_order_document_revisions"
  ADD COLUMN "english_file_id" bigint,
  ADD COLUMN "english_content_sha256" text;
--> statement-breakpoint
ALTER TABLE "business_order_document_revisions"
  ADD CONSTRAINT "business_order_document_revisions_english_file_fk"
  FOREIGN KEY ("english_file_id") REFERENCES "stored_files"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "business_order_document_revisions"
  ADD CONSTRAINT "business_order_document_revisions_english_pair"
  CHECK (("english_file_id" IS NULL) = ("english_content_sha256" IS NULL));
--> statement-breakpoint
ALTER TABLE "business_order_document_revisions"
  ADD CONSTRAINT "business_order_document_revisions_english_sha256_format"
  CHECK ("english_content_sha256" IS NULL OR "english_content_sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_document_revisions_english_file_uq"
  ON "business_order_document_revisions" ("english_file_id")
  WHERE "english_file_id" IS NOT NULL;
