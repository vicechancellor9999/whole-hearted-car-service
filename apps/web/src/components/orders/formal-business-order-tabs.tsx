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
}> = [
  { id: "operations", labelZh: "收费 · 收款 · 维修班组", labelEn: "Charges · Payments · Repair team" },
  { id: "documents", labelZh: "三联生成 · 预览 · 打印", labelEn: "Documents · Preview · Print" },
  { id: "attachments", labelZh: "业务附件", labelEn: "Attachments" },
  { id: "history", labelZh: "历史记录", labelEn: "History" },
  { id: "messages", labelZh: "沟通交流", labelEn: "Comments" },
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
      className="sticky top-0 z-20 grid gap-1 rounded-2xl border border-line bg-card p-1.5 shadow-card sm:grid-cols-2 xl:grid-cols-5"
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
                : "text-ink-soft hover:bg-layer-2 hover:text-accent"
            }`}
          >
            <span>{language === "en" ? tab.labelEn : tab.labelZh}</span>
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
