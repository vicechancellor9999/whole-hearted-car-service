"use client";

import { LIFECYCLE_TABS, type LifecycleTab } from "./types";
import { cn } from "@/lib/utils";

interface LifecycleTabsProps {
  active: LifecycleTab;
  onChange: (tab: LifecycleTab) => void;
  counts: Record<LifecycleTab, number>;
}

export function LifecycleTabs({ active, onChange, counts }: LifecycleTabsProps) {
  return (
    <nav
      data-testid="orders-lifecycle-tabs"
      aria-label="工单生命周期"
      className="flex gap-2"
    >
      {LIFECYCLE_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={isActive}
            data-testid={`orders-tab-${tab.id}`}
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
