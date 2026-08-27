import Link from "next/link";
import type { BusinessOrderLedger } from "@/modules/payment/payment-service";

type FormAction = (formData: FormData) => void | Promise<void>;

type PaymentMethodOption = {
  id: number;
  code: string;
  labelZh: string;
  labelEn: string | null;
};

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function FinancePanel({
  action,
  businessOrderId,
  canRecordPayment,
  canRefund,
  ledger,
  paymentMethods,
}: {
  action: FormAction;
  businessOrderId: number;
  canRecordPayment: boolean;
  canRefund: boolean;
  ledger: BusinessOrderLedger;
  paymentMethods: PaymentMethodOption[];
}) {
  return (
    <section aria-label="Business Order 收付款" className="bo-panel bo-finance-panel">
      <header className="bo-panel-heading">
        <div>
          <h2>逐笔收付款与 Receipt</h2>
          <p>每次收款、退款都是独立且不可修改的事实；余额由记录自动计算。</p>
        </div>
      </header>
      <div className="bo-ledger-summary">
        <span>折后应收<strong>{money(ledger.currentDueMinor)}</strong></span>
        <span>累计收款<strong>{money(ledger.totalPaidMinor)}</strong></span>
        <span>累计退款<strong>{money(ledger.totalRefundedMinor)}</strong></span>
        <span>未结余额<strong>{money(ledger.balanceMinor)}</strong></span>
      </div>
      {canRecordPayment || canRefund ? (
        <div className="bo-finance-actions">
          {canRecordPayment ? (
            <form action={action} className="bo-finance-form">
              <input name="operation" type="hidden" value="record_payment" />
              <input name="businessOrderId" type="hidden" value={businessOrderId} />
              <h3>登记一笔收款</h3>
              <label>收款金额（JMD）<input inputMode="decimal" name="amount" required /></label>
              <label>收款方式<select name="paymentMethodItemId" required><option value="">选择方式</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.labelZh}{method.labelEn ? ` / ${method.labelEn}` : ""}</option>)}</select></label>
              <label>收款备注<input name="note" /></label>
              <button type="submit">登记收款并生成 Receipt</button>
            </form>
          ) : null}
          {canRefund ? (
            <form action={action} className="bo-finance-form bo-refund-form">
              <input name="operation" type="hidden" value="record_refund" />
              <input name="businessOrderId" type="hidden" value={businessOrderId} />
              <h3>登记一笔退款</h3>
              <label>退款金额（JMD）<input aria-label="退款金额（JMD）" inputMode="decimal" name="amount" required /></label>
              <label>退款方式<select name="paymentMethodItemId" required><option value="">选择方式</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.labelZh}{method.labelEn ? ` / ${method.labelEn}` : ""}</option>)}</select></label>
              <label>退款原因<textarea name="reason" required /></label>
              <label>原客户单据<select name="originalDocumentStatus" required><option value="returned">原单已交回</option><option value="unavailable">原单无法交回</option></select></label>
              <label>原单无法交回说明<textarea name="originalDocumentNote" /></label>
              <p>先登记退款并生成可打印的退款签收单。客户在纸上签字后，工作人员可保存纸质原件，也可稍后把签字件上传归档。</p>
              <button type="submit">登记退款并生成签收单</button>
            </form>
          ) : null}
        </div>
      ) : <p className="readonly-notice">当前账号为只读，可查看每一笔收付款和单据。</p>}
      <section className="bo-ledger-history" aria-label="收付款历史">
        <h3>收付款历史</h3>
        {ledger.transactions.length === 0 ? <p className="record-empty">尚无收付款记录。</p> : ledger.transactions.map((transaction) => (
          <article key={`${transaction.type}-${transaction.id}`}>
            <div><strong>{transaction.type === "payment" ? "收款" : "退款"} · {transaction.referenceNo}</strong><small>{transaction.occurredAt.toLocaleString("zh-CN", { timeZone: "America/Jamaica", hour12: false })} · {transaction.methodLabelZh}{transaction.methodLabelEn ? ` / ${transaction.methodLabelEn}` : ""}</small></div>
            <span className={transaction.type === "refund" ? "refund-amount" : "payment-amount"}>{transaction.type === "refund" ? "−" : "+"}{money(transaction.amountMinor)}</span>
            <span>{transaction.note ?? "无备注"}</span>
            <span>{transaction.type === "payment" && transaction.receiptId ? <Link href={`/business-orders/${businessOrderId}/receipts/${transaction.receiptId}?copy=zh`}>打开 Receipt</Link> : transaction.type === "refund" ? <Link href={`/business-orders/${businessOrderId}/refunds/${transaction.id}`}>打印退款签收单</Link> : "Receipt 生成中"}</span>
          </article>
        ))}
      </section>
    </section>
  );
}
