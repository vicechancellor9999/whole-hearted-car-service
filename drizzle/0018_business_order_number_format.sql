ALTER TABLE "business_orders" DROP CONSTRAINT "business_orders_order_no_format";--> statement-breakpoint
ALTER TABLE "business_orders" DISABLE TRIGGER "business_orders_identity_void_guard";--> statement-breakpoint
UPDATE "business_orders"
SET "order_no" = 'KGN-WH-' || substring("order_no" from 4 for 8) || lpad(right("order_no", 4), 5, '0')
WHERE "order_no" ~ '^BO-[0-9]{8}-[0-9]{4}$';--> statement-breakpoint
ALTER TABLE "business_orders" ENABLE TRIGGER "business_orders_identity_void_guard";--> statement-breakpoint
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_order_no_format" CHECK ("business_orders"."order_no" ~ '^KGN-WH-[0-9]{13}$');
