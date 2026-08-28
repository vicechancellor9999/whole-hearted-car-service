"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import {
  Banknote,
  CreditCard,
  Car,
  AlertTriangle,
  Wrench,
  Package,
  Users,
  ShieldAlert,
  ArrowRight,
  LucideIcon,
} from "lucide-react";
import { cn, formatCount } from "@/lib/utils";
import type { DashboardMetricCard } from "@/lib/types";
import { useI18n } from "@/lib/i18n/language";
import { localizeDashboardCard } from "@/lib/i18n/dashboard-localization";

interface MetricCardProps {
  card: DashboardMetricCard;
  className?: string;
  compact?: boolean;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Banknote,
  CreditCard,
  Car,
  AlertTriangle,
  Wrench,
  Package,
  Users,
  ShieldAlert,
};

const TONE_STYLES: Record<NonNullable<DashboardMetricCard["tone"]>, string> = {
  neutral:
    "from-white via-white to-slate-50/60 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900",
  blue:
    "from-white via-blue-50/45 to-indigo-50/60 dark:from-slate-800 dark:via-slate-800 dark:to-blue-950/70",
  green:
    "from-white via-emerald-50/45 to-cyan-50/60 dark:from-slate-800 dark:via-slate-800 dark:to-emerald-950/60",
  amber:
    "from-white via-amber-50/45 to-orange-50/60 dark:from-slate-800 dark:via-slate-800 dark:to-amber-950/60",
  rose:
    "from-white via-rose-50/45 to-orange-50/55 dark:from-slate-800 dark:via-slate-800 dark:to-rose-950/60",
  purple:
    "from-white via-violet-50/45 to-indigo-50/60 dark:from-slate-800 dark:via-slate-800 dark:to-violet-950/60",
};

function CardIcon({
  name,
  color,
  bg,
}: {
  name?: string;
  color?: string;
  bg?: string;
}) {
  if (!name || !ICON_MAP[name]) return null;
  const Icon = ICON_MAP[name];
  return (
    <div
      data-testid="metric-card-icon"
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--metric-icon-bg)] dark:bg-slate-700"
      style={
        {
          "--metric-icon-bg": bg || "#f3f4f6",
          color: color || "#6b7280",
        } as CSSProperties
      }
    >
      <Icon size={16} />
    </div>
  );
}

export function MetricCard({ card, className, compact = false }: MetricCardProps) {
  const { language } = useI18n();
  const displayCard = localizeDashboardCard(card, language);
  const displayValue = displayCard.valuePrefix
    ? `${displayCard.valuePrefix}${displayCard.value.toLocaleString("en-US")}`
    : displayCard.valueSuffix
      ? `${formatCount(displayCard.value)}${displayCard.valueSuffix}`
      : formatCount(displayCard.value);

  return (
    <Link
      href={displayCard.href}
      data-testid="metric-card-link"
      data-metric-id={displayCard.id}
      className={cn(
        "group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/80 bg-gradient-to-br text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 dark:border-slate-700",
        TONE_STYLES[displayCard.tone ?? "neutral"],
        compact ? "min-h-0 p-4" : "px-5 py-[15px]",
        className
      )}
    >
      {/* 顶部细线高光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-200/40 to-transparent" />

      {/* 右上角图标 */}
      <div className={cn("absolute right-4 top-4", compact && "right-3.5 top-3.5")}>
        <CardIcon name={displayCard.icon} color={displayCard.iconColor} bg={displayCard.iconBg} />
      </div>

      {/* 标题 */}
      <div className="text-sm font-medium text-ink-soft">{displayCard.title}</div>

      {/* 大数字 */}
      <div
        data-testid="metric-card-value"
        className={cn(
          "mt-2 font-bold tracking-tight text-ink",
          compact
            ? "text-[1.75rem] leading-tight"
            : displayCard.size === "large"
              ? "text-[2.25rem] leading-tight"
              : "text-3xl"
        )}
      >
        {displayValue}
      </div>

      {/* 副标题 */}
      {displayCard.subtitle && (
        <div
          data-testid="metric-card-subtitle"
          className="mt-0.5 text-xs text-ink-faint dark:text-slate-400"
        >
          {displayCard.subtitle}
        </div>
      )}

      {/* 大卡片：金额构成 */}
      {!compact && displayCard.breakdownItems && displayCard.breakdownItems.length > 0 && (
        <div
          data-testid="metric-card-breakdown"
          className="mt-3 flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-1.5 pr-8 text-xs"
        >
          {displayCard.breakdownItems.map((item) => (
            <div
              key={item.label}
              data-testid="metric-card-breakdown-item"
              className="flex items-center gap-1.5"
            >
              <span className="text-ink-faint dark:text-slate-400">{item.label}</span>
              <span
                className={cn("font-semibold text-ink", item.highlight && "text-primary")}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 进度条 */}
      {displayCard.progress !== undefined && displayCard.progress > 0 && (
        <div
          data-testid="metric-card-progress"
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(displayCard.progress, 100)}%`,
              backgroundColor: displayCard.progressColor || "#465fff",
            }}
          />
        </div>
      )}

      {/* 趋势标签 */}
      {displayCard.trend && !displayCard.comparison && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 font-medium",
              displayCard.trend.direction === "up" && "bg-emerald-50 text-success",
              displayCard.trend.direction === "down" && "bg-rose-50 text-danger",
              displayCard.trend.direction === "flat" && "bg-gray-100 text-ink-soft"
            )}
          >
            {displayCard.trend.direction === "up" ? "↑" : displayCard.trend.direction === "down" ? "↓" : "—"}
            {" "}{displayCard.trend.label} {displayCard.trend.percent}%
          </span>
        </div>
      )}

      {displayCard.comparison && (
        <div
          data-testid="metric-card-comparison"
          className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100/70 pt-3 text-xs"
        >
          <span className="text-ink-soft">
            {displayCard.comparison.label} · {displayCard.comparison.value}
          </span>
          {displayCard.trend && (
            <span className="font-semibold text-rose-700 dark:text-rose-300">
              ↓ {displayCard.trend.label} {displayCard.trend.percent}%
            </span>
          )}
        </div>
      )}

      {/* 大卡片：横向 breakdown */}
      {!compact && displayCard.size === "large" && displayCard.footerItems && displayCard.footerItems.length > 0 && (
        <div data-testid="metric-card-footer" className="mt-auto pt-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-gray-50 pt-3 text-xs">
            {displayCard.footerItems.map((item, idx) => (
              <div
                key={idx}
                data-testid="metric-card-footer-item"
                className="flex flex-1 items-center justify-between gap-1.5"
              >
                <span className="text-ink-faint dark:text-slate-400">{item.label}</span>
                <span
                  className={cn(
                    "font-semibold text-ink",
                    item.highlight && "text-rose-700 dark:text-rose-300"
                  )}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 小卡片 footer — 纵向列表，底部对齐 */}
      {!compact && displayCard.size !== "large" && displayCard.footerItems && displayCard.footerItems.length > 0 && (
        <div data-testid="metric-card-footer" className="mt-auto pt-3">
          <div className="space-y-1.5 border-t border-gray-50 pt-3">
            {displayCard.footerItems.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-ink-faint dark:text-slate-400">{item.label}</span>
                {item.value && (
                  <span
                    className={cn(
                      "font-semibold text-ink",
                      item.highlight && "text-rose-700 dark:text-rose-300"
                    )}
                  >
                    {item.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* hover 时右上角箭头 */}
      {displayCard.clickable !== false && (
        <div
          data-testid="metric-card-arrow"
          className="pointer-events-none absolute right-4 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-ink-faint shadow-sm transition-colors duration-200 group-hover:bg-primary-50 group-hover:text-primary dark:bg-slate-700/90 dark:text-slate-300 dark:group-hover:bg-slate-600"
        >
          <ArrowRight size={13} />
        </div>
      )}
    </Link>
  );
}
