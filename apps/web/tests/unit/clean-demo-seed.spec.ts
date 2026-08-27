import { expect, test } from "@playwright/test";
import {
  createMockLinkedOperationsStore,
  LINKED_OPERATIONS_STORAGE_KEY,
  validateLinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import {
  getMockQuickOrderFinancialReadModel,
  getMockQuickOrderFinancialStatement,
  listMockQuickOrderFinancialReadModels,
  recordMockQuickPayment,
  recordMockQuickRefund,
  recordMockQuickRefundSignature,
} from "../../src/lib/api/mock-quick-orders";
import { mockIdentities } from "../../src/lib/api/mock-data";
import { seedQuickOrders } from "../../src/lib/orders/quick-order-seed";

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

test("clean demo exposes only the owner-created super administrator identity", async () => {
  expect(mockIdentities()).toEqual([
    expect.objectContaining({
      id: "emp-001",
      name: "超级管理员",
      nameEn: "Super Admin",
      role: "superadmin",
    }),
  ]);

  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  expect(store.read((state) => state.trustedIdentities)).toEqual([
    { id: "emp-001", role: "superadmin" },
  ]);
});

test("clean demo seed exposes new shared-charge orders without embedded money history", () => {
  const clean = seedQuickOrders();

  expect(clean.map((order) => order.id)).toEqual([
    "demo-v2-provisional",
    "demo-v2-partial",
    "demo-v2-refunds",
    "demo-v2-parking",
    "demo-v2-parking-unclaimed",
  ]);
  expect(clean.every((order) => (
    order.chargeContract === "shared_v1"
      && Array.isArray(order.chargeLines)
      && order.chargeLines.length > 0
      && order.items.length === 0
      && order.payments.length === 0
      && order.refunds.length === 0
  ))).toBe(true);

  const lines = clean.flatMap((order) => order.chargeLines ?? []);
  expect(lines.some((line) => line.pricingMode === "fixed_total")).toBe(true);
  expect(lines.some((line) => line.pricingMode === "unit" && line.pendingQuote)).toBe(true);
  expect(new Set(clean.map((order) => order.businessOrderNo)).size).toBe(clean.length);
  expect(clean.every((order) => order.id.startsWith("demo-v2-"))).toBe(true);
  expect(clean.some((order) => order.chargeContract !== "shared_v1")).toBe(false);
  expect(clean.find((order) => order.id === "demo-v2-refunds")?.chargeLines?.[0]).toMatchObject({
    id: "demo-v2-refunds-labor",
    pricingMode: "unit",
    quantity: 2,
    unitPriceJmd: 10_000,
    unitDiscountJmd: 2_000,
  });
  expect(clean.find((order) => order.id === "demo-v2-parking-unclaimed")).toMatchObject({
    customerId: "CUST-BULK-002",
    vehicleId: "VEH-BULK-002",
    status: "pending_assign",
    submittedAt: null,
  });
});

test("clean Business Order seeds without a team all start at the real pending-assignment boundary", () => {
  const clean = seedQuickOrders();

  expect(clean.every((order) => order.status === "pending_assign")).toBe(true);
  expect(clean.every((order) => order.teamId === null)).toBe(true);
  expect(clean.every((order) => order.mechanicName === null)).toBe(true);
  expect(clean.every((order) => order.assignedAt === null)).toBe(true);
  expect(clean.every((order) => order.acceptedAt === null)).toBe(true);
  expect(clean.every((order) => order.returnedAt === null)).toBe(true);
  expect(clean.every((order) => order.submittedAt === null)).toBe(true);
  expect(clean.every((order) => order.submittedBy === null)).toBe(true);
  expect(clean.every((order) => order.statusHistory.length === 1)).toBe(true);
});

test("clean demo seed is valid in the linked store and publishes shared financial rows", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();

  expect(store.read((state) => state.protectionAnchor)).toMatch(/^clean-demo-state-v10:/);
  expect(store.read((state) => state.reportAttachments)).not.toContainEqual(
    expect.objectContaining({ storageKind: "legacy_reference" }),
  );
  expect(store.read((state) => state.inspectionReports.flatMap((report) => report.photoIds))).toEqual([]);
  const response = listMockQuickOrderFinancialReadModels(store);
  const clean = response.items.filter((item) => item.order.id.startsWith("demo-v2-"));
  expect(clean).toHaveLength(5);
  expect(clean.every((item) => item.source.kind === "shared_uninvoiced")).toBe(true);
});

test("obsolete Mock primary is replaced without touching session or unrelated browser data", async () => {
  const sourceStorage = memoryStorage();
  await createMockLinkedOperationsStore(sourceStorage).ready();
  const sourceRaw = sourceStorage.getItem(LINKED_OPERATIONS_STORAGE_KEY);
  if (!sourceRaw) throw new Error("clean source primary missing");

  const obsolete = JSON.parse(sourceRaw) as Record<string, unknown>;
  obsolete.protectionAnchor = "legacy:obsolete-mock-demo";

  const browserStorage = memoryStorage();
  browserStorage.setItem(LINKED_OPERATIONS_STORAGE_KEY, JSON.stringify(obsolete));
  browserStorage.setItem("wh_session", "keep-current-session");
  browserStorage.setItem("unrelated-preference", "keep-me");

  const store = createMockLinkedOperationsStore(browserStorage);
  await store.ready();

  const state = store.read((current) => current);
  expect(state.quickOrders.map((order) => order.id)).toEqual([
    "demo-v2-provisional",
    "demo-v2-partial",
    "demo-v2-refunds",
    "demo-v2-parking",
    "demo-v2-parking-unclaimed",
  ]);
  expect(state.protectionAnchor).not.toBe("legacy:obsolete-mock-demo");
  expect(browserStorage.getItem("wh_session")).toBe("keep-current-session");
  expect(browserStorage.getItem("unrelated-preference")).toBe("keep-me");
});

test("invalid current Mock primary is reset to the clean seed without touching session or unrelated data", async () => {
  const sourceStorage = memoryStorage();
  await createMockLinkedOperationsStore(sourceStorage).ready();
  const sourceRaw = sourceStorage.getItem(LINKED_OPERATIONS_STORAGE_KEY);
  if (!sourceRaw) throw new Error("clean source primary missing");

  const invalidCurrent = JSON.parse(sourceRaw) as Record<string, unknown>;
  invalidCurrent.quickOrders = [{ id: "broken-current-demo" }];

  const browserStorage = memoryStorage();
  browserStorage.setItem(LINKED_OPERATIONS_STORAGE_KEY, JSON.stringify(invalidCurrent));
  browserStorage.setItem("wh_session", "keep-current-session");
  browserStorage.setItem("unrelated-preference", "keep-me");

  const store = createMockLinkedOperationsStore(browserStorage);
  await store.ready();

  expect(store.read((state) => state.quickOrders.map((order) => order.id))).toEqual([
    "demo-v2-provisional",
    "demo-v2-partial",
    "demo-v2-refunds",
    "demo-v2-parking",
    "demo-v2-parking-unclaimed",
  ]);
  expect(browserStorage.getItem("wh_session")).toBe("keep-current-session");
  expect(browserStorage.getItem("unrelated-preference")).toBe("keep-me");
});

test("clean demo never fabricates Invoice, payment, refund, parking, or workflow facts", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const modulePath = "../../src/lib/api/mock-clean-demo";
  const demoModule = await import(modulePath) as {
    ensureMockCleanMoneyDemo: (target: typeof store) => Promise<void>;
  };

  await demoModule.ensureMockCleanMoneyDemo(store);
  const state = store.read((current) => current);
  expect(state.quickOrders.every((order) => order.status === "pending_assign")).toBe(true);
  expect(state.quickOrders.every((order) => order.teamId === null)).toBe(true);
  expect(state.invoices.filter((invoice) => invoice.businessOrderId.startsWith("demo-v2-"))).toEqual([]);
  expect(state.payments.filter((payment) => payment.mutationId?.startsWith("demo-v2-"))).toEqual([]);
  expect(state.refunds.filter((refund) => (
    "mutationId" in refund
      && typeof refund.mutationId === "string"
      && refund.mutationId.startsWith("demo-v2-")
  ))).toEqual([]);
  expect(state.parkingCases.filter((parking) => (
    "originBusinessOrderId" in parking
      && typeof parking.originBusinessOrderId === "string"
      && parking.originBusinessOrderId.startsWith("demo-v2-")
  ))).toEqual([]);
});

test("a new BO records payment immediately without waiting for a formal Invoice", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();

  const updated = await recordMockQuickPayment("demo-v2-provisional", {
    amountJmd: 3_000,
    method: "cash",
    note: "新BO第一笔收款",
  }, "兰兰", store);

  const payment = updated.payments[0] as unknown as {
    receipt?: {
      contract: string;
      receiptNo: string;
      paymentId: string;
      businessOrderNo: string;
      amountJmd: number;
      paidToDateJmd: number;
      balanceAfterJmd: number;
      chargeLines: unknown[];
      paymentHistory: unknown[];
    };
  };
  expect(payment.receipt).toMatchObject({
    contract: "quick_payment_receipt_v1",
    receiptNo: expect.stringMatching(/^KGN-WH-RCPT-\d{8}-\d{5}$/),
    paymentId: updated.payments[0]?.id,
    businessOrderNo: updated.businessOrderNo,
    amountJmd: 3_000,
    paidToDateJmd: 3_000,
    balanceAfterJmd: 24_500,
  });
  expect(payment.receipt?.chargeLines).toHaveLength(updated.chargeLines?.length ?? 0);
  expect(payment.receipt?.paymentHistory).toEqual([
    expect.objectContaining({ paymentId: updated.payments[0]?.id, amountJmd: 3_000 }),
  ]);

  expect(getMockQuickOrderFinancialReadModel("demo-v2-provisional", store)).toMatchObject({
    source: { kind: "shared_uninvoiced" },
    ledger: {
      receivableJmd: 27_500,
      grossPaidJmd: 3_000,
      cashRefundedJmd: 0,
      netPaidJmd: 3_000,
      balanceJmd: 24_500,
      hasPaymentHistory: true,
    },
    gates: { canCollectPayment: true },
  });
  expect(getMockQuickOrderFinancialStatement("demo-v2-provisional", store).entries).toContainEqual(
    expect.objectContaining({ kind: "payment", amountJmd: 3_000, note: "新BO第一笔收款" }),
  );
});

test("a payment Receipt is immutable and its frozen totals must still reconcile", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  await recordMockQuickPayment("demo-v2-provisional", {
    amountJmd: 3_000,
    method: "cash",
    note: "冻结 Receipt 验证",
  }, "超级管理员", store);

  const tampered = store.read((state) => structuredClone(state));
  const payment = tampered.quickOrders
    .find((order) => order.id === "demo-v2-provisional")
    ?.payments[0] as unknown as { receipt: { balanceAfterJmd: number } };
  payment.receipt.balanceAfterJmd += 1;

  expect(() => validateLinkedOperationsState(tampered)).toThrow(/RECEIPT|Receipt|收款凭证/i);
});

test("a BO records a refund first and archives the signed paper later without changing charge lines", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const beforeLines = store.read((state) => structuredClone(
    state.quickOrders.find((order) => order.id === "demo-v2-provisional")?.chargeLines,
  ));

  await recordMockQuickPayment("demo-v2-provisional", {
    amountJmd: 3_000,
    method: "cash",
    note: "先收三千",
  }, "超级管理员", store);
  const updated = await recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 5_000,
    method: "cash",
    reason: "客户确认收到现金退款",
    originalDocumentStatus: "returned",
  }, "超级管理员", store);

  expect(updated.chargeLines).toEqual(beforeLines);
  expect(updated.refunds).toContainEqual(expect.objectContaining({
    contract: "quick_refund_v2",
    amountJmd: 5_000,
    category: null,
    receiptNo: expect.any(String),
    reason: "客户确认收到现金退款",
    note: "客户确认收到现金退款",
    originalDocumentStatus: "returned",
    proof: null,
    signature: null,
  }));

  const refundId = updated.refunds.at(-1)!.id;
  const archived = await recordMockQuickRefundSignature("demo-v2-provisional", {
    refundId,
    signerName: "客户本人",
    photoDataUrl: "data:image/png;base64,AA==",
    photoFileName: "signed-refund-acknowledgement.png",
  }, "超级管理员", store);
  expect(archived.chargeLines).toEqual(beforeLines);
  expect(archived.refunds).toContainEqual(expect.objectContaining({
    id: refundId,
    signature: expect.objectContaining({
      signerName: "客户本人",
      photoDataUrl: "data:image/png;base64,AA==",
      photoFileName: "signed-refund-acknowledgement.png",
      signedBy: "超级管理员",
    }),
  }));
  expect(getMockQuickOrderFinancialReadModel("demo-v2-provisional", store).ledger).toMatchObject({
    receivableJmd: 27_500,
    grossPaidJmd: 3_000,
    cashRefundedJmd: 5_000,
    receivableReductionJmd: 0,
    netPaidJmd: -2_000,
    balanceJmd: 29_500,
  });
  expect(getMockQuickOrderFinancialStatement("demo-v2-provisional", store).entries).toContainEqual(
    expect.objectContaining({
      kind: "refund",
      accounting: "legacy_cash_only",
      cashRefundJmd: 5_000,
      receivableReductionJmd: null,
    }),
  );
});

test("经营概览随真实 BO 收付款记录变化，不再返回固定演示数字", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const modulePath = "../../src/lib/api/mock-dashboard";
  const dashboardModule = await import(modulePath) as {
    selectMockLiveDashboard: (
      state: ReturnType<typeof store.read>,
      nowMs: number,
    ) => import("../../src/lib/types").DashboardSummary;
  };
  const readDashboard = () => store.read((state) => (
    dashboardModule.selectMockLiveDashboard(state, store.nowMs())
  ));

  const before = readDashboard();
  const beforeNet = before.topCards.find((card) => card.id === "today_revenue");
  const beforeBalance = before.topCards.find((card) => card.id === "accounts_receivable");
  expect(before.header.subtitle).toContain("当前 Business Order、逐笔收款、逐笔退款与停车记录");
  expect(before.header.subtitle).not.toContain("固定演示数据");
  expect(before.teamPerformance.teams).toEqual([]);
  expect(beforeNet?.title).toBe("今日营业收入");
  expect(beforeNet?.href).toBe("/revenue?range=week");
  expect(beforeNet?.footerItems).toContainEqual({ label: "收款记录", value: "0 笔" });
  expect(beforeNet?.footerItems).toContainEqual({ label: "退款记录", value: "0 笔" });
  expect(beforeBalance?.title).toBe("应收账款");

  await recordMockQuickPayment("demo-v2-provisional", {
    amountJmd: 3_000,
    method: "cash",
    note: "经营概览实时变化验证",
  }, "超级管理员", store);

  const after = readDashboard();
  const afterNet = after.topCards.find((card) => card.id === "today_revenue");
  const afterBalance = after.topCards.find((card) => card.id === "accounts_receivable");
  expect(after.periods.map((period) => period.range)).toEqual(["day", "week", "month"]);
  expect(after.periods.map((period) => period.label)).toEqual(["今日", "本周", "本月"]);
  for (const period of after.periods) {
    expect(period.grossPaidJmd - period.cashRefundedJmd).toBe(period.netPaidJmd);
  }
  expect(afterNet?.value).toBe((beforeNet?.value ?? 0) + 3_000);
  expect(afterBalance?.value).toBe((beforeBalance?.value ?? 0) - 3_000);
  expect(afterNet?.footerItems).toContainEqual({ label: "收款记录", value: "1 笔" });
});
