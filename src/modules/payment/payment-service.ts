import { toBusinessDateKey } from "@/lib/time";
import type { ReceiptRenderSnapshot } from "@/db/schema/payment";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import { writeAuditEvent } from "@/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";
import {
  PaymentConflictError,
  PaymentNotFoundError,
  PaymentReadDeniedError,
  PaymentValidationError,
  PaymentWriteDeniedError,
} from "@/modules/payment/payment-errors";
import {
  moneyTextToMinor,
  recordPaymentSchema,
} from "@/modules/payment/payment-schemas";

export {
  PaymentConflictError,
  PaymentNotFoundError,
  PaymentReadDeniedError,
  PaymentValidationError,
  PaymentWriteDeniedError,
} from "@/modules/payment/payment-errors";

type PaymentRow = {
  id: number;
  payment_no: string;
  business_order_id: number;
  payment_method_item_id: number;
  payment_method_code_snapshot: string;
  payment_method_label_zh_snapshot: string;
  payment_method_label_en_snapshot: string | null;
  amount_minor: number;
  note: string | null;
  paid_at: Date;
  recorded_by: number;
};

type ReceiptRow = {
  id: number;
  receipt_no: string;
  payment_id: number;
  business_order_id: number;
  render_snapshot: ReceiptRenderSnapshot | string;
  issued_at: Date;
  issued_by: number;
};

type OrderChargeRow = {
  id: number;
  order_no: string;
  vehicle_plate_snapshot: string;
  vehicle_description_snapshot: string;
  vehicle_vin_snapshot: string | null;
  payer_display_name_snapshot: string;
  payer_phone_snapshot: string | null;
  payer_trn_snapshot: string | null;
  payer_contact_name_snapshot: string | null;
  voided_at: Date | null;
  charge_version_id: number;
  version_no: number;
  gross_minor: number;
  line_discount_minor: number;
  labor_discount_minor: number;
  part_discount_minor: number;
  other_discount_minor: number;
  category_discount_minor: number;
  whole_order_discount_minor: number;
  total_due_minor: number;
  included_gct_minor: number;
};

type LedgerFactRow = {
  type: "payment" | "refund";
  id: number;
  reference_no: string;
  amount_minor: number;
  method_code: string;
  method_label_zh: string;
  method_label_en: string | null;
  occurred_at: Date;
  note: string | null;
  receipt_id: number | null;
};

export type PaymentRecord = {
  id: number;
  paymentNo: string;
  businessOrderId: number;
  paymentMethodItemId: number;
  paymentMethodCode: string;
  paymentMethodLabelZh: string;
  paymentMethodLabelEn: string | null;
  amountMinor: number;
  note: string | null;
  paidAt: Date;
  recordedBy: number;
};

export type PaymentReceiptRecord = {
  id: number;
  receiptNo: string;
  paymentId: number;
  businessOrderId: number;
  snapshot: ReceiptRenderSnapshot;
  issuedAt: Date;
  issuedBy: number;
};

export type LedgerTransaction = {
  type: "payment" | "refund";
  id: number;
  referenceNo: string;
  amountMinor: number;
  methodCode: string;
  methodLabelZh: string;
  methodLabelEn: string | null;
  occurredAt: Date;
  note: string | null;
  receiptId: number | null;
};

export type BusinessOrderLedger = {
  businessOrderId: number;
  currentDueMinor: number;
  totalPaidMinor: number;
  totalRefundedMinor: number;
  balanceMinor: number;
  transactions: LedgerTransaction[];
};

export class PaymentService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async recordPayment(input: {
    businessOrderId: number;
    amount: string;
    paymentMethodItemId: number;
    note?: string;
    context: BusinessOrderActionContext;
  }): Promise<{ payment: PaymentRecord; receipt: PaymentReceiptRecord }> {
    const parsed = recordPaymentSchema.safeParse(input);
    if (!parsed.success) {
      throw new PaymentValidationError(parsed.error.issues[0]?.message ?? "收款数据不正确");
    }
    const now = input.context.now ?? new Date();
    const amountMinor = moneyTextToMinor(parsed.data.amount);
    try {
      return await this.database.transaction(async (transaction) => {
        await requirePaymentWriter(transaction, input.context.actorAccountId);
        const order = await loadOrderAndCharge(transaction, parsed.data.businessOrderId, true);
        if (order.voided_at !== null) {
          throw new PaymentValidationError("已作废的 Business Order 不能登记收款");
        }
        const method = await requirePaymentMethod(
          transaction,
          parsed.data.paymentMethodItemId,
        );
        await transaction.query(
          "lock table business_order_payments, payment_receipts in share row exclusive mode",
        );
        const dateKey = toBusinessDateKey(now).replaceAll("-", "");
        const [paymentNo, receiptNo] = await Promise.all([
          nextNumber(transaction, "business_order_payments", "payment_no", `PAY-${dateKey}-`),
          nextNumber(transaction, "payment_receipts", "receipt_no", `RCT-${dateKey}-`),
        ]);
        const history = await selectLedgerTransactions(
          transaction,
          parsed.data.businessOrderId,
        );
        const paymentRows = await transaction.query<PaymentRow>(
          `insert into business_order_payments
            (payment_no, business_order_id, payment_method_item_id,
             payment_method_code_snapshot, payment_method_label_zh_snapshot,
             payment_method_label_en_snapshot, amount_minor, note,
             paid_at, recorded_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning id, payment_no, business_order_id, payment_method_item_id,
                     payment_method_code_snapshot,
                     payment_method_label_zh_snapshot,
                     payment_method_label_en_snapshot, amount_minor, note,
                     paid_at, recorded_by`,
          [
            paymentNo,
            parsed.data.businessOrderId,
            parsed.data.paymentMethodItemId,
            method.code,
            method.label_zh,
            method.label_en,
            amountMinor,
            parsed.data.note,
            now,
            input.context.actorAccountId,
          ],
        );
        const payment = mapPayment(paymentRows[0]);
        const currentTransaction: LedgerTransaction = {
          type: "payment",
          id: payment.id,
          referenceNo: payment.paymentNo,
          amountMinor: payment.amountMinor,
          methodCode: payment.paymentMethodCode,
          methodLabelZh: payment.paymentMethodLabelZh,
          methodLabelEn: payment.paymentMethodLabelEn,
          occurredAt: payment.paidAt,
          note: payment.note,
          receiptId: null,
        };
        const snapshot = await buildReceiptSnapshot(
          transaction,
          order,
          [...history, currentTransaction],
          payment,
        );
        const receiptRows = await transaction.query<ReceiptRow>(
          `insert into payment_receipts
            (receipt_no, payment_id, business_order_id, render_snapshot,
             issued_at, issued_by)
           values ($1, $2, $3, $4::jsonb, $5, $6)
           returning id, receipt_no, payment_id, business_order_id,
                     render_snapshot, issued_at, issued_by`,
          [
            receiptNo,
            payment.id,
            parsed.data.businessOrderId,
            JSON.stringify(snapshot),
            now,
            input.context.actorAccountId,
          ],
        );
        const receipt = mapReceipt(receiptRows[0]);
        await writeAuditEvent(transaction, {
          occurredAt: now,
          actorAccountId: input.context.actorAccountId,
          eventType: "payment.recorded",
          objectType: "business_order_payment",
          objectId: payment.paymentNo,
          reason: payment.note,
          after: {
            businessOrderId: payment.businessOrderId,
            amountMinor: payment.amountMinor,
            paymentMethodCode: payment.paymentMethodCode,
            receiptNo: receipt.receiptNo,
            balanceAfterMinor: receipt.snapshot.totals.balanceAfterMinor,
          },
          requestId: input.context.requestId,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
        });
        return { payment, receipt };
      });
    } catch (error) {
      rethrowPaymentError(error);
    }
  }

  async getBusinessOrderLedger(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderLedger> {
    await requirePaymentReader(this.database, input.viewerAccountId);
    const order = await loadOrderAndCharge(this.database, input.businessOrderId, false);
    const transactions = await selectLedgerTransactions(
      this.database,
      input.businessOrderId,
    );
    return buildLedger(order.total_due_minor, input.businessOrderId, transactions);
  }

  async getReceipt(input: {
    receiptId: number;
    viewerAccountId: number;
  }): Promise<PaymentReceiptRecord> {
    await requirePaymentReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<ReceiptRow>(
      `select id, receipt_no, payment_id, business_order_id,
              render_snapshot, issued_at, issued_by
       from payment_receipts where id = $1 limit 1`,
      [input.receiptId],
    );
    if (!rows[0]) throw new PaymentNotFoundError("Receipt 不存在");
    return mapReceipt(rows[0]);
  }
}

async function loadOrderAndCharge(
  executor: AuthSqlExecutor,
  businessOrderId: number,
  lock: boolean,
): Promise<OrderChargeRow> {
  const rows = await executor.query<OrderChargeRow>(
    `select business_order.id, business_order.order_no,
            business_order.vehicle_plate_snapshot,
            business_order.vehicle_description_snapshot,
            business_order.vehicle_vin_snapshot,
            business_order.payer_display_name_snapshot,
            business_order.payer_phone_snapshot,
            business_order.payer_trn_snapshot,
            business_order.payer_contact_name_snapshot,
            business_order.voided_at,
            charge.id as charge_version_id, charge.version_no,
            charge.gross_minor, charge.line_discount_minor,
            charge.labor_discount_minor, charge.part_discount_minor,
            charge.other_discount_minor, charge.category_discount_minor,
            charge.whole_order_discount_minor, charge.total_due_minor,
            charge.included_gct_minor
     from business_orders as business_order
     join business_order_charge_versions as charge
       on charge.business_order_id = business_order.id
      and charge.version_no = business_order.current_charge_version_no
     where business_order.id = $1
     ${lock ? "for update of business_order" : ""}`,
    [businessOrderId],
  );
  if (!rows[0]) throw new PaymentNotFoundError("Business Order 或当前收费版本不存在");
  return rows[0];
}

async function requirePaymentMethod(
  executor: AuthSqlExecutor,
  paymentMethodItemId: number,
) {
  const rows = await executor.query<{
    code: string;
    label_zh: string;
    label_en: string | null;
  }>(
    `select code, label_zh, label_en
     from dictionary_items
     where id = $1 and category = 'payment_method' and is_active = true
     limit 1`,
    [paymentMethodItemId],
  );
  if (!rows[0]) throw new PaymentValidationError("支付方式不存在或已经停用");
  return rows[0];
}

async function selectLedgerTransactions(
  executor: AuthSqlExecutor,
  businessOrderId: number,
): Promise<LedgerTransaction[]> {
  const rows = await executor.query<LedgerFactRow>(
    `select 'payment'::text as type, payment.id,
            payment.payment_no as reference_no, payment.amount_minor,
            payment.payment_method_code_snapshot as method_code,
            payment.payment_method_label_zh_snapshot as method_label_zh,
            payment.payment_method_label_en_snapshot as method_label_en,
            payment.paid_at as occurred_at, payment.note,
            receipt.id as receipt_id
     from business_order_payments as payment
     left join payment_receipts as receipt on receipt.payment_id = payment.id
     where payment.business_order_id = $1
     union all
     select 'refund'::text as type, refund.id,
            refund.refund_no as reference_no, refund.amount_minor,
            refund.payment_method_code_snapshot as method_code,
            refund.payment_method_label_zh_snapshot as method_label_zh,
            refund.payment_method_label_en_snapshot as method_label_en,
            refund.refunded_at as occurred_at, refund.reason as note,
            null::bigint as receipt_id
     from business_order_refunds as refund
     where refund.business_order_id = $1
     order by occurred_at, type, id`,
    [businessOrderId],
  );
  return rows.map((row) => ({
    type: row.type,
    id: Number(row.id),
    referenceNo: row.reference_no,
    amountMinor: Number(row.amount_minor),
    methodCode: row.method_code,
    methodLabelZh: row.method_label_zh,
    methodLabelEn: row.method_label_en,
    occurredAt: new Date(row.occurred_at),
    note: row.note,
    receiptId: row.receipt_id === null ? null : Number(row.receipt_id),
  }));
}

function buildLedger(
  currentDueMinor: number,
  businessOrderId: number,
  transactions: LedgerTransaction[],
): BusinessOrderLedger {
  const totalPaidMinor = transactions
    .filter((transaction) => transaction.type === "payment")
    .reduce((total, transaction) => total + transaction.amountMinor, 0);
  const totalRefundedMinor = transactions
    .filter((transaction) => transaction.type === "refund")
    .reduce((total, transaction) => total + transaction.amountMinor, 0);
  return {
    businessOrderId,
    currentDueMinor: Number(currentDueMinor),
    totalPaidMinor,
    totalRefundedMinor,
    balanceMinor: Number(currentDueMinor) - totalPaidMinor + totalRefundedMinor,
    transactions,
  };
}

async function buildReceiptSnapshot(
  executor: AuthSqlExecutor,
  order: OrderChargeRow,
  transactions: LedgerTransaction[],
  payment: PaymentRecord,
): Promise<ReceiptRenderSnapshot> {
  const [items, notes] = await Promise.all([
    executor.query<{
      kind: "labor" | "part" | "other";
      name_zh: string;
      name_en: string | null;
      description_zh: string | null;
      description_en: string | null;
      unit_label_zh: string;
      unit_label_en: string | null;
      quantity: string;
      unit_price_minor: number;
      item_discount_minor: number;
      subtotal_minor: number;
    }>(
      `select item.kind, item.name_zh, item.name_en,
              item.description_zh, item.description_en,
              unit.label_zh as unit_label_zh, unit.label_en as unit_label_en,
              item.quantity::text as quantity, item.unit_price_minor,
              item.item_discount_minor, item.subtotal_minor
       from business_order_charge_items as item
       join dictionary_items as unit on unit.id = item.unit_item_id
       where item.charge_version_id = $1
       order by item.sort_order, item.id`,
      [order.charge_version_id],
    ),
    executor.query<{
      kind: ReceiptRenderSnapshot["charges"]["notes"][number]["kind"];
      content_zh: string | null;
      content_en: string | null;
    }>(
      `select kind, content_zh, content_en
       from business_order_notes
       where charge_version_id = $1
       order by sort_order, id`,
      [order.charge_version_id],
    ),
  ]);
  const ledger = buildLedger(order.total_due_minor, order.id, transactions);
  const transactionSnapshots = transactions.map((transaction) => ({
    type: transaction.type,
    referenceNo: transaction.referenceNo,
    amountMinor: transaction.amountMinor,
    methodCode: transaction.methodCode,
    methodLabelZh: transaction.methodLabelZh,
    methodLabelEn: transaction.methodLabelEn,
    occurredAt: transaction.occurredAt.toISOString(),
    note: transaction.note,
  }));
  return {
    version: 1,
    businessOrder: {
      id: Number(order.id),
      orderNo: order.order_no,
      plate: order.vehicle_plate_snapshot,
      vehicleDescription: order.vehicle_description_snapshot,
      vin: order.vehicle_vin_snapshot,
      payerName: order.payer_display_name_snapshot,
      payerPhone: order.payer_phone_snapshot,
      payerTrn: order.payer_trn_snapshot,
      payerContactName: order.payer_contact_name_snapshot,
    },
    charges: {
      versionNo: order.version_no,
      totals: {
        grossMinor: Number(order.gross_minor),
        lineDiscountMinor: Number(order.line_discount_minor),
        laborDiscountMinor: Number(order.labor_discount_minor),
        partDiscountMinor: Number(order.part_discount_minor),
        otherDiscountMinor: Number(order.other_discount_minor),
        categoryDiscountMinor: Number(order.category_discount_minor),
        wholeOrderDiscountMinor: Number(order.whole_order_discount_minor),
        totalDueMinor: Number(order.total_due_minor),
        includedGctMinor: Number(order.included_gct_minor),
      },
      items: items.map((item) => ({
        kind: item.kind,
        nameZh: item.name_zh,
        nameEn: item.name_en,
        descriptionZh: item.description_zh,
        descriptionEn: item.description_en,
        unitLabelZh: item.unit_label_zh,
        unitLabelEn: item.unit_label_en,
        quantity: item.quantity,
        unitPriceMinor: Number(item.unit_price_minor),
        itemDiscountMinor: Number(item.item_discount_minor),
        subtotalMinor: Number(item.subtotal_minor),
      })),
      notes: notes.map((note) => ({
        kind: note.kind,
        contentZh: note.content_zh,
        contentEn: note.content_en,
      })),
    },
    transactions: transactionSnapshots,
    currentPayment: {
      paymentNo: payment.paymentNo,
      amountMinor: payment.amountMinor,
      methodCode: payment.paymentMethodCode,
      methodLabelZh: payment.paymentMethodLabelZh,
      methodLabelEn: payment.paymentMethodLabelEn,
      paidAt: payment.paidAt.toISOString(),
      note: payment.note,
    },
    totals: {
      currentDueMinor: ledger.currentDueMinor,
      totalPaidMinor: ledger.totalPaidMinor,
      totalRefundedMinor: ledger.totalRefundedMinor,
      balanceAfterMinor: ledger.balanceMinor,
    },
  };
}

async function nextNumber(
  executor: AuthSqlExecutor,
  table: "business_order_payments" | "payment_receipts",
  column: "payment_no" | "receipt_no",
  prefix: string,
) {
  const rows = await executor.query<{ current_number: number }>(
    `select coalesce(max(right(${column}, 4)::integer), 0)::integer as current_number
     from ${table} where ${column} like $1`,
    [`${prefix}%`],
  );
  const next = Number(rows[0]?.current_number ?? 0) + 1;
  if (next > 9_999) throw new PaymentConflictError("当天收款或 Receipt 编号已经用尽");
  return `${prefix}${String(next).padStart(4, "0")}`;
}

async function requirePaymentReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new PaymentReadDeniedError();
}

async function requirePaymentWriter(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new PaymentWriteDeniedError();
}

function mapPayment(row: PaymentRow | undefined): PaymentRecord {
  if (!row) throw new Error("收款写入后无法读取");
  return {
    id: Number(row.id),
    paymentNo: row.payment_no,
    businessOrderId: Number(row.business_order_id),
    paymentMethodItemId: Number(row.payment_method_item_id),
    paymentMethodCode: row.payment_method_code_snapshot,
    paymentMethodLabelZh: row.payment_method_label_zh_snapshot,
    paymentMethodLabelEn: row.payment_method_label_en_snapshot,
    amountMinor: Number(row.amount_minor),
    note: row.note,
    paidAt: new Date(row.paid_at),
    recordedBy: Number(row.recorded_by),
  };
}

function mapReceipt(row: ReceiptRow | undefined): PaymentReceiptRecord {
  if (!row) throw new Error("Receipt 写入后无法读取");
  return {
    id: Number(row.id),
    receiptNo: row.receipt_no,
    paymentId: Number(row.payment_id),
    businessOrderId: Number(row.business_order_id),
    snapshot: typeof row.render_snapshot === "string"
      ? JSON.parse(row.render_snapshot) as ReceiptRenderSnapshot
      : row.render_snapshot,
    issuedAt: new Date(row.issued_at),
    issuedBy: Number(row.issued_by),
  };
}

function rethrowPaymentError(error: unknown): never {
  if (
    error instanceof PaymentValidationError ||
    error instanceof PaymentNotFoundError ||
    error instanceof PaymentReadDeniedError ||
    error instanceof PaymentWriteDeniedError ||
    error instanceof PaymentConflictError
  ) throw error;
  if (databaseErrorCode(error) === "23505") throw new PaymentConflictError();
  throw error;
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}
