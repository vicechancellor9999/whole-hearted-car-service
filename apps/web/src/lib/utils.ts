import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import dayjs from "dayjs";

/** 合并 Tailwind class */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 格式化货币（JMD） */
export function formatJMD(amount: number): string {
  if (amount >= 1_000_000) {
    return `JMD ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `JMD ${(amount / 1_000).toFixed(1)}K`;
  }
  return `JMD ${amount.toLocaleString()}`;
}

/** 格式化完整货币 */
export function formatJMDFull(amount: number): string {
  return `JMD ${amount.toLocaleString("en-US")}`;
}

export const formatCNYFull = (amount: number, digits = 2) =>
  `¥${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const formatPercentRatio = (ratio: number, digits = 2) => `${(ratio * 100).toFixed(digits)}%`;

export const formatYearMonth = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;

/** 格式化数量 */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** 相对时间 */
export function timeAgo(iso: string): string {
  const now = dayjs();
  const target = dayjs(iso);
  const diffMin = now.diff(target, "minute");
  const diffHour = now.diff(target, "hour");
  const diffDay = now.diff(target, "day");

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 30) return `${diffDay} 天前`;
  return target.format("MM-DD HH:mm");
}

/** 格式化日期 */
export function formatDate(iso: string, fmt = "YYYY-MM-DD"): string {
  return dayjs(iso).format(fmt);
}

/** 格式化日期时间 */
export function formatDateTime(iso: string): string {
  return dayjs(iso).format("MM-DD HH:mm");
}

/** 牙买加时区戳记 */
export function jamaicaStamp(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replaceAll("/", "-");
}
