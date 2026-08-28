import type { DashboardMetricCard, TeamPerformanceItem } from "@/lib/types";
import type { UiLanguage } from "./catalog";

const CARD_COPY: Record<string, { title: string; subtitle: string; suffix?: string }> = {
  today_revenue: {
    title: "Today's operating revenue",
    subtitle: "Payments received today − refunds issued today",
    suffix: "",
  },
  accounts_receivable: {
    title: "Accounts receivable",
    subtitle: "Outstanding balance on current formal Business Orders",
    suffix: "",
  },
  vehicles_today: {
    title: "Vehicles received",
    subtitle: "Business Orders created today",
    suffix: " orders",
  },
  vehicles_stuck: {
    title: "Open workshop orders",
    subtitle: "Business Orders not yet formally handed over",
    suffix: " orders",
  },
  completed_labor: {
    title: "Completed labor value and performance",
    subtitle: "Valid formal handoffs this month",
    suffix: " orders",
  },
  prepaid_incomplete: {
    title: "Prepaid orders still in progress",
    subtitle: "Payment received but not formally handed over",
    suffix: " orders",
  },
  internal_tasks: {
    title: "Handoffs awaiting review",
    subtitle: "Repair handoffs awaiting front-desk review",
    suffix: " orders",
  },
  risk_alerts: {
    title: "Operational risk alerts",
    subtitle: "Calculated live from formal business records",
    suffix: " items",
  },
};

const LABEL_COPY: Record<string, string> = {
  "今日收款": "Payments today",
  "今日退款": "Refunds today",
  "收款记录": "Payment records",
  "退款记录": "Refund records",
  "待收 Business Order": "Business Orders with balance due",
  "当前应收": "Current receivable",
  "计算来源": "Calculated from",
  "待审核回单": "Handoffs awaiting review",
  "口径": "Scope",
  "本月班组绩效": "Team performance this month",
  "有效 Business Order": "Valid Business Orders",
  "累计收款": "Total payments",
  "累计退款": "Total refunds",
  "来自": "Source",
  "多收款 Business Order": "Overpaid Business Orders",
};

const VALUE_COPY: Record<string, string> = {
  "正式 Business Order 与逐笔收退款": "Formal Business Orders and individual payment/refund records",
  "不含已正式交单": "Excludes formally handed-over orders",
  "正式维修轮次状态": "Formal repair-round status",
};

function localizeMetricValue(value: string): string {
  return VALUE_COPY[value]
    ?? value.replace(/\s*(单|笔|项)$/u, "")
      .replace(/[\p{Script=Han}]/gu, "");
}

export function localizeDashboardCard(card: DashboardMetricCard, language: UiLanguage): DashboardMetricCard {
  if (language === "zh") return card;
  const copy = CARD_COPY[card.id] ?? {
    title: `Metric ${card.id}`,
    subtitle: "Translation required",
    suffix: "",
  };
  const localizeItems = (items: DashboardMetricCard["footerItems"]) => items?.map((item) => ({
    ...item,
    label: LABEL_COPY[item.label] ?? "Translation required",
    value: localizeMetricValue(item.value),
  }));
  return {
    ...card,
    title: copy.title,
    subtitle: copy.subtitle,
    valueSuffix: copy.suffix ?? card.valueSuffix,
    breakdownItems: localizeItems(card.breakdownItems),
    footerItems: localizeItems(card.footerItems),
    trend: card.trend ? { ...card.trend, label: "Trend" } : undefined,
    comparison: card.comparison ? { ...card.comparison, label: "Comparison" } : undefined,
  };
}

export function localizeDashboardReason(reason: string): string {
  const parameterMatch = reason.match(/缺少\s+(\d{4}-\d{2})\s+绩效参数/u);
  if (parameterMatch) return `Performance parameters are missing for ${parameterMatch[1]}`;
  if (reason.includes("月标准工资")) return "Monthly salary is missing for one or more team members";
  return "Target information is incomplete";
}

export function localizeDashboardTeam(team: TeamPerformanceItem, language: UiLanguage): TeamPerformanceItem {
  if (language === "zh") return team;
  return {
    ...team,
    name: `Team ${team.id} · Translation required`,
    targetMissingReasons: team.targetMissingReasons.map(localizeDashboardReason),
  };
}

export function localizeDashboardMonthLabel(value: string, language: UiLanguage): string {
  if (language === "zh") return value;
  const match = value.match(/(\d{4})年(\d{1,2})月/u);
  if (!match) return value.replace(/[\p{Script=Han}]/gu, "");
  return new Intl.DateTimeFormat("en-JM", { month: "long", year: "numeric", timeZone: "America/Jamaica" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}
