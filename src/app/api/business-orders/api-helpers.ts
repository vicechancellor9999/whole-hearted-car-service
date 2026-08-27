import { NextResponse } from "next/server";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";

export function positiveRouteId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function apiActionContext(request: Request, actorAccountId: number): BusinessOrderActionContext {
  return {
    actorAccountId,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  };
}

export function businessApiError(error: unknown, fallback: string): Response {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : 400;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400 },
  );
}
