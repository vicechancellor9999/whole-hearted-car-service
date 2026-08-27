import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import { ensureMockCleanMoneyDemo } from "../../src/lib/api/mock-clean-demo";
import { getMockLinkedOperationsStore } from "../../src/lib/api/mock-orders";
import { activateMockQuickInvoiceSnapshot } from "../../src/lib/api/mock-billing";

type PaymentInput = Readonly<{
  contract: "quick_order_invoice_payment_v1";
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  expectedRevision: number;
  mutationId: string;
  amountJmd: number;
  method: string;
  note?: string;
}>;

type RefundInput = Readonly<{
  contract: "quick_order_invoice_line_refund_v1";
  orderId: string;
  invoiceId: string;
  invoiceVersionId: string;
  chargeLineId: string;
  refundQuantity?: number;
  wholeLine?: true;
  expectedRevision: number;
  mutationId: string;
  method: string;
  reason: string;
}>;

type MoneySurface = Readonly<{
  recordInvoicePayment(input: PaymentInput): Promise<Record<string, unknown>>;
  recordInvoiceLineRefund(input: RefundInput): Promise<Record<string, unknown>>;
}>;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function installSuperadmin(): () => void {
  const storage = memoryStorage();
  storage.setItem("wh_session", JSON.stringify({
    identity: { id: "emp-001", name: "超级管理员", role: "superadmin" },
  }));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

test("opaque Quick money actions append one independent payment and one independent line refund", async () => {
  test.setTimeout(20_000);
  const restore = installSuperadmin();
  try {
    const store = getMockLinkedOperationsStore();
    await ensureMockCleanMoneyDemo(store);
    await store.mutate((state) => {
      const index = state.quickOrders.findIndex((order) => order.id === "demo-v2-partial");
      const order = state.quickOrders[index];
      if (!order) throw new Error("clean Business Order missing");
      const submittedAt = "2026-08-24T09:00:00-05:00";
      state.quickOrders[index] = {
        ...order,
        status: "submitted",
        teamId: "test-repair-team",
        mechanicName: "测试维修班组",
        assignedAt: "2026-08-24T08:10:00-05:00",
        acceptedAt: "2026-08-24T08:20:00-05:00",
        returnedAt: "2026-08-24T08:50:00-05:00",
        submittedAt,
        submittedBy: "超级管理员",
        statusHistory: [
          ...order.statusHistory,
          { id: `${order.id}-test-submit`, from: "returned", to: "submitted", by: "超级管理员", byRole: "frontdesk", at: submittedAt, roundNumber: 1, teamId: "test-repair-team", performanceValueJmd: order.performanceValueJmd },
        ],
      };
      state.revision += 1;
    }, { action: "test.money-actions.complete-workflow", consumeWriteFault: false });
    const beforeActivation = store.read((state) => state.revision);
    await activateMockQuickInvoiceSnapshot({
      orderId: "demo-v2-partial",
      expectedRevision: beforeActivation,
      mutationId: "public-demo-invoice-v1",
    }, { id: "emp-001", name: "超级管理员", role: "superadmin" }, store);
    const surface = api.quickOrderFinancials as unknown as MoneySurface;
    const before = await api.quickOrderFinancials.detail("demo-v2-partial");
    if (before.source.kind !== "canonical_invoice") throw new Error("canonical demo Invoice missing");
    const rawBefore = store.read((state) => structuredClone(
      state.quickOrders.find((order) => order.id === "demo-v2-partial"),
    ));

    const payment = await surface.recordInvoicePayment({
      contract: "quick_order_invoice_payment_v1",
      orderId: "demo-v2-partial",
      invoiceId: before.source.invoiceId,
      invoiceVersionId: before.source.effectiveVersionId,
      expectedRevision: before.revision,
      mutationId: "public-demo-payment-3",
      amountJmd: 1_000,
      method: "cash",
      note: "第三笔独立收款",
    });
    expect(payment).toMatchObject({
      contract: "quick_order_invoice_payment_result_v1",
      orderId: "demo-v2-partial",
      invoiceId: before.source.invoiceId,
      invoiceVersionId: before.source.effectiveVersionId,
      revision: before.revision + 1,
      payment: { amountJmd: 1_000, method: "cash", note: "第三笔独立收款" },
    });

    const afterPayment = await api.quickOrderFinancials.detail("demo-v2-partial");
    if (afterPayment.source.kind !== "canonical_invoice") throw new Error("canonical demo Invoice missing after payment");
    const refund = await surface.recordInvoiceLineRefund({
      contract: "quick_order_invoice_line_refund_v1",
      orderId: "demo-v2-partial",
      invoiceId: afterPayment.source.invoiceId,
      invoiceVersionId: afterPayment.source.effectiveVersionId,
      chargeLineId: "demo-v2-partial-labor",
      refundQuantity: 1,
      expectedRevision: afterPayment.revision,
      mutationId: "public-demo-refund-1",
      method: "cash",
      reason: "第一笔独立逐行退款",
    });
    expect(refund).toMatchObject({
      contract: "quick_order_invoice_line_refund_result_v1",
      orderId: "demo-v2-partial",
      invoiceId: afterPayment.source.invoiceId,
      invoiceVersionId: afterPayment.source.effectiveVersionId,
      revision: afterPayment.revision + 1,
      refund: {
        chargeLineId: "demo-v2-partial-labor",
        refundQuantity: 1,
        wholeLine: false,
        receivableReductionJmd: 10_000,
        cashRefundJmd: 0,
        reason: "第一笔独立逐行退款",
      },
    });

    const state = store.read((current) => current);
    expect(state.payments.filter((entry) => entry.mutationId === "public-demo-payment-3")).toHaveLength(1);
    expect(state.refunds.filter((entry) => (
      entry.refundContract === "ordinary_line_v1" && entry.mutationId === "public-demo-refund-1"
    ))).toHaveLength(1);
    expect(state.quickOrders.find((order) => order.id === "demo-v2-partial")).toEqual(rawBefore);
  } finally {
    restore();
  }
});
