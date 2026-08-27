"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ParkingCaseDto, ParkingWaiverPreviewDto } from "@/lib/api/mock-parking";
import { SignaturePad } from "@/components/ui/signature-pad";
import { formatJMDFull } from "@/lib/utils";

export interface WaiverConfirmInput {
  waiveDays: number;
  reason: string;
  preview: ParkingWaiverPreviewDto;
  administratorId?: string;
  signatureDataUrl?: string;
}

interface WaiverDialogProps {
  parkingCase: ParkingCaseDto;
  administrators: ReadonlyArray<{ id: string; name: string }>;
  onPreview: (waiveDays: number, reason: string) => Promise<ParkingWaiverPreviewDto>;
  onClose: () => void;
  onConfirm: (input: WaiverConfirmInput) => void | Promise<void>;
}

const REASON_PRESETS = ["关系维护", "门店停业", "其他真实原因"];

/**
 * 停车费减免（规格 §14.2）：先预览后确认；原始与减免后金额分别保留；
 * 同一案件累计实际减免超过 JMD 50,000 必须管理员现场签名，不得拆分规避。
 */
export function WaiverDialog({ parkingCase, administrators, onPreview, onClose, onConfirm }: WaiverDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [waiveDaysText, setWaiveDaysText] = useState("");
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [preview, setPreview] = useState<ParkingWaiverPreviewDto | null>(null);
  const [administratorId, setAdministratorId] = useState(administrators[0]?.id ?? "");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const effectiveReason = reason === "__custom" ? customReason.trim() : reason;
  const remainingDays = parkingCase.originalChargeableDays
    - (parkingCase.waiverHistory[parkingCase.waiverHistory.length - 1]?.cumulativeWaivedDays ?? 0);

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

  const runPreview = useCallback(async () => {
    const days = Number(waiveDaysText);
    if (!Number.isSafeInteger(days) || days <= 0) {
      setError("减免天数必须为正整数");
      return;
    }
    if (days > remainingDays) {
      setError(`累计减免天数不得超过原始计费天数（剩余可减 ${remainingDays} 天）`);
      return;
    }
    if (!effectiveReason) {
      setError("请选择或填写减免原因");
      return;
    }
    setError(null);
    setPending(true);
    try {
      setPreview(await onPreview(days, effectiveReason));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "预览失败，请重试");
    } finally {
      setPending(false);
    }
  }, [effectiveReason, onPreview, remainingDays, waiveDaysText]);

  const confirm = useCallback(async () => {
    if (!preview) return;
    if (preview.requiresAdministratorSignature) {
      const administrator = administrators.find((item) => item.id === administratorId);
      if (!administrator) {
        setError("请选择现场签名管理员");
        return;
      }
      // 笔迹仅作记录留痕，不校验签的是谁
      if (!signatureDataUrl) {
        setError("请管理员在签字板手写签名（记录用途）");
        return;
      }
    }
    setError(null);
    setPending(true);
    try {
      await onConfirm({
        waiveDays: preview.proposedWaivedDays,
        reason: effectiveReason,
        preview,
        ...(preview.requiresAdministratorSignature
          ? { administratorId, ...(signatureDataUrl ? { signatureDataUrl } : {}) }
          : {}),
      });
    } finally {
      setPending(false);
    }
  }, [administratorId, administrators, effectiveReason, onConfirm, preview, signatureDataUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="停车费减免"
        data-testid="waiver-dialog"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink dark:text-slate-100">停车费减免 · {parkingCase.caseId}</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">
              原始 {parkingCase.originalChargeableDays} 天 · {formatJMDFull(parkingCase.originalAmountJmd)}；剩余可减 {remainingDays} 天。
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="waiver-close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-ink dark:text-slate-200">
            减免天数（整数天）
            <input
              data-testid="waiver-days"
              value={waiveDaysText}
              onChange={(event) => { setWaiveDaysText(event.target.value); setPreview(null); }}
              inputMode="numeric"
              placeholder={`1 ~ ${remainingDays}`}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          </label>
          <label className="block text-xs font-semibold text-ink dark:text-slate-200">
            减免原因
            <select
              data-testid="waiver-reason"
              value={reason}
              onChange={(event) => { setReason(event.target.value); setPreview(null); }}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="">请选择原因</option>
              {REASON_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{preset}</option>
              ))}
              <option value="__custom">其他（自行填写）</option>
            </select>
          </label>
        </div>
        {reason === "__custom" ? (
          <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
            自定义原因
            <input
              data-testid="waiver-custom-reason"
              value={customReason}
              onChange={(event) => { setCustomReason(event.target.value); setPreview(null); }}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          </label>
        ) : null}

        <button
          type="button"
          data-testid="waiver-preview"
          disabled={pending}
          onClick={() => void runPreview()}
          className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-primary-200 px-4 text-sm font-semibold text-primary hover:bg-primary-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          {pending && !preview ? "预览中…" : "预览减免结果"}
        </button>

        {preview ? (
          <dl data-testid="waiver-preview-result" className="mt-3 space-y-1.5 rounded-xl bg-surface p-3 text-xs dark:bg-slate-700/30">
            <div className="flex justify-between"><dt className="text-ink-soft dark:text-slate-400">本次减免</dt><dd className="font-semibold">{preview.proposedWaivedDays} 天 · {formatJMDFull(preview.proposedWaivedAmountJmd)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft dark:text-slate-400">累计减免</dt><dd data-testid="waiver-cumulative" className="font-semibold">{preview.cumulativeWaivedDays} 天 · {formatJMDFull(preview.cumulativeWaivedAmountJmd)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft dark:text-slate-400">减免后应付</dt><dd data-testid="waiver-final" className="font-bold text-primary">{preview.finalChargeableDays} 天 · {formatJMDFull(preview.finalAmountJmd)}</dd></div>
            <div className="flex justify-between">
              <dt className="text-ink-soft dark:text-slate-400">权限</dt>
              <dd data-testid="waiver-permission" className={preview.requiresAdministratorSignature ? "font-bold text-amber-600" : "font-semibold text-emerald-700 dark:text-emerald-300"}>
                {preview.requiresAdministratorSignature ? "累计减免超过 JMD 50,000，需管理员现场签名" : "前台可自行处理"}
              </dd>
            </div>
          </dl>
        ) : null}

        {preview?.requiresAdministratorSignature ? (
          <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">
              现场签名管理员
              <select
                data-testid="waiver-admin"
                value={administratorId}
                onChange={(event) => setAdministratorId(event.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              >
                {administrators.map((admin) => (
                  <option key={admin.id} value={admin.id}>{admin.name}</option>
                ))}
              </select>
            </label>
            <div className="mt-2">
              <SignaturePad
                label="管理员现场签名（笔迹仅作记录留痕）"
                testId="waiver-admin-signature"
                onChange={(_signed, dataUrl) => setSignatureDataUrl(dataUrl)}
              />
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" data-testid="waiver-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
          <button
            type="button"
            data-testid="waiver-confirm"
            disabled={!preview || pending}
            onClick={() => void confirm()}
            className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {pending && preview ? "提交中…" : "确认减免"}
          </button>
        </div>
      </div>
    </div>
  );
}
