"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function ActionDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose(): void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/60 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white/95 px-5 py-4 backdrop-blur dark:bg-slate-900/95">
          <div>
            <h2 id={titleId} className="text-base font-bold text-ink dark:text-slate-100">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-xs leading-5 text-ink-soft">{description}</p> : null}
          </div>
          <button ref={closeButtonRef} type="button" aria-label={`关闭${title}`} onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-ink-soft hover:bg-surface hover:text-ink"><X size={17} /></button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
