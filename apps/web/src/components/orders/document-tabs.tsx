"use client";

import { DOCUMENT_TABS, type DocumentTab } from "./types";
import { cn } from "@/lib/utils";

interface DocumentTabsProps {
  active: DocumentTab;
  onChange: (tab: DocumentTab) => void;
  counts: Record<DocumentTab, number>;
}

export function DocumentTabs({ active, onChange, counts }: DocumentTabsProps) {
  return (
    <nav
      data-testid="orders-document-tabs"
      aria-label="单据主视图"
      className="flex flex-wrap gap-2"
    >
      {DOCUMENT_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`orders-doc-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={cn(
              "min-h-10 rounded-lg border px-4 text-xs font-semibold transition-colors",
              isActive
                ? "border-primary bg-primary text-white shadow-sm"
                : "border-line bg-white text-ink-soft hover:border-primary-200 hover:text-primary dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                isActive
                  ? "bg-white/20 text-white"
                  : "bg-gray-100 text-ink-soft dark:bg-slate-700 dark:text-slate-300",
              )}
            >
              {counts[tab.id]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
