"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { readFormalRecordDeletionResult } from "@/lib/api/formal-record-deletions";
import { DELETION_RECOVERY_CHANGED, deletionListPath, forgetDeletionAttempt, readDeletionAttempts, type DeletionRecoveryEntry } from "@/lib/record-deletion-recovery";
import { useDeletionAccount } from "./use-deletion-account";

export function DeletionRecoveryPanel() {
  const { accountId, error, reload } = useDeletionAccount();
  if (error) return <div className="shrink-0 px-3 text-sm print:hidden"><button type="button" onClick={reload} className="min-h-11 text-state-warning-text">删除进度读取失败，重新读取</button></div>;
  return accountId ? <AccountRecoveryPanel key={accountId} accountId={accountId} /> : null;
}

function AccountRecoveryPanel({ accountId }: { accountId: number }) {
  const [state, setState] = useState(() => readDeletionAttempts(accountId));
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const refresh = () => setState(readDeletionAttempts(accountId));
  useEffect(() => {
    const changed = () => setState(readDeletionAttempts(accountId));
    window.addEventListener(DELETION_RECOVERY_CHANGED, changed);
    return () => window.removeEventListener(DELETION_RECOVERY_CHANGED, changed);
  }, [accountId]);
  if (!state.entries.length && state.available) return null;
  return <div className="shrink-0 border-b border-line bg-card px-3 text-sm print:hidden">
    <button type="button" onClick={event => { setTrigger(event.currentTarget); setOpen(true); }} className="min-h-11 font-semibold text-primary">删除进度 · {state.entries.length} 项待核对</button>
    <Dialog open={open} title="删除进度" onClose={() => setOpen(false)} returnFocusElement={trigger} className="w-[min(680px,calc(100vw-2rem))]">
      <div className="space-y-3 p-4 sm:p-6">
        <p className="text-sm text-ink-soft">本账号在当前标签页提交的删除请求暂存24小时。这里只查询结果；原详情不存在时仍可核对。</p>
        {!state.available ? <p role="alert" className="text-sm text-state-warning-text">暂存无法读取，未确认的请求可能未列出。<button type="button" onClick={refresh} className="ml-2 min-h-11 underline">重新读取</button></p> : null}
        {state.entries.map(entry => <RecoveryItem key={entry.input.requestId} entry={entry} />)}
      </div>
    </Dialog>
  </div>;
}

function RecoveryItem({ entry }: { entry: DeletionRecoveryEntry }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [cleanupError, setCleanupError] = useState(false);
  const active = useRef(true);
  const reading = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const query = async () => {
    if (reading.current) return;
    reading.current = true; setBusy(true); setMessage(null);
    try {
      const result = await readFormalRecordDeletionResult(entry.input);
      if (!active.current) return;
      setCompleted(Boolean(result));
      setMessage(result ? (result.fileCleanupPending ? `附件仍有 ${result.fileCleanupPending} 项等待后台清理。` : null) : "尚未找到已完成的删除回执，结果仍未确认。可稍后再次查询；原记录仍在时可在详情沿用原请求重试。");
    } catch (error) {
      if (active.current) setMessage(error instanceof Error ? error.message : "查询失败，可以重新查询。");
    } finally { reading.current = false; if (active.current) setBusy(false); }
  };
  return <section className="space-y-2 rounded-xl border border-line p-3">
    <h3 className="break-all font-mono text-sm font-semibold">{entry.input.root.recordNo}</h3>
    <p className="break-all text-xs text-ink-soft">请求编号：{entry.input.requestId}</p>
    <p role="status" className="text-sm font-semibold">{completed ? "删除已完成" : "删除结果待核对"}</p>
    {message ? <p role="alert" className="text-sm text-ink-soft">{message}</p> : null}
    {cleanupError ? <p role="alert" className="text-sm text-state-warning-text">提示清理失败，请重试移除此提示；不会重新执行删除。</p> : null}
    <div className="flex flex-wrap gap-2 text-sm">
      <button type="button" disabled={busy} onClick={() => void query()} className="min-h-11 rounded-lg border border-line px-3 disabled:opacity-50">{busy ? "正在查询…" : "只查询结果"}</button>
      <a href={deletionListPath(entry.input.root.kind)} className="inline-flex min-h-11 items-center rounded-lg border border-line px-3">核对列表</a>
      <button type="button" disabled={busy} onClick={() => setCleanupError(!forgetDeletionAttempt(entry.accountId, entry.input.requestId))} className="min-h-11 rounded-lg border border-line px-3 disabled:opacity-50">已核对，移除此提示</button>
    </div>
  </section>;
}
