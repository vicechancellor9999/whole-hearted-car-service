"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export interface ParkingFollowUpResult {
  channel: "phone" | "whatsapp" | "sms" | "in_person";
  note: string;
}

interface ParkingFollowUpDialogProps {
  kind: "notify" | "bill";
  plate: string;
  customerName: string;
  onClose: () => void;
  onConfirm: (result: ParkingFollowUpResult) => void | Promise<void>;
}

const TITLES = { notify: "记录已通知客户取车", bill: "记录已发停车费账单" } as const;
const HINTS = {
  notify: "由员工联系客户；通知次日为宽限期，第三日取车免费，第四日起按天计费。",
  bill: "发送动作由员工完成，这里只留痕；每 3 天一期，直到取车。",
} as const;

const CHANNELS: Array<[ParkingFollowUpResult["channel"], string]> = [
  ["phone", "电话"],
  ["whatsapp", "WhatsApp"],
  ["sms", "短信"],
  ["in_person", "当面"],
];

/** 取车通知 / 账单发送 留痕弹窗：渠道 + 内容，系统只记录不代发。 */
export function ParkingFollowUpDialog({ kind, plate, customerName, onClose, onConfirm }: ParkingFollowUpDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [channel, setChannel] = useState<ParkingFollowUpResult["channel"]>("phone");
  const [note, setNote] = useState("");
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
    if (!note.trim()) {
      setError("请填写内容记录");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onConfirm({ channel, note: note.trim() });
    } finally {
      setPending(false);
    }
  }, [channel, note, onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[kind]}
        data-testid={`parking-followup-${kind}`}
        className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink dark:text-slate-100">{TITLES[kind]}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-ink-soft dark:text-slate-400">{plate} · {customerName}</p>
            <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">{HINTS[kind]}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mt-4 block text-xs font-semibold text-ink dark:text-slate-200">
          联系方式
          <select
            data-testid="parking-followup-channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value as ParkingFollowUpResult["channel"])}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          内容记录
          <textarea
            data-testid="parking-followup-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={kind === "notify" ? "例如：电话通知客户车已修好，请尽快来取" : "例如：WhatsApp 发送第 1 期停车费账单"}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
        </label>

        {error ? <p role="alert" data-testid="parking-followup-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
          <button
            type="button"
            data-testid="parking-followup-confirm"
            disabled={pending}
            onClick={() => void submit()}
            className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {pending ? "提交中…" : "确认记录"}
          </button>
        </div>
      </div>
    </div>
  );
}
