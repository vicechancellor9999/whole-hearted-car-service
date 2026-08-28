import { NextResponse } from "next/server";
import { businessApiError } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const runtime = createBusinessOrderRuntime();
  try {
    const [page, unreadCount] = await Promise.all([
      runtime.collaboration.listMyMentions({ accountId: session.account.id }),
      runtime.collaboration.countUnreadMentions({ accountId: session.account.id }),
    ]);
    return NextResponse.json({ ...page, unreadCount });
  } catch (error) { return businessApiError(error, "提及列表读取失败"); }
  finally { await runtime.close(); }
}
