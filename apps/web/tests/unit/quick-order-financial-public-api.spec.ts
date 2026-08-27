import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import { ensureMockCleanMoneyDemo } from "../../src/lib/api/mock-clean-demo";
import {
  createMockLinkedOperationsStore,
  getMockLinkedOperationsStore,
  LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY,
  LINKED_OPERATIONS_STORAGE_KEY,
  type LinkedOperationsState,
  type MockLinkedOperationsStore,
} from "../../src/lib/api/mock-orders";
import * as financialContract from "../../src/lib/billing/quick-order-financial";
import * as quickOrderDomain from "../../src/lib/api/mock-quick-orders";
import type { QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";

interface MemoryStorage extends Storage {
  readonly values: Map<string, string>;
  readonly reads: string[];
  readonly operations: Array<Readonly<{
    kind: "set" | "remove" | "clear";
    key?: string;
    value?: string;
  }>>;
}

function memoryStorage(values = new Map<string, string>()): MemoryStorage {
  const operations: MemoryStorage["operations"] = [];
  const reads: string[] = [];
  return {
    values,
    reads,
    operations,
    get length() { return values.size; },
    clear() {
      operations.push({ kind: "clear" });
      values.clear();
    },
    getItem: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      operations.push({ kind: "remove", key });
      values.delete(key);
    },
    setItem: (key, value) => {
      operations.push({ kind: "set", key, value });
      values.set(key, value);
    },
  };
}

const superadminSession = {
  identity: { id: "emp-001", name: "超级管理员", role: "superadmin" },
};
const frontdeskSession = {
  identity: { id: "test-frontdesk", name: "测试前台", role: "frontdesk_admin" },
};
const financeSession = {
  identity: { id: "test-finance", name: "测试财务", role: "finance" },
};
const partsSession = {
  identity: { id: "test-parts", name: "测试配件员", role: "parts" },
};
const mechanicSession = {
  identity: { id: "test-mechanic", name: "测试维修工", role: "mechanic" },
};
const frontdeskActor = {
  id: "emp-001",
  name: "超级管理员",
  role: "superadmin" as const,
};

const opaqueFinancialOrderIds = [
  { orderId: ".", segment: "u002e" },
  { orderId: "..", segment: "u002e002e" },
  {
    orderId: "qbo/%2F ?#测试",
    segment: "u00710062006f002f0025003200460020003f00236d4b8bd5",
  },
  { orderId: "qbo-\uD800", segment: "u00710062006f002dd800" },
] as const;

function installBrowser(
  storage: Storage,
  scenario: Record<string, unknown> = {},
): () => void {
  storage.setItem("wh_session", JSON.stringify(superadminSession));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario,
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

const unit = (
  id: string,
  unitPriceJmd: number,
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
  quantity: 1,
  unitPriceJmd,
  unitDiscountJmd: 0,
  pendingQuote: false,
});

async function addSharedQuickOrder(
  store: MockLinkedOperationsStore,
  orderId: string,
  amountJmd: number,
): Promise<void> {
  await store.mutate((state) => {
    const base = state.quickOrders[0];
    if (!base) throw new Error("seed Quick BO missing");
    state.quickOrders.push({
      ...structuredClone(base),
      id: orderId,
      businessOrderNo: `KGN-WH-${orderId.toUpperCase()}`,
      createdAt: "2026-07-01T08:00:00-05:00",
      teamId: "test-repair-team",
      mechanicName: "测试维修班组",
      assignedAt: "2026-07-01T08:10:00-05:00",
      acceptedAt: "2026-07-01T08:20:00-05:00",
      returnedAt: "2026-07-01T08:50:00-05:00",
      submittedAt: "2026-07-01T09:00:00-05:00",
      submittedBy: "超级管理员",
      status: "submitted",
      statusHistory: [
        { id: `${orderId}-ev-1`, from: null, to: "pending_assign", by: "超级管理员", byRole: "frontdesk", at: "2026-07-01T08:00:00-05:00" },
        { id: `${orderId}-ev-2`, from: "returned", to: "submitted", by: "超级管理员", byRole: "frontdesk", at: "2026-07-01T09:00:00-05:00", roundNumber: 1, teamId: "test-repair-team", performanceValueJmd: base.performanceValueJmd },
      ],
      items: [],
      chargeContract: "shared_v1",
      chargeLines: [unit(`${orderId}-labor`, amountJmd)],
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
  }, { action: "test.quick-financial-public-source.write", consumeWriteFault: false });
}

function stateSnapshot(store: MockLinkedOperationsStore): LinkedOperationsState {
  return store.read((state) => state, "test.quick-financial-public.snapshot");
}

type FinancialApiSurface = Readonly<{
  list(): Promise<unknown>;
  detail(orderId: string): Promise<unknown>;
}>;

type RawMockClientModule = typeof import("../../src/lib/api/client") & {
  __rawMockRequest<T>(path: string, options?: RequestInit): Promise<T>;
};

function loadClientWithRawMockRequest(): RawMockClientModule {
  const fs = require("node:fs") as typeof import("node:fs");
  const NodeModule = require("node:module") as typeof import("node:module");
  const typescript = require("typescript") as typeof import("typescript");
  const modulePath = require.resolve("../../src/lib/api/client");
  const source = `${fs.readFileSync(modulePath, "utf8")}\nexport { mockRequest as __rawMockRequest };\n`;
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  }).outputText;
  const loaded = new NodeModule.Module(modulePath, module);
  loaded.filename = modulePath;
  loaded.paths = module.paths;
  (loaded as typeof loaded & { _compile(content: string, filename: string): void })
    ._compile(compiled, modulePath);
  return loaded.exports as RawMockClientModule;
}

function financialApiSurface(candidate: unknown = api): FinancialApiSurface {
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("api.quickOrderFinancials is missing");
  }
  const surface = Reflect.get(candidate, "quickOrderFinancials");
  if (surface === null || typeof surface !== "object") {
    throw new Error("api.quickOrderFinancials is missing");
  }
  const list = Reflect.get(surface, "list");
  const detail = Reflect.get(surface, "detail");
  if (typeof list !== "function" || typeof detail !== "function") {
    throw new Error("api.quickOrderFinancials list/detail contract is missing");
  }
  return {
    list: () => Reflect.apply(list, surface, []) as Promise<unknown>,
    detail: (orderId) => Reflect.apply(detail, surface, [orderId]) as Promise<unknown>,
  };
}

function financialDomainList(store: MockLinkedOperationsStore): unknown {
  const selector = Reflect.get(quickOrderDomain, "listMockQuickOrderFinancialReadModels");
  if (typeof selector !== "function") {
    throw new Error("listMockQuickOrderFinancialReadModels is missing");
  }
  return Reflect.apply(selector, quickOrderDomain, [store]);
}

function assertFinancialListResponse(value: unknown): void {
  const assertion = Reflect.get(financialContract, "assertQuickOrderFinancialListResponse");
  if (typeof assertion !== "function") {
    throw new Error("assertQuickOrderFinancialListResponse is missing");
  }
  Reflect.apply(assertion, financialContract, [value]);
}

function financialDetailDomain(orderId: string, store: MockLinkedOperationsStore): unknown {
  const selector = Reflect.get(quickOrderDomain, "getMockQuickOrderFinancialReadModel");
  if (typeof selector !== "function") throw new Error("getMockQuickOrderFinancialReadModel is missing");
  return Reflect.apply(selector, quickOrderDomain, [orderId, store]);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  expect(value, label).not.toBeNull();
  expect(typeof value, label).toBe("object");
  expect(Array.isArray(value), label).toBe(false);
  return value as Record<string, unknown>;
}

function exactDataKeys(
  value: unknown,
  expected: ReadonlyArray<string>,
  label: string,
): Record<string, unknown> {
  const record = asRecord(value, label);
  const ownKeys = Reflect.ownKeys(record);
  expect(ownKeys.every((key) => typeof key === "string"), `${label} own keys must all be strings`).toBe(true);
  expect(ownKeys.filter((key): key is string => typeof key === "string").sort(), `${label} own keys`)
    .toEqual([...expected].sort());
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    expect(descriptor, `${label}.${key}`).toMatchObject({ enumerable: true });
    expect(descriptor && "value" in descriptor, `${label}.${key} data property`).toBe(true);
    expect(descriptor && "value" in descriptor ? descriptor.value : undefined, `${label}.${key}`).not.toBeUndefined();
  }
  return record;
}

function parkingKeyOperations(storage: MemoryStorage): MemoryStorage["operations"] {
  return storage.operations.filter((operation) => (
    operation.kind === "clear"
    || operation.key === LINKED_OPERATIONS_STORAGE_KEY
    || operation.key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

function parkingKeyReads(storage: MemoryStorage): string[] {
  return storage.reads.filter((key) => (
    key === LINKED_OPERATIONS_STORAGE_KEY
    || key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

async function prepareThreeSourceStore(
  storage: MemoryStorage,
): Promise<Readonly<{
  store: MockLinkedOperationsStore;
  uninvoicedOrderId: string;
  canonicalOrderId: string;
  canonicalInvoiceId: string;
  canonicalVersionId: string;
}>> {
  const store = getMockLinkedOperationsStore();
  await store.ready();
  const uninvoicedOrderId = "qbo-financial-public-uninvoiced";
  const canonicalOrderId = "qbo-financial-public-canonical";
  await addSharedQuickOrder(store, uninvoicedOrderId, 7_000);
  await addSharedQuickOrder(store, canonicalOrderId, 10_000);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId: canonicalOrderId,
    expectedRevision: state.revision,
    mutationId: "quick-financial-public-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "quick-financial-public-pay-v1",
    amountJmd: 4_000,
    method: "cash",
  }, frontdeskActor, store);
  storage.operations.length = 0;
  return {
    store,
    uninvoicedOrderId,
    canonicalOrderId,
    canonicalInvoiceId: activation.invoiceId,
    canonicalVersionId: activation.invoiceVersionId,
  };
}

test("public QuickOrder financial list and detail expose both current authoritative sources", async () => {
  const storage = memoryStorage();
  const restore = installBrowser(storage, {
    nowMs: Date.parse("2026-08-22T12:00:00-05:00"),
  });
  try {
    const prepared = await prepareThreeSourceStore(storage);
    const before = stateSnapshot(prepared.store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const surface = financialApiSurface();
    const response = exactDataKeys(await surface.list(), ["revision", "items"], "financial list response");
    expect(response.revision).toBe(before.revision);
    expect(Array.isArray(response.items)).toBe(true);
    const items = response.items as ReadonlyArray<Record<string, unknown>>;
    expect(items.map((item) => asRecord(item.order, "financial item order").id))
      .toEqual(before.quickOrders.map((order) => order.id));
    expect(new Set(items.map((item) => asRecord(item.order, "financial item order").id)).size)
      .toBe(items.length);
    expect(items.every((item) => item.revision === response.revision)).toBe(true);
    expect(items.map((item) => asRecord(item.source, "financial item source").kind))
      .toEqual(expect.arrayContaining(["shared_uninvoiced", "canonical_invoice"]));

    const detail = exactDataKeys(
      await surface.detail(prepared.canonicalOrderId),
      ["contract", "revision", "order", "source", "ledger", "gates"],
      "financial detail response",
    );
    expect(detail.revision).toBe(before.revision);
    expect(detail.order).toMatchObject({ id: prepared.canonicalOrderId });
    expect(detail.source).toEqual(expect.objectContaining({
      kind: "canonical_invoice",
      invoiceId: prepared.canonicalInvoiceId,
      effectiveVersionId: prepared.canonicalVersionId,
    }));
    expect(detail.ledger).toEqual(expect.objectContaining({
      invoiceTotalJmd: 10_000,
      grossPaidJmd: 4_000,
      netPaidJmd: 4_000,
      balanceJmd: 6_000,
    }));
    expect(stateSnapshot(prepared.store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
    expect(parkingKeyOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("financial list derives one ordered dense response from one state read and one clock read", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  await store.ready();
  await addSharedQuickOrder(store, "qbo-financial-public-one-snapshot", 3_000);
  const before = stateSnapshot(store);
  let readCalls = 0;
  let nowCalls = 0;
  const countedStore: MockLinkedOperationsStore = {
    ...store,
    read: <T>(selector: (state: LinkedOperationsState) => T, action?: string): T => {
      readCalls += 1;
      return store.read(selector, action);
    },
    nowMs: () => {
      nowCalls += 1;
      return store.nowMs();
    },
  };

  const response = exactDataKeys(
    financialDomainList(countedStore),
    ["revision", "items"],
    "domain financial list response",
  );
  expect(readCalls).toBe(1);
  expect(nowCalls).toBe(1);
  expect(response.revision).toBe(before.revision);
  expect(Array.isArray(response.items)).toBe(true);
  const items = response.items as ReadonlyArray<Record<string, unknown>>;
  expect(items.length).toBe(before.quickOrders.length);
  expect(items.map((item) => asRecord(item.order, "financial item order").id))
    .toEqual(before.quickOrders.map((order) => order.id));
  expect(Object.keys(items)).toEqual(before.quickOrders.map((_, index) => String(index)));
  expect(items.every((item) => item.revision === before.revision)).toBe(true);
  expect(stateSnapshot(store)).toEqual(before);

  const frozenFirstResponse = structuredClone(response);
  const changedOrderId = before.quickOrders[0]!.id;
  const changedBusinessOrderNo = `${before.quickOrders[0]!.businessOrderNo}-UPDATED`;
  await store.mutate((draft) => {
    const index = draft.quickOrders.findIndex((order) => order.id === changedOrderId);
    const order = draft.quickOrders[index];
    if (!order) throw new Error("financial list mutation target missing");
    draft.quickOrders[index] = { ...order, businessOrderNo: changedBusinessOrderNo };
    draft.revision += 1;
  }, { action: "test.quick-financial-public-next-snapshot.write", consumeWriteFault: false });
  expect(response).toEqual(frozenFirstResponse);

  readCalls = 0;
  nowCalls = 0;
  const nextResponse = exactDataKeys(
    financialDomainList(countedStore),
    ["revision", "items"],
    "next domain financial list response",
  );
  expect(readCalls).toBe(1);
  expect(nowCalls).toBe(1);
  expect(nextResponse.revision).toBe(before.revision + 1);
  const nextItems = nextResponse.items as Array<Record<string, unknown>>;
  expect(nextItems.every((item) => item.revision === nextResponse.revision)).toBe(true);
  expect(nextItems.map((item) => asRecord(item.order, "next financial order").id))
    .toEqual(before.quickOrders.map((order) => order.id));
  for (let index = 0; index < items.length; index += 1) {
    const expected = structuredClone(items[index]!);
    expected.revision = before.revision + 1;
    if (asRecord(expected.order, "expected next financial order").id === changedOrderId) {
      asRecord(expected.order, "expected next financial order").businessOrderNo = changedBusinessOrderNo;
    }
    expect(nextItems[index]).toEqual(expected);
  }

  const handedState = structuredClone(before);
  const frozenBusinessOrderNo = handedState.quickOrders[0]!.businessOrderNo;
  const mutationSensitiveStore: MockLinkedOperationsStore = {
    ...store,
    read: <T>(selector: (state: LinkedOperationsState) => T): T => {
      const result = selector(handedState);
      handedState.revision += 1;
      Object.assign(handedState.quickOrders[0]!, {
        businessOrderNo: "POST_SELECTOR_MUTATION",
      });
      return result;
    },
    nowMs: () => Date.parse("2026-08-22T12:00:00-05:00"),
  };
  const frozenRead = asRecord(financialDomainList(mutationSensitiveStore), "mutation-sensitive financial list");
  expect(frozenRead.revision).toBe(before.revision);
  const frozenItems = frozenRead.items as Array<Record<string, unknown>>;
  expect(frozenItems.every((item) => item.revision === before.revision)).toBe(true);
  expect(asRecord(frozenItems[0]!.order, "frozen financial order").businessOrderNo)
    .toBe(frozenBusinessOrderNo);
});

test("financial list and detail bind authorized reads to invocation and response sessions without P or Q writes", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: { delayMs?: { byAction: Record<string, number> } } = {};
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await ensureMockCleanMoneyDemo(store);
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const calls = [
      {
        name: "list",
        action: "quickOrders.financial.list.read",
        invoke: () => financialApiSurface().list(),
      },
      {
        name: "detail",
        action: "quickOrders.financial.detail.read",
        invoke: () => financialApiSurface().detail("demo-v2-partial"),
      },
    ] as const;

    for (const call of calls) {
      storage.setItem("wh_session", JSON.stringify(superadminSession));
      scenario.delayMs = undefined;
      storage.operations.length = 0;
      const invocation = Promise.resolve().then(call.invoke);
      await new Promise((resolve) => setTimeout(resolve, 50));
      storage.setItem("wh_session", JSON.stringify(frontdeskSession));
      await expect(invocation, `${call.name} invocation fence`).rejects.toMatchObject({ status: 403 });
      expect(stateSnapshot(store)).toEqual(before);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
      expect(parkingKeyOperations(storage)).toEqual([]);

      storage.setItem("wh_session", JSON.stringify(superadminSession));
      scenario.delayMs = { byAction: { [call.action]: 1_000 } };
      storage.operations.length = 0;
      const response = Promise.resolve().then(call.invoke);
      await new Promise((resolve) => setTimeout(resolve, 650));
      storage.setItem("wh_session", JSON.stringify(frontdeskSession));
      await expect(response, `${call.name} response fence`).rejects.toMatchObject({ status: 403 });
      expect(stateSnapshot(store)).toEqual(before);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
      expect(parkingKeyOperations(storage)).toEqual([]);
    }

    for (const call of calls) {
      storage.setItem("wh_session", JSON.stringify(superadminSession));
      scenario.delayMs = undefined;
      storage.operations.length = 0;
      const originalRead = store.read;
      store.read = <T>(selector: (state: LinkedOperationsState) => T, action?: string): T => {
        if (action !== call.action) return originalRead(selector, action);
        storage.setItem("wh_session", JSON.stringify(frontdeskSession));
        try {
          return originalRead(selector, action);
        } finally {
          storage.setItem("wh_session", JSON.stringify(superadminSession));
        }
      };
      try {
        await expect(
          Promise.resolve().then(call.invoke),
          `${call.name} locked selector fence`,
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        store.read = originalRead;
      }
      expect(stateSnapshot(store)).toEqual(before);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
      expect(parkingKeyOperations(storage)).toEqual([]);
    }
  } finally {
    restore();
  }
});

test("financial list and detail preserve the raw Quick steady-state authorization matrix without writes", async () => {
  test.setTimeout(30_000);
  const storage = memoryStorage();
  const restore = installBrowser(storage);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await ensureMockCleanMoneyDemo(store);
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const invokeBoth = () => [
      () => financialApiSurface().list(),
      () => financialApiSurface().detail("demo-v2-partial"),
    ];

    for (const allowed of [superadminSession, financeSession, frontdeskSession]) {
      storage.setItem("wh_session", JSON.stringify(allowed));
      storage.operations.length = 0;
      for (const invoke of invokeBoth()) {
        await expect(Promise.resolve().then(invoke)).resolves.toBeDefined();
      }
      expect(stateSnapshot(store)).toEqual(before);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
      expect(parkingKeyOperations(storage)).toEqual([]);
    }

    const deniedSessions: ReadonlyArray<Readonly<{
      name: string;
      install(): void;
    }>> = [
      {
        name: "parts",
        install: () => storage.setItem("wh_session", JSON.stringify(partsSession)),
      },
      {
        name: "mechanic",
        install: () => storage.setItem("wh_session", JSON.stringify(mechanicSession)),
      },
      {
        name: "anonymous",
        install: () => storage.removeItem("wh_session"),
      },
      {
        name: "malformed",
        install: () => storage.setItem("wh_session", "{MALFORMED_SESSION_SENTINEL"),
      },
    ];
    for (const denied of deniedSessions) {
      denied.install();
      storage.operations.length = 0;
      for (const invoke of invokeBoth()) {
        await expect(Promise.resolve().then(invoke), denied.name)
          .rejects.toMatchObject({ status: 403 });
      }
      expect(stateSnapshot(store)).toEqual(before);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
      expect(parkingKeyOperations(storage)).toEqual([]);
    }
  } finally {
    restore();
  }
});

test("financial list validator rejects non-closed wrappers, sparse arrays, duplicate coordinates, and one invalid item", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const state = stateSnapshot(store);
  const first = financialDetailDomain(state.quickOrders[0]!.id, store);
  const second = financialDetailDomain(state.quickOrders[1]!.id, store);
  const valid = {
    revision: state.revision,
    items: [first, second],
  };
  expect(() => assertFinancialListResponse(structuredClone(valid))).not.toThrow();

  const mutants: Array<Readonly<{ name: string; mutate(value: Record<string, unknown>): void }>> = [
    {
      name: "wrapper extra field",
      mutate: (value) => { value.unexpected = "WRAPPER_EXTRA_SENTINEL"; },
    },
    {
      name: "wrapper undefined required field",
      mutate: (value) => { value.revision = undefined; },
    },
    {
      name: "wrapper non-enumerable field",
      mutate: (value) => { Object.defineProperty(value, "hidden", { value: "HIDDEN_SENTINEL" }); },
    },
    {
      name: "wrapper symbol field",
      mutate: (value) => { Object.defineProperty(value, Symbol("sentinel"), { value: true, enumerable: true }); },
    },
    {
      name: "wrapper custom prototype",
      mutate: (value) => { Object.setPrototypeOf(value, { inheritedSentinel: true }); },
    },
    {
      name: "items is not an array",
      mutate: (value) => { value.items = { 0: structuredClone(first), length: 1 }; },
    },
    {
      name: "sparse items array",
      mutate: (value) => { Reflect.deleteProperty(value.items as unknown[], "0"); },
    },
    {
      name: "array expando",
      mutate: (value) => { Object.defineProperty(value.items, "extra", { value: true, enumerable: true }); },
    },
    {
      name: "array non-enumerable expando",
      mutate: (value) => { Object.defineProperty(value.items, "hidden", { value: true }); },
    },
    {
      name: "array symbol expando",
      mutate: (value) => { Object.defineProperty(value.items, Symbol("sentinel"), { value: true, enumerable: true }); },
    },
    {
      name: "item revision differs from wrapper",
      mutate: (value) => {
        (value.items as Array<Record<string, unknown>>)[1]!.revision = state.revision + 1;
      },
    },
    {
      name: "duplicate order id",
      mutate: (value) => {
        const items = value.items as Array<Record<string, unknown>>;
        const firstOrder = items[0]!.order as Record<string, unknown>;
        const secondOrder = items[1]!.order as Record<string, unknown>;
        secondOrder.id = firstOrder.id;
      },
    },
    {
      name: "one semantically invalid item invalidates the whole response",
      mutate: (value) => {
        const item = (value.items as Array<Record<string, unknown>>)[1]!;
        const ledger = item.ledger as Record<string, unknown>;
        ledger.balanceJmd = Number(ledger.balanceJmd) + 1;
      },
    },
  ];

  for (const mutant of mutants) {
    const value = structuredClone(valid) as Record<string, unknown>;
    mutant.mutate(value);
    expect(() => assertFinancialListResponse(value), mutant.name).toThrow();
  }

  let indexGetterCalls = 0;
  const accessorItems = [structuredClone(first), structuredClone(second)];
  Object.defineProperty(accessorItems, "0", {
    configurable: true,
    enumerable: true,
    get() {
      indexGetterCalls += 1;
      throw new Error("ITEM_INDEX_GETTER_SENTINEL");
    },
  });
  expect(() => assertFinancialListResponse({ revision: state.revision, items: accessorItems })).toThrow();
  expect(indexGetterCalls).toBe(0);

  let wrapperGetterCalls = 0;
  const accessorWrapper = {
    revision: state.revision,
    items: structuredClone(valid.items),
  };
  Object.defineProperty(accessorWrapper, "revision", {
    configurable: true,
    enumerable: true,
    get() {
      wrapperGetterCalls += 1;
      throw new Error("WRAPPER_GETTER_SENTINEL");
    },
  });
  expect(() => assertFinancialListResponse(accessorWrapper)).toThrow();
  expect(wrapperGetterCalls).toBe(0);

  let itemsGetterCalls = 0;
  const itemsAccessorWrapper = { revision: state.revision, items: structuredClone(valid.items) };
  Object.defineProperty(itemsAccessorWrapper, "items", {
    configurable: true,
    enumerable: true,
    get() {
      itemsGetterCalls += 1;
      throw new Error("ITEMS_GETTER_SENTINEL");
    },
  });
  expect(() => assertFinancialListResponse(itemsAccessorWrapper)).toThrow();
  expect(itemsGetterCalls).toBe(0);
});

test("public financial reads are detached and never add canonical money facts to raw Quick DTOs", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const restore = installBrowser(storage, {
    nowMs: Date.parse("2026-08-22T12:00:00-05:00"),
  });
  try {
    const prepared = await prepareThreeSourceStore(storage);
    const before = stateSnapshot(prepared.store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const rawList = await api.quickOrders.list();
    const rawDetail = await api.quickOrders.detail(prepared.canonicalOrderId);
    const rawOrder = rawList.find((order) => order.id === prepared.canonicalOrderId);
    expect(rawOrder).toEqual(rawDetail);
    expect(rawOrder?.payments).toEqual([]);
    expect(rawOrder?.refunds).toEqual([]);
    for (const forbidden of [
      "source", "ledger", "gates", "invoiceId", "effectiveVersionId", "snapshotCommitment",
    ]) {
      expect(Reflect.ownKeys(rawOrder ?? {})).not.toContain(forbidden);
    }
    expect(JSON.stringify(rawOrder)).not.toContain(prepared.canonicalInvoiceId);
    expect(JSON.stringify(rawOrder)).not.toContain(prepared.canonicalVersionId);

    const surface = financialApiSurface();
    const firstList = asRecord(await surface.list(), "first financial list");
    const firstItems = firstList.items as Array<Record<string, unknown>>;
    const firstCanonical = firstItems.find((item) => (
      asRecord(item.order, "first financial order").id === prepared.canonicalOrderId
    ));
    if (!firstCanonical) throw new Error("canonical public financial item missing");
    (firstCanonical.order as Record<string, unknown>).businessOrderNo = "MUTATED_PUBLIC_COPY";
    (firstCanonical.ledger as Record<string, unknown>).balanceJmd = -99;
    (firstCanonical.gates as Record<string, unknown>).canVoid = true;

    const secondList = asRecord(await surface.list(), "second financial list");
    const secondCanonical = (secondList.items as Array<Record<string, unknown>>).find((item) => (
      asRecord(item.order, "second financial order").id === prepared.canonicalOrderId
    ));
    expect(secondCanonical).toBeDefined();
    expect(secondCanonical?.order).toEqual(expect.objectContaining({
      id: prepared.canonicalOrderId,
      businessOrderNo: expect.not.stringContaining("MUTATED_PUBLIC_COPY"),
    }));
    expect(secondCanonical?.ledger).toEqual(expect.objectContaining({ balanceJmd: 6_000 }));
    expect(secondCanonical?.gates).toEqual(expect.objectContaining({ canVoid: false }));
    expect(stateSnapshot(prepared.store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
    expect(parkingKeyOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("public financial detail returns 404 for an unknown order without writes", async () => {
  const storage = memoryStorage();
  const restore = installBrowser(storage);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await ensureMockCleanMoneyDemo(store);
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    storage.operations.length = 0;
    await expect(Promise.resolve().then(() => (
      financialApiSurface().detail("qbo-financial-public-missing")
    ))).rejects.toMatchObject({ status: 404 });
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
    expect(parkingKeyOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("mock financial detail round-trips opaque order ids without dot-segment or Unicode path confusion", async () => {
  test.setTimeout(15_000);
  const storage = memoryStorage();
  const restore = installBrowser(storage);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    for (const [index, { orderId }] of opaqueFinancialOrderIds.entries()) {
      await addSharedQuickOrder(store, orderId, 1_000 + index);
    }
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    storage.operations.length = 0;
    for (const { orderId } of opaqueFinancialOrderIds) {
      const detail = asRecord(
        await financialApiSurface().detail(orderId),
        `opaque mock financial detail ${JSON.stringify(orderId)}`,
      );
      expect(detail.order).toEqual(expect.objectContaining({ id: orderId }));
    }
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
    expect(parkingKeyOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("raw mock financial detail rejects every non-opaque segment before changing linked storage", async () => {
  test.setTimeout(15_000);
  const storage = memoryStorage();
  const restore = installBrowser(storage);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const rawClient = loadClientWithRawMockRequest();
    storage.reads.length = 0;
    storage.operations.length = 0;
    const invalidPaths = [
      ...["u", "u002", "u002g", "plain-id", ".", ".."]
        .map((segment) => `/api/quick-order-financials/${segment}`),
      "/api/quick-order-financials\\u002e",
      "/api\\quick-order-financials\\u002e",
      "/api\\quick-order-financials",
    ];
    for (const path of invalidPaths) {
      await expect(
        rawClient.__rawMockRequest(path),
        `invalid raw financial route ${path}`,
      ).rejects.toMatchObject({ status: 400 });
    }
    const readsDuringRequests = parkingKeyReads(storage);
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
    expect(readsDuringRequests).toEqual([]);
    expect(parkingKeyOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("real-fetch financial client validates list and opaque detail URLs without path normalization", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const state = stateSnapshot(store);
  const baseModel = structuredClone(financialDetailDomain(state.quickOrders[0]!.id, store)) as Record<string, unknown>;
  const detailModels = opaqueFinancialOrderIds.map(({ orderId }) => {
    const model = structuredClone(baseModel);
    (model.order as Record<string, unknown>).id = orderId;
    return model;
  });
  const validList = { revision: state.revision, items: [structuredClone(baseModel)] };

  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  const requests: string[] = [];
  const responses: unknown[] = [validList, ...detailModels];
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    delete require.cache[modulePath];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(String(input));
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      const body = responses.shift();
      if (body === undefined) throw new Error("unexpected real-fetch financial request");
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    const surface = financialApiSurface(realClient.api);
    await expect(surface.list()).resolves.toEqual(validList);
    for (const [index, { orderId }] of opaqueFinancialOrderIds.entries()) {
      await expect(surface.detail(orderId)).resolves.toEqual(detailModels[index]);
    }
    expect(requests).toEqual([
      "/api/quick-order-financials",
      ...opaqueFinancialOrderIds.map(({ segment }) => `/api/quick-order-financials/${segment}`),
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUseMock === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_USE_MOCK");
    else process.env.NEXT_PUBLIC_USE_MOCK = previousUseMock;
    if (previousApiBase === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_API_BASE_URL");
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBase;
    delete require.cache[modulePath];
  }
});

test("real-fetch financial client maps invalid 2xx payloads to sanitized 502 errors", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const state = stateSnapshot(store);
  const baseModel = structuredClone(financialDetailDomain(state.quickOrders[0]!.id, store)) as Record<string, unknown>;
  const sentinel = "PRIVATE_FINANCIAL_PAYLOAD_SENTINEL";
  const invalidList = {
    revision: state.revision,
    items: [structuredClone(baseModel)],
    privateEvidence: sentinel,
  };
  const invalidDetail = structuredClone(baseModel);
  (invalidDetail.ledger as Record<string, unknown>).balanceJmd = sentinel;
  const crossContractPayload = {
    customers: [{
      verificationArchive: {
        kycRecords: [{
          subjectType: "organization_primary_contact",
          subjectProfile: `DRIVER_LICENSE_PROFILE_INVALID_${sentinel}`,
        }],
      },
    }],
  };
  const dotSegmentPayload = { privateEvidence: sentinel };

  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  const responses: Array<Readonly<{ body: string; contentType: string }>> = [
    { body: JSON.stringify(invalidList), contentType: "application/json" },
    { body: JSON.stringify(invalidDetail), contentType: "application/json" },
    { body: `not-json-list-${sentinel}`, contentType: "text/plain" },
    { body: `not-json-detail-${sentinel}`, contentType: "text/plain" },
    { body: JSON.stringify(crossContractPayload), contentType: "application/json" },
    { body: JSON.stringify(crossContractPayload), contentType: "application/json" },
    { body: JSON.stringify(dotSegmentPayload), contentType: "application/json" },
    { body: JSON.stringify(dotSegmentPayload), contentType: "application/json" },
  ];
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    delete require.cache[modulePath];
    globalThis.fetch = (async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected invalid financial fetch");
      return new Response(response.body, {
        status: 200,
        headers: { "Content-Type": response.contentType },
      });
    }) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    const surface = financialApiSurface(realClient.api);
    for (const invoke of [
      () => surface.list(),
      () => surface.detail("qbo-0001"),
      () => surface.list(),
      () => surface.detail("qbo-0001"),
      () => surface.list(),
      () => surface.detail("qbo-0001"),
      () => surface.detail("."),
      () => surface.detail(".."),
    ]) {
      let error: unknown;
      try {
        await invoke();
        throw new Error("invalid financial response unexpectedly succeeded");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(realClient.ApiError);
      expect(error).toMatchObject({
        status: 502,
        code: "QUICK_ORDER_FINANCIAL_RESPONSE_INVALID",
      });
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUseMock === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_USE_MOCK");
    else process.env.NEXT_PUBLIC_USE_MOCK = previousUseMock;
    if (previousApiBase === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_API_BASE_URL");
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBase;
    delete require.cache[modulePath];
  }
});
