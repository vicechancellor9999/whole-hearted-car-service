ALTER TYPE "public"."business_order_document_kind" ADD VALUE IF NOT EXISTS 'customer_copy';
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" DROP CONSTRAINT "business_order_document_snapshots_no_kind";
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_no_kind" CHECK (
  ("kind" = 'customer_copy' and "document_no" ~ '^CUS-[0-9]{8}-[0-9]{4}$')
  or ("kind" = 'office_archive' and "document_no" ~ '^OFF-[0-9]{8}-[0-9]{4}$')
  or ("kind" = 'mechanic_work' and "document_no" ~ '^MEC-[0-9]{8}-[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" DROP CONSTRAINT "business_order_document_snapshots_source_shape";
--> statement-breakpoint
ALTER TABLE "business_order_document_snapshots" ADD CONSTRAINT "business_order_document_snapshots_source_shape" CHECK (
  ("kind" in ('customer_copy', 'office_archive') and "repair_round_id" is null and "repair_round_no" is null)
  or ("kind" = 'mechanic_work' and "repair_round_id" is not null and "repair_round_no" >= 1)
);
