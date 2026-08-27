import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoiceLineRefund,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import {
  createLinkedOperationsMutationCoordinator,
  createMockLinkedOperationsStore,
  getMockLinkedOperationsStore,
  LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY,
  LINKED_OPERATIONS_STORAGE_KEY,
  validateLinkedOperationsState,
  type LinkedMutationReceipt,
  type LinkedOperationsState,
  type MockLinkedOperationsStore,
} from "../../src/lib/api/mock-orders";
import * as financialContract from "../../src/lib/billing/quick-order-financial";
import type { QuickOrderFinancialReadModel } from "../../src/lib/billing/quick-order-financial";
import * as quickOrderDomain from "../../src/lib/api/mock-quick-orders";
import type {
  QuickBoStatusEvent,
  QuickOrder,
  QuickOrderChargeLine,
} from "../../src/lib/orders/quick-order-types";

type LifecycleKind = "void" | "restore" | "record_paid_full" | "cancel_paid_full";
type LifecycleInput = Readonly<{
  contract: "quick_order_lifecycle_mutation_v1";
  kind: LifecycleKind;
  orderId: string;
  expectedRevision: number;
  mutationId: string;
  reason?: string;
}>;
type LifecyclePreflight = Readonly<{
  contract: "quick_order_lifecycle_preflight_v1";
  revision: number;
  orderId: string;
  allowedKinds: ReadonlyArray<LifecycleKind>;
}>;
type LifecycleActor = Readonly<{
  id: string;
  name: string;
  role: "superadmin" | "frontdesk_admin" | "finance" | "mechanic";
}>;

type StorageRead = Readonly<{ key: string }>;
type StorageWrite = Readonly<{ key: string; value: string }>;

interface MemoryStorage extends Storage {
  readonly values: Map<string, string>;
  readonly reads: StorageRead[];
  readonly writes: StorageWrite[];
  readonly removals: string[];
  clearCalls: number;
}

interface LifecycleScenario {
  nowMs: number;
  failNext: { byAction: Record<string, string> };
  delayMs?: { byAction: Record<string, number> };
}

const superadminActor = { id: "emp-001", name: "超级管理员", role: "superadmin" } as const;
const financeActor = { id: "test-finance", name: "测试财务", role: "finance" } as const;
const frontdeskActor = superadminActor;
const mechanicActor = { id: "test-mechanic", name: "测试维修工", role: "mechanic" } as const;
const partsActor = { id: "test-parts", name: "测试配件员", role: "parts" } as const;

const FIXED_NOW_MS = Date.parse("2026-08-22T12:00:00-05:00");
const FIXED_COMMITTED_AT = new Date(FIXED_NOW_MS).toISOString();
const FIXED_HISTORY_AT = "2026-08-22T12:00:00-05:00";
const opaqueLifecycleOrderIds = [
  { orderId: ".", segment: "u002e" },
  { orderId: "..", segment: "u002e002e" },
  {
    orderId: "qbo/%2F ?#测试",
    segment: "u00710062006f002f0025003200460020003f00236d4b8bd5",
  },
  { orderId: "u002e", segment: "u00750030003000320065" },
  { orderId: "qbo-\uD800", segment: "u00710062006f002dd800" },
] as const;

function memoryStorage(values = new Map<string, string>()): MemoryStorage {
  const reads: StorageRead[] = [];
  const writes: StorageWrite[] = [];
  const removals: string[] = [];
  const storage: MemoryStorage = {
    values,
    reads,
    writes,
    removals,
    clearCalls: 0,
    get length() { return values.size; },
    clear() {
      storage.clearCalls += 1;
      values.clear();
    },
    getItem(key) {
      reads.push({ key });
      return values.get(key) ?? null;
    },
    key: (index) => [...values.keys()][index] ?? null,
    removeItem(key) {
      removals.push(key);
      values.delete(key);
    },
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return storage;
}

function resetStorageProbe(storage: MemoryStorage): void {
  storage.reads.length = 0;
  storage.writes.length = 0;
  storage.removals.length = 0;
  storage.clearCalls = 0;
}

function linkedKeyReads(storage: MemoryStorage): StorageRead[] {
  return storage.reads.filter(({ key }) => (
    key === LINKED_OPERATIONS_STORAGE_KEY
    || key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

function linkedKeyWrites(storage: MemoryStorage): StorageWrite[] {
  return storage.writes.filter(({ key }) => (
    key === LINKED_OPERATIONS_STORAGE_KEY
    || key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

function linkedKeyRemovals(storage: MemoryStorage): string[] {
  return storage.removals.filter((key) => (
    key === LINKED_OPERATIONS_STORAGE_KEY
    || key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

function expectNoLinkedWrites(storage: MemoryStorage): void {
  expect(linkedKeyWrites(storage)).toEqual([]);
  expect(linkedKeyRemovals(storage)).toEqual([]);
  expect(storage.clearCalls).toBe(0);
}

function installBrowser(
  storage: MemoryStorage,
  scenario: LifecycleScenario,
  actor: Readonly<{ id: string; name: string; role: string }> = superadminActor,
): () => void {
  storage.setItem("wh_session", JSON.stringify({ identity: actor }));
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
  amountJmd = 10_000,
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
      chargeLines: [unit(`${orderId}-line`, amountJmd)],
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
  }, { action: "test.quick-lifecycle-source.write", consumeWriteFault: false });
}

async function linkAfterSalesChild(
  store: MockLinkedOperationsStore,
  parentId: string,
  childId: string,
): Promise<void> {
  await store.mutate((state) => {
    const index = state.quickOrders.findIndex((order) => order.id === childId);
    const order = state.quickOrders[index];
    if (!order) throw new Error("lifecycle child missing");
    state.quickOrders[index] = {
      ...order,
      orderKind: "aftersales",
      linkedOrderId: parentId,
      performanceValueJmd: 0,
      statusHistory: order.statusHistory.map((event) => (
        event.from === "returned" && event.to === "submitted" && event.cancelledAt === undefined
          ? { ...event, performanceValueJmd: 0 }
          : event
      )),
    };
    state.revision += 1;
  }, { action: "test.quick-lifecycle-link-child.write", consumeWriteFault: false });
}

async function installPaidFullMarker(
  store: MockLinkedOperationsStore,
  orderId: string,
  actor: LifecycleActor = frontdeskActor,
): Promise<void> {
  await store.mutate((state) => {
    const index = state.quickOrders.findIndex((order) => order.id === orderId);
    const order = state.quickOrders[index];
    if (!order) throw new Error("lifecycle paid-full fixture missing");
    const event: QuickBoStatusEvent = {
      id: `${order.id}-ev-${order.statusHistory.length + 1}`,
      from: order.status,
      to: order.status,
      by: actor.name,
      byRole: actor.role === "mechanic" ? "mechanic" : "frontdesk",
      at: FIXED_HISTORY_AT,
      reason: "记录付完全款",
    };
    state.quickOrders[index] = {
      ...order,
      paidInFullAt: FIXED_HISTORY_AT,
      paidInFullBy: actor.name,
      statusHistory: [...order.statusHistory, event],
    };
    state.revision += 1;
  }, { action: "test.quick-lifecycle-paid-marker.write", consumeWriteFault: false });
}

async function installVoidFixture(
  store: MockLinkedOperationsStore,
  orderId: string,
  actor: LifecycleActor = frontdeskActor,
  at = FIXED_HISTORY_AT,
): Promise<void> {
  await store.mutate((state) => {
    const index = state.quickOrders.findIndex((order) => order.id === orderId);
    const order = state.quickOrders[index];
    if (!order) throw new Error("lifecycle void fixture missing");
    const event: QuickBoStatusEvent = {
      id: `${order.id}-ev-${order.statusHistory.length + 1}`,
      from: order.status,
      to: order.status,
      by: actor.name,
      byRole: actor.role === "mechanic" ? "mechanic" : "frontdesk",
      at,
      reason: "废除本单：fixture void",
    };
    state.quickOrders[index] = {
      ...order,
      voidedAt: at,
      voidedBy: actor.name,
      voidReason: "fixture void",
      statusHistory: [...order.statusHistory, event],
    };
    state.revision += 1;
  }, { action: "test.quick-lifecycle-void-fixture.write", consumeWriteFault: false });
}

async function settleCanonicalOrder(
  store: MockLinkedOperationsStore,
  orderId: string,
  amountJmd = 10_000,
): Promise<void> {
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: `${orderId}-activate-v1`,
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: `${orderId}-pay-v1`,
    amountJmd,
    method: "cash",
  }, frontdeskActor, store);
}

async function reopenCanonicalOrderWithV2(
  store: MockLinkedOperationsStore,
  orderId: string,
  addedAmountJmd = 5_000,
): Promise<void> {
  await store.mutate((state) => {
    const index = state.quickOrders.findIndex((order) => order.id === orderId);
    const order = state.quickOrders[index];
    if (!order || order.chargeContract !== "shared_v1" || !Array.isArray(order.chargeLines)) {
      throw new Error("lifecycle V2 source must be shared");
    }
    state.quickOrders[index] = {
      ...order,
      chargeLines: [...order.chargeLines, unit(`${orderId}-v2-line`, addedAmountJmd)],
    };
    state.revision += 1;
  }, { action: "test.quick-lifecycle-v2-source.write", consumeWriteFault: false });
  const state = stateSnapshot(store);
  await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: `${orderId}-activate-v2`,
  }, frontdeskActor, store);
}

async function prepareLifecycleTarget(
  store: MockLinkedOperationsStore,
  kind: LifecycleKind,
  orderId: string,
): Promise<void> {
  await addSharedQuickOrder(store, orderId, 10_000);
  if (kind === "restore") {
    await installVoidFixture(store, orderId);
  } else if (kind === "record_paid_full") {
    await settleCanonicalOrder(store, orderId, 10_000);
  } else if (kind === "cancel_paid_full") {
    await installPaidFullMarker(store, orderId);
  }
}

function stateSnapshot(store: MockLinkedOperationsStore): LinkedOperationsState {
  return store.read((state) => state, "test.quick-lifecycle.snapshot");
}

function lifecycleInput(
  kind: LifecycleKind,
  orderId: string,
  expectedRevision: number,
  mutationId: string,
  reason = "approved lifecycle void",
): LifecycleInput {
  return {
    contract: "quick_order_lifecycle_mutation_v1",
    kind,
    orderId,
    expectedRevision,
    mutationId,
    ...(kind === "void" ? { reason } : {}),
  };
}

function opaqueLifecycleSegment(orderId: string): string {
  let segment = "u";
  for (let index = 0; index < orderId.length; index += 1) {
    segment += orderId.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return segment;
}

function lifecycleSurface(candidate: unknown = api): Readonly<{
  preflight(orderId: string): Promise<unknown>;
  lifecycle(input: LifecycleInput): Promise<unknown>;
}> {
  if (!candidate || typeof candidate !== "object") throw new Error("api object is missing");
  const financial = Reflect.get(candidate, "quickOrderFinancials");
  if (!financial || typeof financial !== "object") throw new Error("api.quickOrderFinancials is missing");
  const lifecycle = Reflect.get(financial, "lifecycle");
  const preflight = Reflect.get(financial, "preflight");
  if (typeof lifecycle !== "function") throw new Error("api.quickOrderFinancials.lifecycle is missing");
  return {
    preflight: (orderId) => {
      if (typeof preflight !== "function") throw new Error("api.quickOrderFinancials.preflight is missing");
      return Reflect.apply(preflight, financial, [orderId]) as Promise<unknown>;
    },
    lifecycle: (input) => Reflect.apply(lifecycle, financial, [input]) as Promise<unknown>,
  };
}

function lifecycleDomain(
  input: unknown,
  actor: unknown,
  store: unknown,
  requestGuard?: () => void,
): Promise<unknown> {
  const producer = Reflect.get(quickOrderDomain, "recordMockQuickOrderLifecycleMutation");
  if (typeof producer !== "function") {
    throw new Error("recordMockQuickOrderLifecycleMutation is missing");
  }
  return Reflect.apply(producer, quickOrderDomain, [input, actor, store, requestGuard]) as Promise<unknown>;
}

function lifecycleContractAssertion(name: string, value: unknown): void {
  const modulePath = "../../src/lib/billing/" + "quick-order-lifecycle";
  let moduleNamespace: unknown;
  try {
    moduleNamespace = require(modulePath) as unknown;
  } catch {
    throw new Error("quick-order-lifecycle contract module is missing");
  }
  if (!moduleNamespace || typeof moduleNamespace !== "object") {
    throw new Error("quick-order-lifecycle contract module is invalid");
  }
  const assertion = Reflect.get(moduleNamespace, name);
  if (typeof assertion !== "function") throw new Error(`${name} is missing`);
  Reflect.apply(assertion, moduleNamespace, [value]);
}

function assertLifecycleMutationInput(value: unknown): void {
  lifecycleContractAssertion("assertQuickOrderLifecycleMutationInput", value);
}

function assertLifecycleMutationResult(value: unknown): void {
  lifecycleContractAssertion("assertQuickOrderLifecycleMutationResult", value);
}

function assertLifecyclePreflight(value: unknown): void {
  lifecycleContractAssertion("assertQuickOrderLifecyclePreflight", value);
}

function financialModel(orderId: string, store: MockLinkedOperationsStore): QuickOrderFinancialReadModel {
  const selector = Reflect.get(quickOrderDomain, "getMockQuickOrderFinancialReadModel");
  if (typeof selector !== "function") throw new Error("financial selector is missing");
  return Reflect.apply(selector, quickOrderDomain, [orderId, store]) as QuickOrderFinancialReadModel;
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
  expect(ownKeys.every((key) => typeof key === "string"), `${label} own keys`).toBe(true);
  expect(ownKeys.filter((key): key is string => typeof key === "string").sort(), `${label} own keys`)
    .toEqual([...expectedKeys].sort());
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    expect(descriptor, `${label}.${key}`).toMatchObject({ enumerable: true });
    expect(descriptor && "value" in descriptor, `${label}.${key} data property`).toBe(true);
    expect(descriptor && "value" in descriptor ? descriptor.value : undefined, `${label}.${key}`).not.toBeUndefined();
  }
  return record;
}

function closedDenseArray(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  const array = value as unknown[];
  expect(Object.getPrototypeOf(array), `${label} prototype`).toBe(Array.prototype);
  expect(Reflect.ownKeys(array)).toEqual([
    ...array.map((_, index) => String(index)),
    "length",
  ]);
  return array;
}

function closedLifecycleResult(
  value: unknown,
  expected: Readonly<{
    kind: LifecycleKind;
    orderId: string;
    revision: number;
    affectedOrderIds: ReadonlyArray<string>;
    committedAt?: string;
  }>,
): Record<string, unknown> {
  assertLifecycleMutationResult(value);
  const result = closedRecord(value, [
    "contract", "revision", "kind", "orderId", "affectedOrderIds", "committedAt",
  ], "lifecycle public result");
  expect(result).toMatchObject({
    contract: "quick_order_lifecycle_mutation_result_v2",
    revision: expected.revision,
    kind: expected.kind,
    orderId: expected.orderId,
    committedAt: expected.committedAt ?? FIXED_COMMITTED_AT,
  });
  expect(closedDenseArray(result.affectedOrderIds, "lifecycle affectedOrderIds"))
    .toEqual(expected.affectedOrderIds);
  expect(Reflect.ownKeys(result)).not.toContain("financial");
  expect(JSON.stringify(result)).not.toMatch(/ledger|source|grossPaidJmd|balanceJmd/u);
  return result;
}

function closedLifecyclePreflight(
  value: unknown,
  expected: Readonly<{
    revision: number;
    orderId: string;
    allowedKinds: ReadonlyArray<LifecycleKind>;
  }>,
): LifecyclePreflight {
  assertLifecyclePreflight(value);
  const result = closedRecord(value, [
    "contract", "revision", "orderId", "allowedKinds",
  ], "lifecycle preflight") as unknown as LifecyclePreflight;
  expect(result.contract).toBe("quick_order_lifecycle_preflight_v1");
  expect(result.revision).toBe(expected.revision);
  expect(result.orderId).toBe(expected.orderId);
  expect(closedDenseArray(result.allowedKinds, "lifecycle preflight allowedKinds"))
    .toEqual(expected.allowedKinds);
  expect(JSON.stringify(result)).not.toMatch(/ledger|source|financial|customer|vehicle|reason/u);
  return result;
}

function orderLifecycleCoordinate(order: QuickOrder): Record<string, unknown> {
  return {
    status: order.status,
    voidedAt: order.voidedAt,
    voidedBy: order.voidedBy,
    voidReason: order.voidReason,
    paidInFullAt: order.paidInFullAt,
    paidInFullBy: order.paidInFullBy,
  };
}

function receiptEvent(event: QuickBoStatusEvent): Record<string, unknown> {
  return {
    id: event.id,
    from: event.from,
    to: event.to,
    by: event.by,
    byRole: event.byRole,
    at: event.at,
    reason: event.reason ?? null,
  };
}

function lifecycleReceipt(
  before: LinkedOperationsState,
  after: LinkedOperationsState,
  input: LifecycleInput,
  actor: LifecycleActor,
  publicResult: unknown,
  affectedOrderIds: ReadonlyArray<string>,
  store: MockLinkedOperationsStore,
): LinkedMutationReceipt {
  const receipt = after.mutationReceipts.find((candidate) => candidate.mutationId === input.mutationId);
  if (!receipt) throw new Error(`lifecycle receipt missing: ${input.mutationId}`);
  closedRecord(receipt, [
    "id", "mutationId", "operation", "actorId", "payloadHash", "payloadCanonical",
    "result", "committedRevision", "committedAt",
  ], "lifecycle outer receipt");
  expect(receipt).toMatchObject({
    id: input.mutationId,
    mutationId: input.mutationId,
    operation: `quickOrders.lifecycle.${input.kind}`,
    actorId: actor.id,
    committedRevision: after.revision,
    committedAt: FIXED_COMMITTED_AT,
  });
  expect(JSON.parse(receipt.payloadCanonical!)).toEqual(input);
  const internal = closedRecord(receipt.result, [
    "receiptContract", "actor", "changes", "financialSnapshot", "publicResult",
  ], "lifecycle receipt result");
  expect(internal.receiptContract).toBe("quick_order_lifecycle_receipt_v2");
  expect(closedRecord(internal.actor, ["id", "name", "role"], "lifecycle receipt actor"))
    .toEqual(actor);
  expect(internal.publicResult).toEqual(publicResult);
  const financialAssertion = Reflect.get(financialContract, "assertQuickOrderFinancialReadModel");
  if (typeof financialAssertion !== "function") throw new Error("financial model assertion missing");
  Reflect.apply(financialAssertion, financialContract, [internal.financialSnapshot]);
  expect(internal.financialSnapshot).toEqual(financialModel(input.orderId, store));
  expect((internal.financialSnapshot as { revision?: unknown }).revision).toBe(after.revision);
  const changes = closedDenseArray(internal.changes, "lifecycle receipt changes");
  expect(changes).toHaveLength(affectedOrderIds.length);
  for (const [changeIndex, orderId] of affectedOrderIds.entries()) {
    const change = closedRecord(changes[changeIndex], ["orderId", "before", "after", "event"], `change ${orderId}`);
    expect(change.orderId).toBe(orderId);
    const beforeOrder = before.quickOrders.find((order) => order.id === orderId);
    const afterOrder = after.quickOrders.find((order) => order.id === orderId);
    if (!beforeOrder || !afterOrder) throw new Error(`affected Quick BO missing: ${orderId}`);
    expect(closedRecord(change.before, [
      "status", "voidedAt", "voidedBy", "voidReason", "paidInFullAt", "paidInFullBy",
    ], `change ${orderId} before`)).toEqual(orderLifecycleCoordinate(beforeOrder));
    expect(closedRecord(change.after, [
      "status", "voidedAt", "voidedBy", "voidReason", "paidInFullAt", "paidInFullBy",
    ], `change ${orderId} after`)).toEqual(orderLifecycleCoordinate(afterOrder));
    expect(afterOrder.statusHistory).toHaveLength(beforeOrder.statusHistory.length + 1);
    expect(closedRecord(change.event, ["id", "from", "to", "by", "byRole", "at", "reason"], `change ${orderId} event`))
      .toEqual(receiptEvent(afterOrder.statusHistory.at(-1)!));
  }
  return receipt;
}

function lifecyclePrivateFinancialSnapshot(
  state: LinkedOperationsState,
  mutationId: string,
): Record<string, unknown> {
  const receipt = state.mutationReceipts.find((candidate) => candidate.mutationId === mutationId);
  if (!receipt || !receipt.result || typeof receipt.result !== "object") {
    throw new Error(`private lifecycle receipt missing: ${mutationId}`);
  }
  const snapshot = (receipt.result as Record<string, unknown>).financialSnapshot;
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`private lifecycle financial snapshot missing: ${mutationId}`);
  }
  return snapshot as Record<string, unknown>;
}

async function expectPrivateLifecycleSnapshotRejectedByFreshReady(
  state: LinkedOperationsState,
  _storage: MemoryStorage,
  label: string,
): Promise<void> {
  const financialAssertion = Reflect.get(financialContract, "assertQuickOrderFinancialReadModel");
  if (typeof financialAssertion !== "function") throw new Error("financial model assertion missing");
  const lifecycleReceipt = state.mutationReceipts.find((receipt) => (
    receipt.operation.startsWith("quickOrders.lifecycle.")
      && receipt.result !== null
      && typeof receipt.result === "object"
      && Object.prototype.hasOwnProperty.call(receipt.result, "financialSnapshot")
  ));
  if (!lifecycleReceipt) throw new Error(`${label} lifecycle receipt missing`);
  const financialSnapshot = (lifecycleReceipt.result as Record<string, unknown>).financialSnapshot;
  expect(
    () => Reflect.apply(financialAssertion, financialContract, [financialSnapshot]),
    `${label} must remain core-financial valid`,
  ).not.toThrow();
  expect(() => validateLinkedOperationsState(state), label).toThrow();
}

async function commitCanonicalRecordPaidFullLifecycle(
  store: MockLinkedOperationsStore,
  orderId: string,
  mutationId: string,
): Promise<LifecycleInput> {
  await addSharedQuickOrder(store, orderId, 10_000);
  await settleCanonicalOrder(store, orderId, 10_000);
  const before = stateSnapshot(store);
  const input = lifecycleInput("record_paid_full", orderId, before.revision, mutationId);
  await lifecycleDomain(input, frontdeskActor, store);
  return input;
}

async function expectLifecycleRejectedWithoutWrite(
  invoke: () => Promise<unknown>,
  store: MockLinkedOperationsStore,
  storage: MemoryStorage,
  status: number,
): Promise<void> {
  const before = stateSnapshot(store);
  const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
  const quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
  resetStorageProbe(storage);
  await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({ status });
  expect(stateSnapshot(store)).toEqual(before);
  expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
  expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
  expectNoLinkedWrites(storage);
}

async function expectLifecyclePreflightReadOnly(
  surface: ReturnType<typeof lifecycleSurface>,
  store: MockLinkedOperationsStore,
  storage: MemoryStorage,
  orderId: string,
  expectedAllowedKinds: ReadonlyArray<LifecycleKind>,
): Promise<LifecyclePreflight> {
  const before = stateSnapshot(store);
  const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
  const quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
  resetStorageProbe(storage);
  const result = closedLifecyclePreflight(await surface.preflight(orderId), {
    revision: before.revision,
    orderId,
    allowedKinds: expectedAllowedKinds,
  });
  expect(stateSnapshot(store)).toEqual(before);
  expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
  expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
  expectNoLinkedWrites(storage);
  return result;
}

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

function receiptPayloadHash(canonical: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function rewriteReceiptPayload(
  receipt: LinkedMutationReceipt,
  rewrite: (payload: Record<string, unknown>) => void,
): void {
  if (!receipt.payloadCanonical) throw new Error("lifecycle receipt canonical payload missing");
  const payload = JSON.parse(receipt.payloadCanonical) as Record<string, unknown>;
  rewrite(payload);
  const canonical = canonicalJson(payload);
  const mutable = receipt as unknown as { payloadCanonical: string; payloadHash: string };
  mutable.payloadCanonical = canonical;
  mutable.payloadHash = receiptPayloadHash(canonical);
}

function downgradeLifecycleReceiptToV1(
  draft: LinkedOperationsState,
  input: LifecycleInput,
): void {
  const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === input.mutationId);
  if (!receipt || !receipt.result || typeof receipt.result !== "object") {
    throw new Error("lifecycle receipt result missing");
  }
  const internal = receipt.result as Record<string, unknown>;
  const publicResult = internal.publicResult as Record<string, unknown> | undefined;
  const financialSnapshot = internal.financialSnapshot
    ?? (publicResult && publicResult.financial);
  if (!publicResult || !financialSnapshot) {
    throw new Error("lifecycle receipt financial snapshot missing");
  }
  (receipt as unknown as { result: unknown }).result = {
    receiptContract: "quick_order_lifecycle_receipt_v1",
    actor: structuredClone(internal.actor),
    changes: structuredClone(internal.changes),
    publicResult: {
      contract: "quick_order_lifecycle_mutation_result_v1",
      revision: publicResult.revision,
      kind: publicResult.kind,
      orderId: publicResult.orderId,
      affectedOrderIds: structuredClone(publicResult.affectedOrderIds),
      committedAt: publicResult.committedAt,
      financial: structuredClone(financialSnapshot),
    },
  };
}

test("lifecycle preflight is a closed finance-free contract with canonical ordered allowed kinds", () => {
  const valid: LifecyclePreflight = {
    contract: "quick_order_lifecycle_preflight_v1",
    revision: 17,
    orderId: "qbo-lifecycle-preflight-closed",
    allowedKinds: ["void", "record_paid_full"],
  };
  for (const allowedKinds of [
    [],
    ["void"],
    ["restore"],
    ["record_paid_full"],
    ["cancel_paid_full"],
    ["void", "record_paid_full"],
    ["void", "cancel_paid_full"],
  ] as ReadonlyArray<ReadonlyArray<LifecycleKind>>) {
    expect(() => assertLifecyclePreflight({ ...valid, allowedKinds }), allowedKinds.join("/") || "empty")
      .not.toThrow();
  }

  let getterCalls = 0;
  const mutants: ReadonlyArray<Readonly<{
    name: string;
    mutate(value: Record<PropertyKey, unknown>): void;
  }>> = [
    { name: "wrong contract", mutate: (value) => { value.contract = "quick_order_lifecycle_preflight_v0"; } },
    { name: "negative revision", mutate: (value) => { value.revision = -1; } },
    { name: "fractional revision", mutate: (value) => { value.revision = 1.5; } },
    { name: "blank order id", mutate: (value) => { value.orderId = " "; } },
    { name: "extra financial", mutate: (value) => { value.financial = { ledger: "PRIVATE" }; } },
    { name: "undefined field", mutate: (value) => { value.revision = undefined; } },
    { name: "hidden extra", mutate: (value) => { Object.defineProperty(value, "hidden", { value: true }); } },
    { name: "symbol extra", mutate: (value) => { value[Symbol("preflight-extra")] = true; } },
    { name: "custom prototype", mutate: (value) => { Object.setPrototypeOf(value, { inherited: true }); } },
    {
      name: "contract accessor",
      mutate: (value) => {
        Object.defineProperty(value, "contract", {
          configurable: true,
          enumerable: true,
          get() {
            getterCalls += 1;
            throw new Error("PREFLIGHT_CONTRACT_GETTER_SENTINEL");
          },
        });
      },
    },
    { name: "allowed kinds object", mutate: (value) => { value.allowedKinds = { 0: "void", length: 1 }; } },
    { name: "duplicate kind", mutate: (value) => { value.allowedKinds = ["void", "void"]; } },
    { name: "non-canonical order", mutate: (value) => { value.allowedKinds = ["restore", "void"]; } },
    { name: "void and restore conflict", mutate: (value) => { value.allowedKinds = ["void", "restore"]; } },
    {
      name: "restore must be singleton",
      mutate: (value) => { value.allowedKinds = ["restore", "record_paid_full"]; },
    },
    {
      name: "paid-full markers conflict",
      mutate: (value) => { value.allowedKinds = ["record_paid_full", "cancel_paid_full"]; },
    },
    { name: "unknown kind", mutate: (value) => { value.allowedKinds = ["submit"]; } },
    {
      name: "sparse kinds",
      mutate: (value) => {
        const kinds = ["void", "restore"];
        Reflect.deleteProperty(kinds, "0");
        value.allowedKinds = kinds;
      },
    },
    {
      name: "array expando",
      mutate: (value) => {
        const kinds = value.allowedKinds as unknown as Record<string, unknown>;
        kinds.extra = true;
      },
    },
    {
      name: "array hidden expando",
      mutate: (value) => { Object.defineProperty(value.allowedKinds, "hidden", { value: true }); },
    },
    {
      name: "array symbol expando",
      mutate: (value) => {
        (value.allowedKinds as Record<PropertyKey, unknown>)[Symbol("allowed-extra")] = true;
      },
    },
    {
      name: "array custom prototype",
      mutate: (value) => { Object.setPrototypeOf(value.allowedKinds as object, Object.create(Array.prototype)); },
    },
    {
      name: "array index accessor",
      mutate: (value) => {
        Object.defineProperty(value.allowedKinds, "0", {
          configurable: true,
          enumerable: true,
          get() {
            getterCalls += 1;
            throw new Error("PREFLIGHT_KIND_GETTER_SENTINEL");
          },
        });
      },
    },
  ];
  for (const mutant of mutants) {
    const value = structuredClone(valid) as Record<PropertyKey, unknown>;
    mutant.mutate(value);
    expect(() => assertLifecyclePreflight(value), mutant.name).toThrow();
  }
  expect(getterCalls).toBe(0);
});

test("lifecycle input is a closed four-branch contract and opaque path identity cannot drift", async () => {
  const base = lifecycleInput("void", "qbo-lifecycle-closed", 7, "lifecycle-closed-void", "retire duplicate");
  const invalid: unknown[] = [
    { ...base, contract: "quick_order_lifecycle_mutation_v0" },
    { ...base, kind: "submit" },
    { ...base, orderId: " " },
    { ...base, expectedRevision: -1 },
    { ...base, expectedRevision: 1.5 },
    { ...base, mutationId: " " },
    { ...base, reason: " " },
    (() => {
      const missingReason = { ...base } as Record<string, unknown>;
      delete missingReason.reason;
      return missingReason;
    })(),
    { ...base, unexpected: true },
    { ...base, expectedRevision: undefined },
    { ...lifecycleInput("restore", base.orderId, 7, "lifecycle-closed-restore"), reason: "forbidden" },
    { ...lifecycleInput("record_paid_full", base.orderId, 7, "lifecycle-closed-record"), reason: "forbidden" },
    { ...lifecycleInput("cancel_paid_full", base.orderId, 7, "lifecycle-closed-cancel"), reason: "forbidden" },
  ];
  const symbolExtra = structuredClone(base) as Record<PropertyKey, unknown>;
  symbolExtra[Symbol("lifecycle-extra")] = true;
  invalid.push(symbolExtra);
  const hiddenExtra = structuredClone(base);
  Object.defineProperty(hiddenExtra, "hidden", { value: true });
  invalid.push(hiddenExtra);
  const customPrototype = structuredClone(base);
  Object.setPrototypeOf(customPrototype, { inherited: true });
  invalid.push(customPrototype);
  let getterCalls = 0;
  const accessor = structuredClone(base);
  Object.defineProperty(accessor, "kind", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("LIFECYCLE_KIND_GETTER_SENTINEL");
    },
  });
  invalid.push(accessor);
  for (const value of invalid) {
    expect(() => assertLifecycleMutationInput(value)).toThrow();
  }
  expect(getterCalls).toBe(0);
  for (const kind of ["void", "restore", "record_paid_full", "cancel_paid_full"] as const) {
    expect(() => assertLifecycleMutationInput(lifecycleInput(
      kind,
      `qbo-lifecycle-valid-${kind}`,
      7,
      `lifecycle-valid-${kind}`,
    ))).not.toThrow();
  }

  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    for (const reservedMutationId of [
      "__task8_child_v1__/invoice-payment/public-lifecycle",
      "__task8_child_v1__/invoice-activation/public-lifecycle",
    ]) {
      const stateBeforeReserved = stateSnapshot(store);
      const primaryBeforeReserved = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
      const quickBeforeReserved = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
      resetStorageProbe(storage);
      await expect(lifecycleSurface().lifecycle(lifecycleInput(
        "void",
        "qbo-0002",
        stateBeforeReserved.revision,
        reservedMutationId,
        "reserved child namespace must stay private",
      ))).rejects.toMatchObject({ status: 400 });
      expect(linkedKeyReads(storage), reservedMutationId).toEqual([]);
      expectNoLinkedWrites(storage);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeReserved);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBeforeReserved);
      expect(stateSnapshot(store)).toEqual(stateBeforeReserved);
    }
    const pathOrderId = "qbo-lifecycle-path-a";
    const bodyOrderId = "qbo-lifecycle-path-b";
    await addSharedQuickOrder(store, pathOrderId, 1_000);
    await addSharedQuickOrder(store, bodyOrderId, 1_000);
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const rawClient = loadClientWithRawMockRequest();
    resetStorageProbe(storage);
    await expect(rawClient.__rawMockRequest(
      `/api/quick-order-financials/${opaqueLifecycleSegment(pathOrderId)}/lifecycle`,
      {
        method: "POST",
        body: JSON.stringify(lifecycleInput("void", bodyOrderId, before.revision, "lifecycle-path-drift")),
      },
    )).rejects.toMatchObject({ status: 400 });
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
    expectNoLinkedWrites(storage);
  } finally {
    restore();
  }
});

test("four lifecycle kinds publish exact closed results and source-ordered operation receipts", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const childId = "qbo-lifecycle-happy-child";
    const parentId = "qbo-lifecycle-happy-parent";
    const paidId = "qbo-lifecycle-happy-paid";
    // Deliberately persist the child first. affectedOrderIds/changes must follow
    // canonical state.quickOrders order, not target-first traversal order.
    await addSharedQuickOrder(store, childId, 1_000);
    await addSharedQuickOrder(store, parentId, 5_000);
    await linkAfterSalesChild(store, parentId, childId);
    await addSharedQuickOrder(store, paidId, 10_000);
    await settleCanonicalOrder(store, paidId, 10_000);
    const surface = lifecycleSurface();

    const steps: ReadonlyArray<Readonly<{
      kind: LifecycleKind;
      orderId: string;
      affectedIds: ReadonlyArray<string>;
      mutationId: string;
      reason?: string;
    }>> = [
      {
        kind: "void",
        orderId: parentId,
        affectedIds: [childId, parentId],
        mutationId: "lifecycle-happy-void",
        reason: "approved lifecycle void",
      },
      {
        kind: "restore",
        orderId: parentId,
        affectedIds: [childId, parentId],
        mutationId: "lifecycle-happy-restore",
      },
      {
        kind: "record_paid_full",
        orderId: paidId,
        affectedIds: [paidId],
        mutationId: "lifecycle-happy-record-paid-full",
      },
      {
        kind: "cancel_paid_full",
        orderId: paidId,
        affectedIds: [paidId],
        mutationId: "lifecycle-happy-cancel-paid-full",
      },
    ];

    for (const step of steps) {
      const before = stateSnapshot(store);
      const input = lifecycleInput(
        step.kind,
        step.orderId,
        before.revision,
        step.mutationId,
        step.reason,
      );
      resetStorageProbe(storage);
      const response = await surface.lifecycle(input);
      const after = stateSnapshot(store);
      const result = closedLifecycleResult(response, {
        kind: step.kind,
        orderId: step.orderId,
        revision: before.revision + 1,
        affectedOrderIds: step.affectedIds,
      });
      expect(after.revision).toBe(before.revision + 1);
      const receipt = lifecycleReceipt(
        before,
        after,
        input,
        frontdeskActor,
        result,
        step.affectedIds,
        store,
      );
      expect(after.mutationReceipts.filter((receipt) => receipt.mutationId === step.mutationId))
        .toHaveLength(1);
      expect((receipt.result as Record<string, unknown>).financialSnapshot)
        .toEqual(financialModel(step.orderId, store));
      const identityMutant = structuredClone(after);
      const identityReceipt = identityMutant.mutationReceipts.find((candidate) => candidate.mutationId === step.mutationId);
      if (!identityReceipt) throw new Error(`${step.kind} identity receipt missing`);
      const identityFinancial = (identityReceipt.result as Record<string, unknown>).financialSnapshot as Record<string, unknown>;
      ((identityFinancial.order as Record<string, unknown>)).id = "qbo-lifecycle-wrong-result-order";
      expect(() => validateLinkedOperationsState(identityMutant), `${step.kind} private financial order identity`).toThrow();
      const affectedMutant = structuredClone(result);
      affectedMutant.affectedOrderIds = step.affectedIds.length === 1
        ? [step.orderId, "qbo-lifecycle-unaffected-extra"]
        : step.affectedIds.filter((orderId) => orderId !== step.orderId);
      expect(() => assertLifecycleMutationResult(affectedMutant), `${step.kind} affected target cardinality`).toThrow();
      const postconditionMutant = structuredClone(after);
      const postconditionReceipt = postconditionMutant.mutationReceipts.find((candidate) => candidate.mutationId === step.mutationId);
      if (!postconditionReceipt) throw new Error(`${step.kind} postcondition receipt missing`);
      const postconditionFinancial = (postconditionReceipt.result as Record<string, unknown>).financialSnapshot as Record<string, unknown>;
      const postconditionOrder = postconditionFinancial.order as Record<string, unknown>;
      const postconditionGates = postconditionFinancial.gates as Record<string, unknown>;
      if (step.kind === "void") {
        postconditionOrder.voidedAt = "2026-08-22T17:00:01.000Z";
      } else if (step.kind === "restore") {
        postconditionOrder.voidedAt = FIXED_COMMITTED_AT;
        for (const gate of [
          "canCollectPayment", "canRefund", "canVoid", "canRecordPaidFull", "canCancelPaidFull", "completed",
        ]) postconditionGates[gate] = false;
      } else if (step.kind === "record_paid_full") {
        postconditionOrder.paidInFullAt = "2026-08-22T17:00:01.000Z";
      } else {
        postconditionOrder.paidInFullAt = FIXED_COMMITTED_AT;
        postconditionGates.canRecordPaidFull = false;
        postconditionGates.canCancelPaidFull = true;
      }
      const financialAssertion = Reflect.get(financialContract, "assertQuickOrderFinancialReadModel");
      if (typeof financialAssertion !== "function") throw new Error("financial model assertion missing");
      expect(
        () => Reflect.apply(financialAssertion, financialContract, [postconditionFinancial]),
        `${step.kind} financial postcondition mutant must remain valid`,
      ).not.toThrow();
      expect(() => validateLinkedOperationsState(postconditionMutant), `${step.kind} private postcondition`).toThrow();
      if (step.kind === "record_paid_full") {
        const sourceMutant = structuredClone(after);
        const sourceReceipt = sourceMutant.mutationReceipts.find((candidate) => (
          candidate.mutationId === step.mutationId
        ));
        if (!sourceReceipt) throw new Error("canonical lifecycle source receipt missing");
        const sourceFinancial = (sourceReceipt.result as Record<string, unknown>).financialSnapshot as Record<string, unknown>;
        const source = sourceFinancial.source as Record<string, unknown>;
        expect(source.kind).toBe("canonical_invoice");
        source.invoiceNo = `${String(source.invoiceNo)}-DRIFT`;
        expect(
          () => Reflect.apply(financialAssertion, financialContract, [sourceFinancial]),
          "private canonical source mutant must remain financially valid",
        ).not.toThrow();
        expect(() => validateLinkedOperationsState(sourceMutant), "private canonical source provenance").toThrow();
      }
      const operationValidatorMutant = structuredClone(after);
      const operationReceipt = operationValidatorMutant.mutationReceipts.find((receipt) => (
        receipt.mutationId === step.mutationId
      ));
      if (!operationReceipt) throw new Error(`operation lifecycle receipt missing: ${step.kind}`);
      const operationResult = operationReceipt.result as Record<string, unknown>;
      const operationChange = (operationResult.changes as Array<Record<string, unknown>>)[0];
      if (!operationChange) throw new Error(`operation lifecycle change missing: ${step.kind}`);
      (operationChange.event as Record<string, unknown>).id = `drift-${step.kind}`;
      expect(
        () => validateLinkedOperationsState(operationValidatorMutant),
        `${step.kind} receipt must be inverse-validated`,
      ).toThrow();
      expect(linkedKeyWrites(storage).map(({ key }) => key)).toEqual([LINKED_OPERATIONS_STORAGE_KEY]);
      expect(linkedKeyRemovals(storage)).toEqual([]);
      expect(storage.clearCalls).toBe(0);

      const changedOrders = step.affectedIds.map((orderId) => {
        const order = after.quickOrders.find((candidate) => candidate.id === orderId);
        if (!order) throw new Error(`changed lifecycle order missing: ${orderId}`);
        return order;
      });
      if (step.kind === "void") {
        expect(changedOrders.map((order) => order.voidedAt)).toEqual([
          FIXED_COMMITTED_AT,
          FIXED_COMMITTED_AT,
        ]);
        expect(changedOrders.map((order) => order.statusHistory.at(-1)?.reason)).toEqual([
          `关联单废除（原单 ${after.quickOrders.find((order) => order.id === parentId)!.businessOrderNo}）`,
          "废除本单：approved lifecycle void",
        ]);
      } else if (step.kind === "restore") {
        expect(changedOrders.map((order) => order.voidedAt)).toEqual([null, null]);
        expect(changedOrders.map((order) => order.statusHistory.at(-1)?.reason)).toEqual([
          "恢复本单（随原单恢复）",
          "恢复本单",
        ]);
      } else if (step.kind === "record_paid_full") {
        expect(changedOrders[0]!.paidInFullAt).toBe(FIXED_COMMITTED_AT);
        expect(changedOrders[0]!.paidInFullBy).toBe(frontdeskActor.name);
        expect(changedOrders[0]!.statusHistory.at(-1)?.reason).toBe("记录付完全款");
      } else {
        expect(changedOrders[0]!.paidInFullAt).toBeNull();
        expect(changedOrders[0]!.paidInFullBy).toBeNull();
        expect(changedOrders[0]!.statusHistory.at(-1)?.reason).toBe("撤销付完全款记录");
      }
    }

  } finally {
    restoreBrowser();
  }
});

test("private lifecycle snapshot cannot claim an Invoice version activated after its receipt revision", async () => {
  test.setTimeout(25_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-lifecycle-private-future-version";
    const input = await commitCanonicalRecordPaidFullLifecycle(
      store,
      orderId,
      "lifecycle-private-future-version-record",
    );
    await reopenCanonicalOrderWithV2(store, orderId, 5_000);
    const mutant = stateSnapshot(store);
    const receipt = mutant.mutationReceipts.find((candidate) => candidate.mutationId === input.mutationId);
    if (!receipt) throw new Error("future-version lifecycle receipt missing");
    const futureFinancial = structuredClone(financialModel(orderId, store)) as unknown as Record<string, unknown>;
    futureFinancial.revision = receipt.committedRevision;
    (receipt.result as Record<string, unknown>).financialSnapshot = futureFinancial;
    await expectPrivateLifecycleSnapshotRejectedByFreshReady(mutant, storage, "future Invoice version drift");
  } finally {
    restoreBrowser();
  }
});

test("private lifecycle snapshot cannot fall back to V1 after V2 was already active at its receipt revision", async () => {
  test.setTimeout(25_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-lifecycle-private-historical-version";
    await addSharedQuickOrder(store, orderId, 10_000);
    await settleCanonicalOrder(store, orderId, 10_000);
    const v1Financial = structuredClone(financialModel(orderId, store));

    await reopenCanonicalOrderWithV2(store, orderId, 5_000);
    const v2BeforePayment = financialModel(orderId, store);
    if (v2BeforePayment.source.kind !== "canonical_invoice") {
      throw new Error("historical-window fixture requires canonical V2");
    }
    await recordMockInvoicePayment({
      invoiceId: v2BeforePayment.source.invoiceId,
      expectedRevision: stateSnapshot(store).revision,
      mutationId: `${orderId}-pay-v2-balance`,
      amountJmd: 5_000,
      method: "cash",
    }, frontdeskActor, store);

    const beforeLifecycle = stateSnapshot(store);
    const input = lifecycleInput(
      "record_paid_full",
      orderId,
      beforeLifecycle.revision,
      "lifecycle-private-historical-version-record",
    );
    await lifecycleDomain(input, frontdeskActor, store);

    const mutant = stateSnapshot(store);
    const snapshot = lifecyclePrivateFinancialSnapshot(mutant, input.mutationId);
    const v1Source = structuredClone(v1Financial.source);
    const v1Ledger = structuredClone(v1Financial.ledger);
    expect(Reflect.get(v1Source, "versionNo")).toBe(1);
    expect((snapshot.source as Record<string, unknown>).versionNo).toBe(2);
    snapshot.source = v1Source;
    snapshot.ledger = v1Ledger;
    await expectPrivateLifecycleSnapshotRejectedByFreshReady(mutant, storage, "historical Invoice version drift");
  } finally {
    restoreBrowser();
  }
});

test("an untampered lifecycle receipt remains valid after later V2 payment and refund facts", async () => {
  test.setTimeout(25_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-lifecycle-private-later-facts";
    const input = await commitCanonicalRecordPaidFullLifecycle(
      store,
      orderId,
      "lifecycle-private-later-facts-record",
    );
    const lifecycleRevision = input.expectedRevision + 1;

    await reopenCanonicalOrderWithV2(store, orderId, 5_000);
    const v2Financial = financialModel(orderId, store);
    if (v2Financial.source.kind !== "canonical_invoice") {
      throw new Error("later-facts fixture requires canonical V2");
    }
    await recordMockInvoicePayment({
      invoiceId: v2Financial.source.invoiceId,
      expectedRevision: stateSnapshot(store).revision,
      mutationId: `${orderId}-later-payment`,
      amountJmd: 5_000,
      method: "cash",
    }, frontdeskActor, store);
    await recordMockInvoiceLineRefund({
      logicalInvoiceId: v2Financial.source.invoiceId,
      invoiceVersionId: v2Financial.source.effectiveVersionId,
      chargeLineId: `${orderId}-v2-line`,
      refundQuantity: 1,
      method: "cash",
      reason: "later receipt-time cutoff regression",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: `${orderId}-later-refund`,
    }, frontdeskActor, store);

    const finalState = stateSnapshot(store);
    for (const mutationId of [`${orderId}-activate-v2`, `${orderId}-later-payment`, `${orderId}-later-refund`]) {
      const receipt = finalState.mutationReceipts.find((candidate) => candidate.mutationId === mutationId);
      expect(receipt?.committedRevision, mutationId).toBeGreaterThan(lifecycleRevision);
    }
    expect(() => validateLinkedOperationsState(finalState)).not.toThrow();

    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    resetStorageProbe(storage);
    const freshStore = createMockLinkedOperationsStore(storage);
    await expect(freshStore.ready()).resolves.toBeUndefined();
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
    expectNoLinkedWrites(storage);
  } finally {
    restoreBrowser();
  }
});

test("private canonical lifecycle snapshot cannot hide durable payments with a core-valid due ledger", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const input = await commitCanonicalRecordPaidFullLifecycle(
      store,
      "qbo-lifecycle-private-ledger",
      "lifecycle-private-ledger-record",
    );
    const mutant = stateSnapshot(store);
    const snapshot = lifecyclePrivateFinancialSnapshot(mutant, input.mutationId);
    const originalLedger = snapshot.ledger as Record<string, unknown>;
    const invoiceTotalJmd = Number(originalLedger.invoiceTotalJmd);
    snapshot.ledger = {
      invoiceTotalJmd,
      receivableJmd: invoiceTotalJmd,
      grossPaidJmd: 0,
      cashRefundedJmd: 0,
      receivableReductionJmd: 0,
      netPaidJmd: 0,
      balanceJmd: invoiceTotalJmd,
      paymentStatus: "unpaid",
      settlementStatus: "due",
      hasPaymentHistory: false,
    };
    snapshot.gates = {
      canCollectPayment: true,
      canRefund: true,
      canVoid: true,
      canRecordPaidFull: false,
      canCancelPaidFull: true,
      completed: false,
    };
    await expectPrivateLifecycleSnapshotRejectedByFreshReady(mutant, storage, "canonical ledger history drift");
  } finally {
    restoreBrowser();
  }
});

test("private canonical lifecycle snapshot cannot invent a picked-up completion coordinate", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const input = await commitCanonicalRecordPaidFullLifecycle(
      store,
      "qbo-lifecycle-private-pickup",
      "lifecycle-private-pickup-record",
    );
    const mutant = stateSnapshot(store);
    const snapshot = lifecyclePrivateFinancialSnapshot(mutant, input.mutationId);
    const order = snapshot.order as Record<string, unknown>;
    const gates = snapshot.gates as Record<string, unknown>;
    expect(order.pickedUpAt).toBeNull();
    expect(gates.completed).toBe(false);
    order.pickedUpAt = FIXED_COMMITTED_AT;
    gates.completed = true;
    await expectPrivateLifecycleSnapshotRejectedByFreshReady(mutant, storage, "invented pickup coordinate");
  } finally {
    restoreBrowser();
  }
});

test("restore ignores an independently voided child even when an unreceipted last event impersonates the cascade", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const childId = "qbo-lifecycle-restore-collision-child";
    const parentId = "qbo-lifecycle-restore-collision-parent";
    await addSharedQuickOrder(store, childId, 1_000);
    await addSharedQuickOrder(store, parentId, 5_000);
    await linkAfterSalesChild(store, parentId, childId);
    const surface = lifecycleSurface();
    const parent = stateSnapshot(store).quickOrders.find((order) => order.id === parentId);
    if (!parent) throw new Error("restore collision parent missing");
    const cascadeReason = `关联单废除（原单 ${parent.businessOrderNo}）`;

    let before = stateSnapshot(store);
    const firstParentVoid = await surface.lifecycle(lifecycleInput(
      "void",
      parentId,
      before.revision,
      "lifecycle-restore-collision-first-parent-void",
      "first parent cascade",
    ));
    let after = stateSnapshot(store);
    closedLifecycleResult(firstParentVoid, {
      kind: "void",
      orderId: parentId,
      revision: before.revision + 1,
      affectedOrderIds: [childId, parentId],
    });
    before = after;
    const firstParentRestore = await surface.lifecycle(lifecycleInput(
      "restore",
      parentId,
      before.revision,
      "lifecycle-restore-collision-first-parent-restore",
    ));
    after = stateSnapshot(store);
    closedLifecycleResult(firstParentRestore, {
      kind: "restore",
      orderId: parentId,
      revision: before.revision + 1,
      affectedOrderIds: [childId, parentId],
    });

    before = after;
    await lifecycleDomain(lifecycleInput(
      "void",
      childId,
      before.revision,
      "lifecycle-restore-collision-child-void",
      cascadeReason,
    ), frontdeskActor, store);
    after = stateSnapshot(store);
    let independentlyVoidedChild = after.quickOrders.find((order) => order.id === childId);
    expect(independentlyVoidedChild).toMatchObject({
      voidReason: cascadeReason,
      voidedAt: FIXED_COMMITTED_AT,
      voidedBy: frontdeskActor.name,
    });
    expect(independentlyVoidedChild?.statusHistory.at(-1)?.reason).toBe(`废除本单：${cascadeReason}`);

    await store.mutate((draft) => {
      const child = draft.quickOrders.find((order) => order.id === childId);
      if (!child || child.voidedAt === null || child.voidedBy === null) {
        throw new Error("restore collision child coordinate missing");
      }
      (child.statusHistory as QuickBoStatusEvent[]).push({
        id: `${child.id}-ev-${child.statusHistory.length + 1}`,
        from: child.status,
        to: child.status,
        by: child.voidedBy,
        byRole: "frontdesk",
        at: child.voidedAt,
        reason: cascadeReason,
      });
      draft.revision += 1;
    }, { action: "test.quick-lifecycle-restore-collision-event.write", consumeWriteFault: false });
    after = stateSnapshot(store);
    expect(() => validateLinkedOperationsState(after)).not.toThrow();
    independentlyVoidedChild = after.quickOrders.find((order) => order.id === childId);
    expect(independentlyVoidedChild?.statusHistory.at(-1)?.reason).toBe(cascadeReason);

    before = after;
    await surface.lifecycle(lifecycleInput(
      "void",
      parentId,
      before.revision,
      "lifecycle-restore-collision-parent-void",
      "approved parent void",
    ));
    after = stateSnapshot(store);
    const parentVoidReceipt = after.mutationReceipts.find((receipt) => (
      receipt.mutationId === "lifecycle-restore-collision-parent-void"
    ));
    expect((parentVoidReceipt?.result as { publicResult?: { affectedOrderIds?: unknown } }).publicResult?.affectedOrderIds)
      .toEqual([parentId]);
    expect(after.quickOrders.find((order) => order.id === childId)).toEqual(independentlyVoidedChild);

    before = after;
    const restoreInput = lifecycleInput(
      "restore",
      parentId,
      before.revision,
      "lifecycle-restore-collision-parent-restore",
    );
    resetStorageProbe(storage);
    const response = await surface.lifecycle(restoreInput);
    after = stateSnapshot(store);
    const result = closedLifecycleResult(response, {
      kind: "restore",
      orderId: parentId,
      revision: before.revision + 1,
      affectedOrderIds: [parentId],
    });
    lifecycleReceipt(before, after, restoreInput, frontdeskActor, result, [parentId], store);
    expect(after.quickOrders.find((order) => order.id === parentId)?.voidedAt).toBeNull();
    expect(after.quickOrders.find((order) => order.id === childId)).toEqual(independentlyVoidedChild);
    expect(linkedKeyWrites(storage).map(({ key }) => key)).toEqual([LINKED_OPERATIONS_STORAGE_KEY]);
    expect(linkedKeyRemovals(storage)).toEqual([]);
    expect(storage.clearCalls).toBe(0);
  } finally {
    restoreBrowser();
  }
});

test("generic status reasons cannot impersonate receipt-backed lifecycle tail changes", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  const appendUnreceiptedSameStatusEvent = async (orderId: string, reason: string): Promise<void> => {
    await store.mutate((draft) => {
      const order = draft.quickOrders.find((candidate) => candidate.id === orderId);
      if (!order) throw new Error("lifecycle tail spoof target missing");
      (order.statusHistory as QuickBoStatusEvent[]).push({
        id: `${order.id}-ev-${order.statusHistory.length + 1}`,
        from: order.status,
        to: order.status,
        by: frontdeskActor.name,
        byRole: "frontdesk",
        at: FIXED_COMMITTED_AT,
        reason,
      });
      draft.revision += 1;
    }, { action: "test.quick-lifecycle-unreceipted-tail.write", consumeWriteFault: false });
  };

  const voidId = "qbo-lifecycle-tail-spoof-void";
  await addSharedQuickOrder(store, voidId, 1_000);
  let state = stateSnapshot(store);
  await lifecycleDomain(lifecycleInput(
    "void",
    voidId,
    state.revision,
    "lifecycle-tail-spoof-void",
    "tail proof",
  ), frontdeskActor, store);
  state = stateSnapshot(store);
  await lifecycleDomain(lifecycleInput(
    "restore",
    voidId,
    state.revision,
    "lifecycle-tail-spoof-restore",
  ), frontdeskActor, store);
  await appendUnreceiptedSameStatusEvent(voidId, "废除本单：spoof");
  const voidBaseline = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(voidBaseline)).not.toThrow();
  const voidMutant = structuredClone(voidBaseline);
  const voidOrder = voidMutant.quickOrders.find((order) => order.id === voidId);
  if (!voidOrder) throw new Error("void tail spoof order missing");
  Object.assign(voidOrder as unknown as Record<string, unknown>, {
    voidedAt: "2026-08-22T17:00:01.000Z",
    voidedBy: "Mallory",
    voidReason: "spoofed void coordinate",
  });
  expect.soft(() => validateLinkedOperationsState(voidMutant), "void coordinate spoof").toThrow();

  const paidId = "qbo-lifecycle-tail-spoof-paid";
  await addSharedQuickOrder(store, paidId, 10_000);
  await settleCanonicalOrder(store, paidId, 10_000);
  state = stateSnapshot(store);
  await lifecycleDomain(lifecycleInput(
    "record_paid_full",
    paidId,
    state.revision,
    "lifecycle-tail-spoof-record",
  ), frontdeskActor, store);
  state = stateSnapshot(store);
  await lifecycleDomain(lifecycleInput(
    "cancel_paid_full",
    paidId,
    state.revision,
    "lifecycle-tail-spoof-cancel",
  ), frontdeskActor, store);
  await appendUnreceiptedSameStatusEvent(paidId, "记录付完全款");
  const paidBaseline = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(paidBaseline)).not.toThrow();
  const paidMutant = structuredClone(paidBaseline);
  const paidOrder = paidMutant.quickOrders.find((order) => order.id === paidId);
  if (!paidOrder) throw new Error("paid tail spoof order missing");
  Object.assign(paidOrder as unknown as Record<string, unknown>, {
    paidInFullAt: "2026-08-22T17:00:01.000Z",
    paidInFullBy: "Mallory",
  });
  expect.soft(() => validateLinkedOperationsState(paidMutant), "paid coordinate spoof").toThrow();
});

test("receipt-backed lifecycle chains reject duplicate evidence chronology drift and family discontinuity", async () => {
  test.setTimeout(35_000);
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  const alternateAt = "2026-08-22T17:00:01.000Z";
  const appendUnreceiptedEvent = async (
    orderId: string,
    reason: string,
    at = alternateAt,
  ): Promise<void> => {
    await store.mutate((draft) => {
      const order = draft.quickOrders.find((candidate) => candidate.id === orderId);
      if (!order) throw new Error("lifecycle chain target missing");
      (order.statusHistory as QuickBoStatusEvent[]).push({
        id: `${order.id}-ev-${order.statusHistory.length + 1}`,
        from: order.status,
        to: order.status,
        by: frontdeskActor.name,
        byRole: "frontdesk",
        at,
        reason,
      });
      draft.revision += 1;
    }, { action: "test.quick-lifecycle-chain-event.write", consumeWriteFault: false });
  };
  const receiptByMutationId = (state: LinkedOperationsState, mutationId: string): LinkedMutationReceipt => {
    const receipt = state.mutationReceipts.find((candidate) => candidate.mutationId === mutationId);
    if (!receipt) throw new Error(`lifecycle chain receipt missing: ${mutationId}`);
    return receipt;
  };
  const targetChange = (receipt: LinkedMutationReceipt, orderId: string): Record<string, unknown> => {
    const internal = receipt.result as Record<string, unknown>;
    const change = (internal.changes as Array<Record<string, unknown>>).find((candidate) => (
      candidate.orderId === orderId
    ));
    if (!change) throw new Error(`lifecycle chain change missing: ${orderId}`);
    return change;
  };

  const duplicateId = "qbo-lifecycle-chain-duplicate";
  await addSharedQuickOrder(store, duplicateId, 1_000);
  let state = stateSnapshot(store);
  const duplicateMutationId = "lifecycle-chain-duplicate-source";
  await lifecycleDomain(lifecycleInput(
    "void",
    duplicateId,
    state.revision,
    duplicateMutationId,
    "duplicate evidence",
  ), frontdeskActor, store);
  const duplicateMutant = stateSnapshot(store);
  const copiedReceipt = structuredClone(receiptByMutationId(duplicateMutant, duplicateMutationId));
  const copiedMutationId = "lifecycle-chain-duplicate-copy";
  (copiedReceipt as unknown as { id: string; mutationId: string }).id = copiedMutationId;
  (copiedReceipt as unknown as { id: string; mutationId: string }).mutationId = copiedMutationId;
  rewriteReceiptPayload(copiedReceipt, (payload) => { payload.mutationId = copiedMutationId; });
  (duplicateMutant.mutationReceipts as LinkedMutationReceipt[]).push(copiedReceipt);
  expect.soft(
    () => validateLinkedOperationsState(duplicateMutant),
    "one event cannot back two receipts",
  ).toThrow();

  const chronologyId = "qbo-lifecycle-chain-chronology";
  await addSharedQuickOrder(store, chronologyId, 1_000);
  state = stateSnapshot(store);
  const chronologyVoidId = "lifecycle-chain-chronology-void";
  await lifecycleDomain(lifecycleInput(
    "void",
    chronologyId,
    state.revision,
    chronologyVoidId,
    "chronology proof",
  ), frontdeskActor, store);
  state = stateSnapshot(store);
  const chronologyRestoreId = "lifecycle-chain-chronology-restore";
  await lifecycleDomain(lifecycleInput(
    "restore",
    chronologyId,
    state.revision,
    chronologyRestoreId,
  ), frontdeskActor, store);
  const chronologyMutant = stateSnapshot(store);
  const chronologyVoid = receiptByMutationId(chronologyMutant, chronologyVoidId);
  const chronologyRestore = receiptByMutationId(chronologyMutant, chronologyRestoreId);
  const voidRevision = chronologyVoid.committedRevision;
  const restoreRevision = chronologyRestore.committedRevision;
  const rewriteRevision = (receipt: LinkedMutationReceipt, revision: number): void => {
    (receipt as unknown as { committedRevision: number }).committedRevision = revision;
    rewriteReceiptPayload(receipt, (payload) => { payload.expectedRevision = revision - 1; });
    const publicResult = (receipt.result as Record<string, unknown>).publicResult as Record<string, unknown>;
    publicResult.revision = revision;
    ((receipt.result as Record<string, unknown>).financialSnapshot as Record<string, unknown>).revision = revision;
  };
  rewriteRevision(chronologyVoid, restoreRevision);
  rewriteRevision(chronologyRestore, voidRevision);
  expect.soft(
    () => validateLinkedOperationsState(chronologyMutant),
    "event and revision chronology",
  ).toThrow();

  const crossOrderA = "qbo-lifecycle-chain-cross-order-a";
  const crossOrderB = "qbo-lifecycle-chain-cross-order-b";
  await addSharedQuickOrder(store, crossOrderA, 1_000);
  await addSharedQuickOrder(store, crossOrderB, 1_000);
  state = stateSnapshot(store);
  const crossMutationA = "lifecycle-chain-cross-order-a";
  await lifecycleDomain(lifecycleInput(
    "void",
    crossOrderA,
    state.revision,
    crossMutationA,
    "cross-order revision A",
  ), frontdeskActor, store);
  state = stateSnapshot(store);
  const crossMutationB = "lifecycle-chain-cross-order-b";
  await lifecycleDomain(lifecycleInput(
    "void",
    crossOrderB,
    state.revision,
    crossMutationB,
    "cross-order revision B",
  ), frontdeskActor, store);
  const crossOrderRevisionMutant = stateSnapshot(store);
  const crossReceiptA = receiptByMutationId(crossOrderRevisionMutant, crossMutationA);
  const crossReceiptB = receiptByMutationId(crossOrderRevisionMutant, crossMutationB);
  rewriteRevision(crossReceiptB, crossReceiptA.committedRevision);
  expect.soft(
    () => validateLinkedOperationsState(crossOrderRevisionMutant),
    "lifecycle receipts across orders require unique increasing revisions",
  ).toThrow();

  const voidChainId = "qbo-lifecycle-chain-void-discontinuity";
  await addSharedQuickOrder(store, voidChainId, 1_000);
  state = stateSnapshot(store);
  await lifecycleDomain(lifecycleInput(
    "void",
    voidChainId,
    state.revision,
    "lifecycle-chain-void-source",
    "original void coordinate",
  ), frontdeskActor, store);
  const alternateVoidReason = "alternate unreceipted void";
  await appendUnreceiptedEvent(voidChainId, `废除本单：${alternateVoidReason}`);
  state = stateSnapshot(store);
  const voidRestoreId = "lifecycle-chain-void-restore";
  await lifecycleDomain(lifecycleInput(
    "restore",
    voidChainId,
    state.revision,
    voidRestoreId,
  ), frontdeskActor, store);
  const voidBaseline = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(voidBaseline)).not.toThrow();
  const voidDiscontinuity = structuredClone(voidBaseline);
  const voidRestoreChange = targetChange(receiptByMutationId(voidDiscontinuity, voidRestoreId), voidChainId);
  Object.assign(voidRestoreChange.before as Record<string, unknown>, {
    voidedAt: alternateAt,
    voidedBy: frontdeskActor.name,
    voidReason: alternateVoidReason,
  });
  expect.soft(
    () => validateLinkedOperationsState(voidDiscontinuity),
    "void family continuity",
  ).toThrow();

  const paidChainId = "qbo-lifecycle-chain-paid-discontinuity";
  await addSharedQuickOrder(store, paidChainId, 10_000);
  await settleCanonicalOrder(store, paidChainId, 10_000);
  state = stateSnapshot(store);
  await lifecycleDomain(lifecycleInput(
    "record_paid_full",
    paidChainId,
    state.revision,
    "lifecycle-chain-paid-source",
  ), frontdeskActor, store);
  await appendUnreceiptedEvent(paidChainId, "记录付完全款");
  state = stateSnapshot(store);
  const paidCancelId = "lifecycle-chain-paid-cancel";
  await lifecycleDomain(lifecycleInput(
    "cancel_paid_full",
    paidChainId,
    state.revision,
    paidCancelId,
  ), frontdeskActor, store);
  const paidBaseline = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(paidBaseline)).not.toThrow();
  const paidDiscontinuity = structuredClone(paidBaseline);
  const paidCancelChange = targetChange(receiptByMutationId(paidDiscontinuity, paidCancelId), paidChainId);
  Object.assign(paidCancelChange.before as Record<string, unknown>, {
    paidInFullAt: alternateAt,
    paidInFullBy: frontdeskActor.name,
  });
  expect.soft(
    () => validateLinkedOperationsState(paidDiscontinuity),
    "paid family continuity",
  ).toThrow();
});

test("lifecycle reselects financial gates in the locked draft and enforces revision CAS atomically", async () => {
  test.setTimeout(40_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const uninvoicedId = "qbo-lifecycle-gate-uninvoiced";
    const dueId = "qbo-lifecycle-gate-due";
    const cancelMissingId = "qbo-lifecycle-gate-cancel-missing";
    const restoreActiveId = "qbo-lifecycle-gate-restore-active";
    const paidChildId = "qbo-lifecycle-gate-paid-child";
    const parentId = "qbo-lifecycle-gate-parent";
    for (const orderId of [uninvoicedId, dueId, cancelMissingId, restoreActiveId, parentId, paidChildId]) {
      await addSharedQuickOrder(store, orderId, orderId === paidChildId ? 1_000 : 10_000);
    }
    let state = stateSnapshot(store);
    await activateMockQuickInvoiceSnapshot({
      orderId: dueId,
      expectedRevision: state.revision,
      mutationId: "lifecycle-gate-due-activation",
    }, frontdeskActor, store);
    await linkAfterSalesChild(store, parentId, paidChildId);
    state = stateSnapshot(store);
    const childActivation = await activateMockQuickInvoiceSnapshot({
      orderId: paidChildId,
      expectedRevision: state.revision,
      mutationId: "lifecycle-gate-paid-child-activation",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    await recordMockInvoicePayment({
      invoiceId: childActivation.invoiceId,
      expectedRevision: state.revision,
      mutationId: "lifecycle-gate-paid-child-payment",
      amountJmd: 1,
      method: "cash",
    }, frontdeskActor, store);
    const surface = lifecycleSurface();

    const rejected: ReadonlyArray<Readonly<{
      kind: LifecycleKind;
      orderId: string;
      mutationId: string;
      status: number;
    }>> = [
      { kind: "record_paid_full", orderId: uninvoicedId, mutationId: "lifecycle-gate-uninvoiced-record", status: 400 },
      { kind: "record_paid_full", orderId: dueId, mutationId: "lifecycle-gate-due-record", status: 400 },
      { kind: "cancel_paid_full", orderId: cancelMissingId, mutationId: "lifecycle-gate-cancel-missing", status: 400 },
      { kind: "restore", orderId: restoreActiveId, mutationId: "lifecycle-gate-restore-active", status: 400 },
      { kind: "void", orderId: parentId, mutationId: "lifecycle-gate-paid-child-void", status: 400 },
    ];
    for (const item of rejected) {
      const current = stateSnapshot(store);
      await expectLifecycleRejectedWithoutWrite(
        () => surface.lifecycle(lifecycleInput(item.kind, item.orderId, current.revision, item.mutationId)),
        store,
        storage,
        item.status,
      );
      expect(stateSnapshot(store).mutationReceipts.some((receipt) => receipt.mutationId === item.mutationId))
        .toBe(false);
    }

    const lockedId = "qbo-lifecycle-gate-locked-reselect";
    await addSharedQuickOrder(store, lockedId, 10_000);
    await settleCanonicalOrder(store, lockedId, 10_000);
    const staleSettledDraft = stateSnapshot(store);
    expect((financialModel(lockedId, store) as { gates?: { canRecordPaidFull?: unknown } }).gates?.canRecordPaidFull)
      .toBe(true);
    await reopenCanonicalOrderWithV2(store, lockedId, 5_000);
    const dueDraft = stateSnapshot(store);
    expect((financialModel(lockedId, store) as { gates?: { canRecordPaidFull?: unknown } }).gates?.canRecordPaidFull)
      .toBe(false);
    const staleReadStore: MockLinkedOperationsStore = {
      ready: () => store.ready(),
      read: (selector) => structuredClone(selector(staleSettledDraft)),
      mutate: (mutation, options) => store.mutate(mutation, options),
      mutateIdempotently: (input, mutation, options) => store.mutateIdempotently(input, mutation, options),
      getReadDelay: (action) => store.getReadDelay(action),
      nowMs: () => store.nowMs(),
      createDraftChildStore: (draft, nowMs) => store.createDraftChildStore(draft, nowMs),
    };
    await expectLifecycleRejectedWithoutWrite(
      () => lifecycleDomain(lifecycleInput(
        "record_paid_full",
        lockedId,
        dueDraft.revision,
        "lifecycle-gate-locked-reselect",
      ), frontdeskActor, staleReadStore),
      store,
      storage,
      400,
    );

    const freshId = "qbo-lifecycle-gate-stale";
    await addSharedQuickOrder(store, freshId, 1_000);
    const current = stateSnapshot(store);
    await expectLifecycleRejectedWithoutWrite(
      () => surface.lifecycle(lifecycleInput("void", freshId, current.revision - 1, "lifecycle-gate-stale-void")),
      store,
      storage,
      409,
    );

    const concurrentIds = ["qbo-lifecycle-cas-a", "qbo-lifecycle-cas-b"] as const;
    for (const orderId of concurrentIds) await addSharedQuickOrder(store, orderId, 1_000);
    const beforeConcurrent = stateSnapshot(store);
    resetStorageProbe(storage);
    const settled = await Promise.allSettled(concurrentIds.map((orderId, index) => (
      surface.lifecycle(lifecycleInput(
        "void",
        orderId,
        beforeConcurrent.revision,
        `lifecycle-cas-${index}`,
      ))
    )));
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejectedResult = settled.find((result) => result.status === "rejected");
    expect(rejectedResult).toMatchObject({ status: "rejected", reason: { status: 409 } });
    const afterConcurrent = stateSnapshot(store);
    expect(afterConcurrent.revision).toBe(beforeConcurrent.revision + 1);
    expect(afterConcurrent.quickOrders.filter((order) => (
      concurrentIds.includes(order.id as typeof concurrentIds[number]) && order.voidedAt !== null
    ))).toHaveLength(1);
    expect(afterConcurrent.mutationReceipts.filter((receipt) => receipt.mutationId.startsWith("lifecycle-cas-")))
      .toHaveLength(1);
    expect(linkedKeyWrites(storage).map(({ key }) => key)).toEqual([LINKED_OPERATIONS_STORAGE_KEY]);
    expect(linkedKeyRemovals(storage)).toEqual([]);
  } finally {
    restoreBrowser();
  }
});

test("lifecycle receipt is an inverse-checked commitment to payload actor time revision changes events and current state", async () => {
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const childId = "qbo-lifecycle-inverse-child";
    const orderId = "qbo-lifecycle-inverse";
    await addSharedQuickOrder(store, childId, 1_000);
    await addSharedQuickOrder(store, orderId, 2_000);
    await linkAfterSalesChild(store, orderId, childId);
    const before = stateSnapshot(store);
    const input = lifecycleInput("void", orderId, before.revision, "lifecycle-inverse-void", "inverse proof");
    const result = await lifecycleDomain(input, frontdeskActor, store);
    const committed = stateSnapshot(store);
    lifecycleReceipt(before, committed, input, frontdeskActor, result, [childId, orderId], store);
    expect(() => validateLinkedOperationsState(committed)).not.toThrow();

    const mutateReceipt = (
      state: LinkedOperationsState,
      mutate: (receipt: LinkedMutationReceipt, internal: Record<string, unknown>) => void,
    ): void => {
      const receipt = state.mutationReceipts.find((candidate) => candidate.mutationId === input.mutationId);
      if (!receipt) throw new Error("inverse lifecycle receipt missing");
      const internal = receipt.result as Record<string, unknown>;
      mutate(receipt, internal);
    };
    let receiptGetterCalls = 0;
    const mutants: ReadonlyArray<Readonly<{
      name: string;
      mutate(state: LinkedOperationsState): void;
    }>> = [
      {
        name: "operation",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          (receipt as unknown as { operation: string }).operation = "quickOrders.lifecycle.restore";
        }),
      },
      {
        name: "coordinated payload path",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          rewriteReceiptPayload(receipt, (payload) => { payload.orderId = "qbo-lifecycle-other"; });
        }),
      },
      {
        name: "coordinated payload mutation id",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          rewriteReceiptPayload(receipt, (payload) => { payload.mutationId = "lifecycle-inverse-other"; });
        }),
      },
      {
        name: "coordinated payload expected revision",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          rewriteReceiptPayload(receipt, (payload) => {
            payload.expectedRevision = Number(payload.expectedRevision) + 1;
          });
        }),
      },
      {
        name: "coordinated payload kind",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          rewriteReceiptPayload(receipt, (payload) => {
            payload.kind = "restore";
            delete payload.reason;
          });
          if (!receipt.payloadCanonical) throw new Error("coordinated kind payload missing");
          expect(() => assertLifecycleMutationInput(JSON.parse(receipt.payloadCanonical!))).not.toThrow();
        }),
      },
      {
        name: "coordinated payload reason",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          rewriteReceiptPayload(receipt, (payload) => { payload.reason = "coordinated reason drift"; });
        }),
      },
      {
        name: "coordinated actor",
        mutate: (state) => mutateReceipt(state, (receipt, internal) => {
          (receipt as unknown as { actorId: string }).actorId = financeActor.id;
          internal.actor = structuredClone(financeActor);
        }),
      },
      {
        name: "coordinated receipt time",
        mutate: (state) => mutateReceipt(state, (receipt, internal) => {
          const changedAt = "2026-08-22T17:00:01.000Z";
          (receipt as unknown as { committedAt: string }).committedAt = changedAt;
          (internal.publicResult as Record<string, unknown>).committedAt = changedAt;
          ((internal.changes as Array<Record<string, unknown>>)[0]!.event as Record<string, unknown>).at = changedAt;
        }),
      },
      {
        name: "coordinated receipt revision",
        mutate: (state) => mutateReceipt(state, (receipt, internal) => {
          const changedRevision = receipt.committedRevision - 1;
          (receipt as unknown as { committedRevision: number }).committedRevision = changedRevision;
          const publicResult = internal.publicResult as Record<string, unknown>;
          publicResult.revision = changedRevision;
          (internal.financialSnapshot as Record<string, unknown>).revision = changedRevision;
        }),
      },
      {
        name: "change order identity",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.changes as Array<Record<string, unknown>>)[0]!.orderId = "qbo-lifecycle-other";
        }),
      },
      {
        name: "before coordinate",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          ((internal.changes as Array<Record<string, unknown>>)[0]!.before as Record<string, unknown>).paidInFullBy = "drift";
        }),
      },
      {
        name: "after coordinate",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          ((internal.changes as Array<Record<string, unknown>>)[0]!.after as Record<string, unknown>).voidReason = "drift";
        }),
      },
      {
        name: "event",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          ((internal.changes as Array<Record<string, unknown>>)[0]!.event as Record<string, unknown>).id = "drift-event";
        }),
      },
      {
        name: "public affected ids",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.publicResult as Record<string, unknown>).affectedOrderIds = ["qbo-lifecycle-other"];
        }),
      },
      {
        name: "coordinated omitted cascade child",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.publicResult as Record<string, unknown>).affectedOrderIds = [orderId];
          internal.changes = (internal.changes as Array<Record<string, unknown>>).filter((change) => (
            change.orderId === orderId
          ));
        }),
      },
      {
        name: "coordinated reversed cascade order",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.publicResult as Record<string, unknown>).affectedOrderIds = [orderId, childId];
          internal.changes = [...(internal.changes as Array<Record<string, unknown>>)].reverse();
        }),
      },
      {
        name: "receipt result extra field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => { internal.unexpected = true; }),
      },
      {
        name: "receipt result wrong contract",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          internal.receiptContract = "quick_order_lifecycle_receipt_v0";
        }),
      },
      {
        name: "receipt result hidden field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty(internal, "hidden", { value: true });
        }),
      },
      {
        name: "receipt result symbol field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal as Record<PropertyKey, unknown>)[Symbol("receipt-result-extra")] = true;
        }),
      },
      {
        name: "receipt result custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf(internal, { inherited: true });
        }),
      },
      {
        name: "receipt result accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty(internal, "receiptContract", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_RESULT_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "outer receipt extra field",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          (receipt as unknown as Record<string, unknown>).unexpected = true;
        }),
      },
      {
        name: "outer receipt hidden field",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          Object.defineProperty(receipt, "hidden", { value: true });
        }),
      },
      {
        name: "outer receipt symbol field",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          (receipt as unknown as Record<PropertyKey, unknown>)[Symbol("outer-receipt-extra")] = true;
        }),
      },
      {
        name: "outer receipt custom prototype",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          Object.setPrototypeOf(receipt, { inherited: true });
        }),
      },
      {
        name: "outer receipt accessor",
        mutate: (state) => mutateReceipt(state, (receipt) => {
          Object.defineProperty(receipt, "operation", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_OUTER_RECEIPT_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "actor extra field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.actor as Record<string, unknown>).unexpected = true;
        }),
      },
      {
        name: "actor hidden field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty(internal.actor, "hidden", { value: true });
        }),
      },
      {
        name: "actor symbol field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.actor as Record<PropertyKey, unknown>)[Symbol("actor-extra")] = true;
        }),
      },
      {
        name: "actor missing field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          delete (internal.actor as Record<string, unknown>).name;
        }),
      },
      {
        name: "actor undefined field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.actor as Record<string, unknown>).role = undefined;
        }),
      },
      {
        name: "actor custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf(internal.actor as object, { inherited: true });
        }),
      },
      {
        name: "actor accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty(internal.actor, "id", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_ACTOR_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "changes sparse",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          delete (internal.changes as unknown[])[0];
        }),
      },
      {
        name: "changes duplicate",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const changes = internal.changes as unknown[];
          changes.push(structuredClone(changes[0]));
        }),
      },
      {
        name: "changes expando",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.changes as unknown as Record<string, unknown>).unexpected = true;
        }),
      },
      {
        name: "changes hidden expando",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty(internal.changes, "hidden", { value: true });
        }),
      },
      {
        name: "changes symbol expando",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.changes as unknown as Record<PropertyKey, unknown>)[Symbol("changes-extra")] = true;
        }),
      },
      {
        name: "changes custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf(internal.changes as object, Object.create(Array.prototype));
        }),
      },
      {
        name: "changes index accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty(internal.changes, "0", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_CHANGE_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "change extra field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          (internal.changes as Array<Record<string, unknown>>)[0]!.unexpected = true;
        }),
      },
      {
        name: "change hidden field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty((internal.changes as unknown[])[0], "hidden", { value: true });
        }),
      },
      {
        name: "change symbol field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          ((internal.changes as Array<Record<PropertyKey, unknown>>)[0]!)[Symbol("change-extra")] = true;
        }),
      },
      {
        name: "change custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf((internal.changes as unknown[])[0] as object, { inherited: true });
        }),
      },
      {
        name: "change accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.defineProperty((internal.changes as unknown[])[0], "orderId", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_CHANGE_FIELD_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "before extra field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          ((internal.changes as Array<Record<string, unknown>>)[0]!.before as Record<string, unknown>).unexpected = true;
        }),
      },
      {
        name: "before hidden field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const beforeCoordinate = (internal.changes as Array<Record<string, unknown>>)[0]!.before;
          Object.defineProperty(beforeCoordinate, "hidden", { value: true });
        }),
      },
      {
        name: "before symbol field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const beforeCoordinate = (internal.changes as Array<Record<string, unknown>>)[0]!.before as Record<PropertyKey, unknown>;
          beforeCoordinate[Symbol("before-extra")] = true;
        }),
      },
      {
        name: "before custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf((internal.changes as Array<Record<string, unknown>>)[0]!.before as object, { inherited: true });
        }),
      },
      {
        name: "before accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const beforeCoordinate = (internal.changes as Array<Record<string, unknown>>)[0]!.before;
          Object.defineProperty(beforeCoordinate, "status", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_BEFORE_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "after undefined field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          ((internal.changes as Array<Record<string, unknown>>)[0]!.after as Record<string, unknown>).voidedAt = undefined;
        }),
      },
      {
        name: "after hidden field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const afterCoordinate = (internal.changes as Array<Record<string, unknown>>)[0]!.after;
          Object.defineProperty(afterCoordinate, "hidden", { value: true });
        }),
      },
      {
        name: "after symbol field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const afterCoordinate = (internal.changes as Array<Record<string, unknown>>)[0]!.after as Record<PropertyKey, unknown>;
          afterCoordinate[Symbol("after-extra")] = true;
        }),
      },
      {
        name: "after custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf((internal.changes as Array<Record<string, unknown>>)[0]!.after as object, { inherited: true });
        }),
      },
      {
        name: "after accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const afterCoordinate = (internal.changes as Array<Record<string, unknown>>)[0]!.after;
          Object.defineProperty(afterCoordinate, "status", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_AFTER_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "event missing field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          delete ((internal.changes as Array<Record<string, unknown>>)[0]!.event as Record<string, unknown>).reason;
        }),
      },
      {
        name: "event hidden field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const event = (internal.changes as Array<Record<string, unknown>>)[0]!.event;
          Object.defineProperty(event, "hidden", { value: true });
        }),
      },
      {
        name: "event symbol field",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const event = (internal.changes as Array<Record<string, unknown>>)[0]!.event as Record<PropertyKey, unknown>;
          event[Symbol("event-extra")] = true;
        }),
      },
      {
        name: "event custom prototype",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          Object.setPrototypeOf((internal.changes as Array<Record<string, unknown>>)[0]!.event as object, { inherited: true });
        }),
      },
      {
        name: "event accessor",
        mutate: (state) => mutateReceipt(state, (_receipt, internal) => {
          const event = (internal.changes as Array<Record<string, unknown>>)[0]!.event;
          Object.defineProperty(event, "id", {
            configurable: true,
            enumerable: true,
            get() {
              receiptGetterCalls += 1;
              throw new Error("LIFECYCLE_RECEIPT_EVENT_GETTER_SENTINEL");
            },
          });
        }),
      },
      {
        name: "current state event chain",
        mutate: (state) => {
          const index = state.quickOrders.findIndex((order) => order.id === orderId);
          const order = state.quickOrders[index]!;
          state.quickOrders[index] = { ...order, statusHistory: order.statusHistory.slice(0, -1) };
        },
      },
    ];
    for (const mutant of mutants) {
      const state = structuredClone(committed);
      mutant.mutate(state);
      expect(() => validateLinkedOperationsState(state), mutant.name).toThrow();
    }
    expect(receiptGetterCalls).toBe(0);
  } finally {
    restoreBrowser();
  }
});

test("one lifecycle intent reads the clock once and binds that instant to result receipt events and all state markers", async () => {
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const expectedAt = new Date(FIXED_NOW_MS).toISOString();
    for (const kind of ["void", "restore", "record_paid_full", "cancel_paid_full"] as const) {
      await test.step(kind, async () => {
        const orderId = `qbo-lifecycle-clock-${kind}`;
        let affectedOrderIds: ReadonlyArray<string> = [orderId];
        if (kind === "void") {
          const childId = `${orderId}-child`;
          await addSharedQuickOrder(store, childId, 1_000);
          await addSharedQuickOrder(store, orderId, 1_000);
          await linkAfterSalesChild(store, orderId, childId);
          affectedOrderIds = [childId, orderId];
        } else {
          await prepareLifecycleTarget(store, kind, orderId);
        }
        let nowCalls = 0;
        const clockStore: MockLinkedOperationsStore = {
          ready: () => store.ready(),
          read: (selector, action) => store.read(selector, action),
          mutate: (mutation, options) => store.mutate(mutation, options),
          mutateIdempotently: (input, mutation, options) => store.mutateIdempotently(input, mutation, options),
          getReadDelay: (action) => store.getReadDelay(action),
          nowMs: () => FIXED_NOW_MS + nowCalls++ * 1_000,
          createDraftChildStore: (draft, nowMs) => store.createDraftChildStore(draft, nowMs),
        };
        const before = stateSnapshot(store);
        const input = lifecycleInput(
          kind,
          orderId,
          before.revision,
          `lifecycle-clock-single-read-${kind}`,
          "single clock coordinate",
        );
        const result = await lifecycleDomain(input, frontdeskActor, clockStore);
        const after = stateSnapshot(store);
        expect(nowCalls).toBe(1);
        expect((result as Record<string, unknown>).committedAt).toBe(expectedAt);
        const receipt = lifecycleReceipt(
          before,
          after,
          input,
          frontdeskActor,
          result,
          affectedOrderIds,
          store,
        );
        expect(receipt.committedAt).toBe(expectedAt);
        const changes = ((receipt.result as Record<string, unknown>).changes as Array<Record<string, unknown>>);
        expect(changes.map((change) => (change.event as Record<string, unknown>).at))
          .toEqual(affectedOrderIds.map(() => expectedAt));
        const affectedOrders = affectedOrderIds.map((affectedOrderId) => {
          const order = after.quickOrders.find((candidate) => candidate.id === affectedOrderId);
          if (!order) throw new Error(`clock lifecycle order missing: ${affectedOrderId}`);
          return order;
        });
        if (kind === "void") {
          expect(affectedOrders.map((order) => order.voidedAt)).toEqual(affectedOrderIds.map(() => expectedAt));
        } else if (kind === "restore") {
          expect(affectedOrders.map((order) => order.voidedAt)).toEqual([null]);
        } else if (kind === "record_paid_full") {
          expect(affectedOrders.map((order) => order.paidInFullAt)).toEqual([expectedAt]);
        } else {
          expect(affectedOrders.map((order) => order.paidInFullAt)).toEqual([null]);
        }
      });
    }
  } finally {
    restoreBrowser();
  }
});

test("lifecycle public result assertion rejects descriptor, array, coordinate, and semantic drift without invoking accessors", async () => {
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const childId = "qbo-lifecycle-result-child";
    const parentId = "qbo-lifecycle-result-parent";
    await addSharedQuickOrder(store, childId, 1_000);
    await addSharedQuickOrder(store, parentId, 2_000);
    await linkAfterSalesChild(store, parentId, childId);
    const before = stateSnapshot(store);
    const input = lifecycleInput(
      "void",
      parentId,
      before.revision,
      "lifecycle-result-closed",
      "result closure",
    );
    const result = await lifecycleDomain(input, frontdeskActor, store);
    expect(() => assertLifecycleMutationResult(result)).not.toThrow();

    let getterCalls = 0;
    const mutants: ReadonlyArray<Readonly<{ name: string; mutate(value: Record<PropertyKey, unknown>): void }>> = [
      {
        name: "wrong contract",
        mutate: (value) => { value.contract = "quick_order_lifecycle_mutation_result_v0"; },
      },
      { name: "unknown kind", mutate: (value) => { value.kind = "submit"; } },
      { name: "extra", mutate: (value) => { value.unexpected = true; } },
      {
        name: "hidden extra",
        mutate: (value) => { Object.defineProperty(value, "hidden", { value: true }); },
      },
      { name: "undefined", mutate: (value) => { value.committedAt = undefined; } },
      { name: "symbol", mutate: (value) => { value[Symbol("lifecycle-result-extra")] = true; } },
      { name: "custom prototype", mutate: (value) => { Object.setPrototypeOf(value, { inherited: true }); } },
      {
        name: "contract accessor",
        mutate: (value) => {
          Object.defineProperty(value, "contract", {
            configurable: true,
            enumerable: true,
            get() {
              getterCalls += 1;
              throw new Error("LIFECYCLE_RESULT_GETTER_SENTINEL");
            },
          });
        },
      },
      {
        name: "sparse affected ids",
        mutate: (value) => { delete (value.affectedOrderIds as unknown[])[0]; },
      },
      {
        name: "duplicate affected ids",
        mutate: (value) => {
          const ids = value.affectedOrderIds as string[];
          ids[1] = ids[0]!;
        },
      },
      {
        name: "blank affected child id",
        mutate: (value) => { (value.affectedOrderIds as string[])[0] = " "; },
      },
      {
        name: "array expando",
        mutate: (value) => { (value.affectedOrderIds as unknown as Record<string, unknown>).unexpected = true; },
      },
      {
        name: "array hidden expando",
        mutate: (value) => {
          Object.defineProperty(value.affectedOrderIds, "hidden", { value: true });
        },
      },
      {
        name: "array symbol expando",
        mutate: (value) => {
          (value.affectedOrderIds as unknown as Record<PropertyKey, unknown>)[Symbol("affected-extra")] = true;
        },
      },
      {
        name: "array custom prototype",
        mutate: (value) => {
          Object.setPrototypeOf(value.affectedOrderIds as object, Object.create(Array.prototype));
        },
      },
      {
        name: "array index accessor",
        mutate: (value) => {
          Object.defineProperty(value.affectedOrderIds, "0", {
            configurable: true,
            enumerable: true,
            get() {
              getterCalls += 1;
              throw new Error("LIFECYCLE_AFFECTED_GETTER_SENTINEL");
            },
          });
        },
      },
      { name: "invalid committedAt", mutate: (value) => { value.committedAt = "2026-08-22 17:00:00"; } },
    ];
    for (const mutant of mutants) {
      const value = structuredClone(result) as Record<PropertyKey, unknown>;
      mutant.mutate(value);
      expect(() => assertLifecycleMutationResult(value), mutant.name).toThrow();
    }
    expect(getterCalls).toBe(0);
  } finally {
    restoreBrowser();
  }
});

test("real lifecycle client round-trips opaque IDs and sanitizes every invalid successful response", async () => {
  const fixtureStore = createMockLinkedOperationsStore(memoryStorage());
  const baseOrderId = "qbo-lifecycle-real-response";
  await addSharedQuickOrder(fixtureStore, baseOrderId, 1_000);
  await installVoidFixture(fixtureStore, baseOrderId, frontdeskActor, FIXED_COMMITTED_AT);
  const revision = Number((financialModel(baseOrderId, fixtureStore) as { revision: number }).revision);
  const makeResult = (orderId: string): Record<string, unknown> => {
    return {
      contract: "quick_order_lifecycle_mutation_result_v2",
      revision,
      kind: "void",
      orderId,
      affectedOrderIds: [orderId],
      committedAt: FIXED_COMMITTED_AT,
    };
  };
  const validResults = opaqueLifecycleOrderIds.map(({ orderId }) => makeResult(orderId));
  const sentinel = "PRIVATE_LIFECYCLE_RESPONSE_SENTINEL";
  const invalidExtra = structuredClone(validResults[0]!);
  invalidExtra.privateEvidence = sentinel;
  invalidExtra.customers = [{
    verificationArchive: {
      kycRecords: [{
        subjectType: "organization_primary_contact",
        subjectProfile: `DRIVER_LICENSE_PROFILE_INVALID_${sentinel}`,
      }],
    },
  }];
  const invalidSemantic = structuredClone(validResults[0]!);
  invalidSemantic.affectedOrderIds = [sentinel];
  const wrongOrderResponse = makeResult("qbo-lifecycle-response-other");
  const wrongKindResponse = structuredClone(validResults[0]!);
  wrongKindResponse.kind = "restore";
  const wrongRevisionResponse = structuredClone(validResults[0]!);
  wrongRevisionResponse.revision = revision + 1;
  for (const [name, structurallyValid] of [
    ["wrong request order", wrongOrderResponse],
    ["wrong request kind", wrongKindResponse],
    ["wrong request revision", wrongRevisionResponse],
  ] as const) {
    expect(() => assertLifecycleMutationResult(structurallyValid), name).not.toThrow();
  }

  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  const requests: Array<Readonly<{ url: string; method?: string; body?: BodyInit | null }>> = [];
  const responses: Array<Readonly<{ body: string; contentType: string; status?: number }>> = [
    ...validResults.map((result) => ({ body: JSON.stringify(result), contentType: "application/json" })),
    { body: JSON.stringify(invalidExtra), contentType: "application/json" },
    { body: JSON.stringify(invalidSemantic), contentType: "application/json" },
    { body: `not-json-${sentinel}`, contentType: "text/plain" },
    { body: JSON.stringify(wrongOrderResponse), contentType: "application/json" },
    { body: JSON.stringify(wrongKindResponse), contentType: "application/json" },
    { body: JSON.stringify(wrongRevisionResponse), contentType: "application/json" },
    {
      body: JSON.stringify({
        error: "lifecycle domain conflict",
        code: "QUICK_ORDER_LIFECYCLE_CONFLICT",
        details: { retry: false },
      }),
      contentType: "application/json",
      status: 409,
    },
  ];
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    delete require.cache[modulePath];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body });
      const response = responses.shift();
      if (!response) throw new Error("unexpected lifecycle real-fetch request");
      return new Response(response.body, {
        status: response.status ?? 200,
        headers: { "Content-Type": response.contentType },
      });
    }) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    const surface = lifecycleSurface(realClient.api);
    const validInputs = opaqueLifecycleOrderIds.map(({ orderId }, index) => lifecycleInput(
      "void",
      orderId,
      revision - 1,
      `lifecycle-real-opaque-${index}`,
    ));
    for (const [index, input] of validInputs.entries()) {
      await expect(surface.lifecycle(input)).resolves.toEqual(validResults[index]);
    }
    expect(requests.map(({ url }) => url)).toEqual(
      opaqueLifecycleOrderIds.map(({ segment }) => `/api/quick-order-financials/${segment}/lifecycle`),
    );
    expect(requests.map(({ method }) => method)).toEqual(opaqueLifecycleOrderIds.map(() => "POST"));
    expect(requests.map(({ body }) => body)).toEqual(validInputs.map((input) => JSON.stringify(input)));

    for (const [index, invoke] of [
      () => surface.lifecycle({ ...validInputs[0]!, mutationId: "lifecycle-real-invalid-extra" }),
      () => surface.lifecycle({ ...validInputs[0]!, mutationId: "lifecycle-real-invalid-semantic" }),
      () => surface.lifecycle({ ...validInputs[0]!, mutationId: "lifecycle-real-invalid-text" }),
      () => surface.lifecycle({ ...validInputs[0]!, mutationId: "lifecycle-real-wrong-order" }),
      () => surface.lifecycle({ ...validInputs[0]!, mutationId: "lifecycle-real-wrong-kind" }),
      () => surface.lifecycle({ ...validInputs[0]!, mutationId: "lifecycle-real-wrong-revision" }),
    ].entries()) {
      let error: unknown;
      try {
        await invoke();
        throw new Error(`invalid lifecycle response ${index} unexpectedly succeeded`);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(realClient.ApiError);
      expect(error).toMatchObject({
        status: 502,
        code: "QUICK_ORDER_LIFECYCLE_RESPONSE_INVALID",
      });
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
    await expect(surface.lifecycle({
      ...validInputs[0]!,
      mutationId: "lifecycle-real-domain-conflict",
    })).rejects.toMatchObject({
      status: 409,
      code: "QUICK_ORDER_LIFECYCLE_CONFLICT",
      details: { retry: false },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUseMock === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_USE_MOCK");
    else process.env.NEXT_PUBLIC_USE_MOCK = previousUseMock;
    if (previousApiBase === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_API_BASE_URL");
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBase;
    delete require.cache[modulePath];
  }
});

test("real lifecycle preflight round-trips opaque IDs and sanitizes invalid or malformed successful responses", async () => {
  const revision = 41;
  const makePreflight = (orderId: string): LifecyclePreflight => ({
    contract: "quick_order_lifecycle_preflight_v1",
    revision,
    orderId,
    allowedKinds: ["void"],
  });
  const validResponses = opaqueLifecycleOrderIds.map(({ orderId }) => makePreflight(orderId));
  const sentinel = "PRIVATE_LIFECYCLE_PREFLIGHT_SENTINEL";
  const invalidExtra = {
    ...makePreflight(opaqueLifecycleOrderIds[0]!.orderId),
    financial: sentinel,
    customers: [{
      verificationArchive: {
        kycRecords: [{
          subjectType: "organization_primary_contact",
          subjectProfile: `DRIVER_LICENSE_PROFILE_INVALID_${sentinel}`,
        }],
      },
    }],
  };
  const invalidAllowedKinds = {
    ...makePreflight(opaqueLifecycleOrderIds[0]!.orderId),
    allowedKinds: ["restore", "void"],
  };
  const wrongOrder = makePreflight("qbo-lifecycle-preflight-other");
  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  const requests: Array<Readonly<{ url: string; method?: string; body?: BodyInit | null }>> = [];
  const responses: Array<Readonly<{ body: string; contentType: string; status?: number }>> = [
    ...validResponses.map((value) => ({ body: JSON.stringify(value), contentType: "application/json" })),
    { body: JSON.stringify(invalidExtra), contentType: "application/json" },
    { body: JSON.stringify(invalidAllowedKinds), contentType: "application/json" },
    { body: `not-json-${sentinel}`, contentType: "text/plain" },
    { body: JSON.stringify(wrongOrder), contentType: "application/json" },
    {
      body: JSON.stringify({
        error: "preflight domain conflict",
        code: "QUICK_ORDER_LIFECYCLE_PREFLIGHT_CONFLICT",
        details: { retry: false },
      }),
      contentType: "application/json",
      status: 409,
    },
  ];
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    delete require.cache[modulePath];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body });
      const response = responses.shift();
      if (!response) throw new Error("unexpected lifecycle preflight real-fetch request");
      return new Response(response.body, {
        status: response.status ?? 200,
        headers: { "Content-Type": response.contentType },
      });
    }) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    const surface = lifecycleSurface(realClient.api);
    for (const [index, { orderId }] of opaqueLifecycleOrderIds.entries()) {
      await expect(surface.preflight(orderId)).resolves.toEqual(validResponses[index]);
    }
    expect(requests.map(({ url }) => url)).toEqual(
      opaqueLifecycleOrderIds.map(({ segment }) => `/api/quick-order-financials/${segment}/lifecycle`),
    );
    expect(requests.map(({ method }) => method).every((method) => method === undefined)).toBe(true);
    expect(requests.map(({ body }) => body).every((body) => body === undefined)).toBe(true);

    for (const invoke of [
      () => surface.preflight(opaqueLifecycleOrderIds[0]!.orderId),
      () => surface.preflight(opaqueLifecycleOrderIds[0]!.orderId),
      () => surface.preflight(opaqueLifecycleOrderIds[0]!.orderId),
      () => surface.preflight(opaqueLifecycleOrderIds[0]!.orderId),
    ]) {
      let error: unknown;
      try {
        await invoke();
        throw new Error("invalid lifecycle preflight response unexpectedly succeeded");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(realClient.ApiError);
      expect(error).toMatchObject({
        status: 502,
        code: "QUICK_ORDER_LIFECYCLE_PREFLIGHT_RESPONSE_INVALID",
      });
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
    await expect(surface.preflight(opaqueLifecycleOrderIds[0]!.orderId)).rejects.toMatchObject({
      status: 409,
      code: "QUICK_ORDER_LIFECYCLE_PREFLIGHT_CONFLICT",
      details: { retry: false },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUseMock === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_USE_MOCK");
    else process.env.NEXT_PUBLIC_USE_MOCK = previousUseMock;
    if (previousApiBase === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_API_BASE_URL");
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBase;
    delete require.cache[modulePath];
  }
});

test("same lifecycle intent commits once, exact replay is write-free, and mutationId collisions fail closed", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-lifecycle-idempotent";
    const otherOrderId = "qbo-lifecycle-idempotent-other";
    await addSharedQuickOrder(store, orderId, 2_000);
    await addSharedQuickOrder(store, otherOrderId, 2_000);
    const before = stateSnapshot(store);
    const input = lifecycleInput(
      "void",
      orderId,
      before.revision,
      "lifecycle-idempotent-void",
      "single intent",
    );
    resetStorageProbe(storage);
    const concurrent = await Promise.all([
      lifecycleDomain(input, frontdeskActor, store),
      lifecycleDomain(structuredClone(input), frontdeskActor, store),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    const committed = stateSnapshot(store);
    expect(committed.revision).toBe(before.revision + 1);
    expect(committed.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId))
      .toHaveLength(1);
    expect(committed.quickOrders.find((order) => order.id === orderId)!.statusHistory)
      .toHaveLength(before.quickOrders.find((order) => order.id === orderId)!.statusHistory.length + 1);
    expect(linkedKeyWrites(storage).map(({ key }) => key)).toEqual([LINKED_OPERATIONS_STORAGE_KEY]);

    resetStorageProbe(storage);
    const replay = await lifecycleDomain(structuredClone(input), frontdeskActor, store);
    expect(replay).toEqual(concurrent[0]);
    expect(stateSnapshot(store)).toEqual(committed);
    expectNoLinkedWrites(storage);

    const collisions: ReadonlyArray<Readonly<{
      name: string;
      input: LifecycleInput;
      actor: LifecycleActor;
    }>> = [
      {
        name: "order",
        input: lifecycleInput("void", otherOrderId, input.expectedRevision, input.mutationId, input.reason),
        actor: frontdeskActor,
      },
      {
        name: "kind",
        input: lifecycleInput("restore", orderId, input.expectedRevision, input.mutationId),
        actor: frontdeskActor,
      },
      {
        name: "reason",
        input: lifecycleInput("void", orderId, input.expectedRevision, input.mutationId, "different reason"),
        actor: frontdeskActor,
      },
      {
        name: "expected revision",
        input: lifecycleInput("void", orderId, input.expectedRevision + 1, input.mutationId, input.reason),
        actor: frontdeskActor,
      },
      {
        name: "actor",
        input,
        actor: financeActor,
      },
    ];
    for (const collision of collisions) {
      await test.step(collision.name, async () => {
        await expectLifecycleRejectedWithoutWrite(
          () => lifecycleDomain(collision.input, collision.actor, store),
          store,
          storage,
          collision.name === "actor" ? 403 : 409,
        );
        expect(stateSnapshot(store).mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId))
          .toHaveLength(1);
      });
    }
  } finally {
    restoreBrowser();
  }
});

test("all lifecycle kinds survive write faults and response loss with one durable receipt and zero-write replay", async () => {
  test.setTimeout(35_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, frontdeskActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    for (const kind of ["void", "restore", "record_paid_full", "cancel_paid_full"] as const) {
      await test.step(kind, async () => {
        const writeOrderId = `qbo-lifecycle-fault-write-${kind}`;
        const responseOrderId = `qbo-lifecycle-fault-response-${kind}`;
        await prepareLifecycleTarget(store, kind, writeOrderId);
        await prepareLifecycleTarget(store, kind, responseOrderId);

        let before = stateSnapshot(store);
        const writeInput = lifecycleInput(
          kind,
          writeOrderId,
          before.revision,
          `lifecycle-fault-write-${kind}`,
        );
        scenario.failNext.byAction[`quickOrders.lifecycle.${kind}.write`] = `lifecycle ${kind} write fault`;
        await expectLifecycleRejectedWithoutWrite(
          () => lifecycleDomain(writeInput, frontdeskActor, store),
          store,
          storage,
          503,
        );
        const writeRetry = await lifecycleDomain(writeInput, frontdeskActor, store);
        const afterWriteRetry = stateSnapshot(store);
        expect(afterWriteRetry.revision).toBe(before.revision + 1);
        expect(afterWriteRetry.mutationReceipts.filter((receipt) => receipt.mutationId === writeInput.mutationId))
          .toHaveLength(1);
        expect(writeRetry).toEqual(
          afterWriteRetry.mutationReceipts.find((receipt) => receipt.mutationId === writeInput.mutationId)!.result
            && (afterWriteRetry.mutationReceipts.find((receipt) => receipt.mutationId === writeInput.mutationId)!.result as Record<string, unknown>).publicResult,
        );

        before = stateSnapshot(store);
        const responseInput = lifecycleInput(
          kind,
          responseOrderId,
          before.revision,
          `lifecycle-fault-response-${kind}`,
        );
        const quickBeforeResponse = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
        scenario.failNext.byAction[`quickOrders.lifecycle.${kind}.response`] = `lifecycle ${kind} response loss`;
        resetStorageProbe(storage);
        await expect(lifecycleDomain(responseInput, frontdeskActor, store)).rejects.toMatchObject({ status: 503 });
        const afterLoss = stateSnapshot(store);
        expect(afterLoss.revision).toBe(before.revision + 1);
        expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === responseInput.mutationId))
          .toHaveLength(1);
        expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBeforeResponse);
        expect(linkedKeyWrites(storage).map(({ key }) => key)).toEqual([LINKED_OPERATIONS_STORAGE_KEY]);
        expect(linkedKeyRemovals(storage)).toEqual([]);
        expect(storage.clearCalls).toBe(0);

        resetStorageProbe(storage);
        const replay = await lifecycleDomain(responseInput, frontdeskActor, store);
        const receipt = afterLoss.mutationReceipts.find((candidate) => candidate.mutationId === responseInput.mutationId)!;
        expect(replay).toEqual((receipt.result as Record<string, unknown>).publicResult);
        expect(stateSnapshot(store)).toEqual(afterLoss);
        expectNoLinkedWrites(storage);
      });
    }
  } finally {
    restoreBrowser();
  }
});

test("retired broad lifecycle route and direct domain return 410 before reading or writing P/Q", async () => {
  const values = new Map<string, string>([
    [LINKED_OPERATIONS_STORAGE_KEY, "PRIMARY_LIFECYCLE_SENTINEL_MUST_NOT_BE_READ"],
    [LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY, "QUICK_LIFECYCLE_SENTINEL_MUST_NOT_BE_READ"],
  ]);
  const storage = memoryStorage(values);
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, superadminActor);
  try {
    const rawClient = loadClientWithRawMockRequest();
    const baseline = new Map(values);
    for (const kind of ["void", "restore", "record_paid_full", "cancel_paid_full"] as const) {
      await test.step(`route ${kind}`, async () => {
        resetStorageProbe(storage);
        await expect(rawClient.__rawMockRequest("/api/quick-orders/qbo-lifecycle-retired/action", {
          method: "POST",
          body: JSON.stringify({
            action: kind === "void" ? { kind, reason: "retired" } : { kind },
            role: "frontdesk",
          }),
        })).rejects.toMatchObject({ status: 410 });
        expect(linkedKeyReads(storage)).toEqual([]);
        expectNoLinkedWrites(storage);
        expect(storage.values).toEqual(baseline);
      });

      await test.step(`direct ${kind}`, async () => {
        let storeTouches = 0;
        const trapStore = new Proxy({}, {
          get() {
            storeTouches += 1;
            throw new Error("RETIRED_LIFECYCLE_STORE_TOUCH_SENTINEL");
          },
        });
        const oldAction = Reflect.get(quickOrderDomain, "applyMockQuickOrderAction");
        if (typeof oldAction !== "function") throw new Error("old QuickOrder action surface missing");
        await expect(Reflect.apply(oldAction, quickOrderDomain, [
          "qbo-lifecycle-retired",
          kind === "void" ? { kind, reason: "retired" } : { kind },
          frontdeskActor.name,
          "frontdesk",
          trapStore,
        ])).rejects.toMatchObject({ status: 410 });
        expect(storeTouches).toBe(0);
      });
    }
  } finally {
    restoreBrowser();
  }
});

test("lifecycle preflight fences invocation pre-read inside-read and response sessions without P or Q writes", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, superadminActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-lifecycle-preflight-session";
    await addSharedQuickOrder(store, orderId, 1_000);
    const surface = lifecycleSurface();
    const before = stateSnapshot(store);
    const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    const assertUnchanged = (): void => {
      expect(stateSnapshot(store)).toEqual(before);
      expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
      expectNoLinkedWrites(storage);
    };

    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    resetStorageProbe(storage);
    const invocationPending = Promise.resolve().then(() => surface.preflight(orderId));
    await new Promise((resolve) => setTimeout(resolve, 50));
    storage.setItem("wh_session", JSON.stringify({ identity: financeActor }));
    await expect(invocationPending, "preflight invocation fence").rejects.toMatchObject({ status: 403 });
    assertUnchanged();

    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    scenario.delayMs = { byAction: { "quickOrders.lifecycle.preflight.read": 1_000 } };
    resetStorageProbe(storage);
    const preReadPending = Promise.resolve().then(() => surface.preflight(orderId));
    await new Promise((resolve) => setTimeout(resolve, 650));
    storage.setItem("wh_session", JSON.stringify({ identity: financeActor }));
    await expect(preReadPending, "preflight delayed pre-read fence").rejects.toMatchObject({ status: 403 });
    assertUnchanged();

    scenario.delayMs = undefined;
    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    const originalRead = store.read;
    store.read = <T>(selector: (state: LinkedOperationsState) => T, action?: string): T => {
      if (action !== "quickOrders.lifecycle.preflight.read") return originalRead(selector, action);
      storage.setItem("wh_session", JSON.stringify({ identity: financeActor }));
      try {
        return originalRead(selector, action);
      } finally {
        storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
      }
    };
    resetStorageProbe(storage);
    try {
      await expect(surface.preflight(orderId), "preflight inside-read fence")
        .rejects.toMatchObject({ status: 403 });
    } finally {
      store.read = originalRead;
    }
    assertUnchanged();

    store.read = <T>(selector: (state: LinkedOperationsState) => T, action?: string): T => {
      const value = originalRead(selector, action);
      if (action === "quickOrders.lifecycle.preflight.read") {
        storage.setItem("wh_session", JSON.stringify({ identity: financeActor }));
      }
      return value;
    };
    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    resetStorageProbe(storage);
    try {
      await expect(surface.preflight(orderId), "preflight response fence")
        .rejects.toMatchObject({ status: 403 });
    } finally {
      store.read = originalRead;
    }
    assertUnchanged();
  } finally {
    restoreBrowser();
  }
});

test("official lifecycle fences invocation, coordinator, response, and revoked-identity phases", async () => {
  test.setTimeout(35_000);
  const storage = memoryStorage();
  const scenario: LifecycleScenario = { nowMs: FIXED_NOW_MS, failNext: { byAction: {} } };
  const restoreBrowser = installBrowser(storage, scenario, superadminActor);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const surface = lifecycleSurface();

    const invocationId = "qbo-lifecycle-session-invocation";
    await addSharedQuickOrder(store, invocationId, 1_000);
    let before = stateSnapshot(store);
    let primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    let quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    resetStorageProbe(storage);
    const invocationPending = surface.lifecycle(lifecycleInput(
      "void",
      invocationId,
      before.revision,
      "lifecycle-session-invocation",
    ));
    await new Promise((resolve) => setTimeout(resolve, 50));
    storage.setItem("wh_session", JSON.stringify({ identity: financeActor }));
    await expect(invocationPending).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
    expectNoLinkedWrites(storage);

    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    const lockId = "qbo-lifecycle-session-lock";
    await addSharedQuickOrder(store, lockId, 1_000);
    const coordinator = createLinkedOperationsMutationCoordinator(storage);
    let releaseLock!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = coordinator.runExclusive(async () => {
      markEntered();
      await gate;
    });
    await entered;
    before = stateSnapshot(store);
    primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    resetStorageProbe(storage);
    let settled = false;
    const lockPending = surface.lifecycle(lifecycleInput(
      "void",
      lockId,
      before.revision,
      "lifecycle-session-lock",
    )).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(settled, "official lifecycle must wait behind the linked coordinator").toBe(false);
    storage.setItem("wh_session", JSON.stringify({ identity: financeActor }));
    resetStorageProbe(storage);
    releaseLock();
    await blocker;
    await expect(lockPending).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
    expectNoLinkedWrites(storage);

    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    const responseId = "qbo-lifecycle-session-response";
    await addSharedQuickOrder(store, responseId, 1_000);
    before = stateSnapshot(store);
    const responseInput = lifecycleInput(
      "void",
      responseId,
      before.revision,
      "lifecycle-session-response",
    );
    const originalSetItem = storage.setItem.bind(storage);
    let switchOnCommit = true;
    storage.setItem = (key: string, value: string): void => {
      originalSetItem(key, value);
      if (key === LINKED_OPERATIONS_STORAGE_KEY && switchOnCommit) {
        switchOnCommit = false;
        originalSetItem("wh_session", JSON.stringify({ identity: financeActor }));
      }
    };
    resetStorageProbe(storage);
    try {
      await expect(surface.lifecycle(responseInput)).rejects.toMatchObject({ status: 403 });
    } finally {
      storage.setItem = originalSetItem;
    }
    const afterResponseSwitch = stateSnapshot(store);
    expect(afterResponseSwitch.revision).toBe(before.revision + 1);
    expect(afterResponseSwitch.mutationReceipts.filter((receipt) => receipt.mutationId === responseInput.mutationId))
      .toHaveLength(1);
    expect(linkedKeyWrites(storage).map(({ key }) => key)).toEqual([LINKED_OPERATIONS_STORAGE_KEY]);

    storage.setItem("wh_session", JSON.stringify({ identity: superadminActor }));
    resetStorageProbe(storage);
    const replay = await surface.lifecycle(responseInput);
    expect(replay).toEqual(
      (afterResponseSwitch.mutationReceipts.find((receipt) => receipt.mutationId === responseInput.mutationId)!.result as Record<string, unknown>)
        .publicResult,
    );
    expect(stateSnapshot(store)).toEqual(afterResponseSwitch);
    expectNoLinkedWrites(storage);

    await store.mutate((state) => {
      state.trustedIdentities = state.trustedIdentities.filter((identity) => identity.id !== superadminActor.id);
      state.revision += 1;
    }, { action: "test.quick-lifecycle-revoke-actor.write", consumeWriteFault: false });
    const revoked = stateSnapshot(store);
    primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
    quickBefore = storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY);
    resetStorageProbe(storage);
    await expect(surface.lifecycle(responseInput)).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(store)).toEqual(revoked);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickBefore);
    expectNoLinkedWrites(storage);
  } finally {
    restoreBrowser();
  }
});
