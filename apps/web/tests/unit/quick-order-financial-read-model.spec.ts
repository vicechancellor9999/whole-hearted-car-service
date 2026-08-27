import { expect, test } from "@playwright/test";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoiceLineRefund,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import {
  applyMockQuickOrderAction,
  recordMockQuickOrderLifecycleMutation,
  recordMockQuickPickup,
} from "../../src/lib/api/mock-quick-orders";
import { recordMockParkingSourcePickup } from "../../src/lib/api/mock-parking";
import {
  createMockLinkedOperationsStore,
  deriveLinkedInvoiceFinancialSummary,
  type LinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import * as quickOrderDomain from "../../src/lib/api/mock-quick-orders";
import type { QuickOrder, QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";

function memoryStorage(values = new Map<string, string>()): Storage {
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

type StorageOperation = Readonly<{
  kind: "set" | "remove" | "clear";
  key?: string;
}>;

function probedMemoryStorage(values = new Map<string, string>()): {
  storage: Storage;
  operations: StorageOperation[];
} {
  const operations: StorageOperation[] = [];
  return {
    operations,
    storage: {
      get length() { return values.size; },
      clear: () => {
        operations.push({ kind: "clear" });
        values.clear();
      },
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => {
        operations.push({ kind: "remove", key });
        values.delete(key);
      },
      setItem: (key, value) => {
        operations.push({ kind: "set", key });
        values.set(key, value);
      },
    },
  };
}

type Store = ReturnType<typeof createMockLinkedOperationsStore>;

const frontdeskActor = {
  id: "emp-001",
  name: "超级管理员",
  role: "superadmin" as const,
};

let lifecycleMutationSequence = 0;

async function applyLifecycleAction(
  store: Store,
  orderId: string,
  action: Extract<Parameters<typeof applyMockQuickOrderAction>[1], {
    kind: "void" | "restore" | "record_paid_full" | "cancel_paid_full";
  }>,
  actor: typeof frontdeskActor = frontdeskActor,
): Promise<QuickOrder> {
  const before = stateSnapshot(store);
  lifecycleMutationSequence += 1;
  await recordMockQuickOrderLifecycleMutation({
    contract: "quick_order_lifecycle_mutation_v1",
    kind: action.kind,
    orderId,
    expectedRevision: before.revision,
    mutationId: `financial-core-lifecycle-${lifecycleMutationSequence}`,
    ...(action.kind === "void" ? { reason: action.reason } : {}),
  }, actor, store);
  const order = stateSnapshot(store).quickOrders.find((candidate) => candidate.id === orderId);
  if (!order) throw new Error("lifecycle Quick BO missing after mutation");
  return order;
}

const unit = (
  id: string,
  unitPriceJmd: number,
  quantity = 1,
): Extract<QuickOrderChargeLine, { pricingMode: "unit" }> => ({
  id,
  category: "labor",
  pricingMode: "unit",
  descZh: id,
  descEn: id,
  remarkZh: "",
  remarkEn: "",
  unit: "项",
  unitEn: "item",
  quantity,
  unitPriceJmd,
  unitDiscountJmd: 0,
  pendingQuote: false,
});

async function addSharedQuickOrder(
  store: Store,
  orderId: string,
  lines: ReadonlyArray<QuickOrderChargeLine>,
): Promise<void> {
  await store.mutate((state) => {
    const base = state.quickOrders.find((order) => order.id === "demo-v2-parking-unclaimed")
      ?? state.quickOrders.find((order) => order.status === "submitted")
      ?? state.quickOrders[0];
    if (!base) throw new Error("seed Quick BO missing");
    const baseVehicle = state.vehicles.find((vehicle) => vehicle.id === base.vehicleId);
    if (!baseVehicle) throw new Error("seed vehicle missing");
    const vehicleId = `${orderId}-vehicle`;
    state.vehicles.push({
      ...structuredClone(baseVehicle),
      id: vehicleId,
      plate: `TEST-${state.quickOrders.length + 1}`,
    });
    state.quickOrders.push({
      ...structuredClone(base),
      id: orderId,
      businessOrderNo: `KGN-WH-${orderId.toUpperCase()}`,
      vehicleId,
      status: "submitted",
      teamId: "test-repair-team",
      mechanicName: "测试维修班组",
      assignedAt: "2026-07-01T08:10:00-05:00",
      acceptedAt: "2026-07-01T08:20:00-05:00",
      returnedAt: "2026-07-01T08:50:00-05:00",
      submittedAt: "2026-07-01T09:00:00-05:00",
      submittedBy: "超级管理员",
      statusHistory: [
        { id: `${orderId}-ev-1`, from: null, to: "pending_assign", by: "超级管理员", byRole: "frontdesk", at: "2026-07-01T08:00:00-05:00" },
        { id: `${orderId}-ev-2`, from: "returned", to: "submitted", by: "超级管理员", byRole: "frontdesk", at: "2026-07-01T09:00:00-05:00", roundNumber: 1, teamId: "test-repair-team", performanceValueJmd: base.performanceValueJmd },
      ],
      items: [],
      chargeContract: "shared_v1",
      chargeLines: structuredClone(lines),
      payments: [],
      refunds: [],
      invoiceSignature: null,
      pickupNotice: null,
      pickedUpAt: null,
      pickedUpBy: null,
      paidInFullAt: null,
      paidInFullBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
    state.revision += 1;
  }, { action: "test.quick-financial-source.write", consumeWriteFault: false });
}

async function installHistoricalCompletionCoordinate(
  store: Store,
  orderId: string,
  coordinate: "pickup" | "paid_full",
): Promise<void> {
  await store.mutate((state) => {
    const orderIndex = state.quickOrders.findIndex((candidate) => candidate.id === orderId);
    const order = state.quickOrders[orderIndex];
    if (!order) throw new Error("Quick BO missing");
    const at = coordinate === "pickup"
      ? "2026-08-21T12:00:00-05:00"
      : "2026-08-21T12:05:00-05:00";
    state.quickOrders[orderIndex] = {
      ...order,
      ...(coordinate === "pickup"
        ? { pickedUpAt: at, pickedUpBy: frontdeskActor.name }
        : { paidInFullAt: at, paidInFullBy: frontdeskActor.name }),
      statusHistory: [
        ...order.statusHistory,
        {
          id: `${orderId}-ev-${order.statusHistory.length + 1}`,
          from: order.status,
          to: order.status,
          by: frontdeskActor.name,
          byRole: "frontdesk",
          at,
          reason: coordinate === "pickup" ? "记录取车" : "记录付完全款",
        },
      ],
    };
    state.revision += 1;
  }, { action: `test.quick-financial-${coordinate}.write`, consumeWriteFault: false });
}

async function linkAfterSalesChild(store: Store, parentId: string, childId: string): Promise<void> {
  await store.mutate((state) => {
    const childIndex = state.quickOrders.findIndex((candidate) => candidate.id === childId);
    const child = state.quickOrders[childIndex];
    if (!child) throw new Error("after-sales child missing");
    state.quickOrders[childIndex] = {
      ...child,
      orderKind: "aftersales",
      linkedOrderId: parentId,
      performanceValueJmd: 0,
      statusHistory: child.statusHistory.map((event) => (
        event.from === "returned" && event.to === "submitted" && event.cancelledAt === undefined
          ? { ...event, performanceValueJmd: 0 }
          : event
      )),
    };
    state.revision += 1;
  }, { action: "test.quick-financial-link-child.write", consumeWriteFault: false });
}

function stateSnapshot(store: Store): LinkedOperationsState {
  return store.read((state) => state);
}

async function expectActionRejectedWithoutWrite(
  store: Store,
  operations: StorageOperation[],
  orderId: string,
  action: Parameters<typeof applyMockQuickOrderAction>[1],
  pattern: RegExp,
): Promise<void> {
  const before = stateSnapshot(store);
  operations.length = 0;
  if (action.kind !== "void" && action.kind !== "restore"
    && action.kind !== "record_paid_full" && action.kind !== "cancel_paid_full") {
    throw new Error("financial rejection helper only accepts public lifecycle kinds");
  }
  await expect(applyLifecycleAction(store, orderId, action)).rejects.toThrow(pattern);
  expect(stateSnapshot(store)).toEqual(before);
  expect(operations).toEqual([]);
}

function financialReadModel(orderId: string, store: unknown): unknown {
  const selector: unknown = Reflect.get(quickOrderDomain, "getMockQuickOrderFinancialReadModel");
  if (typeof selector !== "function") {
    throw new Error("getMockQuickOrderFinancialReadModel selector is missing");
  }
  const result: unknown = Reflect.apply(selector, undefined, [orderId, store]);
  return result;
}

function readOnlySelectorStore(state: LinkedOperationsState): unknown {
  return {
    read: (selector: unknown) => {
      if (typeof selector !== "function") throw new Error("selector must be a function");
      return Reflect.apply(selector, undefined, [state]);
    },
    nowMs: () => Date.parse("2026-08-22T12:00:00-05:00"),
  };
}

function expectSelectorRejected(
  orderId: string,
  state: LinkedOperationsState,
  pattern: RegExp,
): void {
  const before = structuredClone(state);
  expect(() => financialReadModel(orderId, readOnlySelectorStore(state))).toThrow(pattern);
  expect(state).toEqual(before);
}

async function assertFinancialReadModel(value: unknown): Promise<void> {
  const modulePath = "../../src/lib/billing/" + "quick-order-financial";
  const moduleNamespace: unknown = await import(/* @vite-ignore */ modulePath);
  if (moduleNamespace === null || typeof moduleNamespace !== "object") {
    throw new Error("quick-order-financial module is missing");
  }
  const assertion: unknown = Reflect.get(moduleNamespace, "assertQuickOrderFinancialReadModel");
  if (typeof assertion !== "function") {
    throw new Error("assertQuickOrderFinancialReadModel is missing");
  }
  Reflect.apply(assertion, undefined, [value]);
}

function canonicalSemanticModel(): Record<string, unknown> {
  return {
    contract: "quick_order_financial_read_model_v1",
    revision: 7,
    order: {
      id: "qbo-semantic",
      businessOrderNo: "KGN-WH-QBO-SEMANTIC",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      status: "submitted",
      voidedAt: null,
      pickedUpAt: null,
      paidInFullAt: null,
    },
    source: {
      kind: "canonical_invoice",
      invoiceId: "invoice-semantic",
      invoiceNo: "KGN-WH-INV-2026082299901",
      effectiveVersionId: "invoice-semantic-v1",
      versionNo: 1,
      snapshotCommitment: `sha256-utf16le:${"1".repeat(64)}`,
    },
    ledger: {
      invoiceTotalJmd: 10_000,
      receivableJmd: 10_000,
      grossPaidJmd: 4_000,
      cashRefundedJmd: 0,
      receivableReductionJmd: 0,
      netPaidJmd: 4_000,
      balanceJmd: 6_000,
      paymentStatus: "partially_paid",
      settlementStatus: "due",
      hasPaymentHistory: true,
    },
    gates: {
      canCollectPayment: true,
      canRefund: true,
      canVoid: false,
      canRecordPaidFull: false,
      canCancelPaidFull: false,
      completed: false,
    },
  };
}

function closedRecord(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
  label: string,
): Record<string, unknown> {
  expect(value, label).not.toBeNull();
  expect(typeof value, label).toBe("object");
  expect(Array.isArray(value), label).toBe(false);
  const record = value as Record<string, unknown>;
  expect(Object.getPrototypeOf(record) === Object.prototype || Object.getPrototypeOf(record) === null, label).toBe(true);
  const ownKeys = Reflect.ownKeys(record);
  expect(ownKeys.every((key) => typeof key === "string"), `${label} keys must all be strings`).toBe(true);
  expect(ownKeys.filter((key): key is string => typeof key === "string").sort(), label)
    .toEqual([...expectedKeys].sort());
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    expect(descriptor, `${label}.${key}`).toMatchObject({ enumerable: true });
    expect(descriptor && "value" in descriptor, `${label}.${key} must be an own data property`).toBe(true);
    expect(descriptor && "value" in descriptor ? descriptor.value : undefined, `${label}.${key}`).not.toBeUndefined();
  }
  return record;
}

const TOP_KEYS = ["contract", "revision", "order", "source", "ledger", "gates"] as const;
const ORDER_KEYS = [
  "id",
  "businessOrderNo",
  "customerId",
  "vehicleId",
  "status",
  "voidedAt",
  "pickedUpAt",
  "paidInFullAt",
] as const;
const LEDGER_KEYS = [
  "invoiceTotalJmd",
  "receivableJmd",
  "grossPaidJmd",
  "cashRefundedJmd",
  "receivableReductionJmd",
  "netPaidJmd",
  "balanceJmd",
  "paymentStatus",
  "settlementStatus",
  "hasPaymentHistory",
] as const;
const GATE_KEYS = [
  "canCollectPayment",
  "canRefund",
  "canVoid",
  "canRecordPaidFull",
  "canCancelPaidFull",
  "completed",
] as const;

function closedFinancialModel(value: unknown): {
  result: Record<string, unknown>;
  order: Record<string, unknown>;
  source: Record<string, unknown>;
  ledger: Record<string, unknown>;
  gates: Record<string, unknown>;
} {
  const result = closedRecord(value, TOP_KEYS, "financial selector");
  expect(result.contract).toBe("quick_order_financial_read_model_v1");
  const order = closedRecord(result.order, ORDER_KEYS, "financial order");
  const sourceShape = closedRecord(result.source, Object.keys(result.source as object), "financial source candidate");
  const source = closedRecord(
    result.source,
    sourceShape.kind === "canonical_invoice"
      ? ["kind", "invoiceId", "invoiceNo", "effectiveVersionId", "versionNo", "snapshotCommitment"]
      : ["kind"],
    "financial source",
  );
  const ledger = closedRecord(result.ledger, LEDGER_KEYS, "financial ledger");
  const gates = closedRecord(result.gates, GATE_KEYS, "financial gates");
  return { result, order, source, ledger, gates };
}

test("shared uninvoiced Quick BO exposes provisional receivable and direct payment/refund actions", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-financial-uninvoiced", [unit("financial-uninvoiced-line", 10_000)]);
  const before = stateSnapshot(store);
  const raw = before.quickOrders.find((order) => order.id === "qbo-financial-uninvoiced");
  expect(raw?.payments).toEqual([]);
  expect(raw?.refunds).toEqual([]);
  expect(before.invoices.filter((invoice) => invoice.businessOrderId === raw?.id)).toEqual([]);

  const { result, order, source, ledger, gates } = closedFinancialModel(
    financialReadModel("qbo-financial-uninvoiced", store),
  );
  expect(result.revision).toBe(before.revision);
  expect(order).toEqual({
    id: raw?.id,
    businessOrderNo: raw?.businessOrderNo,
    customerId: raw?.customerId,
    vehicleId: raw?.vehicleId,
    status: raw?.status,
    voidedAt: raw?.voidedAt,
    pickedUpAt: raw?.pickedUpAt,
    paidInFullAt: raw?.paidInFullAt,
  });
  expect(source).toEqual({ kind: "shared_uninvoiced" });
  expect(ledger).toEqual({
    invoiceTotalJmd: null,
    receivableJmd: 10_000,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 0,
    netPaidJmd: 0,
    balanceJmd: 10_000,
    paymentStatus: "unpaid",
    settlementStatus: "due",
    hasPaymentHistory: false,
  });
  expect(gates).toEqual({
    canCollectPayment: true,
    canRefund: true,
    canVoid: true,
    canRecordPaidFull: false,
    canCancelPaidFull: false,
    completed: false,
  });
  expect(stateSnapshot(store)).toEqual(before);
});

test("canonical Quick BO selector ignores empty embedded arrays and reads the effective Invoice ledger", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-financial-canonical", [unit("financial-canonical-line", 10_000)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-financial-canonical",
    expectedRevision: state.revision,
    mutationId: "financial-selector-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "financial-selector-pay-v1",
    amountJmd: 4_000,
    method: "cash",
  }, frontdeskActor, store);
  const beforeRead = stateSnapshot(store);
  const raw = beforeRead.quickOrders.find((order) => order.id === "qbo-financial-canonical");
  expect(raw?.payments).toEqual([]);
  expect(raw?.refunds).toEqual([]);

  const { result, order, source, ledger, gates } = closedFinancialModel(
    financialReadModel("qbo-financial-canonical", store),
  );
  expect(result.revision).toBe(beforeRead.revision);
  expect(order).toEqual({
    id: raw?.id,
    businessOrderNo: raw?.businessOrderNo,
    customerId: raw?.customerId,
    vehicleId: raw?.vehicleId,
    status: raw?.status,
    voidedAt: raw?.voidedAt,
    pickedUpAt: raw?.pickedUpAt,
    paidInFullAt: raw?.paidInFullAt,
  });
  expect(source).toEqual({
    kind: "canonical_invoice",
    invoiceId: activation.invoiceId,
    invoiceNo: activation.invoiceNo,
    effectiveVersionId: activation.invoiceVersionId,
    versionNo: 1,
    snapshotCommitment: activation.snapshotCommitment,
  });
  expect(ledger).toEqual({
    invoiceTotalJmd: 10_000,
    receivableJmd: 10_000,
    grossPaidJmd: 4_000,
    cashRefundedJmd: 0,
    receivableReductionJmd: 0,
    netPaidJmd: 4_000,
    balanceJmd: 6_000,
    paymentStatus: "partially_paid",
    settlementStatus: "due",
    hasPaymentHistory: true,
  });
  expect(gates).toEqual({
    canCollectPayment: true,
    canRefund: true,
    canVoid: false,
    canRecordPaidFull: false,
    canCancelPaidFull: false,
    completed: false,
  });
  expect(stateSnapshot(store)).toEqual(beforeRead);
});

test("canonical refund stays available when only a parking projection remains receivable", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  const scenario = { nowMs: Date.parse("2026-08-17T12:00:00-05:00") };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario,
    },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    const orderId = "qbo-financial-parking-only-receivable";
    const ordinaryLineId = "financial-parking-only-ordinary";
    await addSharedQuickOrder(store, orderId, [unit(ordinaryLineId, 5_000)]);
    let state = stateSnapshot(store);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: state.revision,
      mutationId: "financial-parking-only-source-create",
      channels: [{
        kind: "sms",
        language: "en",
        text: "Vehicle ready for pickup.",
      }],
    }, frontdeskActor, store);

    scenario.nowMs = Date.parse("2026-08-22T12:00:00-05:00");
    state = stateSnapshot(store);
    const pickedUp = await recordMockParkingSourcePickup({
      caseId: created.parkingSource.id,
      expectedRevision: state.revision,
      expectedSourceRevision: created.parkingSource.revision,
      mutationId: "financial-parking-only-source-pickup",
    }, frontdeskActor, store);
    expect(pickedUp.parkingSource.accrual).toEqual({ chargeableDays: 3, originalAmountJmd: 7_500 });

    state = stateSnapshot(store);
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: state.revision,
      mutationId: "financial-parking-only-activate",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const refund = await recordMockInvoiceLineRefund({
      logicalInvoiceId: activation.invoiceId,
      invoiceVersionId: activation.invoiceVersionId,
      chargeLineId: ordinaryLineId,
      refundQuantity: 1,
      method: "cash",
      reason: "leave only parking receivable",
      expectedRevision: state.revision,
      mutationId: "financial-parking-only-refund",
    }, frontdeskActor, store);
    expect(refund).toMatchObject({ receivableReductionJmd: 5_000, cashRefundJmd: 0 });

    const beforeRead = stateSnapshot(store);
    const model = closedFinancialModel(financialReadModel(orderId, store));
    expect(model.ledger).toMatchObject({
      invoiceTotalJmd: 12_500,
      receivableJmd: 7_500,
      receivableReductionJmd: 5_000,
      balanceJmd: 7_500,
      paymentStatus: "unpaid",
      settlementStatus: "due",
    });
    expect(model.gates.canCollectPayment).toBe(true);
    expect(model.gates.canRefund).toBe(true);
    expect(stateSnapshot(store)).toEqual(beforeRead);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("selector rejects a missing order and reads direct BO payment history", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const orderId = "qbo-financial-invalid-shared";
  await addSharedQuickOrder(store, orderId, [unit("financial-invalid-shared-line", 10_000)]);
  const valid = stateSnapshot(store);
  expectSelectorRejected("qbo-financial-missing", structuredClone(valid), /not found|missing|不存在|404/i);

  const payment = {
    id: "financial-invalid-shared-payment",
    amountJmd: 1,
    method: "cash",
    receivedBy: frontdeskActor.name,
    receivedAt: "2026-08-22T12:00:00-05:00",
  };
  const paymentPollution = structuredClone(valid);
  const paymentOrder = paymentPollution.quickOrders.find((candidate) => candidate.id === orderId);
  if (!paymentOrder) throw new Error("shared Quick BO missing");
  (paymentOrder as unknown as { payments: unknown[] }).payments = [structuredClone(payment)];
  const model = closedFinancialModel(financialReadModel(orderId, readOnlySelectorStore(paymentPollution)));
  expect(model.ledger).toMatchObject({ grossPaidJmd: 1, netPaidJmd: 1, hasPaymentHistory: true });
});

test("selector rejects duplicate, wrong-contract, wrong-owner, and broken effective Invoice ownership", async () => {
  const orderId = "qbo-financial-invalid-owner";
  const uninvoicedStore = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(uninvoicedStore, orderId, [unit("financial-invalid-owner-line", 10_000)]);

  const canonicalStore = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(canonicalStore, orderId, [unit("financial-invalid-owner-line", 10_000)]);
  let state = stateSnapshot(canonicalStore);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "financial-invalid-owner-activate",
  }, frontdeskActor, canonicalStore);
  const canonical = stateSnapshot(canonicalStore);
  const owner = canonical.invoices.find((candidate) => candidate.id === activation.invoiceId);
  if (!owner || owner.invoiceContract !== "shared_v1") throw new Error("canonical Invoice fixture missing");

  const duplicate = structuredClone(canonical);
  (duplicate.invoices as unknown as Array<Record<string, unknown>>).push({
    ...structuredClone(owner),
    id: `${owner.id}-duplicate`,
    invoiceNo: `${owner.invoiceNo}-DUP`,
  });
  expectSelectorRejected(orderId, duplicate, /duplicate|multiple|owner|重复|多个|归属/i);

  const sameIdDisplacedAlias = structuredClone(canonical);
  (sameIdDisplacedAlias.invoices as unknown as Array<Record<string, unknown>>).push({
    ...structuredClone(owner),
    businessOrderId: "demo-v2-provisional",
  });
  expectSelectorRejected(orderId, sameIdDisplacedAlias, /duplicate|multiple|owner|alias|重复|多个|归属/i);

  const missingEffective = structuredClone(canonical);
  const missingOwner = missingEffective.invoices.find((candidate) => candidate.id === owner.id);
  if (!missingOwner || missingOwner.invoiceContract !== "shared_v1") throw new Error("canonical owner missing");
  (missingOwner as unknown as { financiallyEffectiveVersionId: string }).financiallyEffectiveVersionId = "missing-version";
  expectSelectorRejected(orderId, missingEffective, /effective|version|生效|版本/i);

  const forgedLegacyVersionContract = structuredClone(canonical);
  const forgedOwner = forgedLegacyVersionContract.invoices.find((candidate) => candidate.id === owner.id);
  if (!forgedOwner || forgedOwner.invoiceContract !== "shared_v1") throw new Error("canonical owner missing");
  const forgedVersion = forgedOwner.versions.find(
    (candidate) => candidate.id === forgedOwner.financiallyEffectiveVersionId,
  );
  if (!forgedVersion) throw new Error("canonical effective version missing");
  const forgedVersionRecord = forgedVersion as unknown as Record<string, unknown>;
  Reflect.deleteProperty(forgedVersionRecord, "chargeContract");
  forgedVersionRecord.totals = {
    laborJmd: 20_000,
    partsJmd: 0,
    otherServiceJmd: 0,
    adjustmentsJmd: 0,
    totalJmd: 20_000,
  };
  expectSelectorRejected(orderId, forgedLegacyVersionContract, /contract|shared|version|合同|版本/i);

  const wrongSnapshotSource = structuredClone(canonical);
  const snapshotOwner = wrongSnapshotSource.invoices.find((candidate) => candidate.id === owner.id);
  if (!snapshotOwner || snapshotOwner.invoiceContract !== "shared_v1") throw new Error("canonical owner missing");
  const effective = snapshotOwner.versions.find((candidate) => candidate.id === snapshotOwner.financiallyEffectiveVersionId);
  if (!effective) throw new Error("effective version missing");
  (effective.snapshot as unknown as { sourceBusinessOrderId: string }).sourceBusinessOrderId = "demo-v2-provisional";
  expectSelectorRejected(orderId, wrongSnapshotSource, /source|owner|businessOrder|来源|归属/i);

  const wrongOwner = structuredClone(canonical);
  const displacedOwner = wrongOwner.invoices.find((candidate) => candidate.id === owner.id);
  if (!displacedOwner || displacedOwner.invoiceContract !== "shared_v1") throw new Error("canonical owner missing");
  (displacedOwner as unknown as { businessOrderId: string }).businessOrderId = "demo-v2-provisional";
  expectSelectorRejected(orderId, wrongOwner, /source|owner|businessOrder|来源|归属/i);
});

test("financial read-model assertion rejects extra, hidden, symbol, missing, undefined, and accessor fields at every layer", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const orderId = "qbo-financial-closed-model";
  await addSharedQuickOrder(store, orderId, [unit("financial-closed-model-line", 10_000)]);
  const base = financialReadModel(orderId, store);
  await expect(assertFinancialReadModel(base)).resolves.toBeUndefined();

  const mutations: ReadonlyArray<{
    label: string;
    mutate: (value: Record<string, unknown>) => void;
  }> = [
    {
      label: "top extra",
      mutate: (value) => { value.unexpected = true; },
    },
    {
      label: "top required undefined",
      mutate: (value) => { value.revision = undefined; },
    },
    {
      label: "order extra",
      mutate: (value) => {
        (value.order as Record<string, unknown>).unexpected = true;
      },
    },
    {
      label: "source hidden extra",
      mutate: (value) => {
        Object.defineProperty(value.source as object, "hidden", { configurable: true, value: true });
      },
    },
    {
      label: "ledger missing required",
      mutate: (value) => {
        Reflect.deleteProperty(value.ledger as object, "receivableJmd");
      },
    },
    {
      label: "ledger accessor",
      mutate: (value) => {
        Object.defineProperty(value.ledger as object, "receivableJmd", {
          configurable: true,
          enumerable: true,
          get: () => 10_000,
        });
      },
    },
    {
      label: "gates symbol",
      mutate: (value) => {
        Reflect.set(value.gates as object, Symbol("unexpected"), true);
      },
    },
  ];

  for (const mutation of mutations) {
    const mutant = structuredClone(base) as Record<string, unknown>;
    mutation.mutate(mutant);
    await expect(assertFinancialReadModel(mutant), mutation.label)
      .rejects.toThrow(/field|key|shape|unexpected|undefined|accessor|字段|访问器|格式/i);
  }

});

test("financial read-model assertion rejects invalid values, broken conservation, status drift, source drift, and contradictory gates", async () => {
  const base = canonicalSemanticModel();
  await expect(assertFinancialReadModel(base)).resolves.toBeUndefined();

  const zeroAmountPaymentHistory = structuredClone(base) as Record<string, unknown>;
  Object.assign(zeroAmountPaymentHistory.ledger as Record<string, unknown>, {
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    netPaidJmd: 0,
    balanceJmd: 10_000,
    paymentStatus: "unpaid",
    settlementStatus: "due",
    hasPaymentHistory: true,
  });
  Object.assign(zeroAmountPaymentHistory.gates as Record<string, unknown>, {
    canCollectPayment: true,
    canRefund: true,
    canVoid: false,
  });
  await expect(assertFinancialReadModel(zeroAmountPaymentHistory)).resolves.toBeUndefined();
  const mutations: ReadonlyArray<{
    label: string;
    mutate: (value: Record<string, unknown>) => void;
  }> = [
    { label: "negative revision", mutate: (value) => { value.revision = -1; } },
    { label: "fractional revision", mutate: (value) => { value.revision = 1.5; } },
    { label: "empty order id", mutate: (value) => { (value.order as Record<string, unknown>).id = ""; } },
    { label: "wrong order status", mutate: (value) => { (value.order as Record<string, unknown>).status = "done"; } },
    { label: "wrong nullable coordinate", mutate: (value) => { (value.order as Record<string, unknown>).pickedUpAt = 123; } },
    { label: "unknown source kind", mutate: (value) => { (value.source as Record<string, unknown>).kind = "legacy"; } },
    { label: "zero version", mutate: (value) => { (value.source as Record<string, unknown>).versionNo = 0; } },
    { label: "bad commitment", mutate: (value) => { (value.source as Record<string, unknown>).snapshotCommitment = "sha256-bad"; } },
    { label: "canonical null invoice total", mutate: (value) => { (value.ledger as Record<string, unknown>).invoiceTotalJmd = null; } },
    { label: "negative money", mutate: (value) => { (value.ledger as Record<string, unknown>).grossPaidJmd = -1; } },
    { label: "fractional money", mutate: (value) => { (value.ledger as Record<string, unknown>).receivableJmd = 10_000.5; } },
    { label: "broken net paid", mutate: (value) => { (value.ledger as Record<string, unknown>).netPaidJmd = 3_999; } },
    { label: "broken balance", mutate: (value) => { (value.ledger as Record<string, unknown>).balanceJmd = 5_999; } },
    { label: "payment status drift", mutate: (value) => { (value.ledger as Record<string, unknown>).paymentStatus = "paid"; } },
    { label: "settlement status drift", mutate: (value) => { (value.ledger as Record<string, unknown>).settlementStatus = "settled"; } },
    { label: "payment history drift", mutate: (value) => { (value.ledger as Record<string, unknown>).hasPaymentHistory = false; } },
    { label: "canonical due collect disabled", mutate: (value) => { (value.gates as Record<string, unknown>).canCollectPayment = false; } },
    { label: "canonical due record paid full", mutate: (value) => { (value.gates as Record<string, unknown>).canRecordPaidFull = true; } },
    { label: "completed without pickup or settlement", mutate: (value) => { (value.gates as Record<string, unknown>).completed = true; } },
    { label: "cancel without marker", mutate: (value) => { (value.gates as Record<string, unknown>).canCancelPaidFull = true; } },
    {
      label: "voided action gate",
      mutate: (value) => {
        (value.order as Record<string, unknown>).voidedAt = "2026-08-22T12:00:00-05:00";
        (value.gates as Record<string, unknown>).canRefund = true;
      },
    },
  ];

  for (const mutation of mutations) {
    const mutant = structuredClone(base) as Record<string, unknown>;
    mutation.mutate(mutant);
    await expect(assertFinancialReadModel(mutant), mutation.label)
      .rejects.toThrow(/invalid|must|field|source|status|conservation|gate|commitment|无效|字段|守恒|门槛/i);
  }

  const sharedRecord = canonicalSemanticModel();
  sharedRecord.source = { kind: "shared_uninvoiced" };
  (sharedRecord.ledger as Record<string, unknown>).invoiceTotalJmd = null;
  (sharedRecord.ledger as Record<string, unknown>).grossPaidJmd = 0;
  (sharedRecord.ledger as Record<string, unknown>).netPaidJmd = 0;
  (sharedRecord.ledger as Record<string, unknown>).balanceJmd = 10_000;
  (sharedRecord.ledger as Record<string, unknown>).paymentStatus = "unpaid";
  (sharedRecord.ledger as Record<string, unknown>).hasPaymentHistory = false;
  (sharedRecord.gates as Record<string, unknown>).canCollectPayment = false;
  (sharedRecord.gates as Record<string, unknown>).canRefund = false;
  (sharedRecord.gates as Record<string, unknown>).canVoid = true;
  (sharedRecord.gates as Record<string, unknown>).canRecordPaidFull = true;
  await expect(assertFinancialReadModel(sharedRecord)).rejects.toThrow(/shared|record|paid|gate|付清|门槛/i);
});

test("financial read-model assertion rejects source discriminant accessors without executing them", async () => {
  const mutant = canonicalSemanticModel();
  let getterCalls = 0;
  Object.defineProperty(mutant.source as object, "kind", {
    configurable: true,
    enumerable: true,
    get: () => {
      getterCalls += 1;
      throw new Error("source.kind getter must not execute");
    },
  });

  await expect(assertFinancialReadModel(mutant))
    .rejects.toThrow(/field|accessor|字段|访问器/i);
  expect(getterCalls).toBe(0);
});

test("canonical selector stays on V1 when the mutable BO changes and advances only after a real V2 activation", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const orderId = "qbo-financial-version-fence";
  await addSharedQuickOrder(store, orderId, [unit("financial-version-line", 10_000)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "financial-version-fence-v1",
  }, frontdeskActor, store);

  await store.mutate((draft) => {
    const orderIndex = draft.quickOrders.findIndex((candidate) => candidate.id === orderId);
    const order = draft.quickOrders[orderIndex];
    if (!order || order.chargeContract !== "shared_v1") throw new Error("shared Quick BO missing");
    draft.quickOrders[orderIndex] = {
      ...order,
      chargeLines: [unit("financial-version-line", 20_000)],
    };
    draft.revision += 1;
  }, { action: "test.quick-financial-v2-source.write", consumeWriteFault: false });

  state = stateSnapshot(store);
  const beforeV2 = closedFinancialModel(financialReadModel(orderId, store));
  expect(beforeV2.result.revision).toBe(state.revision);
  expect(beforeV2.source).toEqual({
    kind: "canonical_invoice",
    invoiceId: v1.invoiceId,
    invoiceNo: v1.invoiceNo,
    effectiveVersionId: v1.invoiceVersionId,
    versionNo: 1,
    snapshotCommitment: v1.snapshotCommitment,
  });
  expect(beforeV2.ledger).toMatchObject({
    invoiceTotalJmd: 10_000,
    receivableJmd: 10_000,
    balanceJmd: 10_000,
  });

  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "financial-version-fence-v2",
  }, frontdeskActor, store);
  const afterV2State = stateSnapshot(store);
  const afterV2 = closedFinancialModel(financialReadModel(orderId, store));
  expect(afterV2.result.revision).toBe(afterV2State.revision);
  expect(afterV2.source).toEqual({
    kind: "canonical_invoice",
    invoiceId: v2.invoiceId,
    invoiceNo: v2.invoiceNo,
    effectiveVersionId: v2.invoiceVersionId,
    versionNo: 2,
    snapshotCommitment: v2.snapshotCommitment,
  });
  expect(afterV2.ledger).toMatchObject({
    invoiceTotalJmd: 20_000,
    receivableJmd: 20_000,
    balanceJmd: 20_000,
  });

  const staleEffective = structuredClone(afterV2State);
  const staleOwner = staleEffective.invoices.find((candidate) => candidate.id === v2.invoiceId);
  if (!staleOwner || staleOwner.invoiceContract !== "shared_v1") throw new Error("canonical owner missing");
  (staleOwner as unknown as { financiallyEffectiveVersionId: string }).financiallyEffectiveVersionId = v1.invoiceVersionId;
  expectSelectorRejected(orderId, staleEffective, /effective|latest|version|生效|最新|版本/i);
});

test("linked Invoice summary separates receivable reduction from cash refund and keeps paidJmd as net paid", async () => {
  const probe = probedMemoryStorage();
  const store = createMockLinkedOperationsStore(probe.storage);
  const orderId = "qbo-financial-summary-refund";
  await addSharedQuickOrder(store, orderId, [
    unit("financial-summary-retained", 10_000),
    unit("financial-summary-refunded", 5_000),
  ]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "financial-summary-activate",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    chargeLineId: "financial-summary-refunded",
    refundQuantity: 1,
    method: "cash",
    reason: "selector receivable reduction",
    expectedRevision: state.revision,
    mutationId: "financial-summary-refund",
  }, frontdeskActor, store);
  expect(refund).toMatchObject({ receivableReductionJmd: 5_000, cashRefundJmd: 0 });

  state = stateSnapshot(store);
  const invoice = state.invoices.find((candidate) => candidate.id === activation.invoiceId);
  if (!invoice) throw new Error("activated Invoice missing");
  const summary = deriveLinkedInvoiceFinancialSummary(state, invoice);
  expect(summary).toMatchObject({
    invoiceTotalJmd: 15_000,
    receivableJmd: 10_000,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 5_000,
    netPaidJmd: 0,
    paidJmd: 0,
    balanceJmd: 10_000,
    paymentStatus: "unpaid",
    settlementStatus: "due",
    hasPaymentHistory: false,
  });
  expect(summary.paidJmd).toBe(summary.netPaidJmd);

  const model = closedFinancialModel(financialReadModel(orderId, store));
  expect(model.ledger).toEqual({
    invoiceTotalJmd: 15_000,
    receivableJmd: 10_000,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 5_000,
    netPaidJmd: 0,
    balanceJmd: 10_000,
    paymentStatus: "unpaid",
    settlementStatus: "due",
    hasPaymentHistory: false,
  });
  expect(model.gates.canRefund).toBe(true);
  expect(model.gates.canVoid).toBe(true);
  const beforeVoid = stateSnapshot(store);
  probe.operations.length = 0;
  const voided = await applyLifecycleAction(
    store,
    orderId,
    { kind: "void", reason: "refund-only canonical remains voidable" },
    frontdeskActor,
  );
  expect(voided.voidedAt).not.toBeNull();
  expect(voided.voidReason).toBe("refund-only canonical remains voidable");
  const afterVoid = stateSnapshot(store);
  expect(afterVoid.revision).toBe(beforeVoid.revision + 1);
  expect(probe.operations).toHaveLength(1);
});

test("canonical payment history survives a full cash refund even when net paid returns to zero", async () => {
  const probe = probedMemoryStorage();
  const store = createMockLinkedOperationsStore(probe.storage);
  const orderId = "qbo-financial-cash-refund-history";
  await addSharedQuickOrder(store, orderId, [unit("financial-cash-refund-line", 5_000)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "financial-cash-refund-activate",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "financial-cash-refund-payment",
    amountJmd: 5_000,
    method: "cash",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    chargeLineId: "financial-cash-refund-line",
    refundQuantity: 1,
    method: "cash",
    reason: "full cash refund history fence",
    expectedRevision: state.revision,
    mutationId: "financial-cash-refund-refund",
  }, frontdeskActor, store);
  expect(refund).toMatchObject({ receivableReductionJmd: 5_000, cashRefundJmd: 5_000 });

  const beforeRead = stateSnapshot(store);
  const model = closedFinancialModel(financialReadModel(orderId, store));
  expect(model.ledger).toEqual({
    invoiceTotalJmd: 5_000,
    receivableJmd: 0,
    grossPaidJmd: 5_000,
    cashRefundedJmd: 5_000,
    receivableReductionJmd: 5_000,
    netPaidJmd: 0,
    balanceJmd: 0,
    paymentStatus: "unpaid",
    settlementStatus: "settled",
    hasPaymentHistory: true,
  });
  expect(model.gates.canVoid).toBe(false);
  expect(model.gates.canRecordPaidFull).toBe(false);
  expect(model.gates.canRefund).toBe(true);
  expect(model.gates.canCollectPayment).toBe(false);
  expect(stateSnapshot(store)).toEqual(beforeRead);
  await expectActionRejectedWithoutWrite(
    store,
    probe.operations,
    orderId,
    { kind: "void", reason: "canonical payment history survives refund" },
    /payment|付款|退款|作废/i,
  );
  await expectActionRejectedWithoutWrite(
    store,
    probe.operations,
    orderId,
    { kind: "record_paid_full" },
    /paid|settled|付清|余额/i,
  );
});

test("shared uninvoiced and canonical due or overpaid BOs reject manual paid-full without a write", async () => {
  const dueProbe = probedMemoryStorage();
  const dueStore = createMockLinkedOperationsStore(dueProbe.storage);
  const dueOrderId = "qbo-paid-full-due";
  await addSharedQuickOrder(dueStore, dueOrderId, [unit("paid-full-due-line", 10_000)]);
  await expectActionRejectedWithoutWrite(
    dueStore,
    dueProbe.operations,
    dueOrderId,
    { kind: "record_paid_full" },
    /Invoice|invoice|paid|settled|shared|付清|未开票|余额/i,
  );
  let state = stateSnapshot(dueStore);
  await activateMockQuickInvoiceSnapshot({
    orderId: dueOrderId,
    expectedRevision: state.revision,
    mutationId: "paid-full-due-activation",
  }, frontdeskActor, dueStore);
  await expectActionRejectedWithoutWrite(
    dueStore,
    dueProbe.operations,
    dueOrderId,
    { kind: "record_paid_full" },
    /paid|settled|付清|余额/i,
  );

  const overpaidProbe = probedMemoryStorage();
  const overpaidStore = createMockLinkedOperationsStore(overpaidProbe.storage);
  const overpaidOrderId = "qbo-paid-full-overpaid";
  await addSharedQuickOrder(overpaidStore, overpaidOrderId, [unit("paid-full-overpaid-line", 20_000)]);
  state = stateSnapshot(overpaidStore);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId: overpaidOrderId,
    expectedRevision: state.revision,
    mutationId: "paid-full-overpaid-v1",
  }, frontdeskActor, overpaidStore);
  state = stateSnapshot(overpaidStore);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "paid-full-overpaid-payment",
    amountJmd: 20_000,
    method: "cash",
  }, frontdeskActor, overpaidStore);
  await overpaidStore.mutate((draft) => {
    const orderIndex = draft.quickOrders.findIndex((candidate) => candidate.id === overpaidOrderId);
    const order = draft.quickOrders[orderIndex];
    if (!order || order.chargeContract !== "shared_v1") throw new Error("shared Quick BO missing");
    draft.quickOrders[orderIndex] = {
      ...order,
      chargeLines: [unit("paid-full-overpaid-line", 10_000)],
    };
    draft.revision += 1;
  }, { action: "test.quick-financial-overpaid-source.write", consumeWriteFault: false });
  state = stateSnapshot(overpaidStore);
  await activateMockQuickInvoiceSnapshot({
    orderId: overpaidOrderId,
    expectedRevision: state.revision,
    mutationId: "paid-full-overpaid-v2",
  }, frontdeskActor, overpaidStore);
  const overpaidModel = closedFinancialModel(financialReadModel(overpaidOrderId, overpaidStore));
  expect(overpaidModel.ledger.settlementStatus).toBe("overpaid");
  expect(overpaidModel.gates.canCollectPayment).toBe(false);
  await expectActionRejectedWithoutWrite(
    overpaidStore,
    overpaidProbe.operations,
    overpaidOrderId,
    { kind: "record_paid_full" },
    /overpaid|paid|settled|多收|付清|余额/i,
  );
});

test("canonical exact settlement permits paid-full once, but a V2 increase reopens completion until the stale marker is cancelled", async () => {
  const probe = probedMemoryStorage();
  const store = createMockLinkedOperationsStore(probe.storage);
  const orderId = "qbo-paid-full-v2-reopen";
  await addSharedQuickOrder(store, orderId, [unit("paid-full-v2-line", 10_000)]);
  await installHistoricalCompletionCoordinate(store, orderId, "pickup");
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "paid-full-v2-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: v1.invoiceId,
    expectedRevision: state.revision,
    mutationId: "paid-full-v2-payment",
    amountJmd: 10_000,
    method: "cash",
  }, frontdeskActor, store);

  const beforeRecord = stateSnapshot(store);
  probe.operations.length = 0;
  const recorded = await applyLifecycleAction(store, orderId, { kind: "record_paid_full" });
  const afterRecord = stateSnapshot(store);
  expect(recorded.paidInFullAt).not.toBeNull();
  expect(recorded.paidInFullBy).toBe(frontdeskActor.name);
  expect(afterRecord.revision).toBe(beforeRecord.revision + 1);
  expect(afterRecord.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory)
    .toHaveLength((beforeRecord.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory.length ?? 0) + 1);
  expect(probe.operations).toHaveLength(1);
  let model = closedFinancialModel(financialReadModel(orderId, store));
  expect(model.ledger).toMatchObject({ paymentStatus: "paid", settlementStatus: "settled" });
  expect(model.gates).toMatchObject({
    canCollectPayment: false,
    canRecordPaidFull: false,
    canCancelPaidFull: true,
    completed: true,
  });

  await store.mutate((draft) => {
    const orderIndex = draft.quickOrders.findIndex((candidate) => candidate.id === orderId);
    const order = draft.quickOrders[orderIndex];
    if (!order || order.chargeContract !== "shared_v1") throw new Error("shared Quick BO missing");
    draft.quickOrders[orderIndex] = {
      ...order,
      chargeLines: [unit("paid-full-v2-line", 20_000)],
    };
    draft.revision += 1;
  }, { action: "test.quick-financial-paid-full-v2-source.write", consumeWriteFault: false });
  state = stateSnapshot(store);
  await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "paid-full-v2-activate-v2",
  }, frontdeskActor, store);
  model = closedFinancialModel(financialReadModel(orderId, store));
  expect(model.ledger).toMatchObject({
    invoiceTotalJmd: 20_000,
    receivableJmd: 20_000,
    netPaidJmd: 10_000,
    balanceJmd: 10_000,
    paymentStatus: "partially_paid",
    settlementStatus: "due",
  });
  expect(model.order.paidInFullAt).not.toBeNull();
  expect(model.gates).toMatchObject({
    canRecordPaidFull: false,
    canCancelPaidFull: true,
    completed: false,
  });

  const beforeCancel = stateSnapshot(store);
  probe.operations.length = 0;
  const cancelled = await applyLifecycleAction(store, orderId, { kind: "cancel_paid_full" });
  const afterCancel = stateSnapshot(store);
  expect(cancelled.paidInFullAt).toBeNull();
  expect(cancelled.paidInFullBy).toBeNull();
  expect(afterCancel.revision).toBe(beforeCancel.revision + 1);
  expect(afterCancel.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory)
    .toHaveLength((beforeCancel.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory.length ?? 0) + 1);
  expect(probe.operations).toHaveLength(1);
});

test("shared uninvoiced BO without payment history can be voided by the superadmin", async () => {
  const probe = probedMemoryStorage();
  const store = createMockLinkedOperationsStore(probe.storage);
  const orderId = "qbo-financial-shared-void";
  await addSharedQuickOrder(store, orderId, [unit("financial-shared-void-line", 10_000)]);
  const before = stateSnapshot(store);
  probe.operations.length = 0;
  const result = await applyLifecycleAction(
    store,
    orderId,
    { kind: "void", reason: "no payment history" },
    frontdeskActor,
  );
  const after = stateSnapshot(store);
  expect(result.voidedAt).not.toBeNull();
  expect(result.voidedBy).toBe(frontdeskActor.name);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory)
    .toHaveLength((before.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory.length ?? 0) + 1);
  expect(probe.operations).toHaveLength(1);
  const voidedModel = closedFinancialModel(financialReadModel(orderId, store));
  expect(voidedModel.gates).toEqual({
    canCollectPayment: false,
    canRefund: false,
    canVoid: false,
    canRecordPaidFull: false,
    canCancelPaidFull: false,
    completed: false,
  });
});

test("cancel paid-full remains a correction for shared uninvoiced and canonical due BOs", async () => {
  for (const mode of ["shared_uninvoiced", "canonical_due"] as const) {
    const probe = probedMemoryStorage();
    const store = createMockLinkedOperationsStore(probe.storage);
    const orderId = `qbo-cancel-paid-full-${mode}`;
    await addSharedQuickOrder(store, orderId, [unit(`cancel-paid-full-${mode}-line`, 10_000)]);
    if (mode === "canonical_due") {
      const state = stateSnapshot(store);
      await activateMockQuickInvoiceSnapshot({
        orderId,
        expectedRevision: state.revision,
        mutationId: `cancel-paid-full-${mode}-activate`,
      }, frontdeskActor, store);
    }
    await installHistoricalCompletionCoordinate(store, orderId, "paid_full");
    const before = stateSnapshot(store);
    probe.operations.length = 0;
    const cancelled = await applyLifecycleAction(store, orderId, { kind: "cancel_paid_full" });
    const after = stateSnapshot(store);
    expect(cancelled.paidInFullAt, mode).toBeNull();
    expect(cancelled.paidInFullBy, mode).toBeNull();
    expect(after.revision, mode).toBe(before.revision + 1);
    expect(after.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory, mode)
      .toHaveLength((before.quickOrders.find((candidate) => candidate.id === orderId)?.statusHistory.length ?? 0) + 1);
    expect(probe.operations, mode).toHaveLength(1);
  }
});

test("cancel paid-full rejects missing marker, non-submitted status, and voided BO without a write", async () => {
  const missingProbe = probedMemoryStorage();
  const missingStore = createMockLinkedOperationsStore(missingProbe.storage);
  const missingId = "qbo-cancel-paid-full-missing";
  await addSharedQuickOrder(missingStore, missingId, [unit("cancel-paid-full-missing-line", 10_000)]);
  await expectActionRejectedWithoutWrite(
    missingStore,
    missingProbe.operations,
    missingId,
    { kind: "cancel_paid_full" },
    /not recorded|missing|未记录|未付清|可撤销付清/i,
  );

  const statusProbe = probedMemoryStorage();
  const statusStore = createMockLinkedOperationsStore(statusProbe.storage);
  const statusId = "qbo-cancel-paid-full-status";
  await addSharedQuickOrder(statusStore, statusId, [unit("cancel-paid-full-status-line", 10_000)]);
  Object.defineProperty(statusStore, "nowMs", {
    configurable: true,
    value: () => Date.parse("2026-07-21T12:00:00-05:00"),
  });
  await applyMockQuickOrderAction(
    statusId,
    { kind: "unsubmit", reason: "cancel gate status" },
    frontdeskActor.name,
    "frontdesk",
    statusStore,
  );
  await installHistoricalCompletionCoordinate(statusStore, statusId, "paid_full");
  await expectActionRejectedWithoutWrite(
    statusStore,
    statusProbe.operations,
    statusId,
    { kind: "cancel_paid_full" },
    /submitted|已交单/i,
  );

  const voidProbe = probedMemoryStorage();
  const voidStore = createMockLinkedOperationsStore(voidProbe.storage);
  const voidId = "qbo-cancel-paid-full-voided";
  await addSharedQuickOrder(voidStore, voidId, [unit("cancel-paid-full-voided-line", 10_000)]);
  await installHistoricalCompletionCoordinate(voidStore, voidId, "paid_full");
  await applyLifecycleAction(voidStore, voidId, { kind: "void", reason: "voided cancel gate" });
  await expectActionRejectedWithoutWrite(
    voidStore,
    voidProbe.operations,
    voidId,
    { kind: "cancel_paid_full" },
    /voided|已废除|作废|可撤销付清/i,
  );
});

test("void rejects the whole cascade when an after-sales child has canonical payment history", async () => {
  const probe = probedMemoryStorage();
  const store = createMockLinkedOperationsStore(probe.storage);
  const parentId = "qbo-void-cascade-parent-paid-child";
  const childId = "qbo-void-cascade-paid-child";
  await addSharedQuickOrder(store, parentId, [unit("void-cascade-parent-line", 5_000)]);
  await addSharedQuickOrder(store, childId, [unit("void-cascade-child-line", 5_000)]);
  await linkAfterSalesChild(store, parentId, childId);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId: childId,
    expectedRevision: state.revision,
    mutationId: "void-cascade-paid-child-activate",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "void-cascade-paid-child-payment",
    amountJmd: 1_000,
    method: "cash",
  }, frontdeskActor, store);

  const parentModel = closedFinancialModel(financialReadModel(parentId, store));
  expect(parentModel.ledger.hasPaymentHistory).toBe(false);
  expect(parentModel.gates.canVoid).toBe(false);
  await expectActionRejectedWithoutWrite(
    store,
    probe.operations,
    parentId,
    { kind: "void", reason: "paid child blocks the full cascade" },
    /child|cascade|payment|关联|付款|作废/i,
  );
});

test("void commits an unpaid parent and all unpaid children once with one timestamp and canonical cascade reasons", async () => {
  const probe = probedMemoryStorage();
  const store = createMockLinkedOperationsStore(probe.storage);
  const parentId = "qbo-void-cascade-unpaid-parent";
  const childIds = ["qbo-void-cascade-unpaid-child-a", "qbo-void-cascade-unpaid-child-b"] as const;
  await addSharedQuickOrder(store, parentId, [unit("void-cascade-unpaid-parent-line", 5_000)]);
  for (const childId of childIds) {
    await addSharedQuickOrder(store, childId, [unit(`${childId}-line`, 1_000)]);
    await linkAfterSalesChild(store, parentId, childId);
  }
  const before = stateSnapshot(store);
  const parentBefore = before.quickOrders.find((candidate) => candidate.id === parentId);
  if (!parentBefore) throw new Error("cascade parent missing");
  probe.operations.length = 0;
  await applyLifecycleAction(store, parentId, { kind: "void", reason: "retire unpaid family" });
  const after = stateSnapshot(store);
  const parentAfter = after.quickOrders.find((candidate) => candidate.id === parentId);
  if (!parentAfter) throw new Error("cascade parent missing after void");
  expect(parentAfter.voidedAt).not.toBeNull();
  expect(parentAfter.voidReason).toBe("retire unpaid family");
  expect(parentAfter.statusHistory).toHaveLength(parentBefore.statusHistory.length + 1);
  for (const childId of childIds) {
    const childBefore = before.quickOrders.find((candidate) => candidate.id === childId);
    const childAfter = after.quickOrders.find((candidate) => candidate.id === childId);
    if (!childBefore || !childAfter) throw new Error("cascade child missing");
    expect(childAfter.voidedAt, childId).toBe(parentAfter.voidedAt);
    expect(childAfter.voidedBy, childId).toBe(frontdeskActor.name);
    expect(childAfter.voidReason, childId).toBe(`关联单废除（原单 ${parentBefore.businessOrderNo}）`);
    expect(childAfter.statusHistory, childId).toHaveLength(childBefore.statusHistory.length + 1);
    expect(childAfter.statusHistory.at(-1)?.at, childId).toBe(parentAfter.voidedAt);
  }
  expect(after.revision).toBe(before.revision + 1);
  expect(probe.operations).toHaveLength(1);
});
