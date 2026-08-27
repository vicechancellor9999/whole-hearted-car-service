import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import {
  createLinkedOperationsMutationCoordinator,
  createMockLinkedOperationsStore,
  getMockLinkedOperationsStore,
  isModernParkingSourceFact,
  LINKED_OPERATIONS_STORAGE_KEY,
  task8ChildMutationId,
  validateLinkedOperationsState,
  LinkedApiDomainError,
  type LinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import { ensureMockCleanMoneyDemo } from "../../src/lib/api/mock-clean-demo";
import {
  applyMockQuickOrderAction,
  recordMockQuickPickup,
  type QuickOrderAction,
} from "../../src/lib/api/mock-quick-orders";
import {
  collectMockCanonicalParkingPayment,
  deriveMockCanonicalParkingList,
  previewMockParkingWaiver,
  recordMockParkingSourcePickup,
  type ApplyModernParkingCorrectionInput,
  type ApplyModernParkingCorrectionResult,
  type CanonicalParkingListResponse,
  type ModernParkingCorrectionPreviewDto,
  type PreviewModernParkingCorrectionInput,
} from "../../src/lib/api/mock-parking";
import {
  applyQuickWaiver,
  getQuickParkingInvoiceBundle,
  listQuickParkingCases,
  previewQuickWaiver,
  recordQuickParkingPayment,
  recordQuickPickup,
  syncQuickParkingCases,
} from "../../src/lib/api/mock-quick-parking";
import {
  isModernInvoicePaymentFact,
  isSharedChargeInvoice,
} from "../../src/lib/billing/types";
import type { QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";

interface MemoryStorage extends Storage {
  readonly values: Map<string, string>;
  readonly reads: string[];
  readonly writes: Array<{ key: string; value: string }>;
  readonly removals: string[];
  clearCalls: number;
}

function memoryStorage(values = new Map<string, string>()): MemoryStorage {
  const reads: string[] = [];
  const writes: MemoryStorage["writes"] = [];
  const removals: string[] = [];
  return {
    values,
    reads,
    writes,
    removals,
    clearCalls: 0,
    get length() { return values.size; },
    clear() {
      this.clearCalls += 1;
      values.clear();
    },
    getItem: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      removals.push(key);
      values.delete(key);
    },
    setItem: (key, value) => {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
}

const superadmin = { identity: { id: "emp-001", name: "超级管理员", role: "superadmin" } };
const frontdeskSession = { identity: { id: "test-frontdesk", name: "测试前台", role: "frontdesk_admin" } };
const financeSession = { identity: { id: "test-finance", name: "测试财务", role: "finance" } };
const mechanicSession = { identity: { id: "test-mechanic", name: "测试维修工", role: "mechanic" } };
const forgedFrontdeskSession = { identity: { id: "test-frontdesk", name: "伪造前台", role: "frontdesk_admin" } };
const frontdeskActor = { id: "emp-001", name: "超级管理员", role: "superadmin" as const };
const pickupChannels = [{ kind: "sms" as const, language: "zh" as const, text: "车辆已可取。" }];

function installBrowser(
  storage: Storage,
  scenario: Record<string, unknown>,
): () => void {
  storage.setItem("wh_session", JSON.stringify(superadmin));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

const unit = (id: string, amountJmd = 10_000): Extract<QuickOrderChargeLine, { pricingMode: "unit" }> => ({
  id,
  category: "labor",
  pricingMode: "unit",
  descZh: `工时-${id}`,
  descEn: `Labor-${id}`,
  remarkZh: "",
  remarkEn: "",
  unit: "项",
  unitEn: "item",
  quantity: 1,
  unitPriceJmd: amountJmd,
  unitDiscountJmd: 0,
  pendingQuote: false,
});

function snapshot(store: ReturnType<typeof getMockLinkedOperationsStore>): LinkedOperationsState {
  return store.read((state) => state);
}

async function addSharedQuickOrder(
  orderId: string,
  store = getMockLinkedOperationsStore(),
): Promise<void> {
  await store.mutate((state) => {
    const base = state.quickOrders.find((order) => order.id === "demo-v2-parking-unclaimed")
      ?? state.quickOrders.find((order) => order.status === "submitted")
      ?? state.quickOrders[0]!;
    const teamId = "test-repair-team";
    const assignedAt = "2026-07-01T08:15:00-05:00";
    const acceptedAt = "2026-07-01T08:30:00-05:00";
    const returnedAt = "2026-07-01T08:45:00-05:00";
    const submittedAt = "2026-07-01T09:00:00-05:00";
    const completedHistory = (
      id: string,
      createdAt: string,
      performanceValueJmd: number,
    ) => [
      { id: `${id}-test-ev-1`, from: null, to: "pending_assign" as const, by: "超级管理员", byRole: "frontdesk" as const, at: createdAt },
      { id: `${id}-test-ev-2`, from: "pending_assign" as const, to: "assigned" as const, by: "超级管理员", byRole: "frontdesk" as const, at: assignedAt },
      { id: `${id}-test-ev-3`, from: "assigned" as const, to: "in_repair" as const, by: "维修工", byRole: "mechanic" as const, at: acceptedAt },
      { id: `${id}-test-ev-4`, from: "in_repair" as const, to: "returned" as const, by: "维修工", byRole: "mechanic" as const, at: returnedAt },
      {
        id: `${id}-test-ev-5`,
        from: "returned" as const,
        to: "submitted" as const,
        by: "超级管理员",
        byRole: "frontdesk" as const,
        at: submittedAt,
        roundNumber: 1,
        teamId,
        performanceValueJmd,
      },
    ];
    state.quickOrders = state.quickOrders.map((candidate) => (
      candidate.vehicleId === base.vehicleId && candidate.status !== "submitted"
        ? {
            ...candidate,
            status: "submitted" as const,
            teamId,
            assignedAt,
            acceptedAt,
            returnedAt,
            submittedAt,
            submittedBy: "超级管理员",
            statusHistory: completedHistory(candidate.id, candidate.createdAt, candidate.performanceValueJmd),
          }
        : candidate
    ));
    state.quickOrders.push({
      ...structuredClone(base),
      id: orderId,
      businessOrderNo: `KGN-WH-${orderId.toUpperCase()}`,
      customerId: base.customerId,
      vehicleId: base.vehicleId,
      createdAt: "2026-07-01T08:00:00-05:00",
      teamId,
      assignedAt,
      acceptedAt,
      returnedAt,
      submittedAt,
      submittedBy: "超级管理员",
      status: "submitted",
      statusHistory: completedHistory(orderId, "2026-07-01T08:00:00-05:00", base.performanceValueJmd),
      items: [],
      chargeContract: "shared_v1",
      chargeLines: [unit(`${orderId}-labor`)],
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
  }, { action: "test.public-parking-order.write", consumeWriteFault: false });
}

async function driftSharedOrderLabor(orderId: string, deltaJmd = 1_000): Promise<void> {
  const store = getMockLinkedOperationsStore();
  await store.mutate((state) => {
    const orderIndex = state.quickOrders.findIndex((candidate) => candidate.id === orderId);
    const order = state.quickOrders[orderIndex]!;
    const line = order.chargeLines?.[0];
    if (!line || line.pricingMode !== "unit") throw new Error("expected unit labor line");
    state.quickOrders[orderIndex] = {
      ...order,
      chargeLines: [{ ...line, unitPriceJmd: line.unitPriceJmd + deltaJmd }],
    };
    state.revision += 1;
  }, { action: "test.public-parking-nonparking-drift.write", consumeWriteFault: false });
}

async function canonicalList(): Promise<CanonicalParkingListResponse> {
  return api.parking.list();
}

interface ParkingPaymentSourceProjectionExpectation {
  readonly caseId: string;
  readonly projectionCommitment: string;
}

interface ParkingPaymentCommonInput {
  readonly contract: "parking_payment_collect_v1";
  readonly caseId: string;
  readonly expectedRevision: number;
  readonly expectedSourceRevision: number;
  readonly mutationId: string;
  readonly amountJmd: number;
  readonly method: string;
  readonly note?: string;
}

type CollectCanonicalParkingPaymentInput = ParkingPaymentCommonInput & (
  | {
    readonly status: "claimed";
    readonly invoiceId: string;
    readonly effectiveVersionId: string;
    readonly balanceJmd: number;
  }
  | {
    readonly status: "unclaimed";
    readonly carrierBusinessOrderId: string;
    readonly sourceProjections: ReadonlyArray<ParkingPaymentSourceProjectionExpectation>;
    readonly invoiceSignature?: {
      readonly rawStrokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number; time: number }>>;
    };
  }
);

interface CollectCanonicalParkingPaymentResult {
  readonly revision: number;
  readonly caseId: string;
  readonly claim: {
    readonly caseId: string;
    readonly invoiceId: string;
    readonly effectiveVersionId: string;
    readonly chargeLineId: string;
  };
  readonly activatedInvoice: null | {
    readonly invoiceId: string;
    readonly invoiceNo: string;
    readonly effectiveVersionId: string;
    readonly version: number;
    readonly snapshotCommitment: string;
  };
  readonly sourceTransitions: ReadonlyArray<{
    readonly caseId: string;
    readonly sourceRevisionBefore: number;
    readonly sourceRevisionAfter: number;
    readonly amountJmd: number;
  }>;
  readonly payment: {
    readonly id: string;
    readonly invoiceId: string;
    readonly effectiveVersionId: string;
    readonly amountJmd: number;
    readonly method: string;
    readonly note?: string;
    readonly receivedAt: string;
    readonly receivedBy: string;
  };
  readonly financial: {
    readonly receivableJmd: number;
    readonly grossPaidJmd: number;
    readonly cashRefundedJmd: number;
    readonly netPaidJmd: number;
    readonly balanceJmd: number;
    readonly status: "due" | "settled" | "overpaid";
  };
}

async function collectCanonicalParkingPayment(
  input: CollectCanonicalParkingPaymentInput,
): Promise<CollectCanonicalParkingPaymentResult> {
  return api.parking.recordPayment(input);
}

async function previewCanonicalParkingCorrection(
  input: PreviewModernParkingCorrectionInput,
): Promise<ModernParkingCorrectionPreviewDto> {
  return api.parking.previewWaiver(input);
}

async function applyCanonicalParkingCorrection(
  input: ApplyModernParkingCorrectionInput,
): Promise<ApplyModernParkingCorrectionResult> {
  return api.parking.applyWaiver(input);
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

function resetStorageProbe(storage: MemoryStorage): void {
  storage.reads.length = 0;
  storage.writes.length = 0;
  storage.removals.length = 0;
  storage.clearCalls = 0;
}

function expectNoStorageAccess(storage: MemoryStorage): void {
  expect(storage.reads).toEqual([]);
  expect(storage.writes).toEqual([]);
  expect(storage.removals).toEqual([]);
  expect(storage.clearCalls).toBe(0);
}

function expectNoParkingKeyWrites(storage: MemoryStorage): void {
  expect(storage.writes.filter(({ key }) => (
    key === LINKED_OPERATIONS_STORAGE_KEY || key === "wh_quick_parking_v1"
  ))).toEqual([]);
  expect(storage.removals.filter((key) => (
    key === LINKED_OPERATIONS_STORAGE_KEY || key === "wh_quick_parking_v1"
  ))).toEqual([]);
  expect(storage.clearCalls).toBe(0);
}

function expectLegacyQuickParkingUntouched(storage: MemoryStorage, expectedRaw: string | undefined): void {
  expect(storage.values.get("wh_quick_parking_v1")).toBe(expectedRaw);
  expect(storage.writes.filter(({ key }) => key === "wh_quick_parking_v1")).toEqual([]);
  expect(storage.removals.filter((key) => key === "wh_quick_parking_v1")).toEqual([]);
  expect(storage.clearCalls).toBe(0);
}

async function expectParkingRequestRejectedWithoutWrite(
  storage: MemoryStorage,
  store: ReturnType<typeof getMockLinkedOperationsStore>,
  call: () => Promise<unknown>,
  status: number,
): Promise<void> {
  const before = snapshot(store);
  const primaryBefore = storage.values.get(LINKED_OPERATIONS_STORAGE_KEY);
  const quickParkingBefore = storage.values.get("wh_quick_parking_v1");
  resetStorageProbe(storage);
  await expect(call()).rejects.toMatchObject({ status });
  expect(snapshot(store)).toEqual(before);
  expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
  expect(storage.values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
  expect(storage.writes.filter(({ key }) => (
    key === LINKED_OPERATIONS_STORAGE_KEY || key === "wh_quick_parking_v1"
  ))).toEqual([]);
  expect(storage.removals.filter((key) => (
    key === LINKED_OPERATIONS_STORAGE_KEY || key === "wh_quick_parking_v1"
  ))).toEqual([]);
  expect(storage.clearCalls).toBe(0);
}

function sourceProjectionExpectations(
  list: CanonicalParkingListResponse,
  carrierBusinessOrderId: string,
): ReadonlyArray<ParkingPaymentSourceProjectionExpectation> {
  return list.items
    .filter((item) => item.billing.status === "unclaimed"
      && item.billing.eligibleBusinessOrderIds.includes(carrierBusinessOrderId))
    .map((item) => ({ caseId: item.caseId, projectionCommitment: item.live.projectionCommitment }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function expectExactDataFields(value: object, fields: ReadonlyArray<string>): void {
  expect(Reflect.ownKeys(value).sort()).toEqual([...fields].sort());
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    expect(descriptor, field).toMatchObject({ enumerable: true });
    expect(descriptor && "value" in descriptor, field).toBe(true);
    expect(descriptor && "value" in descriptor ? descriptor.value : undefined, field).not.toBeUndefined();
  }
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
  receipt: LinkedOperationsState["mutationReceipts"][number],
  rewrite: (payload: Record<string, unknown>) => void,
): void {
  if (!receipt.payloadCanonical) throw new Error("expected canonical receipt payload");
  const payload = JSON.parse(receipt.payloadCanonical) as Record<string, unknown>;
  rewrite(payload);
  const payloadCanonical = canonicalJson(payload);
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadCanonical = payloadCanonical;
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadHash = receiptPayloadHash(payloadCanonical);
}

const FRESH_INVOICE_STROKES = [[
  { x: 2, y: 3, time: 1 },
  { x: 7, y: 11, time: 2 },
]];

async function setSharedOrderHighDiscount(
  orderId: string,
  store = getMockLinkedOperationsStore(),
): Promise<void> {
  await store.mutate((state) => {
    const orderIndex = state.quickOrders.findIndex((candidate) => candidate.id === orderId);
    const order = state.quickOrders[orderIndex]!;
    const line = order.chargeLines?.[0];
    if (!line || line.pricingMode !== "unit") throw new Error("expected unit labor line");
    state.quickOrders[orderIndex] = {
      ...order,
      chargeLines: [{ ...line, unitDiscountJmd: 2_500 }],
    };
    state.revision += 1;
  }, { action: "test.public-parking-high-discount.write", consumeWriteFault: false });
}

async function addUnclaimedModernParkingSource(
  orderId: string,
  mutationId: string,
  store = getMockLinkedOperationsStore(),
): Promise<{ readonly caseId: string }> {
  await addSharedQuickOrder(orderId, store);
  const created = await recordMockQuickPickup({
    orderId,
    expectedRevision: snapshot(store).revision,
    mutationId,
    channels: pickupChannels,
  }, frontdeskActor, store);
  return { caseId: created.parkingSource.id };
}

function modernPreviewInput(
  caseId: string,
  mutationId: string,
  store = getMockLinkedOperationsStore(),
): PreviewModernParkingCorrectionInput {
  const current = snapshot(store);
  const source = current.parkingCases.find((candidate) => (
    candidate.id === caseId && isModernParkingSourceFact(candidate)
  ));
  if (!source || !isModernParkingSourceFact(source)) throw new Error("expected modern parking source");
  return {
    caseId,
    expectedRevision: current.revision,
    expectedSourceRevision: source.revision,
    mutationId,
    waiveDays: 1,
    reason: "public canonical correction",
  };
}

function modernApplyInput(
  preview: ModernParkingCorrectionPreviewDto,
  mutationId: string,
): ApplyModernParkingCorrectionInput {
  return {
    caseId: preview.caseId,
    expectedRevision: preview.latestRevision,
    expectedSourceRevision: preview.sourceRevision,
    mutationId,
    previewToken: preview.previewToken,
  };
}

test("canonical parking GET advances only its Jamaica live projection and keeps claimed billing on the immutable Invoice snapshot", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const oldKeySentinel = JSON.stringify({
    revision: 999,
    cases: [{ id: "PRIVATE_OLD_KEY_SENTINEL", finalAmountJmd: 999_999_999 }],
    previews: [{ signatureDataUrl: "PRIVATE_SIGNATURE_SENTINEL" }],
  });
  values.set("wh_quick_parking_v1", oldKeySentinel);
  const scenario: {
    nowMs: number;
    failNext: { byAction: Record<string, string> };
  } = {
    nowMs: Date.parse("2026-08-01T12:00:00-05:00"),
    failNext: { byAction: {} },
  };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await addSharedQuickOrder("qbo-public-parking-read");
    const beforeCreate = snapshot(store);
    const created = await recordMockQuickPickup({
      orderId: "qbo-public-parking-read",
      expectedRevision: beforeCreate.revision,
      mutationId: "public-parking-read-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const unclaimed = await canonicalList();
    const unclaimedItem = unclaimed.items.find((item) => item.caseId === created.parkingSource.id)!;
    expect(unclaimedItem.billing).toEqual({
      status: "unclaimed",
      eligibleBusinessOrderIds: created.parkingSource.eligibleBusinessOrderIds,
    });
    expect(Object.keys(unclaimedItem.billing).sort()).toEqual(["eligibleBusinessOrderIds", "status"]);
    expectExactDataFields(unclaimedItem.billing, ["status", "eligibleBusinessOrderIds"]);
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-public-parking-read",
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-read-v1",
    }, frontdeskActor, store);
    const beforeGet = snapshot(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const first = await canonicalList();
    const firstItem = first.items.find((item) => item.caseId === created.parkingSource.id)!;

    expect(Object.keys(first).sort()).toEqual(["asOf", "contract", "items", "revision"]);
    expect(Object.keys(firstItem).sort()).toEqual([
      "billing", "caseId", "committed", "customerId", "dailyRateJmd", "eligibleBusinessOrderIds",
      "live", "notificationDate", "originBusinessOrderId", "pickupDate", "sourceKind", "vehicleId",
    ]);
    expect(Object.keys(firstItem.committed).sort()).toEqual([
      "chargeableDays", "cumulativeWaivedAmountJmd", "cumulativeWaivedDays", "finalAmountJmd",
      "grossAmountJmd", "sourceAsOf", "sourceRevision",
    ]);
    expect(Object.keys(firstItem.live).sort()).toEqual([
      "asOf", "calendarDate", "chargeableDays", "finalAmountJmd", "grossAmountJmd", "projectionCommitment",
    ]);
    expectExactDataFields(first, ["contract", "revision", "asOf", "items"]);
    expectExactDataFields(firstItem, [
      "sourceKind", "caseId", "vehicleId", "customerId", "originBusinessOrderId",
      "eligibleBusinessOrderIds", "notificationDate", "pickupDate", "dailyRateJmd", "committed", "live", "billing",
    ]);
    expectExactDataFields(firstItem.committed, [
      "sourceRevision", "sourceAsOf", "chargeableDays", "grossAmountJmd",
      "cumulativeWaivedDays", "cumulativeWaivedAmountJmd", "finalAmountJmd",
    ]);
    expectExactDataFields(firstItem.live, [
      "asOf", "calendarDate", "chargeableDays", "grossAmountJmd", "finalAmountJmd", "projectionCommitment",
    ]);
    expect(first).toMatchObject({ contract: "parking_list_v1", revision: beforeGet.revision });
    expect(firstItem.committed).toMatchObject({ chargeableDays: 7, grossAmountJmd: 17_500, finalAmountJmd: 17_500 });
    expect(firstItem.live).toMatchObject({ calendarDate: "2026-08-10", chargeableDays: 7, grossAmountJmd: 17_500, finalAmountJmd: 17_500 });
    expect(firstItem.billing).toMatchObject({
      status: "claimed",
      invoiceId: activation.invoiceId,
      effectiveVersionId: activation.invoiceVersionId,
      snapshotCommitment: activation.snapshotCommitment,
      correctionRequired: false,
      line: {
        sourceRevision: firstItem.committed.sourceRevision,
        amountJmd: 17_500,
      },
      ledger: {
        receivableJmd: 27_500,
        grossPaidJmd: 0,
        cashRefundedJmd: 0,
        netPaidJmd: 0,
        balanceJmd: 27_500,
        status: "due",
      },
    });
    expect(Object.keys(firstItem.billing).sort()).toEqual([
      "correctionRequired", "effectiveVersionId", "invoiceId", "invoiceNo", "ledger", "line",
      "snapshotCommitment", "status",
    ]);
    if (firstItem.billing.status !== "claimed") throw new Error("expected claimed parking billing DTO");
    expect(Object.keys(firstItem.billing.line).sort()).toEqual([
      "amountJmd", "chargeLineId", "sourceAsOf", "sourceRevision",
    ]);
    expect(Object.keys(firstItem.billing.ledger).sort()).toEqual([
      "balanceJmd", "cashRefundedJmd", "grossPaidJmd", "netPaidJmd", "receivableJmd", "status",
    ]);
    expectExactDataFields(firstItem.billing, [
      "status", "invoiceId", "invoiceNo", "effectiveVersionId", "snapshotCommitment", "line", "ledger",
      "correctionRequired",
    ]);
    expectExactDataFields(firstItem.billing.line, [
      "chargeLineId", "sourceRevision", "sourceAsOf", "amountJmd",
    ]);
    expectExactDataFields(firstItem.billing.ledger, [
      "receivableJmd", "grossPaidJmd", "cashRefundedJmd", "netPaidJmd", "balanceJmd", "status",
    ]);

    const sameDay = deriveMockCanonicalParkingList(beforeGet, Date.parse("2026-08-10T23:59:00-05:00"));
    const sameDayItem = sameDay.items.find((item) => item.caseId === created.parkingSource.id)!;
    expect(sameDayItem.live.asOf).not.toBe(firstItem.live.asOf);
    expect(sameDayItem.live.projectionCommitment).toBe(firstItem.live.projectionCommitment);

    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    const second = await canonicalList();
    const secondItem = second.items.find((item) => item.caseId === created.parkingSource.id)!;
    if (secondItem.billing.status !== "claimed") throw new Error("expected claimed parking billing DTO");
    expect(second.revision).toBe(first.revision);
    expect(secondItem.committed).toEqual(firstItem.committed);
    expect(secondItem.live).toMatchObject({ calendarDate: "2026-08-11", chargeableDays: 8, grossAmountJmd: 20_000, finalAmountJmd: 20_000 });
    expect(secondItem.live.projectionCommitment).not.toBe(firstItem.live.projectionCommitment);
    expect(secondItem.billing.line).toEqual(firstItem.billing.line);
    expect(secondItem.billing.ledger).toEqual(firstItem.billing.ledger);
    expect(secondItem.billing.correctionRequired).toBe(true);
    expect(snapshot(store)).toEqual(beforeGet);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
    expect(JSON.stringify(second)).not.toMatch(/PRIVATE_OLD_KEY_SENTINEL|PRIVATE_SIGNATURE_SENTINEL|waiverHistory|waiverAudits|mutationReceipts|payloadCanonical|rawStrokes|administratorSignature/);
    expect(second.items.every((item) => isModernParkingSourceFact(
      beforeGet.parkingCases.find((source) => source.id === item.caseId)!,
    ))).toBe(true);
  } finally {
    restore();
  }
});

test("canonical parking GET binds authorization to invocation and response sessions without canonical writes", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario: { delayMs?: { byAction: Record<string, number> } } = {};
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await ensureMockCleanMoneyDemo(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = values.get("wh_quick_parking_v1");
    const stateBefore = snapshot(store);

    resetStorageProbe(storage);
    const invocation = canonicalList();
    await new Promise((resolve) => setTimeout(resolve, 50));
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    await expect(invocation).rejects.toMatchObject({ status: 403 });
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expect(snapshot(store)).toEqual(stateBefore);
    expectNoParkingKeyWrites(storage);

    storage.setItem("wh_session", JSON.stringify(superadmin));
    scenario.delayMs = { byAction: { "parking.canonicalList.read": 1_000 } };
    resetStorageProbe(storage);
    const response = canonicalList();
    await new Promise((resolve) => setTimeout(resolve, 600));
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    await expect(response).rejects.toMatchObject({ status: 403 });
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expect(snapshot(store)).toEqual(stateBefore);
    expectNoParkingKeyWrites(storage);
  } finally {
    restore();
  }
});

test("official parking waiver preview and apply expose only the modern correction contract", async () => {
  const values = new Map<string, string>();
  const oldKeySentinel = JSON.stringify({ revision: 1, cases: [], previews: [] });
  values.set("wh_quick_parking_v1", oldKeySentinel);
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const source = await addUnclaimedModernParkingSource(
      "qbo-public-parking-official-waiver",
      "public-parking-official-waiver-source",
      store,
    );
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    storage.setItem("wh_session", JSON.stringify(superadmin));
    resetStorageProbe(storage);
    const previewInput = modernPreviewInput(
      source.caseId,
      "public-parking-official-waiver-preview",
      store,
    );
    const preview = await previewCanonicalParkingCorrection(previewInput);
    expect(preview).toMatchObject({
      caseId: source.caseId,
      latestRevision: previewInput.expectedRevision + 1,
      sourceRevision: previewInput.expectedSourceRevision + 1,
      nextSourceRevision: previewInput.expectedSourceRevision + 2,
      parkingAdministratorSignatureRequired: false,
      invoiceSignatureRequired: false,
      claimedInvoiceId: null,
      claimedInvoiceVersionId: null,
      nextInvoiceVersionId: null,
      nextSnapshotCommitment: null,
    });
    const applyInput = modernApplyInput(preview, "public-parking-official-waiver-apply");
    const result = await applyCanonicalParkingCorrection(applyInput);
    expect(result).toMatchObject({
      revision: preview.latestRevision + 1,
      caseId: source.caseId,
      sourceRevision: preview.nextSourceRevision,
      invoiceId: null,
      invoiceVersionId: null,
      parkingDeltaJmd: preview.parkingDeltaJmd,
      parkingCashRefundJmd: preview.parkingCashRefundJmd,
    });
    expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
    expect(storage.writes.filter(({ key }) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.removals.filter((key) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.clearCalls).toBe(0);
    const after = snapshot(store);
    const receipts = after.mutationReceipts.filter((receipt) => (
      receipt.mutationId === previewInput.mutationId || receipt.mutationId === applyInput.mutationId
    ));
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.actorId)).toEqual([superadmin.identity.id, superadmin.identity.id]);
    expect(after.parkingWaiverAudits.find((audit) => audit.mutationId === applyInput.mutationId)?.actorId)
      .toBe(superadmin.identity.id);
  } finally {
    restore();
  }
});

test("official parking waiver preview binds invocation, coordinator, and response sessions", async () => {
  test.setTimeout(30_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const source = await addUnclaimedModernParkingSource(
      "qbo-public-parking-preview-session",
      "public-parking-preview-session-source",
      store,
    );
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");

    const invocationInput = modernPreviewInput(
      source.caseId,
      "public-parking-preview-session-invocation",
      store,
    );
    const beforeInvocation = snapshot(store);
    const primaryBeforeInvocation = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = values.get("wh_quick_parking_v1");
    resetStorageProbe(storage);
    const invocation = previewCanonicalParkingCorrection(invocationInput);
    await new Promise((resolve) => setTimeout(resolve, 50));
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    await expect(invocation).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/身份|会话|登录/),
    });
    expect(snapshot(store)).toEqual(beforeInvocation);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeInvocation);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);

    storage.setItem("wh_session", JSON.stringify(superadmin));
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
    const lockInput = modernPreviewInput(source.caseId, "public-parking-preview-session-lock", store);
    const beforeLockSwitch = snapshot(store);
    const primaryBeforeLock = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    resetStorageProbe(storage);
    let settled = false;
    const lockPending = previewCanonicalParkingCorrection(lockInput);
    void lockPending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settledBeforeRelease = settled;
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    releaseLock();
    await blocker;
    await expect(lockPending).rejects.toMatchObject({ status: 403 });
    expect(settledBeforeRelease, "official preview must wait behind the linked coordinator").toBe(false);
    expect(snapshot(store)).toEqual(beforeLockSwitch);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeLock);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);

    storage.setItem("wh_session", JSON.stringify(superadmin));
    const originalSetItem = storage.setItem.bind(storage);
    let switchOnCanonicalCommit = true;
    storage.setItem = (key: string, value: string): void => {
      originalSetItem(key, value);
      if (switchOnCanonicalCommit && key === LINKED_OPERATIONS_STORAGE_KEY) {
        switchOnCanonicalCommit = false;
        originalSetItem("wh_session", JSON.stringify(frontdeskSession));
      }
    };
    const responseInput = modernPreviewInput(source.caseId, "public-parking-preview-session-response", store);
    resetStorageProbe(storage);
    await expect(previewCanonicalParkingCorrection(responseInput)).rejects.toMatchObject({ status: 403 });
    const committed = snapshot(store);
    const responseReceipt = committed.mutationReceipts.find((receipt) => receipt.mutationId === responseInput.mutationId);
    expect(responseReceipt?.actorId).toBe(superadmin.identity.id);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expect(storage.writes.filter(({ key }) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.removals.filter((key) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.clearCalls).toBe(0);
    storage.setItem = originalSetItem;
    originalSetItem("wh_session", JSON.stringify(superadmin));
    const primaryAfterCommit = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    resetStorageProbe(storage);
    const replay = await previewCanonicalParkingCorrection(responseInput);
    expect(replay).toEqual(committed.mutationReceipts.find((receipt) => (
      receipt.mutationId === responseInput.mutationId
    ))!.result);
    expect(snapshot(store)).toEqual(committed);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryAfterCommit);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);
  } finally {
    restore();
  }
});

test("official parking waiver apply binds invocation, coordinator, and response sessions", async () => {
  test.setTimeout(30_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const source = await addUnclaimedModernParkingSource(
      "qbo-public-parking-apply-session",
      "public-parking-apply-session-source",
      store,
    );
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const preview = await previewMockParkingWaiver(
      modernPreviewInput(source.caseId, "public-parking-apply-session-preview", store),
      frontdeskActor,
      store,
    );
    const base = modernApplyInput(preview, "public-parking-apply-session-invocation");
    const beforeInvocation = snapshot(store);
    const primaryBeforeInvocation = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = values.get("wh_quick_parking_v1");
    resetStorageProbe(storage);
    const invocation = applyCanonicalParkingCorrection(base);
    await new Promise((resolve) => setTimeout(resolve, 50));
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    await expect(invocation).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/身份|会话|登录/),
    });
    expect(snapshot(store)).toEqual(beforeInvocation);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeInvocation);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);

    storage.setItem("wh_session", JSON.stringify(superadmin));
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
    const lockInput = { ...base, mutationId: "public-parking-apply-session-lock" };
    const beforeLockSwitch = snapshot(store);
    const primaryBeforeLock = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    resetStorageProbe(storage);
    let settled = false;
    const lockPending = applyCanonicalParkingCorrection(lockInput);
    void lockPending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settledBeforeRelease = settled;
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    releaseLock();
    await blocker;
    await expect(lockPending).rejects.toMatchObject({ status: 403 });
    expect(settledBeforeRelease, "official apply must wait behind the linked coordinator").toBe(false);
    expect(snapshot(store)).toEqual(beforeLockSwitch);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeLock);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);

    storage.setItem("wh_session", JSON.stringify(superadmin));
    const originalSetItem = storage.setItem.bind(storage);
    let switchOnCanonicalCommit = true;
    storage.setItem = (key: string, value: string): void => {
      originalSetItem(key, value);
      if (switchOnCanonicalCommit && key === LINKED_OPERATIONS_STORAGE_KEY) {
        switchOnCanonicalCommit = false;
        originalSetItem("wh_session", JSON.stringify(frontdeskSession));
      }
    };
    const responseInput = { ...base, mutationId: "public-parking-apply-session-response" };
    resetStorageProbe(storage);
    await expect(applyCanonicalParkingCorrection(responseInput)).rejects.toMatchObject({ status: 403 });
    const committed = snapshot(store);
    const responseReceipt = committed.mutationReceipts.find((receipt) => receipt.mutationId === responseInput.mutationId);
    expect(responseReceipt?.actorId).toBe(superadmin.identity.id);
    expect(committed.parkingWaiverAudits.find((audit) => audit.mutationId === responseInput.mutationId)?.actorId)
      .toBe(superadmin.identity.id);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expect(storage.writes.filter(({ key }) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.removals.filter((key) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.clearCalls).toBe(0);
    storage.setItem = originalSetItem;
    originalSetItem("wh_session", JSON.stringify(superadmin));
    const primaryAfterCommit = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    resetStorageProbe(storage);
    const replay = await applyCanonicalParkingCorrection(responseInput);
    expect(replay).toEqual(committed.mutationReceipts.find((receipt) => (
      receipt.mutationId === responseInput.mutationId
    ))!.result);
    expect(snapshot(store)).toEqual(committed);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryAfterCommit);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);
  } finally {
    restore();
  }
});

test("canonical parking payment rechecks the captured invocation session inside the coordinator lock before receipt replay", async () => {
  test.setTimeout(20_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const coordinator = createLinkedOperationsMutationCoordinator(storage);
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-session-lock";
    await addSharedQuickOrder(orderId, store);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-session-lock-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-session-lock-v1",
    }, frontdeskActor, store);
    const list = deriveMockCanonicalParkingList(snapshot(store), scenario.nowMs);
    const item = list.items.find((candidate) => candidate.caseId === created.parkingSource.id)!;
    if (item.billing.status !== "claimed") throw new Error("expected claimed parking source");
    const input: CollectCanonicalParkingPaymentInput = {
      contract: "parking_payment_collect_v1",
      status: "claimed",
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      mutationId: "public-parking-session-lock-pay",
      invoiceId: item.billing.invoiceId,
      effectiveVersionId: item.billing.effectiveVersionId,
      balanceJmd: item.billing.ledger.balanceJmd,
      amountJmd: 1_000,
      method: "cash",
    };
    let releaseLock!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = coordinator.runExclusive(async () => {
      markEntered();
      await gate;
    });
    await entered;
    let settled = false;
    const pending = collectCanonicalParkingPayment(input).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(settled, "official route must be waiting behind the linked coordinator").toBe(false);
    const beforeSessionSwitch = snapshot(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const quickParkingBefore = values.get("wh_quick_parking_v1");
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    resetStorageProbe(storage);
    releaseLock();
    await blocker;
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(snapshot(store)).toEqual(beforeSessionSwitch);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);
  } finally {
    restore();
  }
});

test("canonical parking payment snapshots caller strokes before waiting for the coordinator lock", async () => {
  test.setTimeout(20_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const coordinator = createLinkedOperationsMutationCoordinator(storage);
    const store = createMockLinkedOperationsStore(storage, { coordinator });
    await store.ready();
    const orderId = "qbo-public-parking-strokes-toctou";
    await addSharedQuickOrder(orderId, store);
    await setSharedOrderHighDiscount(orderId, store);
    const source = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-strokes-toctou-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const list = deriveMockCanonicalParkingList(snapshot(store), scenario.nowMs);
    const item = list.items.find((candidate) => candidate.caseId === source.parkingSource.id)!;
    if (item.billing.status !== "unclaimed") throw new Error("expected unclaimed parking source");
    const mutableStrokes = [[
      { x: 2, y: 3, time: 1 },
      { x: 7, y: 11, time: 2 },
    ]];
    const input: Extract<CollectCanonicalParkingPaymentInput, { status: "unclaimed" }> = {
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      mutationId: "public-parking-strokes-toctou-pay",
      carrierBusinessOrderId: orderId,
      sourceProjections: sourceProjectionExpectations(list, orderId),
      amountJmd: 1_000,
      method: "cash",
      invoiceSignature: { rawStrokes: mutableStrokes },
    };
    let releaseLock!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = coordinator.runExclusive(async () => {
      markEntered();
      await gate;
    });
    await entered;
    const pending = collectMockCanonicalParkingPayment(input, frontdeskActor, store);
    await new Promise((resolve) => setTimeout(resolve, 50));
    mutableStrokes[0]![0]!.x = 999;
    releaseLock();
    await blocker;
    await expect(pending).resolves.toMatchObject({ revision: list.revision + 2 });
    const after = snapshot(store);
    const outer = after.mutationReceipts.find((receipt) => receipt.mutationId === input.mutationId)!;
    const outerPayload = JSON.parse(outer.payloadCanonical!) as {
      invoiceSignature: { rawStrokes: Array<Array<{ x: number }>> };
    };
    expect(outerPayload.invoiceSignature.rawStrokes[0]![0]!.x).toBe(2);
    const signature = after.discountSignatureEvents.find((event) => (
      event.mutationId === task8ChildMutationId(input.mutationId, "invoice-activation")
    ))!;
    expect(signature.rawStrokes[0]![0]!.x).toBe(2);
    expect(() => validateLinkedOperationsState(after)).not.toThrow();
  } finally {
    restore();
  }
});

test("canonical unclaimed parking payment rolls back child facts on write fault and replays exactly after response loss", async () => {
  test.setTimeout(30_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario: {
    nowMs: number;
    failNext: { byAction: Record<string, string> };
  } = {
    nowMs: Date.parse("2026-08-01T12:00:00-05:00"),
    failNext: { byAction: {} },
  };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-fault-replay";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-fault-replay-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const list = await canonicalList();
    const item = list.items.find((candidate) => candidate.caseId === created.parkingSource.id)!;
    if (item.billing.status !== "unclaimed") throw new Error("expected unclaimed parking source");
    const input: CollectCanonicalParkingPaymentInput = {
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      mutationId: "public-parking-fault-replay-pay",
      carrierBusinessOrderId: orderId,
      sourceProjections: sourceProjectionExpectations(list, orderId),
      amountJmd: 1_000,
      method: "cash",
    };
    const before = snapshot(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    storage.writes.length = 0;
    scenario.failNext.byAction["parking.source.pay.write"] = "canonical parking payment write fault";
    await expect(collectCanonicalParkingPayment(input)).rejects.toMatchObject({ status: 503 });
    expect(snapshot(store)).toEqual(before);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);

    scenario.failNext.byAction["parking.source.pay.response"] = "canonical parking payment response loss";
    await expect(collectCanonicalParkingPayment(input)).rejects.toMatchObject({ status: 503 });
    const afterLoss = snapshot(store);
    expect(afterLoss.revision).toBe(before.revision + 2);
    const outerId = input.mutationId;
    const activationChildId = task8ChildMutationId(outerId, "invoice-activation");
    const paymentChildId = task8ChildMutationId(outerId, "invoice-payment");
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === outerId)).toHaveLength(1);
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === activationChildId)).toHaveLength(1);
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === paymentChildId)).toHaveLength(1);
    expect(afterLoss.payments.filter((payment) => (
      isModernInvoicePaymentFact(payment) && payment.mutationId === paymentChildId
    ))).toHaveLength(1);
    expect(afterLoss.invoices.filter((invoice) => (
      isSharedChargeInvoice(invoice) && invoice.businessOrderId === orderId
    ))).toHaveLength(1);
    storage.writes.length = 0;
    const replay = await collectCanonicalParkingPayment(input);
    expect(replay).toEqual((afterLoss.mutationReceipts.find((receipt) => receipt.mutationId === outerId)!.result as {
      publicResult: CollectCanonicalParkingPaymentResult;
    }).publicResult);
    expect(snapshot(store)).toEqual(afterLoss);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);

    const beforePayloadDrift = snapshot(store);
    storage.writes.length = 0;
    await expect(collectCanonicalParkingPayment({
      ...input,
      amountJmd: input.amountJmd + 1,
    })).rejects.toMatchObject({ status: 409 });
    expect(snapshot(store)).toEqual(beforePayloadDrift);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);

    await store.mutate((state) => {
      state.trustedIdentities = state.trustedIdentities.filter((identity) => identity.id !== superadmin.identity.id);
      state.revision += 1;
    }, { action: "test.public-parking-revoke.write", consumeWriteFault: false });
    const revoked = snapshot(store);
    storage.writes.length = 0;
    await expect(collectCanonicalParkingPayment(input)).rejects.toMatchObject({ status: 403 });
    expect(snapshot(store)).toEqual(revoked);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);
  } finally {
    restore();
  }
});

test("canonical parking payment binds invocation and response sessions and rejects unauthorized roles", async () => {
  test.setTimeout(30_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-session-phases";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-session-phases-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-session-phases-v1",
    }, frontdeskActor, store);
    const list = await canonicalList();
    const item = list.items.find((candidate) => candidate.caseId === created.parkingSource.id)!;
    if (item.billing.status !== "claimed") throw new Error("expected claimed parking source");
    const base: Omit<Extract<CollectCanonicalParkingPaymentInput, { status: "claimed" }>, "mutationId"> = {
      contract: "parking_payment_collect_v1",
      status: "claimed",
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      invoiceId: item.billing.invoiceId,
      effectiveVersionId: item.billing.effectiveVersionId,
      balanceJmd: item.billing.ledger.balanceJmd,
      amountJmd: 1_000,
      method: "cash",
    };
    const quickParkingBefore = values.get("wh_quick_parking_v1");
    const beforeInvocationSwitch = snapshot(store);
    resetStorageProbe(storage);
    const invocation = collectCanonicalParkingPayment({
      ...base,
      mutationId: "public-parking-session-invocation",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    storage.setItem("wh_session", JSON.stringify(frontdeskSession));
    await expect(invocation).rejects.toMatchObject({ status: 403 });
    expect(snapshot(store)).toEqual(beforeInvocationSwitch);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);

    storage.setItem("wh_session", JSON.stringify(superadmin));
    const originalSetItem = storage.setItem.bind(storage);
    let switchOnCanonicalCommit = true;
    storage.setItem = (key: string, value: string): void => {
      originalSetItem(key, value);
      if (switchOnCanonicalCommit && key === LINKED_OPERATIONS_STORAGE_KEY) {
        switchOnCanonicalCommit = false;
        originalSetItem("wh_session", JSON.stringify(frontdeskSession));
      }
    };
    const responseInput: Extract<CollectCanonicalParkingPaymentInput, { status: "claimed" }> = {
      ...base,
      mutationId: "public-parking-session-response",
    };
    resetStorageProbe(storage);
    await expect(collectCanonicalParkingPayment(responseInput)).rejects.toMatchObject({ status: 403 });
    const committed = snapshot(store);
    expect(committed.mutationReceipts.filter((receipt) => receipt.mutationId === responseInput.mutationId)).toHaveLength(1);
    expect(committed.payments.filter((payment) => (
      isModernInvoicePaymentFact(payment)
        && payment.mutationId === task8ChildMutationId(responseInput.mutationId, "invoice-payment")
    ))).toHaveLength(1);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expect(storage.writes.filter(({ key }) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.removals.filter((key) => key === "wh_quick_parking_v1")).toEqual([]);
    expect(storage.clearCalls).toBe(0);

    originalSetItem("wh_session", JSON.stringify(superadmin));
    const primaryAfterCommit = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    resetStorageProbe(storage);
    const replay = await collectCanonicalParkingPayment(responseInput);
    expect(replay).toEqual((committed.mutationReceipts.find((receipt) => (
      receipt.mutationId === responseInput.mutationId
    ))!.result as { publicResult: CollectCanonicalParkingPaymentResult }).publicResult);
    expect(snapshot(store)).toEqual(committed);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryAfterCommit);
    expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
    expectNoParkingKeyWrites(storage);

    for (const [label, deniedSession] of [
      ["finance", financeSession],
      ["mechanic", mechanicSession],
      ["forged-name", forgedFrontdeskSession],
    ] as const) {
      originalSetItem("wh_session", JSON.stringify(deniedSession));
      const beforeRoleReject = snapshot(store);
      resetStorageProbe(storage);
      await expect(collectCanonicalParkingPayment({
        ...base,
        expectedRevision: beforeRoleReject.revision,
        mutationId: `public-parking-session-${label}`,
      })).rejects.toMatchObject({ status: 403 });
      expect(snapshot(store)).toEqual(beforeRoleReject);
      expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
      expectNoParkingKeyWrites(storage);
    }
  } finally {
    restore();
  }
});

test("concurrent claimed canonical parking payments allow one CAS winner without mutating the Quick embedded ledger", async () => {
  test.setTimeout(30_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-payment-race";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-payment-race-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-payment-race-v1",
    }, frontdeskActor, store);
    const list = await canonicalList();
    const item = list.items.find((candidate) => candidate.caseId === created.parkingSource.id)!;
    if (item.billing.status !== "claimed") throw new Error("expected claimed parking source");
    const billing = item.billing;
    const common = {
      contract: "parking_payment_collect_v1" as const,
      status: "claimed" as const,
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      invoiceId: billing.invoiceId,
      effectiveVersionId: billing.effectiveVersionId,
      balanceJmd: billing.ledger.balanceJmd,
      amountJmd: 1_000,
      method: "cash",
    };
    const before = snapshot(store);
    const frozenSource = structuredClone(before.parkingCases.find((source) => source.id === item.caseId));
    const frozenInvoice = structuredClone(before.invoices.find((invoice) => invoice.id === billing.invoiceId));
    const frozenClaim = structuredClone(before.activeParkingClaim[item.caseId]);
    const raceIds = ["public-parking-payment-race-a", "public-parking-payment-race-b"] as const;
    const race = await Promise.allSettled(raceIds.map((mutationId) => (
      collectCanonicalParkingPayment({ ...common, mutationId })
    )));
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((race.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const after = snapshot(store);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.parkingCases.find((source) => source.id === item.caseId)).toEqual(frozenSource);
    expect(after.invoices.find((invoice) => invoice.id === billing.invoiceId)).toEqual(frozenInvoice);
    expect(after.activeParkingClaim[item.caseId]).toEqual(frozenClaim);
    expect(after.mutationReceipts.filter((receipt) => raceIds.includes(receipt.mutationId as typeof raceIds[number]))).toHaveLength(1);
    expect(after.payments.filter((payment) => (
      isModernInvoicePaymentFact(payment)
        && raceIds.some((mutationId) => payment.mutationId === task8ChildMutationId(mutationId, "invoice-payment"))
    ))).toHaveLength(1);
    const order = after.quickOrders.find((candidate) => candidate.id === orderId)!;
    expect(order.payments).toEqual([]);
    expect(order.refunds).toEqual([]);
  } finally {
    restore();
  }
});

test("canonical claimed parking payment rolls back a write fault and replays one response-lost payment", async () => {
  test.setTimeout(25_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario: {
    nowMs: number;
    failNext: { byAction: Record<string, string> };
  } = {
    nowMs: Date.parse("2026-08-01T12:00:00-05:00"),
    failNext: { byAction: {} },
  };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-claimed-fault";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-claimed-fault-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-claimed-fault-v1",
    }, frontdeskActor, store);
    const list = await canonicalList();
    const item = list.items.find((candidate) => candidate.caseId === created.parkingSource.id)!;
    if (item.billing.status !== "claimed") throw new Error("expected claimed parking source");
    const input: Extract<CollectCanonicalParkingPaymentInput, { status: "claimed" }> = {
      contract: "parking_payment_collect_v1",
      status: "claimed",
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      mutationId: "public-parking-claimed-fault-pay",
      invoiceId: item.billing.invoiceId,
      effectiveVersionId: item.billing.effectiveVersionId,
      balanceJmd: item.billing.ledger.balanceJmd,
      amountJmd: 1_000,
      method: "cash",
    };
    const before = snapshot(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    scenario.failNext.byAction["parking.source.pay.write"] = "claimed parking payment write fault";
    storage.writes.length = 0;
    await expect(collectCanonicalParkingPayment(input)).rejects.toMatchObject({ status: 503 });
    expect(snapshot(store)).toEqual(before);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);

    scenario.failNext.byAction["parking.source.pay.response"] = "claimed parking payment response loss";
    await expect(collectCanonicalParkingPayment(input)).rejects.toMatchObject({ status: 503 });
    const afterLoss = snapshot(store);
    expect(afterLoss.revision).toBe(before.revision + 1);
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);
    expect(afterLoss.payments.filter((payment) => (
      isModernInvoicePaymentFact(payment)
        && payment.mutationId === task8ChildMutationId(input.mutationId, "invoice-payment")
    ))).toHaveLength(1);
    storage.writes.length = 0;
    const replay = await collectCanonicalParkingPayment(input);
    expect(replay).toEqual((afterLoss.mutationReceipts.find((receipt) => receipt.mutationId === input.mutationId)!.result as {
      publicResult: CollectCanonicalParkingPaymentResult;
    }).publicResult);
    expect(snapshot(store)).toEqual(afterLoss);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);
  } finally {
    restore();
  }
});

test("canonical claimed parking payment appends one modern payment without mutating source, Invoice, version, or claim", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const oldKeySentinel = JSON.stringify({ revision: 91, cases: [], previews: [] });
  values.set("wh_quick_parking_v1", oldKeySentinel);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-claimed-pay";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-claimed-pay-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-claimed-pay-v1",
    }, frontdeskActor, store);
    await driftSharedOrderLabor(orderId, -9_000);
    const list = await canonicalList();
    const item = list.items.find((candidate) => candidate.caseId === created.parkingSource.id)!;
    if (item.billing.status !== "claimed") throw new Error("expected claimed public parking item");
    const billing = item.billing;
    expect(billing.correctionRequired).toBe(false);

    const before = snapshot(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    const frozenSource = structuredClone(before.parkingCases.find((source) => source.id === item.caseId));
    const frozenInvoice = structuredClone(before.invoices.find((invoice) => invoice.id === billing.invoiceId));
    const frozenClaim = structuredClone(before.activeParkingClaim[item.caseId]);
    const frozenOrder = structuredClone(before.quickOrders.find((order) => order.id === orderId)!);
    const driftedLabor = frozenOrder.chargeLines?.[0];
    if (!driftedLabor || driftedLabor.pricingMode !== "unit") throw new Error("expected drifted unit labor");
    expect(driftedLabor.unitPriceJmd).toBe(1_000);
    expect(3_000).toBeGreaterThan(driftedLabor.unitPriceJmd);
    expect(frozenOrder.payments).toEqual([]);
    expect(frozenOrder.refunds).toEqual([]);
    storage.writes.length = 0;

    const result = await collectCanonicalParkingPayment({
      contract: "parking_payment_collect_v1",
      status: "claimed",
      caseId: item.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      mutationId: "public-parking-claimed-pay",
      invoiceId: billing.invoiceId,
      effectiveVersionId: billing.effectiveVersionId,
      balanceJmd: billing.ledger.balanceJmd,
      amountJmd: 3_000,
      method: "cash",
      note: "parking desk payment",
    });

    const after = snapshot(store);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.parkingCases.find((source) => source.id === item.caseId)).toEqual(frozenSource);
    expect(after.invoices.find((invoice) => invoice.id === billing.invoiceId)).toEqual(frozenInvoice);
    expect(after.activeParkingClaim[item.caseId]).toEqual(frozenClaim);
    expect(after.quickOrders.find((order) => order.id === orderId)).toEqual(frozenOrder);
    expect(after.payments).toHaveLength(before.payments.length + 1);
    const payment = after.payments.at(-1)!;
    expect(isModernInvoicePaymentFact(payment)).toBe(true);
    if (!isModernInvoicePaymentFact(payment)) throw new Error("expected modern parking payment fact");
    expect(payment).toMatchObject({
      invoiceId: billing.invoiceId,
      invoiceVersionId: billing.effectiveVersionId,
      mutationId: task8ChildMutationId("public-parking-claimed-pay", "invoice-payment"),
      amountJmd: 3_000,
      method: "cash",
    });
    expect(result).toMatchObject({
      revision: after.revision,
      caseId: item.caseId,
      claim: {
        caseId: item.caseId,
        invoiceId: billing.invoiceId,
        effectiveVersionId: billing.effectiveVersionId,
        chargeLineId: billing.line.chargeLineId,
      },
      activatedInvoice: null,
      sourceTransitions: [],
      payment: {
        id: payment.id,
        invoiceId: billing.invoiceId,
        effectiveVersionId: billing.effectiveVersionId,
        amountJmd: 3_000,
        method: "cash",
        note: "parking desk payment",
        receivedAt: payment.receivedAt,
        receivedBy: payment.receivedBy,
      },
      financial: {
        receivableJmd: billing.ledger.receivableJmd,
        grossPaidJmd: 3_000,
        cashRefundedJmd: 0,
        netPaidJmd: 3_000,
        balanceJmd: billing.ledger.balanceJmd - 3_000,
        status: "due",
      },
    });
    expectExactDataFields(result, [
      "revision", "caseId", "claim", "activatedInvoice", "sourceTransitions", "payment", "financial",
    ]);
    expectExactDataFields(result.claim, ["caseId", "invoiceId", "effectiveVersionId", "chargeLineId"]);
    expectExactDataFields(result.payment, [
      "id", "invoiceId", "effectiveVersionId", "amountJmd", "method", "note", "receivedAt", "receivedBy",
    ]);
    expectExactDataFields(result.financial, [
      "receivableJmd", "grossPaidJmd", "cashRefundedJmd", "netPaidJmd", "balanceJmd", "status",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/committedRevision|mutationId|"snapshot"/);
    expect(after.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.pay")).toHaveLength(1);
    const outerReceipt = after.mutationReceipts.find((receipt) => (
      receipt.operation === "parking.source.pay" && receipt.mutationId === "public-parking-claimed-pay"
    ))!;
    const paymentChildReceipt = after.mutationReceipts.find((receipt) => (
      receipt.operation === "billing.invoice.payment"
        && receipt.mutationId === task8ChildMutationId("public-parking-claimed-pay", "invoice-payment")
    ))!;
    expect(outerReceipt.committedRevision).toBe(before.revision + 1);
    expect(paymentChildReceipt.committedRevision).toBe(before.revision + 1);
    expect(outerReceipt.result).toEqual({
      receiptContract: "parking_payment_collect_receipt_v1",
      activationChildMutationId: null,
      paymentChildMutationId: paymentChildReceipt.mutationId,
      publicResult: result,
    });
    expect(() => validateLinkedOperationsState(after)).not.toThrow();
    const missingOuter = structuredClone(after);
    missingOuter.mutationReceipts = missingOuter.mutationReceipts.filter((receipt) => receipt.id !== outerReceipt.id);
    expect(() => validateLinkedOperationsState(missingOuter)).toThrow(/parking|payment|receipt|outer|收款/i);
    const driftedChildBinding = structuredClone(after);
    const driftedOuter = driftedChildBinding.mutationReceipts.find((receipt) => receipt.id === outerReceipt.id)!;
    (driftedOuter.result as { paymentChildMutationId: string }).paymentChildMutationId = "orphan-child";
    expect(() => validateLinkedOperationsState(driftedChildBinding)).toThrow(/parking|payment|receipt|child|收款/i);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toHaveLength(1);
    expect(storage.writes.filter((write) => write.key === "wh_quick_parking_v1")).toEqual([]);
    expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).not.toBe(primaryBefore);
  } finally {
    restore();
  }
});

test("canonical unclaimed parking payment atomically activates every eligible source, claims them, and records payment without legacy-key writes", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const oldKeySentinel = JSON.stringify({ revision: 92, cases: [{ id: "LEGACY_SENTINEL" }], previews: [] });
  values.set("wh_quick_parking_v1", oldKeySentinel);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const carrierBusinessOrderId = "qbo-public-parking-unclaimed-carrier";
    const secondOriginOrderId = "qbo-public-parking-unclaimed-second";
    await addSharedQuickOrder(carrierBusinessOrderId);
    const first = await recordMockQuickPickup({
      orderId: carrierBusinessOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-unclaimed-first-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await recordMockParkingSourcePickup({
      caseId: first.parkingSource.id,
      expectedRevision: snapshot(store).revision,
      expectedSourceRevision: first.parkingSource.revision,
      mutationId: "public-parking-unclaimed-first-close",
    }, frontdeskActor, store);
    await addSharedQuickOrder(secondOriginOrderId);
    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    const second = await recordMockQuickPickup({
      orderId: secondOriginOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-unclaimed-second-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-21T12:00:00-05:00");
    const list = await canonicalList();
    const sourceProjections = sourceProjectionExpectations(list, carrierBusinessOrderId);
    expect(sourceProjections.map((projection) => projection.caseId)).toEqual([
      first.parkingSource.id,
      second.parkingSource.id,
    ].sort());
    const target = list.items.find((item) => item.caseId === first.parkingSource.id)!;
    const liveNonTarget = list.items.find((item) => item.caseId === second.parkingSource.id)!;
    expect(target.billing.status).toBe("unclaimed");
    expect(liveNonTarget.billing.status).toBe("unclaimed");
    expect(liveNonTarget.live.finalAmountJmd).toBeGreaterThan(liveNonTarget.committed.finalAmountJmd);

    const before = snapshot(store);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    expect(before.invoices.filter((invoice) => (
      isSharedChargeInvoice(invoice) && invoice.businessOrderId === carrierBusinessOrderId
    ))).toEqual([]);
    storage.writes.length = 0;

    const result = await collectCanonicalParkingPayment({
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: target.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: target.committed.sourceRevision,
      mutationId: "public-parking-unclaimed-pay",
      carrierBusinessOrderId,
      sourceProjections,
      amountJmd: 5_000,
      method: "card",
    });

    const after = snapshot(store);
    expect(after.revision).toBe(before.revision + 2);
    const ownerInvoices = after.invoices.filter((invoice) => (
      isSharedChargeInvoice(invoice) && invoice.businessOrderId === carrierBusinessOrderId
    ));
    expect(ownerInvoices).toHaveLength(1);
    const invoice = ownerInvoices[0]!;
    if (!isSharedChargeInvoice(invoice)) throw new Error("expected shared canonical Invoice");
    const effective = invoice.versions.find((version) => version.id === invoice.financiallyEffectiveVersionId)!;
    const parkingLines = effective.snapshot.lines.filter((line) => line.pricingMode === "parking_projection");
    expect(parkingLines.map((line) => line.parkingCaseId).sort()).toEqual(
      sourceProjections.map((projection) => projection.caseId),
    );
    expect(parkingLines.find((line) => line.parkingCaseId === target.caseId)?.amountJmd).toBe(
      target.live.finalAmountJmd,
    );
    expect(parkingLines.find((line) => line.parkingCaseId === liveNonTarget.caseId)?.amountJmd).toBe(
      liveNonTarget.live.finalAmountJmd,
    );
    for (const projection of sourceProjections) {
      expect(after.activeParkingClaim[projection.caseId]).toMatchObject({
        logicalInvoiceId: invoice.id,
        financiallyEffectiveVersionId: effective.id,
      });
    }
    expect(after.payments).toHaveLength(before.payments.length + 1);
    const payment = after.payments.at(-1)!;
    expect(isModernInvoicePaymentFact(payment)).toBe(true);
    if (!isModernInvoicePaymentFact(payment)) throw new Error("expected modern parking payment fact");
    expect(payment).toMatchObject({
      invoiceId: invoice.id,
      invoiceVersionId: effective.id,
      mutationId: task8ChildMutationId("public-parking-unclaimed-pay", "invoice-payment"),
      amountJmd: 5_000,
      method: "card",
    });
    expect(result).toMatchObject({
      revision: after.revision,
      caseId: target.caseId,
      claim: {
        caseId: target.caseId,
        invoiceId: invoice.id,
        effectiveVersionId: effective.id,
        chargeLineId: after.activeParkingClaim[target.caseId]!.chargeLineId,
      },
      activatedInvoice: {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        effectiveVersionId: effective.id,
        version: effective.version,
        snapshotCommitment: effective.snapshotCommitment,
      },
      payment: {
        id: payment.id,
        invoiceId: invoice.id,
        effectiveVersionId: effective.id,
        amountJmd: 5_000,
        method: "card",
        receivedAt: payment.receivedAt,
        receivedBy: payment.receivedBy,
      },
    });
    expectExactDataFields(result, [
      "revision", "caseId", "claim", "activatedInvoice", "sourceTransitions", "payment", "financial",
    ]);
    expectExactDataFields(result.claim, ["caseId", "invoiceId", "effectiveVersionId", "chargeLineId"]);
    if (result.activatedInvoice === null) throw new Error("expected activated Invoice summary");
    expectExactDataFields(result.activatedInvoice, [
      "invoiceId", "invoiceNo", "effectiveVersionId", "version", "snapshotCommitment",
    ]);
    for (const transition of result.sourceTransitions) {
      expectExactDataFields(transition, [
        "caseId", "sourceRevisionBefore", "sourceRevisionAfter", "amountJmd",
      ]);
    }
    expectExactDataFields(result.payment, [
      "id", "invoiceId", "effectiveVersionId", "amountJmd", "method", "receivedAt", "receivedBy",
    ]);
    expectExactDataFields(result.financial, [
      "receivableJmd", "grossPaidJmd", "cashRefundedJmd", "netPaidJmd", "balanceJmd", "status",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/committedRevision|mutationId|"snapshot"/);
    expect(after.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.pay")).toHaveLength(1);
    const activationChildReceipt = after.mutationReceipts.find((receipt) => (
      receipt.operation === "billing.invoice.activate"
        && receipt.mutationId === task8ChildMutationId("public-parking-unclaimed-pay", "invoice-activation")
    ))!;
    const paymentChildReceipt = after.mutationReceipts.find((receipt) => (
      receipt.operation === "billing.invoice.payment"
        && receipt.mutationId === task8ChildMutationId("public-parking-unclaimed-pay", "invoice-payment")
    ))!;
    const outerReceipt = after.mutationReceipts.find((receipt) => (
      receipt.operation === "parking.source.pay" && receipt.mutationId === "public-parking-unclaimed-pay"
    ))!;
    expect(activationChildReceipt.committedRevision).toBe(before.revision + 1);
    expect(paymentChildReceipt.committedRevision).toBe(before.revision + 2);
    expect(outerReceipt.committedRevision).toBe(before.revision + 2);
    expect(outerReceipt.result).toEqual({
      receiptContract: "parking_payment_collect_receipt_v1",
      activationChildMutationId: activationChildReceipt.mutationId,
      paymentChildMutationId: paymentChildReceipt.mutationId,
      publicResult: result,
    });
    expect(result.sourceTransitions).toEqual([{
      caseId: liveNonTarget.caseId,
      sourceRevisionBefore: liveNonTarget.committed.sourceRevision,
      sourceRevisionAfter: liveNonTarget.committed.sourceRevision + 1,
      amountJmd: liveNonTarget.live.finalAmountJmd,
    }]);
    expect(() => validateLinkedOperationsState(after)).not.toThrow();
    const orphanOuter = structuredClone(after);
    orphanOuter.mutationReceipts.push({
      ...structuredClone(outerReceipt),
      id: "public-parking-orphan-outer",
      mutationId: "public-parking-orphan-outer",
    });
    expect(() => validateLinkedOperationsState(orphanOuter)).toThrow(/parking|payment|receipt|outer|orphan|收款/i);
    for (const coordinatedMutation of ["shrink", "drift-second-commitment"] as const) {
      const corrupted = structuredClone(after);
      const corruptedOuter = corrupted.mutationReceipts.find((receipt) => receipt.id === outerReceipt.id)!;
      rewriteReceiptPayload(corruptedOuter, (payload) => {
        const projections = payload.sourceProjections as Array<{ caseId: string; projectionCommitment: string }>;
        if (coordinatedMutation === "shrink") {
          payload.sourceProjections = projections.filter((projection) => projection.caseId === target.caseId);
        } else {
          payload.sourceProjections = projections.map((projection) => (
            projection.caseId === liveNonTarget.caseId
              ? { ...projection, projectionCommitment: "fnv1a64:0000000000000000" }
              : projection
          ));
        }
      });
      expect(() => validateLinkedOperationsState(corrupted)).toThrow(/parking|projection|source|payment|收款/i);
    }
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toHaveLength(1);
    expect(storage.writes.filter((write) => write.key === "wh_quick_parking_v1")).toEqual([]);
    expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).not.toBe(primaryBefore);
  } finally {
    restore();
  }
});

test("canonical unclaimed parking payment requires the exact live projection set for every eligible source", async () => {
  test.setTimeout(30_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const oldKeySentinel = JSON.stringify({ revision: 96, cases: [{ id: "EXACT_SET_SENTINEL" }], previews: [] });
  values.set("wh_quick_parking_v1", oldKeySentinel);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const carrierBusinessOrderId = "qbo-public-parking-exact-set-carrier";
    const secondOriginOrderId = "qbo-public-parking-exact-set-second";
    await addSharedQuickOrder(carrierBusinessOrderId);
    const first = await recordMockQuickPickup({
      orderId: carrierBusinessOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-exact-set-first-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await recordMockParkingSourcePickup({
      caseId: first.parkingSource.id,
      expectedRevision: snapshot(store).revision,
      expectedSourceRevision: first.parkingSource.revision,
      mutationId: "public-parking-exact-set-first-close",
    }, frontdeskActor, store);
    await addSharedQuickOrder(secondOriginOrderId);
    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    const second = await recordMockQuickPickup({
      orderId: secondOriginOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-exact-set-second-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-21T12:00:00-05:00");
    const list = await canonicalList();
    const projections = sourceProjectionExpectations(list, carrierBusinessOrderId);
    expect(projections.map((projection) => projection.caseId)).toEqual([
      first.parkingSource.id,
      second.parkingSource.id,
    ].sort());
    const firstItem = list.items.find((item) => item.caseId === first.parkingSource.id)!;
    const secondItem = list.items.find((item) => item.caseId === second.parkingSource.id)!;
    expect(secondItem.live.finalAmountJmd).toBeGreaterThan(secondItem.committed.finalAmountJmd);
    const base = {
      contract: "parking_payment_collect_v1" as const,
      status: "unclaimed" as const,
      caseId: firstItem.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: firstItem.committed.sourceRevision,
      carrierBusinessOrderId,
      amountJmd: 1_000,
      method: "cash",
    };
    const candidates: ReadonlyArray<{
      name: string;
      status: number;
      sourceProjections: ReadonlyArray<ParkingPaymentSourceProjectionExpectation>;
    }> = [
      { name: "nonempty-subset", status: 409, sourceProjections: projections.slice(0, 1) },
      {
        name: "duplicate",
        status: 400,
        sourceProjections: [...projections, projections[0]!].sort((left, right) => left.caseId.localeCompare(right.caseId)),
      },
      {
        name: "foreign-extra",
        status: 409,
        sourceProjections: [...projections, {
          caseId: "parking-source-foreign-r999",
          projectionCommitment: "fnv1a64:1111111111111111",
        }].sort((left, right) => left.caseId.localeCompare(right.caseId)),
      },
      {
        name: "second-commitment-drift",
        status: 409,
        sourceProjections: projections.map((projection) => (
          projection.caseId === secondItem.caseId
            ? { ...projection, projectionCommitment: "fnv1a64:2222222222222222" }
            : projection
        )),
      },
    ];
    for (const candidate of candidates) {
      await test.step(candidate.name, async () => {
        const before = snapshot(store);
        const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
        storage.writes.length = 0;
        await expect(collectCanonicalParkingPayment({
          ...base,
          mutationId: `public-parking-exact-set-${candidate.name}`,
          sourceProjections: candidate.sourceProjections,
        })).rejects.toMatchObject({ status: candidate.status });
        expect(snapshot(store)).toEqual(before);
        expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
        expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
        expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);
      });
    }

    const beforeRace = snapshot(store);
    const raceIds = ["public-parking-exact-set-race-a", "public-parking-exact-set-race-b"] as const;
    storage.writes.length = 0;
    const race = await Promise.allSettled(raceIds.map((mutationId) => (
      collectCanonicalParkingPayment({
        ...base,
        mutationId,
        sourceProjections: projections,
      })
    )));
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((race.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const afterRace = snapshot(store);
    expect(afterRace.revision).toBe(beforeRace.revision + 2);
    const ownerInvoices = afterRace.invoices.filter((invoice) => (
      isSharedChargeInvoice(invoice) && invoice.businessOrderId === carrierBusinessOrderId
    ));
    expect(ownerInvoices).toHaveLength(1);
    const ownerInvoice = ownerInvoices[0]!;
    if (!isSharedChargeInvoice(ownerInvoice)) throw new Error("expected one shared Invoice race winner");
    expect(ownerInvoice.versions).toHaveLength(1);
    const effective = ownerInvoice.versions[0]!;
    for (const projection of projections) {
      expect(afterRace.activeParkingClaim[projection.caseId]).toMatchObject({
        logicalInvoiceId: ownerInvoice.id,
        financiallyEffectiveVersionId: effective.id,
      });
    }
    const winningOuterReceipts = afterRace.mutationReceipts.filter((receipt) => (
      raceIds.includes(receipt.mutationId as typeof raceIds[number])
    ));
    expect(winningOuterReceipts).toHaveLength(1);
    const winningOuterId = winningOuterReceipts[0]!.mutationId;
    expect(afterRace.mutationReceipts.filter((receipt) => (
      receipt.mutationId === task8ChildMutationId(winningOuterId, "invoice-activation")
        || receipt.mutationId === task8ChildMutationId(winningOuterId, "invoice-payment")
    ))).toHaveLength(2);
    expect(afterRace.payments.filter((payment) => (
      isModernInvoicePaymentFact(payment)
        && payment.mutationId === task8ChildMutationId(winningOuterId, "invoice-payment")
    ))).toHaveLength(1);
    const invoiceNumberMatch = /^KGN-WH-INV-(\d{4})(\d{2})(\d{2})(\d{5})$/u.exec(ownerInvoice.invoiceNo);
    expect(invoiceNumberMatch).not.toBeNull();
    const invoiceBusinessDate = `${invoiceNumberMatch![1]}${invoiceNumberMatch![2]}${invoiceNumberMatch![3]}`;
    const invoiceSequence = afterRace.billingDocumentSequences.find((sequence) => (
      sequence.businessDate === invoiceBusinessDate
    ));
    expect(invoiceSequence).toBeDefined();
    expect(invoiceSequence!.lastAllocated).toBe(Number(invoiceNumberMatch![4]));
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toHaveLength(1);
    expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
  } finally {
    restore();
  }
});

test("canonical parking payment requires fresh strokes for a discounted V1 but exempts and preserves a parking-only Vnext", async () => {
  test.setTimeout(20_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario: {
    nowMs: number;
    failNext: { byAction: Record<string, string> };
  } = {
    nowMs: Date.parse("2026-08-01T12:00:00-05:00"),
    failNext: { byAction: {} },
  };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();

    const freshOrderId = "qbo-public-parking-discount-v1";
    await addSharedQuickOrder(freshOrderId);
    await setSharedOrderHighDiscount(freshOrderId);
    const freshSource = await recordMockQuickPickup({
      orderId: freshOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-discount-v1-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    const freshList = await canonicalList();
    const freshItem = freshList.items.find((item) => item.caseId === freshSource.parkingSource.id)!;
    if (freshItem.billing.status !== "unclaimed") throw new Error("expected fresh unclaimed source");
    const freshBase = {
      contract: "parking_payment_collect_v1" as const,
      status: "unclaimed" as const,
      caseId: freshItem.caseId,
      expectedRevision: freshList.revision,
      expectedSourceRevision: freshItem.committed.sourceRevision,
      carrierBusinessOrderId: freshOrderId,
      sourceProjections: sourceProjectionExpectations(freshList, freshOrderId),
      amountJmd: 1_000,
      method: "cash",
    };
    const beforeMissing = snapshot(store);
    const primaryBeforeMissing = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    await expect(collectCanonicalParkingPayment({
      ...freshBase,
      mutationId: "public-parking-discount-v1-missing-signature",
    })).rejects.toMatchObject({ status: 400 });
    expect(snapshot(store)).toEqual(beforeMissing);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeMissing);

    const signedFreshInput = {
      ...freshBase,
      mutationId: "public-parking-discount-v1-pay",
      invoiceSignature: { rawStrokes: FRESH_INVOICE_STROKES },
    };
    const beforeSignedWriteFault = snapshot(store);
    const primaryBeforeSignedWriteFault = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    scenario.failNext.byAction["parking.source.pay.write"] = "discounted V1 parking payment write fault";
    storage.writes.length = 0;
    await expect(collectCanonicalParkingPayment(signedFreshInput)).rejects.toMatchObject({ status: 503 });
    expect(snapshot(store)).toEqual(beforeSignedWriteFault);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeSignedWriteFault);
    expect(snapshot(store).discountSignatureEvents).toEqual(beforeSignedWriteFault.discountSignatureEvents);
    expect(snapshot(store).billingDocumentSequences).toEqual(beforeSignedWriteFault.billingDocumentSequences);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);

    const freshResult = await collectCanonicalParkingPayment(signedFreshInput);
    expect(freshResult.activatedInvoice?.version).toBe(1);
    const afterFresh = snapshot(store);
    expect(afterFresh.discountSignatureEvents.filter((event) => (
      event.mutationId === task8ChildMutationId("public-parking-discount-v1-pay", "invoice-activation")
    ))).toHaveLength(1);
    const signatureDrift = structuredClone(afterFresh);
    const signatureOuter = signatureDrift.mutationReceipts.find((receipt) => (
      receipt.operation === "parking.source.pay" && receipt.mutationId === "public-parking-discount-v1-pay"
    ))!;
    rewriteReceiptPayload(signatureOuter, (payload) => {
      payload.invoiceSignature = { rawStrokes: [[
        { x: 103, y: 107, time: 101 },
        { x: 109, y: 113, time: 102 },
      ]] };
    });
    expect(() => validateLinkedOperationsState(signatureDrift)).toThrow(/parking|signature|activation|payment|收款|签/i);
    const currentFreshSource = afterFresh.parkingCases.find((candidate) => (
      candidate.id === freshSource.parkingSource.id && isModernParkingSourceFact(candidate)
    ));
    if (!currentFreshSource || !isModernParkingSourceFact(currentFreshSource)) {
      throw new Error("expected current fresh parking source");
    }
    await recordMockParkingSourcePickup({
      caseId: currentFreshSource.id,
      expectedRevision: snapshot(store).revision,
      expectedSourceRevision: currentFreshSource.revision,
      mutationId: "public-parking-discount-v1-close",
    }, frontdeskActor, store);

    const parkingOnlyOrderId = "qbo-public-parking-discount-vnext";
    await addSharedQuickOrder(parkingOnlyOrderId);
    await setSharedOrderHighDiscount(parkingOnlyOrderId);
    const existingSource = await recordMockQuickPickup({
      orderId: parkingOnlyOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-discount-vnext-existing-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const firstVersion = await activateMockQuickInvoiceSnapshot({
      orderId: parkingOnlyOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-discount-vnext-v1",
      adjustments: [{ id: "rounding-preserved", kind: "rounding", amountJmd: 100 }],
      signature: { rawStrokes: [[
        { x: 19, y: 23, time: 31 },
        { x: 29, y: 31, time: 32 },
      ]] },
    }, frontdeskActor, store);
    const existingAfterActivation = snapshot(store).parkingCases.find((candidate) => (
      candidate.id === existingSource.parkingSource.id && isModernParkingSourceFact(candidate)
    ));
    if (!existingAfterActivation || !isModernParkingSourceFact(existingAfterActivation)) {
      throw new Error("expected existing claimed parking source");
    }
    await recordMockParkingSourcePickup({
      caseId: existingAfterActivation.id,
      expectedRevision: snapshot(store).revision,
      expectedSourceRevision: existingAfterActivation.revision,
      mutationId: "public-parking-discount-vnext-existing-close",
    }, frontdeskActor, store);
    const beforeOuterInvoice = snapshot(store).invoices.find((candidate) => candidate.id === firstVersion.invoiceId)!;
    if (!isSharedChargeInvoice(beforeOuterInvoice)) throw new Error("expected shared Invoice before outer payment");
    const frozenVersionsBeforeOuter = structuredClone(beforeOuterInvoice.versions);
    const effectiveBeforeOuterId = beforeOuterInvoice.financiallyEffectiveVersionId;
    const originOrderId = "qbo-public-parking-discount-vnext-origin";
    await addSharedQuickOrder(originOrderId);
    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    const laterSource = await recordMockQuickPickup({
      orderId: originOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-discount-vnext-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    const laterList = await canonicalList();
    const laterItem = laterList.items.find((item) => item.caseId === laterSource.parkingSource.id)!;
    if (laterItem.billing.status !== "unclaimed") throw new Error("expected later unclaimed source");
    const parkingOnlyBase = {
      contract: "parking_payment_collect_v1" as const,
      status: "unclaimed" as const,
      caseId: laterItem.caseId,
      expectedRevision: laterList.revision,
      expectedSourceRevision: laterItem.committed.sourceRevision,
      carrierBusinessOrderId: parkingOnlyOrderId,
      sourceProjections: sourceProjectionExpectations(laterList, parkingOnlyOrderId),
      amountJmd: 1_000,
      method: "cash",
    };
    const beforeUnnecessary = snapshot(store);
    await expect(collectCanonicalParkingPayment({
      ...parkingOnlyBase,
      mutationId: "public-parking-discount-vnext-unnecessary-signature",
      invoiceSignature: { rawStrokes: FRESH_INVOICE_STROKES },
    })).rejects.toMatchObject({ status: 400 });
    expect(snapshot(store)).toEqual(beforeUnnecessary);

    const signatureCountBefore = beforeUnnecessary.discountSignatureEvents.length;
    const parkingOnly = await collectCanonicalParkingPayment({
      ...parkingOnlyBase,
      mutationId: "public-parking-discount-vnext-pay",
    });
    expect(parkingOnly.activatedInvoice?.version).toBe(3);
    const afterParkingOnly = snapshot(store);
    expect(afterParkingOnly.discountSignatureEvents).toHaveLength(signatureCountBefore);
    const invoice = afterParkingOnly.invoices.find((candidate) => candidate.id === firstVersion.invoiceId)!;
    if (!isSharedChargeInvoice(invoice)) throw new Error("expected shared Invoice");
    const v1 = invoice.versions.find((version) => version.id === firstVersion.invoiceVersionId)!;
    const v2 = invoice.versions.find((version) => version.id === effectiveBeforeOuterId)!;
    const v3 = invoice.versions.find((version) => version.id === parkingOnly.activatedInvoice?.effectiveVersionId)!;
    expect(invoice.versions.slice(0, frozenVersionsBeforeOuter.length)).toEqual(frozenVersionsBeforeOuter);
    expect(v3.snapshot.lines.filter((line) => line.pricingMode !== "parking_projection")).toEqual(
      v1.snapshot.lines.filter((line) => line.pricingMode !== "parking_projection"),
    );
    expect(v3.snapshot.adjustments).toEqual(v2.snapshot.adjustments);
    expect(v3.snapshot.lines.filter((line) => line.pricingMode === "parking_projection").map((line) => (
      line.parkingCaseId
    )).sort()).toEqual([existingSource.parkingSource.id, laterSource.parkingSource.id].sort());
    expect(afterParkingOnly.activeParkingClaim[existingSource.parkingSource.id]).toMatchObject({
      logicalInvoiceId: invoice.id,
      financiallyEffectiveVersionId: v3.id,
    });
    expect(afterParkingOnly.activeParkingClaim[laterSource.parkingSource.id]).toMatchObject({
      logicalInvoiceId: invoice.id,
      financiallyEffectiveVersionId: v3.id,
    });
    expect(() => validateLinkedOperationsState(afterParkingOnly)).not.toThrow();
  } finally {
    restore();
  }
});

test("canonical parking payment rejects non-closed, stale, drifted, and overpaying intents with whole-state zero writes", async () => {
  test.setTimeout(20_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const oldKeySentinel = JSON.stringify({ revision: 93, cases: [], previews: [] });
  values.set("wh_quick_parking_v1", oldKeySentinel);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-pay-reject";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-pay-reject-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const unclaimedList = await canonicalList();
    const unclaimed = unclaimedList.items.find((item) => item.caseId === created.parkingSource.id)!;
    if (unclaimed.billing.status !== "unclaimed") throw new Error("expected unclaimed parking DTO");
    const unclaimedBase: CollectCanonicalParkingPaymentInput = {
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: unclaimed.caseId,
      expectedRevision: unclaimedList.revision,
      expectedSourceRevision: unclaimed.committed.sourceRevision,
      mutationId: "public-parking-reject-unclaimed-base",
      carrierBusinessOrderId: orderId,
      sourceProjections: sourceProjectionExpectations(unclaimedList, orderId),
      amountJmd: 1_000,
      method: "cash",
    };
    const expectRejectedWithoutWrite = async (
      raw: Record<string, unknown>,
      status: number,
    ): Promise<void> => {
      const before = snapshot(store);
      const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
      storage.writes.length = 0;
      await expect(collectCanonicalParkingPayment(
        raw as unknown as CollectCanonicalParkingPaymentInput,
      )).rejects.toMatchObject({ status });
      expect(snapshot(store)).toEqual(before);
      expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
      expect(values.get("wh_quick_parking_v1")).toBe(oldKeySentinel);
      expect(storage.writes).toEqual([]);
    };

    await expectRejectedWithoutWrite({
      ...unclaimedBase,
      mutationId: "public-parking-reject-live-drift",
      sourceProjections: [{ caseId: unclaimed.caseId, projectionCommitment: "sha256-stale-live" }],
    }, 409);
    await expectRejectedWithoutWrite({
      ...unclaimedBase,
      mutationId: "public-parking-reject-cherry-pick",
      sourceProjections: [],
    }, 409);

    const beforeReservedChild = snapshot(store);
    const primaryBeforeReservedChild = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    storage.writes.length = 0;
    await expect(activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: beforeReservedChild.revision,
      mutationId: task8ChildMutationId("caller-controlled", "invoice-activation"),
    }, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
    expect(snapshot(store)).toEqual(beforeReservedChild);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeReservedChild);
    expect(storage.writes).toEqual([]);

    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-pay-reject-v1",
    }, frontdeskActor, store);
    const claimedList = await canonicalList();
    const claimed = claimedList.items.find((item) => item.caseId === created.parkingSource.id)!;
    if (claimed.billing.status !== "claimed") throw new Error("expected claimed parking DTO");
    const claimedBase: CollectCanonicalParkingPaymentInput = {
      contract: "parking_payment_collect_v1",
      status: "claimed",
      caseId: claimed.caseId,
      expectedRevision: claimedList.revision,
      expectedSourceRevision: claimed.committed.sourceRevision,
      mutationId: "public-parking-reject-claimed-base",
      invoiceId: claimed.billing.invoiceId,
      effectiveVersionId: claimed.billing.effectiveVersionId,
      balanceJmd: claimed.billing.ledger.balanceJmd,
      amountJmd: 1_000,
      method: "cash",
    };

    const beforeReservedPayment = snapshot(store);
    const primaryBeforeReservedPayment = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    storage.writes.length = 0;
    await expect(recordMockInvoicePayment({
      invoiceId: claimed.billing.invoiceId,
      expectedRevision: beforeReservedPayment.revision,
      mutationId: task8ChildMutationId("caller-controlled", "invoice-payment"),
      amountJmd: 1_000,
      method: "cash",
    }, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
    expect(snapshot(store)).toEqual(beforeReservedPayment);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBeforeReservedPayment);
    expect(storage.writes).toEqual([]);

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly status: number;
      readonly value: Record<string, unknown>;
    }> = [
      {
        name: "extra-field",
        status: 400,
        value: { ...claimedBase, mutationId: "public-parking-reject-extra", sourceAmountJmd: 17_500 },
      },
      {
        name: "reserved-child-namespace",
        status: 400,
        value: {
          ...claimedBase,
          mutationId: task8ChildMutationId("caller-controlled", "invoice-payment"),
        },
      },
      {
        name: "mixed-branch",
        status: 400,
        value: {
          ...claimedBase,
          mutationId: "public-parking-reject-mixed",
          carrierBusinessOrderId: orderId,
          sourceProjections: [],
        },
      },
      {
        name: "global-revision",
        status: 409,
        value: { ...claimedBase, mutationId: "public-parking-reject-global", expectedRevision: claimedList.revision - 1 },
      },
      {
        name: "source-revision",
        status: 409,
        value: {
          ...claimedBase,
          mutationId: "public-parking-reject-source-revision",
          expectedSourceRevision: claimed.committed.sourceRevision - 1,
        },
      },
      {
        name: "claim-owner",
        status: 409,
        value: { ...claimedBase, mutationId: "public-parking-reject-claim", invoiceId: "invoice-stale" },
      },
      {
        name: "effective-version",
        status: 409,
        value: { ...claimedBase, mutationId: "public-parking-reject-version", effectiveVersionId: "version-stale" },
      },
      {
        name: "ledger-balance",
        status: 409,
        value: {
          ...claimedBase,
          mutationId: "public-parking-reject-ledger",
          balanceJmd: claimed.billing.ledger.balanceJmd - 1,
        },
      },
      {
        name: "overpay",
        status: 400,
        value: {
          ...claimedBase,
          mutationId: "public-parking-reject-overpay",
          amountJmd: claimed.billing.ledger.balanceJmd + 1,
        },
      },
    ];
    for (const candidate of cases) {
      await test.step(candidate.name, async () => {
        await expectRejectedWithoutWrite(candidate.value, candidate.status);
      });
    }

    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    await expectRejectedWithoutWrite({
      ...claimedBase,
      mutationId: "public-parking-reject-claimed-live-drift",
    }, 409);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");

    await recordMockParkingSourcePickup({
      caseId: claimed.caseId,
      expectedRevision: snapshot(store).revision,
      expectedSourceRevision: claimed.committed.sourceRevision,
      mutationId: "public-parking-reject-close-first-episode",
    }, frontdeskActor, store);
    const laterOriginOrderId = "qbo-public-parking-pay-reject-later";
    await addSharedQuickOrder(laterOriginOrderId);
    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    const later = await recordMockQuickPickup({
      orderId: laterOriginOrderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-reject-later-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    await driftSharedOrderLabor(orderId);
    const driftedList = await canonicalList();
    const drifted = driftedList.items.find((item) => item.caseId === later.parkingSource.id)!;
    if (drifted.billing.status !== "unclaimed") throw new Error("expected later unclaimed parking source");
    await expectRejectedWithoutWrite({
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: drifted.caseId,
      mutationId: "public-parking-reject-nonparking-drift",
      expectedRevision: driftedList.revision,
      expectedSourceRevision: drifted.committed.sourceRevision,
      carrierBusinessOrderId: orderId,
      sourceProjections: sourceProjectionExpectations(driftedList, orderId),
      amountJmd: 1_000,
      method: "cash",
    }, 409);
  } finally {
    restore();
  }
});

test("parking-only collection rejects an existing claimed projection that drifted overnight before creating a child version", async () => {
  test.setTimeout(20_000);
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-existing-claim-drift";
    await addSharedQuickOrder(orderId);
    const created = await recordMockQuickPickup({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-existing-claim-drift-source",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: snapshot(store).revision,
      mutationId: "public-parking-existing-claim-drift-v1",
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-11T12:00:00-05:00");
    const staleDraft = snapshot(store);
    const existingSource = staleDraft.parkingCases.find((candidate) => (
      candidate.id === created.parkingSource.id && isModernParkingSourceFact(candidate)
    ));
    if (!existingSource || !isModernParkingSourceFact(existingSource)) {
      throw new Error("expected existing claimed source");
    }
    const syntheticClosedCandidate = {
      ...structuredClone(existingSource),
      id: `${existingSource.id}-synthetic-closed-candidate`,
      pickupDate: "2026-08-10",
    };
    staleDraft.parkingCases.push(syntheticClosedCandidate);
    const staleList = deriveMockCanonicalParkingList(staleDraft, scenario.nowMs);
    const claimed = staleList.items.find((item) => item.caseId === existingSource.id)!;
    const target = staleList.items.find((item) => item.caseId === syntheticClosedCandidate.id)!;
    if (claimed.billing.status !== "claimed" || target.billing.status !== "unclaimed") {
      throw new Error("expected one stale claim and one unclaimed candidate");
    }
    expect(claimed.billing.correctionRequired).toBe(true);
    const staleBefore = structuredClone(staleDraft);
    const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
    storage.writes.length = 0;
    const staleHarnessStore = {
      ready: async () => undefined,
      read: <T,>(selector: (state: LinkedOperationsState) => T): T => structuredClone(selector(staleDraft)),
      mutate: async () => { throw new Error("stale harness forbids direct writes"); },
      mutateIdempotently: async <T,>(
        receiptInput: {
          mutationId: string;
          operation: string;
          actorId: string;
          payload: unknown;
          recordedAt: string;
        },
        mutation: (draft: LinkedOperationsState) => T | Promise<T>,
        options?: { preReceiptGuard?: (state: LinkedOperationsState) => void | Promise<void> },
      ) => {
        await options?.preReceiptGuard?.(staleDraft);
        const result = await mutation(staleDraft);
        return {
          result,
          replayed: false,
          receipt: {
            id: receiptInput.mutationId,
            mutationId: receiptInput.mutationId,
            operation: receiptInput.operation,
            actorId: receiptInput.actorId,
            payloadHash: "stale-harness",
            result,
            committedRevision: staleDraft.revision,
            committedAt: receiptInput.recordedAt,
          },
        };
      },
      getReadDelay: () => 0,
      nowMs: () => scenario.nowMs,
      createDraftChildStore: (draft: LinkedOperationsState, nowMs: number) => (
        store.createDraftChildStore(draft, nowMs)
      ),
    } as unknown as typeof store;
    await expect(collectMockCanonicalParkingPayment({
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: target.caseId,
      expectedRevision: staleDraft.revision,
      expectedSourceRevision: target.committed.sourceRevision,
      mutationId: "public-parking-existing-claim-drift-pay",
      carrierBusinessOrderId: orderId,
      sourceProjections: [{
        caseId: target.caseId,
        projectionCommitment: target.live.projectionCommitment,
      }],
      amountJmd: 1_000,
      method: "cash",
    }, frontdeskActor, staleHarnessStore)).rejects.toMatchObject({ status: 409 });
    expect(staleDraft).toEqual(staleBefore);
    expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.writes.filter((write) => write.key === LINKED_OPERATIONS_STORAGE_KEY)).toEqual([]);
  } finally {
    restore();
  }
});

test("official parking payment rejects legacy, mixed, extra, and missing-after-JSON bodies before P or Q writes", async () => {
  const values = new Map<string, string>();
  values.set("wh_quick_parking_v1", JSON.stringify({ revision: 1, cases: [], previews: [] }));
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const orderId = "qbo-public-parking-payment-closed";
    const source = await addUnclaimedModernParkingSource(
      orderId,
      "public-parking-payment-closed-source",
      store,
    );
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const list = deriveMockCanonicalParkingList(snapshot(store), scenario.nowMs);
    const item = list.items.find((candidate) => candidate.caseId === source.caseId)!;
    if (item.billing.status !== "unclaimed") throw new Error("expected unclaimed source");
    const valid: Extract<CollectCanonicalParkingPaymentInput, { status: "unclaimed" }> = {
      contract: "parking_payment_collect_v1",
      status: "unclaimed",
      caseId: source.caseId,
      expectedRevision: list.revision,
      expectedSourceRevision: item.committed.sourceRevision,
      mutationId: "public-parking-payment-closed-valid",
      carrierBusinessOrderId: orderId,
      sourceProjections: sourceProjectionExpectations(list, orderId),
      amountJmd: 1_000,
      method: "cash",
    };
    // Descriptors do not survive the HTTP JSON boundary. Accessor/hidden/symbol
    // rejection belongs to the direct domain normalizer tests, not this route.
    const variants: ReadonlyArray<Record<string, unknown>> = [
      { caseId: source.caseId, amountJmd: 1_000, method: "cash" },
      { ...valid, mutationId: "public-parking-payment-closed-mixed", invoiceId: "forbidden-branch" },
      { ...valid, mutationId: "public-parking-payment-closed-extra", unexpected: true },
      { ...valid, mutationId: "public-parking-payment-closed-undefined", amountJmd: undefined },
    ];
    for (const [index, body] of variants.entries()) {
      await test.step(`payment body ${index + 1}`, async () => {
        await expectParkingRequestRejectedWithoutWrite(
          storage,
          store,
          () => api.parking.recordPayment(body as unknown as CollectCanonicalParkingPaymentInput),
          400,
        );
      });
    }
  } finally {
    restore();
  }
});

test("official parking waiver preview rejects legacy, mixed, extra, and missing-after-JSON bodies before P or Q writes", async () => {
  const values = new Map<string, string>();
  values.set("wh_quick_parking_v1", JSON.stringify({ revision: 1, cases: [], previews: [] }));
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const source = await addUnclaimedModernParkingSource(
      "qbo-public-parking-preview-closed",
      "public-parking-preview-closed-source",
      store,
    );
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const valid = modernPreviewInput(source.caseId, "public-parking-preview-closed-valid", store);
    const variants: ReadonlyArray<Record<string, unknown>> = [
      { caseId: source.caseId, waiveDays: 1, reason: "legacy shape" },
      { ...valid, mutationId: "public-parking-preview-closed-mixed", previewToken: "wrong-branch" },
      { ...valid, mutationId: "public-parking-preview-closed-extra", unexpected: true },
      { ...valid, mutationId: "public-parking-preview-closed-undefined", reason: undefined },
    ];
    for (const [index, body] of variants.entries()) {
      await test.step(`preview body ${index + 1}`, async () => {
        await expectParkingRequestRejectedWithoutWrite(
          storage,
          store,
          () => api.parking.previewWaiver(body as unknown as PreviewModernParkingCorrectionInput),
          400,
        );
      });
    }
  } finally {
    restore();
  }
});

test("official parking waiver apply rejects legacy, mixed, extra, and missing-after-JSON bodies before P or Q writes", async () => {
  const values = new Map<string, string>();
  values.set("wh_quick_parking_v1", JSON.stringify({ revision: 1, cases: [], previews: [] }));
  const storage = memoryStorage(values);
  const scenario = { nowMs: Date.parse("2026-08-01T12:00:00-05:00") };
  const restore = installBrowser(storage, scenario);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    const source = await addUnclaimedModernParkingSource(
      "qbo-public-parking-apply-closed",
      "public-parking-apply-closed-source",
      store,
    );
    scenario.nowMs = Date.parse("2026-08-10T12:00:00-05:00");
    const preview = await previewMockParkingWaiver(
      modernPreviewInput(source.caseId, "public-parking-apply-closed-preview", store),
      frontdeskActor,
      store,
    );
    const valid = modernApplyInput(preview, "public-parking-apply-closed-valid");
    const variants: ReadonlyArray<Record<string, unknown>> = [
      {
        caseId: source.caseId,
        waiveDays: 1,
        reason: "legacy shape",
        expectedRevision: preview.latestRevision,
        previewToken: preview.previewToken,
      },
      { ...valid, mutationId: "public-parking-apply-closed-mixed", waiveDays: 1, reason: "wrong branch" },
      { ...valid, mutationId: "public-parking-apply-closed-extra", unexpected: true },
      { ...valid, mutationId: "public-parking-apply-closed-undefined", previewToken: undefined },
    ];
    for (const [index, body] of variants.entries()) {
      await test.step(`apply body ${index + 1}`, async () => {
        await expectParkingRequestRejectedWithoutWrite(
          storage,
          store,
          () => api.parking.applyWaiver(body as unknown as ApplyModernParkingCorrectionInput),
          400,
        );
      });
    }
  } finally {
    restore();
  }
});

test("retired canonical aliases, legacy invoice, and legacy pickup routes return 410 before any storage access", async () => {
  test.setTimeout(20_000);
  const values = new Map<string, string>([
    [LINKED_OPERATIONS_STORAGE_KEY, "PRIMARY_SENTINEL_MUST_NOT_BE_READ"],
    ["wh_quick_parking_v1", "QUICK_PARKING_SENTINEL_MUST_NOT_BE_READ"],
  ]);
  const storage = memoryStorage(values);
  const restore = installBrowser(storage, {});
  try {
    const rawClient = loadClientWithRawMockRequest();
    const baseline = new Map(values);
    const routes = [
      { name: "canonical GET", path: "/api/parking/canonical", method: "GET" },
      { name: "canonical root POST", path: "/api/parking/canonical", method: "POST" },
      { name: "canonical payment POST", path: "/api/parking/canonical/PARK-retired/payments", method: "POST" },
      { name: "legacy invoice GET", path: "/api/parking/PARK-retired/invoice", method: "GET" },
      { name: "legacy pickup POST", path: "/api/parking/PARK-retired/pickup", method: "POST" },
    ] as const;
    for (const route of routes) {
      await test.step(route.name, async () => {
        resetStorageProbe(storage);
        await expect(rawClient.__rawMockRequest(route.path, {
          method: route.method,
          ...(route.method === "POST" ? { body: "{}" } : {}),
        })).rejects.toMatchObject({ status: 410 });
        expectNoStorageAccess(storage);
        expect(storage.values).toEqual(baseline);
      });
    }
  } finally {
    restore();
  }
});

test("all retired wh_quick_parking_v1 operational exports return 410 before swallowing BAD_JSON or touching storage", async () => {
  const badJson = '{"revision":1,"cases":[{"id":"qpark-broken"}],"previews":[';
  const values = new Map<string, string>([
    [LINKED_OPERATIONS_STORAGE_KEY, "PRIMARY_SENTINEL_MUST_NOT_BE_READ"],
    ["wh_quick_parking_v1", badJson],
  ]);
  const storage = memoryStorage(values);
  const restore = installBrowser(storage, {});
  try {
    const baseline = new Map(values);
    const operations: ReadonlyArray<{ name: string; call: () => unknown | Promise<unknown> }> = [
      { name: "sync", call: () => syncQuickParkingCases([]) },
      { name: "list", call: () => listQuickParkingCases([]) },
      {
        name: "preview",
        call: () => previewQuickWaiver({ caseId: "PARK-retired", waiveDays: 1, reason: "retired" }),
      },
      {
        name: "apply",
        call: () => applyQuickWaiver({
          caseId: "PARK-retired",
          previewToken: "retired-token",
          expectedRevision: 1,
          waiveDays: 1,
          reason: "retired",
        }, "retired actor"),
      },
      {
        name: "pickup",
        call: () => recordQuickPickup({
          caseId: "PARK-retired",
          outstandingBalanceJmd: 0,
          creditEligible: false,
        }, "retired actor"),
      },
      {
        name: "payment",
        call: () => recordQuickParkingPayment({
          caseId: "PARK-retired",
          amountJmd: 1_000,
          method: "cash",
        }, "retired actor"),
      },
      { name: "invoice bundle", call: () => getQuickParkingInvoiceBundle("PARK-retired") },
    ];
    for (const operation of operations) {
      await test.step(operation.name, async () => {
        resetStorageProbe(storage);
        await expect(Promise.resolve().then(operation.call)).rejects.toMatchObject({ status: 410 });
        expectNoStorageAccess(storage);
        expect(storage.values).toEqual(baseline);
      });
    }
  } finally {
    restore();
  }
});

for (const actionKind of ["record_pickup", "cancel_pickup"] as const) {
  for (const surface of ["official route", "direct action"] as const) {
    test(`${surface} retires QuickOrder ${actionKind} with 410 and whole-state P/Q zero writes`, async () => {
      const values = new Map<string, string>();
      const storage = memoryStorage(values);
      const restore = installBrowser(storage, {});
      try {
        const store = getMockLinkedOperationsStore();
        await store.ready();
        const orderId = `qbo-public-retired-${actionKind}-${surface.replace(" ", "-")}`;
        await addSharedQuickOrder(orderId, store);
        if (actionKind === "cancel_pickup") {
          await store.mutate((state) => {
            const order = state.quickOrders.find((candidate) => candidate.id === orderId)!;
            (order as typeof order & { pickedUpAt: string; pickedUpBy: string }).pickedUpAt = "2026-08-10T12:00:00-05:00";
            (order as typeof order & { pickedUpAt: string; pickedUpBy: string }).pickedUpBy = "超级管理员";
            state.revision += 1;
          }, { action: "test.public-retired-pickup-fixture.write", consumeWriteFault: false });
        }
        const action: QuickOrderAction = { kind: actionKind };
        const before = snapshot(store);
        const primaryBefore = values.get(LINKED_OPERATIONS_STORAGE_KEY);
        const quickParkingBefore = values.get("wh_quick_parking_v1");
        resetStorageProbe(storage);
        const call = surface === "official route"
          ? () => api.quickOrders.action(orderId, action, "frontdesk")
          : () => applyMockQuickOrderAction(orderId, action, "超级管理员", "frontdesk", store);
        await expect(call()).rejects.toMatchObject({ status: 410 });
        expect(snapshot(store)).toEqual(before);
        expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
        expect(values.get("wh_quick_parking_v1")).toBe(quickParkingBefore);
        expect(storage.writes.filter(({ key }) => (
          key === LINKED_OPERATIONS_STORAGE_KEY || key === "wh_quick_parking_v1"
        ))).toEqual([]);
        expect(storage.removals.filter((key) => (
          key === LINKED_OPERATIONS_STORAGE_KEY || key === "wh_quick_parking_v1"
        ))).toEqual([]);
        expect(storage.clearCalls).toBe(0);
      } finally {
        restore();
      }
    });
  }
}
