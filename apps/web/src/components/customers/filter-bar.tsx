"use client";

import { RotateCcw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/language";

interface FilterBarProps {
  mode: "customers" | "vehicles";
  query: string;
  onQueryChange: (value: string) => void;
  filters: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
  onReset: () => void;
  vehicleMakes: string[];
  formal?: boolean;
}

export function FilterBar({
  mode,
  query,
  onQueryChange,
  filters,
  onFilterChange,
  onReset,
  vehicleMakes,
  formal = false,
}: FilterBarProps) {
  const { language } = useI18n();
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  const filterDefs = mode === "customers"
    ? formal ? [
      { key: "type", label: tr("客户类型", "Customer type"), options: [["all", tr("全部类型", "All types")], ["individual", tr("个人", "Individual")], ["organization", tr("机构", "Company")]] },
      { key: "status", label: tr("客户状态", "Customer status"), options: [["all", tr("全部状态", "All statuses")], ["active", tr("活跃", "Active")], ["inactive", tr("非活跃", "Inactive")]] },
    ] : [
      { key: "type", label: "客户类型", options: [["all", "全部类型"], ["individual", "个人"], ["organization", "机构"]] },
      { key: "risk", label: "风险等级", options: [["all", "全部风险"], ["normal", "正常"], ["attention", "关注"], ["high", "高风险"]] },
      { key: "status", label: "客户状态", options: [["all", "全部状态"], ["active", "活跃"], ["inactive", "非活跃"], ["blacklisted", "黑名单"]] },
      { key: "channel", label: "偏好渠道", options: [["all", "全部渠道"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["phone", "电话"], ["email", "邮件"]] },
    ]
    : [
      { key: "make", label: tr("品牌", "Make"), options: [["all", tr("全部品牌", "All makes")], ...vehicleMakes.map((make) => [make, make])] },
      { key: "status", label: tr("车辆状态", "Vehicle status"), options: [["all", tr("全部状态", "All statuses")], ["on_site", tr("在场", "On site")], ["off_site", tr("不在场", "Off site")]] },
    ];

  return (
    <div data-testid={`filter-bar-${mode}`} className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative flex-1 sm:min-w-[240px]">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft dark:text-slate-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={mode === "customers" ? tr("搜索客户、电话、邮箱或关联车牌...", "Search customer, phone, email or linked plate…") : tr("搜索车辆、品牌车型或客户联系方式...", "Search vehicle, make, model or customer contact…")}
          data-testid={`search-input-${mode}`}
          className={cn(
            "h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-xs text-ink outline-none",
            "placeholder:text-ink-soft focus:border-primary focus:ring-2 focus:ring-primary/15",
            "dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400",
          )}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filterDefs.map((filter) => (
          <select
            key={filter.key}
            value={filters[filter.key] ?? "all"}
            onChange={(event) => onFilterChange(filter.key, event.target.value)}
            data-testid={`filter-${filter.key}`}
            aria-label={filter.label}
            className="h-9 rounded-lg border border-line bg-white px-2.5 text-xs text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:bg-slate-900 dark:text-slate-100"
          >
            {filter.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        ))}
        <button
          type="button"
          onClick={onReset}
          data-testid="filter-reset"
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-xs font-medium text-ink-soft transition-colors hover:border-primary-200 hover:text-primary dark:bg-slate-900 dark:text-slate-300"
        >
          <RotateCcw size={13} aria-hidden />{tr("重置", "Reset")}
        </button>
      </div>
    </div>
  );
}
