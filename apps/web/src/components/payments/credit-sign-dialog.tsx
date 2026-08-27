"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, PenLine } from "lucide-react";
import type { BillingBusinessOrderResponse } from "@/lib/api/mock-billing";
import { SignaturePad } from "@/components/ui/signature-pad";
import { formatJMDFull } from "@/lib/utils";

export interface CreditSignResult {
  documentEdition: "zh" | "en" | "bilingual";
  customerSignerId: string;
  signatureDataUrl: string;
}

interface CreditSignDialogProps {
  detail: BillingBusinessOrderResponse;
  onClose: () => void;
  onConfirm: (result: CreditSignResult) => void | Promise<void>;
}

const EDITION_OPTIONS = [
  { value: "zh" as const, label: "中文版本" },
  { value: "en" as const, label: "English version" },
  { value: "bilingual" as const, label: "中英对照版本" },
];

/** 客户针对当次挂账 Invoice 的现场签账。管理员的客户级资格签名不能替代本步骤（规格 §12）。 */
export function CreditSignDialog({ detail, onClose, onConfirm }: CreditSignDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [edition, setEdition] = useState<"zh" | "en" | "bilingual">("zh");
  const [signer, setSigner] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
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
    if (!signer.trim()) {
      setError("请填写客户签字人姓名");
      return;
    }
    if (!signatureDataUrl) {
      setError("请客户在签字板手写签名");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onConfirm({ documentEdition: edition, customerSignerId: signer.trim(), signatureDataUrl });
    } finally {
      setPending(false);
    }
  }, [edition, onConfirm, signatureDataUrl, signer]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="客户签账"
        data-testid="credit-sign-dialog"
        className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink dark:text-slate-100">客户签账</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">
              客户针对本张挂账 Invoice 的编号、版本、余额与语言版本现场签字确认。
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="credit-sign-close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <dl className="mt-4 space-y-2 rounded-xl bg-surface p-3 text-xs dark:bg-slate-700/30">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft dark:text-slate-400">Invoice 编号</dt>
            <dd className="font-mono font-semibold text-ink dark:text-slate-100">{detail.invoice.invoiceNo}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft dark:text-slate-400">文件版本</dt>
            <dd className="font-semibold text-ink dark:text-slate-100">V{detail.invoice.version.version}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft dark:text-slate-400">签账余额</dt>
            <dd data-testid="credit-sign-balance" className="font-bold text-rose-700 dark:text-rose-300">
              {formatJMDFull(detail.payment.balanceJmd)}
            </dd>
          </div>
        </dl>

        <label className="mt-4 block text-xs font-semibold text-ink dark:text-slate-200">
          签署语言版本
          <select
            data-testid="credit-sign-edition"
            value={edition}
            onChange={(event) => setEdition(event.target.value as "zh" | "en" | "bilingual")}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {EDITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          客户签字人姓名（记录用途）
          <input
            data-testid="credit-sign-signer"
            value={signer}
            onChange={(event) => setSigner(event.target.value)}
            placeholder="签字人姓名"
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
        </label>

        <div className="mt-3">
          <SignaturePad
            label="客户手写签名"
            testId="credit-sign-pad"
            onChange={(_signed, dataUrl) => setSignatureDataUrl(dataUrl)}
          />
        </div>

        {error ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}

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
            data-testid="credit-sign-confirm"
            disabled={pending}
            onClick={() => void submit()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
          >
            <PenLine size={15} />
            {pending ? "提交中…" : "确认签账"}
          </button>
        </div>
      </div>
    </div>
  );
}
