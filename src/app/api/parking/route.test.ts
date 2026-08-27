import { describe, expect, it, vi } from "vitest";
import { createParkingApiHandler } from "@formal/app/api/parking/route";

describe("POST /api/parking", () => {
  it("records an explicit formal pickup notice rather than trusting frontend state", async () => {
    const createPickupNotice = vi.fn(async () => ({ noticeId: 4 }));
    const handler = createParkingApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      list: vi.fn(),
      createPickupNotice,
      recordPickup: vi.fn(),
    });
    const response = await handler(new Request("http://localhost/api/parking", {
      method: "POST", body: JSON.stringify({ action: "notify", vehicleId: 12 }),
    }));
    expect(response.status).toBe(201);
    expect(createPickupNotice).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: 12, context: expect.objectContaining({ actorAccountId: 9 }) }));
  });
});
