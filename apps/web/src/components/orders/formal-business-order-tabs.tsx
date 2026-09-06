"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/language";

export type FormalBusinessOrderWorkspace =
  | "operations"
  | "documents"
  | "attachments"
  | "history"
  | "messages";

const TABS: ReadonlyArray<{
  id: FormalBusinessOrderWorkspace;
  labelZh: string;
  labelEn: string;
  shortZh: string;
  shortEn: string;
}> = [
  { id: "operations", labelZh: "业务单明细", labelEn: "Order details", shortZh: "明细", shortEn: "Details" },
  { id: "documents", labelZh: "单据与打印", labelEn: "Documents", shortZh: "单据", shortEn: "Docs" },
  { id: "attachments", labelZh: "业务附件", labelEn: "Attachments", shortZh: "附件", shortEn: "Files" },
  { id: "history", labelZh: "历史记录", labelEn: "History", shortZh: "历史", shortEn: "History" },
  { id: "messages", labelZh: "沟通交流", labelEn: "Comments", shortZh: "沟通", shortEn: "Chat" },
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
  const { language } = useI18n();
  return (
    <nav
      aria-label={language === "en" ? "Business Order workspace" : "Business Order 工作区"}
      role="tablist"
      className="grid shrink-0 grid-cols-5 gap-1 rounded-xl border border-line bg-card p-1"
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
            aria-label={language === "en" ? tab.labelEn : tab.labelZh}
            aria-controls={`business-order-${tab.id}-workspace`}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => {
              const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? []);
              const index = tabs.indexOf(event.currentTarget);
              const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
                : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); tabs[next]?.focus(); }
            }}
            scroll={false}
            className={`relative flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-1 text-center text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:px-3 ${
              selected
                ? "bg-primary text-white shadow-sm"
                : "text-ink-soft hover:bg-layer-2 hover:text-accent"
            }`}
          >
            <span className="sm:hidden">{language === "en" ? tab.shortEn : tab.shortZh}</span>
            <span className="hidden sm:inline">{language === "en" ? tab.labelEn : tab.labelZh}</span>
            {unread > 0 ? (
              <span
                aria-label={language === "en" ? `${unread} unread mentions` : `${unread} 条未读提及`}
                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${
                  selected ? "bg-card text-accent-solid" : "bg-rose-600 text-white"
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
