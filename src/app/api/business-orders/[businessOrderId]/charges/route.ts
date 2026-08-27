import { NextResponse } from "next/server";
import { apiActionContext, businessApiError, positiveRouteId } from "@/app/api/business-orders/api-helpers";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";
import type { BusinessOrderNoteInput, ChargeItemInput } from "@/modules/business-order/business-order-schemas";

type ChargeSession = { account: { id: number } };
type RouteContext = { params: Promise<{ businessOrderId: string }> };
type ChargeInput = {
  businessOrderId: number;
  expectedBusinessOrderVersion: number;
  reason: string;
  laborDiscount: string;
  partDiscount: string;
  otherDiscount: string;
  wholeOrderDiscount: string;
  items: ChargeItemInput[];
  notes: BusinessOrderNoteInput[];
  context: BusinessOrderActionContext;
};

type ChargeApiDependencies = {
  readSession(): Promise<ChargeSession | null>;
  replaceCharges(input: ChargeInput): Promise<unknown>;
};

export function createBusinessOrderChargesApiHandler(dependencies: ChargeApiDependencies) {
  return async function businessOrderChargesApiHandler(request: Request, context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    try {
      const body = await request.json() as Record<string, unknown>;
      const result = await dependencies.replaceCharges({
        businessOrderId,
        expectedBusinessOrderVersion: Number(body.expectedBusinessOrderVersion),
        reason: typeof body.reason === "string" ? body.reason : "",
        laborDiscount: typeof body.laborDiscount === "string" ? body.laborDiscount : "0",
        partDiscount: typeof body.partDiscount === "string" ? body.partDiscount : "0",
        otherDiscount: typeof body.otherDiscount === "string" ? body.otherDiscount : "0",
        wholeOrderDiscount: typeof body.wholeOrderDiscount === "string" ? body.wholeOrderDiscount : "0",
        items: Array.isArray(body.items) ? body.items as ChargeItemInput[] : [],
        notes: Array.isArray(body.notes) ? body.notes as BusinessOrderNoteInput[] : [],
        context: apiActionContext(request, session.account.id),
      });
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return businessApiError(error, "收费项目保存失败");
    }
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderChargesApiHandler({
      readSession: currentSession,
      replaceCharges: (input) => runtime.service.replaceChargeVersion(input),
    })(request, context);
  } finally {
    await runtime.close();
  }
}
