export type FormalBusinessOrderHistoryChange = {
  key: string;
  label: string;
  before: string;
  after: string;
  hasBefore: boolean;
  hasAfter: boolean;
};

export type FormalBusinessOrderHistoryItem = {
  id: string;
  occurredAt: string;
  actor: string;
  summary: string;
  reason?: string | null;
  changes: FormalBusinessOrderHistoryChange[];
};

export function FormalBusinessOrderHistoryTimeline({
  items,
}: {
  items: FormalBusinessOrderHistoryItem[];
}) {
  if (items.length === 0) {
    return <p className="rounded-xl bg-surface px-4 py-8 text-center text-xs text-ink-soft">尚无可展示的历史记录。</p>;
  }

  return (
    <section aria-label="Business Order 历史记录" className="mx-auto max-w-5xl">
      <div className="border-b border-line pb-3">
        <h2 className="text-sm font-bold">历史记录</h2>
        <p className="mt-1 text-xs text-ink-soft">按时间倒序显示操作人和结果；需要时再展开字段变化。</p>
      </div>
      <ol className="relative mt-4 ml-2 border-l border-slate-200 pl-5 dark:border-slate-700">
        {items.map((item) => (
          <li key={item.id} className="relative pb-5 last:pb-0">
            <span aria-hidden className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary ring-1 ring-primary/30 dark:border-slate-900" />
            <article className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold leading-6">{item.summary}</p>
                <time className="shrink-0 text-[11px] text-ink-soft">{item.occurredAt}</time>
              </div>
              <p className="mt-0.5 text-xs text-ink-soft">{item.actor}{item.reason ? ` · 原因：${item.reason}` : ""}</p>
              {item.changes.length > 0 ? (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer select-none font-semibold text-primary">查看修改明细</summary>
                  <div className="mt-2 overflow-hidden rounded-lg border border-line bg-surface/60">
                    {item.changes.map((change) => (
                      <div key={change.key} className="grid gap-1 border-b border-line px-3 py-2 last:border-0 sm:grid-cols-[120px_1fr_1fr]">
                        <strong>{change.label}</strong>
                        <span><small className="mr-1 text-ink-soft">原来</small>{change.hasBefore ? change.before : "尚未记录"}</span>
                        <span><small className="mr-1 text-ink-soft">现在</small>{change.hasAfter ? change.after : "已清除"}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
