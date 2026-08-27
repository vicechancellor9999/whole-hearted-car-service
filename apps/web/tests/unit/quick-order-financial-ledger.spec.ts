import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import { ensureMockCleanMoneyDemo } from "../../src/lib/api/mock-clean-demo";
import { createMockLinkedOperationsStore, type MockLinkedOperationsStore } from "../../src/lib/api/mock-orders";

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

function installBrowser(): () => void {
  const values = new Map<string, string>();
  values.set("wh_session", JSON.stringify({
    identity: { id: "emp-001", role: "superadmin", name: "LiJian" },
  }));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  return () => descriptor
    ? Object.defineProperty(globalThis, "window", descriptor)
    : void Reflect.deleteProperty(globalThis, "window");
}

test("clean demo ledger starts empty until real payments or refunds are recorded", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  await ensureMockCleanMoneyDemo(store);
  const modulePath = "../../src/lib/api/mock-quick-orders";
  const apiModule = await import(modulePath) as Record<string, unknown>;
  const read = apiModule.getMockQuickOrderFinancialLedger as undefined | ((store: MockLinkedOperationsStore) => {
    revision: number;
    items: Array<{ kind: string; orderId: string; amountJmd?: number; receivableReductionJmd?: number; cashRefundJmd?: number }>;
    totals: { grossPaidJmd: number; cashRefundedJmd: number; receivableReductionJmd: number; netPaidJmd: number };
  });
  expect(typeof read, "missing cross-order financial ledger selector").toBe("function");
  const ledger = read!(store);
  expect(ledger.items).toEqual([]);
  expect(ledger.totals).toMatchObject({
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 0,
    netPaidJmd: 0,
  });
});

test("public financial API exposes the same empty clean ledger", async () => {
  const restore = installBrowser();
  try {
    const financials = api.quickOrderFinancials as typeof api.quickOrderFinancials & {
      ledger?: () => Promise<{ contract: string; items: Array<{ id: string; kind: string }> }>;
    };
    expect(typeof financials.ledger, "missing public financial ledger API").toBe("function");
    const ledger = await financials.ledger!();
    expect(ledger.contract).toBe("quick_order_financial_ledger_v1");
    expect(ledger.items).toEqual([]);
  } finally {
    restore();
  }
});

test("new payment and refund facts appear in the cross-order ledger immediately", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  await ensureMockCleanMoneyDemo(store);
  const apiModule = await import("../../src/lib/api/mock-quick-orders");
  await apiModule.recordMockQuickPayment("demo-v2-provisional", {
    amountJmd: 3_000,
    method: "cash",
    note: "today ledger proof",
  }, "超级管理员", store);
  await apiModule.recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 5_000,
    method: "cash",
    reason: "today ledger refund",
    originalDocumentStatus: "returned",
    signerName: "客户本人",
    signatureDataUrl: "data:image/png;base64,AA==",
  }, "超级管理员", store);

  const ledger = apiModule.getMockQuickOrderFinancialLedger(store);
  const current = ledger.items.filter((item) => item.orderId === "demo-v2-provisional");
  expect(current).toHaveLength(2);
  expect(current[0]).toMatchObject({ kind: "payment", amountJmd: 3_000 });
  expect(current[1]).toMatchObject({ kind: "refund", cashRefundJmd: 5_000 });
});
