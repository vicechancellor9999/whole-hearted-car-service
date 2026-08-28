CREATE TABLE "record_deletion_file_tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "record_deletion_file_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"storage_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "record_deletion_file_tasks_storage_nonempty" CHECK (length(btrim("record_deletion_file_tasks"."storage_key")) > 0),
	CONSTRAINT "record_deletion_file_tasks_state_valid" CHECK ("record_deletion_file_tasks"."state" in ('pending', 'failed', 'completed')),
	CONSTRAINT "record_deletion_file_tasks_attempt_nonnegative" CHECK ("record_deletion_file_tasks"."attempt_count" >= 0),
	CONSTRAINT "record_deletion_file_tasks_completion_complete" CHECK (("record_deletion_file_tasks"."state" = 'completed' and "record_deletion_file_tasks"."completed_at" is not null)
          or ("record_deletion_file_tasks"."state" <> 'completed' and "record_deletion_file_tasks"."completed_at" is null)),
	CONSTRAINT "record_deletion_file_tasks_error_complete" CHECK (("record_deletion_file_tasks"."state" = 'failed' and length(btrim("record_deletion_file_tasks"."last_error_code")) > 0)
          or ("record_deletion_file_tasks"."state" <> 'failed' and "record_deletion_file_tasks"."last_error_code" is null))
);
--> statement-breakpoint
CREATE TABLE "record_deletion_receipts" (
	"request_id" text PRIMARY KEY NOT NULL,
	"actor_account_id" bigint NOT NULL,
	"payload_hash" text NOT NULL,
	"root_kind" text NOT NULL,
	"root_record_no" text NOT NULL,
	"reason_code" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_deletion_receipts_request_nonempty" CHECK (length(btrim("record_deletion_receipts"."request_id")) > 0),
	CONSTRAINT "record_deletion_receipts_payload_hash_format" CHECK ("record_deletion_receipts"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "record_deletion_receipts_root_kind_valid" CHECK ("record_deletion_receipts"."root_kind" in ('personal_customer', 'company_customer', 'vehicle', 'business_order', 'inspection_report')),
	CONSTRAINT "record_deletion_receipts_root_record_nonempty" CHECK (length(btrim("record_deletion_receipts"."root_record_no")) > 0),
	CONSTRAINT "record_deletion_receipts_reason_valid" CHECK ("record_deletion_receipts"."reason_code" in ('duplicate', 'input_error', 'test_data', 'other'))
);
--> statement-breakpoint
ALTER TABLE "record_deletion_receipts" ADD CONSTRAINT "record_deletion_receipts_actor_account_id_staff_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_deletion_file_tasks_incomplete_storage_uq" ON "record_deletion_file_tasks" USING btree ("storage_key") WHERE "record_deletion_file_tasks"."state" <> 'completed';--> statement-breakpoint
CREATE INDEX "record_deletion_file_tasks_state_created_idx" ON "record_deletion_file_tasks" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "record_deletion_receipts_actor_created_idx" ON "record_deletion_receipts" USING btree ("actor_account_id","created_at");