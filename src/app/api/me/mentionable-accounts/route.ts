import { NextResponse } from "next/server";
import { businessApiError } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const runtime = createBusinessOrderRuntime();
  try { return NextResponse.json(await runtime.collaboration.listMentionableAccounts({ accountId: session.account.id })); }
  catch (error) { return businessApiError(error, "可提及员工读取失败"); }
  finally { await runtime.close(); }
}
