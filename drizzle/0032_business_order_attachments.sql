CREATE TABLE "business_order_attachments" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "business_order_id" bigint NOT NULL REFERENCES "business_orders"("id") ON DELETE restrict,
  "file_id" bigint NOT NULL REFERENCES "stored_files"("id") ON DELETE restrict,
  "category" text NOT NULL,
  "caption" text,
  "message_id" bigint REFERENCES "business_order_messages"("id") ON DELETE restrict,
  "linked_by" bigint NOT NULL REFERENCES "staff_accounts"("id") ON DELETE restrict,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_order_attachments_category_valid" CHECK ("category" in ('customer_signature', 'service_photo', 'financial_evidence', 'other')),
  CONSTRAINT "business_order_attachments_caption_length" CHECK ("caption" is null or length(btrim("caption")) between 1 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_attachments_file_uq" ON "business_order_attachments" ("file_id");
--> statement-breakpoint
CREATE INDEX "business_order_attachments_order_time_idx" ON "business_order_attachments" ("business_order_id", "linked_at", "id");
--> statement-breakpoint
CREATE INDEX "business_order_attachments_message_idx" ON "business_order_attachments" ("message_id");
