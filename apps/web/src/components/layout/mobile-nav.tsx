"use client";

import { useCallback, useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./sidebar";
import { useI18n } from "@/lib/i18n/language";

/** 窄屏顶栏：汉堡按钮唤出导航抽屉（桌面端不渲染）。品牌文字不复用 Logo，避免与侧边栏 testid 重复。 */
export function MobileTopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="mobile-topbar"
      className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-shell px-3 lg:hidden"
    >
      <button
        type="button"
        data-testid="mobile-nav-open"
        onClick={onOpenNav}
        aria-label={t("nav.openMenu")}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink hover:bg-layer-2"
      >
        <Menu size={18} />
      </button>
      <span className="text-xs font-bold tracking-tight text-ink">Whole Hearted {t("brand.systemName")}</span>
    </div>
  );
}

/** 窄屏导航抽屉：遮罩点击 / Escape 关闭，点链接导航后自动关闭，焦点归还触发按钮。 */
export function MobileNavDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled])",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    const firstLink = panelRef.current?.querySelector<HTMLElement>("a[href], button");
    firstLink?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
      <div
        data-testid="mobile-nav-backdrop"
        className="absolute inset-0 bg-[var(--wh-overlay)]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.menu")}
        data-testid="mobile-nav-drawer"
        className="absolute inset-y-0 left-0 w-[260px] overflow-hidden bg-shell shadow-xl"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("a[href]")) onClose();
        }}
      >
        <button
          type="button"
          data-testid="mobile-nav-close"
          onClick={onClose}
          aria-label={t("nav.closeMenu")}
          className="absolute right-2 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-layer-2"
        >
          <X size={16} />
        </button>
        <Sidebar variant="drawer" />
      </div>
    </div>
  );
}
