import { NextResponse } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import { createRevenueRuntime } from "@/modules/revenue/revenue-runtime";
import {
  RevenueReadDeniedError,
  type RevenueRange,
} from "@/modules/revenue/revenue-service";

const RANGES = new Set<RevenueRange>(["day", "week", "month", "year", "all"]);

type RevenueApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getDetail(input: { viewerAccountId: number; range: RevenueRange }): Promise<unknown>;
};

export function createRevenueApiHandler(dependencies: RevenueApiDependencies) {
  return async function revenueApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const range = new URL(request.url).searchParams.get("range") ?? "week";
    if (!RANGES.has(range as RevenueRange)) {
      return NextResponse.json({ error: "收入统计范围无效" }, { status: 400 });
    }
    try {
      return NextResponse.json(await dependencies.getDetail({
        viewerAccountId: session.account.id,
        range: range as RevenueRange,
      }));
    } catch (error) {
      if (error instanceof RevenueReadDeniedError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error("revenue detail read failed", error);
      return NextResponse.json({ error: "经营收款分析读取失败" }, { status: 500 });
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  const runtime = createRevenueRuntime();
  try {
    return await createRevenueApiHandler({
      readSession: currentSession,
      getDetail: (input) => runtime.service.getDetail(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
