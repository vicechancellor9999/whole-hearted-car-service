"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, X } from "lucide-react";
import type { PaymentMethod } from "@/lib/billing/types";
import { formatJMDFull } from "@/lib/utils";

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "现金 Cash" },
  { value: "card", label: "刷卡 Card" },
  { value: "bank_transfer", label: "银行转账 Transfer" },
  { value: "cheque", label: "支票 Cheque" },
];

export interface RecordPaymentResult {
  amountJmd: number;
  method: PaymentMethod;
  note: string;
}

/** 收款登记弹窗：默认全额收尾款，可改部分付款；金额不得超余额。 */
export function RecordPaymentDialog({
  invoiceNo,
  balanceJmd,
  pending,
  onCancel,
  onConfirm,
}: {
  invoiceNo: string;
  balanceJmd: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (result: RecordPaymentResult) => void;
}) {
  const [amountText, setAmountText] = useState(String(balanceJmd));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
    amountRef.current?.select();
  }, []);

  const submit = useCallback(() => {
    const amount = Math.round(Number(amountText.replace(/[,\s]/g, "")));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("收款金额必须大于 0");
      return;
    }
    if (amount > balanceJmd) {
      setError(`不能超过余额 ${formatJMDFull(balanceJmd)}`);
      return;
    }
    setError(null);
    onConfirm({ amountJmd: amount, method, note: note.trim() });
  }, [amountText, balanceJmd, method, note, onConfirm]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="收款登记"
        data-testid="record-payment-dialog"
        className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink dark:text-slate-100">
              <Banknote size={18} className="text-emerald-600" aria-hidden />收款登记
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">{invoiceNo} · 当前余额 <span className="font-semibold text-rose-600">{formatJMDFull(balanceJmd)}</span></p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line dark:border-slate-600">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-ink dark:text-slate-200">
            收款金额（JMD）
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={amountRef}
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                inputMode="numeric"
                data-testid="payment-amount"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold tabular-nums dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              />
              <button
                type="button"
                data-testid="payment-full-amount"
                onClick={() => setAmountText(String(balanceJmd))}
                className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-[11px] font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-400"
              >全额</button>
            </div>
          </label>
          <label className="block text-xs font-semibold text-ink dark:text-slate-200">
            支付方式
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              data-testid="payment-method"
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              {METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink dark:text-slate-200">
            备注（可选）
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：先付一半，余款周五结"
              data-testid="payment-note"
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          </label>
        </div>

        {error ? <p role="alert" data-testid="payment-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
          <button
            type="button"
            data-testid="payment-confirm"
            disabled={pending}
            onClick={submit}
            className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "登记中…" : "确认收款"}
          </button>
        </div>
      </div>
    </div>
  );
}
