ALTER TABLE "vehicles" ADD COLUMN "engine_number" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "make_zh" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "model_zh" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "body_type" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "fuel_type" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "engine_cc" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "seating" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "usage" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "special_notes" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_engine_cc_valid" CHECK ("vehicles"."engine_cc" is null or "vehicles"."engine_cc" between 1 and 30000);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_seating_valid" CHECK ("vehicles"."seating" is null or "vehicles"."seating" between 1 and 200);