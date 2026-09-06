export function BusinessPendingQuoteNotice({ count, english, onEdit }: { count: number; english: boolean; onEdit?(): void }) {
  if (!count) return null;
  return <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-state-warning-border bg-state-warning-subtle p-3 text-sm text-state-warning-text">
    <p>{english ? `${count} item(s) pending quote. Current totals include priced items only.` : `${count} 项待报价，当前合计仅含已报价部分。`}</p>
    {onEdit ? <button type="button" onClick={onEdit} className="min-h-11 shrink-0 rounded-lg border border-state-warning-border px-3 font-semibold">{english ? "Add prices" : "补充价格"}</button> : null}
  </div>;
}
