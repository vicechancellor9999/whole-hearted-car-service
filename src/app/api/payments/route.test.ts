import { describe, expect, it, vi } from "vitest";
import { createPaymentsApiHandler } from "@/app/api/payments/route";

describe("GET /api/payments", () => {
  it("requires a formal session", async () => {
    const handler = createPaymentsApiHandler({
      readSession: async () => null,
      getWorkspace: vi.fn(),
    });

    expect((await handler()).status).toBe(401);
  });

  it("returns one formal Business Order finance workspace for the current account", async () => {
    const workspace = {
      items: [{
        order: { id: 12, orderNo: "BO-00012", payer: { displayName: "Alicia" } },
        ledger: { businessOrderId: 12, currentDueMinor: 10_000, totalPaidMinor: 3_000, totalRefundedMinor: 0, balanceMinor: 7_000, transactions: [] },
      }],
    };
    const getWorkspace = vi.fn(async () => workspace);
    const handler = createPaymentsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getWorkspace,
    });

    const response = await handler();

    expect(response.status).toBe(200);
    expect(getWorkspace).toHaveBeenCalledWith({ viewerAccountId: 9 });
    expect(await response.json()).toEqual(workspace);
  });
});
