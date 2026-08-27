"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  IR_CONTACT_CHANNEL_LABELS,
  IR_REPLY_DECISION_LABELS,
  type IrContactChannel,
  type IrReplyDecision,
} from "@/lib/api/mock-ir-followup";

export type IrActionKind = "send" | "reply" | "followup";

export interface IrActionResult {
  channel: IrContactChannel;
  note: string;
  decision?: IrReplyDecision;
}

interface IrActionDialogProps {
  kind: IrActionKind;
  reportNo: string;
  onClose: () => void;
  onConfirm: (result: IrActionResult) => void | Promise<void>;
}

const TITLES: Record<IrActionKind, string> = {
  send: "标记已发送客户",
  reply: "记录客户回复",
  followup: "催收记一笔",
};

const HINTS: Record<IrActionKind, string> = {
  send: "发送是独立于定稿的动作；发送后开始计算回复账龄。",
  reply: "客户回复到达即闭环；修不修转建单流程，IR 不再追踪。",
  followup: "催收留痕，不重置首次发送日期；超期单会持续上榜直到回复。",
};

const CHANNELS = Object.entries(IR_CONTACT_CHANNEL_LABELS) as Array<[IrContactChannel, string]>;
const DECISIONS = Object.entries(IR_REPLY_DECISION_LABELS) as Array<[IrReplyDecision, string]>;

/** 发送 / 回复 / 催收 三合一跟进动作弹窗：渠道 + 内容，回复带客户决定。 */
export function IrActionDialog({ kind, reportNo, onClose, onConfirm }: IrActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [channel, setChannel] = useState<IrContactChannel>("whatsapp");
  const [decision, setDecision] = useState<IrReplyDecision>("accepted_all");
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
      await onConfirm({ channel, note: note.trim(), ...(kind === "reply" ? { decision } : {}) });
    } finally {
      setPending(false);
    }
  }, [channel, decision, kind, note, onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[kind]}
        data-testid={`ir-action-${kind}`}
        className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink dark:text-slate-100">{TITLES[kind]}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-ink-soft dark:text-slate-400">{reportNo}</p>
            <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">{HINTS[kind]}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="ir-action-close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-ink dark:text-slate-200">
            沟通渠道
            <select
              data-testid="ir-action-channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as IrContactChannel)}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              {CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {kind === "reply" ? (
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">
              客户决定
              <select
                data-testid="ir-action-decision"
                value={decision}
                onChange={(event) => setDecision(event.target.value as IrReplyDecision)}
                className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              >
                {DECISIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">
          内容记录
          <textarea
            data-testid="ir-action-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={kind === "send" ? "例如：已发报告链接 + PDF 摘要" : kind === "reply" ? "例如：客户回复同意更换刹车片和轮胎" : "例如：第二次 WhatsApp 催收，客户未读"}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
        </label>

        {error ? <p role="alert" data-testid="ir-action-error" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
          <button
            type="button"
            data-testid="ir-action-confirm"
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
