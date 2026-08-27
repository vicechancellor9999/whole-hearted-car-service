CREATE TABLE "team_commission_rate_versions" (
	"team_id" bigint NOT NULL,
	"effective_month" date NOT NULL,
	"commission_rate" numeric(9, 6),
	"set_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_commission_rate_versions_pk" PRIMARY KEY("team_id","effective_month"),
	CONSTRAINT "team_commission_rate_versions_month_start" CHECK ("team_commission_rate_versions"."effective_month" = date_trunc('month', "team_commission_rate_versions"."effective_month")::date),
	CONSTRAINT "team_commission_rate_versions_rate_valid" CHECK ("team_commission_rate_versions"."commission_rate" is null or ("team_commission_rate_versions"."commission_rate" > 0 and "team_commission_rate_versions"."commission_rate" <= 1))
);
--> statement-breakpoint
ALTER TABLE "team_commission_rate_versions" ADD CONSTRAINT "team_commission_rate_versions_team_id_repair_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_commission_rate_versions" ADD CONSTRAINT "team_commission_rate_versions_set_by_staff_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_commission_rate_versions_month_idx" ON "team_commission_rate_versions" USING btree ("effective_month");--> statement-breakpoint
CREATE TRIGGER "team_commission_rate_versions_append_only"
BEFORE UPDATE OR DELETE ON "team_commission_rate_versions"
FOR EACH ROW
EXECUTE FUNCTION "reject_master_data_fact_mutation"();
