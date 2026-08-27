ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_plate_nonempty";--> statement-breakpoint
DROP INDEX "vehicles_normalized_plate_uq";--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "plate_display" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "normalized_plate" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_normalized_plate_uq" ON "vehicles" USING btree ("normalized_plate") WHERE "vehicles"."normalized_plate" is not null;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_plate_nonempty" CHECK (("vehicles"."plate_display" is null and "vehicles"."normalized_plate" is null)
          or (length(btrim("vehicles"."plate_display")) > 0 and length(btrim("vehicles"."normalized_plate")) > 0));