CREATE TYPE "public"."business_order_document_kind" AS ENUM('office_archive', 'mechanic_work');--> statement-breakpoint
CREATE TABLE "business_order_document_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_order_document_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_no" text NOT NULL,
	"business_order_id" bigint NOT NULL,
	"kind" "business_order_document_kind" NOT NULL,
	"charge_version_id" bigint NOT NULL,
	"charge_version_no" integer NOT NULL,
	"repair_round_id" bigint,
	"repair_round_no" integer,
	"render_snapshot" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"generated_by" bigint NOT NULL,
	CONSTRAINT "business_order_document_snapshots_no_kind" CHECK (("business_order_document_snapshots"."kind" = 'office_archive'
            and "business_order_document_snapshots"."document_no" ~ '^OFF-[0-9]{8}-[0-9]{4}$')
          or ("business_order_document_snapshots"."kind" = 'mechanic_work'
            and "business_order_document_snapshots"."document_no" ~ '^MEC-[0-9]{8}-[0-9]{4}$')),
	CONSTRAINT "business_order_document_snapshots_source_shape" CHECK (("business_order_document_snapshots"."kind" = 'office_archive'
            and "business_order_document_snapshots"."repair_round_id" is null
            and "business_order_document_snapshots"."repair_round_no" is null)
          or ("business_order_document_snapshots"."kind" = 'mechanic_work'
            and "business_order_document_snapshots"."repair_round_id" is not null
            and "business_order_document_snapshots"."repair_round_no" >= 1)),
	CONSTRAINT "business_order_document_snapshots_charge_version_positive" CHECK ("business_order_document_snapshots"."charge_version_no" >= 1),
	CONSTRAINT "business_order_document_snapshots_snapshot_object" CHECK (jsonb_typeof("business_order_document_snapshots"."render_snapshot") = 'object'
          and "business_order_document_snapshots"."render_snapshot"->>'version' = '1'
          and "business_order_document_snapshots"."render_snapshot"->>'kind' = "business_order_document_snapshots"."kind"::text)
);
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_charge_version_id_business_order_charge_versions_id_fk" FOREIGN KEY ("charge_version_id") REFERENCES "public"."business_order_charge_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_repair_round_id_repair_rounds_id_fk" FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_generated_by_staff_accounts_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_document_snapshots_no_uq" ON "business_order_document_snapshots" USING btree ("document_no");--> statement-breakpoint
CREATE INDEX "business_order_document_snapshots_order_time_idx" ON "business_order_document_snapshots" USING btree ("business_order_id","generated_at");--> statement-breakpoint
CREATE INDEX "business_order_document_snapshots_round_idx" ON "business_order_document_snapshots" USING btree ("repair_round_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_business_order_document_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM business_order_charge_versions AS charge
    WHERE charge.id = NEW.charge_version_id
      AND charge.business_order_id = NEW.business_order_id
      AND charge.version_no = NEW.charge_version_no
  ) THEN
    RAISE EXCEPTION 'document charge source does not match Business Order';
  END IF;

  IF NEW.kind = 'mechanic_work' AND NOT EXISTS (
    SELECT 1
    FROM repair_rounds AS round
    WHERE round.id = NEW.repair_round_id
      AND round.business_order_id = NEW.business_order_id
      AND round.round_no = NEW.repair_round_no
  ) THEN
    RAISE EXCEPTION 'mechanic document repair round does not match Business Order';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_document_snapshots_source_guard
BEFORE INSERT ON business_order_document_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_business_order_document_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_business_order_document_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Business Order document facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_document_snapshots_append_only
BEFORE UPDATE OR DELETE ON business_order_document_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_business_order_document_change();
