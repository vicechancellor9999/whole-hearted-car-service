import type { RoundDeletionAttempt } from "@/lib/orders/round-deletion-storage";

export function RoundDeletionAttemptView({ attempt, busy, checking, storageAvailable, english, onRetry, onHistory, onDismiss, onClose, onStore }: {
  attempt: RoundDeletionAttempt; busy: boolean; checking: boolean; storageAvailable: boolean; english: boolean;
  onRetry(): void; onHistory(): void; onDismiss(): void; onClose(): void; onStore(): void;
}) {
  const disabled = busy || checking;
  return <section className="space-y-3 text-sm">
    <p role={attempt.status === "unconfirmed" ? "alert" : "status"} className="font-semibold">{attempt.status === "completed" ? (english ? "Repair-round deletion confirmed" : "本轮删除已确认完成") : busy ? (english ? "Submitting deletion…" : "正在提交删除…") : (english ? "Deletion result needs verification" : "本轮删除结果尚未确认")}</p>
    <dl className="space-y-2 rounded-xl border border-line bg-layer-2 p-3">
      <div><dt className="text-xs text-ink-soft">{english ? "Original repair round" : "原删除对象"}</dt><dd className="break-all font-mono">{attempt.input.confirmationRecordNo}</dd></div>
      <div><dt className="text-xs text-ink-soft">{english ? "Request ID" : "原请求编号"}</dt><dd className="break-all font-mono text-xs">{attempt.input.requestId}</dd></div>
      <div><dt className="text-xs text-ink-soft">{english ? "Reason" : "删除原因"}</dt><dd className="break-words">{({ duplicate: english ? "Duplicate" : "重复创建", input_error: english ? "Entry error" : "录入错误", test_data: english ? "Test data" : "测试数据", other: english ? "Other" : "其他原因" })[attempt.input.reasonCode]}{attempt.input.reasonNote ? ` · ${attempt.input.reasonNote}` : ""}</dd></div>
    </dl>
    {attempt.error ? <p className="break-words text-state-danger-text">{attempt.error}</p> : null}
    <p className="text-xs leading-5 text-ink-soft">{english ? "The same account can recover this request in this tab for 24 hours. Closing does not cancel deletion. Retrying resends the original request, not a deletion of the current round." : "同一账号在当前标签页暂存24小时。关闭不代表取消删除；重试只使用原请求，不改成删除当前的新轮次。"}</p>
    {!storageAvailable ? <p role="alert" className="text-state-warning-text">{english ? "Local recovery could not be saved or cleared. Keep this page open and verify the result before refreshing." : "本机暂存或清理失败，请先留在本页核对结果，刷新可能丢失本次提示。"}<button type="button" disabled={busy} onClick={onStore} className="ml-2 min-h-11 underline">{english ? "Retry local save" : "重试本机暂存"}</button></p> : null}
    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
      {attempt.status !== "completed" ? <button type="button" disabled={disabled} onClick={onRetry} className="min-h-11 rounded-lg border border-primary px-3 font-semibold text-primary disabled:opacity-40">{english ? "Retry original request" : "沿用原请求重试"}</button> : null}
      <button type="button" disabled={disabled} onClick={onHistory} className="min-h-11 rounded-lg border border-line px-3 disabled:opacity-40">{checking ? (english ? "Reading history…" : "正在读取历史…") : (english ? "Check repair history" : "核对维修历史")}</button>
      <button type="button" disabled={disabled} onClick={onDismiss} className="min-h-11 rounded-lg border border-line px-3 disabled:opacity-40">{attempt.status === "completed" ? (english ? "Done and close" : "完成并关闭") : (english ? "Verified; dismiss reminder" : "已核对，移除此提示")}</button>
      <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line px-3">{english ? "Close" : "关闭"}</button>
    </div>
  </section>;
}
