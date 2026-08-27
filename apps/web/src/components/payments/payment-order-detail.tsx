"use client";

import { useCallback, useEffect, useRef } from "react";
import { X, PenLine, ShieldAlert, CheckCircle2, Banknote } from "lucide-react";
import type { BillingBusinessOrderResponse } from "@/lib/api/mock-billing";
import { formatDateTime, formatJMDFull } from "@/lib/utils";

const PAYMENT_LABELS = { unpaid: "未付款", partially_paid: "未付清", paid: "已付清" } as const;
const ARRANGEMENT_LABELS = { normal: "正常结算", credit: "挂账", special_agreement: "特殊协商" } as const;
const RELEASE_LABELS = { not_authorized: "未授权离店", authorized: "已授权离店", released: "已离店" } as const;
const EDITION_LABELS = { zh: "中文", en: "English", bilingual: "中英对照" } as const;

interface PaymentOrderDetailProps {
  detail: BillingBusinessOrderResponse;
  customerName: string;
  vehiclePlate: string;
  canOperate: boolean;
  onClose: () => void;
  onSignCredit: () => void;
  onSpecialRelease: () => void;
  onRecordPayment: () => void;
}

/** 收付款与交车详情（规格 §13）：施工、付款、离店三条事实独立呈现，互不覆盖。 */
export function PaymentOrderDetail({
  detail,
  customerName,
  vehiclePlate,
  canOperate,
  onClose,
  onSignCredit,
  onSpecialRelease,
  onRecordPayment,
}: PaymentOrderDetailProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled])",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const currentVersionAcknowledged = detail.acknowledgements.some(
    (item) => item.invoiceVersionId === detail.invoice.version.id,
  );
  const canSignCredit =
    detail.invoice.settlementArrangement === "credit"
    && detail.payment.balanceJmd > 0
    && !currentVersionAcknowledged;
  const canSpecialRelease = detail.payment.balanceJmd > 0 && detail.release.status === "not_authorized";
  /** 有余额就能收款——这是主路动作（2026-08-14 老板：客户难道就不能付款吗）。 */
  const canRecordPayment = detail.payment.balanceJmd > 0;

  const releasePath = detail.payment.paymentStatus === "paid"
    ? "Invoice 已付清，可直接交车"
    : detail.specialReleaseAuthorizations.length > 0
      ? "特殊协商已授权放车"
      : currentVersionAcknowledged
        ? "客户已签当次挂账 Invoice，可按挂账交车"
        : "未满足离店条件";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="收付款与交车详情"
        data-testid="payment-order-detail"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink dark:text-slate-100">
              {customerName} · {vehiclePlate}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-ink-soft dark:text-slate-400">
              {detail.businessOrder.businessOrderNo}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="payment-detail-close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line p-3 dark:border-slate-700">
            <div className="text-[10px] text-ink-soft dark:text-slate-400">Invoice 总额</div>
            <div data-testid="payment-detail-total" className="mt-1 text-sm font-bold tabular-nums text-ink dark:text-slate-100">
              {formatJMDFull(detail.invoice.version.totals.totalJmd)}
            </div>
          </div>
          <div className="rounded-xl border border-line p-3 dark:border-slate-700">
            <div className="text-[10px] text-ink-soft dark:text-slate-400">已付</div>
            <div data-testid="payment-detail-paid" className="mt-1 text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
              {formatJMDFull(detail.payment.paidJmd)}
            </div>
          </div>
          <div className="rounded-xl border border-line p-3 dark:border-slate-700">
            <div className="text-[10px] text-ink-soft dark:text-slate-400">余额</div>
            <div data-testid="payment-detail-balance" className="mt-1 text-sm font-bold tabular-nums text-rose-700 dark:text-rose-300">
              {formatJMDFull(detail.payment.balanceJmd)}
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl bg-surface p-3 dark:bg-slate-700/30">
            <span className="text-ink-soft dark:text-slate-400">付款状态</span>
            <div data-testid="payment-detail-payment-status" className="mt-0.5 font-bold text-ink dark:text-slate-100">
              {PAYMENT_LABELS[detail.payment.paymentStatus]}
            </div>
          </div>
          <div className="rounded-xl bg-surface p-3 dark:bg-slate-700/30">
            <span className="text-ink-soft dark:text-slate-400">结算安排</span>
            <div data-testid="payment-detail-arrangement" className="mt-0.5 font-bold text-ink dark:text-slate-100">
              {ARRANGEMENT_LABELS[detail.invoice.settlementArrangement]}
            </div>
          </div>
          <div className="rounded-xl bg-surface p-3 dark:bg-slate-700/30">
            <span className="text-ink-soft dark:text-slate-400">车辆离店</span>
            <div data-testid="payment-detail-release" className="mt-0.5 font-bold text-ink dark:text-slate-100">
              {RELEASE_LABELS[detail.release.status]}
            </div>
          </div>
        </div>

        <p data-testid="payment-detail-release-path" className="mt-2 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-ink dark:border-slate-600 dark:bg-slate-700/30 dark:text-slate-200">
          离店路径：{releasePath}
        </p>

        <section className="mt-3 rounded-xl border border-line p-3 dark:border-slate-700">
          <h3 className="text-xs font-bold text-ink dark:text-slate-100">
            Invoice {detail.invoice.invoiceNo} · V{detail.invoice.version.version}
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
            <div><dt className="text-ink-soft dark:text-slate-400">工时</dt><dd className="font-semibold tabular-nums">{formatJMDFull(detail.invoice.version.totals.laborJmd)}</dd></div>
            <div><dt className="text-ink-soft dark:text-slate-400">配件</dt><dd className="font-semibold tabular-nums">{formatJMDFull(detail.invoice.version.totals.partsJmd)}</dd></div>
            <div><dt className="text-ink-soft dark:text-slate-400">其他服务</dt><dd className="font-semibold tabular-nums">{formatJMDFull(detail.invoice.version.totals.otherServiceJmd)}</dd></div>
            <div><dt className="text-ink-soft dark:text-slate-400">金额调整</dt><dd className="font-semibold tabular-nums">{formatJMDFull(detail.invoice.version.totals.adjustmentsJmd)}</dd></div>
          </dl>
          {detail.parking ? (
            <p data-testid="payment-detail-parking" className="mt-2 text-[11px] text-ink-soft dark:text-slate-400">
              关联停车费：{detail.parking.finalChargeableDays} 天 · {formatJMDFull(detail.parking.finalAmountJmd)}（净额已并入其他服务，不重复计天）
            </p>
          ) : null}
        </section>

        <section data-testid="payment-detail-payments" className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/5">
          <h3 className="text-xs font-bold text-ink dark:text-slate-100">收款记录</h3>
          {detail.payment.payments.filter((fact) => fact.amountJmd > 0).length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">尚无收款记录</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[11px] text-ink-soft dark:text-slate-300">
              {detail.payment.payments.filter((fact) => fact.amountJmd > 0).map((fact) => (
                <li key={fact.id} data-testid={`payment-record-${fact.id}`}>
                  {formatDateTime(fact.receivedAt)} · <span className="font-semibold text-emerald-700 dark:text-emerald-300">{formatJMDFull(fact.amountJmd)}</span>
                  {fact.method ? ` · ${{ cash: "现金", card: "刷卡", bank_transfer: "转账", cheque: "支票" }[fact.method]}` : ""}
                  {fact.receivedBy ? ` · 收款人 ${fact.receivedBy}` : ""}
                  {fact.note ? ` · ${fact.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section data-testid="payment-detail-acknowledgements" className="mt-3 rounded-xl border border-line p-3 dark:border-slate-700">
          <h3 className="text-xs font-bold text-ink dark:text-slate-100">客户签账记录</h3>
          {detail.acknowledgements.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">尚无签账记录</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[11px] text-ink-soft dark:text-slate-300">
              {detail.acknowledgements.map((ack) => (
                <li key={ack.id}>
                  {formatDateTime(ack.signedAt)} · 签字人 {ack.customerSignerId} · 余额 {formatJMDFull(ack.balanceJmd)} · {EDITION_LABELS[ack.documentEdition]}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section data-testid="payment-detail-authorizations" className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
          <h3 className="text-xs font-bold text-ink dark:text-slate-100">特殊协商授权记录（不可删除）</h3>
          {detail.specialReleaseAuthorizations.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">无</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[11px] text-ink-soft dark:text-slate-300">
              {detail.specialReleaseAuthorizations.map((auth) => (
                <li key={auth.id}>
                  {formatDateTime(auth.authorizedAt)} · 余额 {formatJMDFull(auth.balanceJmd)} · {auth.reason} · 预计付款 {auth.expectedPaymentDate} · 客户确认：{auth.customerConfirmation}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canOperate && (canRecordPayment || canSignCredit || canSpecialRelease) ? (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {canRecordPayment ? (
              <button
                type="button"
                data-testid="payment-action-record"
                onClick={onRecordPayment}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Banknote size={15} />
                收款
              </button>
            ) : null}
            {canSignCredit ? (
              <button
                type="button"
                data-testid="payment-action-sign-credit"
                onClick={onSignCredit}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-600"
              >
                <PenLine size={15} />
                客户签账
              </button>
            ) : null}
            {canSpecialRelease ? (
              <button
                type="button"
                data-testid="payment-action-special-release"
                onClick={onSpecialRelease}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700"
              >
                <ShieldAlert size={15} />
                特殊协商放车
              </button>
            ) : null}
          </div>
        ) : null}
        {!canOperate && (canSignCredit || canSpecialRelease) ? (
          <p className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-ink-soft dark:text-slate-400">
            <CheckCircle2 size={13} />
            当前身份为只读，签账与放车操作需前台管理员或超级管理员办理
          </p>
        ) : null}
      </div>
    </div>
  );
}
