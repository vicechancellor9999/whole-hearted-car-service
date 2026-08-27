import { expect, test } from "@playwright/test";
import {
  FORMAL_DATA_CHANGED_EVENT,
  FORMAL_DATA_CHANGED_STORAGE_KEY,
  notifyFormalDataChanged,
  subscribeFormalDashboardRefresh,
  type FormalDataChangeBrowser,
} from "../../src/lib/formal-data-changes";
import {
  cancelFormalHandoffInSameMonth,
  recordFormalPayment,
  recordFormalRefund,
  runFormalRepairRoundAction,
} from "../../src/lib/api/formal-business-orders";

function createBrowserHarness() {
  const windowTarget = new EventTarget() as EventTarget & Pick<
    FormalDataChangeBrowser,
    "addEventListener" | "removeEventListener" | "dispatchEvent"
  >;
  const documentTarget = new EventTarget() as EventTarget & {
    visibilityState: DocumentVisibilityState;
  };
  const writes: Array<[string, string]> = [];
  documentTarget.visibilityState = "visible";

  return {
    browser: {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
      document: {
        addEventListener: documentTarget.addEventListener.bind(documentTarget),
        removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
        get visibilityState() { return documentTarget.visibilityState; },
      },
      localStorage: { setItem: (key: string, value: string) => writes.push([key, value]) },
    } as FormalDataChangeBrowser,
    documentTarget,
    windowTarget,
    writes,
  };
}

function storageEvent(key: string) {
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: key });
  return event;
}

test("formal write refreshes the open dashboard and emits only a lightweight cross-tab signal", () => {
  const { browser, writes, windowTarget } = createBrowserHarness();
  let refreshes = 0;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  notifyFormalDataChanged(browser);

  expect(refreshes).toBe(1);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.[0]).toBe(FORMAL_DATA_CHANGED_STORAGE_KEY);
  expect(writes[0]?.[1]).toMatch(/^\d+:/);

  windowTarget.dispatchEvent(storageEvent(FORMAL_DATA_CHANGED_STORAGE_KEY));
  expect(refreshes).toBe(2);
  unsubscribe();
});

test("a blocked cross-tab signal does not prevent the current dashboard from refreshing", () => {
  const { browser } = createBrowserHarness();
  browser.localStorage.setItem = () => { throw new Error("storage blocked"); };
  let refreshes = 0;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  expect(() => notifyFormalDataChanged(browser)).not.toThrow();
  expect(refreshes).toBe(1);
  unsubscribe();
});

test("dashboard refreshes when the tab becomes visible, regains focus, or returns through history", () => {
  const { browser, documentTarget, windowTarget } = createBrowserHarness();
  let refreshes = 0;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  documentTarget.visibilityState = "hidden";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  expect(refreshes).toBe(0);

  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  windowTarget.dispatchEvent(new Event("focus"));
  windowTarget.dispatchEvent(new Event("pageshow"));
  windowTarget.dispatchEvent(new Event("popstate"));

  expect(refreshes).toBe(4);
  unsubscribe();
  windowTarget.dispatchEvent(new Event(FORMAL_DATA_CHANGED_EVENT));
  expect(refreshes).toBe(4);
});

test("successful formal payment, refund, and handoff invalidate an already open dashboard", async () => {
  const { browser } = createBrowserHarness();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  globalThis.fetch = (async () => new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  try {
    await recordFormalPayment(7, { amount: "10", paymentMethodItemId: 1 });
    await recordFormalRefund(7, new FormData());
    await runFormalRepairRoundAction(7, { action: "formal_handoff" });

    expect(refreshes).toBe(3);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("failed formal writes do not invalidate the dashboard", async () => {
  const { browser } = createBrowserHarness();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "denied" }), {
    status: 422,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  try {
    await expect(recordFormalPayment(7, { amount: "10", paymentMethodItemId: 1 })).rejects.toThrow("denied");
    expect(refreshes).toBe(0);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("同月取消正式交单成功后只发布一次正式数据变更", async () => {
  const { browser, writes } = createBrowserHarness();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  globalThis.fetch = (async () => new Response(JSON.stringify({
    current: {},
    auditTrail: [],
    history: [],
    result: {},
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  try {
    await cancelFormalHandoffInSameMonth(7, {
      formalHandoffId: 88,
      reason: "绩效值需重新核对",
    });
    expect(refreshes).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(FORMAL_DATA_CHANGED_STORAGE_KEY);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("同月取消正式交单失败时不发布正式数据变更", async () => {
  const { browser, writes } = createBrowserHarness();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "不在同一月" }), {
    status: 422,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  const unsubscribe = subscribeFormalDashboardRefresh(() => { refreshes += 1; }, browser);

  try {
    await expect(cancelFormalHandoffInSameMonth(7, {
      formalHandoffId: 88,
      reason: "绩效值需重新核对",
    })).rejects.toThrow("不在同一月");
    expect(refreshes).toBe(0);
    expect(writes).toHaveLength(0);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
