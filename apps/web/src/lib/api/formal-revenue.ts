import type { RevenueDetailResponse, RevenueRange } from "@/lib/revenue/types";

export async function fetchFormalRevenue(range: RevenueRange): Promise<RevenueDetailResponse> {
  const response = await fetch(`/api/formal/revenue?range=${encodeURIComponent(range)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as RevenueDetailResponse & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "经营收款分析读取失败");
  }
  return payload;
}
