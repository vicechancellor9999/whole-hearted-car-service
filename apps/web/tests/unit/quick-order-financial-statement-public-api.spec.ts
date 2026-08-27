import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoiceLineRefund,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import {
  createMockLinkedOperationsStore,
  getMockLinkedOperationsStore,
  LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY,
  LINKED_OPERATIONS_STORAGE_KEY,
  validateLinkedOperationsState,
  type LinkedOperationsState,
  type MockLinkedOperationsStore,
} from "../../src/lib/api/mock-orders";
import { recordMockParkingSourcePickup } from "../../src/lib/api/mock-parking";
import { ensureMockCleanMoneyDemo } from "../../src/lib/api/mock-clean-demo";
import * as quickOrderDomain from "../../src/lib/api/mock-quick-orders";
import { recordMockQuickPickup } from "../../src/lib/api/mock-quick-orders";
import type { QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";

type Store = ReturnType<typeof createMockLinkedOperationsStore>;

const frontdeskActor = {
  id: "emp-001",
  name: "超级管理员",
  role: "superadmin" as const,
};

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
  const reads: string[] = [];
  const operations: MemoryStorage["operations"] = [];
  return {
    values,
    reads,
    operations,
    get length() { return values.size; },
    clear: () => {
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
const mechanicSession = {
  identity: { id: "test-mechanic", name: "测试维修工", role: "mechanic" },
};
const partsSession = {
  identity: { id: "test-parts", name: "测试配件员", role: "parts" },
};

const opaqueStatementOrderIds = [
  { orderId: ".", segment: "u002e" },
  { orderId: "..", segment: "u002e002e" },
  { orderId: "u002e", segment: "u00750030003000320065" },
  {
    orderId: "qbo/%2F ?#测试",
    segment: "u00710062006f002f0025003200460020003f00236d4b8bd5",
  },
  { orderId: "qbo-\uD800", segment: "u00710062006f002dd800" },
] as const;

function installBrowser(
  storage: MemoryStorage,
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

function linkedStorageOperations(storage: MemoryStorage): MemoryStorage["operations"] {
  return storage.operations.filter((operation) => (
    operation.kind === "clear"
    || operation.key === LINKED_OPERATIONS_STORAGE_KEY
    || operation.key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

function linkedStorageReads(storage: MemoryStorage): string[] {
  return storage.reads.filter((key) => (
    key === LINKED_OPERATIONS_STORAGE_KEY
    || key === LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY
  ));
}

function stateSnapshot(store: MockLinkedOperationsStore): LinkedOperationsState {
  return store.read((state) => state, "test.quick-financial-statement.snapshot");
}

function mutationPayloadHash(canonical: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function fixedClockStore(): Store {
  const store = createMockLinkedOperationsStore(memoryStorage());
  return {
    ...store,
    nowMs: () => Date.parse("2026-08-22T12:00:00-05:00"),
  };
}

const unit = (
  id: string,
  category: "labor" | "parts",
  unitPriceJmd: number,
  quantity = 1,
  unitDiscountJmd = 0,
): Extract<QuickOrderChargeLine, { pricingMode: "unit" }> => ({
  id,
  category,
  pricingMode: "unit",
  descZh: `${category}-${id}`,
  descEn: `${category}-${id}`,
  remarkZh: `${id}-remark-zh`,
  remarkEn: `${id}-remark-en`,
  unit: "项",
  unitEn: "item",
  quantity,
  unitPriceJmd,
  unitDiscountJmd,
  pendingQuote: false,
});

const fixed = (
  id: string,
  amountJmd: number,
): Extract<QuickOrderChargeLine, { pricingMode: "fixed_total" }> => ({
  id,
  category: "other_service",
  pricingMode: "fixed_total",
  code: "towing",
  descZh: "拖车",
  descEn: "Towing",
  remarkZh: "固定费用",
  remarkEn: "Fixed charge",
  amountJmd,
});

async function addSharedQuickOrder(
  store: MockLinkedOperationsStore,
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
      createdAt: "2026-08-20T09:00:00-05:00",
      teamId: "test-repair-team",
      mechanicName: "测试维修班组",
      assignedAt: "2026-08-20T09:10:00-05:00",
      acceptedAt: "2026-08-20T09:20:00-05:00",
      returnedAt: "2026-08-20T11:50:00-05:00",
      submittedAt: "2026-08-20T12:00:00-05:00",
      submittedBy: "超级管理员",
      status: "submitted",
      statusHistory: [
        { id: `${orderId}-ev-1`, from: null, to: "pending_assign", by: "超级管理员", byRole: "frontdesk", at: "2026-08-20T09:00:00-05:00" },
        { id: `${orderId}-ev-2`, from: "returned", to: "submitted", by: "超级管理员", byRole: "frontdesk", at: "2026-08-20T12:00:00-05:00", roundNumber: 1, teamId: "test-repair-team", performanceValueJmd: base.performanceValueJmd },
      ],
      items: [],
      chargeContract: "shared_v1",
      chargeLines: structuredClone(lines),
      laborDiscountJmd: 0,
      partsDiscountJmd: 0,
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
  }, { action: "test.quick-financial-statement-source.write", consumeWriteFault: false });
}

async function prepareCanonicalHistoryStore(
  store: Store,
  orderId: string,
): Promise<Readonly<{
  invoiceId: string;
  invoiceVersionId: string;
  paymentId: string;
  refundId: string;
}>> {
  await store.ready();
  await addSharedQuickOrder(store, orderId, [unit(`${orderId}-line`, "labor", 5_000, 2)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: `${orderId}-activate-v1`,
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const payment = await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: `${orderId}-payment-v1`,
    amountJmd: 4_000,
    method: "cash",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    chargeLineId: `${orderId}-line`,
    refundQuantity: 1,
    method: "cash",
    reason: `${orderId} canonical refund`,
    expectedRevision: state.revision,
    mutationId: `${orderId}-refund-v1`,
  }, frontdeskActor, store);
  return {
    invoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    paymentId: payment.id,
    refundId: refund.id,
  };
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
  expect(ownKeys.every((key) => typeof key === "string"), `${label} own keys`).toBe(true);
  expect(ownKeys.filter((key): key is string => typeof key === "string").sort(), `${label} fields`)
    .toEqual([...expected].sort());
  expect(Object.getPrototypeOf(record), `${label} prototype`).toBe(Object.prototype);
  for (const field of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    expect(descriptor, `${label}.${field}`).toMatchObject({ enumerable: true });
    expect(descriptor && "value" in descriptor, `${label}.${field} data field`).toBe(true);
    expect(descriptor && "value" in descriptor ? descriptor.value : undefined, `${label}.${field}`).not.toBeUndefined();
  }
  return record;
}

const STATEMENT_KEYS = ["contract", "revision", "order", "source", "charges", "ledger", "entries"] as const;
const ORDER_KEYS = [
  "id", "businessOrderNo", "customerId", "vehicleId", "status", "voidedAt", "pickedUpAt", "paidInFullAt",
] as const;
const LEDGER_KEYS = [
  "invoiceTotalJmd", "receivableJmd", "grossPaidJmd", "cashRefundedJmd",
  "receivableReductionJmd", "netPaidJmd", "balanceJmd", "paymentStatus",
  "settlementStatus", "hasPaymentHistory",
] as const;
const CANONICAL_UNIT_LINE_KEYS = [
  "pricingMode", "chargeLineId", "category", "descZh", "descEn", "remarkZh", "remarkEn",
  "unit", "unitEn", "quantity", "unitPriceJmd", "unitDiscountJmd", "finalUnitPriceJmd", "finalLineJmd",
] as const;
const CANONICAL_FIXED_LINE_KEYS = [
  "pricingMode", "chargeLineId", "category", "code", "descZh", "descEn", "remarkZh", "remarkEn", "amountJmd",
] as const;
const CANONICAL_PARKING_LINE_KEYS = [
  "pricingMode", "chargeLineId", "category", "code", "descZh", "descEn", "remarkZh", "remarkEn",
  "parkingCaseId", "sourceRevision", "asOf", "amountJmd",
] as const;
const CANONICAL_TOTAL_KEYS = [
  "laborGrossJmd", "laborDiscountJmd", "laborNetJmd", "partsGrossJmd", "partsDiscountJmd", "partsNetJmd",
  "otherFeeTotalJmd", "parkingTotalJmd", "totalDiscountJmd", "chargeSubtotalJmd", "adjustmentsJmd", "grandTotalJmd",
] as const;
const SHARED_UNIT_LINE_KEYS = [
  "id", "category", "pricingMode", "descZh", "descEn", "remarkZh", "remarkEn", "unit", "unitEn",
  "quantity", "unitPriceJmd", "unitDiscountJmd", "pendingQuote",
] as const;
const SHARED_FIXED_LINE_KEYS = [
  "id", "category", "pricingMode", "code", "descZh", "descEn", "remarkZh", "remarkEn", "amountJmd",
] as const;
const SHARED_TOTAL_KEYS = [
  "laborGrossJmd", "laborDiscountJmd", "laborNetJmd", "partsGrossJmd", "partsDiscountJmd", "partsNetJmd",
  "otherFeeTotalJmd", "parkingTotalJmd", "totalDiscountJmd", "pendingPartsCount", "chargeSubtotalJmd", "grandTotalJmd",
] as const;
const LEGACY_ITEM_KEYS = [
  "id", "descZh", "descEn", "remarkZh", "remarkEn", "category", "unit", "unitEn",
  "unitPriceJmd", "quantity", "pendingQuote",
] as const;
const LEGACY_TOTAL_KEYS = [
  "laborGrossJmd", "partsGrossJmd", "laborDiscountJmd", "partsDiscountJmd", "totalDiscountJmd", "grandTotalJmd",
] as const;
const PAYMENT_ENTRY_KEYS = [
  "kind", "provenance", "sequence", "paymentId", "invoiceVersionId", "amountJmd", "occurredAt", "method", "actorName", "note",
] as const;
const CANONICAL_REFUND_ENTRY_KEYS = [
  "kind", "accounting", "sequence", "refundId", "invoiceVersionId", "line", "refundQuantity", "wholeLine",
  "receivableReductionJmd", "cashRefundJmd", "occurredAt", "method", "actorName", "reason",
] as const;

function statementDomain(orderId: string, store: MockLinkedOperationsStore): unknown {
  const selector = Reflect.get(quickOrderDomain, "getMockQuickOrderFinancialStatement");
  if (typeof selector !== "function") {
    throw new Error("getMockQuickOrderFinancialStatement is missing");
  }
  return Reflect.apply(selector, quickOrderDomain, [orderId, store]);
}

function selectStatement(
  state: LinkedOperationsState,
  orderId: string,
  nowMs = Date.parse("2026-08-22T12:00:00-05:00"),
): unknown {
  const selector = Reflect.get(quickOrderDomain, "selectQuickOrderFinancialStatement");
  if (typeof selector !== "function") {
    throw new Error("selectQuickOrderFinancialStatement is missing");
  }
  return Reflect.apply(selector, quickOrderDomain, [state, orderId, nowMs]);
}

async function assertStatement(value: unknown): Promise<void> {
  const modulePath = "../../src/lib/billing/" + "quick-order-financial-statement";
  const moduleNamespace: unknown = await import(/* @vite-ignore */ modulePath);
  if (moduleNamespace === null || typeof moduleNamespace !== "object") {
    throw new Error("quick-order-financial-statement module is missing");
  }
  const assertion = Reflect.get(moduleNamespace, "assertQuickOrderFinancialStatement");
  if (typeof assertion !== "function") {
    throw new Error("assertQuickOrderFinancialStatement is missing");
  }
  Reflect.apply(assertion, moduleNamespace, [value]);
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

function statementSurface(
  candidate: unknown = api,
): Readonly<{ statement(orderId: string): Promise<unknown> }> {
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("api.quickOrderFinancials is missing");
  }
  const financials = Reflect.get(candidate, "quickOrderFinancials");
  if (financials === null || typeof financials !== "object") {
    throw new Error("api.quickOrderFinancials is missing");
  }
  const statement = Reflect.get(financials, "statement");
  if (typeof statement !== "function") {
    throw new Error("api.quickOrderFinancials.statement is missing");
  }
  return {
    statement: (orderId) => Reflect.apply(statement, financials, [orderId]) as Promise<unknown>,
  };
}

function canonicalSource(statement: Record<string, unknown>): Record<string, unknown> {
  const source = exactDataKeys(
    statement.source,
    ["kind", "invoiceId", "invoiceNo", "effectiveVersionId", "versionNo", "snapshotCommitment"],
    "canonical statement source",
  );
  expect(source.kind).toBe("canonical_invoice");
  return source;
}

function validCanonicalStatement(): Record<string, unknown> {
  return {
    contract: "quick_order_financial_statement_v1",
    revision: 17,
    order: {
      id: "qbo-statement-closed",
      businessOrderNo: "KGN-WH-STATEMENT-CLOSED",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      status: "submitted",
      voidedAt: null,
      pickedUpAt: null,
      paidInFullAt: null,
    },
    source: {
      kind: "canonical_invoice",
      invoiceId: "invoice-statement-closed",
      invoiceNo: "INV-STATEMENT-CLOSED",
      effectiveVersionId: "invoice-statement-closed-version-1",
      versionNo: 1,
      snapshotCommitment: "sha256-utf16le:" + "a".repeat(64),
    },
    charges: {
      kind: "canonical_invoice",
      issuedAt: "2026-08-22T12:00:00-05:00",
      lines: [{
        pricingMode: "unit",
        chargeLineId: "statement-closed-line",
        category: "labor",
        descZh: "检查工时",
        descEn: "Inspection labor",
        remarkZh: "安全检查",
        remarkEn: "Safety inspection",
        unit: "项",
        unitEn: "item",
        quantity: 2,
        unitPriceJmd: 5_000,
        unitDiscountJmd: 0,
        finalUnitPriceJmd: 5_000,
        finalLineJmd: 10_000,
      }],
      totals: {
        laborGrossJmd: 10_000,
        laborDiscountJmd: 0,
        laborNetJmd: 10_000,
        partsGrossJmd: 0,
        partsDiscountJmd: 0,
        partsNetJmd: 0,
        otherFeeTotalJmd: 0,
        parkingTotalJmd: 0,
        totalDiscountJmd: 0,
        chargeSubtotalJmd: 10_000,
        adjustmentsJmd: 0,
        grandTotalJmd: 10_000,
      },
    },
    ledger: {
      invoiceTotalJmd: 10_000,
      receivableJmd: 5_000,
      grossPaidJmd: 4_000,
      cashRefundedJmd: 0,
      receivableReductionJmd: 5_000,
      netPaidJmd: 4_000,
      balanceJmd: 1_000,
      paymentStatus: "partially_paid",
      settlementStatus: "due",
      hasPaymentHistory: true,
    },
    entries: [
      {
        kind: "payment",
        provenance: "canonical_invoice",
        sequence: 1,
        paymentId: "statement-payment-1",
        invoiceVersionId: "invoice-statement-closed-version-1",
        amountJmd: 4_000,
        occurredAt: "2026-08-22T12:10:00-05:00",
        method: "cash",
        actorName: "超级管理员",
        note: "部分收款",
      },
      {
        kind: "refund",
        accounting: "canonical_line_v1",
        sequence: 2,
        refundId: "statement-refund-1",
        invoiceVersionId: "invoice-statement-closed-version-1",
        line: {
          pricingMode: "unit",
          chargeLineId: "statement-closed-line",
          category: "labor",
          descZh: "检查工时",
          descEn: "Inspection labor",
          remarkZh: "安全检查",
          remarkEn: "Safety inspection",
          unit: "项",
          unitEn: "item",
          quantity: 2,
          unitPriceJmd: 5_000,
          unitDiscountJmd: 0,
          finalUnitPriceJmd: 5_000,
          finalLineJmd: 10_000,
        },
        refundQuantity: 1,
        wholeLine: false,
        receivableReductionJmd: 5_000,
        cashRefundJmd: 0,
        occurredAt: "2026-08-22T12:20:00-05:00",
        method: "cash",
        actorName: "超级管理员",
        reason: "客户取消部分项目",
      },
    ],
  };
}

test("statement assertion rejects empty charge sets, zero-value facts, duplicate parking cases, and aggregate line over-refunds", async () => {
  const base = validCanonicalStatement();
  await expect(assertStatement(structuredClone(base)), "semantic baseline").resolves.toBeUndefined();

  const twoParkingLines = structuredClone(base);
  const parkingCharges = asRecord(twoParkingLines.charges, "parking uniqueness control charges");
  const parkingLines = parkingCharges.lines as Array<Record<string, unknown>>;
  parkingLines.push({
    pricingMode: "parking_projection",
    chargeLineId: "parking-unique-a",
    category: "other_service",
    code: "parking_overtime",
    descZh: "停车超时费 A",
    descEn: "Parking overtime A",
    remarkZh: "",
    remarkEn: "",
    parkingCaseId: "parking-case-a",
    sourceRevision: 2,
    asOf: "2026-08-22T12:00:00-05:00",
    amountJmd: 1_000,
  }, {
    pricingMode: "parking_projection",
    chargeLineId: "parking-unique-b",
    category: "other_service",
    code: "parking_overtime",
    descZh: "停车超时费 B",
    descEn: "Parking overtime B",
    remarkZh: "",
    remarkEn: "",
    parkingCaseId: "parking-case-b",
    sourceRevision: 3,
    asOf: "2026-08-22T12:00:00-05:00",
    amountJmd: 1_000,
  });
  Object.assign(asRecord(parkingCharges.totals, "parking uniqueness control totals"), {
    parkingTotalJmd: 2_000,
    chargeSubtotalJmd: 12_000,
    grandTotalJmd: 12_000,
  });
  Object.assign(asRecord(twoParkingLines.ledger, "parking uniqueness control ledger"), {
    invoiceTotalJmd: 12_000,
    receivableJmd: 7_000,
    balanceJmd: 3_000,
  });
  await expect(assertStatement(structuredClone(twoParkingLines)), "unique parking cases control")
    .resolves.toBeUndefined();
  const duplicateParkingCase = structuredClone(twoParkingLines);
  const duplicateParkingLines = asRecord(duplicateParkingCase.charges, "duplicate parking charges")
    .lines as Array<Record<string, unknown>>;
  duplicateParkingLines[2]!.parkingCaseId = "parking-case-a";
  await expect(assertStatement(duplicateParkingCase), "duplicate parking case ID").rejects.toThrow();

  const zeroPayment = structuredClone(base);
  (zeroPayment.entries as Array<Record<string, unknown>>)[0]!.amountJmd = 0;
  Object.assign(asRecord(zeroPayment.ledger, "zero payment ledger"), {
    grossPaidJmd: 0,
    netPaidJmd: 0,
    balanceJmd: 5_000,
    paymentStatus: "unpaid",
    hasPaymentHistory: true,
  });
  await expect(assertStatement(zeroPayment), "zero-value canonical payment fact").rejects.toThrow();

  const zeroLegacyRefund = structuredClone(base);
  zeroLegacyRefund.source = { kind: "legacy_quick" };
  zeroLegacyRefund.charges = {
    kind: "legacy_quick",
    discountModel: "legacy_category_discount",
    items: [{
      id: "legacy-zero-refund-line",
      descZh: "旧版工时",
      descEn: "Legacy labor",
      remarkZh: "",
      remarkEn: "",
      category: "labor",
      unit: "项",
      unitEn: "item",
      unitPriceJmd: 10_000,
      quantity: 1,
      pendingQuote: false,
    }],
    totals: {
      laborGrossJmd: 10_000,
      partsGrossJmd: 0,
      laborDiscountJmd: 0,
      partsDiscountJmd: 0,
      totalDiscountJmd: 0,
      grandTotalJmd: 10_000,
    },
  };
  Object.assign(asRecord(zeroLegacyRefund.ledger, "zero legacy refund ledger"), {
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
  zeroLegacyRefund.entries = [{
    kind: "payment",
    provenance: "legacy_quick",
    sequence: 1,
    paymentId: "legacy-positive-payment",
    invoiceVersionId: null,
    amountJmd: 4_000,
    occurredAt: "2026-08-22T12:10:00-05:00",
    method: "cash",
    actorName: "超级管理员",
    note: null,
  }, {
    kind: "refund",
    accounting: "legacy_cash_only",
    sequence: 2,
    refundId: "legacy-zero-refund",
    invoiceVersionId: null,
    category: "labor",
    lineDescription: "旧版工时",
    receivableReductionJmd: null,
    cashRefundJmd: 0,
    occurredAt: "2026-08-22T12:20:00-05:00",
    method: "cash",
    actorName: "超级管理员",
    note: null,
  }];
  await expect(assertStatement(zeroLegacyRefund), "zero-value legacy refund fact").rejects.toThrow();

  for (const kind of ["canonical_invoice", "shared_uninvoiced"] as const) {
    const empty = structuredClone(base);
    empty.source = kind === "canonical_invoice" ? structuredClone(base.source) : { kind };
    empty.charges = kind === "canonical_invoice" ? {
      kind,
      issuedAt: "2026-08-22T12:00:00-05:00",
      lines: [],
      totals: {
        laborGrossJmd: 0, laborDiscountJmd: 0, laborNetJmd: 0,
        partsGrossJmd: 0, partsDiscountJmd: 0, partsNetJmd: 0,
        otherFeeTotalJmd: 0, parkingTotalJmd: 0, totalDiscountJmd: 0,
        chargeSubtotalJmd: 0, adjustmentsJmd: 0, grandTotalJmd: 0,
      },
    } : {
      kind,
      status: "provisional",
      lines: [],
      totals: {
        laborGrossJmd: 0, laborDiscountJmd: 0, laborNetJmd: 0,
        partsGrossJmd: 0, partsDiscountJmd: 0, partsNetJmd: 0,
        otherFeeTotalJmd: 0, parkingTotalJmd: 0, totalDiscountJmd: 0,
        pendingPartsCount: 0, chargeSubtotalJmd: 0, grandTotalJmd: 0,
      },
    };
    empty.ledger = {
      invoiceTotalJmd: kind === "canonical_invoice" ? 0 : null,
      receivableJmd: 0,
      grossPaidJmd: 0,
      cashRefundedJmd: 0,
      receivableReductionJmd: 0,
      netPaidJmd: 0,
      balanceJmd: 0,
      paymentStatus: "unpaid",
      settlementStatus: "settled",
      hasPaymentHistory: false,
    };
    empty.entries = [];
    await expect(assertStatement(empty), `${kind} empty charge set`).rejects.toThrow();
  }

  const unitOverRefund = structuredClone(base);
  const unitCharges = asRecord(unitOverRefund.charges, "unit over-refund charges");
  (unitCharges.lines as Array<Record<string, unknown>>).push({
    pricingMode: "fixed_total",
    chargeLineId: "unit-over-refund-headroom",
    category: "other_service",
    code: "other",
    descZh: "其他服务",
    descEn: "Other service",
    remarkZh: "",
    remarkEn: "",
    amountJmd: 10_000,
  });
  Object.assign(asRecord(unitCharges.totals, "unit over-refund totals"), {
    otherFeeTotalJmd: 10_000,
    chargeSubtotalJmd: 20_000,
    grandTotalJmd: 20_000,
  });
  const firstRefund = (unitOverRefund.entries as Array<Record<string, unknown>>)[1]!;
  unitOverRefund.entries = [
    (unitOverRefund.entries as Array<Record<string, unknown>>)[0]!,
    firstRefund,
    { ...structuredClone(firstRefund), sequence: 3, refundId: "statement-refund-2" },
    { ...structuredClone(firstRefund), sequence: 4, refundId: "statement-refund-3" },
  ];
  Object.assign(asRecord(unitOverRefund.ledger, "unit over-refund ledger"), {
    invoiceTotalJmd: 20_000,
    receivableJmd: 5_000,
    receivableReductionJmd: 15_000,
    balanceJmd: 1_000,
  });
  await expect(assertStatement(unitOverRefund), "aggregate unit refund quantity exceeds snapshot line")
    .rejects.toThrow();

  const crossVersionOverRefund = structuredClone(base);
  const crossVersionCharges = asRecord(crossVersionOverRefund.charges, "cross-version over-refund charges");
  (crossVersionCharges.lines as Array<Record<string, unknown>>).push({
    pricingMode: "fixed_total",
    chargeLineId: "cross-version-headroom",
    category: "other_service",
    code: "other",
    descZh: "跨版本占用余量",
    descEn: "Cross-version occupancy headroom",
    remarkZh: "",
    remarkEn: "",
    amountJmd: 10_000,
  });
  Object.assign(asRecord(crossVersionCharges.totals, "cross-version totals"), {
    otherFeeTotalJmd: 10_000,
    chargeSubtotalJmd: 20_000,
    grandTotalJmd: 20_000,
  });
  Object.assign(asRecord(crossVersionOverRefund.source, "cross-version source"), {
    effectiveVersionId: "invoice-statement-closed-version-2",
    versionNo: 2,
  });
  const versionOneRefund = (crossVersionOverRefund.entries as Array<Record<string, unknown>>)[1]!;
  const versionTwoRefund = structuredClone(versionOneRefund);
  versionTwoRefund.sequence = 3;
  versionTwoRefund.refundId = "statement-refund-version-2";
  versionTwoRefund.invoiceVersionId = "invoice-statement-closed-version-2";
  versionTwoRefund.refundQuantity = 2;
  versionTwoRefund.receivableReductionJmd = 10_000;
  crossVersionOverRefund.entries = [
    (crossVersionOverRefund.entries as Array<Record<string, unknown>>)[0]!,
    versionOneRefund,
    versionTwoRefund,
  ];
  Object.assign(asRecord(crossVersionOverRefund.ledger, "cross-version over-refund ledger"), {
    invoiceTotalJmd: 20_000,
    receivableJmd: 5_000,
    receivableReductionJmd: 15_000,
    balanceJmd: 1_000,
  });
  await expect(
    assertStatement(crossVersionOverRefund),
    "stable charge line occupancy cannot reset at an Invoice version boundary",
  ).rejects.toThrow();

  const fixedOverRefund = structuredClone(base);
  const fixedCharges = asRecord(fixedOverRefund.charges, "fixed over-refund charges");
  const fixedLine = {
    pricingMode: "fixed_total",
    chargeLineId: "fixed-refund-line",
    category: "other_service",
    code: "other",
    descZh: "固定服务",
    descEn: "Fixed service",
    remarkZh: "",
    remarkEn: "",
    amountJmd: 10_000,
  };
  (fixedCharges.lines as Array<Record<string, unknown>>).push(fixedLine);
  Object.assign(asRecord(fixedCharges.totals, "fixed over-refund totals"), {
    otherFeeTotalJmd: 10_000,
    chargeSubtotalJmd: 20_000,
    grandTotalJmd: 20_000,
  });
  const fixedRefund = {
    kind: "refund",
    accounting: "canonical_line_v1",
    sequence: 2,
    refundId: "fixed-refund-a",
    invoiceVersionId: "invoice-statement-closed-version-1",
    line: structuredClone(fixedLine),
    refundQuantity: null,
    wholeLine: true,
    receivableReductionJmd: 10_000,
    cashRefundJmd: 0,
    occurredAt: "2026-08-22T12:20:00-05:00",
    method: "cash",
    actorName: "超级管理员",
    reason: "固定项目退款",
  };
  fixedOverRefund.entries = [
    (fixedOverRefund.entries as Array<Record<string, unknown>>)[0]!,
    fixedRefund,
    { ...structuredClone(fixedRefund), sequence: 3, refundId: "fixed-refund-b" },
  ];
  Object.assign(asRecord(fixedOverRefund.ledger, "fixed over-refund ledger"), {
    invoiceTotalJmd: 20_000,
    receivableJmd: 0,
    receivableReductionJmd: 20_000,
    balanceJmd: -4_000,
    paymentStatus: "paid",
    settlementStatus: "overpaid",
  });
  await expect(assertStatement(fixedOverRefund), "fixed-total line can only be refunded once")
    .rejects.toThrow();
});

test("statement accepts capped cross-version and removed-line refunds but rejects stable line coordinate drift", async () => {
  const store = fixedClockStore();
  await store.ready();
  const orderId = "qbo-statement-capped-v2";
  await addSharedQuickOrder(store, orderId, [unit("stable-capped-line", "parts", 8_000)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-capped-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v1Refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "stable-capped-line",
    refundQuantity: 1,
    method: "cash",
    reason: "V1 full value",
    expectedRevision: state.revision,
    mutationId: "statement-capped-refund-v1",
  }, frontdeskActor, store);
  expect(v1Refund.receivableReductionJmd).toBe(8_000);
  await store.mutate((draft) => {
    const order = draft.quickOrders.find((candidate) => candidate.id === orderId);
    if (!order || order.chargeContract !== "shared_v1") throw new Error("capped V2 source missing");
    const index = draft.quickOrders.indexOf(order);
    draft.quickOrders[index] = {
      ...order,
      chargeLines: [unit("stable-capped-line", "parts", 5_000, 2)],
    };
    draft.revision += 1;
  }, { action: "test.statement-capped-v2-source.write", consumeWriteFault: false });
  state = stateSnapshot(store);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-capped-activate-v2",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v2Refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: v2.invoiceId,
    invoiceVersionId: v2.invoiceVersionId,
    chargeLineId: "stable-capped-line",
    refundQuantity: 1,
    method: "cash",
    reason: "V2 capped remainder",
    expectedRevision: state.revision,
    mutationId: "statement-capped-refund-v2",
  }, frontdeskActor, store);
  expect(v2Refund.receivableReductionJmd).toBe(2_000);
  const capped = asRecord(statementDomain(orderId, store), "capped cross-version statement");
  expect((capped.entries as Array<Record<string, unknown>>).filter((entry) => entry.kind === "refund")
    .map((entry) => entry.receivableReductionJmd)).toEqual([8_000, 2_000]);
  await expect(assertStatement(structuredClone(capped)), "real capped cross-version statement")
    .resolves.toBeUndefined();

  const removedHistoricalLine = validCanonicalStatement();
  Object.assign(asRecord(removedHistoricalLine.source, "removed-line source"), {
    effectiveVersionId: "invoice-statement-closed-version-2",
    versionNo: 2,
  });
  const removedCharges = asRecord(removedHistoricalLine.charges, "removed-line charges");
  removedCharges.lines = [{
    pricingMode: "fixed_total",
    chargeLineId: "replacement-line",
    category: "other_service",
    code: "other",
    descZh: "替代服务",
    descEn: "Replacement service",
    remarkZh: "",
    remarkEn: "",
    amountJmd: 10_000,
  }];
  Object.assign(asRecord(removedCharges.totals, "removed-line totals"), {
    laborGrossJmd: 0,
    laborNetJmd: 0,
    otherFeeTotalJmd: 10_000,
  });
  await expect(assertStatement(structuredClone(removedHistoricalLine)), "removed historical line control")
    .resolves.toBeUndefined();

  const parkingLineReuse = structuredClone(removedHistoricalLine);
  const parkingReuseCharges = asRecord(parkingLineReuse.charges, "parking line reuse charges");
  parkingReuseCharges.lines = [{
    pricingMode: "parking_projection",
    chargeLineId: "statement-closed-line",
    category: "other_service",
    code: "parking_overtime",
    descZh: "停车超时费",
    descEn: "Parking overtime",
    remarkZh: "",
    remarkEn: "",
    parkingCaseId: "parking-reuses-ordinary-stable-id",
    sourceRevision: 2,
    asOf: "2026-08-22T12:00:00-05:00",
    amountJmd: 10_000,
  }];
  Object.assign(asRecord(parkingReuseCharges.totals, "parking line reuse totals"), {
    otherFeeTotalJmd: 0,
    parkingTotalJmd: 10_000,
  });
  await expect(assertStatement(parkingLineReuse), "parking cannot reuse an ordinary refund stable line ID")
    .rejects.toThrow();

  const categoryDrift = structuredClone(removedHistoricalLine);
  const categoryCharges = asRecord(categoryDrift.charges, "category drift charges");
  categoryCharges.lines = [
    {
      pricingMode: "unit",
      chargeLineId: "statement-closed-line",
      category: "parts",
      descZh: "当前配件",
      descEn: "Current part",
      remarkZh: "",
      remarkEn: "",
      unit: "个",
      unitEn: "piece",
      quantity: 2,
      unitPriceJmd: 5_000,
      unitDiscountJmd: 0,
      finalUnitPriceJmd: 5_000,
      finalLineJmd: 10_000,
    },
    {
      pricingMode: "fixed_total",
      chargeLineId: "category-drift-headroom",
      category: "other_service",
      code: "other",
      descZh: "其他服务",
      descEn: "Other service",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 10_000,
    },
  ];
  Object.assign(asRecord(categoryCharges.totals, "category drift totals"), {
    laborGrossJmd: 0,
    laborNetJmd: 0,
    partsGrossJmd: 10_000,
    partsNetJmd: 10_000,
    otherFeeTotalJmd: 10_000,
    chargeSubtotalJmd: 20_000,
    grandTotalJmd: 20_000,
  });
  const firstCategoryRefund = (categoryDrift.entries as Array<Record<string, unknown>>)[1]!;
  const secondCategoryRefund = structuredClone(firstCategoryRefund);
  secondCategoryRefund.sequence = 3;
  secondCategoryRefund.refundId = "statement-category-drift-refund-v2";
  secondCategoryRefund.invoiceVersionId = "invoice-statement-closed-version-2";
  secondCategoryRefund.line = structuredClone((categoryCharges.lines as Array<Record<string, unknown>>)[0]);
  categoryDrift.entries = [
    (categoryDrift.entries as Array<Record<string, unknown>>)[0]!,
    firstCategoryRefund,
    secondCategoryRefund,
  ];
  Object.assign(asRecord(categoryDrift.ledger, "category drift ledger"), {
    invoiceTotalJmd: 20_000,
    receivableJmd: 10_000,
    receivableReductionJmd: 10_000,
    balanceJmd: 6_000,
  });
  await expect(assertStatement(categoryDrift), "stable line category cannot drift across versions")
    .rejects.toThrow();

  const fixedAmountDrift = validCanonicalStatement();
  Object.assign(asRecord(fixedAmountDrift.source, "fixed amount source"), {
    effectiveVersionId: "invoice-statement-closed-version-2",
    versionNo: 2,
  });
  const fixedCharges = asRecord(fixedAmountDrift.charges, "fixed amount charges");
  fixedCharges.lines = [{
    pricingMode: "fixed_total",
    chargeLineId: "stable-fixed-line",
    category: "other_service",
    code: "other",
    descZh: "当前固定服务",
    descEn: "Current fixed service",
    remarkZh: "",
    remarkEn: "",
    amountJmd: 10_000,
  }];
  Object.assign(asRecord(fixedCharges.totals, "fixed amount totals"), {
    laborGrossJmd: 0,
    laborNetJmd: 0,
    otherFeeTotalJmd: 10_000,
  });
  fixedAmountDrift.entries = [{
    kind: "refund",
    accounting: "canonical_line_v1",
    sequence: 1,
    refundId: "statement-fixed-drift-refund",
    invoiceVersionId: "invoice-statement-closed-version-1",
    line: {
      pricingMode: "fixed_total",
      chargeLineId: "stable-fixed-line",
      category: "other_service",
      code: "other",
      descZh: "历史固定服务",
      descEn: "Historical fixed service",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    refundQuantity: null,
    wholeLine: true,
    receivableReductionJmd: 7_500,
    cashRefundJmd: 0,
    occurredAt: "2026-08-22T12:20:00-05:00",
    method: "cash",
    actorName: "超级管理员",
    reason: "历史固定项目退款",
  }];
  Object.assign(asRecord(fixedAmountDrift.ledger, "fixed amount ledger"), {
    invoiceTotalJmd: 10_000,
    receivableJmd: 2_500,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 7_500,
    netPaidJmd: 0,
    balanceJmd: 2_500,
    paymentStatus: "unpaid",
    settlementStatus: "due",
    hasPaymentHistory: false,
  });
  await expect(assertStatement(fixedAmountDrift), "stable fixed-total amount cannot drift")
    .rejects.toThrow();
});

test("statement assertion is descriptor-safe, deeply closed, and enforces source, sequence, and ledger conservation", async () => {
  const valid = validCanonicalStatement();
  await expect(assertStatement(structuredClone(valid))).resolves.toBeUndefined();

  const parkingPositive = structuredClone(valid);
  const parkingCharges = asRecord(parkingPositive.charges, "parking-positive charges");
  (parkingCharges.lines as unknown[]).push({
    pricingMode: "parking_projection",
    chargeLineId: "statement-parking-line",
    category: "other_service",
    code: "parking_overtime",
    descZh: "停车超时费",
    descEn: "Parking overtime",
    remarkZh: "已承诺停车费",
    remarkEn: "Committed parking charge",
    parkingCaseId: "parking-statement-closed",
    sourceRevision: 3,
    asOf: "2026-08-22T12:00:00-05:00",
    amountJmd: 2_500,
  });
  Object.assign(asRecord(parkingCharges.totals, "parking-positive totals"), {
    parkingTotalJmd: 2_500,
    chargeSubtotalJmd: 12_500,
    grandTotalJmd: 12_500,
  });
  Object.assign(asRecord(parkingPositive.ledger, "parking-positive ledger"), {
    invoiceTotalJmd: 12_500,
    receivableJmd: 7_500,
    balanceJmd: 3_500,
  });
  await expect(assertStatement(parkingPositive)).resolves.toBeUndefined();
  exactDataKeys(
    (parkingCharges.lines as ReadonlyArray<unknown>)[1],
    CANONICAL_PARKING_LINE_KEYS,
    "canonical parking line",
  );
  for (const [name, mutate] of [
    ["parking source revision is non-positive", (line: Record<string, unknown>) => { line.sourceRevision = 0; }],
    ["parking asOf is not a Jamaica instant", (line: Record<string, unknown>) => { line.asOf = "not-an-instant"; }],
  ] as const) {
    const value = structuredClone(parkingPositive);
    const parkingLine = (asRecord(value.charges, "parking semantic mutant").lines as Array<Record<string, unknown>>)[1]!;
    mutate(parkingLine);
    await expect(assertStatement(value), name).rejects.toThrow();
  }

  const splitPayments = structuredClone(valid);
  const originalPayment = (splitPayments.entries as Array<Record<string, unknown>>)[0]!;
  const originalRefund = (splitPayments.entries as Array<Record<string, unknown>>)[1]!;
  splitPayments.entries = [
    { ...originalPayment, paymentId: "statement-split-payment-a", amountJmd: 2_000, sequence: 1 },
    { ...originalPayment, paymentId: "statement-split-payment-b", amountJmd: 2_000, sequence: 2 },
    { ...originalRefund, sequence: 3 },
  ];
  await expect(assertStatement(structuredClone(splitPayments)), "unique split payment control")
    .resolves.toBeUndefined();
  const duplicatePayment = structuredClone(splitPayments);
  (duplicatePayment.entries as Array<Record<string, unknown>>)[1]!.paymentId = "statement-split-payment-a";
  await expect(assertStatement(duplicatePayment), "duplicate payment entry ID").rejects.toThrow();

  const splitLines = structuredClone(valid);
  const originalLine = (asRecord(splitLines.charges, "split lines control").lines as Array<Record<string, unknown>>)[0]!;
  const firstSplitLine = {
    ...originalLine,
    chargeLineId: "statement-split-line-a",
    quantity: 1,
    finalLineJmd: 5_000,
  };
  const secondSplitLine = {
    ...firstSplitLine,
    chargeLineId: "statement-split-line-b",
  };
  (asRecord(splitLines.charges, "split lines control").lines as Array<Record<string, unknown>>)
    .splice(0, 1, firstSplitLine, secondSplitLine);
  const splitRefund = (splitLines.entries as Array<Record<string, unknown>>)[1]!;
  splitRefund.line = structuredClone(firstSplitLine);
  await expect(assertStatement(structuredClone(splitLines)), "unique split charge line control")
    .resolves.toBeUndefined();
  const duplicateLine = structuredClone(splitLines);
  (asRecord(duplicateLine.charges, "duplicate line mutant").lines as Array<Record<string, unknown>>)[1]!
    .chargeLineId = "statement-split-line-a";
  await expect(assertStatement(duplicateLine), "duplicate charge line ID").rejects.toThrow();

  const mutants: ReadonlyArray<Readonly<{
    name: string;
    mutate(value: Record<string, unknown>): void;
  }>> = [
    {
      name: "wrong contract",
      mutate: (value) => { value.contract = "quick_order_financial_statement_v0"; },
    },
    {
      name: "negative revision",
      mutate: (value) => { value.revision = -1; },
    },
    {
      name: "top-level extra",
      mutate: (value) => { value.privateMutationReceipts = "PRIVATE_RECEIPT_SENTINEL"; },
    },
    {
      name: "top-level undefined",
      mutate: (value) => { value.ledger = undefined; },
    },
    {
      name: "top-level hidden field",
      mutate: (value) => { Object.defineProperty(value, "hidden", { value: true }); },
    },
    {
      name: "top-level symbol field",
      mutate: (value) => { Object.defineProperty(value, Symbol("statement"), { value: true, enumerable: true }); },
    },
    {
      name: "top-level custom prototype",
      mutate: (value) => { Object.setPrototypeOf(value, { inheritedSentinel: true }); },
    },
    {
      name: "source and charges mismatch",
      mutate: (value) => { asRecord(value.charges, "charges mutant").kind = "shared_uninvoiced"; },
    },
    {
      name: "canonical source extra private coordinate",
      mutate: (value) => {
        asRecord(value.source, "source mutant").sourceBusinessOrderRevision = 14;
      },
    },
    {
      name: "canonical source commitment format drift",
      mutate: (value) => {
        asRecord(value.source, "source mutant").snapshotCommitment = "sha256:" + "a".repeat(64);
      },
    },
    {
      name: "canonical charges internal adjustment leak",
      mutate: (value) => { asRecord(value.charges, "charges mutant").adjustments = []; },
    },
    {
      name: "canonical line internal actor leak",
      mutate: (value) => {
        const line = (asRecord(value.charges, "charges mutant").lines as Array<Record<string, unknown>>)[0]!;
        line.actorId = "PRIVATE_ACTOR_SENTINEL";
      },
    },
    {
      name: "canonical final unit price arithmetic drift",
      mutate: (value) => {
        const line = (asRecord(value.charges, "charges mutant").lines as Array<Record<string, unknown>>)[0]!;
        line.finalUnitPriceJmd = 4_999;
      },
    },
    {
      name: "canonical final line arithmetic drift",
      mutate: (value) => {
        const line = (asRecord(value.charges, "charges mutant").lines as Array<Record<string, unknown>>)[0]!;
        line.finalLineJmd = 9_999;
      },
    },
    {
      name: "canonical internal labor gross axis drift",
      mutate: (value) => {
        const totals = asRecord(asRecord(value.charges, "charges mutant").totals, "totals mutant");
        totals.laborGrossJmd = 9_999;
      },
    },
    {
      name: "snapshot totals drift",
      mutate: (value) => {
        const totals = asRecord(asRecord(value.charges, "charges mutant").totals, "totals mutant");
        totals.grandTotalJmd = 9_999;
      },
    },
    {
      name: "ledger receivable conservation drift",
      mutate: (value) => { asRecord(value.ledger, "ledger mutant").receivableJmd = 5_001; },
    },
    {
      name: "ledger net paid conservation drift",
      mutate: (value) => { asRecord(value.ledger, "ledger mutant").netPaidJmd = 3_999; },
    },
    {
      name: "entry payment sum drift",
      mutate: (value) => {
        (value.entries as Array<Record<string, unknown>>)[0]!.amountJmd = 3_999;
      },
    },
    {
      name: "entry refund reduction sum drift",
      mutate: (value) => {
        (value.entries as Array<Record<string, unknown>>)[1]!.receivableReductionJmd = 4_999;
      },
    },
    {
      name: "refund cash exceeds reduction",
      mutate: (value) => {
        (value.entries as Array<Record<string, unknown>>)[1]!.cashRefundJmd = 5_001;
      },
    },
    {
      name: "non-contiguous entry sequence",
      mutate: (value) => { (value.entries as Array<Record<string, unknown>>)[1]!.sequence = 3; },
    },
    {
      name: "canonical refund parking impersonation",
      mutate: (value) => {
        const refund = (value.entries as Array<Record<string, unknown>>)[1]!;
        asRecord(refund.line, "refund line mutant").pricingMode = "parking_projection";
      },
    },
    {
      name: "legacy reduction invention",
      mutate: (value) => {
        value.source = { kind: "legacy_quick" };
        value.charges = {
          kind: "legacy_quick",
          discountModel: "legacy_category_discount",
          items: [],
          totals: {
            laborGrossJmd: 10_000,
            partsGrossJmd: 0,
            laborDiscountJmd: 0,
            partsDiscountJmd: 0,
            totalDiscountJmd: 0,
            grandTotalJmd: 10_000,
          },
        };
      },
    },
    {
      name: "shared Invoice impersonation with history",
      mutate: (value) => {
        value.source = { kind: "shared_uninvoiced" };
        value.charges = {
          kind: "shared_uninvoiced",
          status: "provisional",
          lines: [],
          totals: {
            laborGrossJmd: 10_000,
            laborDiscountJmd: 0,
            laborNetJmd: 10_000,
            partsGrossJmd: 0,
            partsDiscountJmd: 0,
            partsNetJmd: 0,
            otherFeeTotalJmd: 0,
            parkingTotalJmd: 0,
            totalDiscountJmd: 0,
            pendingPartsCount: 0,
            chargeSubtotalJmd: 10_000,
            grandTotalJmd: 10_000,
          },
        };
      },
    },
    {
      name: "sparse entries",
      mutate: (value) => { Reflect.deleteProperty(value.entries as unknown[], "0"); },
    },
    {
      name: "entries expando",
      mutate: (value) => { Object.defineProperty(value.entries, "private", { value: true, enumerable: true }); },
    },
    {
      name: "entries custom prototype",
      mutate: (value) => { Object.setPrototypeOf(value.entries as unknown[], Object.create(Array.prototype)); },
    },
  ];

  for (const mutant of mutants) {
    const value = structuredClone(valid);
    mutant.mutate(value);
    await expect(assertStatement(value), mutant.name).rejects.toThrow();
  }

  let sourceKindGetterCalls = 0;
  const sourceAccessor = structuredClone(valid);
  Object.defineProperty(sourceAccessor.source, "kind", {
    configurable: true,
    enumerable: true,
    get() {
      sourceKindGetterCalls += 1;
      throw new Error("SOURCE_KIND_GETTER_SENTINEL");
    },
  });
  await expect(assertStatement(sourceAccessor)).rejects.toThrow();
  expect(sourceKindGetterCalls).toBe(0);

  let entryIndexGetterCalls = 0;
  const entryAccessor = structuredClone(valid);
  Object.defineProperty(entryAccessor.entries, "0", {
    configurable: true,
    enumerable: true,
    get() {
      entryIndexGetterCalls += 1;
      throw new Error("ENTRY_INDEX_GETTER_SENTINEL");
    },
  });
  await expect(assertStatement(entryAccessor)).rejects.toThrow();
  expect(entryIndexGetterCalls).toBe(0);

  let lineGetterCalls = 0;
  const lineAccessor = structuredClone(valid);
  const line = (lineAccessor.charges as Record<string, unknown>).lines as Array<Record<string, unknown>>;
  Object.defineProperty(line[0], "pricingMode", {
    configurable: true,
    enumerable: true,
    get() {
      lineGetterCalls += 1;
      throw new Error("LINE_MODE_GETTER_SENTINEL");
    },
  });
  await expect(assertStatement(lineAccessor)).rejects.toThrow();
  expect(lineGetterCalls).toBe(0);

  const objectLayers: ReadonlyArray<Readonly<{
    name: string;
    key: string;
    locate(value: Record<string, unknown>): Record<string, unknown>;
  }>> = [
    { name: "top", key: "contract", locate: (value) => value },
    { name: "order", key: "id", locate: (value) => asRecord(value.order, "order layer") },
    { name: "source", key: "kind", locate: (value) => asRecord(value.source, "source layer") },
    { name: "charges", key: "kind", locate: (value) => asRecord(value.charges, "charges layer") },
    {
      name: "charge line",
      key: "pricingMode",
      locate: (value) => (asRecord(value.charges, "charges layer").lines as Array<Record<string, unknown>>)[0]!,
    },
    {
      name: "totals",
      key: "grandTotalJmd",
      locate: (value) => asRecord(asRecord(value.charges, "charges layer").totals, "totals layer"),
    },
    { name: "ledger", key: "invoiceTotalJmd", locate: (value) => asRecord(value.ledger, "ledger layer") },
    {
      name: "payment entry",
      key: "kind",
      locate: (value) => (value.entries as Array<Record<string, unknown>>)[0]!,
    },
    {
      name: "refund entry",
      key: "accounting",
      locate: (value) => (value.entries as Array<Record<string, unknown>>)[1]!,
    },
    {
      name: "refund line",
      key: "pricingMode",
      locate: (value) => asRecord(
        (value.entries as Array<Record<string, unknown>>)[1]!.line,
        "refund line layer",
      ),
    },
  ];

  for (const layer of objectLayers) {
    for (const mode of ["hidden", "symbol", "prototype"] as const) {
      const value = structuredClone(valid);
      const target = layer.locate(value);
      if (mode === "hidden") Object.defineProperty(target, "privateHidden", { value: true });
      else if (mode === "symbol") Object.defineProperty(target, Symbol("private"), { value: true, enumerable: true });
      else Object.setPrototypeOf(target, { inheritedPrivate: true });
      await expect(assertStatement(value), `${layer.name} ${mode}`).rejects.toThrow();
    }

    let getterCalls = 0;
    const accessorValue = structuredClone(valid);
    Object.defineProperty(layer.locate(accessorValue), layer.key, {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${layer.name.toUpperCase()}_GETTER_SENTINEL`);
      },
    });
    await expect(assertStatement(accessorValue), `${layer.name} accessor`).rejects.toThrow();
    expect(getterCalls, `${layer.name} getter calls`).toBe(0);
  }

  for (const mode of ["hidden", "symbol", "prototype", "sparse"] as const) {
    const value = structuredClone(valid);
    const lines = asRecord(value.charges, "lines array mutant").lines as unknown[];
    if (mode === "hidden") Object.defineProperty(lines, "privateHidden", { value: true });
    else if (mode === "symbol") Object.defineProperty(lines, Symbol("private"), { value: true, enumerable: true });
    else if (mode === "prototype") Object.setPrototypeOf(lines, Object.create(Array.prototype));
    else Reflect.deleteProperty(lines, "0");
    await expect(assertStatement(value), `lines array ${mode}`).rejects.toThrow();
  }

  let lineIndexGetterCalls = 0;
  const lineIndexAccessor = structuredClone(valid);
  const lines = asRecord(lineIndexAccessor.charges, "lines accessor mutant").lines as unknown[];
  Object.defineProperty(lines, "0", {
    configurable: true,
    enumerable: true,
    get() {
      lineIndexGetterCalls += 1;
      throw new Error("LINE_INDEX_GETTER_SENTINEL");
    },
  });
  await expect(assertStatement(lineIndexAccessor)).rejects.toThrow();
  expect(lineIndexGetterCalls).toBe(0);
});

test("statement domain exposes exact provisional shared and canonical branches", async () => {
  const store = fixedClockStore();
  await store.ready();
  const uninvoicedOrderId = "qbo-statement-uninvoiced";
  const canonicalOrderId = "qbo-statement-canonical";
  await addSharedQuickOrder(store, uninvoicedOrderId, [
    unit("uninvoiced-labor", "labor", 7_000),
    fixed("uninvoiced-towing", 2_500),
    { ...unit("uninvoiced-pending-part", "parts", 3_000), pendingQuote: true },
  ]);
  await addSharedQuickOrder(store, canonicalOrderId, [
    unit("canonical-labor", "labor", 10_000),
    fixed("canonical-towing", 2_500),
  ]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId: canonicalOrderId,
    expectedRevision: state.revision,
    mutationId: "statement-three-source-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-three-source-payment-v1",
    amountJmd: 4_000,
    method: "cash",
    note: "statement canonical payment",
  }, frontdeskActor, store);
  const before = stateSnapshot(store);

  const provisional = exactDataKeys(
    statementDomain(uninvoicedOrderId, store),
    STATEMENT_KEYS,
    "shared-uninvoiced statement",
  );
  exactDataKeys(provisional.order, ORDER_KEYS, "shared-uninvoiced order");
  expect(exactDataKeys(provisional.source, ["kind"], "shared-uninvoiced source"))
    .toEqual({ kind: "shared_uninvoiced" });
  const provisionalCharges = exactDataKeys(
    provisional.charges,
    ["kind", "status", "lines", "totals"],
    "shared-uninvoiced charges",
  );
  expect(provisionalCharges).toMatchObject({ kind: "shared_uninvoiced", status: "provisional" });
  for (const line of provisionalCharges.lines as ReadonlyArray<unknown>) {
    const record = asRecord(line, "shared-uninvoiced line");
    exactDataKeys(
      record,
      record.pricingMode === "unit" ? SHARED_UNIT_LINE_KEYS : SHARED_FIXED_LINE_KEYS,
      "shared-uninvoiced line",
    );
  }
  expect(provisionalCharges.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "uninvoiced-labor",
      pricingMode: "unit",
      category: "labor",
      unitPriceJmd: 7_000,
      quantity: 1,
    }),
    expect.objectContaining({
      id: "uninvoiced-towing",
      pricingMode: "fixed_total",
      category: "other_service",
      code: "towing",
      amountJmd: 2_500,
    }),
    expect.objectContaining({
      id: "uninvoiced-pending-part",
      pricingMode: "unit",
      category: "parts",
      unitPriceJmd: 3_000,
      quantity: 1,
      pendingQuote: true,
    }),
  ]));
  exactDataKeys(provisionalCharges.totals, SHARED_TOTAL_KEYS, "shared-uninvoiced totals");
  expect(provisionalCharges.totals).toEqual({
    laborGrossJmd: 7_000,
    laborDiscountJmd: 0,
    laborNetJmd: 7_000,
    partsGrossJmd: 0,
    partsDiscountJmd: 0,
    partsNetJmd: 0,
    otherFeeTotalJmd: 2_500,
    parkingTotalJmd: 0,
    totalDiscountJmd: 0,
    pendingPartsCount: 1,
    chargeSubtotalJmd: 9_500,
    grandTotalJmd: 9_500,
  });
  exactDataKeys(provisional.ledger, LEDGER_KEYS, "shared-uninvoiced ledger");
  expect(provisional.ledger).toEqual({
    invoiceTotalJmd: null,
    receivableJmd: 9_500,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 0,
    netPaidJmd: 0,
    balanceJmd: 9_500,
    paymentStatus: "unpaid",
    settlementStatus: "due",
    hasPaymentHistory: false,
  });
  expect(provisional.entries).toEqual([]);
  expect(JSON.stringify(provisional)).not.toMatch(/invoiceNo|effectiveVersionId|canonical_invoice/u);
  for (const line of provisionalCharges.lines as ReadonlyArray<unknown>) {
    expect(Reflect.ownKeys(asRecord(line, "provisional line"))).not.toContain("sourceId");
  }
  await expect(assertStatement(structuredClone(provisional))).resolves.toBeUndefined();

  for (const branch of [
    { name: "shared-uninvoiced", statement: provisional, arrayField: "lines", lineField: "descZh" },
  ] as const) {
    const nestedHidden = structuredClone(branch.statement);
    const hiddenCharges = asRecord(nestedHidden.charges, `${branch.name} hidden charges`);
    const hiddenItems = hiddenCharges[branch.arrayField] as Array<Record<string, unknown>>;
    Object.defineProperty(hiddenItems[0], "privateHidden", { value: true });
    await expect(assertStatement(nestedHidden), `${branch.name} nested hidden`).rejects.toThrow();

    const totalsPrototype = structuredClone(branch.statement);
    const prototypeCharges = asRecord(totalsPrototype.charges, `${branch.name} prototype charges`);
    Object.setPrototypeOf(prototypeCharges.totals, { inheritedPrivate: true });
    await expect(assertStatement(totalsPrototype), `${branch.name} totals prototype`).rejects.toThrow();

    let fieldGetterCalls = 0;
    const fieldAccessor = structuredClone(branch.statement);
    const accessorCharges = asRecord(fieldAccessor.charges, `${branch.name} accessor charges`);
    const accessorItems = accessorCharges[branch.arrayField] as Array<Record<string, unknown>>;
    Object.defineProperty(accessorItems[0], branch.lineField, {
      configurable: true,
      enumerable: true,
      get() {
        fieldGetterCalls += 1;
        throw new Error(`${branch.name.toUpperCase()}_LINE_GETTER_SENTINEL`);
      },
    });
    await expect(assertStatement(fieldAccessor), `${branch.name} line accessor`).rejects.toThrow();
    expect(fieldGetterCalls, `${branch.name} line getter calls`).toBe(0);

    const sparseItems = structuredClone(branch.statement);
    const sparseCharges = asRecord(sparseItems.charges, `${branch.name} sparse charges`);
    Reflect.deleteProperty(sparseCharges[branch.arrayField] as unknown[], "0");
    await expect(assertStatement(sparseItems), `${branch.name} sparse array`).rejects.toThrow();

    let indexGetterCalls = 0;
    const indexAccessor = structuredClone(branch.statement);
    const indexCharges = asRecord(indexAccessor.charges, `${branch.name} index charges`);
    Object.defineProperty(indexCharges[branch.arrayField] as unknown[], "0", {
      configurable: true,
      enumerable: true,
      get() {
        indexGetterCalls += 1;
        throw new Error(`${branch.name.toUpperCase()}_INDEX_GETTER_SENTINEL`);
      },
    });
    await expect(assertStatement(indexAccessor), `${branch.name} index accessor`).rejects.toThrow();
    expect(indexGetterCalls, `${branch.name} index getter calls`).toBe(0);
  }

  const canonical = exactDataKeys(
    statementDomain(canonicalOrderId, store),
    STATEMENT_KEYS,
    "canonical statement",
  );
  exactDataKeys(canonical.order, ORDER_KEYS, "canonical order");
  const source = canonicalSource(canonical);
  expect(source).toMatchObject({
    invoiceId: activation.invoiceId,
    effectiveVersionId: activation.invoiceVersionId,
    versionNo: 1,
    snapshotCommitment: activation.snapshotCommitment,
  });
  const canonicalCharges = exactDataKeys(
    canonical.charges,
    ["kind", "issuedAt", "lines", "totals"],
    "canonical charges",
  );
  expect(canonicalCharges.kind).toBe("canonical_invoice");
  const canonicalLines = canonicalCharges.lines as ReadonlyArray<unknown>;
  exactDataKeys(canonicalLines[0], CANONICAL_UNIT_LINE_KEYS, "canonical unit line");
  exactDataKeys(canonicalLines[1], CANONICAL_FIXED_LINE_KEYS, "canonical fixed-total line");
  exactDataKeys(canonicalCharges.totals, CANONICAL_TOTAL_KEYS, "canonical totals");
  exactDataKeys(canonical.ledger, LEDGER_KEYS, "canonical ledger");
  expect(canonicalCharges.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({
      pricingMode: "unit",
      chargeLineId: "canonical-labor",
      unitPriceJmd: 10_000,
      unitDiscountJmd: 0,
      finalUnitPriceJmd: 10_000,
      finalLineJmd: 10_000,
    }),
    expect.objectContaining({
      pricingMode: "fixed_total",
      chargeLineId: "canonical-towing",
      amountJmd: 2_500,
    }),
  ]));
  expect(canonicalCharges.totals).toMatchObject({
    laborGrossJmd: 10_000,
    laborNetJmd: 10_000,
    otherFeeTotalJmd: 2_500,
    grandTotalJmd: 12_500,
  });
  expect(canonical.ledger).toMatchObject({
    invoiceTotalJmd: 12_500,
    receivableJmd: 12_500,
    grossPaidJmd: 4_000,
    netPaidJmd: 4_000,
    balanceJmd: 8_500,
  });
  expect(canonical.entries).toEqual([
    {
      kind: "payment",
      provenance: "canonical_invoice",
      sequence: 1,
      paymentId: expect.any(String),
      invoiceVersionId: activation.invoiceVersionId,
      amountJmd: 4_000,
      occurredAt: expect.any(String),
      method: "cash",
      actorName: frontdeskActor.name,
      note: "statement canonical payment",
    },
  ]);
  exactDataKeys((canonical.entries as ReadonlyArray<unknown>)[0], PAYMENT_ENTRY_KEYS, "canonical payment entry");
  expect(JSON.stringify(canonical)).not.toMatch(
    /sourceBusinessOrderRevision|mutationId|committedRevision|actorId|rawStrokes|signatureEvidence/u,
  );
  expect(stateSnapshot(store)).toEqual(before);
});

test("canonical statement preserves committed snapshot adjustments without exposing private adjustment records", async () => {
  const store = fixedClockStore();
  await store.ready();
  const orderId = "qbo-statement-adjusted";
  await addSharedQuickOrder(store, orderId, [unit("adjusted-labor", "labor", 10_000)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-adjusted-activate-v1",
    adjustments: [{
      id: "rounding-adjustment-private-id",
      kind: "rounding",
      amountJmd: -500,
    }],
  }, frontdeskActor, store);
  const beforeRead = stateSnapshot(store);

  const statement = asRecord(statementDomain(orderId, store), "adjusted canonical statement");
  expect(canonicalSource(statement)).toMatchObject({
    invoiceId: activation.invoiceId,
    effectiveVersionId: activation.invoiceVersionId,
    snapshotCommitment: activation.snapshotCommitment,
  });
  const charges = exactDataKeys(
    statement.charges,
    ["kind", "issuedAt", "lines", "totals"],
    "adjusted canonical charges",
  );
  exactDataKeys(charges.totals, CANONICAL_TOTAL_KEYS, "adjusted canonical totals");
  expect(charges.totals).toEqual({
    laborGrossJmd: 10_000,
    laborDiscountJmd: 0,
    laborNetJmd: 10_000,
    partsGrossJmd: 0,
    partsDiscountJmd: 0,
    partsNetJmd: 0,
    otherFeeTotalJmd: 0,
    parkingTotalJmd: 0,
    totalDiscountJmd: 0,
    chargeSubtotalJmd: 10_000,
    adjustmentsJmd: -500,
    grandTotalJmd: 9_500,
  });
  expect(statement.ledger).toMatchObject({
    invoiceTotalJmd: 9_500,
    receivableJmd: 9_500,
    balanceJmd: 9_500,
  });
  expect(statement.entries).toEqual([]);
  expect(JSON.stringify(statement)).not.toContain("rounding-adjustment-private-id");
  expect(stateSnapshot(store)).toEqual(beforeRead);
});

test("canonical statement distinguishes receivable reduction from actual cash for unpaid, partial, and paid refunds", async () => {
  const scenarios = [
    {
      name: "unpaid",
      paymentJmd: 0,
      refundQuantity: 1,
      expected: {
        receivableReductionJmd: 5_000,
        cashRefundJmd: 0,
        ledger: {
          receivableJmd: 5_000,
          grossPaidJmd: 0,
          cashRefundedJmd: 0,
          netPaidJmd: 0,
          balanceJmd: 5_000,
        },
      },
    },
    {
      name: "partial",
      paymentJmd: 4_000,
      refundQuantity: 2,
      expected: {
        receivableReductionJmd: 10_000,
        cashRefundJmd: 4_000,
        ledger: {
          receivableJmd: 0,
          grossPaidJmd: 4_000,
          cashRefundedJmd: 4_000,
          netPaidJmd: 0,
          balanceJmd: 0,
        },
      },
    },
    {
      name: "paid",
      paymentJmd: 10_000,
      refundQuantity: 1,
      expected: {
        receivableReductionJmd: 5_000,
        cashRefundJmd: 5_000,
        ledger: {
          receivableJmd: 5_000,
          grossPaidJmd: 10_000,
          cashRefundedJmd: 5_000,
          netPaidJmd: 5_000,
          balanceJmd: 0,
        },
      },
    },
  ] as const;

  for (const scenario of scenarios) {
    const store = fixedClockStore();
    await store.ready();
    const orderId = `qbo-statement-refund-${scenario.name}`;
    await addSharedQuickOrder(store, orderId, [
      unit(`refund-line-${scenario.name}`, "labor", 5_000, 2),
    ]);
    let state = stateSnapshot(store);
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId,
      expectedRevision: state.revision,
      mutationId: `statement-refund-${scenario.name}-activate-v1`,
    }, frontdeskActor, store);
    if (scenario.paymentJmd > 0) {
      state = stateSnapshot(store);
      await recordMockInvoicePayment({
        invoiceId: activation.invoiceId,
        expectedRevision: state.revision,
        mutationId: `statement-refund-${scenario.name}-payment-v1`,
        amountJmd: scenario.paymentJmd,
        method: "cash",
      }, frontdeskActor, store);
    }
    state = stateSnapshot(store);
    const refund = await recordMockInvoiceLineRefund({
      logicalInvoiceId: activation.invoiceId,
      invoiceVersionId: activation.invoiceVersionId,
      chargeLineId: `refund-line-${scenario.name}`,
      refundQuantity: scenario.refundQuantity,
      method: "cash",
      reason: `statement ${scenario.name} refund`,
      expectedRevision: state.revision,
      mutationId: `statement-refund-${scenario.name}-refund-v1`,
    }, frontdeskActor, store);
    expect(refund).toMatchObject({
      receivableReductionJmd: scenario.expected.receivableReductionJmd,
      cashRefundJmd: scenario.expected.cashRefundJmd,
    });
    const beforeRead = stateSnapshot(store);
    const statement = asRecord(statementDomain(orderId, store), `${scenario.name} statement`);
    expect(statement.ledger).toMatchObject(scenario.expected.ledger);
    const entries = statement.entries as ReadonlyArray<Record<string, unknown>>;
    const refundEntry = entries.find((entry) => entry.kind === "refund");
    expect(refundEntry).toEqual({
      kind: "refund",
      accounting: "canonical_line_v1",
      sequence: scenario.paymentJmd > 0 ? 2 : 1,
      refundId: refund.id,
      invoiceVersionId: activation.invoiceVersionId,
      line: expect.objectContaining({
        pricingMode: "unit",
        chargeLineId: `refund-line-${scenario.name}`,
        finalUnitPriceJmd: 5_000,
        finalLineJmd: 10_000,
      }),
      refundQuantity: scenario.refundQuantity,
      wholeLine: false,
      receivableReductionJmd: scenario.expected.receivableReductionJmd,
      cashRefundJmd: scenario.expected.cashRefundJmd,
      occurredAt: refund.refundedAt,
      method: "cash",
      actorName: frontdeskActor.name,
      reason: `statement ${scenario.name} refund`,
    });
    expect(stateSnapshot(store)).toEqual(beforeRead);
  }
});

test("canonical fixed-total refund is an exact immutable whole-line entry", async () => {
  const store = fixedClockStore();
  await store.ready();
  const orderId = "qbo-statement-fixed-refund";
  await addSharedQuickOrder(store, orderId, [fixed("fixed-refund-line", 7_500)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-fixed-refund-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const payment = await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-fixed-refund-payment-v1",
    amountJmd: 2_500,
    method: "cash",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    chargeLineId: "fixed-refund-line",
    wholeLine: true,
    method: "cash",
    reason: "fixed whole-line statement refund",
    expectedRevision: state.revision,
    mutationId: "statement-fixed-refund-v1",
  }, frontdeskActor, store);
  expect(refund).toMatchObject({ receivableReductionJmd: 7_500, cashRefundJmd: 2_500 });
  const beforeRead = stateSnapshot(store);

  const statement = asRecord(statementDomain(orderId, store), "fixed-total refund statement");
  const charges = asRecord(statement.charges, "fixed-total charges");
  exactDataKeys((charges.lines as ReadonlyArray<unknown>)[0], CANONICAL_FIXED_LINE_KEYS, "fixed-total charge line");
  const entries = statement.entries as ReadonlyArray<unknown>;
  exactDataKeys(entries[0], PAYMENT_ENTRY_KEYS, "fixed-total payment entry");
  const refundEntry = exactDataKeys(entries[1], CANONICAL_REFUND_ENTRY_KEYS, "fixed-total refund entry");
  exactDataKeys(refundEntry.line, CANONICAL_FIXED_LINE_KEYS, "fixed-total refund line snapshot");
  expect(entries).toEqual([
    expect.objectContaining({
      kind: "payment",
      sequence: 1,
      paymentId: payment.id,
      invoiceVersionId: activation.invoiceVersionId,
      amountJmd: 2_500,
    }),
    {
      kind: "refund",
      accounting: "canonical_line_v1",
      sequence: 2,
      refundId: refund.id,
      invoiceVersionId: activation.invoiceVersionId,
      line: expect.objectContaining({
        pricingMode: "fixed_total",
        chargeLineId: "fixed-refund-line",
        category: "other_service",
        code: "towing",
        amountJmd: 7_500,
      }),
      refundQuantity: null,
      wholeLine: true,
      receivableReductionJmd: 7_500,
      cashRefundJmd: 2_500,
      occurredAt: refund.refundedAt,
      method: "cash",
      actorName: frontdeskActor.name,
      reason: "fixed whole-line statement refund",
    },
  ]);
  expect(statement.ledger).toMatchObject({
    invoiceTotalJmd: 7_500,
    receivableJmd: 0,
    grossPaidJmd: 2_500,
    cashRefundedJmd: 2_500,
    receivableReductionJmd: 7_500,
    netPaidJmd: 0,
    balanceJmd: 0,
  });
  expect(stateSnapshot(store)).toEqual(beforeRead);
});

test("canonical parking projection comes from a real committed parking source and never enters refund history", async () => {
  const clock = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const baseStore = createMockLinkedOperationsStore(memoryStorage());
  const store: MockLinkedOperationsStore = { ...baseStore, nowMs: () => clock.nowMs };
  await store.ready();
  const orderId = "qbo-statement-parking-projection";
  await addSharedQuickOrder(store, orderId, [unit("parking-ordinary-line", "labor", 5_000)]);
  let state = stateSnapshot(store);
  const pickup = await recordMockQuickPickup({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-parking-source-create",
    channels: [{ kind: "sms", language: "en", text: "Vehicle ready for pickup." }],
  }, frontdeskActor, store);
  clock.nowMs = Date.parse("2026-08-26T12:00:00-05:00");
  state = stateSnapshot(store);
  const closed = await recordMockParkingSourcePickup({
    caseId: pickup.parkingSource.id,
    expectedRevision: state.revision,
    expectedSourceRevision: pickup.parkingSource.revision,
    mutationId: "statement-parking-source-close",
  }, frontdeskActor, store);
  expect(closed.parkingSource.accrual).toEqual({ chargeableDays: 3, originalAmountJmd: 7_500 });
  state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-parking-activate-v1",
  }, frontdeskActor, store);
  const beforeRead = stateSnapshot(store);
  expect(beforeRead.refunds.filter((refund) => (
    refund.refundContract === "ordinary_line_v1"
      && refund.logicalInvoiceId === activation.invoiceId
  ))).toEqual([]);

  const statement = asRecord(statementDomain(orderId, store), "real parking statement");
  const charges = asRecord(statement.charges, "real parking charges");
  const lines = charges.lines as ReadonlyArray<Record<string, unknown>>;
  const parkingLine = lines.find((line) => line.pricingMode === "parking_projection");
  expect(parkingLine).toBeDefined();
  exactDataKeys(parkingLine, CANONICAL_PARKING_LINE_KEYS, "real canonical parking line");
  expect(parkingLine).toEqual({
    pricingMode: "parking_projection",
    chargeLineId: `parking-projection-${pickup.parkingSource.id}`,
    category: "other_service",
    code: "parking_overtime",
    descZh: "停车超时费",
    descEn: "Parking overtime",
    remarkZh: "",
    remarkEn: "",
    parkingCaseId: pickup.parkingSource.id,
    sourceRevision: closed.parkingSource.revision,
    asOf: closed.parkingSource.asOf,
    amountJmd: 7_500,
  });
  exactDataKeys(charges.totals, CANONICAL_TOTAL_KEYS, "real parking totals");
  expect(charges.totals).toEqual({
    laborGrossJmd: 5_000,
    laborDiscountJmd: 0,
    laborNetJmd: 5_000,
    partsGrossJmd: 0,
    partsDiscountJmd: 0,
    partsNetJmd: 0,
    otherFeeTotalJmd: 0,
    parkingTotalJmd: 7_500,
    totalDiscountJmd: 0,
    chargeSubtotalJmd: 12_500,
    adjustmentsJmd: 0,
    grandTotalJmd: 12_500,
  });
  expect(statement.ledger).toMatchObject({
    invoiceTotalJmd: 12_500,
    receivableJmd: 12_500,
    balanceJmd: 12_500,
  });
  expect(statement.entries).toEqual([]);
  expect(JSON.stringify(statement.entries)).not.toMatch(/parking_projection|parkingCaseId/u);
  expect(canonicalSource(statement)).toMatchObject({
    invoiceId: activation.invoiceId,
    effectiveVersionId: activation.invoiceVersionId,
    snapshotCommitment: activation.snapshotCommitment,
  });
  expect(stateSnapshot(store)).toEqual(beforeRead);
});

test("same-time canonical entries follow private committed revision rather than fact family or timestamp", async () => {
  const store = fixedClockStore();
  await store.ready();
  const orderId = "qbo-statement-same-time-ordering";
  await addSharedQuickOrder(store, orderId, [unit("same-time-line", "labor", 5_000, 2)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-same-time-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    chargeLineId: "same-time-line",
    refundQuantity: 1,
    method: "cash",
    reason: "refund committed before payment at same instant",
    expectedRevision: state.revision,
    mutationId: "statement-same-time-refund-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const payment = await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-same-time-payment-v1",
    amountJmd: 5_000,
    method: "card",
  }, frontdeskActor, store);
  expect(payment.receivedAt).toBe(refund.refundedAt);
  const beforeRead = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(beforeRead), "same-time producer baseline").not.toThrow();
  const refundReceipt = beforeRead.mutationReceipts.find((receipt) => (
    receipt.operation === "billing.invoice.lineRefund"
      && receipt.mutationId === "statement-same-time-refund-v1"
  ));
  const paymentFact = beforeRead.payments.find((candidate) => candidate.id === payment.id);
  if (!refundReceipt || !paymentFact || paymentFact.paymentContract !== "invoice_payment_v1") {
    throw new Error("same-time committed coordinates missing");
  }
  expect(refundReceipt.committedRevision).toBeLessThan(paymentFact.committedRevision);
  expect("statement-same-time-payment-v1".localeCompare("statement-same-time-refund-v1"))
    .toBeLessThan(0);

  const statement = asRecord(statementDomain(orderId, store), "same-time statement");
  const entries = statement.entries as ReadonlyArray<Record<string, unknown>>;
  expect(entries.map((entry) => ({
    kind: entry.kind,
    sequence: entry.sequence,
    id: entry.kind === "payment" ? entry.paymentId : entry.refundId,
    occurredAt: entry.occurredAt,
  }))).toEqual([
    { kind: "refund", sequence: 1, id: refund.id, occurredAt: refund.refundedAt },
    { kind: "payment", sequence: 2, id: payment.id, occurredAt: payment.receivedAt },
  ]);
  expect(JSON.stringify(entries)).not.toMatch(/committedRevision|mutationId/u);
  expect(stateSnapshot(store)).toEqual(beforeRead);
});

test("same-time payments follow coordinated private revisions even when arrays and public IDs disagree", async () => {
  const store = fixedClockStore();
  await store.ready();
  const orderId = "qbo-statement-same-time-private-ordering";
  await addSharedQuickOrder(store, orderId, [unit("same-time-private-line", "labor", 10_000)]);
  let state = stateSnapshot(store);
  const activation = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-same-time-private-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const first = await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-same-time-private-a",
    amountJmd: 2_000,
    method: "cash",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const second = await recordMockInvoicePayment({
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-same-time-private-b",
    amountJmd: 3_000,
    method: "card",
  }, frontdeskActor, store);
  expect(first.receivedAt).toBe(second.receivedAt);

  const coordinated = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(coordinated), "producer baseline").not.toThrow();
  const firstFact = coordinated.payments.find((payment) => payment.id === first.id);
  const secondFact = coordinated.payments.find((payment) => payment.id === second.id);
  if (
    !firstFact || firstFact.paymentContract !== "invoice_payment_v1"
    || !secondFact || secondFact.paymentContract !== "invoice_payment_v1"
  ) {
    throw new Error("same-time private payment facts missing");
  }
  const firstRevision = firstFact.committedRevision;
  const secondRevision = secondFact.committedRevision;
  expect(firstRevision).toBeLessThan(secondRevision);

  const rewriteRevision = (mutationId: string, committedRevision: number): void => {
    const payment = coordinated.payments.find((candidate) => (
      candidate.paymentContract === "invoice_payment_v1" && candidate.mutationId === mutationId
    ));
    const audit = coordinated.billingAuditEvents.find((candidate) => (
      candidate.operation === "invoice_payment" && candidate.mutationId === mutationId
    ));
    const receipt = coordinated.mutationReceipts.find((candidate) => (
      candidate.operation === "billing.invoice.payment" && candidate.mutationId === mutationId
    ));
    if (!payment || payment.paymentContract !== "invoice_payment_v1" || !audit || !receipt?.payloadCanonical) {
      throw new Error(`same-time private coordinate missing: ${mutationId}`);
    }
    (payment as unknown as { committedRevision: number }).committedRevision = committedRevision;
    (audit as unknown as { committedRevision: number }).committedRevision = committedRevision;
    (receipt as unknown as { committedRevision: number }).committedRevision = committedRevision;
    const payload = JSON.parse(receipt.payloadCanonical) as Record<string, unknown>;
    payload.expectedRevision = committedRevision - 1;
    const canonical = JSON.stringify(payload);
    (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadCanonical = canonical;
    (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadHash = mutationPayloadHash(canonical);
    (receipt.result as { committedRevision: number }).committedRevision = committedRevision;
  };
  rewriteRevision(first.mutationId, secondRevision);
  rewriteRevision(second.mutationId, firstRevision);

  expect(coordinated.payments.filter((payment) => (
    payment.invoiceId === activation.invoiceId
  )).map((payment) => payment.id)).toEqual([first.id, second.id]);
  expect(first.id.localeCompare(second.id)).toBeLessThan(0);
  expect(first.mutationId.localeCompare(second.mutationId)).toBeLessThan(0);
  expect(() => validateLinkedOperationsState(coordinated), "coordinated private order baseline").not.toThrow();

  const statement = asRecord(
    selectStatement(coordinated, orderId),
    "coordinated same-time statement",
  );
  const entries = statement.entries as ReadonlyArray<Record<string, unknown>>;
  expect(entries.map((entry) => ({
    sequence: entry.sequence,
    paymentId: entry.paymentId,
    occurredAt: entry.occurredAt,
  }))).toEqual([
    { sequence: 1, paymentId: second.id, occurredAt: second.receivedAt },
    { sequence: 2, paymentId: first.id, occurredAt: first.receivedAt },
  ]);
  expect(JSON.stringify(entries)).not.toMatch(/committedRevision|mutationId/u);
});

test("V2 immutable charges stay exact while V1 payment and refund lineage stays exact", async () => {
  const store = fixedClockStore();
  await store.ready();
  const orderId = "qbo-statement-v2-lineage";
  await addSharedQuickOrder(store, orderId, [unit("stable-line", "labor", 5_000, 2)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-lineage-activate-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v1Payment = await recordMockInvoicePayment({
    invoiceId: v1.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-lineage-payment-v1",
    amountJmd: 10_000,
    method: "card",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v1Refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "stable-line",
    refundQuantity: 1,
    method: "cash",
    reason: "V1 lineage refund",
    expectedRevision: state.revision,
    mutationId: "statement-lineage-refund-v1",
  }, frontdeskActor, store);
  await store.mutate((draft) => {
    const order = draft.quickOrders.find((candidate) => candidate.id === orderId);
    if (!order || order.chargeContract !== "shared_v1" || !order.chargeLines) {
      throw new Error("shared V2 source missing");
    }
    const index = draft.quickOrders.indexOf(order);
    draft.quickOrders[index] = {
      ...order,
      chargeLines: [
        ...structuredClone(order.chargeLines),
        fixed("v2-fixed", 7_000),
      ],
    };
    draft.revision += 1;
  }, { action: "test.statement-lineage-v2-source.write", consumeWriteFault: false });
  state = stateSnapshot(store);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: state.revision,
    mutationId: "statement-lineage-activate-v2",
  }, frontdeskActor, store);
  await store.mutate((draft) => {
    const order = draft.quickOrders.find((candidate) => candidate.id === orderId);
    if (!order || order.chargeContract !== "shared_v1") throw new Error("shared post-V2 source missing");
    const index = draft.quickOrders.indexOf(order);
    draft.quickOrders[index] = {
      ...order,
      chargeLines: [unit("post-v2-drift", "labor", 99_000)],
    };
    draft.revision += 1;
  }, { action: "test.statement-lineage-post-v2-source.write", consumeWriteFault: false });
  const beforeRead = stateSnapshot(store);

  const statement = asRecord(statementDomain(orderId, store), "V2 lineage statement");
  expect(canonicalSource(statement)).toMatchObject({
    invoiceId: v2.invoiceId,
    effectiveVersionId: v2.invoiceVersionId,
    versionNo: 2,
    snapshotCommitment: v2.snapshotCommitment,
  });
  const charges = asRecord(statement.charges, "V2 charges");
  expect(charges.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ chargeLineId: "stable-line", finalLineJmd: 10_000 }),
    expect.objectContaining({ chargeLineId: "v2-fixed", amountJmd: 7_000 }),
  ]));
  expect(charges.lines).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ chargeLineId: "post-v2-drift" }),
  ]));
  expect(charges.totals).toMatchObject({ grandTotalJmd: 17_000 });
  expect(statement.entries).toEqual([
    expect.objectContaining({
      kind: "payment",
      sequence: 1,
      paymentId: v1Payment.id,
      invoiceVersionId: v1.invoiceVersionId,
      amountJmd: 10_000,
    }),
    expect.objectContaining({
      kind: "refund",
      sequence: 2,
      refundId: v1Refund.id,
      invoiceVersionId: v1.invoiceVersionId,
      line: expect.objectContaining({ chargeLineId: "stable-line", finalLineJmd: 10_000 }),
      receivableReductionJmd: 5_000,
      cashRefundJmd: 5_000,
    }),
  ]);
  expect(statement.ledger).toMatchObject({
    invoiceTotalJmd: 17_000,
    receivableJmd: 12_000,
    grossPaidJmd: 10_000,
    cashRefundedJmd: 5_000,
    receivableReductionJmd: 5_000,
    netPaidJmd: 5_000,
    balanceJmd: 7_000,
  });
  expect(stateSnapshot(store)).toEqual(beforeRead);
});

test("statement non-mock assertion and typed client surface are required", async () => {
  await expect(assertStatement({})).rejects.toThrow(/statement|module|contract|missing|缺少/i);
  expect(() => statementSurface()).not.toThrow();
  const storage = memoryStorage();
  const restore = installBrowser(storage);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await ensureMockCleanMoneyDemo(store);
    storage.operations.length = 0;
    await expect(statementSurface().statement("demo-v2-provisional")).resolves.toEqual(expect.objectContaining({
      contract: "quick_order_financial_statement_v1",
      order: expect.objectContaining({ id: "demo-v2-provisional" }),
    }));
    expect(linkedStorageOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("pure statement selector fails closed on missing, duplicate, and cross-Invoice facts", async () => {
  const store = fixedClockStore();
  const orderId = "qbo-statement-invalid-state";
  const prepared = await prepareCanonicalHistoryStore(store, orderId);
  const validState = stateSnapshot(store);
  const original = structuredClone(validState);

  expect(() => selectStatement(validState, orderId), "valid statement selector baseline").not.toThrow();
  expect(validState).toEqual(original);

  const mutants: ReadonlyArray<Readonly<{
    name: string;
    mutate(state: LinkedOperationsState): void;
  }>> = [
    {
      name: "missing refund mutation receipt",
      mutate: (state) => {
        const index = state.mutationReceipts.findIndex((receipt) => (
          receipt.mutationId === `${orderId}-refund-v1`
        ));
        expect(index).toBeGreaterThanOrEqual(0);
        (state.mutationReceipts as unknown[]).splice(index, 1);
      },
    },
    {
      name: "missing payment mutation receipt",
      mutate: (state) => {
        const index = state.mutationReceipts.findIndex((receipt) => (
          receipt.mutationId === `${orderId}-payment-v1`
        ));
        expect(index).toBeGreaterThanOrEqual(0);
        (state.mutationReceipts as unknown[]).splice(index, 1);
      },
    },
    {
      name: "omitted canonical payment fact with retained receipt",
      mutate: (state) => {
        const index = state.payments.findIndex((payment) => payment.id === prepared.paymentId);
        expect(index).toBeGreaterThanOrEqual(0);
        (state.payments as unknown[]).splice(index, 1);
      },
    },
    {
      name: "omitted canonical refund fact with retained receipt",
      mutate: (state) => {
        const index = state.refunds.findIndex((refund) => refund.id === prepared.refundId);
        expect(index).toBeGreaterThanOrEqual(0);
        (state.refunds as unknown[]).splice(index, 1);
      },
    },
    {
      name: "duplicate canonical payment fact",
      mutate: (state) => {
        const payment = state.payments.find((candidate) => candidate.id === prepared.paymentId);
        if (!payment) throw new Error("canonical payment fixture missing");
        (state.payments as unknown[]).push(structuredClone(payment));
      },
    },
    {
      name: "duplicate canonical refund fact",
      mutate: (state) => {
        const refund = state.refunds.find((candidate) => candidate.id === prepared.refundId);
        if (!refund) throw new Error("canonical refund fixture missing");
        (state.refunds as unknown[]).push(structuredClone(refund));
      },
    },
    {
      name: "cross-Invoice refund owner",
      mutate: (state) => {
        const refund = state.refunds.find((candidate) => candidate.id === prepared.refundId);
        if (!refund || refund.refundContract !== "ordinary_line_v1") {
          throw new Error("canonical refund fixture missing");
        }
        (refund as unknown as Record<string, unknown>).logicalInvoiceId = "invoice-cross-owner";
      },
    },
    {
      name: "payment points at a missing source version",
      mutate: (state) => {
        const payment = state.payments.find((candidate) => candidate.id === prepared.paymentId);
        if (!payment || payment.paymentContract !== "invoice_payment_v1") {
          throw new Error("canonical payment fixture missing");
        }
        (payment as unknown as Record<string, unknown>).invoiceVersionId = "version-cross-owner";
      },
    },
  ];

  for (const mutant of mutants) {
    const corrupted = structuredClone(validState);
    mutant.mutate(corrupted);
    const before = structuredClone(corrupted);
    expect(() => selectStatement(corrupted, orderId), mutant.name).toThrow();
    expect(corrupted, `${mutant.name} must remain read-only`).toEqual(before);
  }
  expect(validState).toEqual(original);
});

test("statement wrapper performs one read and one clock read, returns detached data, and never writes", async () => {
  const storage = memoryStorage();
  const baseStore = createMockLinkedOperationsStore(storage);
  await baseStore.ready();
  await ensureMockCleanMoneyDemo(baseStore);
  const handedState = stateSnapshot(baseStore);
  const orderId = "demo-v2-partial";
  const originalOrder = handedState.quickOrders.find((candidate) => candidate.id === orderId);
  if (!originalOrder) throw new Error("clean statement fixture missing");
  const originalBusinessOrderNo = originalOrder.businessOrderNo;
  const baseline = asRecord(statementDomain(orderId, baseStore), "clean statement baseline");
  const baselineCharges = asRecord(baseline.charges, "clean statement charges");
  const originalItemName = asRecord(
    (baselineCharges.lines as ReadonlyArray<unknown>)[0],
    "clean charge line",
  ).descZh;
  expect(baseline.entries).toEqual([]);
  let readCalls = 0;
  let nowCalls = 0;
  storage.operations.length = 0;
  const probedStore: MockLinkedOperationsStore = {
    ...baseStore,
    nowMs: () => {
      nowCalls += 1;
      return Date.parse("2026-08-22T12:00:00-05:00");
    },
    read: <T>(selector: (state: LinkedOperationsState) => T, action?: string): T => {
      readCalls += 1;
      expect(action).toBe("quickOrders.financial.statement.read");
      const result = selector(handedState);
      const mutableOrder = handedState.quickOrders.find((candidate) => candidate.id === orderId);
      if (!mutableOrder) throw new Error("handed statement order missing");
      Object.assign(mutableOrder, { businessOrderNo: "POST_SELECTOR_ORDER_MUTATION" });
      if (mutableOrder.items[0]) {
        Object.assign(mutableOrder.items[0], { descZh: "POST_SELECTOR_ITEM_MUTATION" });
      }
      const mutablePayment = handedState.payments.find((payment) => payment.invoiceId === "invoice-shared-1");
      if (mutablePayment) {
        Object.assign(mutablePayment, { amountJmd: 1 });
      }
      return result;
    },
  };

  const first = asRecord(statementDomain(orderId, probedStore), "one-read statement");
  expect(readCalls).toBe(1);
  expect(nowCalls).toBe(1);
  expect(first.revision).toBe(stateSnapshot(baseStore).revision);
  expect(first.order).toEqual(expect.objectContaining({
    id: orderId,
    businessOrderNo: originalBusinessOrderNo,
  }));
  expect(JSON.stringify(first.charges)).toContain(originalItemName);
  expect(first.entries).toEqual([]);
  (first.order as Record<string, unknown>).businessOrderNo = "MUTATED_PUBLIC_RESULT";
  ((first.entries as Array<Record<string, unknown>>)[0] ?? {}).amountJmd = 99;
  expect(storage.operations).toEqual([]);

  const fresh = asRecord(statementDomain(orderId, baseStore), "fresh detached statement");
  expect(fresh.order).toEqual(expect.objectContaining({ businessOrderNo: originalBusinessOrderNo }));
  expect(fresh.entries).toEqual([]);
  expect(storage.operations).toEqual([]);
});

test("public statement preserves the exact steady-state role matrix and hides missing-order existence", async () => {
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

    for (const allowed of [superadminSession, frontdeskSession, financeSession]) {
      storage.setItem("wh_session", JSON.stringify(allowed));
      storage.operations.length = 0;
      await expect(statementSurface().statement("demo-v2-provisional"), allowed.identity.role)
        .resolves.toEqual(expect.objectContaining({
          contract: "quick_order_financial_statement_v1",
          order: expect.objectContaining({ id: "demo-v2-provisional" }),
        }));
      expect(stateSnapshot(store)).toEqual(before);
      expect(linkedStorageOperations(storage)).toEqual([]);
    }

    storage.setItem("wh_session", JSON.stringify(superadminSession));
    storage.operations.length = 0;
    await expect(statementSurface().statement("qbo-statement-authorized-missing"))
      .rejects.toMatchObject({ status: 404 });
    expect(stateSnapshot(store)).toEqual(before);
    expect(linkedStorageOperations(storage)).toEqual([]);

    const denied: ReadonlyArray<Readonly<{ name: string; install(): void }>> = [
      {
        name: "mechanic",
        install: () => storage.setItem("wh_session", JSON.stringify(mechanicSession)),
      },
      {
        name: "parts",
        install: () => storage.setItem("wh_session", JSON.stringify(partsSession)),
      },
      {
        name: "anonymous",
        install: () => storage.removeItem("wh_session"),
      },
      {
        name: "malformed",
        install: () => storage.setItem("wh_session", "{MALFORMED_STATEMENT_SESSION"),
      },
    ];
    const originalDeniedRead = store.read;
    let deniedReadCalls = 0;
    store.read = <T>(): T => {
      deniedReadCalls += 1;
      throw new Error("DENIED_STATEMENT_STORE_READ_SENTINEL");
    };
    try {
      for (const candidate of denied) {
        candidate.install();
        storage.operations.length = 0;
        storage.reads.length = 0;
        deniedReadCalls = 0;
        await expect(
          statementSurface().statement("qbo-statement-secret-missing"),
          candidate.name,
        ).rejects.toMatchObject({ status: 403 });
        expect(deniedReadCalls, `${candidate.name} in-memory reads before auth`).toBe(0);
        expect(linkedStorageReads(storage), `${candidate.name} linked reads before auth`).toEqual([]);
        expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
        expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
        expect(linkedStorageOperations(storage)).toEqual([]);
      }
    } finally {
      store.read = originalDeniedRead;
    }
    expect(stateSnapshot(store)).toEqual(before);
  } finally {
    restore();
  }
});

test("public statement fences invocation, locked read, and response session drift without writes", async () => {
  test.setTimeout(25_000);
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

    storage.setItem("wh_session", JSON.stringify(superadminSession));
    storage.operations.length = 0;
    storage.reads.length = 0;
    const originalInvocationRead = store.read;
    let invocationReadCalls = 0;
    store.read = <T>(): T => {
      invocationReadCalls += 1;
      throw new Error("INVOCATION_DRIFT_STORE_READ_SENTINEL");
    };
    try {
      const invocation = Promise.resolve().then(() => statementSurface().statement("demo-v2-provisional"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      storage.setItem("wh_session", JSON.stringify(frontdeskSession));
      await expect(invocation).rejects.toMatchObject({ status: 403 });
    } finally {
      store.read = originalInvocationRead;
    }
    expect(invocationReadCalls, "invocation drift in-memory reads").toBe(0);
    expect(linkedStorageReads(storage), "invocation drift linked reads").toEqual([]);
    expect(linkedStorageOperations(storage)).toEqual([]);
    expect(stateSnapshot(store)).toEqual(before);

    storage.setItem("wh_session", JSON.stringify(superadminSession));
    scenario.delayMs = { byAction: { "quickOrders.financial.statement.read": 1_000 } };
    storage.operations.length = 0;
    const response = Promise.resolve().then(() => statementSurface().statement("demo-v2-provisional"));
    await new Promise((resolve) => setTimeout(resolve, 650));
    storage.setItem("wh_session", JSON.stringify(financeSession));
    await expect(response).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(store)).toEqual(before);
    expect(linkedStorageOperations(storage)).toEqual([]);

    scenario.delayMs = undefined;
    storage.setItem("wh_session", JSON.stringify(superadminSession));
    storage.operations.length = 0;
    const originalRead = store.read;
    store.read = <T>(selector: (state: LinkedOperationsState) => T, action?: string): T => {
      if (action !== "quickOrders.financial.statement.read") return originalRead(selector, action);
      storage.setItem("wh_session", JSON.stringify(frontdeskSession));
      try {
        return originalRead(selector, action);
      } finally {
        storage.setItem("wh_session", JSON.stringify(superadminSession));
      }
    };
    try {
      await expect(statementSurface().statement("demo-v2-provisional"))
        .rejects.toMatchObject({ status: 403 });
    } finally {
      store.read = originalRead;
    }
    expect(stateSnapshot(store)).toEqual(before);
    expect(storage.values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(primaryBefore);
    expect(storage.values.get(LINKED_OPERATIONS_LEGACY_QUICK_PARKING_KEY)).toBe(quickParkingBefore);
    expect(linkedStorageOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("typed and raw statement routes use the UTF-16 opaque ID exactly once before any linked read", async () => {
  test.setTimeout(20_000);
  const storage = memoryStorage();
  const restore = installBrowser(storage);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await ensureMockCleanMoneyDemo(store);
    for (const [index, { orderId }] of opaqueStatementOrderIds.entries()) {
      await addSharedQuickOrder(store, orderId, [unit(`opaque-${index}`, "labor", 1_000 + index)]);
    }
    const before = stateSnapshot(store);
    storage.operations.length = 0;
    for (const { orderId } of opaqueStatementOrderIds) {
      await expect(statementSurface().statement(orderId)).resolves.toEqual(expect.objectContaining({
        order: expect.objectContaining({ id: orderId }),
      }));
    }
    expect(stateSnapshot(store)).toEqual(before);
    expect(linkedStorageOperations(storage)).toEqual([]);

    const rawClient = loadClientWithRawMockRequest();
    storage.reads.length = 0;
    storage.operations.length = 0;
    const invalidPaths = [
      "/api/quick-order-financials/plain-id/statement",
      "/api/quick-order-financials/u002/statement",
      "/api/quick-order-financials/u002g/statement",
      "/api/quick-order-financials/./statement",
      "/api/quick-order-financials/../statement",
      "/api/quick-order-financials\\u002e\\statement",
      "/api\\quick-order-financials\\u002e\\statement",
      "/api/quick-order-financials/u002e/statement/extra",
    ];
    for (const path of invalidPaths) {
      await expect(rawClient.__rawMockRequest(path), path).rejects.toMatchObject({ status: 400 });
    }
    expect(linkedStorageReads(storage)).toEqual([]);
    expect(linkedStorageOperations(storage)).toEqual([]);
  } finally {
    restore();
  }
});

test("real-fetch statement validates opaque URLs and sanitizes every invalid 2xx before generic normalizers", async () => {
  const base = validCanonicalStatement();
  const validResponses = opaqueStatementOrderIds.map(({ orderId }) => {
    const response = structuredClone(base);
    (response.order as Record<string, unknown>).id = orderId;
    return response;
  });
  const sentinel = "PRIVATE_STATEMENT_RESPONSE_SENTINEL";
  const wrongIdentity = structuredClone(base);
  (wrongIdentity.order as Record<string, unknown>).id = "qbo-wrong-response-owner";
  const semanticDrift = structuredClone(base);
  (semanticDrift.ledger as Record<string, unknown>).balanceJmd = 999_999;
  const crossContract = {
    customers: [{
      verificationArchive: {
        kycRecords: [{
          subjectType: "organization_primary_contact",
          subjectProfile: `DRIVER_LICENSE_PROFILE_INVALID_${sentinel}`,
        }],
      },
    }],
    privateEvidence: sentinel,
  };
  const responseQueue: Array<Readonly<{ body: string; contentType: string }>> = [
    ...validResponses.map((response) => ({
      body: JSON.stringify(response),
      contentType: "application/json",
    })),
    { body: JSON.stringify(wrongIdentity), contentType: "application/json" },
    { body: JSON.stringify(semanticDrift), contentType: "application/json" },
    { body: JSON.stringify(crossContract), contentType: "application/json" },
    { body: `not-json-${sentinel}`, contentType: "text/plain" },
  ];
  const previousUseMock = process.env.NEXT_PUBLIC_USE_MOCK;
  const previousApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  const modulePath = require.resolve("../../src/lib/api/client");
  const requests: Array<Readonly<{ url: string; init: RequestInit | undefined }>> = [];
  try {
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    delete require.cache[modulePath];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      const next = responseQueue.shift();
      if (!next) throw new Error("unexpected statement real fetch");
      return new Response(next.body, {
        status: 200,
        headers: { "Content-Type": next.contentType },
      });
    }) as typeof fetch;
    const realClient = require(modulePath) as typeof import("../../src/lib/api/client");
    const surface = statementSurface(realClient.api);
    for (const [index, { orderId }] of opaqueStatementOrderIds.entries()) {
      await expect(surface.statement(orderId)).resolves.toEqual(validResponses[index]);
    }
    const invalidCalls = [
      () => surface.statement("qbo-request-owner"),
      () => surface.statement("qbo-statement-closed"),
      () => surface.statement("qbo-statement-closed"),
      () => surface.statement("qbo-statement-closed"),
    ];
    for (const invoke of invalidCalls) {
      let error: unknown;
      try {
        await invoke();
        throw new Error("invalid statement response unexpectedly succeeded");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(realClient.ApiError);
      expect(error).toMatchObject({
        status: 502,
        code: "QUICK_ORDER_FINANCIAL_STATEMENT_RESPONSE_INVALID",
      });
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
    expect(requests.map((request) => request.url)).toEqual([
      ...opaqueStatementOrderIds.map(({ segment }) => (
        `/api/quick-order-financials/${segment}/statement`
      )),
      "/api/quick-order-financials/u00710062006f002d0072006500710075006500730074002d006f0077006e00650072/statement",
      ...Array.from({ length: 3 }, () => (
        "/api/quick-order-financials/u00710062006f002d00730074006100740065006d0065006e0074002d0063006c006f007300650064/statement"
      )),
    ]);
    for (const request of requests) {
      expect(request.init?.method).toBeUndefined();
      expect(request.init?.body).toBeUndefined();
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
