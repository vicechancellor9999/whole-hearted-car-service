import type { DashboardSummary } from "@/lib/types";

export async function fetchFormalDashboard(): Promise<DashboardSummary> {
  const response = await fetch("/api/formal/dashboard", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as DashboardSummary & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "经营概览读取失败");
  }
  return payload;
}
