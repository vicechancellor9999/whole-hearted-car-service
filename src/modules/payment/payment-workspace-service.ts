import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";

type WorkspaceOrderRow = {
  id: number;
  order_no: string;
  payer_person_customer_id: number | null;
  payer_company_account_id: number | null;
  payer_display_name_snapshot: string;
  payer_phone_snapshot: string | null;
  vehicle_plate_snapshot: string;
  vehicle_description_snapshot: string;
  status: string;
  created_at: Date;
  total_due_minor: number;
  total_paid_minor: number;
  total_refunded_minor: number;
};

type WorkspaceTransactionRow = {
  type: "payment" | "refund";
  id: number;
  business_order_id: number;
  order_no: string;
  vehicle_plate_snapshot: string;
  reference_no: string;
  amount_minor: number;
  method_label_zh: string;
  occurred_at: Date;
  note: string | null;
  receipt_id: number | null;
};

export type PaymentWorkspaceOrder = {
  id: number;
  orderNo: string;
  payerKey: string;
  payerDisplayName: string;
  payerPhone: string | null;
  vehiclePlate: string;
  vehicleDescription: string;
  status: string;
  createdAt: string;
};

export type PaymentWorkspaceLedger = {
  businessOrderId: number;
  currentDueMinor: number;
  totalPaidMinor: number;
  totalRefundedMinor: number;
  balanceMinor: number;
};

export type PaymentWorkspaceTransaction = {
  type: "payment" | "refund";
  id: number;
  businessOrderId: number;
  businessOrderNo: string;
  vehiclePlate: string;
  referenceNo: string;
  amountMinor: number;
  methodLabelZh: string;
  occurredAt: string;
  note: string | null;
  receiptId: number | null;
};

export type PaymentWorkspace = {
  items: Array<{ order: PaymentWorkspaceOrder; ledger: PaymentWorkspaceLedger }>;
  transactions: PaymentWorkspaceTransaction[];
};

export class PaymentWorkspaceReadDeniedError extends Error {
  readonly status = 403;
  constructor() {
    super("当前账号不能查看收付款台账");
    this.name = "PaymentWorkspaceReadDeniedError";
  }
}

export function projectPaymentWorkspace(input: {
  orders: Array<{
    id: number;
    orderNo: string;
    payerKey: string;
    payerDisplayName: string;
    payerPhone: string | null;
    vehiclePlate: string;
    vehicleDescription: string;
    status: string;
    createdAt: Date;
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
  }>;
  transactions: Array<{
    type: "payment" | "refund";
    id: number;
    businessOrderId: number;
    businessOrderNo: string;
    vehiclePlate: string;
    referenceNo: string;
    amountMinor: number;
    methodLabelZh: string;
    occurredAt: Date;
    note: string | null;
    receiptId: number | null;
  }>;
}): PaymentWorkspace {
  return {
    items: input.orders.map((order) => ({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        payerKey: order.payerKey,
        payerDisplayName: order.payerDisplayName,
        payerPhone: order.payerPhone,
        vehiclePlate: order.vehiclePlate,
        vehicleDescription: order.vehicleDescription,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      },
      ledger: {
        businessOrderId: order.id,
        currentDueMinor: order.currentDueMinor,
        totalPaidMinor: order.totalPaidMinor,
        totalRefundedMinor: order.totalRefundedMinor,
        balanceMinor: order.currentDueMinor - order.totalPaidMinor + order.totalRefundedMinor,
      },
    })),
    transactions: [...input.transactions]
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id - left.id)
      .map((transaction) => ({
        ...transaction,
        occurredAt: transaction.occurredAt.toISOString(),
      })),
  };
}

export class PaymentWorkspaceService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async getWorkspace(input: { viewerAccountId: number }): Promise<PaymentWorkspace> {
    await requirePaymentWorkspaceReader(this.database, input.viewerAccountId);
    const [orderRows, transactionRows] = await Promise.all([
      this.database.query<WorkspaceOrderRow>(
        `select business_order.id, business_order.order_no,
                business_order.payer_person_customer_id, business_order.payer_company_account_id,
                business_order.payer_display_name_snapshot, business_order.payer_phone_snapshot,
                business_order.vehicle_plate_snapshot, business_order.vehicle_description_snapshot,
                business_order.status, business_order.created_at,
                coalesce(charge.total_due_minor, 0)::bigint as total_due_minor,
                coalesce(payment.total_paid_minor, 0)::bigint as total_paid_minor,
                coalesce(refund.total_refunded_minor, 0)::bigint as total_refunded_minor
         from business_orders as business_order
         left join business_order_charge_versions as charge
           on charge.business_order_id = business_order.id
          and charge.version_no = business_order.current_charge_version_no
         left join lateral (
           select coalesce(sum(amount_minor), 0)::bigint as total_paid_minor
           from business_order_payments where business_order_id = business_order.id
         ) as payment on true
         left join lateral (
           select coalesce(sum(amount_minor), 0)::bigint as total_refunded_minor
           from business_order_refunds where business_order_id = business_order.id
         ) as refund on true
         where business_order.voided_at is null
         order by business_order.created_at desc, business_order.id desc`,
      ),
      this.database.query<WorkspaceTransactionRow>(
        `select 'payment'::text as type, payment.id, payment.business_order_id,
                business_order.order_no, business_order.vehicle_plate_snapshot,
                payment.payment_no as reference_no, payment.amount_minor,
                payment.payment_method_label_zh_snapshot as method_label_zh,
                payment.paid_at as occurred_at, payment.note, receipt.id as receipt_id
         from business_order_payments as payment
         join business_orders as business_order on business_order.id = payment.business_order_id
         left join payment_receipts as receipt on receipt.payment_id = payment.id
         where business_order.voided_at is null
         union all
         select 'refund'::text as type, refund.id, refund.business_order_id,
                business_order.order_no, business_order.vehicle_plate_snapshot,
                refund.refund_no as reference_no, refund.amount_minor,
                refund.payment_method_label_zh_snapshot as method_label_zh,
                refund.refunded_at as occurred_at, refund.reason as note, null::bigint as receipt_id
         from business_order_refunds as refund
         join business_orders as business_order on business_order.id = refund.business_order_id
         where business_order.voided_at is null
         order by occurred_at desc, id desc`,
      ),
    ]);
    return projectPaymentWorkspace({
      orders: orderRows.map((row) => ({
        id: Number(row.id),
        orderNo: row.order_no,
        payerKey: row.payer_company_account_id !== null
          ? `company:${row.payer_company_account_id}`
          : `person:${row.payer_person_customer_id ?? "unknown"}`,
        payerDisplayName: row.payer_display_name_snapshot,
        payerPhone: row.payer_phone_snapshot,
        vehiclePlate: row.vehicle_plate_snapshot,
        vehicleDescription: row.vehicle_description_snapshot,
        status: row.status,
        createdAt: new Date(row.created_at),
        currentDueMinor: Number(row.total_due_minor),
        totalPaidMinor: Number(row.total_paid_minor),
        totalRefundedMinor: Number(row.total_refunded_minor),
      })),
      transactions: transactionRows.map((row) => ({
        type: row.type,
        id: Number(row.id),
        businessOrderId: Number(row.business_order_id),
        businessOrderNo: row.order_no,
        vehiclePlate: row.vehicle_plate_snapshot,
        referenceNo: row.reference_no,
        amountMinor: Number(row.amount_minor),
        methodLabelZh: row.method_label_zh,
        occurredAt: new Date(row.occurred_at),
        note: row.note,
        receiptId: row.receipt_id === null ? null : Number(row.receipt_id),
      })),
    });
  }
}

async function requirePaymentWorkspaceReader(database: AuthSqlDatabase, accountId: number): Promise<void> {
  const rows = await database.query<{ allowed: boolean }>(
    `select true as allowed from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new PaymentWorkspaceReadDeniedError();
}
