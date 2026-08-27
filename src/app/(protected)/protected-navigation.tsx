"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  CarFront,
  ChartNoAxesCombined,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavigationItem } from "@/modules/permissions/role-navigation";

type NavLinkDefinition = NavigationItem & { icon: LucideIcon };
type NavGroupDefinition = {
  label: string;
  icon: LucideIcon;
  children: NavLinkDefinition[];
};

const iconsByHref: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/business-orders": FileText,
  "/inspection-reports": ClipboardCheck,
  "/performance": ChartNoAxesCombined,
  "/customers": ContactRound,
  "/companies": Building2,
  "/vehicles": CarFront,
  "/master-data": BookOpen,
  "/employees": UserCog,
  "/settings/accounts": Users,
  "/settings/audit": ShieldCheck,
};

function activePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname }: { item: NavLinkDefinition; pathname: string }) {
  const Icon = item.icon;
  const active = activePath(pathname, item.href);
  return (
    <Link aria-current={active ? "page" : undefined} className={active ? "active" : undefined} href={item.href}>
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroup({ group, pathname }: { group: NavGroupDefinition; pathname: string }) {
  const Icon = group.icon;
  const active = group.children.some((item) => activePath(pathname, item.href));
  return (
    <section className={active ? "protected-nav-group active" : "protected-nav-group"}>
      <div className="protected-nav-parent">
        <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>{group.label}</span>
        <ChevronRight aria-hidden="true" className="protected-nav-chevron" size={14} />
      </div>
      <div className="protected-nav-children">
        {group.children.map((item) => <NavLink item={item} key={item.href} pathname={pathname} />)}
      </div>
    </section>
  );
}

export function ProtectedNavigation({ items }: { items: NavigationItem[] }) {
  const pathname = usePathname() ?? "";
  const byHref = new Map(items.map((item) => [item.href, { ...item, icon: iconsByHref[item.href] ?? ClipboardList }]));
  const standalone = ["/dashboard", "/master-data", "/employees", "/performance"]
    .map((href) => byHref.get(href))
    .filter((item): item is NavLinkDefinition => Boolean(item));
  const groups: NavGroupDefinition[] = [
    {
      label: "工单管理",
      icon: ClipboardList,
      children: ["/business-orders", "/inspection-reports"]
        .map((href) => byHref.get(href))
        .filter((item): item is NavLinkDefinition => Boolean(item)),
    },
    {
      label: "客户与车辆管理",
      icon: Users,
      children: ["/customers", "/companies", "/vehicles"]
        .map((href) => byHref.get(href))
        .filter((item): item is NavLinkDefinition => Boolean(item)),
    },
    {
      label: "系统设置",
      icon: Settings,
      children: ["/settings/accounts", "/settings/audit"]
        .map((href) => byHref.get(href))
        .filter((item): item is NavLinkDefinition => Boolean(item)),
    },
  ].filter((group) => group.children.length > 0);

  return (
    <nav aria-label="主导航" className="protected-navigation">
      {standalone.slice(0, 1).map((item) => <NavLink item={item} key={item.href} pathname={pathname} />)}
      {groups.slice(0, 1).map((group) => <NavGroup group={group} key={group.label} pathname={pathname} />)}
      {standalone.slice(1).map((item) => <NavLink item={item} key={item.href} pathname={pathname} />)}
      {groups.slice(1).map((group) => <NavGroup group={group} key={group.label} pathname={pathname} />)}
    </nav>
  );
}
