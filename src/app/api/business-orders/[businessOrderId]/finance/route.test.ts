import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderFinanceApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/finance/route";

describe("GET /api/business-orders/:id/finance", () => {
  it("requires a formal session", async () => {
    const handler = createBusinessOrderFinanceApiHandler({
      readSession: async () => null,
      getLedger: vi.fn(),
    });
    expect((await handler({ params: Promise.resolve({ businessOrderId: "12" }) })).status).toBe(401);
  });

  it("returns the immutable finance ledger for the current account", async () => {
    const getLedger = vi.fn(async () => ({ businessOrderId: 12, totalPaidMinor: 300_000 }));
    const handler = createBusinessOrderFinanceApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getLedger,
    });
    const response = await handler({ params: Promise.resolve({ businessOrderId: "12" }) });
    expect(response.status).toBe(200);
    expect(getLedger).toHaveBeenCalledWith({ businessOrderId: 12, viewerAccountId: 9 });
    expect(await response.json()).toEqual({ ledger: { businessOrderId: 12, totalPaidMinor: 300_000 } });
  });
});
