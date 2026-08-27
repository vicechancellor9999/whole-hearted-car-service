import { describe, expect, it, vi } from "vitest";
import { VehiclePresenceService } from "@/modules/vehicle-presence/vehicle-presence-service";

describe("VehiclePresenceService", () => {
  it("does not create a pickup notice while the vehicle has another active Business Order", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from staff_accounts")) return [{ id: 1 }];
      if (text.includes("from formal_handoffs")) return [{ business_order_id: 20, formal_handoff_id: 30 }];
      if (text.includes("from business_orders as active")) return [{ id: 21 }];
      return [];
    });
    const database = { query, transaction: async (callback: (transaction: { query: typeof query }) => unknown) => callback({ query }) } as never;
    const service = new VehiclePresenceService(database);

    await expect(service.createPickupNotice({ vehicleId: 8, context: { actorAccountId: 1, requestId: "test", now: new Date() } }))
      .rejects.toThrow("仍有进行中的 Business Order");
  });

  it("keeps the pre-pause parking amount as a front-desk decision after a new order pauses pickup", async () => {
    const database = { query: vi.fn(), transaction: vi.fn() } as never;
    const service = new VehiclePresenceService(database);

    expect(service.describeNotice({
      noticeId: 1,
      notifiedAt: new Date("2026-08-01T15:00:00Z"),
      pausedAt: new Date("2026-08-05T15:00:00Z"),
      pausedAccruedMinor: 500_000,
      pickedUpAt: null,
    })).toMatchObject({
      status: "parking_paused_needs_front_desk_decision",
      accruedParkingMinor: 500_000,
      frontDeskDecisionRequired: true,
    });
  });
});
