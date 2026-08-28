"use client";

import { Languages } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";

/** 全局语言切换（2026-08-18 老板 #17）：中文 ⇄ English，选择持久化。 */
export function LanguageToggle() {
  const { language, toggle } = useLanguage();
  return (
    <button
      type="button"
      data-testid="language-toggle"
      aria-pressed={language === "en"}
      aria-label={language === "zh" ? "Switch to English" : "切换为中文"}
      onClick={toggle}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-layer-2 px-2.5 text-xs font-semibold text-ink-soft hover:border-line-strong hover:text-accent"
    >
      <Languages size={14} />
      {language === "zh" ? "EN" : "中文"}
    </button>
  );
}
