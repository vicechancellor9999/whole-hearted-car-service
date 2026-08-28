import Link from "next/link";

export type FormalBusinessOrderWorkspace =
  | "operations"
  | "documents"
  | "history"
  | "messages";

const TABS: ReadonlyArray<{
  id: FormalBusinessOrderWorkspace;
  label: string;
}> = [
  { id: "operations", label: "收费 · 收款 · 维修班组" },
  { id: "documents", label: "三联生成 · 预览 · 打印" },
  { id: "history", label: "历史记录" },
  { id: "messages", label: "沟通交流" },
];

export function parseBusinessOrderWorkspace(
  value: string | null,
): FormalBusinessOrderWorkspace {
  return TABS.some((tab) => tab.id === value)
    ? value as FormalBusinessOrderWorkspace
    : "operations";
}

export function buildBusinessOrderWorkspaceHref(
  pathname: string,
  searchParams: URLSearchParams,
  workspace: FormalBusinessOrderWorkspace,
): string {
  const next = new URLSearchParams(searchParams);
  next.set("tab", workspace);
  if (workspace !== "messages") next.delete("message");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function FormalBusinessOrderTabs({
  pathname,
  searchParams,
  active,
  unreadMessageCount = 0,
}: {
  pathname: string;
  searchParams: URLSearchParams;
  active: FormalBusinessOrderWorkspace;
  unreadMessageCount?: number;
}) {
  return (
    <nav
      aria-label="Business Order 工作区"
      role="tablist"
      className="sticky top-0 z-20 grid gap-1 rounded-2xl border border-line bg-white/95 p-1.5 shadow-card backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:grid-cols-2 xl:grid-cols-4"
    >
      {TABS.map((tab) => {
        const selected = active === tab.id;
        const unread = tab.id === "messages" ? unreadMessageCount : 0;
        return (
          <Link
            key={tab.id}
            href={buildBusinessOrderWorkspaceHref(pathname, searchParams, tab.id)}
            role="tab"
            aria-selected={selected}
            aria-controls={`business-order-${tab.id}-workspace`}
            scroll={false}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-center text-xs font-bold transition ${
              selected
                ? "bg-primary text-white shadow-sm"
                : "text-ink-soft hover:bg-primary-50 hover:text-primary dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <span>{tab.label}</span>
            {unread > 0 ? (
              <span
                aria-label={`${unread} 条未读提及`}
                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${
                  selected ? "bg-white text-primary" : "bg-rose-600 text-white"
                }`}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
