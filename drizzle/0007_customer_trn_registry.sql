CREATE TYPE "public"."customer_account_kind" AS ENUM('person', 'company');--> statement-breakpoint
CREATE TABLE "customer_trn_registry" (
	"trn" text PRIMARY KEY NOT NULL,
	"owner_kind" "customer_account_kind" NOT NULL,
	"owner_id" bigint NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_trn_registry_format" CHECK ("customer_trn_registry"."trn" ~ '^[0-9]{9}$'),
	CONSTRAINT "customer_trn_registry_owner_positive" CHECK ("customer_trn_registry"."owner_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_trn_registry_owner_uq" ON "customer_trn_registry" USING btree ("owner_kind","owner_id");