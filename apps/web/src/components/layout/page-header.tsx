"use client";

import type { ReactNode } from "react";
import { LiveClock } from "./live-clock";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { translateUi, useLanguage } from "@/lib/i18n/language";

interface PageHeaderProps {
  breadcrumb: string;
  title: string;
  description: string;
  titleTestId?: string;
  titleAddon?: ReactNode;
  action?: ReactNode;
}

/** Module-owned page header. The full Overview heading remains exclusive to `/`. */
export function PageHeader({
  breadcrumb,
  title,
  description,
  titleTestId,
  titleAddon,
  action,
}: PageHeaderProps) {
  const { language } = useLanguage();
  const shownBreadcrumb = translateUi(breadcrumb, language);
  const shownTitle = translateUi(title, language);
  const shownDescription = language === "en" ? translateUi(description, language) : description;
  return (
    <header
      data-testid="page-header"
      className="relative mb-3 flex flex-col gap-3 overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50/80 via-blue-100/60 to-blue-50/80 px-4 py-4 shadow-sm dark:border-slate-700 dark:bg-gradient-to-r dark:from-slate-800/80 dark:via-slate-800/60 dark:to-slate-800/80 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-200/50 to-transparent dark:via-primary-500/30" />

      <div className="relative min-w-0">
        <div className="text-xs font-medium text-primary dark:text-primary-400">{shownBreadcrumb}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1
            data-testid={titleTestId}
            className="text-2xl font-bold text-ink dark:text-slate-100"
          >
            {shownTitle}
          </h1>
          {titleAddon}
        </div>
        <p
          data-testid="page-header-description"
          className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-soft dark:text-slate-400"
        >
          {shownDescription}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-3 sm:shrink-0 sm:justify-end sm:gap-5 sm:text-right">
        {action}
        <LiveClock />
        <LanguageToggle />
        <div className="hidden h-10 w-px bg-blue-200/60 dark:bg-slate-600 sm:block" />
        <ThemeToggle />
      </div>
    </header>
  );
}
