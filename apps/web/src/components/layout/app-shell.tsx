"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { MobileNavDrawer, MobileTopBar } from "./mobile-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const openButtonRef = useRef<HTMLElement | null>(null);

  const openNav = useCallback(() => {
    openButtonRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNavOpen(true);
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    requestAnimationFrame(() => openButtonRef.current?.focus());
  }, []);

  if (pathname?.startsWith("/login") || pathname?.startsWith("/pc-not-available") || pathname?.startsWith("/mechanic")) return children;

  return (
    <div
      className="flex h-screen overflow-hidden bg-page text-ink"
      data-shell-path={pathname}
      data-testid="app-shell"
    >
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileTopBar onOpenNav={openNav} />
        <main className="flex-1 overflow-y-auto bg-page">{children}</main>
      </div>
      {navOpen ? <MobileNavDrawer onClose={closeNav} /> : null}
    </div>
  );
}
