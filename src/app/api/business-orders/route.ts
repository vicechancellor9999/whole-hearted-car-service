import { NextResponse } from "next/server";
import { apiActionContext, businessApiError } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type BusinessOrderSession = { account: { id: number } };
type BusinessOrderStatus = "waiting_assignment" | "assigned" | "in_repair" | "return_pending_review" | "formally_handed_off";
const BUSINESS_ORDER_STATUSES = new Set<BusinessOrderStatus>(["waiting_assignment", "assigned", "in_repair", "return_pending_review", "formally_handed_off"]);

type BusinessOrdersApiDependencies = {
  readSession(): Promise<BusinessOrderSession | null>;
  listBusinessOrders(input: {
    viewerAccountId: number;
    search?: string;
    status?: BusinessOrderStatus;
    page?: number;
    pageSize?: number;
  }): Promise<unknown>;
  createBusinessOrder(input: {
    vehicleId: number;
    companyContactId?: number | null;
    problemDescriptionZh?: string | null;
    problemDescriptionEn?: string | null;
    context: ReturnType<typeof apiActionContext>;
  }): Promise<unknown>;
};

function positiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createBusinessOrdersApiHandler(dependencies: BusinessOrdersApiDependencies) {
  return async function businessOrdersApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (request.method === "POST") {
      try {
        const body = await request.json() as {
          vehicleId?: unknown;
          companyContactId?: unknown;
          problemDescriptionZh?: unknown;
          problemDescriptionEn?: unknown;
        };
        const vehicleId = Number(body.vehicleId);
        const companyContactId = body.companyContactId == null ? null : Number(body.companyContactId);
        const result = await dependencies.createBusinessOrder({
          vehicleId,
          companyContactId,
          problemDescriptionZh: typeof body.problemDescriptionZh === "string"
            ? body.problemDescriptionZh
            : null,
          problemDescriptionEn: typeof body.problemDescriptionEn === "string"
            ? body.problemDescriptionEn
            : null,
          context: apiActionContext(request, session.account.id),
        });
        return NextResponse.json(result, { status: 201 });
      } catch (error) {
        return businessApiError(error, "Business Order 创建失败");
      }
    }
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.normalize("NFKC").trim() || undefined;
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus && BUSINESS_ORDER_STATUSES.has(rawStatus as BusinessOrderStatus)
      ? rawStatus as BusinessOrderStatus
      : undefined;
    try {
      const result = await dependencies.listBusinessOrders({
        viewerAccountId: session.account.id,
        search,
        status,
        page: positiveInteger(url.searchParams.get("page"), 1),
        pageSize: Math.min(100, positiveInteger(url.searchParams.get("pageSize"), 20)),
      });
      return NextResponse.json(result);
    } catch (error) {
      return businessApiError(error, "Business Order 列表读取失败");
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrdersApiHandler({
      readSession: currentSession,
      listBusinessOrders: (input) => runtime.service.listBusinessOrders(input),
      createBusinessOrder: (input) => runtime.service.createBusinessOrder(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
