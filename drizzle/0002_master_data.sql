CREATE TYPE "public"."dictionary_category" AS ENUM('payment_method', 'charge_unit', 'staff_position');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "dictionary_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dictionary_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"category" "dictionary_category" NOT NULL,
	"code" text NOT NULL,
	"label_zh" text NOT NULL,
	"label_en" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dictionary_items_code_normalized" CHECK ("dictionary_items"."code" ~ '^[a-z0-9][a-z0-9._-]*$'),
	CONSTRAINT "dictionary_items_label_zh_nonempty" CHECK (length(btrim("dictionary_items"."label_zh")) > 0),
	CONSTRAINT "dictionary_items_sort_nonnegative" CHECK ("dictionary_items"."sort_order" >= 0),
	CONSTRAINT "dictionary_items_version_positive" CHECK ("dictionary_items"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employee_salary_versions" (
	"staff_member_id" bigint NOT NULL,
	"effective_month" date NOT NULL,
	"base_salary_cny_minor" bigint NOT NULL,
	"set_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_salary_versions_pk" PRIMARY KEY("staff_member_id","effective_month"),
	CONSTRAINT "employee_salary_versions_month_start" CHECK ("employee_salary_versions"."effective_month" = date_trunc('month', "employee_salary_versions"."effective_month")::date),
	CONSTRAINT "employee_salary_versions_nonnegative" CHECK ("employee_salary_versions"."base_salary_cny_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_parameter_versions" (
	"effective_month" date PRIMARY KEY NOT NULL,
	"commission_rate" numeric(9, 6) NOT NULL,
	"cny_to_jmd_rate" numeric(18, 6) NOT NULL,
	"set_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_parameter_versions_month_start" CHECK ("payroll_parameter_versions"."effective_month" = date_trunc('month', "payroll_parameter_versions"."effective_month")::date),
	CONSTRAINT "payroll_parameter_versions_commission_valid" CHECK ("payroll_parameter_versions"."commission_rate" > 0 and "payroll_parameter_versions"."commission_rate" <= 1),
	CONSTRAINT "payroll_parameter_versions_exchange_positive" CHECK ("payroll_parameter_versions"."cny_to_jmd_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "repair_team_retirements" (
	"source_team_id" bigint NOT NULL,
	"replacement_team_id" bigint,
	"reason" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" bigint NOT NULL,
	CONSTRAINT "repair_team_retirements_pk" PRIMARY KEY("source_team_id"),
	CONSTRAINT "repair_team_retirements_not_self" CHECK ("repair_team_retirements"."replacement_team_id" is null or "repair_team_retirements"."source_team_id" <> "repair_team_retirements"."replacement_team_id"),
	CONSTRAINT "repair_team_retirements_reason_nonempty" CHECK (length(btrim("repair_team_retirements"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "repair_teams" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repair_teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_no" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "repair_teams_team_no_format" CHECK ("repair_teams"."team_no" ~ '^TEAM-[0-9]{6}-[0-9]{4}$'),
	CONSTRAINT "repair_teams_name_nonempty" CHECK (length(btrim("repair_teams"."name")) > 0),
	CONSTRAINT "repair_teams_normalized_name_nonempty" CHECK (length(btrim("repair_teams"."normalized_name")) > 0),
	CONSTRAINT "repair_teams_version_positive" CHECK ("repair_teams"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_no" text NOT NULL,
	"full_name" text NOT NULL,
	"normalized_phone" text,
	"account_id" bigint,
	"position_item_id" bigint NOT NULL,
	"current_team_id" bigint,
	"status" "employment_status" DEFAULT 'active' NOT NULL,
	"hired_on" date NOT NULL,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_members_staff_no_format" CHECK ("staff_members"."staff_no" ~ '^STAFF-[0-9]{6}-[0-9]{4}$'),
	CONSTRAINT "staff_members_name_nonempty" CHECK (length(btrim("staff_members"."full_name")) > 0),
	CONSTRAINT "staff_members_dates_valid" CHECK ("staff_members"."left_on" is null or "staff_members"."left_on" >= "staff_members"."hired_on"),
	CONSTRAINT "staff_members_version_positive" CHECK ("staff_members"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "staff_team_assignment_versions" (
	"staff_member_id" bigint NOT NULL,
	"effective_month" date NOT NULL,
	"team_id" bigint NOT NULL,
	"set_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_team_assignment_versions_pk" PRIMARY KEY("staff_member_id","effective_month"),
	CONSTRAINT "staff_team_assignment_versions_month_start" CHECK ("staff_team_assignment_versions"."effective_month" = date_trunc('month', "staff_team_assignment_versions"."effective_month")::date)
);
--> statement-breakpoint
ALTER TABLE "dictionary_items" ADD CONSTRAINT "dictionary_items_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_versions" ADD CONSTRAINT "employee_salary_versions_set_by_staff_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parameter_versions" ADD CONSTRAINT "payroll_parameter_versions_set_by_staff_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_team_retirements" ADD CONSTRAINT "repair_team_retirements_source_team_id_repair_teams_id_fk" FOREIGN KEY ("source_team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_team_retirements" ADD CONSTRAINT "repair_team_retirements_replacement_team_id_repair_teams_id_fk" FOREIGN KEY ("replacement_team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_team_retirements" ADD CONSTRAINT "repair_team_retirements_retired_by_staff_accounts_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_teams" ADD CONSTRAINT "repair_teams_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_account_id_staff_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_position_item_id_dictionary_items_id_fk" FOREIGN KEY ("position_item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_current_team_id_repair_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_team_assignment_versions" ADD CONSTRAINT "staff_team_assignment_versions_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_team_assignment_versions" ADD CONSTRAINT "staff_team_assignment_versions_team_id_repair_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."repair_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_team_assignment_versions" ADD CONSTRAINT "staff_team_assignment_versions_set_by_staff_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_items_category_code_uq" ON "dictionary_items" USING btree ("category","code");--> statement-breakpoint
CREATE INDEX "dictionary_items_active_sort_idx" ON "dictionary_items" USING btree ("category","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "employee_salary_versions_month_idx" ON "employee_salary_versions" USING btree ("effective_month");--> statement-breakpoint
CREATE INDEX "repair_team_retirements_replacement_idx" ON "repair_team_retirements" USING btree ("replacement_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_teams_team_no_uq" ON "repair_teams" USING btree ("team_no");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_teams_normalized_name_uq" ON "repair_teams" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "repair_teams_active_idx" ON "repair_teams" USING btree ("is_active","name");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_staff_no_uq" ON "staff_members" USING btree ("staff_no");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_account_id_uq" ON "staff_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_normalized_phone_uq" ON "staff_members" USING btree ("normalized_phone");--> statement-breakpoint
CREATE INDEX "staff_members_current_team_idx" ON "staff_members" USING btree ("current_team_id","status");--> statement-breakpoint
CREATE INDEX "staff_members_position_idx" ON "staff_members" USING btree ("position_item_id","status");--> statement-breakpoint
CREATE INDEX "staff_team_assignment_versions_team_month_idx" ON "staff_team_assignment_versions" USING btree ("team_id","effective_month");