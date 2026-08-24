CREATE TYPE "public"."refund_evidence_kind" AS ENUM('refund_proof', 'customer_signature');--> statement-breakpoint
CREATE TYPE "public"."refund_original_document_status" AS ENUM('returned', 'unavailable');--> statement-breakpoint
CREATE TABLE "business_order_payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_order_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_no" text NOT NULL,
	"business_order_id" bigint NOT NULL,
	"payment_method_item_id" bigint NOT NULL,
	"payment_method_code_snapshot" text NOT NULL,
	"payment_method_label_zh_snapshot" text NOT NULL,
	"payment_method_label_en_snapshot" text,
	"amount_minor" bigint NOT NULL,
	"note" text,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" bigint NOT NULL,
	CONSTRAINT "business_order_payments_no_format" CHECK ("business_order_payments"."payment_no" ~ '^PAY-[0-9]{8}-[0-9]{4}$'),
	CONSTRAINT "business_order_payments_amount_positive" CHECK ("business_order_payments"."amount_minor" > 0),
	CONSTRAINT "business_order_payments_method_snapshot_nonempty" CHECK (length(btrim("business_order_payments"."payment_method_code_snapshot")) > 0
          and length(btrim("business_order_payments"."payment_method_label_zh_snapshot")) > 0),
	CONSTRAINT "business_order_payments_note_nonempty" CHECK ("business_order_payments"."note" is null or length(btrim("business_order_payments"."note")) > 0)
);
--> statement-breakpoint
CREATE TABLE "business_order_refunds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_order_refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"refund_no" text NOT NULL,
	"business_order_id" bigint NOT NULL,
	"payment_method_item_id" bigint NOT NULL,
	"payment_method_code_snapshot" text NOT NULL,
	"payment_method_label_zh_snapshot" text NOT NULL,
	"payment_method_label_en_snapshot" text,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"original_document_status" "refund_original_document_status" NOT NULL,
	"original_document_note" text,
	"refunded_at" timestamp with time zone NOT NULL,
	"recorded_by" bigint NOT NULL,
	CONSTRAINT "business_order_refunds_no_format" CHECK ("business_order_refunds"."refund_no" ~ '^RFD-[0-9]{8}-[0-9]{4}$'),
	CONSTRAINT "business_order_refunds_amount_positive" CHECK ("business_order_refunds"."amount_minor" > 0),
	CONSTRAINT "business_order_refunds_reason_nonempty" CHECK (length(btrim("business_order_refunds"."reason")) > 0),
	CONSTRAINT "business_order_refunds_method_snapshot_nonempty" CHECK (length(btrim("business_order_refunds"."payment_method_code_snapshot")) > 0
          and length(btrim("business_order_refunds"."payment_method_label_zh_snapshot")) > 0),
	CONSTRAINT "business_order_refunds_original_document_note" CHECK (("business_order_refunds"."original_document_status" = 'returned' and "business_order_refunds"."original_document_note" is null)
          or ("business_order_refunds"."original_document_status" = 'unavailable'
              and length(btrim("business_order_refunds"."original_document_note")) > 0))
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_no" text NOT NULL,
	"payment_id" bigint NOT NULL,
	"business_order_id" bigint NOT NULL,
	"render_snapshot" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by" bigint NOT NULL,
	CONSTRAINT "payment_receipts_no_format" CHECK ("payment_receipts"."receipt_no" ~ '^RCT-[0-9]{8}-[0-9]{4}$'),
	CONSTRAINT "payment_receipts_snapshot_object" CHECK (jsonb_typeof("payment_receipts"."render_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "refund_evidence_files" (
	"refund_id" bigint NOT NULL,
	"file_id" bigint NOT NULL,
	"kind" "refund_evidence_kind" NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"linked_by" bigint NOT NULL,
	CONSTRAINT "refund_evidence_files_pk" PRIMARY KEY("refund_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "business_order_payments" ADD CONSTRAINT "business_order_payments_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_payments" ADD CONSTRAINT "business_order_payments_payment_method_item_id_dictionary_items_id_fk" FOREIGN KEY ("payment_method_item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_payments" ADD CONSTRAINT "business_order_payments_recorded_by_staff_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_refunds" ADD CONSTRAINT "business_order_refunds_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_refunds" ADD CONSTRAINT "business_order_refunds_payment_method_item_id_dictionary_items_id_fk" FOREIGN KEY ("payment_method_item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_order_refunds" ADD CONSTRAINT "business_order_refunds_recorded_by_staff_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_payment_id_business_order_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."business_order_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_business_order_id_business_orders_id_fk" FOREIGN KEY ("business_order_id") REFERENCES "public"."business_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_issued_by_staff_accounts_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_evidence_files" ADD CONSTRAINT "refund_evidence_files_refund_id_business_order_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."business_order_refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_evidence_files" ADD CONSTRAINT "refund_evidence_files_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_evidence_files" ADD CONSTRAINT "refund_evidence_files_linked_by_staff_accounts_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_payments_no_uq" ON "business_order_payments" USING btree ("payment_no");--> statement-breakpoint
CREATE INDEX "business_order_payments_order_time_idx" ON "business_order_payments" USING btree ("business_order_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_order_refunds_no_uq" ON "business_order_refunds" USING btree ("refund_no");--> statement-breakpoint
CREATE INDEX "business_order_refunds_order_time_idx" ON "business_order_refunds" USING btree ("business_order_id","refunded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipts_no_uq" ON "payment_receipts" USING btree ("receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipts_payment_uq" ON "payment_receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_receipts_order_time_idx" ON "payment_receipts" USING btree ("business_order_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_evidence_files_file_uq" ON "refund_evidence_files" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_evidence_files_refund_kind_uq" ON "refund_evidence_files" USING btree ("refund_id","kind");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_financial_method_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  method RECORD;
BEGIN
  SELECT category, code, label_zh, label_en, is_active
  INTO method
  FROM dictionary_items
  WHERE id = NEW.payment_method_item_id;

  IF method.category IS DISTINCT FROM 'payment_method'::dictionary_category
     OR method.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'financial transaction requires an active payment method';
  END IF;
  IF NEW.payment_method_code_snapshot IS DISTINCT FROM method.code
     OR NEW.payment_method_label_zh_snapshot IS DISTINCT FROM method.label_zh
     OR NEW.payment_method_label_en_snapshot IS DISTINCT FROM method.label_en THEN
    RAISE EXCEPTION 'payment method snapshot does not match dictionary fact';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_payments_method_guard
BEFORE INSERT ON business_order_payments
FOR EACH ROW
EXECUTE FUNCTION validate_financial_method_snapshot();
--> statement-breakpoint
CREATE TRIGGER business_order_refunds_method_guard
BEFORE INSERT ON business_order_refunds
FOR EACH ROW
EXECUTE FUNCTION validate_financial_method_snapshot();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_payment_receipt_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payment RECORD;
BEGIN
  SELECT business_order_id, paid_at, recorded_by
  INTO payment
  FROM business_order_payments
  WHERE id = NEW.payment_id;

  IF payment.business_order_id IS NULL
     OR NEW.business_order_id IS DISTINCT FROM payment.business_order_id
     OR NEW.issued_at IS DISTINCT FROM payment.paid_at
     OR NEW.issued_by IS DISTINCT FROM payment.recorded_by THEN
    RAISE EXCEPTION 'Receipt must match its payment fact';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_receipts_fact_guard
BEFORE INSERT ON payment_receipts
FOR EACH ROW
EXECUTE FUNCTION validate_payment_receipt_fact();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_financial_fact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial transaction facts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_order_payments_append_only
BEFORE UPDATE OR DELETE ON business_order_payments
FOR EACH ROW
EXECUTE FUNCTION reject_financial_fact_change();
--> statement-breakpoint
CREATE TRIGGER payment_receipts_append_only
BEFORE UPDATE OR DELETE ON payment_receipts
FOR EACH ROW
EXECUTE FUNCTION reject_financial_fact_change();
--> statement-breakpoint
CREATE TRIGGER business_order_refunds_append_only
BEFORE UPDATE OR DELETE ON business_order_refunds
FOR EACH ROW
EXECUTE FUNCTION reject_financial_fact_change();
--> statement-breakpoint
CREATE TRIGGER refund_evidence_files_append_only
BEFORE UPDATE OR DELETE ON refund_evidence_files
FOR EACH ROW
EXECUTE FUNCTION reject_financial_fact_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_refund_evidence_file()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM refund_evidence_files WHERE file_id = OLD.id) THEN
    RAISE EXCEPTION 'refund evidence file facts are append-only';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stored_files_refund_evidence_guard
BEFORE UPDATE OR DELETE ON stored_files
FOR EACH ROW
EXECUTE FUNCTION protect_refund_evidence_file();
