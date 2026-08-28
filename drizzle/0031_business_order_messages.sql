ALTER TABLE "business_order_document_snapshots" DROP CONSTRAINT "business_order_document_snapshots_no_kind";
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_no_kind" CHECK (
  ("kind"::text = 'customer_copy' and "document_no" ~ '^CUS-[0-9]{8}-[0-9]{4}$')
  or ("kind"::text = 'office_archive' and "document_no" ~ '^OFF-[0-9]{8}-[0-9]{4}$')
  or ("kind"::text = 'mechanic_work' and "document_no" ~ '^MEC-[0-9]{8}-[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" DROP CONSTRAINT "business_order_document_snapshots_source_shape";
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_source_shape" CHECK (
  ("kind"::text in ('customer_copy', 'office_archive') and "repair_round_id" is null and "repair_round_no" is null)
  or ("kind"::text = 'mechanic_work' and "repair_round_id" is not null and "repair_round_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "business_order_messages" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "business_order_id" bigint NOT NULL REFERENCES "business_orders"("id") ON DELETE restrict,
  "author_account_id" bigint NOT NULL REFERENCES "staff_accounts"("id") ON DELETE restrict,
  "author_display_name" text NOT NULL,
  "author_role" text NOT NULL,
  "body" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone,
  CONSTRAINT "business_order_messages_body_length" CHECK (length(btrim("body")) between 1 and 4000),
  CONSTRAINT "business_order_messages_version_positive" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "business_order_message_mentions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "message_id" bigint NOT NULL REFERENCES "business_order_messages"("id") ON DELETE restrict,
  "mentioned_account_id" bigint NOT NULL REFERENCES "staff_accounts"("id") ON DELETE restrict,
  "mentioned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "business_order_message_revisions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "message_id" bigint NOT NULL REFERENCES "business_order_messages"("id") ON DELETE restrict,
  "replaced_version" integer NOT NULL,
  "previous_body" text NOT NULL,
  "edited_by" bigint NOT NULL REFERENCES "staff_accounts"("id") ON DELETE restrict,
  "edited_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_order_message_revisions_version_positive" CHECK ("replaced_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX "business_order_messages_order_time_idx" ON "business_order_messages" ("business_order_id", "created_at", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_message_mentions_message_account_uq" ON "business_order_message_mentions" ("message_id", "mentioned_account_id");
--> statement-breakpoint
CREATE INDEX "business_order_message_mentions_account_read_idx" ON "business_order_message_mentions" ("mentioned_account_id", "read_at", "mentioned_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_message_revisions_message_version_uq" ON "business_order_message_revisions" ("message_id", "replaced_version");
