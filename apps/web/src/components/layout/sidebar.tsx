"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Briefcase,
  Users,
  UserCog,
  ParkingCircle,
  CreditCard,
  Settings,
  ChartNoAxesCombined,
  ChevronRight,
  FileText,
  ClipboardCheck,
  ContactRound,
  CarFront,
  BookOpen,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { IdentitySwitcher } from "./identity-switcher";
import { useI18n } from "@/lib/i18n/language";
import type { MessageKey } from "@/lib/i18n/catalog";
import {
  getVisibleNavigationKeys,
  type FormalNavigationKey,
  type FormalRole,
} from "@/lib/auth/formal-pc-access";
import type { Session } from "@/lib/types";
import { fetchFormalMentions } from "@/lib/api/formal-business-order-collaboration";
import { FORMAL_DATA_CHANGED_EVENT } from "@/lib/formal-data-changes";

interface NavNode {
  key: FormalNavigationKey;
  labelKey: MessageKey;
  href?: string;
  icon: LucideIcon;
  children?: NavNode[];
  badge?: number;
}

/** 导航树：父级可继续展开子菜单（递归渲染，支持任意层级）。 */
const NAV_TREE: NavNode[] = [
  { key: "dashboard", labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { key: "workbench", labelKey: "nav.workbench", href: "/workbench", icon: Briefcase },
  { key: "business_orders", labelKey: "nav.orders", icon: ClipboardList, children: [
    { key: "business_orders", labelKey: "nav.businessOrders", href: "/orders/business", icon: FileText },
    { key: "inspection_reports", labelKey: "nav.inspections", href: "/orders/inspections", icon: ClipboardCheck },
    { key: "business_orders", labelKey: "nav.mentions", href: "/mentions", icon: MessageSquareText },
  ] },
  { key: "master_data", labelKey: "nav.masterData", href: "/dictionaries", icon: BookOpen },
  { key: "employees", labelKey: "nav.employees", href: "/employees", icon: UserCog },
  { key: "performance", labelKey: "nav.performance", href: "/performance", icon: ChartNoAxesCombined },
  { key: "payments", labelKey: "nav.payments", href: "/payments", icon: CreditCard },
  { key: "parking", labelKey: "nav.parking", href: "/parking", icon: ParkingCircle },
  { key: "customers", labelKey: "nav.customersVehicles", icon: Users, children: [
    { key: "customers", labelKey: "nav.customers", href: "/customers", icon: ContactRound },
    { key: "vehicles", labelKey: "nav.vehicles", href: "/vehicles", icon: CarFront },
  ] },
  { key: "settings", labelKey: "nav.settings", href: "/settings", icon: Settings },
];

const STORAGE_KEY = "wh_sidebar_collapsed_v1";

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/revenue";
  return pathname === href || pathname.startsWith(href);
}

function hasActiveChild(node: NavNode, pathname: string): boolean {
  if (node.href && isActive(node.href, pathname)) return true;
  return node.children?.some((child) => hasActiveChild(child, pathname)) ?? false;
}

/** 递归节点：叶子=链接；父级=可展开子菜单。 */
function TreeNode({ node, pathname, depth, collapsed, onNavigate, onExpand }: {
  node: NavNode;
  pathname: string;
  depth: number;
  collapsed: boolean;
  onNavigate?: () => void;
  onExpand?: () => void;
}) {
  const { t } = useI18n();
  const label = t(node.labelKey);
  const Icon = node.icon;
  const [open, setOpen] = useState(hasActiveChild(node, pathname));

  useEffect(() => {
    if (hasActiveChild(node, pathname)) setOpen(true);
  }, [node, pathname]);

  if (node.children && node.children.length > 0) {
    if (collapsed) {
      return (
        <button type="button" title={label} aria-label={label} aria-expanded={false} onClick={() => { setOpen(true); onExpand?.(); }}
          className={cn("flex w-10 items-center justify-center rounded-xl py-2.5 text-ink-soft hover:bg-layer-2 hover:text-ink",
            hasActiveChild(node, pathname) && "bg-[var(--wh-background-selected)] text-accent")}>
          <Icon size={18} />
        </button>
      );
    }
    return (
      <div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
            hasActiveChild(node, pathname)
              ? "bg-[var(--wh-background-selected)] font-medium text-accent"
              : "text-ink-soft hover:bg-layer-2 hover:text-ink")}>
          <Icon size={18} className="shrink-0" />
          <span className="flex-1 truncate text-left">{label}</span>
          <ChevronRight size={14} className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
        </button>
        {open ? (
          <div className={cn("mt-0.5 space-y-0.5", depth === 0 && "ml-3 border-l border-line pl-2")}>
            {node.children.map((child) => (
              <TreeNode key={child.labelKey + (child.href ?? "")} node={child} pathname={pathname} depth={depth + 1} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!node.href) return null;
  if (collapsed) {
    return (
      <Link href={node.href} title={label} aria-label={label} onClick={onNavigate}
        className={cn("flex w-10 items-center justify-center rounded-xl py-2.5 text-ink-soft hover:bg-layer-2 hover:text-ink",
          isActive(node.href, pathname) && "bg-[var(--wh-background-selected)] text-accent")}>
        <Icon size={18} />
      </Link>
    );
  }
  return (
    <Link href={node.href} aria-current={isActive(node.href, pathname) ? "page" : undefined} onClick={onNavigate}
      className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
        isActive(node.href, pathname)
          ? "bg-[var(--wh-background-selected)] font-medium text-accent"
          : "text-ink-soft hover:bg-layer-2 hover:text-ink")}>
      <Icon size={18} className="shrink-0" />
      <span className="truncate">{label}</span>
      {node.badge && node.badge > 0 ? <span aria-label={t("nav.unreadMentions", { count: node.badge })} className="ml-auto rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">{node.badge > 99 ? "99+" : node.badge}</span> : null}
    </Link>
  );
}

/**
 * 悬浮岛式侧边栏（8/18 老板）：不贴边，毛玻璃圆角卡；多级子菜单；可折叠（收起只留图标）。
 */
export function Sidebar({ variant = "desktop" }: { variant?: "desktop" | "drawer" }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [formalRole, setFormalRole] = useState<FormalRole | null>(null);
  const [mentionUnreadCount, setMentionUnreadCount] = useState(0);

  useEffect(() => {
    if (variant === "desktop") {
      try {
        setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
      } catch { /* ignore */ }
    }
  }, [variant]);

  useEffect(() => {
    const readRole = () => {
      try {
        const raw = window.localStorage.getItem("wh_session");
        const stored = raw ? JSON.parse(raw) as Session : null;
        setFormalRole(stored?.formal?.role ?? null);
      } catch {
        setFormalRole(null);
      }
    };
    readRole();
    window.addEventListener("wh:formal-session-changed", readRole);
    return () => window.removeEventListener("wh:formal-session-changed", readRole);
  }, []);

  useEffect(() => {
    if (!formalRole) return;
    let active = true;
    const load = () => { void fetchFormalMentions().then((result) => { if (active) setMentionUnreadCount(result.unreadCount); }).catch(() => undefined); };
    load();
    window.addEventListener(FORMAL_DATA_CHANGED_EVENT, load);
    return () => { active = false; window.removeEventListener(FORMAL_DATA_CHANGED_EVENT, load); };
  }, [formalRole]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const isDrawer = variant === "drawer";
  const effectiveCollapsed = isDrawer ? false : collapsed;
  const allowedKeys = new Set(formalRole ? getVisibleNavigationKeys(formalRole) : []);
  const visibleNavigation = NAV_TREE.flatMap((node) => {
    if (node.children) {
      const children = node.children.filter((child) => allowedKeys.has(child.key)).map((child) => child.href === "/mentions" ? { ...child, badge: mentionUnreadCount } : child);
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    return allowedKeys.has(node.key) ? [node] : [];
  });

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        isDrawer
          ? "flex h-full w-[260px] flex-col overflow-x-hidden bg-shell"
          : "hidden lg:flex",
        "flex-col overflow-hidden rounded-3xl border border-line bg-shell shadow-card-hover",
        !isDrawer && "my-3 ml-3 h-[calc(100vh-24px)] transition-all duration-200",
        !isDrawer && (effectiveCollapsed ? "w-[64px]" : "w-[220px]"),
      )}
    >
      <div className={cn("flex items-center px-3 py-3", effectiveCollapsed ? "flex-col gap-1 px-0" : "gap-2")}>
        {effectiveCollapsed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src="/logo-icon.png" alt="Whole Hearted" className="h-9 w-9 rounded-xl object-cover" />
        ) : (
          <Logo className="min-w-0 flex-1" />
        )}
        {!isDrawer && !effectiveCollapsed && (
          <button type="button" data-testid="sidebar-collapse" onClick={toggleCollapsed} aria-label={t("nav.collapse")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-layer-2 hover:text-ink">
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      <nav className={cn("flex-1 overflow-y-auto px-3 py-2", effectiveCollapsed && "flex flex-col items-center gap-0.5 px-0")}>
        {visibleNavigation.map((node) => (
          <TreeNode key={node.labelKey + (node.href ?? "")} node={node} pathname={pathname} depth={0} collapsed={effectiveCollapsed} onExpand={toggleCollapsed} />
        ))}
      </nav>

      <div data-testid="identity-footer" className="border-t border-line p-3">
        {!isDrawer && effectiveCollapsed && (
          <button type="button" data-testid="sidebar-collapse" onClick={toggleCollapsed} aria-label={t("nav.expand")}
            className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-layer-2 hover:text-ink">
            <PanelLeftOpen size={16} />
          </button>
        )}
        <div className={cn(effectiveCollapsed && "flex justify-center")}>
          <IdentitySwitcher
            variant="compact"
            surface={isDrawer ? "drawer" : "desktop"}
            collapsed={effectiveCollapsed}
          />
        </div>
        {!effectiveCollapsed && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="text-[10px] text-ink-faint">{t("nav.formalConnected")}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
