"use client";

import { Car, Link2, UserCheck, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomerVehicleSummary } from "@/lib/customers/types";

const cards: Array<{
  key: keyof CustomerVehicleSummary;
  testId: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  subtext: string;
}> = [
  { key: "totalCustomers", testId: "summary-total-customers", label: "客户总数", icon: Users, accent: "#465fff", subtext: "个人 + 机构" },
  { key: "totalVehicles", testId: "summary-total-vehicles", label: "车辆总数", icon: Car, accent: "#7a5af8", subtext: "完整车辆档案" },
  { key: "activeCustomers", testId: "summary-active-customers", label: "活跃客户", icon: UserCheck, accent: "#10b981", subtext: "当前启用档案" },
  { key: "activeRelationships", testId: "summary-active-relationships", label: "活动关系", icon: Link2, accent: "#f59e0b", subtext: "一车一位当前客户" },
];

export function SummaryCards({ summary }: { summary: CustomerVehicleSummary }) {
  return (
    <div data-testid="customer-summary-cards" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {cards.map(({ key, testId, label, icon: Icon, accent, subtext }) => (
        <div
          key={key}
          data-testid={testId}
          className={cn("min-h-[96px] rounded-xl border border-line border-l-[3px] bg-white p-3.5 shadow-card dark:bg-slate-800")}
          style={{ borderLeftColor: accent }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-ink-soft dark:text-slate-400">{label}</span>
            <Icon size={16} style={{ color: accent }} aria-hidden />
          </div>
          <div className="mt-2 text-[22px] font-bold tabular-nums text-ink dark:text-slate-100">
            {summary[key].toLocaleString("en-US")}
          </div>
          <div data-testid="summary-card-subtext" className="mt-1.5 text-[10px] text-ink-soft dark:text-slate-400">
            {subtext}
          </div>
        </div>
      ))}
    </div>
  );
}
