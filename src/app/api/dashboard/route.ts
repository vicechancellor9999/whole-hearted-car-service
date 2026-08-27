import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createDashboardRuntime } from "@formal/modules/dashboard/dashboard-runtime";
import { DashboardReadDeniedError } from "@formal/modules/dashboard/dashboard-service";

type DashboardApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getSummary(input: { viewerAccountId: number }): Promise<unknown>;
};

export function createDashboardApiHandler(dependencies: DashboardApiDependencies) {
  return async function dashboardApiHandler(): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      return NextResponse.json(await dependencies.getSummary({
        viewerAccountId: session.account.id,
      }));
    } catch (error) {
      if (error instanceof DashboardReadDeniedError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error("dashboard summary read failed", error);
      return NextResponse.json({ error: "经营概览读取失败" }, { status: 500 });
    }
  };
}

export async function GET(): Promise<Response> {
  const runtime = createDashboardRuntime();
  try {
    return await createDashboardApiHandler({
      readSession: currentSession,
      getSummary: (input) => runtime.service.getSummary(input),
    })();
  } finally {
    await runtime.close();
  }
}
