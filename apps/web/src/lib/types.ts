// ============================================================
// 核心类型定义
// ============================================================

/** 员工身份 */
export interface Identity {
  id: string;
  name: string;
  nameEn: string;
  role: string;
  roleLabel: string;
  roleLabelEn: string;
  scope: "all" | "assigned" | "self";
  avatarColor: string;
  initials: string;
}

/** 当前会话 */
export interface Session {
  identity: Identity;
  token: string;
  expiresAt: string;
  formal?: {
    accountId: number;
    role: "super_admin" | "front_desk" | "owner" | "mechanic";
    delegatedPermissions: "sensitive_operations.execute"[];
  };
}

/** 工单状态枚举 */
export type OrderStatus =
  | "draft"
  | "quoted"
  | "confirmed"
  | "in_progress"
  | "quality_check"
  | "ready_for_delivery"
  | "completed"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "草稿",
  quoted: "已报价",
  confirmed: "已确认",
  in_progress: "维修中",
  quality_check: "质检中",
  ready_for_delivery: "待交付",
  completed: "已完成",
  cancelled: "已取消",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  draft: "#9ca3af",
  quoted: "#6366f1",
  confirmed: "#3b82f6",
  in_progress: "#f59e0b",
  quality_check: "#8b5cf6",
  ready_for_delivery: "#06b6d4",
  completed: "#10b981",
  cancelled: "#ef4444",
};

// ============================================================
// 仪表盘类型
// ============================================================

export interface DashboardHeader {
  breadcrumb: string;
  title: string;
  subtitle: string;
  dateLabel: string;
  dateTime: string;
  targetStatus: "configured" | "not_configured";
  targetCompletionRate: number | null;
  targetCompletedAmount: number;
  targetTotalAmount: number | null;
}

export interface TeamPerformance {
  title: string;
  dateRange: string;
  hint: string;
  actionText: string;
  teams: TeamPerformanceItem[];
}

export interface TeamPerformanceItem {
  id: string;
  name: string;
  targetStatus: "configured" | "not_configured";
  completionRate: number | null;
  currentAmount: number;
  targetAmount: number | null;
  color: string;
}

export interface DashboardMetricCard {
  id: string;
  href: string;
  title: string;
  subtitle?: string;
  value: number;
  valuePrefix?: string;
  valueSuffix?: string;
  unit?: string;
  progress?: number;
  progressColor?: string;
  breakdownItems?: MetricFooterItem[];
  footerItems?: MetricFooterItem[];
  trend?: MetricTrend;
  comparison?: {
    label: string;
    value: string;
  };
  clickable?: boolean;
  size: "large" | "medium" | "small";
  tone?: "neutral" | "blue" | "green" | "amber" | "rose" | "purple";
  icon?: string;
  iconColor?: string;
  iconBg?: string;
}

export type DashboardPeriodRange = "day" | "week" | "month";

export interface DashboardPeriodSummary {
  range: DashboardPeriodRange;
  label: string;
  grossPaidJmd: number;
  cashRefundedJmd: number;
  netPaidJmd: number;
  businessOrderCount: number;
  submittedOrderCount: number;
}

export interface MetricFooterItem {
  label: string;
  value: string;
  highlight?: boolean;
}

export interface MetricTrend {
  direction: "up" | "down" | "flat";
  label: string;
  percent: number;
}

export interface DashboardSummary {
  header: DashboardHeader;
  teamPerformance: TeamPerformance;
  periods: DashboardPeriodSummary[];
  topCards: DashboardMetricCard[];
  bottomCards: DashboardMetricCard[];
}
