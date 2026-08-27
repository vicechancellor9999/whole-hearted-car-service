import { NextResponse } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import { createPerformanceRuntime } from "@/modules/performance/performance-runtime";

type PerformanceApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getMonthlyPerformance(input: { viewerAccountId: number; month: string }): Promise<unknown>;
};

function isMonth(value: string | null): value is string {
  if (!value) return false;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
}

export function createPerformanceApiHandler(dependencies: PerformanceApiDependencies) {
  return async function performanceApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const month = new URL(request.url).searchParams.get("month");
    if (!isMonth(month)) return NextResponse.json({ error: "月份格式必须为 YYYY-MM" }, { status: 400 });
    try {
      return NextResponse.json(await dependencies.getMonthlyPerformance({
        viewerAccountId: session.account.id,
        month,
      }));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 400;
      return NextResponse.json({
        error: error instanceof Error ? error.message : "绩效统计读取失败",
      }, { status: Number.isInteger(status) ? status : 400 });
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  const runtime = createPerformanceRuntime();
  try {
    return await createPerformanceApiHandler({
      readSession: currentSession,
      getMonthlyPerformance: (input) => runtime.service.getMonthlyPerformance(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
