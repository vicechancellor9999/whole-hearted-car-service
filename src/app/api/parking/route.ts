import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createVehiclePresenceRuntime } from "@formal/modules/vehicle-presence/vehicle-presence-runtime";

type Dependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  list(input: { viewerAccountId: number }): Promise<unknown>;
  createPickupNotice(input: { vehicleId: number; context: { actorAccountId: number; requestId: string; ipAddress: string | null; userAgent: string | null } }): Promise<unknown>;
  recordPickup(input: { noticeId: number; context: { actorAccountId: number; requestId: string; ipAddress: string | null; userAgent: string | null } }): Promise<unknown>;
};
export function createParkingApiHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      if (request.method === "GET") return NextResponse.json(await dependencies.list({ viewerAccountId: session.account.id }));
      const body = await request.json().catch(() => null) as { action?: unknown; vehicleId?: unknown; noticeId?: unknown } | null;
      const context = { actorAccountId: session.account.id, requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(), ipAddress: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent") };
      if (body?.action === "notify" && Number.isSafeInteger(body.vehicleId)) return NextResponse.json(await dependencies.createPickupNotice({ vehicleId: body.vehicleId as number, context }), { status: 201 });
      if (body?.action === "pickup" && Number.isSafeInteger(body.noticeId)) return NextResponse.json(await dependencies.recordPickup({ noticeId: body.noticeId as number, context }));
      return NextResponse.json({ error: "待取车操作无效" }, { status: 400 });
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 400;
      return NextResponse.json({ error: error instanceof Error ? error.message : "待取车操作失败" }, { status: Number.isInteger(status) ? status : 400 });
    }
  };
}
export async function GET(request: Request) { const runtime = createVehiclePresenceRuntime(); try { return await createParkingApiHandler({ readSession: currentSession, list: (input) => runtime.service.list(input), createPickupNotice: (input) => runtime.service.createPickupNotice(input), recordPickup: (input) => runtime.service.recordPickup(input) })(request); } finally { await runtime.close(); } }
export async function POST(request: Request) { const runtime = createVehiclePresenceRuntime(); try { return await createParkingApiHandler({ readSession: currentSession, list: (input) => runtime.service.list(input), createPickupNotice: (input) => runtime.service.createPickupNotice(input), recordPickup: (input) => runtime.service.recordPickup(input) })(request); } finally { await runtime.close(); } }
