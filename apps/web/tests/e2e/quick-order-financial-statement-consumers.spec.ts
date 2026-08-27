import { expect, test, type Page } from "@playwright/test";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoiceLineRefund,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import {
  createMockLinkedOperationsStore,
  LINKED_OPERATIONS_STORAGE_KEY,
  type LinkedOperationsState,
  type MockLinkedOperationsStore,
} from "../../src/lib/api/mock-orders";
import type { QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";
import {
  assertNoPerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

const CANONICAL_ORDER_ID = "qbo-statement-consumer-canonical";
const UNINVOICED_ORDER_ID = "qbo-statement-consumer-uninvoiced";
const QUICK_PARKING_KEY = "wh_quick_parking_v1";
const OLD_COMPOSITE_FAILURE_PROBE_KEY = "wh_e2e_statement_old_failure_consumed";
const OLD_COMPOSITE_FAILURE_STARTED_KEY = "wh_e2e_statement_old_failure_started";
const OLD_COMPOSITE_FAILURE_B_STARTED_KEY = "wh_e2e_statement_old_failure_b_started";
const OLD_COMPOSITE_FAILURE_FINAL_STARTED_KEY = "wh_e2e_statement_old_failure_final_started";
const STATEMENT_ABA_STARTED_MARKER_TIMEOUT_MS = 5_000;
// All three statement timers use one delay larger than both later-generation
// marker windows combined, so their confirmed registration order decides which fires first.
const STATEMENT_ABA_TIMER_DELAY_MS = 15_000;
const STATEMENT_ABA_FINAL_COMPOSITE_TAIL_MS = 5_000;
const STATEMENT_ABA_OLD_COMPLETION_TIMEOUT_MS = 16_000;
const STATEMENT_ABA_FINAL_COMPLETION_TIMEOUT_MS = 21_000;

type SessionSignal = "storage" | "popstate";

const statementSessions = {
  superadmin: {
    identity: {
      id: "emp-001", name: "超级管理员", nameEn: "Super Admin", role: "superadmin",
      roleLabel: "超级管理员", roleLabelEn: "Super Admin", scope: "all",
      avatarColor: "#465fff", initials: "SA",
    },
    token: "offline-emp-001",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  frontdesk: {
    identity: {
      id: "emp-custom-1", name: "测试前台", nameEn: "Test Front Desk", role: "frontdesk_admin",
      roleLabel: "前台管理员", roleLabelEn: "Front Desk Admin", scope: "all",
      avatarColor: "#0ea5e9", initials: "TF",
    },
    token: "offline-emp-custom-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
} as const;

const superadminActor = {
  id: "emp-001",
  name: "超级管理员",
  role: "superadmin" as const,
};

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

const unit = (
  id: string,
  unitPriceJmd: number,
  quantity = 1,
): Extract<QuickOrderChargeLine, { pricingMode: "unit" }> => ({
  id,
  category: "labor",
  pricingMode: "unit",
  descZh: `工时 ${id}`,
  descEn: `Labor ${id}`,
  remarkZh: "客户安全检查",
  remarkEn: "Customer safety inspection",
  unit: "项",
  unitEn: "item",
  quantity,
  unitPriceJmd,
  unitDiscountJmd: 0,
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
  descZh: "拖车服务",
  descEn: "Towing service",
  remarkZh: "V2 固定费用",
  remarkEn: "V2 fixed charge",
  amountJmd,
});

function snapshot(store: MockLinkedOperationsStore): LinkedOperationsState {
  return store.read((state) => state, "test.statement-consumer.snapshot");
}

async function addSharedOrder(
  store: MockLinkedOperationsStore,
  orderId: string,
  lines: ReadonlyArray<QuickOrderChargeLine>,
  createdAt: string,
): Promise<void> {
  await store.mutate((state) => {
    const base = state.quickOrders[0];
    if (!base) throw new Error("seed Quick BO missing");
    state.quickOrders.push({
      ...structuredClone(base),
      id: orderId,
      businessOrderNo: `KGN-WH-${orderId.toUpperCase()}`,
      createdAt,
      submittedAt: createdAt,
      status: "submitted",
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
  }, { action: "test.statement-consumer.source.write", consumeWriteFault: false });
}

type StatementBrowserFixture = Readonly<{
  raw: string;
  paymentId: string;
  refundId: string;
  v1VersionId: string;
  v2VersionId: string;
  invoiceNo: string;
}>;

async function statementBrowserFixture(): Promise<StatementBrowserFixture> {
  const storage = memoryStorage();
  const baseStore = createMockLinkedOperationsStore(storage);
  const store: MockLinkedOperationsStore = {
    ...baseStore,
    nowMs: () => Date.parse("2026-08-22T12:00:00-05:00"),
  };
  await store.ready();
  await store.mutate((draft) => {
    draft.trustedIdentities.push({ id: "emp-custom-1", role: "frontdesk_admin" });
    draft.revision += 1;
  }, { action: "test.statement-consumer.frontdesk.create", consumeWriteFault: false });
  await addSharedOrder(
    store,
    CANONICAL_ORDER_ID,
    [unit("statement-v1-labor", 5_000, 2)],
    "2026-08-22T09:00:00-05:00",
  );
  await addSharedOrder(
    store,
    UNINVOICED_ORDER_ID,
    [unit("statement-provisional-labor", 7_000)],
    "2026-08-22T10:00:00-05:00",
  );

  let state = snapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId: CANONICAL_ORDER_ID,
    expectedRevision: state.revision,
    mutationId: "statement-consumer-activate-v1",
  }, superadminActor, store);
  state = snapshot(store);
  const refund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "statement-v1-labor",
    refundQuantity: 1,
    method: "cash",
    reason: "statement cash-zero reduction",
    expectedRevision: state.revision,
    mutationId: "statement-consumer-refund-v1",
  }, superadminActor, store);
  expect(refund).toMatchObject({ receivableReductionJmd: 5_000, cashRefundJmd: 0 });
  state = snapshot(store);
  const payment = await recordMockInvoicePayment({
    invoiceId: v1.invoiceId,
    expectedRevision: state.revision,
    mutationId: "statement-consumer-payment-v1",
    amountJmd: 4_000,
    method: "cash",
    note: "statement payment after reduction",
  }, superadminActor, store);
  expect(payment.receivedAt).toBe(refund.refundedAt);

  await store.mutate((draft) => {
    const index = draft.quickOrders.findIndex((order) => order.id === CANONICAL_ORDER_ID);
    const order = draft.quickOrders[index];
    if (!order || order.chargeContract !== "shared_v1" || !Array.isArray(order.chargeLines)) {
      throw new Error("statement V2 source missing");
    }
    draft.quickOrders[index] = {
      ...order,
      chargeLines: [...structuredClone(order.chargeLines), fixed("statement-v2-towing", 7_500)],
    };
    draft.revision += 1;
  }, { action: "test.statement-consumer-v2-source.write", consumeWriteFault: false });
  state = snapshot(store);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId: CANONICAL_ORDER_ID,
    expectedRevision: state.revision,
    mutationId: "statement-consumer-activate-v2",
    adjustments: [{
      id: "statement-consumer-v2-write-off",
      kind: "write_off",
      amountJmd: -9_500,
    }],
  }, superadminActor, store);
  await store.mutate((draft) => {
    const index = draft.quickOrders.findIndex((order) => order.id === CANONICAL_ORDER_ID);
    const order = draft.quickOrders[index];
    if (!order || order.chargeContract !== "shared_v1") throw new Error("statement raw drift target missing");
    draft.quickOrders[index] = {
      ...order,
      chargeLines: [unit("statement-post-v2-raw-drift", 99_000)],
    };
    draft.revision += 1;
  }, { action: "test.statement-consumer-post-v2-drift.write", consumeWriteFault: false });

  const finalState = snapshot(store);
  const rawOrder = finalState.quickOrders.find((order) => order.id === CANONICAL_ORDER_ID);
  expect(rawOrder?.payments).toEqual([]);
  expect(rawOrder?.refunds).toEqual([]);
  const raw = storage.getItem(LINKED_OPERATIONS_STORAGE_KEY);
  if (raw === null) throw new Error("statement browser fixture was not serialized");
  return {
    raw,
    paymentId: payment.id,
    refundId: refund.id,
    v1VersionId: v1.invoiceVersionId,
    v2VersionId: v2.invoiceVersionId,
    invoiceNo: v2.invoiceNo,
  };
}

async function installStatementState(page: Page, fixture: StatementBrowserFixture): Promise<void> {
  await page.goto("/");
  await page.evaluate(({ key, serialized }) => {
    window.localStorage.setItem(key, serialized);
  }, {
    key: LINKED_OPERATIONS_STORAGE_KEY,
    serialized: fixture.raw,
  });
}

async function installStatementStorageProbe(page: Page): Promise<void> {
  await page.addInitScript(({ primaryKey, quickKey }) => {
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    const probeKey = "wh_e2e_statement_consumer_storage_probe";
    const read = (): Array<{ kind: string; key: string | null }> => {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(probeKey) ?? "[]") as unknown;
        return Array.isArray(parsed) ? parsed as Array<{ kind: string; key: string | null }> : [];
      } catch {
        return [];
      }
    };
    const record = (kind: string, key: string | null): void => {
      originalSet.call(window.sessionStorage, probeKey, JSON.stringify([...read(), { kind, key }]));
    };
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (this === window.localStorage && (key === primaryKey || key === quickKey)) record("set", key);
      originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string): void {
      if (this === window.localStorage && (key === primaryKey || key === quickKey)) record("remove", key);
      originalRemove.call(this, key);
    };
    Storage.prototype.clear = function clear(): void {
      if (this === window.localStorage) record("clear", null);
      originalClear.call(this);
    };
  }, { primaryKey: LINKED_OPERATIONS_STORAGE_KEY, quickKey: QUICK_PARKING_KEY });
}

async function resetStatementStorageProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.sessionStorage.setItem("wh_e2e_statement_consumer_storage_probe", "[]");
  });
}

type StatementStorageOperation = Readonly<{
  kind: "set" | "remove" | "clear";
  key: string | null;
}>;

async function statementStorageOperations(page: Page): Promise<StatementStorageOperation[]> {
  return page.evaluate(() => JSON.parse(
    window.sessionStorage.getItem("wh_e2e_statement_consumer_storage_probe") ?? "[]",
  ) as StatementStorageOperation[]);
}

function statementDelayScenario(delay: number): Record<string, unknown> {
  return {
    delayMs: {
      byAction: {
        "quickOrders.detail.read": delay,
        "quickOrders.list.read": delay,
        "quickOrders.financial.detail.read": delay,
        "quickOrders.lifecycle.preflight.read": delay,
        "quickOrders.financial.statement.read": delay,
      },
    },
  };
}

async function installInitialStatementDelay(page: Page, delayMs: number): Promise<void> {
  await page.addInitScript((delay) => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
        delayMs: {
          byAction: {
            "quickOrders.detail.read": delay,
            "quickOrders.list.read": delay,
            "quickOrders.financial.detail.read": delay,
            "quickOrders.lifecycle.preflight.read": delay,
            "quickOrders.financial.statement.read": delay,
          },
        },
      };
    (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
      .__WH_CUSTOMERS_TEST_SCENARIO__ = { delayMs: { customerVehicleRead: delay } };
  }, delayMs);
}

async function installInitialStatementFailure(
  page: Page,
  delayMs: number,
): Promise<void> {
  await page.addInitScript((delay) => {
    window.sessionStorage.removeItem("wh_e2e_statement_old_failure_consumed");
    window.sessionStorage.removeItem("wh_e2e_statement_old_failure_started");
    window.sessionStorage.removeItem("wh_e2e_statement_old_failure_b_started");
    window.sessionStorage.removeItem("wh_e2e_statement_old_failure_final_started");
    const initialActionDelays: Record<string, number> = {
      "quickOrders.detail.read": delay,
      "quickOrders.list.read": delay,
      "quickOrders.financial.detail.read": delay,
      "quickOrders.lifecycle.preflight.read": delay,
    };
    Object.defineProperty(initialActionDelays, "quickOrders.financial.statement.read", {
      configurable: true,
      enumerable: true,
      get() {
        window.sessionStorage.setItem("wh_e2e_statement_old_failure_started", "1");
        return delay;
      },
    });
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
        delayMs: { byAction: initialActionDelays },
      };
    (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
      .__WH_CUSTOMERS_TEST_SCENARIO__ = { delayMs: { customerVehicleRead: delay } };
  }, delayMs);
}

async function waitForStatementFailureRequest(page: Page, markerKey: string): Promise<void> {
  await expect.poll(
    () => page.evaluate((key) => window.sessionStorage.getItem(key), markerKey),
    { timeout: STATEMENT_ABA_STARTED_MARKER_TIMEOUT_MS },
  ).toBe("1");
}

async function switchStatementSession(
  page: Page,
  identity: keyof typeof statementSessions,
  signal: SessionSignal,
  delayMs: number,
  failureRace?: {
    startedMarkerKey: string;
    failureSentinel?: string;
    compositeTailDelayMs?: number;
  },
): Promise<void> {
  await page.evaluate(({ serialized, eventKind, delay, race }) => {
    const selectedSession = JSON.parse(serialized) as {
      identity: Record<string, unknown> & { role: string };
    };
    if (selectedSession.identity.role !== "superadmin") {
      window.localStorage.setItem("wh_employees_v1", JSON.stringify([{
        ...selectedSession.identity,
        teamId: null,
      }]));
    }
    const oldValue = window.localStorage.getItem("wh_session");
    const compositeDelay = delay + (race?.compositeTailDelayMs ?? 0);
    const actionDelays: Record<string, number> = {
      "quickOrders.detail.read": compositeDelay,
      "quickOrders.list.read": compositeDelay,
      "quickOrders.financial.detail.read": compositeDelay,
      "quickOrders.lifecycle.preflight.read": compositeDelay,
    };
    if (race) {
      Object.defineProperty(actionDelays, "quickOrders.financial.statement.read", {
        configurable: true,
        enumerable: true,
        get() {
          window.sessionStorage.setItem(race.startedMarkerKey, "1");
          return delay;
        },
      });
    } else {
      actionDelays["quickOrders.financial.statement.read"] = delay;
    }
    const linkedScenario: {
      delayMs: { byAction: Record<string, number> };
      failNext?: { byAction: Record<string, unknown> };
    } = { delayMs: { byAction: actionDelays } };
    if (race?.failureSentinel) {
      const sentinel = race.failureSentinel;
      linkedScenario.failNext = {
        byAction: {
          "quickOrders.financial.statement.read": {
            toString() {
              window.sessionStorage.setItem("wh_e2e_statement_old_failure_consumed", sentinel);
              return sentinel;
            },
          },
        },
      };
    }
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = linkedScenario;
    (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
      .__WH_CUSTOMERS_TEST_SCENARIO__ = { delayMs: { customerVehicleRead: compositeDelay } };
    window.localStorage.setItem("wh_session", serialized);
    if (eventKind === "storage") {
      window.dispatchEvent(new StorageEvent("storage", { key: "wh_session", oldValue, newValue: serialized }));
    } else {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, {
    serialized: JSON.stringify(statementSessions[identity]),
    eventKind: signal,
    delay: delayMs,
    race: failureRace,
  });
}

async function installStatementReadProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = "wh_e2e_statement_read_log";
    const read = (): string[] => {
      try {
        const value = JSON.parse(window.sessionStorage.getItem(key) ?? "[]") as unknown;
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    };
    const log = (action: string): void => {
      window.sessionStorage.setItem(key, JSON.stringify([...read(), action]));
    };
    const byAction = new Proxy<Record<string, undefined>>(Object.create(null), {
      get: (_target, property) => {
        if (typeof property === "string") log(property);
        return undefined;
      },
    });
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = { failNext: { byAction } };
  });
}

async function resetStatementReadProbe(page: Page): Promise<void> {
  await page.evaluate(() => window.sessionStorage.setItem("wh_e2e_statement_read_log", "[]"));
}

async function statementReadLog(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(
    window.sessionStorage.getItem("wh_e2e_statement_read_log") ?? "[]",
  ) as string[]);
}

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("QuickDetail renders V2 immutable charges and same-time canonical history without fabricating cash or receipts", async ({ page }) => {
  test.setTimeout(45_000);
  const fixture = await statementBrowserFixture();
  await installStatementState(page, fixture);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}`);

  await expect(page.getByTestId("quick-fin-source")).toHaveText("正式发票 · V2");
  await expect(page.getByTestId("quick-detail-grand-total")).toHaveText("JMD 8,000");
  await expect(page.getByTestId("quick-fin-paid")).toHaveText("JMD 4,000");
  await expect(page.getByTestId("quick-fin-refunded")).toHaveText("JMD 0");
  await expect(page.getByTestId("quick-fin-balance")).toHaveText("JMD -1,000");
  await expect(page.getByTestId("quick-statement-history")).toBeVisible();

  const refundEntry = page.getByTestId(`quick-statement-entry-${fixture.refundId}`);
  const paymentEntry = page.getByTestId(`quick-statement-entry-${fixture.paymentId}`);
  await expect(refundEntry).toHaveAttribute("data-sequence", "1");
  await expect(paymentEntry).toHaveAttribute("data-sequence", "2");
  await expect(refundEntry).toContainText("应收冲减 JMD 5,000");
  await expect(refundEntry).toContainText("实际退还现金 JMD 0");
  await expect(refundEntry).toContainText("未退还现金");
  await expect(refundEntry).not.toContainText("已退还现金");
  await expect(refundEntry).toContainText("statement-v1-labor");
  await expect(paymentEntry).toContainText("JMD 4,000");
  await expect(page.getByTestId(`quick-refund-print-${fixture.refundId}`)).toHaveCount(0);
  await expect(page.getByTestId(`quick-refund-sign-${fixture.refundId}`)).toHaveCount(0);
  expect(await page.getByTestId("quick-detail-items").innerText()).not.toContain("JMD 99,000");

  await page.goto(`/orders/business/${UNINVOICED_ORDER_ID}`);
  await expect(page.getByTestId("quick-fin-source")).toHaveText("Business Order · 尚未开票");
  await expect(page.getByTestId("quick-statement-history")).toHaveCount(0);
  await expect(page.getByTestId("quick-invoice-pdf-section")).toHaveCount(0);
});

test("QuickPrint uses clean Invoice and provisional sources while technician remains statement-free", async ({ page }) => {
  test.setTimeout(55_000);
  const fixture = await statementBrowserFixture();
  await installStatementState(page, fixture);
  await installStatementReadProbe(page);

  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=office`);
  await expect(page.getByTestId("quick-print-sheet-office")).toBeVisible();
  await expect(page.getByTestId("quick-print-source"))
    .toHaveAttribute("data-source-kind", "canonical_invoice");
  await expect(page.getByTestId("quick-print-source")).toContainText(`${fixture.invoiceNo} · V2`);
  await expect(page.getByTestId("quick-print-document-title")).toContainText("正式发票");
  await expect(page.getByTestId("quick-print-document-title")).not.toContainText("Repair Order");
  await expect(page.getByTestId("quick-print-document-no")).toHaveText(`${fixture.invoiceNo} · V2`);
  await expect(page.getByTestId("quick-print-charge-lines")).toContainText("拖车服务");
  await expect(page.getByTestId("quick-print-other-fee-total")).toHaveText("JMD 7,500");
  await expect(page.getByTestId("quick-print-parking-total")).toHaveText("JMD 0");
  await expect(page.getByTestId("quick-print-charge-subtotal")).toHaveText("JMD 17,500");
  await expect(page.getByTestId("quick-print-adjustments")).toHaveText("−JMD 9,500");
  await expect(page.getByTestId("quick-print-grand-total")).toHaveText("JMD 8,000");
  await expect(page.getByTestId("quick-print-balance")).toHaveText("客户贷方 / Customer credit JMD 1,000");
  await expect(page.getByTestId("quick-print-payment-records")).toContainText("应收冲减 JMD 5,000");
  await expect(page.getByTestId("quick-print-payment-records")).toContainText("实际退还现金 JMD 0");
  expect(await page.getByTestId("quick-print-sheet-office").innerText()).not.toContain("JMD 99,000");

  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=zh`);
  await expect(page.getByTestId("quick-print-document-title")).toHaveText("正式发票 · 客户联");
  await expect(page.getByTestId("quick-print-document-no")).toHaveText(`${fixture.invoiceNo} · V2`);

  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=en`);
  await expect(page.getByTestId("quick-print-document-title")).toHaveText("Invoice · Customer Copy");
  await expect(page.getByTestId("quick-print-document-no")).toHaveText(`${fixture.invoiceNo} · V2`);

  await page.goto(`/orders/business/${UNINVOICED_ORDER_ID}/print?copy=zh`);
  await expect(page.getByTestId("quick-print-source"))
    .toHaveAttribute("data-source-kind", "shared_uninvoiced");
  await expect(page.getByTestId("quick-print-source")).toContainText("暂记应收");
  await expect(page.getByTestId("quick-print-sheet-zh")).not.toContainText("正式发票");
  await expect(page.getByTestId("quick-print-payment-records")).toHaveCount(0);

  await page.goto(`/orders/business/${UNINVOICED_ORDER_ID}/print?copy=en`);
  await expect(page.getByTestId("quick-print-document-title")).toHaveText("Provisional Business Order · Customer Copy");
  await expect(page.getByTestId("quick-print-document-no")).toContainText("KGN-WH-");

  await page.goto(`/orders/business/${UNINVOICED_ORDER_ID}/print?copy=office`);
  await expect(page.getByTestId("quick-print-document-title"))
    .toHaveText("未开票业务单 · 客户联 / Provisional Business Order · Customer Copy");
  await expect(page.getByTestId("quick-print-document-no"))
    .toHaveText("KGN-WH-QBO-STATEMENT-CONSUMER-UNINVOICED");

  await resetStatementReadProbe(page);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=technician`);
  await expect(page.getByTestId("quick-print-sheet-technician")).toBeVisible();
  await expect(page.getByTestId("quick-print-document-title")).toHaveText("维修工作与检查回交单 · 维修工联");
  await expect(page.getByTestId("quick-print-document-no")).toContainText("KGN-WH-");
  await expect(page.getByTestId("quick-print-source")).toHaveCount(0);
  await expect(page.getByTestId("quick-print-payment-statement")).toHaveCount(0);
  await expect(page.getByTestId("quick-print-payment-records")).toHaveCount(0);
  const technicianReads = await statementReadLog(page);
  expect(technicianReads).not.toContain("quickOrders.financial.statement.read");
  expect(technicianReads).not.toContain("quickOrders.financial.detail.read");
});

test("QuickDetail clears loaded statement and rejects an old same-key ABA completion", async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await statementBrowserFixture();
  await installStatementStorageProbe(page);
  await installStatementState(page, fixture);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}`);
  await expect(page.getByTestId("quick-statement-history")).toBeVisible();
  const privateCustomerLine = (await page.getByTestId("quick-detail-no")
    .locator("xpath=../following-sibling::p[1]").innerText()).trim();
  await resetStatementStorageProbe(page);

  await switchStatementSession(page, "frontdesk", "storage", 1_500);
  await expect(page.getByTestId("quick-detail-loading")).toBeVisible();
  await expect(page.getByTestId("quick-statement-history")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(privateCustomerLine);
  await expect(page.getByTestId("quick-statement-history")).toBeVisible({ timeout: 5_000 });

  await installInitialStatementDelay(page, 1_500);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}`);
  await expect(page.getByTestId("quick-detail-loading")).toBeVisible();
  await page.waitForTimeout(700);
  await switchStatementSession(page, "frontdesk", "popstate", 3_000);
  await page.waitForTimeout(500);
  await switchStatementSession(page, "superadmin", "storage", 4_500);
  await page.waitForTimeout(1_300);
  await expect(page.getByTestId("quick-detail-loading")).toBeVisible();
  await expect(page.getByTestId("quick-statement-history")).toHaveCount(0);
  await expect(page.getByTestId("quick-detail-no")).toHaveCount(0);
  await expect(page.getByTestId("quick-detail-error")).toHaveCount(0);
  await expect(page.getByTestId("quick-statement-history")).toBeVisible({ timeout: 7_000 });
  expect(await statementStorageOperations(page)).toEqual([]);
});

test("QuickPrint clears loaded statement and rejects an old same-key ABA completion", async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await statementBrowserFixture();
  await installStatementStorageProbe(page);
  await installStatementState(page, fixture);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=office`);
  await expect(page.getByTestId("quick-print-payment-records")).toBeVisible();
  const privateOrderNo = `KGN-WH-${CANONICAL_ORDER_ID.toUpperCase()}`;
  await expect(page.getByTestId("quick-print-sheet-office")).toContainText(privateOrderNo);
  await resetStatementStorageProbe(page);

  await switchStatementSession(page, "frontdesk", "popstate", 1_500);
  await expect(page.getByTestId("quick-print-loading")).toBeVisible();
  await expect(page.getByTestId("quick-print-sheet-office")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(privateOrderNo);
  await expect(page.getByTestId("quick-print-payment-records")).toBeVisible({ timeout: 5_000 });

  await installInitialStatementDelay(page, 1_500);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=office`);
  await expect(page.getByTestId("quick-print-loading")).toBeVisible();
  await page.waitForTimeout(700);
  await switchStatementSession(page, "frontdesk", "storage", 3_000);
  await page.waitForTimeout(500);
  await switchStatementSession(page, "superadmin", "popstate", 4_500);
  await page.waitForTimeout(1_300);
  await expect(page.getByTestId("quick-print-loading")).toBeVisible();
  await expect(page.getByTestId("quick-print-sheet-office")).toHaveCount(0);
  await expect(page.getByTestId("quick-print-error")).toHaveCount(0);
  await expect(page.getByTestId("quick-print-payment-records")).toBeVisible({ timeout: 7_000 });
  expect(await statementStorageOperations(page)).toEqual([]);
});

test("QuickDetail generation-fences an old same-key ABA composite failure before the final request succeeds", async ({ page }) => {
  test.setTimeout(60_000);
  const failureSentinel = "OLD_A_DETAIL_COMPOSITE_FAILURE_SENTINEL";
  const fixture = await statementBrowserFixture();
  await installStatementStorageProbe(page);
  await installStatementState(page, fixture);
  await resetStatementStorageProbe(page);
  await installInitialStatementFailure(page, STATEMENT_ABA_TIMER_DELAY_MS);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}`);
  await waitForStatementFailureRequest(page, OLD_COMPOSITE_FAILURE_STARTED_KEY);
  await expect(page.getByTestId("quick-detail-loading")).toBeVisible();

  await switchStatementSession(page, "frontdesk", "popstate", STATEMENT_ABA_TIMER_DELAY_MS, {
    startedMarkerKey: OLD_COMPOSITE_FAILURE_B_STARTED_KEY,
  });
  await waitForStatementFailureRequest(page, OLD_COMPOSITE_FAILURE_B_STARTED_KEY);
  await switchStatementSession(page, "superadmin", "storage", STATEMENT_ABA_TIMER_DELAY_MS, {
    startedMarkerKey: OLD_COMPOSITE_FAILURE_FINAL_STARTED_KEY,
    failureSentinel,
    compositeTailDelayMs: STATEMENT_ABA_FINAL_COMPOSITE_TAIL_MS,
  });
  await waitForStatementFailureRequest(page, OLD_COMPOSITE_FAILURE_FINAL_STARTED_KEY);
  await expect.poll(
    () => page.evaluate((key) => window.sessionStorage.getItem(key), OLD_COMPOSITE_FAILURE_PROBE_KEY),
    { timeout: STATEMENT_ABA_OLD_COMPLETION_TIMEOUT_MS },
  ).toBe(failureSentinel);

  await expect(page.getByTestId("quick-detail-loading")).toBeVisible();
  await expect(page.getByTestId("quick-detail-error")).toHaveCount(0);
  await expect(page.getByTestId("quick-detail-no")).toHaveCount(0);
  await expect(page.getByTestId("quick-statement-history")).toHaveCount(0);
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), OLD_COMPOSITE_FAILURE_PROBE_KEY))
    .toBe(failureSentinel);
  expect(await page.locator("body").innerText()).not.toContain(failureSentinel);

  await expect(page.getByTestId("quick-statement-history")).toBeVisible({
    timeout: STATEMENT_ABA_FINAL_COMPLETION_TIMEOUT_MS,
  });
  await expect(page.getByTestId("quick-detail-no")).toBeVisible();
  await expect(page.getByTestId("quick-detail-error")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(failureSentinel);
  const detailStorageOperations = await statementStorageOperations(page);
  expect(detailStorageOperations).toEqual([]);
});

test("QuickPrint generation-fences an old same-key ABA composite failure before the final request succeeds", async ({ page }) => {
  test.setTimeout(60_000);
  const failureSentinel = "OLD_A_PRINT_COMPOSITE_FAILURE_SENTINEL";
  const fixture = await statementBrowserFixture();
  await installStatementStorageProbe(page);
  await installStatementState(page, fixture);
  await resetStatementStorageProbe(page);
  await installInitialStatementFailure(page, STATEMENT_ABA_TIMER_DELAY_MS);
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}/print?copy=office`);
  await waitForStatementFailureRequest(page, OLD_COMPOSITE_FAILURE_STARTED_KEY);

  await switchStatementSession(page, "frontdesk", "storage", STATEMENT_ABA_TIMER_DELAY_MS, {
    startedMarkerKey: OLD_COMPOSITE_FAILURE_B_STARTED_KEY,
  });
  await waitForStatementFailureRequest(page, OLD_COMPOSITE_FAILURE_B_STARTED_KEY);
  await switchStatementSession(page, "superadmin", "popstate", STATEMENT_ABA_TIMER_DELAY_MS, {
    startedMarkerKey: OLD_COMPOSITE_FAILURE_FINAL_STARTED_KEY,
    failureSentinel,
    compositeTailDelayMs: STATEMENT_ABA_FINAL_COMPOSITE_TAIL_MS,
  });
  await waitForStatementFailureRequest(page, OLD_COMPOSITE_FAILURE_FINAL_STARTED_KEY);

  await expect.poll(
    () => page.evaluate((key) => window.sessionStorage.getItem(key), OLD_COMPOSITE_FAILURE_PROBE_KEY),
    { timeout: STATEMENT_ABA_OLD_COMPLETION_TIMEOUT_MS },
  ).toBe(failureSentinel);
  await expect(page.getByTestId("quick-print-loading")).toBeVisible();
  await expect(page.getByTestId("quick-print-error")).toHaveCount(0);
  await expect(page.getByTestId("quick-print-sheet-office")).toHaveCount(0);
  await expect(page.getByTestId("quick-print-payment-records")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(failureSentinel);

  await expect(page.getByTestId("quick-print-payment-records")).toBeVisible({
    timeout: STATEMENT_ABA_FINAL_COMPLETION_TIMEOUT_MS,
  });
  await expect(page.getByTestId("quick-print-sheet-office")).toBeVisible();
  await expect(page.getByTestId("quick-print-error")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(failureSentinel);
  const printStorageOperations = await statementStorageOperations(page);
  expect(printStorageOperations).toEqual([]);
});

test("canonical PDF preview is generated locally from the joined statement and never calls the retired route", async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await statementBrowserFixture();
  await installStatementStorageProbe(page);
  await installStatementState(page, fixture);
  let retiredRouteCalls = 0;
  await page.route("**/api/pdf/invoice", async (route) => {
    retiredRouteCalls += 1;
    await route.fulfill({ status: 410, body: "retired PDF route" });
  });
  await page.goto(`/orders/business/${CANONICAL_ORDER_ID}`);
  await expect(page.getByTestId("quick-invoice-pdf-section")).toBeVisible();
  await resetStatementStorageProbe(page);
  await page.getByTestId("quick-invoice-pdf-language").selectOption("bilingual");
  await page.getByTestId("quick-invoice-pdf-preview").click();
  await expect(page.getByTestId("quick-invoice-pdf-canvas")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId("quick-invoice-pdf-status")).toContainText("预览已生成");
  const canonicalDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("quick-invoice-pdf-download").click();
  const canonicalDownload = await canonicalDownloadPromise;
  expect(canonicalDownload.suggestedFilename()).toBe(`${fixture.invoiceNo}-V2-BI.pdf`);
  expect(retiredRouteCalls).toBe(0);
  expect(await statementStorageOperations(page)).toEqual([]);
  await page.goto(`/orders/business/${UNINVOICED_ORDER_ID}`);
  await expect(page.getByTestId("quick-invoice-pdf-section")).toHaveCount(0);
  expect(retiredRouteCalls).toBe(0);
  expect(await statementStorageOperations(page)).toEqual([]);
});
