import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderDetailApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/route";

describe("GET /api/business-orders/:id", () => {
  it("rejects an invalid Business Order id", async () => {
    const handler = createBusinessOrderDetailApiHandler({
      readSession: async () => ({
        account: { id: 9, role: "front_desk", delegatedPermissions: [] },
      }),
      getOrder: vi.fn(),
      getCharges: vi.fn(),
      getLedger: vi.fn(),
      listDocuments: vi.fn(),
      listPaymentMethods: vi.fn(),
      listChargeUnits: vi.fn(),
      getRefund: vi.fn(),
    });
    expect((await handler({ params: Promise.resolve({ businessOrderId: "demo" }) })).status).toBe(400);
  });

  it("returns identity, current charges and immutable finance facts together", async () => {
    const getOrder = vi.fn(async () => ({ id: 12, orderNo: "KGN-WH-2026082400001" }));
    const getCharges = vi.fn(async () => ({ businessOrderId: 12, versionNo: 3 }));
    const getLedger = vi.fn(async () => ({
      businessOrderId: 12,
      transactions: [{ type: "refund", id: 7 }],
    }));
    const getRefund = vi.fn(async () => ({
      id: 7,
      refundNo: "RFD-20260824-0001",
      evidence: [],
    }));
    const listDocuments = vi.fn(async () => ([{
      id: 31,
      documentNo: "OFF-20260824-0001",
      kind: "office_archive",
    }]));
    const listPaymentMethods = vi.fn(async () => ([
      { id: 2, code: "cash", labelZh: "现金", labelEn: "Cash" },
    ]));
    const listChargeUnits = vi.fn(async () => ([
      { id: 4, code: "hour", labelZh: "工时", labelEn: "hour" },
    ]));
    const handler = createBusinessOrderDetailApiHandler({
      readSession: async () => ({
        account: {
          id: 9,
          role: "front_desk",
          delegatedPermissions: ["sensitive_operations.execute"],
        },
      }),
      getOrder,
      getCharges,
      getLedger,
      listDocuments,
      listPaymentMethods,
      listChargeUnits,
      getRefund,
    });
    const response = await handler({ params: Promise.resolve({ businessOrderId: "12" }) });
    expect(response.status).toBe(200);
    const expectedInput = { businessOrderId: 12, viewerAccountId: 9 };
    expect(getOrder).toHaveBeenCalledWith(expectedInput);
    expect(getCharges).toHaveBeenCalledWith(expectedInput);
    expect(getLedger).toHaveBeenCalledWith(expectedInput);
    expect(listDocuments).toHaveBeenCalledWith(expectedInput);
    expect(getRefund).toHaveBeenCalledWith({ refundId: 7, viewerAccountId: 9 });
    expect(await response.json()).toEqual({
      order: { id: 12, orderNo: "KGN-WH-2026082400001" },
      charges: { businessOrderId: 12, versionNo: 3 },
      ledger: { businessOrderId: 12, transactions: [{ type: "refund", id: 7 }] },
      refunds: [{ id: 7, refundNo: "RFD-20260824-0001", evidence: [] }],
      documents: [{
        id: 31,
        documentNo: "OFF-20260824-0001",
        kind: "office_archive",
      }],
      paymentMethods: [{ id: 2, code: "cash", labelZh: "现金", labelEn: "Cash" }],
      chargeUnits: [{ id: 4, code: "hour", labelZh: "工时", labelEn: "hour" }],
      capabilities: {
        canWrite: true,
        canRecordPayment: true,
        canRefund: true,
      },
    });
  });
});
