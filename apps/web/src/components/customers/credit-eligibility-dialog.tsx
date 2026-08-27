"use client";

import { useCallback, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api/client";
import { SignaturePad } from "@/components/ui/signature-pad";

/** 挂账资格登记/取消弹窗：登记用签名面板（有笔迹即可，无审批），取消填原因留痕。 */
export function CreditEligibilityDialog({ mode, customerId, onClose, onDone }: {
  mode: "grant" | "revoke";
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [signed, setSigned] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = useCallback(async () => {
    if (mode === "grant" && !signed) { setError("请先手写签名"); return; }
    if (mode === "revoke" && !reason.trim()) { setError("请填写取消原因"); return; }
    setError(null);
    setPending(true);
    try {
      await api.customers.action(customerId, mode === "grant"
        ? { type: "grant_credit", signatureNote: "签名面板笔迹留痕", signatureDataUrl }
        : { type: "revoke_credit", reason: reason.trim() });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
      setPending(false);
    }
  }, [customerId, mode, onDone, reason, signed]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label={mode === "grant" ? "登记挂账资格" : "取消挂账资格"} data-testid="credit-dialog" className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink dark:text-slate-100">{mode === "grant" ? "登记挂账资格" : "取消挂账资格"}</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">
              {mode === "grant" ? "拿面板找管理员签字，签完直接提交即生效——不是审批流程" : "取消后该客户不能再挂账取车，欠账继续跟踪"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line dark:border-slate-600"><X size={16} /></button>
        </div>
        {mode === "grant" ? (
          <div className="mt-3"><SignaturePad label="管理员签名" testId="credit-signature" onChange={(ok, dataUrl) => { setSigned(ok); setSignatureDataUrl(dataUrl); }} /></div>
        ) : (
          <label className="mt-4 block text-xs font-semibold text-ink dark:text-slate-200">
            取消原因
            <textarea data-testid="credit-revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="例如：月结多次逾期，暂停挂账" className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
          </label>
        )}
        {error ? <p role="alert" data-testid="credit-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
          <button
            type="button"
            data-testid="credit-confirm"
            disabled={pending}
            onClick={() => void submit()}
            className={`min-h-10 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50 ${mode === "grant" ? "bg-primary hover:bg-primary-600" : "bg-rose-600 hover:bg-rose-700"}`}
          >
            {pending ? "提交中…" : mode === "grant" ? "提交并立即生效" : "确认取消资格"}
          </button>
        </div>
      </div>
    </div>
  );
}
