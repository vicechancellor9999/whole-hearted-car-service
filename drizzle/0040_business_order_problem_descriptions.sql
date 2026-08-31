CREATE TYPE "public"."problem_description_source" AS ENUM(
  'creation',
  'manual',
  'customer_concern',
  'inspection_report',
  'ai_suggestion',
  'migration'
);
--> statement-breakpoint
ALTER TABLE "business_orders"
ADD COLUMN "current_problem_description_version_no" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_orders"
ADD CONSTRAINT "business_orders_current_problem_description_version_nonnegative"
CHECK ("current_problem_description_version_no" >= 0);
--> statement-breakpoint
ALTER TABLE "repair_rounds"
ADD COLUMN "current_problem_description_version_no" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "repair_rounds"
ADD CONSTRAINT "repair_rounds_current_problem_description_version_nonnegative"
CHECK ("current_problem_description_version_no" >= 0);
--> statement-breakpoint
CREATE TABLE "business_order_problem_originals" (
  "business_order_id" bigint PRIMARY KEY,
  "content_zh" text,
  "content_en" text,
  "source_type" "problem_description_source" NOT NULL,
  "source_reference_id" bigint,
  "confirmed_by" bigint NOT NULL,
  "confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_order_problem_originals_source_reference_valid"
    CHECK ((("source_type" in ('customer_concern', 'inspection_report', 'ai_suggestion'))
            and "source_reference_id" is not null)
           or (("source_type" in ('creation', 'manual', 'migration'))
               and "source_reference_id" is null))
);
--> statement-breakpoint
CREATE TABLE "business_order_problem_versions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (
    sequence name "business_order_problem_versions_id_seq"
    INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1
  ),
  "business_order_id" bigint NOT NULL,
  "version_no" integer NOT NULL,
  "content_zh" text,
  "content_en" text,
  "source_type" "problem_description_source" NOT NULL,
  "source_reference_id" bigint,
  "change_reason" text NOT NULL,
  "created_by" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_order_problem_versions_version_positive"
    CHECK ("version_no" >= 1),
  CONSTRAINT "business_order_problem_versions_content_present"
    CHECK (coalesce(length(btrim("content_zh")), 0)
           + coalesce(length(btrim("content_en")), 0) > 0),
  CONSTRAINT "business_order_problem_versions_reason_nonempty"
    CHECK (length(btrim("change_reason")) > 0),
  CONSTRAINT "business_order_problem_versions_source_reference_valid"
    CHECK ((("source_type" in ('customer_concern', 'inspection_report', 'ai_suggestion'))
            and "source_reference_id" is not null)
           or (("source_type" in ('creation', 'manual', 'migration'))
               and "source_reference_id" is null))
);
--> statement-breakpoint
CREATE TABLE "repair_round_problem_versions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (
    sequence name "repair_round_problem_versions_id_seq"
    INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1
  ),
  "repair_round_id" bigint NOT NULL,
  "version_no" integer NOT NULL,
  "content_zh" text,
  "content_en" text,
  "source_type" "problem_description_source" NOT NULL,
  "source_reference_id" bigint,
  "change_reason" text NOT NULL,
  "created_by" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "repair_round_problem_versions_version_positive"
    CHECK ("version_no" >= 1),
  CONSTRAINT "repair_round_problem_versions_content_present"
    CHECK (coalesce(length(btrim("content_zh")), 0)
           + coalesce(length(btrim("content_en")), 0) > 0),
  CONSTRAINT "repair_round_problem_versions_reason_nonempty"
    CHECK (length(btrim("change_reason")) > 0),
  CONSTRAINT "repair_round_problem_versions_source_reference_valid"
    CHECK ((("source_type" in ('customer_concern', 'inspection_report', 'ai_suggestion'))
            and "source_reference_id" is not null)
           or (("source_type" in ('creation', 'manual', 'migration'))
               and "source_reference_id" is null))
);
--> statement-breakpoint
ALTER TABLE "business_order_problem_originals"
ADD CONSTRAINT "business_order_problem_originals_business_order_id_business_orders_id_fk"
FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_order_problem_originals"
ADD CONSTRAINT "business_order_problem_originals_confirmed_by_staff_accounts_id_fk"
FOREIGN KEY ("confirmed_by") REFERENCES "public"."staff_accounts"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_order_problem_versions"
ADD CONSTRAINT "business_order_problem_versions_business_order_id_business_orders_id_fk"
FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_order_problem_versions"
ADD CONSTRAINT "business_order_problem_versions_created_by_staff_accounts_id_fk"
FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repair_round_problem_versions"
ADD CONSTRAINT "repair_round_problem_versions_repair_round_id_repair_rounds_id_fk"
FOREIGN KEY ("repair_round_id") REFERENCES "public"."repair_rounds"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repair_round_problem_versions"
ADD CONSTRAINT "repair_round_problem_versions_created_by_staff_accounts_id_fk"
FOREIGN KEY ("created_by") REFERENCES "public"."staff_accounts"("id")
ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "business_order_problem_originals_confirmed_idx"
ON "business_order_problem_originals" ("confirmed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_problem_versions_owner_version_uq"
ON "business_order_problem_versions" ("business_order_id", "version_no");
--> statement-breakpoint
CREATE INDEX "business_order_problem_versions_owner_created_idx"
ON "business_order_problem_versions" ("business_order_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "repair_round_problem_versions_owner_version_uq"
ON "repair_round_problem_versions" ("repair_round_id", "version_no");
--> statement-breakpoint
CREATE INDEX "repair_round_problem_versions_owner_created_idx"
ON "repair_round_problem_versions" ("repair_round_id", "created_at");
--> statement-breakpoint
INSERT INTO "business_order_problem_originals"
  ("business_order_id", "content_zh", "content_en", "source_type",
   "source_reference_id", "confirmed_by", "confirmed_at")
SELECT business_order.id, null, null, 'migration', null,
       business_order.created_by, business_order.created_at
FROM business_orders AS business_order
ON CONFLICT (business_order_id) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_problem_description_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'problem description facts are append-only';
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('business_order_document_snapshots') IS NOT NULL THEN
    ALTER TABLE business_order_document_snapshots
      DROP CONSTRAINT business_order_document_snapshots_snapshot_object;
    ALTER TABLE business_order_document_snapshots
      ADD CONSTRAINT business_order_document_snapshots_snapshot_object
      CHECK (jsonb_typeof(render_snapshot) = 'object'
        and render_snapshot->>'version' in ('1', '2')
        and render_snapshot->>'kind' = kind::text);
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_problem_originals_append_only
BEFORE UPDATE OR DELETE ON business_order_problem_originals
FOR EACH ROW
EXECUTE FUNCTION reject_problem_description_fact_change();
--> statement-breakpoint
CREATE TRIGGER business_order_problem_versions_append_only
BEFORE UPDATE OR DELETE ON business_order_problem_versions
FOR EACH ROW
EXECUTE FUNCTION reject_problem_description_fact_change();
--> statement-breakpoint
CREATE TRIGGER repair_round_problem_versions_append_only
BEFORE UPDATE OR DELETE ON repair_round_problem_versions
FOR EACH ROW
EXECUTE FUNCTION reject_problem_description_fact_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_business_order_problem_version_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_version integer;
BEGIN
  SELECT current_problem_description_version_no
  INTO current_version
  FROM business_orders
  WHERE id = NEW.business_order_id
  FOR UPDATE;

  IF current_version IS NULL OR NEW.version_no <> current_version + 1 THEN
    RAISE EXCEPTION 'problem description version must be the next Business Order version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_problem_versions_sequence_guard
BEFORE INSERT ON business_order_problem_versions
FOR EACH ROW
EXECUTE FUNCTION guard_business_order_problem_version_sequence();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_repair_round_problem_version_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_version integer;
BEGIN
  SELECT current_problem_description_version_no
  INTO current_version
  FROM repair_rounds
  WHERE id = NEW.repair_round_id
  FOR UPDATE;

  IF current_version IS NULL OR NEW.version_no <> current_version + 1 THEN
    RAISE EXCEPTION 'problem description version must be the next repair-round version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_round_problem_versions_sequence_guard
BEFORE INSERT ON repair_round_problem_versions
FOR EACH ROW
EXECUTE FUNCTION guard_repair_round_problem_version_sequence();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_business_order_problem_version_pointer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_problem_description_version_no
     = OLD.current_problem_description_version_no THEN
    RETURN NEW;
  END IF;
  IF NEW.current_problem_description_version_no
     <> OLD.current_problem_description_version_no + 1 THEN
    RAISE EXCEPTION 'current Business Order problem description version must advance by one'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM business_order_problem_versions
    WHERE business_order_id = NEW.id
      AND version_no = NEW.current_problem_description_version_no
  ) THEN
    RAISE EXCEPTION 'Business Order problem description version does not exist'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_orders_problem_version_pointer_guard
BEFORE UPDATE OF current_problem_description_version_no ON business_orders
FOR EACH ROW
EXECUTE FUNCTION validate_business_order_problem_version_pointer();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_repair_round_problem_version_pointer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_problem_description_version_no
     = OLD.current_problem_description_version_no THEN
    RETURN NEW;
  END IF;
  IF NEW.current_problem_description_version_no
     <> OLD.current_problem_description_version_no + 1 THEN
    RAISE EXCEPTION 'current repair-round problem description version must advance by one'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM repair_round_problem_versions
    WHERE repair_round_id = NEW.id
      AND version_no = NEW.current_problem_description_version_no
  ) THEN
    RAISE EXCEPTION 'repair-round problem description version does not exist'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER repair_rounds_problem_version_pointer_guard
BEFORE UPDATE OF current_problem_description_version_no ON repair_rounds
FOR EACH ROW
EXECUTE FUNCTION validate_repair_round_problem_version_pointer();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_repair_round_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('whole_hearted.repair_event_projection', true) IS DISTINCT FROM 'on'
     AND (to_jsonb(NEW) - 'current_problem_description_version_no')
         IS DISTINCT FROM
         (to_jsonb(OLD) - 'current_problem_description_version_no') THEN
    RAISE EXCEPTION 'repair round state can only be projected from an event fact';
  END IF;
  IF ROW(
    NEW.business_order_id, NEW.round_no, NEW.source,
    NEW.after_sales_issue, NEW.created_at, NEW.created_by
  ) IS DISTINCT FROM ROW(
    OLD.business_order_id, OLD.round_no, OLD.source,
    OLD.after_sales_issue, OLD.created_at, OLD.created_by
  ) THEN
    RAISE EXCEPTION 'repair round identity facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
