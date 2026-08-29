"use client";

import {
  Mail,
  MessageCircle,
  Phone,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  CustomerStatus,
  PreferredChannel,
  ProfileCompleteness,
  RiskLevel,
  VehicleStatus,
} from "@/lib/customers/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/language";

type BadgeTone = "success" | "neutral" | "warning" | "danger" | "info" | "purple";

const toneClasses: Record<BadgeTone, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  purple: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

function LocalBadge({
  children,
  tone,
  dot = false,
  dataTestId,
  className,
}: {
  children: ReactNode;
  tone: BadgeTone;
  dot?: boolean;
  dataTestId?: string;
  className?: string;
}) {
  return (
    <span
      data-testid={dataTestId}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

const channelMeta: Record<PreferredChannel, { label: string; icon: LucideIcon; tone: BadgeTone }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, tone: "success" },
  sms: { label: "SMS", icon: Smartphone, tone: "info" },
  phone: { label: "电话", icon: Phone, tone: "warning" },
  email: { label: "邮件", icon: Mail, tone: "purple" },
};

export function ChannelBadge({ channel, dataTestId }: { channel: PreferredChannel; dataTestId?: string }) {
  const { language } = useI18n();
  const meta = channelMeta[channel];
  const Icon = meta.icon;
  return (
    <LocalBadge tone={meta.tone} dataTestId={dataTestId} className="gap-1">
      <Icon size={11} aria-hidden />
      {language === "en" ? ({ phone: "Phone", email: "Email", whatsapp: "WhatsApp", sms: "SMS" } as const)[channel] : meta.label}
    </LocalBadge>
  );
}

export const channelLabel = (channel: PreferredChannel) => channelMeta[channel].label;

const riskMeta: Record<RiskLevel, { label: string; tone: BadgeTone }> = {
  normal: { label: "正常", tone: "success" },
  attention: { label: "关注", tone: "warning" },
  high: { label: "高风险", tone: "danger" },
};

export function RiskBadge({ level, dataTestId }: { level: RiskLevel; dataTestId?: string }) {
  const { language } = useI18n();
  const meta = riskMeta[level];
  return <LocalBadge tone={meta.tone} dot dataTestId={dataTestId}>{language === "en" ? ({ normal: "Normal", attention: "Attention", high: "High risk" } as const)[level] : meta.label}</LocalBadge>;
}

export const riskLabel = (risk: RiskLevel) => riskMeta[risk].label;

const customerStatusMeta: Record<CustomerStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "活跃", tone: "success" },
  inactive: { label: "非活跃", tone: "neutral" },
  blacklisted: { label: "黑名单", tone: "danger" },
};

export function CustomerStatusBadge({ status, dataTestId }: { status: CustomerStatus; dataTestId?: string }) {
  const { language } = useI18n();
  const meta = customerStatusMeta[status];
  return <LocalBadge tone={meta.tone} dataTestId={dataTestId}>{language === "en" ? ({ active: "Active", inactive: "Inactive", blacklisted: "Blacklisted" } as const)[status] : meta.label}</LocalBadge>;
}

const vehicleStatusMeta: Record<VehicleStatus, { label: string; tone: BadgeTone }> = {
  on_site: { label: "在场", tone: "success" },
  off_site: { label: "不在场", tone: "neutral" },
};

export function VehicleStatusBadge({ status, dataTestId }: { status: VehicleStatus; dataTestId?: string }) {
  const { language } = useI18n();
  const meta = vehicleStatusMeta[status];
  return <LocalBadge tone={meta.tone} dataTestId={dataTestId}>{language === "en" ? ({ on_site: "On site", off_site: "Off site" } as const)[status] : meta.label}</LocalBadge>;
}

export function ProfileBadge({ completeness, dataTestId }: { completeness: ProfileCompleteness; dataTestId?: string }) {
  const { language } = useI18n();
  return (
    <LocalBadge tone={completeness === "complete" ? "success" : "warning"} dataTestId={dataTestId}>
      {language === "en" ? (completeness === "complete" ? "Complete" : "Incomplete") : (completeness === "complete" ? "资料完整" : "待完善")}
    </LocalBadge>
  );
}
