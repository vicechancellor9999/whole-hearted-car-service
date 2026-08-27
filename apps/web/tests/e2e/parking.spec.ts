import { expect, test, type Page } from "@playwright/test";
import { assertNoPerformanceRuntimeErrors, usePerformanceIdentity } from "./helpers/performance-session";

const PRIMARY_KEY = "wh_linked_operations_state_v1";
const QUICK_PARKING_KEY = "wh_quick_parking_v1";
const BAD_QUICK_PARKING = '{"revision":1,"cases":[{"id":"qpark-broken"}],"previews":[';

async function installParkingStorageProbe(page: Page): Promise<void> {
  await page.addInitScript(({ quickKey, quickRaw, primaryKey }) => {
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    const seedMarker = "wh_e2e_parking_q_seeded";
    const probeKey = "wh_e2e_parking_storage_probe";
    if (window.sessionStorage.getItem(seedMarker) !== "1") {
      originalSetItem.call(window.localStorage, quickKey, quickRaw);
      originalSetItem.call(window.sessionStorage, seedMarker, "1");
      originalSetItem.call(window.sessionStorage, probeKey, "[]");
    }
    const scope = window as typeof window & {
      __WH_PARKING_STORAGE_PROBE__?: Array<{ kind: "set" | "remove" | "clear"; key: string | null }>;
    };
    const readProbe = (): Array<{ kind: "set" | "remove" | "clear"; key: string | null }> => {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(probeKey) ?? "[]") as unknown;
        return Array.isArray(parsed) ? parsed as Array<{ kind: "set" | "remove" | "clear"; key: string | null }> : [];
      } catch {
        return [];
      }
    };
    const record = (entry: { kind: "set" | "remove" | "clear"; key: string | null }): void => {
      const next = [...readProbe(), entry];
      scope.__WH_PARKING_STORAGE_PROBE__ = next;
      originalSetItem.call(window.sessionStorage, probeKey, JSON.stringify(next));
    };
    scope.__WH_PARKING_STORAGE_PROBE__ = readProbe();
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (key === primaryKey || key === quickKey) {
        record({ kind: "set", key });
      }
      originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string): void {
      if (key === primaryKey || key === quickKey) {
        record({ kind: "remove", key });
      }
      originalRemoveItem.call(this, key);
    };
    Storage.prototype.clear = function clear(): void {
      record({ kind: "clear", key: null });
      originalClear.call(this);
    };
  }, { quickKey: QUICK_PARKING_KEY, quickRaw: BAD_QUICK_PARKING, primaryKey: PRIMARY_KEY });
}

async function parkingStorageEvidence(page: Page): Promise<{
  primaryRaw: string | null;
  quickRaw: string | null;
  operations: Array<{ kind: "set" | "remove" | "clear"; key: string | null }>;
}> {
  return page.evaluate(({ primaryKey, quickKey }) => ({
    primaryRaw: window.localStorage.getItem(primaryKey),
    quickRaw: window.localStorage.getItem(quickKey),
    operations: [...((window as typeof window & {
      __WH_PARKING_STORAGE_PROBE__?: Array<{ kind: "set" | "remove" | "clear"; key: string | null }>;
    }).__WH_PARKING_STORAGE_PROBE__ ?? [])],
  }), { primaryKey: PRIMARY_KEY, quickKey: QUICK_PARKING_KEY });
}

async function resetParkingStorageProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __WH_PARKING_STORAGE_PROBE__?: Array<{ kind: "set" | "remove" | "clear"; key: string | null }>;
    }).__WH_PARKING_STORAGE_PROBE__ = [];
    window.sessionStorage.setItem("wh_e2e_parking_storage_probe", "[]");
  });
}

async function installParkingClock(page: Page, initialIso: string): Promise<void> {
  await page.addInitScript(({ initial }) => {
    const clockKey = "wh_e2e_parking_clock";
    if (window.sessionStorage.getItem(clockKey) === null) {
      window.sessionStorage.setItem(clockKey, String(Date.parse(initial)));
    }
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: { nowMs: number } })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
        nowMs: Number(window.sessionStorage.getItem(clockKey)),
      };
  }, { initial: initialIso });
}

async function advanceParkingClock(page: Page, nextIso: string): Promise<void> {
  await page.evaluate((next) => {
    const nowMs = Date.parse(next);
    window.sessionStorage.setItem("wh_e2e_parking_clock", String(nowMs));
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: { nowMs: number } })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = { nowMs };
  }, nextIso);
}

type ParkingSessionSignal = "storage" | "popstate";

const parkingSessions = {
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
      id: "emp-003", name: "王建华", nameEn: "Wang Jianhua", role: "frontdesk_admin",
      roleLabel: "前台管理员", roleLabelEn: "Front Desk Admin", scope: "all",
      avatarColor: "#0ea5e9", initials: "WJ",
    },
    token: "offline-emp-003",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
} as const;

async function switchParkingSession(
  page: Page,
  identity: keyof typeof parkingSessions,
  signal: ParkingSessionSignal,
  customerScenario?: unknown,
): Promise<void> {
  await page.evaluate(({ serialized, eventKind, nextCustomerScenario }) => {
    const oldValue = window.localStorage.getItem("wh_session");
    window.localStorage.setItem("wh_session", serialized);
    if (nextCustomerScenario !== undefined) {
      (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
        .__WH_CUSTOMERS_TEST_SCENARIO__ = nextCustomerScenario;
    }
    if (eventKind === "storage") {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "wh_session",
        oldValue,
        newValue: serialized,
      }));
    } else {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, {
    serialized: JSON.stringify(parkingSessions[identity]),
    eventKind: signal,
    nextCustomerScenario: customerScenario,
  });
}

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("official parking page ignores unreadable legacy Q bytes and renders without a framework overlay", async ({ page }) => {
  await installParkingStorageProbe(page);
  await page.goto("/parking");

  await expect(page.getByRole("heading", { level: 1, name: "停车费" })).toBeVisible();
  await expect(page.getByTestId("parking-workspace")).toBeVisible();
  await expect(page.getByTestId("parking-cases")).toBeVisible();
  await expect(page.getByText("停车费读取失败", { exact: true })).toHaveCount(0);
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  const evidence = await parkingStorageEvidence(page);
  expect(evidence.primaryRaw).not.toBeNull();
  expect(evidence.operations.filter((entry) => entry.kind === "set" && entry.key === PRIMARY_KEY).length)
    .toBeGreaterThan(0);
  expect(evidence.operations.filter((entry) => entry.kind === "remove" || entry.kind === "clear"))
    .toEqual([]);
  expect(evidence.quickRaw).toBe(BAD_QUICK_PARKING);
  expect(evidence.operations.filter((entry) => (
    entry.key === QUICK_PARKING_KEY || entry.kind === "clear"
  ))).toEqual([]);
});

test("clean parking demo shows claimed, unclaimed, and an independent cash refund", async ({ page }) => {
  await installParkingStorageProbe(page);
  await page.goto("/parking");

  const claimed = page.getByTestId("parking-case-VEH-UAT-001");
  const unclaimed = page.getByTestId("parking-case-VEH-BULK-002");
  await expect(claimed).toBeVisible();
  await expect(unclaimed).toBeVisible();
  await expect(page.locator('[data-testid^="parking-case-"]')).toHaveCount(2);

  await expect(page.getByTestId("parking-committed-VEH-UAT-001")).toContainText("3 天");
  await expect(page.getByTestId("parking-committed-VEH-UAT-001")).toContainText("JMD 5,000");
  await expect(page.getByTestId("parking-billing-VEH-UAT-001")).toContainText("已认领");
  await expect(page.getByTestId("parking-billing-VEH-UAT-001")).toContainText("已结清");
  await expect(page.getByTestId("parking-billing-VEH-BULK-002")).toContainText("未认领");

  await page.getByTestId("parking-payments-open-VEH-UAT-001").click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByTestId("payments-ledger")).toContainText("停车费更正退款");
  await expect(page.getByTestId("payments-ledger")).toContainText("实际退还现金 JMD 2,500");

  await page.goto("/parking");
  await page.getByTestId("parking-waiver-open-VEH-UAT-001").click();
  await page.getByTestId("parking-waiver-days").fill("1");
  await page.getByTestId("parking-waiver-reason").fill("E2E 第二笔停车更正退款");
  await page.getByTestId("parking-waiver-preview").click();
  await expect(page.getByTestId("parking-waiver-cash-refund")).toContainText("JMD 2,500");
  await expect(page.getByTestId("parking-waiver-refund-methods")).toBeVisible();
  await page.getByTestId("parking-waiver-refund-method-card").click();
  await page.getByTestId("parking-waiver-confirm").click();
  await expect(page.getByTestId("parking-notice")).toContainText("减免已生效");

  await page.getByTestId("parking-payments-open-VEH-UAT-001").click();
  await expect(page.getByTestId("payments-ledger")).toContainText("E2E 第二笔停车更正退款");
  await expect(page.locator('[data-testid^="payments-ledger-row-"]')).toHaveCount(9);
});

test("legacy parking invoice URL redirects on the server to plain /payments without touching Q", async ({ page, request }) => {
  await installParkingStorageProbe(page);
  await page.goto("/payments");
  await expect(page.getByRole("heading", { level: 1, name: "收付款与交车" })).toBeVisible();
  await expect(page.getByTestId("payments-table")).toBeVisible();
  const before = await parkingStorageEvidence(page);
  expect(before.primaryRaw).not.toBeNull();
  expect(before.quickRaw).toBe(BAD_QUICK_PARKING);
  await resetParkingStorageProbe(page);

  const rawResponse = await request.get("/parking/PARK-retired/invoice?copy=en&return=%2Fparking", {
    maxRedirects: 0,
  });
  expect([307, 308]).toContain(rawResponse.status());
  const location = rawResponse.headers().location;
  expect(location).toBeTruthy();
  const redirect = new URL(location!, "http://127.0.0.1:3002");
  expect(redirect.pathname).toBe("/payments");
  expect(redirect.search).toBe("");

  await page.goto("/parking/PARK-retired/invoice?copy=en&return=%2Fparking");
  await expect(page).toHaveURL(/\/payments$/);
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByTestId("payments-table")).toBeVisible();
  const evidence = await parkingStorageEvidence(page);
  expect(evidence.primaryRaw).toBe(before.primaryRaw);
  expect(evidence.quickRaw).toBe(BAD_QUICK_PARKING);
  expect(evidence.operations).toEqual([]);
});

test("430px 移动端无页面根横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/parking");
  await expect(page.getByTestId("parking-calendar-rule")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
