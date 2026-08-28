"use client";

import { createPortal } from "react-dom";
import { Check, ChevronUp, Languages, LogOut, Monitor, Moon, Settings2, Sun, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "@/components/theme/theme-provider";
import type { ThemeMode } from "@/components/theme/theme-contract";
import { useI18n, type UiLanguage } from "@/lib/i18n/language";
import { saveAccountUiLanguage } from "@/lib/api/account-preferences";
import type { Identity } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AccountSettingsPopoverProps {
  current: Identity;
  identities: Identity[];
  formalAuthEnabled: boolean;
  collapsed?: boolean;
  surface?: "desktop" | "drawer";
  onSwitchIdentity?: (id: string) => void;
}

interface PopoverPosition {
  left: number;
  bottom: number;
  width: number;
}

const themeOptions: Array<{ mode: ThemeMode; Icon: typeof Monitor }> = [
  { mode: "system", Icon: Monitor },
  { mode: "light", Icon: Sun },
  { mode: "dark", Icon: Moon },
];

function PreferenceOption({ checked, children, onClick }: {
  checked: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "relative flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        checked
          ? "bg-card text-accent shadow-sm ring-1 ring-line-strong"
          : "text-ink-soft hover:bg-layer-3 hover:text-ink",
      )}
    >
      {children}
      {checked ? <Check aria-hidden="true" size={13} /> : null}
    </button>
  );
}

export function AccountSettingsPopover({
  current,
  identities,
  formalAuthEnabled,
  collapsed = false,
  surface = "desktop",
  onSwitchIdentity,
}: AccountSettingsPopoverProps) {
  const { language, setLanguage, t } = useI18n();
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [languageSaveError, setLanguageSaveError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const copy = {
    title: t("account.title"),
    subtitle: t("account.subtitle"),
    language: t("account.language"),
    appearance: t("account.appearance"),
    preview: t("account.previewIdentity"),
    system: t("account.theme.system"),
    light: t("account.theme.light"),
    dark: t("account.theme.dark"),
    signOut: t("account.signOut"),
    close: t("account.close"),
    open: t("account.open"),
  };

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 12;
    const narrow = window.innerWidth < 640;
    const width = narrow ? Math.max(280, window.innerWidth - gutter * 2) : 320;
    setPosition({
      left: narrow ? gutter : Math.min(rect.right + gutter, window.innerWidth - width - gutter),
      bottom: Math.max(gutter, window.innerHeight - rect.bottom),
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !position) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [open, position]);

  useLayoutEffect(() => () => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const closeForOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeForOutsidePress);
    document.addEventListener("keydown", closeForEscape);
    return () => {
      document.removeEventListener("pointerdown", closeForOutsidePress);
      document.removeEventListener("keydown", closeForEscape);
    };
  }, [open]);

  const labelsByTheme: Record<ThemeMode, string> = {
    system: copy.system,
    light: copy.light,
    dark: copy.dark,
  };
  const triggerTestId = surface === "drawer"
    ? "account-settings-trigger-drawer"
    : "account-settings-trigger";

  const selectLanguage = async (nextLanguage: UiLanguage) => {
    if (nextLanguage === language) return;
    const previous = language;
    setLanguageSaveError(null);
    setLanguage(nextLanguage);
    if (!formalAuthEnabled) return;
    try {
      await saveAccountUiLanguage(nextLanguage);
    } catch {
      setLanguage(previous);
      setLanguageSaveError(t("account.languageSaveFailed"));
    }
  };

  const panel = open && position ? (
    <div
      ref={panelRef}
      id={`account-settings-panel-${surface}`}
      data-testid="account-settings-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`account-settings-title-${surface}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
      className="fixed z-[110] max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl border border-line-strong bg-card shadow-2xl"
      style={{ left: position.left, bottom: position.bottom, width: position.width }}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--wh-background-selected)] text-accent">
          <Settings2 aria-hidden="true" size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={`account-settings-title-${surface}`} className="text-sm font-bold text-ink">{copy.title}</h2>
          <p className="mt-0.5 text-[11px] text-ink-soft">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          aria-label={copy.close}
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-layer-2 hover:text-ink"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-layer-2 p-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: current.avatarColor }}
          >
            {current.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{current.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-ink-soft">
              {language === "zh" ? current.roleLabel : current.roleLabelEn}
            </div>
          </div>
        </div>

        <section aria-labelledby={`language-title-${surface}`}>
          <div id={`language-title-${surface}`} className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
            <Languages aria-hidden="true" size={15} className="text-accent" />
            {copy.language}
          </div>
          <div
            data-testid="account-language-options"
            role="radiogroup"
            aria-label={copy.language}
            className="flex gap-1 rounded-xl bg-layer-2 p-1"
          >
            {(["zh", "en"] as UiLanguage[]).map((option) => (
              <PreferenceOption key={option} checked={language === option} onClick={() => void selectLanguage(option)}>
                {option === "zh" ? "中文" : "English"}
              </PreferenceOption>
            ))}
          </div>
          {languageSaveError ? <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{languageSaveError}</p> : null}
        </section>

        <section aria-labelledby={`appearance-title-${surface}`}>
          <div id={`appearance-title-${surface}`} className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
            <Sun aria-hidden="true" size={15} className="text-accent" />
            {copy.appearance}
          </div>
          <div
            data-testid="account-theme-options"
            role="radiogroup"
            aria-label={copy.appearance}
            className="flex gap-1 rounded-xl bg-layer-2 p-1"
          >
            {themeOptions.map(({ mode: optionMode, Icon }) => (
              <PreferenceOption key={optionMode} checked={mode === optionMode} onClick={() => setMode(optionMode)}>
                <Icon aria-hidden="true" size={14} />
                {labelsByTheme[optionMode]}
              </PreferenceOption>
            ))}
          </div>
        </section>

        {!formalAuthEnabled && identities.length > 1 ? (
          <section aria-labelledby={`preview-title-${surface}`}>
            <div id={`preview-title-${surface}`} className="mb-2 text-xs font-semibold text-ink">{copy.preview}</div>
            <div className="overflow-hidden rounded-xl border border-line">
              {identities.map((identity) => (
                <button
                  key={identity.id}
                  type="button"
                  onClick={() => onSwitchIdentity?.(identity.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2 border-b border-line px-3 text-left text-xs last:border-b-0 hover:bg-layer-2",
                    identity.id === current.id && "bg-[var(--wh-background-selected)]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{identity.name}</span>
                  <span className="truncate text-ink-soft">{language === "zh" ? identity.roleLabel : identity.roleLabelEn}</span>
                  {identity.id === current.id ? <Check aria-hidden="true" size={14} className="text-accent" /> : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {formalAuthEnabled ? (
        <div className="border-t border-line p-3">
          <form action="/api/formal/auth/logout" method="post">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 text-xs font-semibold text-rose-600 hover:bg-rose-500/15 dark:text-rose-300"
            >
              <LogOut aria-hidden="true" size={15} />
              {copy.signOut}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        aria-label={copy.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `account-settings-panel-${surface}` : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex min-h-11 w-full items-center rounded-xl text-left transition-colors hover:bg-layer-2",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2 py-1.5",
          open && "bg-layer-2",
        )}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: current.avatarColor }}
        >
          {current.initials}
        </div>
        {!collapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium leading-tight text-ink">{current.name}</div>
              <div className="truncate text-[10px] leading-tight text-ink-soft">
                {language === "zh" ? current.roleLabel : current.roleLabelEn}
              </div>
            </div>
            <ChevronUp aria-hidden="true" size={15} className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
          </>
        ) : null}
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
