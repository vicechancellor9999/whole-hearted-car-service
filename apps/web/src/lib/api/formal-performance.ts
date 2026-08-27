export type FormalPerformanceHandoff = {
  id: number;
  businessOrderId: number;
  orderNo: string;
  repairRoundNo: number;
  teamId: number;
  teamName: string;
  performanceMinor: number;
  handedOffAt: string;
  plateDisplay: string;
};

export type FormalMonthlyPerformance = {
  month: string;
  totalPerformanceMinor: number;
  cancelledHandoffCount: number;
  targetStatus: "configured" | "not_configured";
  targetPerformanceMinor: number | null;
  completionRate: number | null;
  targetMissingReasons: string[];
  teams: Array<{
    teamId: number;
    teamName: string;
    handoffCount: number;
    cancelledHandoffCount: number;
    performanceMinor: number;
    targetStatus: "configured" | "not_configured";
    targetPerformanceMinor: number | null;
    completionRate: number | null;
    targetMissingReasons: string[];
  }>;
  handoffs: FormalPerformanceHandoff[];
};

export async function fetchFormalPerformance(month: string): Promise<FormalMonthlyPerformance> {
  const response = await fetch(`/api/formal/performance?month=${encodeURIComponent(month)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as FormalMonthlyPerformance & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "绩效统计读取失败");
  }
  return payload;
}
