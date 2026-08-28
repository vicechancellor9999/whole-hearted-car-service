"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme-provider";
import type { ThemeMode } from "./theme-contract";

const MODE_OPTIONS: Array<{ mode: ThemeMode; label: string; Icon: typeof Monitor }> = [
  { mode: "system", label: "跟随系统", Icon: Monitor },
  { mode: "light", label: "柔和亮色", Icon: Sun },
  { mode: "dark", label: "舒适暗色", Icon: Moon },
];

export function ThemeToggle() {
  const { mode, theme, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeOption = MODE_OPTIONS.find((option) => option.mode === mode) ?? MODE_OPTIONS[0];
  const ActiveIcon = mode === "system" ? Monitor : theme === "dark" ? Moon : Sun;

  useEffect(() => {
    if (!open) return;
    const closeForOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeForOutsideClick);
    document.addEventListener("keydown", closeForEscape);
    return () => {
      document.removeEventListener("pointerdown", closeForOutsideClick);
      document.removeEventListener("keydown", closeForEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-700"
        aria-label={`主题：${activeOption.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`主题：${activeOption.label}`}
      >
        <ActiveIcon size={19} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="主题模式"
          className="absolute right-0 top-11 z-50 w-40 overflow-hidden rounded-xl border border-line bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          {MODE_OPTIONS.map(({ mode: optionMode, label, Icon }) => {
            const selected = mode === optionMode;
            return (
              <button
                key={optionMode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setMode(optionMode);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-ink hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Icon size={15} className="text-ink-soft" />
                <span className="flex-1">{label}</span>
                {selected ? <Check size={14} className="text-primary" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
