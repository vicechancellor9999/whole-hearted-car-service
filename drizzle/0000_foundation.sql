CREATE TYPE "public"."account_role" AS ENUM('super_admin', 'front_desk', 'owner', 'mechanic');--> statement-breakpoint
CREATE TABLE "staff_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"display_name" text NOT NULL,
	"normalized_username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "account_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"session_epoch" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_accounts_session_epoch_positive" CHECK ("staff_accounts"."session_epoch" >= 1),
	CONSTRAINT "staff_accounts_version_positive" CHECK ("staff_accounts"."version" >= 1),
	CONSTRAINT "staff_accounts_normalized_username_nonempty" CHECK (length(btrim("staff_accounts"."normalized_username")) > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_account_id" bigint,
	"event_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"reason" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"request_id" text NOT NULL,
	"ip_address" "inet",
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"session_epoch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" text,
	CONSTRAINT "auth_sessions_session_epoch_positive" CHECK ("auth_sessions"."session_epoch" >= 1),
	CONSTRAINT "auth_sessions_expiry_after_creation" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_last_seen_after_creation" CHECK ("auth_sessions"."last_seen_at" >= "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_revoked_after_creation" CHECK ("auth_sessions"."revoked_at" is null or "auth_sessions"."revoked_at" >= "auth_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD CONSTRAINT "staff_accounts_created_by_staff_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_account_id_staff_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_staff_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_accounts_normalized_username_uq" ON "staff_accounts" USING btree ("normalized_username");--> statement-breakpoint
CREATE INDEX "staff_accounts_created_by_idx" ON "staff_accounts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "audit_events_actor_occurred_at_idx" ON "audit_events" USING btree ("actor_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_object_occurred_at_idx" ON "audit_events" USING btree ("object_type","object_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_event_type_occurred_at_idx" ON "audit_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_request_id_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_account_id_idx" ON "auth_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_active_account_idx" ON "auth_sessions" USING btree ("account_id","expires_at") WHERE "auth_sessions"."revoked_at" is null;
--> statement-breakpoint
CREATE FUNCTION "validate_new_auth_session"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_active boolean;
	account_epoch integer;
BEGIN
	SELECT is_active, session_epoch
	INTO account_active, account_epoch
	FROM staff_accounts
	WHERE id = NEW.account_id;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'cannot create session for unknown account';
	END IF;

	IF account_active IS NOT TRUE THEN
		RAISE EXCEPTION 'cannot create session for inactive account';
	END IF;

	IF NEW.session_epoch <> account_epoch THEN
		RAISE EXCEPTION 'session epoch does not match account epoch';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "auth_sessions_validate_account"
BEFORE INSERT ON "auth_sessions"
FOR EACH ROW
EXECUTE FUNCTION "validate_new_auth_session"();
--> statement-breakpoint
CREATE FUNCTION "reject_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "reject_audit_event_mutation"();
