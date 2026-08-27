export type FormalPaymentStatus = "unpaid" | "partially_paid" | "paid";

export type FormalPaymentWorkspace = {
  items: Array<{
    order: {
      id: number;
      orderNo: string;
      payerKey: string;
      payerDisplayName: string;
      payerPhone: string | null;
      vehiclePlate: string;
      vehicleDescription: string;
      status: string;
      createdAt: string;
    };
    ledger: {
      businessOrderId: number;
      currentDueMinor: number;
      totalPaidMinor: number;
      totalRefundedMinor: number;
      balanceMinor: number;
    };
  }>;
  transactions: Array<{
    type: "payment" | "refund";
    id: number;
    businessOrderId: number;
    businessOrderNo: string;
    vehiclePlate: string;
    referenceNo: string;
    amountMinor: number;
    methodLabelZh: string;
    occurredAt: string;
    note: string | null;
    receiptId: number | null;
  }>;
};

export function formalPaymentStatus(ledger: FormalPaymentWorkspace["items"][number]["ledger"]): FormalPaymentStatus {
  if (ledger.balanceMinor <= 0) return "paid";
  return ledger.totalPaidMinor > 0 ? "partially_paid" : "unpaid";
}

export async function fetchFormalPaymentWorkspace(): Promise<FormalPaymentWorkspace> {
  const response = await fetch("/api/formal/payments", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as FormalPaymentWorkspace & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "收付款台账读取失败");
  }
  return payload;
}
