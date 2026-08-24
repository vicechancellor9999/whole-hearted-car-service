CREATE TYPE "public"."delegated_permission" AS ENUM('sensitive_operations.execute');--> statement-breakpoint
CREATE TABLE "staff_account_permission_grants" (
	"account_id" bigint NOT NULL,
	"permission" "delegated_permission" NOT NULL,
	"granted_by" bigint NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_account_permission_grants_pk" PRIMARY KEY("account_id","permission")
);
--> statement-breakpoint
ALTER TABLE "staff_account_permission_grants" ADD CONSTRAINT "staff_account_permission_grants_account_id_staff_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_account_permission_grants" ADD CONSTRAINT "staff_account_permission_grants_granted_by_staff_accounts_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_account_permission_grants_granted_by_idx" ON "staff_account_permission_grants" USING btree ("granted_by");