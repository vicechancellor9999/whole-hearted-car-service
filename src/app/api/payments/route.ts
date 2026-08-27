import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createPaymentWorkspaceRuntime } from "@formal/modules/payment/payment-workspace-runtime";

type PaymentsApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getWorkspace(input: { viewerAccountId: number }): Promise<unknown>;
};

export function createPaymentsApiHandler(dependencies: PaymentsApiDependencies) {
  return async function paymentsApiHandler(): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      return NextResponse.json(await dependencies.getWorkspace({ viewerAccountId: session.account.id }));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 400;
      return NextResponse.json({
        error: error instanceof Error ? error.message : "收付款台账读取失败",
      }, { status: Number.isInteger(status) ? status : 400 });
    }
  };
}

export async function GET(): Promise<Response> {
  const runtime = createPaymentWorkspaceRuntime();
  try {
    return await createPaymentsApiHandler({
      readSession: currentSession,
      getWorkspace: (input) => runtime.service.getWorkspace(input),
    })();
  } finally {
    await runtime.close();
  }
}
