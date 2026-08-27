import { expect, test } from "@playwright/test";
import { ensureMockCleanMoneyDemo } from "../../src/lib/api/mock-clean-demo";
import { createMockLinkedOperationsStore } from "../../src/lib/api/mock-orders";

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

test("clean parking demo does not fabricate a claim, payment, correction, or refund before a real submitted workflow", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  await ensureMockCleanMoneyDemo(store);

  const after = store.read((state) => structuredClone(state));
  expect(after.quickOrders.every((order) => order.status === "pending_assign")).toBe(true);
  expect(after.parkingCases.some((parking) => (
    "originBusinessOrderId" in parking
      && (parking.originBusinessOrderId === "demo-v2-parking"
        || parking.originBusinessOrderId === "demo-v2-parking-unclaimed")
  ))).toBe(false);
  expect(after.payments.some((payment) => payment.mutationId?.startsWith("demo-v2-parking"))).toBe(false);
  expect(after.billingAuditEvents.some((event) => event.mutationId?.startsWith("demo-v2-parking"))).toBe(false);
});
