"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  dataTestId?: string;
  closeTestId?: string;
  closeLabel?: string;
  returnFocusElement?: HTMLElement | null;
  className?: string;
  mobileFullscreen?: boolean;
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  dataTestId,
  closeTestId,
  closeLabel,
  returnFocusElement,
  className,
  mobileFullscreen = false,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = returnFocusElement
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const host = document.createElement("div");
    host.dataset.dialogPortal = "true";
    document.body.appendChild(host);
    setPortalHost(host);

    const siblings = Array.from(document.body.children).filter((node) => node !== host);
    const previous = siblings.map((node) => ({
      node: node as HTMLElement,
      inert: (node as HTMLElement).inert,
      ariaHidden: node.getAttribute("aria-hidden"),
    }));
    siblings.forEach((node) => {
      (node as HTMLElement).inert = true;
      node.setAttribute("aria-hidden", "true");
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      previous.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", ariaHidden);
      });
      document.body.style.overflow = previousOverflow;
      host.remove();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const original = returnFocusRef.current;
          if (!original) return;
          const testId = original.dataset.testid;
          const target = original.isConnected
            ? original
            : testId
              ? document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`)
              : null;
          target?.focus();
        });
      });
    };
  }, [open, returnFocusElement]);

  useEffect(() => {
    if (!open || !portalHost) return;
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, portalHost]);

  if (!open || !portalHost) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      data-testid={dataTestId ? `${dataTestId}-backdrop` : undefined}
      className={cn(
        "fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 backdrop-blur-[2px] transition-opacity motion-reduce:transition-none",
        mobileFullscreen ? "p-0 sm:p-4" : "p-4",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={dataTestId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative max-h-[calc(100vh-2rem)] w-[min(920px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/80 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-800",
          mobileFullscreen
            ? "h-[100dvh] max-h-[100dvh] w-screen rounded-none border-0 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:w-[min(920px,calc(100vw-2rem))] sm:rounded-2xl sm:border"
            : null,
          className,
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur-xl dark:bg-slate-800/95 sm:px-5">
          <h2 id={titleId} className="text-base font-bold text-ink dark:text-slate-100 sm:text-lg">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            data-testid={closeTestId}
            onClick={onClose}
            aria-label={closeLabel ?? `关闭${title}`}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-ink-soft transition-colors hover:border-primary-200 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-slate-900 dark:text-slate-300"
          >
            <X size={17} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    portalHost,
  );
}
