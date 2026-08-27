import { NextResponse } from "next/server";
import { apiActionContext, businessApiError } from "@/app/api/business-orders/api-helpers";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";

type BusinessOrderSession = { account: { id: number } };

type BusinessOrdersApiDependencies = {
  readSession(): Promise<BusinessOrderSession | null>;
  listBusinessOrders(input: {
    viewerAccountId: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<unknown>;
  createBusinessOrder(input: {
    vehicleId: number;
    companyContactId?: number | null;
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
        const body = await request.json() as { vehicleId?: unknown; companyContactId?: unknown };
        const vehicleId = Number(body.vehicleId);
        const companyContactId = body.companyContactId == null ? null : Number(body.companyContactId);
        const result = await dependencies.createBusinessOrder({
          vehicleId,
          companyContactId,
          context: apiActionContext(request, session.account.id),
        });
        return NextResponse.json(result, { status: 201 });
      } catch (error) {
        return businessApiError(error, "Business Order 创建失败");
      }
    }
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.normalize("NFKC").trim() || undefined;
    try {
      const result = await dependencies.listBusinessOrders({
        viewerAccountId: session.account.id,
        search,
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
