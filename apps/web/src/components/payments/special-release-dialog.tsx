"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ShieldAlert } from "lucide-react";
import type { BillingBusinessOrderResponse } from "@/lib/api/mock-billing";
import { SignaturePad } from "@/components/ui/signature-pad";
import { formatJMDFull } from "@/lib/utils";

export interface SpecialReleaseResult {
  reason: string;
  expectedPaymentDate: string;
  administratorId: string;
  customerConfirmation: string;
  signatureDataUrl: string;
}

interface SpecialReleaseDialogProps {
  detail: BillingBusinessOrderResponse;
  administrators: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
  onConfirm: (result: SpecialReleaseResult) => void | Promise<void>;
}

const REASON_PRESETS = [
  "客户长期合作，本周内回款",
  "客户等待保险理赔到账",
  "客户境外转账在途",
  "门店关系维护",
];

/**
 * 特殊协商放车授权（规格 §13）：必须形成不可删除的授权记录，
 * 包含余额、原因、预计付款日期、前台经办人、授权人、客户确认和时间。
 * 默认前台登记、管理员现场确认，防止成为绕过挂账资格的无痕入口。
 */
export function SpecialReleaseDialog({ detail, administrators, onClose, onConfirm }: SpecialReleaseDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [administratorId, setAdministratorId] = useState(administrators[0]?.id ?? "");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [customerConfirmation, setCustomerConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const effectiveReason = reason === "__custom" ? customReason.trim() : reason;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
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

  const submit = useCallback(async () => {
    if (!effectiveReason) {
      setError("请选择或填写特殊协商原因");
      return;
    }
    if (!expectedDate) {
      setError("请选择预计付款日期");
      return;
    }
    const administrator = administrators.find((item) => item.id === administratorId);
    if (!administrator) {
      setError("请选择现场授权管理员");
      return;
    }
    // 笔迹仅作记录留痕，不校验签的是谁
    if (!signatureDataUrl) {
      setError("请管理员在签字板手写签名（记录用途）");
      return;
    }
    if (!customerConfirmation.trim()) {
      setError("请填写客户确认内容");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onConfirm({
        reason: effectiveReason,
        expectedPaymentDate: expectedDate,
        administratorId,
        customerConfirmation: customerConfirmation.trim(),
        signatureDataUrl,
      });
    } finally {
      setPending(false);
    }
  }, [administratorId, administrators, customerConfirmation, effectiveReason, expectedDate, onConfirm, signatureDataUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="特殊协商放车授权"
        data-testid="special-release-dialog"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink dark:text-slate-100">
              <ShieldAlert size={18} className="text-amber-500" />
              特殊协商放车授权
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">
              授权记录不可删除；前台登记、管理员现场确认后方可生效。
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="special-release-close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <dl className="mt-4 space-y-2 rounded-xl bg-amber-50/70 p-3 text-xs dark:bg-amber-500/10">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft dark:text-slate-400">Business Order</dt>
            <dd className="font-mono font-semibold text-ink dark:text-slate-100">{detail.businessOrder.businessOrderNo}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft dark:text-slate-400">未付余额（授权标的）</dt>
            <dd data-testid="special-release-balance" className="font-bold text-rose-700 dark:text-rose-300">
              {formatJMDFull(detail.payment.balanceJmd)}
            </dd>
          </div>
        </dl>

        <label className="mt-4 block text-xs font-semibold text-ink dark:text-slate-200">
          协商原因
          <select
            data-testid="special-release-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            <option value="">请选择原因</option>
            {REASON_PRESETS.map((preset) => (
              <option key={preset} value={preset}>{preset}</option>
            ))}
            <option value="__custom">其他（自行填写）</option>
          </select>
        </label>
        {reason === "__custom" ? (
          <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
            自定义原因
            <input
              data-testid="special-release-custom-reason"
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          </label>
        ) : null}

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          预计付款日期
          <input
            type="date"
            data-testid="special-release-date"
            value={expectedDate}
            onChange={(event) => setExpectedDate(event.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
        </label>

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          现场授权管理员
          <select
            data-testid="special-release-admin"
            value={administratorId}
            onChange={(event) => setAdministratorId(event.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {administrators.map((admin) => (
              <option key={admin.id} value={admin.id}>{admin.name}</option>
            ))}
          </select>
        </label>

        <div className="mt-3">
          <SignaturePad
            label="管理员现场签名（笔迹仅作记录留痕）"
            testId="special-release-admin-signature"
            onChange={(_signed, dataUrl) => setSignatureDataUrl(dataUrl)}
          />
        </div>

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          客户确认
          <textarea
            data-testid="special-release-customer-confirmation"
            value={customerConfirmation}
            onChange={(event) => setCustomerConfirmation(event.target.value)}
            placeholder="例如：客户现场确认知晓余额并承诺按预计日期付款"
            rows={2}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
        </label>

        {error ? <p role="alert" data-testid="special-release-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm dark:border-slate-600"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="special-release-confirm"
            disabled={pending}
            onClick={() => void submit()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {pending ? "提交中…" : "登记授权并放车"}
          </button>
        </div>
      </div>
    </div>
  );
}
