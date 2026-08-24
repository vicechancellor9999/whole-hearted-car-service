import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@/db/schema/accounts";
import {
  businessOrders,
} from "@/db/schema/business-order";
import { identityPrimaryKey } from "@/db/schema/common";
import { storedFiles } from "@/db/schema/customer-vehicle";
import { dictionaryItems } from "@/db/schema/master-data";

export type ReceiptRenderSnapshot = {
  version: 1;
  businessOrder: {
    id: number;
    orderNo: string;
    plate: string;
    vehicleDescription: string;
    vin: string | null;
    payerName: string;
    payerPhone: string | null;
    payerTrn: string | null;
    payerContactName: string | null;
  };
  charges: {
    versionNo: number;
    totals: {
      grossMinor: number;
      lineDiscountMinor: number;
      laborDiscountMinor: number;
      partDiscountMinor: number;
      otherDiscountMinor: number;
      categoryDiscountMinor: number;
      wholeOrderDiscountMinor: number;
      totalDueMinor: number;
      includedGctMinor: number;
    };
    items: Array<{
      kind: "labor" | "part" | "other";
      nameZh: string;
      nameEn: string | null;
      descriptionZh: string | null;
      descriptionEn: string | null;
      unitLabelZh: string;
      unitLabelEn: string | null;
      quantity: string;
      unitPriceMinor: number;
      itemDiscountMinor: number;
      subtotalMinor: number;
    }>;
    notes: Array<{
      kind: "customer_concern" | "work_instruction" | "liability_notice" | "internal";
      contentZh: string | null;
      contentEn: string | null;
    }>;
  };
  transactions: Array<{
    type: "payment" | "refund";
    referenceNo: string;
    amountMinor: number;
    methodCode: string;
    methodLabelZh: string;
    methodLabelEn: string | null;
    occurredAt: string;
    note: string | null;
  }>;
  currentPayment: {
    paymentNo: string;
    amountMinor: number;
    methodCode: string;
    methodLabelZh: string;
    methodLabelEn: string | null;
    paidAt: string;
    note: string | null;
  };
  totals: {
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
    balanceAfterMinor: number;
  };
};

export const refundOriginalDocumentStatus = pgEnum(
  "refund_original_document_status",
  ["returned", "unavailable"],
);

export const refundEvidenceKind = pgEnum("refund_evidence_kind", [
  "refund_proof",
  "customer_signature",
]);

export const businessOrderPayments = pgTable(
  "business_order_payments",
  {
    id: identityPrimaryKey(),
    paymentNo: text("payment_no").notNull(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    paymentMethodItemId: bigint("payment_method_item_id", { mode: "number" })
      .notNull()
      .references(() => dictionaryItems.id, { onDelete: "restrict" }),
    paymentMethodCodeSnapshot: text("payment_method_code_snapshot").notNull(),
    paymentMethodLabelZhSnapshot: text("payment_method_label_zh_snapshot").notNull(),
    paymentMethodLabelEnSnapshot: text("payment_method_label_en_snapshot"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    recordedBy: bigint("recorded_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("business_order_payments_no_uq").on(table.paymentNo),
    index("business_order_payments_order_time_idx").on(
      table.businessOrderId,
      table.paidAt,
    ),
    check(
      "business_order_payments_no_format",
      sql`${table.paymentNo} ~ '^PAY-[0-9]{8}-[0-9]{4}$'`,
    ),
    check("business_order_payments_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "business_order_payments_method_snapshot_nonempty",
      sql`length(btrim(${table.paymentMethodCodeSnapshot})) > 0
          and length(btrim(${table.paymentMethodLabelZhSnapshot})) > 0`,
    ),
    check(
      "business_order_payments_note_nonempty",
      sql`${table.note} is null or length(btrim(${table.note})) > 0`,
    ),
  ],
);

export const paymentReceipts = pgTable(
  "payment_receipts",
  {
    id: identityPrimaryKey(),
    receiptNo: text("receipt_no").notNull(),
    paymentId: bigint("payment_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderPayments.id, { onDelete: "restrict" }),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    renderSnapshot: jsonb("render_snapshot").$type<ReceiptRenderSnapshot>().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    issuedBy: bigint("issued_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("payment_receipts_no_uq").on(table.receiptNo),
    uniqueIndex("payment_receipts_payment_uq").on(table.paymentId),
    index("payment_receipts_order_time_idx").on(table.businessOrderId, table.issuedAt),
    check(
      "payment_receipts_no_format",
      sql`${table.receiptNo} ~ '^RCT-[0-9]{8}-[0-9]{4}$'`,
    ),
    check(
      "payment_receipts_snapshot_object",
      sql`jsonb_typeof(${table.renderSnapshot}) = 'object'`,
    ),
  ],
);

export const businessOrderRefunds = pgTable(
  "business_order_refunds",
  {
    id: identityPrimaryKey(),
    refundNo: text("refund_no").notNull(),
    businessOrderId: bigint("business_order_id", { mode: "number" })
      .notNull()
      .references(() => businessOrders.id, { onDelete: "restrict" }),
    paymentMethodItemId: bigint("payment_method_item_id", { mode: "number" })
      .notNull()
      .references(() => dictionaryItems.id, { onDelete: "restrict" }),
    paymentMethodCodeSnapshot: text("payment_method_code_snapshot").notNull(),
    paymentMethodLabelZhSnapshot: text("payment_method_label_zh_snapshot").notNull(),
    paymentMethodLabelEnSnapshot: text("payment_method_label_en_snapshot"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    originalDocumentStatus: refundOriginalDocumentStatus("original_document_status").notNull(),
    originalDocumentNote: text("original_document_note"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }).notNull(),
    recordedBy: bigint("recorded_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("business_order_refunds_no_uq").on(table.refundNo),
    index("business_order_refunds_order_time_idx").on(
      table.businessOrderId,
      table.refundedAt,
    ),
    check(
      "business_order_refunds_no_format",
      sql`${table.refundNo} ~ '^RFD-[0-9]{8}-[0-9]{4}$'`,
    ),
    check("business_order_refunds_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "business_order_refunds_reason_nonempty",
      sql`length(btrim(${table.reason})) > 0`,
    ),
    check(
      "business_order_refunds_method_snapshot_nonempty",
      sql`length(btrim(${table.paymentMethodCodeSnapshot})) > 0
          and length(btrim(${table.paymentMethodLabelZhSnapshot})) > 0`,
    ),
    check(
      "business_order_refunds_original_document_note",
      sql`(${table.originalDocumentStatus} = 'returned' and ${table.originalDocumentNote} is null)
          or (${table.originalDocumentStatus} = 'unavailable'
              and length(btrim(${table.originalDocumentNote})) > 0)`,
    ),
  ],
);

export const refundEvidenceFiles = pgTable(
  "refund_evidence_files",
  {
    refundId: bigint("refund_id", { mode: "number" })
      .notNull()
      .references(() => businessOrderRefunds.id, { onDelete: "restrict" }),
    fileId: bigint("file_id", { mode: "number" })
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    kind: refundEvidenceKind("kind").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull(),
    linkedBy: bigint("linked_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({
      columns: [table.refundId, table.fileId],
      name: "refund_evidence_files_pk",
    }),
    uniqueIndex("refund_evidence_files_file_uq").on(table.fileId),
    uniqueIndex("refund_evidence_files_refund_kind_uq").on(table.refundId, table.kind),
  ],
);

export type BusinessOrderPayment = typeof businessOrderPayments.$inferSelect;
export type PaymentReceipt = typeof paymentReceipts.$inferSelect;
export type BusinessOrderRefund = typeof businessOrderRefunds.$inferSelect;
