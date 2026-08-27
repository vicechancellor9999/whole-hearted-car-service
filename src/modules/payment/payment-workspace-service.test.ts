import { describe, expect, it } from "vitest";
import { projectPaymentWorkspace } from "@/modules/payment/payment-workspace-service";

describe("projectPaymentWorkspace", () => {
  it("keeps formal payment, refund, Receipt and balance facts bound to their Business Order", () => {
    const workspace = projectPaymentWorkspace({
      orders: [{
        id: 12,
        orderNo: "BO-00012",
        payerKey: "person:7",
        payerDisplayName: "Alicia Brown",
        payerPhone: "876-555-0100",
        vehiclePlate: "7012 AB",
        vehicleDescription: "Toyota Axio",
        status: "formally_handed_off",
        createdAt: new Date("2026-08-26T13:00:00.000Z"),
        currentDueMinor: 12_000,
        totalPaidMinor: 10_000,
        totalRefundedMinor: 2_000,
      }],
      transactions: [
        {
          type: "payment",
          id: 20,
          businessOrderId: 12,
          businessOrderNo: "BO-00012",
          vehiclePlate: "7012 AB",
          referenceNo: "PAY-00020",
          amountMinor: 10_000,
          methodLabelZh: "现金",
          occurredAt: new Date("2026-08-26T14:00:00.000Z"),
          note: "首付款",
          receiptId: 30,
        },
        {
          type: "refund",
          id: 21,
          businessOrderId: 12,
          businessOrderNo: "BO-00012",
          vehiclePlate: "7012 AB",
          referenceNo: "RFD-00021",
          amountMinor: 2_000,
          methodLabelZh: "现金",
          occurredAt: new Date("2026-08-26T15:00:00.000Z"),
          note: "重复收费退款",
          receiptId: null,
        },
      ],
    });

    expect(workspace.items).toEqual([{
      order: expect.objectContaining({ id: 12, orderNo: "BO-00012", status: "formally_handed_off" }),
      ledger: expect.objectContaining({ currentDueMinor: 12_000, totalPaidMinor: 10_000, totalRefundedMinor: 2_000, balanceMinor: 4_000 }),
    }]);
    expect(workspace.transactions).toEqual([
      expect.objectContaining({ type: "refund", id: 21, businessOrderId: 12, amountMinor: 2_000 }),
      expect.objectContaining({ type: "payment", id: 20, receiptId: 30 }),
    ]);
  });
});
